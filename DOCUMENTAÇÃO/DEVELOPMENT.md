# 💻 Guia de Desenvolvimento

**Versão**: 1.0
**Última Atualização**: 21/01/2026
**Público-Alvo**: Desenvolvedores
**Tempo de Leitura**: ~30 min

---

## 📖 Visão Geral

Este documento detalha **como desenvolver** no projeto `chatgpt-docker-puppeteer`: setup local, Makefile, debugging, profiling, hot reload, e tarefas comuns.

---

## 🛠️ Setup Local

### 1. Pré-requisitos

**Obrigatório**:
- **Node.js**: ≥20.0.0 LTS ([Download](https://nodejs.org/))
- **npm**: ≥10.0.0 (incluído com Node.js)
- **Git**: ≥2.40.0 ([Download](https://git-scm.com/))
- **Chrome/Edge**: Browser instalado no sistema

**Opcional**:
- **PM2**: `npm install -g pm2` (process manager)
- **GNU Make**: Já disponível (Linux/macOS) ou via Git Bash (Windows)
- **VS Code**: Editor recomendado ([Download](https://code.visualstudio.com/))

---

### 2. Clone do Repositório

```bash
# Clone
git clone https://github.com/your-org/chatgpt-docker-puppeteer.git
cd chatgpt-docker-puppeteer

# Verify branch
git branch  # Should be on 'main'
```

---

### 3. Instalar Dependências

```bash
# Install
npm install

# Verify installation
node -v  # v20.11.0
npm -v   # 10.2.4
pm2 -v   # 5.3.0 (if installed)
```

**Dependências principais** (package.json):
- `puppeteer-extra` + `puppeteer-extra-plugin-stealth` (browser automation)
- `express` + `socket.io` (server + WebSocket)
- `zod` (schema validation)
- `winston` (structured logging)
- `p-limit` (concurrency control)

---

### 4. Criar Diretórios

```bash
# Create required directories
mkdir -p fila respostas logs tmp profile backups

# Verify
ls -la
# drwxr-xr-x  fila/
# drwxr-xr-x  respostas/
# drwxr-xr-x  logs/
```

---

### 5. Configuração .env

```bash
# Copy example
cp .env.example .env

# Edit .env
nano .env
```

**Desenvolvimento** (.env):
```bash
# Environment
NODE_ENV=development

# Browser (external mode for debugging)
BROWSER_MODE=external
EXTERNAL_BROWSER_PORT=9222

# Kernel
MAX_WORKERS=1
KERNEL_CYCLE_MS=50

# Security (no auth for local dev)
DASHBOARD_PASSWORD=

# Logging
LOG_LEVEL=DEBUG
LOG_TO_CONSOLE=true

# Dashboard
DASHBOARD_PORT=3008
```

---

### 6. Configurar External Browser

```bash
# Windows (cmd)
"C:\Program Files\Google\Chrome\Application\chrome.exe" ^
  --remote-debugging-port=9222 ^
  --user-data-dir="%USERPROFILE%\chrome-debug" ^
  --no-first-run ^
  --no-default-browser-check

# Linux/macOS (bash)
google-chrome \
  --remote-debugging-port=9222 \
  --user-data-dir=$HOME/chrome-debug \
  --no-first-run \
  --no-default-browser-check &
```

**Verificar conexão**:
```bash
curl http://localhost:9222/json/version
# {"Browser":"Chrome/120.0.6099.109", ...}
```

---

### 7. Iniciar Sistema

**Opção A: Dev Mode (Nodemon)**:
```bash
# Start with auto-reload
npm run dev

# Output:
# [BOOT] Starting Agent v1.0.0
# [NERV] Event Bus initialized
# [KERNEL] Kernel Loop started (20Hz / 50ms)
# [SERVER] Dashboard listening on http://localhost:3008
# [INFO] System ready - Waiting for tasks...
```

**Opção B: PM2 (Production-like)**:
```bash
# Start
make start  # ou npm run daemon:start

# Status
make pm2    # ou pm2 status

# Logs
make logs   # ou pm2 logs agente-gpt
```

---

### 8. Verificar Health

```bash
# Quick health
make health-core

# Full health (4 endpoints + PM2)
make health

# Manual check
curl http://localhost:3008/api/health
```

---

## 📁 Estrutura do Projeto

```
chatgpt-docker-puppeteer/
├── src/                      # Código-fonte (13 módulos)
│   ├── core/                 # Config, Logger, Schemas, DNA, Constants
│   ├── nerv/                 # Event Bus (emit, buffers, transport)
│   ├── kernel/               # Execution engine (loop, runtime, policy)
│   ├── driver/               # LLM automation (ChatGPT, Gemini)
│   ├── infra/                # Browser pool, locks, queue, storage
│   ├── server/               # API + Dashboard (Express + Socket.io)
│   └── logic/                # Collection, retries, adaptive delays
├── tests/                    # Test suite (14 functional tests)
│   ├── helpers.js            # Mocking utilities
│   ├── integration/          # Integration tests
│   └── test_*.js             # Individual test files
├── scripts/                  # Automation scripts (.bat + .sh)
│   ├── health-windows.ps1
│   ├── health-posix.sh
│   ├── quick-ops.{bat,sh}
│   └── watch-logs.{bat,sh}
├── fila/                     # Task queue (JSON files)
├── respostas/                # LLM responses (TXT files)
├── logs/                     # Application logs
├── profile/                  # Browser profiles
├── Makefile                  # Build orchestrator (v2.4, 58+ targets)
├── ecosystem.config.js       # PM2 configuration
├── config.json               # Main configuration
├── dynamic_rules.json        # LLM target rules
└── controle.json             # Agent DNA + state
```

---

## 🏗️ Makefile v2.4 (Hardened Edition)

### Categorias de Comandos (58+ targets)

#### Lifecycle
```bash
make start              # Start PM2 agent + dashboard
make stop               # Stop all processes
make restart            # Restart (stop + start)
make reload             # PM2 reload (zero-downtime)
make pm2-status         # PM2 status table
```

#### Health & Testing
```bash
make health             # Full health (4 endpoints + PM2)
make health-core        # Quick check (core endpoint only)
make test-fast          # Pre-commit tests (5min)
make test-integration   # Integration tests (15min)
make test-all           # Full test suite
make ci-test            # CI/CD mode (strict)
```

#### Monitoring
```bash
make logs               # PM2 logs (last 100 lines)
make logs-follow        # Tail logs in real-time
make watch-logs         # Filtered logs with colors
make pm2-monit          # PM2 interactive dashboard
make dashboard          # Open HTML dashboard
```

#### Queue Operations
```bash
make queue-status       # Show queue summary
make queue-add          # Add test task
make queue-watch        # Watch queue (live update)
```

#### Code Quality
```bash
make lint               # ESLint check (--max-warnings 0)
make format-code        # ESLint + Prettier (auto-fix)
make git-push-safe      # Safe push (5-step validation)
make git-changed        # Show modified files
```

#### Dependencies
```bash
make check-deps         # Verify tool availability
make install-deps       # npm install
make update-deps        # Check outdated packages
make deps-consistency   # Validate package-lock.json
```

#### Maintenance
```bash
make clean              # Remove logs/tmp/queue
make workspace-clean    # Deep clean (with confirmation)
make backup             # Backup data directories
make diagnose           # Full diagnostic report
```

#### Info
```bash
make help               # Show all targets
make version            # Show versions (Makefile, Launcher, Scripts)
make info               # Show configuration
make vscode-info        # Show VS Code tasks
```

---

### Strict Mode (CI/CD)

```bash
# Fail-fast mode for CI
make STRICT=true test-all
make STRICT=true deps-consistency
make STRICT=true health
```

**Efeito**: Shell flags `-eu -o pipefail` ativados → exit on error, undefined vars, pipe failures

---

### Quick Operations

```bash
# Quick pause
make quick CMD=pause

# Quick resume
make quick CMD=resume

# Quick backup
make quick CMD=backup

# Quick status
make quick CMD=status
```

---

## 🐛 Debugging

### 1. VS Code Launch Config

**Arquivo**: `.vscode/launch.json`

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "Attach to Node Process",
      "type": "node",
      "request": "attach",
      "port": 9229,
      "restart": true,
      "sourceMaps": true,
      "localRoot": "${workspaceFolder}",
      "remoteRoot": "${workspaceFolder}"
    },
    {
      "name": "Debug Current File",
      "type": "node",
      "request": "launch",
      "program": "${file}",
      "cwd": "${workspaceFolder}",
      "env": {
        "NODE_ENV": "development",
        "LOG_LEVEL": "DEBUG"
      }
    }
  ]
}
```

**Uso**:
1. Start com inspect: `node --inspect index.js`
2. VS Code: Run → Attach to Node Process
3. Set breakpoints (F9)
4. Inspect variables, call stack, watch expressions

---

### 2. Chrome DevTools (Browser Debugging)

**Connect**:
1. Browser aberto com `--remote-debugging-port=9222`
2. Abra Chrome: `chrome://inspect`
3. Click "Open dedicated DevTools for Node"
4. Navigate to `localhost:9222`

**Debugging**:
- **Console**: Execute JavaScript no contexto da page
- **Network**: Monitor requests (API calls, XHR)
- **Performance**: Record profile, analyze flame graph
- **Sources**: Set breakpoints em Puppeteer scripts

---

### 3. NERV Debugging (Event Tracing)

**Log all events**:
```bash
# .env
LOG_LEVEL=DEBUG

# Restart
make restart

# Watch logs
make watch-logs
```

**Filter by correlationId**:
```bash
grep "correlation-abc123" logs/agente-gpt-out.log
```

**Trace event chain**:
```javascript
const { correlation } = require('./src/nerv/correlation');

// Get all events in chain
const chain = correlation.getChain('correlation-abc123');
console.log(chain);
// [
//   { type: 'TASK_ALLOCATED', timestamp: 1234567890, ... },
//   { type: 'DRIVER_EXECUTE', timestamp: 1234567900, ... },
//   { type: 'TASK_DONE', timestamp: 1234568000, ... }
// ]
```

---

### 4. Task Debugging

**Check task state**:
```bash
# Via API
curl http://localhost:3008/api/task/task-abc123

# Via file
cat fila/task-abc123.json
```

**View logs for task**:
```bash
grep "task-abc123" logs/agente-gpt-out.log | tail -50
```

**Inspect response**:
```bash
cat respostas/task-abc123.txt
```

**Manual task execution**:
```javascript
// In VS Code Debug Console or Node REPL
const { executeTask } = require('./src/kernel/execution_engine');
const task = { id: 'test', target: 'chatgpt', prompt: 'Hello' };
await executeTask(task);
```

---

## 📊 Profiling

### 1. Node.js Built-in Profiler

```bash
# Start with profiling
node --prof index.js

# Run workload (add 100 tasks, wait 5min)

# Stop (Ctrl+C)

# Process profile
node --prof-process isolate-0x*.log > profile.txt

# Analyze profile.txt
less profile.txt
# [Summary]:
#   ticks  total  nonlib   name
#   1234   45.6%   50.2%  JavaScript
#   567    20.9%   23.4%  C++
#   ...
```

---

### 2. Clinic.js

```bash
# Install
npm install -g clinic

# Doctor (overview)
clinic doctor -- node index.js
# Run workload, stop with Ctrl+C
# Opens HTML report

# Flame graph (CPU profiling)
clinic flame -- node index.js

# Bubbleprof (async operations)
clinic bubbleprof -- node index.js
```

---

### 3. Chrome DevTools (Memory Profiling)

```bash
# Start with inspect
node --inspect index.js

# Chrome: chrome://inspect → Open DevTools

# Memory tab:
# 1. Take heap snapshot
# 2. Run workload
# 3. Take second snapshot
# 4. Compare snapshots (Comparison view)
# 5. Identify memory leaks (objects not GC'd)
```

**Common leaks**:
- Event listeners not removed (`nerv.off()`)
- Browser pages not closed (`page.close()`)
- Timers not cleared (`clearInterval()`)

---

### 4. Memory Monitoring (API)

```bash
# P9.1 Health Metrics endpoint
curl http://localhost:3008/api/health-metrics

# Response:
{
  "heap": {
    "used": 156789012,      # 156 MB
    "total": 268435456,     # 256 MB
    "limit": 536870912,     # 512 MB
    "usagePercent": 29.2
  },
  "gc": {
    "lastRun": "2026-01-21T10:30:45.123Z",
    "count": 15,
    "totalDuration": 450
  }
}
```

---

## 🔄 Hot Reload

### 1. Nodemon (Dev Mode)

**Config**: `nodemon.json`

```json
{
  "watch": ["src/", "config.json", "dynamic_rules.json"],
  "ignore": ["logs/", "fila/", "respostas/", "tmp/"],
  "ext": "js,json",
  "exec": "node index.js",
  "env": {
    "NODE_ENV": "development",
    "LOG_LEVEL": "DEBUG"
  }
}
```

**Uso**:
```bash
npm run dev
# [nodemon] starting `node index.js`
# [nodemon] watching: src/** config.json dynamic_rules.json
```

**On change**:
- Save file → Nodemon detecta → Restart automático

---

### 2. PM2 Watch Mode

**Config**: `ecosystem.config.js`

```javascript
module.exports = {
  apps: [{
    name: 'agente-gpt',
    script: './index.js',
    watch: true,
    watch_options: {
      followSymlinks: false,
      usePolling: false,
      interval: 1000,
      ignored: ['logs', 'fila', 'respostas', 'tmp']
    }
  }]
};
```

**Cuidado**: PM2 watch pode causar restart loops em diretórios com escrita frequente (logs/).

---

### 3. Config Hot-Reload (Runtime)

**API**:
```javascript
const CONFIG = require('./src/core/config');

// Reload config
CONFIG.reload();
// [INFO] Configuration reloaded from config.json

// Access updated value
console.log(CONFIG.maxWorkers);  // Novo valor
```

**Trigger via API**:
```bash
# Endpoint (futuro)
curl -X POST http://localhost:3008/api/config/reload \
  -H "Authorization: Bearer YOUR_TOKEN"
```

---

## 🔨 Tarefas Comuns

### 1. Adicionar Novo LLM Target

**Passo 1**: Criar Driver

```javascript
// src/driver/targets/claude.js
const BaseDriver = require('../base_driver');

class ClaudeDriver extends BaseDriver {
    constructor(opts) {
        super(opts);
        this.targetName = 'claude';
    }

    async execute(page, prompt) {
        // Navigate
        await page.goto('https://claude.ai/chats', { waitUntil: 'networkidle2' });

        // Type prompt
        const inputSelector = 'div[contenteditable="true"]';
        await page.waitForSelector(inputSelector, { timeout: 10000 });
        await page.type(inputSelector, prompt);

        // Submit
        await page.keyboard.press('Enter');

        // Collect response
        const responseSelector = '.message-content';
        await page.waitForSelector(responseSelector, { timeout: 60000 });
        const response = await page.evaluate((sel) => {
            return document.querySelector(sel)?.innerText || '';
        }, responseSelector);

        return response;
    }
}

module.exports = ClaudeDriver;
```

**Passo 2**: Registrar no Factory

```javascript
// src/driver/driver_factory.js
const ClaudeDriver = require('./targets/claude');

class DriverFactory {
    static createDriver(target, opts) {
        switch (target) {
            case 'chatgpt': return new ChatGPTDriver(opts);
            case 'gemini': return new GeminiDriver(opts);
            case 'claude': return new ClaudeDriver(opts);  // ← Add
            default: throw new Error(`Unknown target: ${target}`);
        }
    }
}
```

**Passo 3**: Adicionar em dynamic_rules.json

```json
{
  "targets": {
    "claude": {
      "url": "https://claude.ai/chats",
      "selectors": {
        "input": "div[contenteditable='true']",
        "submit": "button[type='submit']",
        "response": ".message-content"
      },
      "timeouts": {
        "navigation": 30000,
        "response": 120000
      }
    }
  }
}
```

**Passo 4**: Testar

```bash
# Add test task
make queue-add
# Target: claude
# Prompt: Hello Claude!

# Watch logs
make watch-logs

# Check response
ls -lh respostas/task-*.txt
```

---

### 2. Adicionar Novo Endpoint

**Passo 1**: Criar Route

```javascript
// src/server/routes/custom.js
const express = require('express');
const router = express.Router();
const logger = require('../../core/logger');

/**
 * GET /api/custom/status
 * Custom status endpoint
 */
router.get('/status', (req, res) => {
    logger.log('INFO', '[API] GET /api/custom/status');

    res.json({
        status: 'ok',
        customData: {
            foo: 'bar',
            timestamp: Date.now()
        }
    });
});

module.exports = router;
```

**Passo 2**: Registrar no Server

```javascript
// src/server/routes/index.js
const customRoutes = require('./custom');

function setupRoutes(app) {
    app.use('/api/queue', queueRoutes);
    app.use('/api/health', healthRoutes);
    app.use('/api/custom', customRoutes);  // ← Add
}
```

**Passo 3**: Testar

```bash
# Restart
make restart

# Test endpoint
curl http://localhost:3008/api/custom/status

# Response:
{
  "status": "ok",
  "customData": {
    "foo": "bar",
    "timestamp": 1737450000000
  }
}
```

**Passo 4**: Documentar

Atualizar [API_REFERENCE.md](API_REFERENCE.md):
```markdown
### GET /api/custom/status

**Descrição**: Retorna status customizado

**Autenticação**: Não requerida

**Response** (200 OK):
```json
{
  "status": "ok",
  "customData": { "foo": "bar", "timestamp": 1737450000 }
}
```
```

---

### 3. Debug Race Condition

**Cenário**: Task executando 2x simultaneamente (race condition)

**Diagnóstico**:

```bash
# Enable DEBUG logs
LOG_LEVEL=DEBUG make restart

# Watch for duplicate allocations
make watch-logs | grep "TASK_ALLOCATED"

# Check lock ownership
node -e "
const locks = require('./src/infra/lock_manager');
console.log(locks.listActiveLocks());
"
```

**Solução**:

```javascript
// src/kernel/task_runtime.js

// ✅ Optimistic locking (P5.1)
async function allocateTask(taskId, expectedState = 'PENDING') {
    const task = await io.getTask(taskId);

    // Race detection
    if (task.state !== expectedState) {
        logger.log('WARN', `[P5.1] Race detected: expected ${expectedState}, got ${task.state}`, taskId);
        return null;  // Abort allocation
    }

    // Atomic state transition
    task.state = 'RUNNING';
    task.allocatedAt = Date.now();
    await io.saveTask(task);

    return task;
}
```

**Validar fix**:
```bash
# Run test
node tests/test_p5_fixes.js

# Output:
# ✅ P5.1: Optimistic locking prevents race (10/10 attempts OK)
```

---

### 4. Add Performance Fix

**Cenário**: Queue scan lento (1200ms → 200ms)

**Profiling**:

```bash
# Profile before fix
clinic flame -- node index.js
# Hotspot: fs.readdirSync + JSON.parse in tight loop
```

**Fix** (P9.4 - Queue Cache):

```javascript
// src/infra/io.js

// Before (slow)
function scanQueue() {
    const files = fs.readdirSync(queueDir);
    const tasks = files.map(f => JSON.parse(fs.readFileSync(path.join(queueDir, f))));
    return tasks;
}

// After (fast) - Cache with invalidation
const queueCache = { tasks: null, lastScan: 0 };

function scanQueue() {
    const now = Date.now();
    if (queueCache.tasks && (now - queueCache.lastScan) < 5000) {
        return queueCache.tasks;  // Hit: 0.1ms
    }

    // Miss: Rebuild cache (200ms)
    const files = fs.readdirSync(queueDir);
    const tasks = files.map(f => JSON.parse(fs.readFileSync(path.join(queueDir, f))));

    queueCache.tasks = tasks;
    queueCache.lastScan = now;
    return tasks;
}

// Invalidate on write
function markDirty() {
    queueCache.tasks = null;  // Force next scan to rebuild
}
```

**Test**:
```bash
node tests/test_p9_fixes.js

# ✅ P9.4: Queue cache reduces scan time (1200ms → 200ms)
```

**Document**:
Atualizar `AUDITORIA_STATUS_ATUAL.md`:
```markdown
| P9.4 | Queue Cache | ... | ✅ FIXED | Added 5s cache with markDirty() invalidation |
```

---

## 🔗 Integração com IDEs

### VS Code Extensions (Recomendado)

```json
// .vscode/extensions.json
{
  "recommendations": [
    "dbaeumer.vscode-eslint",
    "esbenp.prettier-vscode",
    "ms-vscode.vscode-typescript-next",
    "christian-kohler.path-intellisense",
    "formulahendry.code-runner",
    "eamodio.gitlens"
  ]
}
```

### ESLint v9 (Flat Config)

**Config**: `eslint.config.mjs`

```javascript
export default [
    {
        languageOptions: {
            ecmaVersion: 2024,
            sourceType: 'module'
        },
        rules: {
            'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
            'no-console': 'warn',
            'prefer-const': 'error'
        }
    }
];
```

**Uso**:
```bash
# Check
make lint

# Fix
make format-code
```

---

### Prettier

**Config**: `.prettierrc`

```json
{
  "singleQuote": true,
  "trailingComma": "es5",
  "tabWidth": 4,
  "printWidth": 120,
  "semi": true
}
```

**VS Code** (auto-format on save):
```json
// .vscode/settings.json
{
  "editor.formatOnSave": true,
  "editor.defaultFormatter": "esbenp.prettier-vscode"
}
```

---

## 📚 Referências

- [CONFIGURATION.md](CONFIGURATION.md) - Parâmetros de configuração
- [API_REFERENCE.md](API_REFERENCE.md) - Endpoints REST + WebSocket
- [TESTING.md](TESTING.md) - Estratégia de testes
- [ARCHITECTURE_v2.md](ARCHITECTURE_v2.md) - Arquitetura NERV
- [SUBSYSTEMS.md](SUBSYSTEMS.md) - Componentes detalhados
- [PATTERNS.md](PATTERNS.md) - Padrões arquiteturais

---

*Última revisão: 21/01/2026 | Contribuidores: AI Architect, Dev Team*
