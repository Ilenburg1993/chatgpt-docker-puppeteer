# AI Coding Agent Instructions for chatgpt-docker-puppeteer

## Architecture Overview
This is a domain-driven autonomous agent using Puppeteer for browser automation with AI chatbots (ChatGPT, Gemini). Core components:
- **Engine** (`index.js`): Main task processing loop with adaptive backoff, incremental response collection, and quality validation
- **Queue System** (`src/infra/io.js`): JSON-based task persistence in `fila/` with reactive caching and PID-based locking
- **Drivers** (`src/driver/`): Factory-pattern for target-specific automation (e.g., `ChatGPTDriver.js`)
- **Dashboard** (`server.js`): Express + Socket.io for real-time monitoring and control
- **Schemas** (`src/core/schemas.js`): Zod-validated data contracts for tasks, DNA/rules, and telemetry

## Key Patterns
- **Audit Levels**: Code annotated with audit levels (e.g., `Audit Level: 32`) indicating reliability tiers
- **Scoped Locking**: Use `io.acquireLock(taskId, target)` with PID validation to prevent zombie processes
- **Incremental Collection**: Responses gathered in chunks with anti-loop heuristics (hash comparison, punctuation detection)
- **Memory Management**: Manual GC (`global.gc()`) and WeakMap caching for browser instances
- **Reactive State**: File watchers invalidate caches instantly (e.g., queue changes trigger re-scan)
- **Sanitization**: Remove control characters from prompts to prevent browser protocol breaks
- **Backoff Strategy**: Exponential jitter for failures (task/infra separate counters)

## Developer Workflows
- **Local Dev**: `npm run dev` (nodemon, ignores data dirs)
- **Production**: `npm run daemon:start` (PM2 with memory limits, auto-restart)
- **Queue Ops**: `npm run queue:status -- --watch` for live monitoring; `npm run queue:add` for task creation
- **Testing**: `npm run test:linux` (bash script); use `tests/helpers.js` for agent lifecycle in tests
- **Diagnostics**: `npm run diagnose` for crash analysis; forensics dumps in `logs/crash_reports/`
- **Cleanup**: `npm run clean` removes logs/tmp/queue; `npm run reset:hard` for full reset

## Conventions
- **Logging**: `logger.log('INFO', msg, taskId?)` with structured telemetry
- **Error Handling**: Classify failures with `classifyAndSaveFailure(task, type, msg)` and history tracking
- **Configuration**: Hot-reload from `config.json`/`dynamic_rules.json` with defaults in `src/core/config.js`
- **Task States**: `PENDING` → `RUNNING` → `DONE`/`FAILED`; use `schemas.parseTask()` for validation
- **File Paths**: Responses in `respostas/{taskId}.txt`; queue tasks as `{taskId}.json` in `fila/`
- **Browser Profiles**: Isolated in `profile/` with stealth plugins and user-agent rotation

## Integration Points
- **PM2**: Ecosystem config for dual processes (agent + dashboard); logs in `logs/`
- **Socket.io**: Real-time events for task updates, status broadcasts
- **Puppeteer Extras**: Stealth plugin + ghost-cursor for human-like interaction
- **External APIs**: None direct; browser-based automation only
- **Docker**: Slim Node 20 image with Chromium deps; volume mount for data persistence

## Quality Validation
- **Semantic Checks**: Post-response validation against `task.spec.validation` (min length, forbidden terms)
- **Schema Enforcement**: All data through Zod parsers; corrupted tasks moved to `fila/corrupted/`
- **Forensics**: Automatic crash dumps with page screenshots on failures
- **Health Monitoring**: Heartbeat checks for infra stability; consecutive failure counters trigger cooldowns

## Common Pitfalls
- Avoid direct file writes; use `io.saveTask()` for atomic persistence
- Check `isLockOwnerAlive()` before breaking orphaned locks
- Handle `Target closed` errors as infra failures, not task errors
- Use absolute paths for file operations (e.g., `path.join(ROOT, 'fila')`)
- Test with `test-puppeteer.js` for browser connectivity before full runs</content>
<parameter name="filePath">/workspaces/chatgpt-docker-puppeteer/.github/copilot-instructions.md