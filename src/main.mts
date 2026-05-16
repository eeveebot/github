'use strict';

// GitHub integration module
// Create GitHub issues via chat commands

import fs from 'node:fs';
import * as Nats from 'nats';
import {
  NatsClient,
  log,
  createNatsConnection,
  registerGracefulShutdown,
  createModuleMetrics,
  loadModuleConfig,
  RateLimitConfig,
  defaultRateLimit,
  registerCommand,
  registerBroadcast,
  unregisterBroadcast,
  sendChatMessage,
  registerHelp,
  HelpEntry,
  registerStatsHandlers,
  initializeSystemMetrics,
  setupHttpServer,
  NatsSubscriptionResult,
} from '@eeveebot/libeevee';
import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';


// Record module startup time for uptime tracking
const moduleStartTime = Date.now();
const moduleVersion = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version as string;

const metrics = createModuleMetrics('github');

const githubCommandUUID = '3acd5a0a-3b8e-4697-bfbb-9b45ffbf527a';
const githubCommandDisplayName = 'github';

// GitHub module configuration interface
interface GitHubConfig {
  ratelimit?: RateLimitConfig;
  defaultRepo?: string;
  confirmationTimeoutMs?: number;
}

// In-memory pending issue state
interface PendingIssue {
  issueId: string;
  repo: string;
  title: string;
  userNick: string;
  originalChannel: string;
  network: string;
  instance: string;
  platform: string;
  trace: string;
  createdAt: number;
  timeoutId: ReturnType<typeof setTimeout>;
  broadcastUUID: string;
  broadcastSub: Promise<Nats.Subscription | false>;
  controlSubs: Array<Promise<Nats.Subscription | false>>;
  descriptionLines: string[];
}

const pendingIssues = new Map<string, PendingIssue>();

const natsClients: InstanceType<typeof NatsClient>[] = [];
const natsSubscriptions: Array<Promise<NatsSubscriptionResult>> = [];

// Initialize system metrics
initializeSystemMetrics('github');

// Setup HTTP server for metrics and health checks
setupHttpServer({
  port: process.env.HTTP_API_PORT || '9000',
  serviceName: 'github',
  natsClients: natsClients,
});

// Validate required environment variable at startup
if (!process.env.GITHUB_PAT) {
  log.error('GITHUB_PAT environment variable not set', { producer: 'github' });
  throw new Error('GITHUB_PAT environment variable not set');
}

// Database instance
let db: Database.Database | null = null;

/**
 * Clean up a pending issue: unregister broadcast, unsubscribe, clear timeout
 */
async function cleanupPendingIssue(userIdent: string): Promise<void> {
  const pending = pendingIssues.get(userIdent);
  if (!pending) return;

  clearTimeout(pending.timeoutId);

  // Unsubscribe the broadcast message listener
  const sub = await pending.broadcastSub;
  if (sub) sub.unsubscribe();

  // Unsubscribe any control re-registration listeners
  for (const subPromise of pending.controlSubs) {
    const sub = await subPromise;
    if (sub) sub.unsubscribe();
  }

  // Tell the router to stop forwarding to this broadcast UUID
  await unregisterBroadcast(nats, { broadcastUUID: pending.broadcastUUID }, metrics);

  pendingIssues.delete(userIdent);
}

registerGracefulShutdown(natsClients, async () => {
  // Clean up all pending issues
  for (const [userIdent] of pendingIssues) {
    await cleanupPendingIssue(userIdent);
  }

  if (db) db.close();
});

const nats = await createNatsConnection();
natsClients.push(nats);

// Load configuration at startup
const githubConfig = loadModuleConfig<GitHubConfig>({});
const defaultRepo = githubConfig.defaultRepo || 'eeveebot/eevee';
const confirmationTimeoutMs = githubConfig.confirmationTimeoutMs || 600000;

// Initialize database
function initDatabase(): void {
  try {
    const moduleDataPath = process.env.MODULE_DATA;
    if (!moduleDataPath) {
      throw new Error('MODULE_DATA environment variable not set');
    }

    // Ensure the directory exists
    if (!fs.existsSync(moduleDataPath)) {
      fs.mkdirSync(moduleDataPath, { recursive: true });
    }

    const dbPath = `${moduleDataPath}/github.db`;
    db = new Database(dbPath);

    // Create tables if they don't exist
    db.exec(`
      CREATE TABLE IF NOT EXISTS issues (
        id TEXT PRIMARY KEY,
        user_ident TEXT NOT NULL,
        user_nick TEXT NOT NULL,
        github_issue_number INTEGER,
        github_issue_url TEXT,
        title TEXT NOT NULL,
        description TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);

    log.info('Initialized github database', {
      producer: 'github',
      dbPath,
    });
  } catch (error) {
    log.error('Failed to initialize database', {
      producer: 'github',
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

// Initialize database at startup
initDatabase();

// Prepared statements for database operations
const insertIssueStmt = db!.prepare(`
  INSERT INTO issues (id, user_ident, user_nick, title, description, status)
  VALUES (@id, @user_ident, @user_nick, @title, @description, @status)
`);

const updateIssueCreatedStmt = db!.prepare(
  'UPDATE issues SET github_issue_number = @number, github_issue_url = @url, status = \'open\', description = @description, updated_at = CURRENT_TIMESTAMP WHERE id = @id'
);

const deleteIssueStmt = db!.prepare(
  'DELETE FROM issues WHERE id = @id'
);


/**
 * Create a GitHub issue via the API
 */
async function createGitHubIssue(
  repo: string,
  title: string,
  description: string | undefined,
  label: string = 'from-chat'
): Promise<{ number: number; html_url: string } | null> {
  const pat = process.env.GITHUB_PAT;
  if (!pat) {
    log.error('GITHUB_PAT not set', { producer: 'github' });
    return null;
  }

  try {
    const body: Record<string, unknown> = { title, labels: [label] };
    if (description) {
      body.body = description;
    }

    const response = await fetch(`https://api.github.com/repos/${repo}/issues`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${pat}`,
        'Accept': 'application/vnd.github+json',
        'Content-Type': 'application/json',
        'User-Agent': 'eevee-github-module',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      log.error('GitHub API error', { producer: 'github', status: response.status, error: errorText });
      return null;
    }

    const data = await response.json() as { number: number; html_url: string };
    return { number: data.number, html_url: data.html_url };
  } catch (error) {
    log.error('Failed to create GitHub issue', { producer: 'github', error: error instanceof Error ? error.message : String(error) });
    return null;
  }
}

/**
 * Handle pending issue timeout
 */
async function handlePendingIssueTimeout(userIdent: string): Promise<void> {
  const pending = pendingIssues.get(userIdent);
  if (!pending) return;

  // Remove from DB
  deleteIssueStmt.run({ id: pending.issueId });

  // Save info before cleanup wipes the reference
  const { userNick, title, network, instance, platform, trace } = pending;

  // Clean up broadcast subscription
  await cleanupPendingIssue(userIdent);

  // Notify the user via DM
  void sendChatMessage(nats, {
    channel: userNick,
    network,
    instance,
    platform,
    text: `Issue creation for "${title}" timed out. Please try again.`,
    trace,
  }, metrics);
}

/**
 * Set up a dynamic broadcast listener for a pending issue.
 * Generates a unique UUID, registers with the router scoped to the user's nick,
 * and subscribes to handle the DM confirmation flow.
 */
async function setupPendingIssueBroadcast(pending: PendingIssue, userIdent: string): Promise<void> {
  const broadcastUUID = randomUUID();
  const broadcastDisplayName = `github-issue-${pending.issueId}`;

  // Register with the router, scoped to this user's nick on this network/instance
  const controlSubs = await registerBroadcast(nats, {
    broadcastUUID,
    broadcastDisplayName,
    nick: pending.userNick,
    network: pending.network,
    instance: pending.instance,
  }, metrics);

  // Subscribe to broadcast messages for this specific UUID
  const broadcastSub = nats.subscribe(
    `broadcast.message.${broadcastUUID}`,
    async (subject: string, message: Nats.Msg) => {
      try {
        const data = JSON.parse(message.string());
        log.debug('Received broadcast.message for github pending issue', {
          producer: 'github',
          broadcastUUID,
          platform: data.platform,
          channel: data.channel,
          user: data.nick,
        });

        // Only process DMs (channel is the user's nick, not a #channel)
        if (data.channel.startsWith('#')) {
          return;
        }

        const current = pendingIssues.get(userIdent);
        if (!current) return;

        const userText = data.text.trim();
        const userTextLower = userText.toLowerCase();

        if (userTextLower === 'cancel') {
          // Cancel the issue
          deleteIssueStmt.run({ id: current.issueId });
          await cleanupPendingIssue(userIdent);

          void sendChatMessage(nats, {
            channel: current.userNick,
            network: current.network,
            instance: current.instance,
            platform: current.platform,
            text: 'Issue creation cancelled.',
            trace: current.trace,
          }, metrics);
          return;
        }

        if (userTextLower === 'confirm') {
          // Create the issue with accumulated description
          const description = current.descriptionLines.length > 0
            ? current.descriptionLines.join('\n')
            : undefined;

          const result = await createGitHubIssue(current.repo, current.title, description);

          if (result) {
            updateIssueCreatedStmt.run({
              number: result.number,
              url: result.html_url,
              description: description ?? null,
              id: current.issueId,
            });
            await cleanupPendingIssue(userIdent);

            void sendChatMessage(nats, {
              channel: current.userNick,
              network: current.network,
              instance: current.instance,
              platform: current.platform,
              text: `Issue created: ${result.html_url}`,
              trace: current.trace,
            }, metrics);

            void sendChatMessage(nats, {
              channel: current.originalChannel,
              network: current.network,
              instance: current.instance,
              platform: current.platform,
              text: `${current.userNick}: Issue created: ${result.html_url}`,
              trace: current.trace,
            }, metrics);
          } else {
            await cleanupPendingIssue(userIdent);

            void sendChatMessage(nats, {
              channel: current.userNick,
              network: current.network,
              instance: current.instance,
              platform: current.platform,
              text: 'Failed to create GitHub issue. Please try again later.',
              trace: current.trace,
            }, metrics);
          }
          return;
        }

        // Not a keyword — accumulate as a description line, reset the timeout
        current.descriptionLines.push(userText);
        clearTimeout(current.timeoutId);
        current.timeoutId = setTimeout(() => {
          void handlePendingIssueTimeout(userIdent);
        }, confirmationTimeoutMs);
      } catch (error) {
        log.error('Failed to process github pending issue broadcast', {
          producer: 'github',
          broadcastUUID,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  );

  // Store broadcast details on the pending issue
  pending.broadcastUUID = broadcastUUID;
  pending.broadcastSub = broadcastSub;
  pending.controlSubs = controlSubs;
}

// Register the github command with the router
const commandSubs = await registerCommand(nats, {
  commandUUID: githubCommandUUID,
  commandDisplayName: githubCommandDisplayName,
  regex: '^github\\s+',
  ratelimit: githubConfig.ratelimit || defaultRateLimit,
}, metrics);
natsSubscriptions.push(...commandSubs);

// Subscribe to command execution messages
const githubCommandSub = nats.subscribe(
  `command.execute.${githubCommandUUID}`,
  async (subject: string, message: Nats.Msg) => {
    try {
      const data = JSON.parse(message.string());
      log.info('Received command.execute for github', {
        producer: 'github',
        platform: data.platform,
        instance: data.instance,
        channel: data.channel,
        user: data.user,
        originalText: data.originalText,
      });

      // Parse the command: github issue create <title>
      const commandText = data.text.trim();

      if (!commandText.startsWith('issue create')) {
        void sendChatMessage(nats, {
          channel: data.channel,
          network: data.network,
          instance: data.instance,
          platform: data.platform,
          text: `${data.nick}: Usage: github issue create <title>`,
          trace: data.trace,
        }, metrics);
        return;
      }

      const title = commandText.replace(/^issue create\s*/i, '').trim();

      if (!title) {
        void sendChatMessage(nats, {
          channel: data.channel,
          network: data.network,
          instance: data.instance,
          platform: data.platform,
          text: `${data.nick}: Usage: github issue create <title>`,
          trace: data.trace,
        }, metrics);
        return;
      }

      const userIdent = `${data.platform}:${data.network}:${data.user}`;

      // Check if user already has a pending issue
      if (pendingIssues.has(userIdent)) {
        void sendChatMessage(nats, {
          channel: data.channel,
          network: data.network,
          instance: data.instance,
          platform: data.platform,
          text: `${data.nick}: You already have a pending issue. Please respond to the confirmation or wait for it to time out.`,
          trace: data.trace,
        }, metrics);
        return;
      }

      // Generate a record ID
      const issueId = Math.random().toString(16).substring(2, 10);

      // Insert into DB with status='pending'
      insertIssueStmt.run({
        id: issueId,
        user_ident: userIdent,
        user_nick: data.nick,
        title: title,
        description: null,
        status: 'pending',
      });

      // Create the pending issue entry (broadcast fields filled in by setupPendingIssueBroadcast)
      const pending: PendingIssue = {
        issueId,
        repo: defaultRepo,
        title,
        userNick: data.nick,
        originalChannel: data.channel,
        network: data.network,
        instance: data.instance,
        platform: data.platform,
        trace: data.trace,
        createdAt: Date.now(),
        timeoutId: null as unknown as ReturnType<typeof setTimeout>,
        broadcastUUID: '',
        broadcastSub: null as unknown as Promise<Nats.Subscription | false>,
        controlSubs: [],
        descriptionLines: [],
      };

      // Set up timeout
      pending.timeoutId = setTimeout(() => {
        void handlePendingIssueTimeout(userIdent);
      }, confirmationTimeoutMs);

      // Store in map before setting up broadcast (broadcast handler needs it)
      pendingIssues.set(userIdent, pending);

      // Set up dynamic broadcast for DM confirmation
      await setupPendingIssueBroadcast(pending, userIdent);

      // Acknowledge in the original channel
      void sendChatMessage(nats, {
        channel: data.channel,
        network: data.network,
        instance: data.instance,
        platform: data.platform,
        text: `${data.nick}: I'll DM you to get more details.`,
        trace: data.trace,
      }, metrics);

      // Send confirmation prompt via DM
      void sendChatMessage(nats, {
        channel: data.nick,
        network: data.network,
        instance: data.instance,
        platform: data.platform,
        text: `I'll create an issue titled "${title}" on ${defaultRepo}. Send me a description (one line at a time is fine), then say "confirm" when you're ready, or "cancel" to abort.`,
        trace: data.trace,
      }, metrics);
    } catch (error) {
      log.error('Failed to process github command', {
        producer: 'github',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
);
natsSubscriptions.push(githubCommandSub);

// Subscribe to stats.uptime and stats.emit.request
const statsSubs = registerStatsHandlers({ nats, moduleName: 'github', startTime: moduleStartTime, version: moduleVersion, metrics });
natsSubscriptions.push(...statsSubs);

// Help information for github commands
const githubHelp: HelpEntry[] = [
  {
    command: 'github issue create',
    descr: 'Create a GitHub issue. Bot will DM you for description — send lines, then say "confirm" to submit, or "cancel" to abort.',
    params: [
      {
        param: 'title',
        required: true,
        descr: 'The issue title',
      },
    ],
  },
];

// Register help using registerHelp helper
const helpSubs = await registerHelp(nats, 'github', githubHelp, metrics);
natsSubscriptions.push(...helpSubs);
