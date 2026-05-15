# AGENTS.md

This document provides essential information for agentic coding assistants working with this repository.

## Build/Lint/Test Commands

### Build Commands

```bash
# Build the project (runs lint first, then compiles TypeScript)
npm run build

# Development mode (builds and runs the application)
npm run dev
```

### Lint Commands

```bash
# Run ESLint on source files
npm run test

# Run Prettier to check formatting
npx prettier --check src/

# Run both ESLint and Prettier together
npm run test && npx prettier --check src/
```

### Test Commands

```bash
# Run ESLint (primary testing mechanism in this project)
npm run test

# Run a single test file with ESLint
npx eslint src/path/to/specific/file.mts

# Run tests on a specific directory
npx eslint src/lib/
```

### TypeScript Compilation

```bash
# Compile TypeScript files to JavaScript
npx tsc

# Compile with watch mode for development
npx tsc --watch
```

### Update Dependencies

```bash
# Update core library dependencies
npm run update-libraries
```

## Code Style Guidelines

### Language and Extensions

- TypeScript (.mts extension for ES modules)
- Node.js >= 24.0.0
- ECMAScript 2024 features allowed

### Imports

1. Group imports in the following order:
   - Node.js native modules
   - Third-party packages
   - First-party/internal modules
2. Separate each group with a blank line
3. Use explicit file extensions (.mjs for built files)
4. Use destructuring imports when importing specific functions/variables
5. Use namespace imports (\*) for modules with many exports

### Formatting

Based on .prettierrc.yaml:

- Use trailing commas (ES5 style)
- Tab width: 2 spaces
- Semicolons: required
- Single quotes for strings

### TypeScript Configuration

From tsconfig.json:

- Strict type checking enabled
- ES2024 target
- Module resolution: nodenext
- Declaration files generated
- Skip lib check enabled

### Naming Conventions

- Use camelCase for variables and functions
- Use PascalCase for classes and interfaces
- Use UPPER_SNAKE_CASE for constants
- File names use kebab-case
- Type interfaces should be named descriptively

### Error Handling

- Use proper typing for error parameters (`error: unknown`)
- Log errors with appropriate context using the winston logger
- Handle promises appropriately with async/await or .catch()
- Use specific error types rather than generic Error when possible

### Documentation

- Comment complex logic with explanatory comments
- Use JSDoc-style comments for functions and classes
- Document public APIs and exported functions
- Keep comments up to date with code changes

### Event Handling

- Extend EventEmitter for classes that emit events
- Passthrough events from underlying libraries when appropriate
- Use descriptive event names that match the underlying library
- Handle all relevant events from the irc-framework library

### Logging

- Use the winston logger imported from @eeveebot/libeevee
- Include a producer field to identify the source component
- Include relevant context information in log messages
- Use appropriate log levels (info, error, debug, etc.)

### Code Organization

- Separate concerns into logical modules
- Use classes for complex objects with state and behavior
- Export types and interfaces alongside implementation
- Keep functions focused and single-purpose
- Use configuration objects for complex initialization

### Type Safety

- Enable strict TypeScript checking
- Use explicit type annotations for function parameters and return values
- Define interfaces for complex objects
- Use union types and discriminated unions where appropriate
- Avoid using `any` type except in rare circumstances

### Asynchronous Programming

- Prefer async/await over Promise chains
- Handle promise rejections appropriately
- Use void operator when intentionally ignoring promise results
- Use Promise.all() for concurrent asynchronous operations

### Constants and Configuration

- Define constants at the top of files or in dedicated modules
- Use environment variables for configuration
- Validate required environment variables early
- Provide sensible defaults where appropriate

### Code Patterns

- Use functional programming approaches when appropriate
- Prefer immutable data structures when possible
- Use early returns to reduce nesting
- Extract complex logic into pure functions when possible
- Follow the principle of least surprise in API design
