# Gemini AI Agent - Project-Specific Instructions

This document contains guidelines for the Gemini AI agent to follow when working on the `chatgpt-docker-puppeteer` project.

## 1. Core Technologies & Stack

-   **Language**: JavaScript (ESM)
-   **Platform**: Node.js
-   **Node Version**: 24.x (as specified in `.nvmrc` and `package.json`).
-   **Module System**: ES Modules (`"type": "module"`). Use `import`/`export` syntax.
-   **Process Manager**: `pm2` is the primary tool for production and daemon management. The configuration is in `ecosystem.config.cjs`.
-   **Package Manager**: `npm`. Do not use `yarn` or other package managers.

## 2. Code Style and Quality

-   **Formatting**: The project uses **Prettier**. The configuration is in `.prettierrc`. Always run `npm run format` before finalizing changes.
-   **Linting**: The project uses **ESLint**. The configuration is in `eslint.config.mjs` (flat config format).
    -   Adhere strictly to the existing linting rules.
    -   Run `npm run lint` to check for issues.
-   **Type-Checking**: The project uses JSDoc for type annotations, which are checked by the TypeScript compiler.
    -   `jsconfig.json` is configured with `"checkJs": false` globally.
    -   For critical files (e.g., in `src/core`, `src/kernel`), add `// @ts-check` at the top of the file to enable strict type-checking.

## 3. Project Structure and Conventions

-   **Path Aliases**: The project uses `#imports` for clean, absolute-like paths (e.g., `#core/...`, `#shared/...`). These are defined in `package.json` and `jsconfig.json`. **Always use these aliases** for internal imports instead of relative paths (`../../...`).
-   **Configuration Files**: The project is heavily configured. Before making changes, review existing configuration files like `ecosystem.config.cjs`, `.puppeteerrc.cjs`, and `jsconfig.json`. They are well-documented and contain important project context.
-   **Development Workflow**:
    -   Use `nodemon` for automatic restarts during development (`npm run dev`).
    -   Use `pm2` for managing daemonized processes (`npm run daemon:start`, `npm run daemon:status`, etc.).

## 4. Testing

-   **Framework**: The project uses the native Node.js test runner (`node:test`).
-   **Test Scripts**:
    -   `npm test`: Runs the complete test suite.
    -   `npm run test:unit`: For unit tests.
    -   `npm run test:integration`: For integration tests.
-   **New Features/Fixes**: Any new feature or bug fix should be accompanied by relevant tests to maintain coverage and stability.

## 5. Key Files to Consult

-   **`package.json`**: Defines scripts, dependencies, and `#imports`.
-   **`ecosystem.config.cjs`**: Defines how `pm2` manages the applications. Critical for understanding the process architecture.
-   **`jsconfig.json`**: Defines TypeScript/JSDoc settings and path aliases.
-   **`eslint.config.mjs`**: Defines the code style and linting rules.
-   **`.puppeteerrc.cjs`**: Contains essential (and well-documented) configuration for Puppeteer and Chrome management.
