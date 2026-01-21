# AI Coding Agent Instructions for chatgpt-docker-puppeteer

**Version**: 3.0 (Radical Upgrade - Jan 21, 2026)
**Target Platforms**: Windows + Linux (macOS optional)
**Philosophy**: Cross-platform First, Make-driven, Exit Code Aware, JSON Safe

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
- **Makefile** (`Makefile`): Build system orchestrator (v2.3 Definitive Edition, 391 lines)
    - Make → Scripts → npm → PM2 → Node.js delegation chain
    - 40+ targets: start, stop, restart, health, test, logs, clean, backup
    - Cross-platform: Windows (cmd/PowerShell) + Linux (bash)
- **Shell Scripts** (`scripts/*.sh`, `scripts/*.bat`): Automation layer between Make and tools
    - health-windows.ps1 / health-posix.sh (v2.0 hardened, exit code aware)
    - quick-ops, watch-logs, install-pm2-gui (Windows + Linux pairs)

## Key Patterns

- **NERV-First Communication**: All cross-component communication via NERV events (e.g., `DRIVER_EXECUTE`, `TASK_STATE_CHANGE`)
- **Audit Levels**: Code annotated with audit levels (e.g., `Audit Level: 32`) indicating reliability tiers
- **Scoped Locking**: Use `io.acquireLock(taskId, target)` with PID validation to prevent zombie processes
- **Incremental Collection**: Responses gathered in chunks with anti-loop heuristics (hash comparison, punctuation detection)
- **Memory Management**: Manual GC (`global.gc()`) and WeakMap caching for browser instances
- **Reactive State**: File watchers invalidate caches instantly with 100ms debounce (e.g., queue changes trigger re-scan)
- **Sanitization**: Remove control characters from prompts to prevent browser protocol breaks
- **Backoff Strategy**: Exponential jitter for failures (task/infra separate counters)
- **Optimistic Locking**: Kernel uses expectedState for race detection in concurrent task updates (P5.1 fix)
- **Cache Invalidation**: ✅ markDirty() called BEFORE write operations in io.js (P5.2 fixed 2026-01-21)
- **Health Checks**: Browser pool detects both crashes AND degradation (>5s response time)
- **Orphan Recovery**: UUID-based recovery locks prevent race conditions between multiple instances

## Cross-Platform First Principle

**MANDATORY**: All components must support **Windows + Linux** (macOS optional but encouraged).

### Platform-Specific Patterns

- **Command existence checks**:
    - Windows cmd: `where <command>`
    - POSIX (Linux/macOS): `command -v <command>`
    - Makefile: Auto-detect OS and use appropriate command
- **Shell scripting**:
    - Windows: PowerShell (`.ps1`) or Batch (`.bat`)
    - Linux: Bash (`.sh`) with `#!/usr/bin/env bash` shebang
    - Always create BOTH versions for automation scripts
- **Path handling**:
    - Use forward slashes `/` in config (works on both)
    - Node.js `path.join()` handles OS differences
    - Makefile: Use platform-specific separators when needed
- **Exit codes**:
    - Windows cmd: `exit /b 0` (success), `exit /b 1` (error)
    - PowerShell: `exit $exitCode`
    - Bash: `exit 0` or `exit 1`
    - All scripts MUST propagate exit codes for CI/CD

### Cross-Platform Checklist

When creating/modifying scripts or build targets:

- [ ] Tested on Windows (cmd, PowerShell, Git Bash)
- [ ] Tested on Linux (bash)
- [ ] Proper exit codes (0 = success, 1 = error)
- [ ] No platform-specific commands without fallback
- [ ] Documentation mentions both platforms
- [ ] Makefile target works on both platforms

Reference: See [CROSS_PLATFORM_SUPPORT.md](../CROSS_PLATFORM_SUPPORT.md) for complete policy (285 lines).

## Build System & Automation

### Makefile v2.3 (Definitive Edition)

**Philosophy**: Make = orchestrator, NOT implementation. Delegate to scripts/npm/PM2.

**Delegation Chain**: `Make` → `Scripts (.bat/.sh)` → `npm scripts` → `PM2` → `Node.js`

**Key Targets** (40+ total):

- **Lifecycle**: `start`, `stop`, `restart`, `reload`, `pm2-status`
- **Health**: `health` (checks 4 endpoints + PM2 status, validates exit codes)
- **Testing**: `test`, `test-all`, `ci-test`
- **Monitoring**: `logs`, `logs-follow`, `watch-logs`, `dashboard`
- **Queue**: `queue-status`, `queue-add`, `queue-watch`
- **Maintenance**: `clean`, `backup`, `reset`
- **Info**: `help`, `version`, `info`, `check-deps`
- **Quick Ops**: `quick CMD=pause`, `quick CMD=resume`, etc.

**Cross-Platform Helpers**:

```make
# Platform detection
ifeq ($(OS),Windows_NT)
    DETECTED_OS := Windows
else
    DETECTED_OS := $(shell uname -s)
endif

# run_script helper - handles .bat vs .sh
run_script = $(if $(filter Windows,$(DETECTED_OS)),cmd /C "$(1).bat",bash "$(1).sh")

# sleep_cmd helper
sleep_cmd = $(if $(filter Windows,$(DETECTED_OS)),timeout /t $(1) /nobreak > nul,sleep $(1))

# open_cmd helper (browser)
open_cmd = $(if $(filter Windows,$(DETECTED_OS)),start "" $(1),...)
```

**Usage Examples**:

```bash
make start          # Start PM2 agent + dashboard
make health         # Health checks (exit 0 or 1)
make test-all       # Run all tests
make quick CMD=pause  # Quick pause operation
make logs-follow    # Tail logs in real-time
make clean          # Remove logs/tmp/queue
```

### Shell Scripts

All automation scripts follow patterns:

**Bash (.sh)**:

```bash
#!/usr/bin/env bash
set -euo pipefail  # Strict mode: exit on error, undefined vars, pipe failures

# Exit code tracking
exit_code=0

# Main logic
if ! some_command; then
    echo "[FAIL] Command failed"
    exit_code=1
fi

# Always exit with proper code
exit "$exit_code"
```

**PowerShell (.ps1)**:

```powershell
param(
    [int]$Port = 2998,
    [int]$TimeoutSec = 2
)

$exitCode = 0

try {
    # Main logic
    $response = Invoke-RestMethod -Uri "http://localhost:$Port/health" -TimeoutSec $TimeoutSec
    if ($response.status -notin @('ok', 'healthy', 'online')) {
        $exitCode = 1
    }
} catch {
    $exitCode = 1
}

exit $exitCode
```

**Key Scripts**:

- `health-windows.ps1` / `health-posix.sh` (v2.0, 104/100 lines)
- `quick-ops.bat` / `quick-ops.sh`
- `watch-logs.bat` / `watch-logs.sh`
- `install-pm2-gui.bat` / `install-pm2-gui.sh`

## Code Evolution & Upgrade Strategy

### Version Philosophy

- **v1.0** (MVP): Minimum viable functionality - may have critical flaws
- **v2.0** (Hardened): Production-ready - blockers fixed, patterns established
- **v2.x** (Incremental): Quality improvements, feature additions
- **v3.0** (Definitive): Battle-tested, complete feature set

### When to Upgrade (Not Just Patch)

Upgrade to v2.0+ when code has:

- **Exit codes missing** 🔴 BLOCKER - breaks CI/CD, masks failures
- **Regex/grep in JSON** 🔴 ANTI-PATTERN - fragile, false positives
- **Magic strings** 🟡 MAINTAINABILITY - use constants from `src/core/constants/`
- **No error propagation** 🔴 CI/CD BROKEN - scripts always exit 0
- **Platform-specific without fallback** 🟡 LIMITED - Windows-only or Linux-only code
- **Complex logic in Makefile** 🟡 MAINTAINABILITY - should delegate to scripts

### Red Flags Checklist

Before accepting any code (yours or from proposals):

- [ ] **Exit codes**: Script returns 0 (success) AND 1 (error) in appropriate paths?
- [ ] **JSON parsing**: Using proper tools (Invoke-RestMethod, jq), NOT regex/grep?
- [ ] **Status validation**: Checking actual VALUES (ok/healthy/online), not just field existence?
- [ ] **Cross-platform**: Works on Windows AND Linux?
- [ ] **Constants**: Using typed constants from `src/core/constants/`, not magic strings?
- [ ] **Delegation**: Complex logic in scripts/Node.js, not Makefile?
- [ ] **Error handling**: Failures propagate correctly?
- [ ] **Hardcoded values**: Configurable ports/paths/timeouts?

### Analysis Framework

When comparing v1 vs v2 proposals:

**1. Identify Current State**

- Version: v1.0, v1.5, etc.
- Lines: Current file size
- Features: What it does
- Blockers: Critical issues (exit codes, JSON regex, etc.)

**2. Identify Proposed State**

- Version: v2.0, v2.1, etc.
- Changes: What's different
- Improvements: What's better
- Trade-offs: What's worse or more complex

**3. Score Both Versions** (0-10 each category, total /80):

- Exit code tracking
- JSON parsing robustness
- Status validation
- CI/CD compatibility
- Simplicity
- Robustness (error handling)
- False positive prevention
- Maintainability

**4. Impact Analysis**:

- 🔴 HIGH/CRITICAL: Blockers, CI/CD breaks, data loss risks
- 🟡 MEDIUM: Quality issues, maintainability, false positives
- 🟢 LOW: Minor improvements, style, performance

**5. Decision**:

- Blockers present? → **Upgrade to v2.0+**
- Anti-patterns? → **Upgrade to v2.0+**
- Minor improvements only? → **Patch to v1.x**
- Philosophy shift? → **Major version (v3.0+)**

**Example Decision Matrix**:

```
v1.0 Health Script: 33/80 (3 blockers: exit 0 always, regex JSON, no validation)
v2.0 Health Script: 74/80 (all blockers fixed, proper parsing, exit codes)
→ Decision: UPGRADE to v2.0 (blockers justify breaking changes)
```

## Developer Workflows

### Make-First Approach (Preferred)

Use Makefile targets for all operations:

```bash
make start          # Start agent + dashboard (PM2)
make stop           # Stop all processes
make restart        # Restart (stop + start)
make health         # Health check (4 endpoints + PM2, exit code aware)
make test-all       # Run all tests
make logs-follow    # Tail logs
make clean          # Remove logs/tmp/queue
make backup         # Backup data directories
make info           # Show configuration
make check-deps     # Verify tool availability
```

### npm Scripts (Fallback)

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

### Script Development Guidelines

When creating new automation scripts:

1. **Create both .bat and .sh** (Windows + Linux support)
2. **Exit codes mandatory**: 0 (success), 1 (error)
3. **Test both paths**: Success AND failure scenarios
4. **JSON parsing**: Use proper tools (Invoke-RestMethod, jq), never regex/grep
5. **Status validation**: Check VALUES (ok/healthy/online), not just field existence
6. **ASCII fallback**: Support NO_UNICODE=1 for CI environments
7. **Configurable params**: Use parameters ($Port, $TimeoutSec) with defaults

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

### Exit Code Validation

- **All scripts MUST return 0 (success) or 1 (error)** for CI/CD compatibility
- **CI/CD commands MAY use `|| true`** for tolerance (e.g., `pm2 stop || true`)
- **Health checks MUST propagate failures** (exit 1 when service degraded/offline)
- **Test both paths**: Success (exit 0) AND failure (exit 1) scenarios
- **Mock failures**: Test with server offline, PM2 down, network errors

### JSON Parsing Validation

- **NEVER use regex/grep for JSON** - fragile, false positives, breaks on formatting
- **PowerShell**: Use `Invoke-RestMethod` (auto-parses JSON)
- **Bash**: Use `jq` (preferred), `awk` (fallback), never `grep`
- **Validate VALUES, not just field existence**:
    - ❌ Bad: `if ($response -match '"status"')` (matches ANY JSON with "status" field)
    - ✅ Good: `if ($response.status -in @('ok', 'healthy', 'online'))` (validates actual value)
- **Status whitelisting**: Only accept known-good values (ok, healthy, online, true)

### Cross-Platform Validation

- **Test on Windows AND Linux** before merging (macOS optional)
- **Validate .bat AND .sh versions** of scripts behave identically
- **Check platform-specific commands**:
    - Windows: `where` (not `command -v`)
    - Linux: `command -v` (not `which`)
- **Verify exit codes** on both platforms (some commands differ)

## Constants Usage Patterns

- **Always import from** `src/core/constants/`:
    ```javascript
    const { STATUS_VALUES, TASK_STATES } = require('../core/constants/tasks');
    const { CONNECTION_MODES, BROWSER_STATES } = require('../core/constants/browser');
    // Note: LOG_CATEGORIES is documentation-only, not imported
    ```
- **Never use magic strings** for:
    - Task status values → Use `STATUS_VALUES.PENDING`, `STATUS_VALUES.RUNNING`, etc.
    - Connection modes → Use `CONNECTION_MODES.HYBRID`, `CONNECTION_MODES.LAUNCHER`, etc.
    - Log levels → Use severity levels directly: `log('INFO', msg)`, `log('ERROR', msg)`
    - **LOG_CATEGORIES**: Documentation reference only; not used as runtime constants
- **Use \*\_ARRAY variants** for Zod enum validation:
    ```javascript
    const { STATUS_VALUES_ARRAY } = require('../core/constants/tasks');
    const statusSchema = z.enum(STATUS_VALUES_ARRAY); // ['PENDING', 'RUNNING', ...]
    ```
- **Logging pattern**: Use severity levels + descriptive tags in messages:
    ```javascript
    const { log } = require('./core/logger');
    log('INFO', '[BOOT] System starting...'); // ✓ Correct
    log('ERROR', '[LIFECYCLE] Task failed'); // ✓ Correct
    log(LOG_CATEGORIES.BOOT, 'Message'); // ✗ Not used in this codebase
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
- **Browser Pool**: Always use launcher mode in tests unless external Chrome is confirmed available
- **Constants First**: Always use typed constants from `src/core/constants/` instead of magic strings
- **File Watcher**: 100ms debounce prevents multiple events from same file change

### JSON Parsing Pitfalls

- **❌ NEVER**: `if ($response -match '"status"')` (PowerShell regex on JSON)
- **❌ NEVER**: `curl | grep -q '"status"'` (bash grep on JSON)
- **❌ NEVER**: `echo $json | awk '/status/'` (pattern matching instead of parsing)
- **✅ USE**: `Invoke-RestMethod` (PowerShell) - auto-parses, returns object
- **✅ USE**: `jq -r '.status'` (bash) - proper JSON parser
- **✅ USE**: `awk -F'"' '/"status"/{print $4}'` (bash fallback when jq unavailable)
- **✅ VALIDATE**: Values (`ok`/`healthy`/`online`), not just field existence

### Exit Code Pitfalls

- **❌ NEVER**: Script without exit codes (masks all failures)
- **❌ NEVER**: Always `exit 0` (CI/CD sees success even on failure)
- **❌ NEVER**: Ignore command failures (`command` without checking `$?`)
- **✅ USE**: `exit $exitCode` where `$exitCode` is 0 or 1
- **✅ USE**: `|| true` for CI/CD tolerance (when appropriate, document why)
- **✅ USE**: `set -e` (bash) to exit on any command failure
- **✅ TEST**: Both success (exit 0) and failure (exit 1) paths

### Cross-Platform Pitfalls

- **❌ NEVER**: `command -v <tool>` on Windows cmd (command doesn't exist)
- **❌ NEVER**: Single `.sh` script without `.bat` version
- **❌ NEVER**: Hardcode `\` or `/` in paths (use `path.join()` in Node.js)
- **❌ NEVER**: Assume bash (Windows may have cmd, PowerShell, Git Bash)
- **✅ USE**: `where <tool>` (Windows), `command -v <tool>` (Linux)
- **✅ CREATE**: Both `.bat` and `.sh` versions for all scripts
- **✅ TEST**: On Windows cmd, PowerShell, Git Bash, Linux bash

## Known Issues (as of Jan 2026)

1. ~~**P5.2 Cache Invalidation**~~: ✅ CORRIGIDO (2026-01-21) - markDirty() agora é chamado ANTES dos writes
2. **npm test broken**: `scripts/run_all_tests.sh` line 3 has bash syntax issue (`set -euo pipefail`)
3. **Integration tests**: 82% (9/11) were obsolete due to IPC refactoring - already cleaned up
4. **Test dependencies**: 4 tests (lock, control_pause, running_recovery, stall_mitigation) require full agent running

## Recent Corrections (Jan 2026)

### NERV Subsystem (P1+P2+P3 - 13 corrections - ~30 hours)

- ✅ Envelope canonicalization (KernelNERVBridge, DriverNERVAdapter, ServerNERVAdapter)
- ✅ Identity validation complete
- ✅ MessageType enum consolidation
- ✅ ActionCode constants migration
- ✅ Correlation ID propagation
- ✅ NERV injection in main.js (forensics + infra_failure_policy)

### INFRA Subsystem (P3 corrections - 3 corrections - ~5 hours)

- ✅ P5.2 Cache Invalidation: markDirty() BEFORE writes (io.js)
- ✅ File Watcher Debounce: 100ms debounce (fs_watcher.js)
- ✅ Health Checks: Timing-based degradation detection (pool_manager.js)
- ✅ Orphan Recovery: UUID-based race-safe recovery (lock_manager.js)

## Testing Strategy

- **Unit Tests**: Mock components, no I/O (e.g., test_config_validation, test_driver_nerv_integration)
- **Integration Tests**: `tests/integration/` contains only identity_lifecycle (others deleted)
- **Regression Tests**: P1-P5 fixes validated (23 assertions covering locks, shutdown, timeouts, observers)
- **E2E Tests**: test_ariadne_thread, test_boot_sequence, test_integration_complete
- **Coverage**: 78% after cleanup (14/19 tests pass, 5 need refactoring)</content>
  <parameter name="filePath">/workspaces/chatgpt-docker-puppeteer/.github/copilot-instructions.md
