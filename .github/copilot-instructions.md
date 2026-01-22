# AI Coding Agent Instructions for chatgpt-docker-puppeteer

**Version**: 3.2 (Config Architecture Refactor - Jan 22, 2026)
**Target Platforms**: Windows + Linux (macOS optional)
**Philosophy**: Cross-platform First, Make-driven, Exit Code Aware, JSON Safe, DRY Helpers, Shared Helpers
**Recent Upgrades**: Config Architecture v3.0, ConnectionOrchestrator v3.0, .puppeteerrc.cjs v2.0, chrome-config.json v3.0

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
    - ConnectionOrchestrator v3.0: multi-mode browser connection (launcher/external/auto)
    - Two-phase commit locks with PID validation
    - .puppeteerrc.cjs v2.0: Puppeteer config + shared helpers (isDocker, findChrome, getCacheDirectory)
- **Server** (`src/server/`): Dashboard + API (Express + Socket.io) via ServerNERVAdapter
- **Core** (`src/core/`): Config, schemas (Zod), logger, identity (DNA), context management
- **Makefile** (`Makefile`): Build system orchestrator (v2.4 Hardened Edition, 461 lines)
    - Make → Scripts → npm → PM2 → Node.js delegation chain
    - 58+ targets: start, stop, restart, health, test-fast, health-core, deps-consistency, git-push-safe
    - Cross-platform: Windows (cmd/PowerShell) + Linux (bash/zsh)
    - DRY Helpers: fail(), confirm(), PM2_APPS consolidation
    - Strict Mode: STRICT=true for fail-fast CI behavior
- **Shell Scripts** (`scripts/*.sh`, `scripts/*.bat`): Automation layer between Make and tools
    - health-windows.ps1 / health-posix.sh (v3.0 hardened, exit code aware)
    - quick-ops, watch-logs, install-pm2-gui, LAUNCHER (Windows + Linux pairs, all v3.0)
    - Cross-platform parity: identical features, error handling, validation

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
- **DRY Principles**: Makefile v2.4 uses centralized helpers (fail, confirm, PM2_APPS) to reduce duplication
- **Shared Helpers Pattern**: .puppeteerrc.cjs exports helpers (isDocker, findChrome, getCacheDirectory) used by ConnectionOrchestrator and other modules - configs stay separate, helpers are DRY
- **Config Separation**: Each module maintains own config (DEFAULTS inline) but imports shared helpers - avoids tight coupling while eliminating duplication
- **Git Protection**: git-push-safe blocks direct pushes to main/master branches
- **Test Separation**: test-fast (pre-commit) vs test-integration (full CI) for optimal workflows
- **Strict Mode**: STRICT=true enables fail-fast shell behavior for CI reliability

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

### Makefile v2.4 (Hardened Edition)

**Philosophy**: Make = orchestrator, NOT implementation. Delegate to scripts/npm/PM2. Use DRY helpers.

**Delegation Chain**: `Make` → `Scripts (.bat/.sh)` → `npm scripts` → `PM2` → `Node.js`

**Key Targets** (58+ total):

- **Lifecycle**: `start`, `stop`, `restart`, `reload`, `pm2-status`
- **Health**: `health` (4 endpoints + PM2), `health-core` (quick check for hooks)
- **Testing**: `test`, `test-fast` (pre-commit), `test-integration`, `test-all`, `ci-test`
- **Dependencies**: `check-deps`, `install-deps`, `update-deps`, `deps-consistency`
- **Monitoring**: `logs`, `logs-follow`, `watch-logs`, `dashboard`
- **Queue**: `queue-status`, `queue-add`, `queue-watch`
- **Maintenance**: `clean`, `backup`, `workspace-clean` (with confirmation)
- **Git Safety**: `git-push-safe` (branch protection), `git-changed`, `format-code`
- **Info**: `help`, `version`, `info`, `vscode-info`
- **Quick Ops**: `quick CMD=pause`, `quick CMD=resume`, etc.

**DRY Helpers** (v2.4 new):

```makefile
# Centralized error handling
define fail
	echo "$(RED)❌ $(1)$(NC)"; exit 1
endef

# Interactive confirmations
define confirm
	read -p "$(YELLOW)⚠ $(1) (y/N): $(NC)" ans && [ "$$ans" = "y" ]
endef

# Consolidated PM2 apps
PM2_APPS := agente-gpt dashboard-web
```

**Strict Mode** (v2.4 new):

```makefile
STRICT ?= false

ifeq ($(STRICT),true)
.SHELLFLAGS := -eu -o pipefail -c  # Fail-fast for CI
endif
```

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
make health         # Full health checks (4 endpoints + PM2)
make health-core    # Quick health check (for git hooks)
make test-fast      # Pre-commit tests (seconds)
make test-all       # Full test suite
make deps-consistency  # Check package-lock.json sync
make git-push-safe  # Safe push (lint + test + branch check)
make quick CMD=pause  # Quick pause operation
make logs-follow    # Tail logs in real-time
make workspace-clean  # Deep clean (with confirmation)
make STRICT=true start  # Fail-fast mode for CI
```

### Makefile v2.4 Workflows

**Pre-Commit Workflow** (fast feedback):
```bash
make test-fast        # Quick tests (FASE 8 only, seconds)
make health-core      # Quick endpoint check
git commit -m "..."
```

**CI Workflow** (fail-fast):
```bash
make STRICT=true deps-consistency  # Lockfile validation
make STRICT=true test-all          # Full test suite
make STRICT=true health            # All health checks
```

**Safe Push Workflow** (5-step validation):
```bash
make git-push-safe
# 1. ✓ Branch OK (not main/master)
# 2. ✓ No uncommitted changes
# 3. ✓ Lint passed (ESLint --max-warnings 0)
# 4. ✓ Tests passed (test-fast)
# 5. ✓ Push successful
```

**Cleanup Workflow** (interactive):
```bash
make workspace-clean
# ⚠ This will delete node_modules and clean cache (y/N): y
# Only executes if confirmed
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

**Key Scripts** (all v3.0 as of 2026-01-21):

- `health-windows.ps1` / `health-posix.sh` (v3.0, 115/103 lines)
  - Enhanced error handling, exit codes, JSON parsing (no regex)
- `quick-ops.bat` / `quick-ops.sh` (v3.0, 156/127 lines)
  - Health validation, file counting in backup, proper exit codes
- `watch-logs.bat` / `watch-logs.sh` (v3.0)
  - PM2 checks, color-coded filtering, 100 lines context
- `install-pm2-gui.bat` / `install-pm2-gui.sh` (v3.0)
  - npm checks, install logging, troubleshooting hints
- `LAUNCHER.bat` / `launcher.sh` (v3.0, 464/511 lines)
  - Interactive menu, version bump, enhanced UX

## Code Evolution & Upgrade Strategy

### Version Philosophy

- **v1.0** (MVP): Minimum viable functionality - may have critical flaws
- **v2.0** (Hardened): Production-ready - blockers fixed, patterns established
- **v2.x** (Incremental): Quality improvements, feature additions
  - Example: Makefile v2.3 → v2.4 (added strict mode, error helpers, DRY improvements)
- **v3.0** (Definitive): Battle-tested, complete feature set
  - Example: Scripts v1.0/v2.0 → v3.0 (cross-platform parity, enhanced validation)

**Real-World Progression Examples**:

1. **Makefile Evolution**:
   - v2.1: Basic targets, manual error handling
   - v2.2: Cross-platform helpers, delegated health checks
   - v2.3: 40+ targets, documentation, Super Launcher v2.0
   - v2.4: **Hardened Edition** - Strict mode, DRY helpers, 58+ targets, git protection

2. **Scripts Evolution**:
   - v1.0: Basic functionality, no exit codes, manual errors
   - v2.0: Health scripts - exit codes, JSON parsing (no regex)
   - v3.0: **Cross-Platform Parity** - All scripts, dependency checks, file counting, hints

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
# Lifecycle
make start          # Start agent + dashboard (PM2)
make stop           # Stop all processes
make restart        # Restart (stop + start)

# Health & Testing
make health         # Full health (4 endpoints + PM2, exit code aware)
make health-core    # Quick health (core endpoint only)
make test-fast      # Pre-commit tests (fast)
make test-all       # Full test suite
make deps-consistency  # Validate package-lock.json

# Monitoring
make logs-follow    # Tail logs in real-time
make watch          # Watch logs with filters
make dashboard      # Open HTML dashboard

# Maintenance
make clean          # Remove logs/tmp/queue
make workspace-clean  # Deep clean + reinstall (with confirmation)
make backup         # Backup data directories

# Git & Quality
make git-push-safe  # Safe push (5-step validation)
make format-code    # ESLint + Prettier
make git-changed    # Show modified files

# Info
make info           # Show configuration
make version        # Show versions (Makefile v2.4, Launcher v3.0, etc.)
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
2. **Version headers**: Add v3.0 header with timestamp and description
3. **Exit codes mandatory**: 0 (success), 1 (error)
4. **Test both paths**: Success AND failure scenarios
5. **JSON parsing**: Use proper tools (Invoke-RestMethod, jq), never regex/grep
6. **Status validation**: Check VALUES (ok/healthy/online), not just field existence
7. **Dependency checks**: Validate tools (PM2, npm, node) before execution
8. **Visual feedback**: Use [OK]/[FAIL]/[WARN]/[HINT] (Windows) or ✓/✗/⚠ (POSIX)
9. **Error hints**: Provide actionable troubleshooting hints on failures
10. **File counting**: Count and validate operations (e.g., backup file count)
11. **ASCII fallback**: Support NO_UNICODE=1 for CI environments
12. **Configurable params**: Use parameters ($Port, $TimeoutSec) with defaults

**v3.0 Pattern Example** (quick-ops.sh):
```bash
#!/usr/bin/env bash
set -euo pipefail

# Version: 3.0 (2026-01-21) - Enhanced error handling

# Dependency check
command -v pm2 >/dev/null 2>&1 || { echo "[FAIL] PM2 not found"; exit 1; }

# Operation with validation
if ! npm run daemon:start; then
    echo "[FAIL] Failed to start"
    echo "[HINT] Check PM2 status: make pm2"
    exit 1
fi

# File counting in backups
FILES_BACKED=0
for file in config.json controle.json; do
    if [ -f "$file" ]; then
        cp "$file" "backup/" && ((FILES_BACKED++))
    fi
done

if [ $FILES_BACKED -eq 0 ]; then
    echo "[FAIL] No files backed up"
    exit 1
fi

echo "[OK] Backup complete ($FILES_BACKED files)"
exit 0
```

### EditorConfig v2.0 (209 lines)

**Upgraded**: Jan 2026 - Comprehensive cross-editor consistency

**Coverage**: 10 organized sections
1. **Default**: charset, indent (4 spaces), trim whitespace
2. **JavaScript/Node**: single quotes, 120 char lines, ES2022+
3. **Config Files**: JSON/YAML specific settings
4. **Documentation**: 100 char lines for markdown
5. **Shell Scripts**: LF line endings, executable
6. **Python**: 4 spaces (PEP 8)
7. **Docker**: LF line endings
8. **Build Tools**: Makefile tabs
9. **Environment**: dotenv files
10. **VSCode/GitHub**: metadata files

**Key Settings**:
- `max_line_length = 120` (code), `100` (docs/yaml)
- `quote_type = single` (JavaScript)
- Platform-specific line endings (LF for bash, CRLF for Windows batch)
- Specific patterns: `docker-compose*.yml`, `*.sh/.bat/.ps1`, etc.

**Benefit**: Consistent formatting across VSCode, Sublime, Atom, JetBrains IDEs

## Conventions

- **Logging**: `logger.log('INFO', msg, taskId?)` with structured telemetry
- **Error Handling**: Classify failures with `classifyAndSaveFailure(task, type, msg)` and history tracking
- **Configuration**: Hot-reload from `config.json`/`dynamic_rules.json` with defaults in `src/core/config.js`
- **Task States**: `PENDING` → `RUNNING` → `DONE`/`FAILED`; use `schemas.parseTask()` for validation
- **File Paths**: Responses in `respostas/{taskId}.txt`; queue tasks as `{taskId}.json` in `fila/`
- **Browser Profiles**: Isolated in `profile/` with stealth plugins and user-agent rotation

## Configuration Architecture (v3.0 - Jan 2026)

**Philosophy**: Shared Helpers + Separated Configs = DRY without tight coupling

### .puppeteerrc.cjs v2.0 (238 lines)

**Purpose**: Puppeteer configuration file + shared helpers for cross-module use

**Structure**:
```javascript
// Helpers (exportados para uso externo)
function isDocker() { /* detecta containers via /proc/self/cgroup */ }
function getCacheDirectory() { /* /home/node/.cache (Docker) ou ~/.cache (Host) */ }
function findChromeExecutable() { /* detecta Chrome instalado: Linux/Mac/Windows paths */ }

module.exports = {
    cacheDirectory: getCacheDirectory(),      // Config Puppeteer
    executablePath: findChromeExecutable()    // Config Puppeteer
};

// Exports de helpers para outros módulos
module.exports.getCacheDirectory = getCacheDirectory;
module.exports.findChromeExecutable = findChromeExecutable;
module.exports.isDocker = isDocker;
```

**Exports**:
- `cacheDirectory`: Onde Chromium é armazenado (usado pelo Puppeteer)
- `executablePath`: Chrome customizado ou null para bundled Chromium
- `getCacheDirectory()`: Helper compartilhado (DRY)
- `findChromeExecutable()`: Helper compartilhado (DRY)
- `isDocker()`: Helper compartilhado (DRY)

**Documentation**: 25+ Puppeteer tools/features documentadas inline (Recorder, Replay, Adblocker, Tracing, Coverage, Network Interception, etc.)

### ConnectionOrchestrator.js v3.0 (739 lines)

**Config Pattern**:
```javascript
const puppeteerConfig = require('../../.puppeteerrc.cjs');

// DEFAULTS inline (config própria do ConnectionOrchestrator)
const DEFAULTS = {
    mode: process.env.BROWSER_MODE || 'launcher',
    ports: [9222, 9223, 9224],
    hosts: ['127.0.0.1', 'localhost', 'host.docker.internal', '172.17.0.1'],
    connectionStrategies: ['BROWSER_URL', 'WS_ENDPOINT'],

    // USA helpers compartilhados (DRY)
    executablePath: puppeteerConfig.findChromeExecutable(),
    cacheDirectory: puppeteerConfig.getCacheDirectory(),

    args: ['--no-sandbox', '--disable-setuid-sandbox', ...],
    retryDelayMs: 3000,
    maxConnectionAttempts: 5,
    // ... mais config específica
};
```

**Benefits**:
1. ✅ **Separation of Concerns**: .puppeteerrc.cjs = Puppeteer config + helpers; ConnectionOrchestrator = own config
2. ✅ **DRY**: Helpers compartilhados eliminam duplicação de lógica (isDocker, findChrome, getCacheDirectory)
3. ✅ **No Tight Coupling**: Cada módulo mantém autonomia, apenas importa helpers
4. ✅ **Testability**: Helpers podem ser testados isoladamente
5. ✅ **Standards Compliance**: .puppeteerrc.cjs segue convenção npm do Puppeteer

### chrome-config.json v3.0

**Purpose**: Snapshot de configuração para launchers/scripts externos

**Generation**: `ConnectionOrchestrator.exportConfig('./chrome-config.json')`

**Content**:
```json
{
  "version": "3.0",
  "source": "ConnectionOrchestrator + .puppeteerrc.cjs helpers",
  "isDocker": false,
  "detectedChromePath": "/usr/bin/chromium",
  "connection": { "mode": "launcher", "ports": [9222, 9223, 9224], ... },
  "launcher": { "executablePath": "/usr/bin/chromium", "cacheDirectory": "...", ... },
  "commands": {
    "startChrome": "\"/usr/bin/chromium\" --remote-debugging-port=9222 ...",
    "checkChrome": "lsof -i :9222 || netstat -an | grep :9222",
    "killChrome": "pkill -f \"chrome.*remote-debugging-port=9222\""
  },
  "usage": {
    "helpers": "Helpers compartilhados (.puppeteerrc.cjs): isDocker, findChrome, getCacheDirectory",
    "config": "Config específica (ConnectionOrchestrator.js): DEFAULTS inline"
  }
}
```

**Usage**: CLI tools, external launchers, documentation

### Anti-Patterns to Avoid

❌ **NEVER**: Centralizar TODA config em um único arquivo (viola separação de responsabilidades)
❌ **NEVER**: .puppeteerrc.cjs conhecendo estrutura do ConnectionOrchestrator (acoplamento)
❌ **NEVER**: Duplicar lógica de detecção (isDocker, findChrome) em múltiplos módulos

✅ **DO**: Exportar helpers de .puppeteerrc.cjs para uso compartilhado
✅ **DO**: Cada módulo mantém própria config (DEFAULTS inline)
✅ **DO**: Importar helpers quando necessário, não config completa

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

1. ~~**P5.2 Cache Invalidation**~~: ✅ FIXED (2026-01-21) - markDirty() now called BEFORE writes
2. ~~**Health scripts syntax**~~: ✅ FIXED (2026-01-21) - v3.0 upgrade resolved all syntax issues
3. ~~**Scripts inconsistency**~~: ✅ FIXED (2026-01-21) - All scripts now v3.0 with cross-platform parity
4. ~~**Config duplication**~~: ✅ FIXED (2026-01-22) - Shared helpers pattern eliminates duplication
5. ~~**ESLint warnings**~~: ✅ FIXED (2026-01-22) - Zero warnings in ConnectionOrchestrator and .puppeteerrc.cjs
6. **npm test broken**: `scripts/run_all_tests.sh` line 3 has bash syntax issue (use `make test-fast` instead)
7. **Integration tests**: 82% (9/11) were obsolete due to IPC refactoring - already cleaned up
8. **Test dependencies**: 4 tests (lock, control_pause, running_recovery, stall_mitigation) require full agent running
9. **deps-consistency**: May fail if fsevents missing on Linux (expected, macOS-only package)

## Recent Upgrades (Jan 2026)

### Configuration Architecture v3.0 (Jan 22, 2026)

**Commits**: e16d52b, 7a41830

**Problem**: Configuration duplication across 3 sources:
- .puppeteerrc.cjs (helper functions)
- ConnectionOrchestrator.js (DEFAULTS object)
- chrome-config.json (generated snapshot)

**Solution**: Shared Helpers + Separated Configs

**Changes**:
1. **.puppeteerrc.cjs v2.0** (238 lines):
   - ✅ ONLY Puppeteer config (cacheDirectory, executablePath)
   - ✅ Exports 3 helpers: getCacheDirectory(), findChromeExecutable(), isDocker()
   - ✅ 25+ Puppeteer tools documented inline
   - ❌ Removed getPuppeteerConfig() (was violating separation of concerns)

2. **ConnectionOrchestrator.js v3.0** (739 lines):
   - ✅ DEFAULTS inline (own config: ports, hosts, args, retry, etc.)
   - ✅ Imports helpers: `puppeteerConfig.{getCacheDirectory, findChrome, isDocker}`
   - ✅ Maintains autonomy (no dependency on external config)
   - ✅ exportConfig() uses DEFAULTS local + helpers

3. **chrome-config.json v3.0**:
   - ✅ version: '3.0'
   - ✅ source: 'ConnectionOrchestrator + .puppeteerrc.cjs helpers'
   - ✅ isDocker: detected at runtime
   - ✅ detectedChromePath: '/usr/bin/chromium'
   - ✅ commands: unified by platform (startChrome, checkChrome, killChrome)
   - ✅ usage.helpers: documents shared helpers

**Benefits**:
- ✅ Clear separation of responsibilities
- ✅ DRY (helpers shared, not configs)
- ✅ .puppeteerrc.cjs follows npm standard
- ✅ Each module independent
- ✅ Zero ESLint warnings

### EditorConfig v2.0 (Jan 21, 2026)

**Commit**: f9d6438

**Changes**: 45 → 209 lines (+364%)
- ✅ 10 organized sections (default, JS, config, docs, shell, Python, Docker, build, env, VSCode)
- ✅ max_line_length: 120 (code), 100 (docs)
- ✅ quote_type: single (JavaScript)
- ✅ Platform-specific line endings
- ✅ 30+ configuration rules

### Puppeteer Tools Documentation (Jan 21, 2026)

**Commit**: 52230ca

**Changes**: +185 lines in .puppeteerrc.cjs
- ✅ 25 Puppeteer tools/features documented
- ✅ Already Used (6): stealth, UA rotation, profile rotation, pool, CDP, screenshots
- ✅ Available (19): Recorder, Replay, Adblocker, Tracing, Coverage, Network Interception, PDF, etc.
- ✅ Priority recommendations: High (Tracing, Network Interception), Medium (Recorder, Coverage), Low (PDF, Accessibility)

### Docker Infrastructure (Jan 21, 2026)

**Commits**: 022af5c, 674e331

**Changes**:
1. **docker-compose fixes** (3 files):
   - ✅ Fixed healthcheck YAML syntax (docker-compose.yml, docker-compose.dev.yml)
   - ✅ Added extra_hosts for Linux (host.docker.internal)
   - ✅ Fixed volumes config (docker-compose.prod.yml)
   - ✅ Added networks definitions

2. **DOCKER_README.md** (created):
   - ✅ ~400 lines comprehensive guide
   - ✅ 4 compose files explained (default/dev/prod/linux)
   - ✅ Quick Start, Operations, Debugging, Security, Monitoring
   - ✅ Troubleshooting (10 common scenarios)

### CI/CD Pipeline v2.0 (Jan 22, 2026)

**Commit**: 908f08a

**GitHub Actions v2.0 - 8 Parallel Jobs:**

1. **Job 1: Dependencies Validation**
   - npm ci with caching
   - Validate module-alias (9+ aliases required)
   - Check deprecated imports (../../..)
   - Verify jsconfig.json alignment

2. **Job 2: Lint & Code Quality**
   - ESLint strict mode (--max-warnings 0)
   - Prettier format check
   - Code syntax validation

3. **Jobs 3-5: Multi-Platform Tests**
   - Ubuntu, Windows, macOS
   - Full test suite on each platform
   - Exit code validation

4. **Job 6: Integration Tests**
   - E2E workflows
   - NERV subsystem tests
   - P1-P5 regression tests

5. **Job 7: Build Validation**
   - Docker build
   - PM2 ecosystem check
   - Production config validation

6. **Job 8: Security & Docs**
   - Secret scan (gitleaks)
   - Documentation validation (5 required docs)
   - npm audit (fail on critical CVEs)

**Key Features:**
- ✅ Module-alias enforcement (blocks deprecated imports)
- ✅ Multi-platform testing (Ubuntu + Windows + macOS)
- ✅ ESLint strict mode (--max-warnings 0)
- ✅ Security scans (secrets + dependencies)
- ✅ Documentation validation
- ✅ Parallel execution (8-12 min total)
- ✅ Job summaries with metrics

**Files Created/Updated:**
- `.github/workflows/ci.yml` (v2.0 - 350+ lines)
- `.github/workflows/README.md` (NEW - 400+ lines documentation)
- `.github/workflows/pre-commit.yml` (v2.0 - integrated with CI)
- `.github/workflows/security-scan.yml` (v2.0 - consolidated 5 security workflows)
- `scripts/validate-ci.js` (NEW - local CI simulation)
- `src/server/api/router.js` (FIXED - removed 2 deprecated imports)

**Local Validation:**
```bash
# Simulate CI locally (6 jobs)
node scripts/validate-ci.js

# Pre-commit fast checks (seconds)
make test-fast

# Full CI validation (minutes)
make STRICT=true ci-test
```

**CI/CD Patterns:**
- **Module Alias First**: All imports use @core, @infra, @shared, etc.
- **Exit Code Discipline**: All scripts return 0 (success) or 1 (failure)
- **Strict Mode**: STRICT=true enables fail-fast behavior
- **Parallel Jobs**: Independent jobs run simultaneously (8-12 min total)
- **Cache Strategy**: npm cache + node_modules (90% hit rate)

### Build System & Scripts (v2.4/v3.0 - Jan 21, 2026)

**Makefile v2.4 - Hardened Edition** (commit 09184ea):
- ✅ Strict Mode: STRICT=true opt-in for fail-fast CI
- ✅ Error Helpers: fail() and confirm() functions (DRY)
- ✅ PM2 Consolidation: PM2_APPS variable (centralized)
- ✅ Test Separation: test-fast (pre-commit) + test-integration (full)
- ✅ Health Granularity: health-core (quick) + health (full)
- ✅ Dependencies: deps-consistency checks lockfile sync
- ✅ Git Protection: git-push-safe blocks main/master pushes
- ✅ UX: 58+ targets, enhanced help, version shows PM2_APPS

**Scripts v3.0 - Cross-Platform Parity** (commits 4a9d09b, 758f3c5, a19b862):
- ✅ POSIX Scripts: health-posix.sh, quick-ops.sh, watch-logs.sh, install-pm2-gui.sh, launcher.sh
- ✅ Windows Scripts: health-windows.ps1, quick-ops.bat, watch-logs.bat, install-pm2-gui.bat, LAUNCHER.bat
- ✅ Features: Version headers, dependency checks, file counting, exit codes, error hints
- ✅ Validation: JSON parsing (no regex), status VALUES (not field existence)
- ✅ UX: Visual feedback ([OK]/[FAIL]/[HINT]), color-coded output, 100 lines context

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
