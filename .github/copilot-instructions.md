# AI Coding Agent Instructions for chatgpt-docker-puppeteer

## Architecture Overview

This is a domain-driven autonomous agent using Puppeteer for browser automation with AI chatbots (ChatGPT, Gemini). **NERV-centric architecture** with event-driven decoupling.

### Core Components (13 modules)

- **NERV** (`src/nerv/`): Central event bus for IPC - ALL components communicate through NERV (zero direct coupling)
    - Buffers, correlation, emission, reception, transport, telemetry, health checks
- **Kernel** (`src/kernel/`): Task execution engine with policy decisions, runtime lifecycle, state management
    - execution_engine, kernel_loop, nerv_bridge, task_runtime, policy_engine, observation_store
- **Driver** (`src/driver/`): Target-specific automation (ChatGPT, Gemini) via factory pattern
    - DriverNERVAdapter connects drivers to NERV (no direct KERNEL/SERVER access)
- **Infra** (`src/infra/`): Browser pool, locks, queue, storage (tasks/responses/DNA)
    - ConnectionOrchestrator: multi-mode browser connection (launcher/external/auto)
    - Two-phase commit locks with PID validation
- **Server** (`src/server/`): Dashboard + API (Express + Socket.io) via ServerNERVAdapter
- **Core** (`src/core/`): Config, schemas (Zod), logger, identity (DNA), context management

## Key Patterns

- **NERV-First Communication**: All cross-component communication via NERV events (e.g., `DRIVER_EXECUTE`, `TASK_STATE_CHANGE`)
- **Audit Levels**: Code annotated with audit levels (e.g., `Audit Level: 32`) indicating reliability tiers
- **Scoped Locking**: Use `io.acquireLock(taskId, target)` with PID validation to prevent zombie processes
- **Incremental Collection**: Responses gathered in chunks with anti-loop heuristics (hash comparison, punctuation detection)
- **Memory Management**: Manual GC (`global.gc()`) and WeakMap caching for browser instances
- **Reactive State**: File watchers invalidate caches instantly (e.g., queue changes trigger re-scan)
- **Sanitization**: Remove control characters from prompts to prevent browser protocol breaks
- **Backoff Strategy**: Exponential jitter for failures (task/infra separate counters)
- **Optimistic Locking**: Kernel uses expectedState for race detection in concurrent task updates (P5.1 fix)
- **Cache Invalidation**: ALWAYS call `markDirty()` BEFORE write operations in io.js (P5.2 known bug - needs fix)

## Developer Workflows

- **Local Dev**: `npm run dev` (nodemon, ignores data dirs)
- **Production**: `npm run daemon:start` (PM2 with memory limits, auto-restart)
- **Queue Ops**: `npm run queue:status -- --watch` for live monitoring; `npm run queue:add` for task creation
- **Testing**: `npm test` runs all tests (⚠️ known issue: bash syntax error in run_all_tests.sh - use individual tests)
    - Test files in `tests/` (14 functional tests maintained, 11 obsolete deleted Jan 2026)
    - Use `tests/helpers.js` for agent lifecycle mocking
    - Run individual tests: `node tests/test_<name>.js`
    - Key test suites: config_validation, driver_nerv_integration, p1-p5_fixes, boot_sequence, browser_pool
- **Code Quality**:
    - ESLint v9 (flat config) runs on type (`eslint.run: onType`) with auto-fix on save
    - Prettier formats on save (single quotes, 4 spaces, 120 char lines)
    - `npm run lint` / `npm run format` for manual checks
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

## Constants Usage Patterns

- **Always import from** `src/core/constants/`:
  ```javascript
  const { STATUS_VALUES, TASK_STATES } = require('../core/constants/tasks');
  const { CONNECTION_MODES, BROWSER_STATES } = require('../core/constants/browser');
  const { LOG_CATEGORIES } = require('../core/constants/logging');
  ```
- **Never use magic strings** for:
  - Task status values → Use `STATUS_VALUES.PENDING`, `STATUS_VALUES.RUNNING`, etc.
  - Connection modes → Use `CONNECTION_MODES.HYBRID`, `CONNECTION_MODES.LAUNCHER`, etc.
  - Log categories → Use `LOG_CATEGORIES.TASK_LIFECYCLE`, `LOG_CATEGORIES.BROWSER_CONNECT`, etc.
- **Use *_ARRAY variants** for Zod enum validation:
  ```javascript
  const { STATUS_VALUES_ARRAY } = require('../core/constants/tasks');
  const statusSchema = z.enum(STATUS_VALUES_ARRAY); // ['PENDING', 'RUNNING', ...]
  ```
- **Automated migration**: Run `scripts/apply-all-codemods.sh` to transform magic strings
- **Import paths**: Codemods auto-calculate relative paths using `path.relative()`

## Common Pitfalls

- Avoid direct file writes; use `io.saveTask()` for atomic persistence
- Check `isLockOwnerAlive()` before breaking orphaned locks
- Handle `Target closed` errors as infra failures, not task errors
- Use absolute paths for file operations (e.g., `path.join(ROOT, 'fila')`)
- Test with `test-puppeteer.js` for browser connectivity before full runs
- **Never import STATES from ConnectionOrchestrator** without using it (triggers ESLint no-unused-vars)
- **P5.2 Bug**: markDirty() must be called BEFORE saveTask/deleteTask in io.js (cache invalidation order)
- **Browser Pool**: Always use launcher mode in tests unless external Chrome is confirmed available
- **Constants First**: Always use typed constants from `src/core/constants/` instead of magic strings

## Known Issues (as of Jan 2026)

1. **P5.2 Cache Invalidation**: `src/infra/io.js` - markDirty() called after writes (should be before)
2. **npm test broken**: `scripts/run_all_tests.sh` line 3 has bash syntax issue (`set -euo pipefail`)
3. **Integration tests**: 82% (9/11) were obsolete due to IPC refactoring - already cleaned up
4. **Test dependencies**: 4 tests (lock, control_pause, running_recovery, stall_mitigation) require full agent running

## Testing Strategy

- **Unit Tests**: Mock components, no I/O (e.g., test_config_validation, test_driver_nerv_integration)
- **Integration Tests**: `tests/integration/` contains only identity_lifecycle (others deleted)
- **Regression Tests**: P1-P5 fixes validated (23 assertions covering locks, shutdown, timeouts, observers)
- **E2E Tests**: test_ariadne_thread, test_boot_sequence, test_integration_complete
- **Coverage**: 78% after cleanup (14/19 tests pass, 5 need refactoring)</content>
  <parameter name="filePath">/workspaces/chatgpt-docker-puppeteer/.github/copilot-instructions.md
