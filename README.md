# github

> GitHub integration module for eevee — create GitHub issues directly from chat.

## Overview

The github module lets users create GitHub issues through chat commands. After initiating issue creation, the bot sends a confirmation prompt and waits for the user to provide a description, skip it, or cancel. Issues are created on a configurable default repository via the GitHub API.

## Features

- **`github issue create <title>`** — start creating a GitHub issue with the given title
- **Confirmation flow** — after the command, the bot asks for a description; reply with the description text, `skip` to create without a description, or `cancel` to abort
- **Configurable timeout** — pending confirmations expire after a configurable period (default 10 minutes)
- **SQLite persistence** — issue records are stored in a local database for tracking
- **Rate limiting** — configurable per-user or per-channel limits to prevent spam
- **Help registration** — automatically registers `!help github` documentation with the help module
- **Prometheus metrics** — command counts, processing time, NATS subscribe counts
- **Health checks** — HTTP endpoint for liveness/readiness probes (Kubernetes-ready)
- **Graceful shutdown** — drains NATS connections cleanly on SIGTERM/SIGINT

## Usage / Commands

### `github issue create <title>`

Creates a GitHub issue on the configured repository.

**Example:**

```
<user> github issue create Fix the login bug
<bot>  user: I'll create an issue titled "Fix the login bug" on eeveebot/eevee.
       Reply with a description, or say "skip" to create with just the title, or "cancel" to abort.
<user> The login page returns a 500 error when using SSO
<bot>  user: Issue created: https://github.com/eeveebot/eevee/issues/42
```

**Skip the description:**

```
<user> github issue create Update dependencies
<bot>  user: I'll create an issue titled "Update dependencies" on eeveebot/eevee. ...
<user> skip
<bot>  user: Issue created: https://github.com/eeveebot/eevee/issues/43
```

**Cancel:**

```
<user> github issue create Something I changed my mind about
<bot>  user: I'll create an issue titled "Something I changed my mind about" on eeveebot/eevee. ...
<user> cancel
<bot>  user: Issue creation cancelled.
```

### Help

Users can query built-in help:

```
<user> !help github
```

## Configuration

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `GITHUB_PAT` | Yes | — | GitHub Personal Access Token for API access |
| `NATS_HOST` | Yes | — | NATS server hostname |
| `NATS_TOKEN` | Yes | — | NATS authentication token |
| `MODULE_CONFIG_PATH` | No | — | Path to a YAML configuration file |
| `MODULE_DATA` | Yes | — | Directory for the SQLite database |
| `HTTP_API_PORT` | No | `9000` | Port for the HTTP metrics/health server |

### YAML Configuration File

If `MODULE_CONFIG_PATH` is set, the module loads additional settings from the specified YAML file:

```yaml
# Rate limit configuration
ratelimit:
  mode: drop        # "drop" (silently ignore) or "queue" (buffer and delay)
  level: user       # "user" or "channel"
  limit: 3          # Maximum allowed invocations per interval
  interval: 1m      # Time window (e.g. "30s", "5m", "1h")

# Default GitHub repository for issue creation
defaultRepo: eeveebot/eevee

# Timeout for issue creation confirmation (in milliseconds, default 10 minutes)
# confirmationTimeoutMs: 600000
```

If no configuration file is provided, the module uses sensible defaults.

## Architecture

```
User types "github issue create Fix the bug"
        │
        ▼
   Chat Connector (IRC/Discord)
        │
        ▼
   Router — regex match: ^github\s+
        │
        ▼
   NATS: command.execute.<UUID>
        │
        ▼
   GitHub Module
   ├── Parse command, extract title
   ├── Insert pending issue into SQLite
   ├── Set confirmation timeout
   └── Send confirmation prompt to user
        │
   User replies with description / skip / cancel
        │
        ▼
   NATS: broadcast.message.<UUID>
        │
        ▼
   GitHub Module (broadcast handler)
   ├── Match user to pending issue
   ├── Call GitHub API (POST /repos/{owner}/{repo}/issues)
   ├── Update SQLite record
   └── Send confirmation with issue URL
```

## Install

This module is part of the eevee ecosystem and is not published independently. Install it as a workspace package:

```bash
# From the eevee project root
npm install
```

Or build and run the github module directly:

```bash
cd github
npm install
npm run build
npm run dev
```

### Docker

A `Dockerfile` is included for containerized deployment. It performs a multi-stage build: the builder stage installs dev dependencies and compiles TypeScript, and the final stage copies only production artifacts.

```bash
docker build --secret id=GITHUB_TOKEN,src=<token-file> -t eevee-github .
```

## Development

```bash
# Install dependencies
npm install

# Lint
npm test

# Build (lint + compile TypeScript)
npm run build

# Build and run locally
npm run dev
```

### Requirements

- **Node.js** ≥ 24.0.0
- Access to a NATS server (for runtime)
- A GitHub Personal Access Token with repo access
- Access to the `@eeveebot` GitHub Packages registry (for `@eeveebot/libeevee`)

## Contributing

This module is part of the [eevee project](https://github.com/eeveebot/eevee). See the contributing guidelines for details on development workflow, pull requests, and code standards.

## License

[CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/) — see [LICENSE](./LICENSE) for the full text.
