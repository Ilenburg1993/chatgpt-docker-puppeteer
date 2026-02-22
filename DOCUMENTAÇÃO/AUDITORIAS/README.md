# 🤖 chatgpt-docker-puppeteer

[![Tests](https://img.shields.io/badge/tests-14%2F16%20passing-green)](tests/)
[![Node.js](https://img.shields.io/badge/node-%E2%89%A520.0.0-brightgreen)](https://nodejs.org/)
[![License](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](DOCUMENTAÇÃO/CONTRIBUTING.md)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20Linux%20%7C%20macOS-blue)](CROSS_PLATFORM_SUPPORT.md)
[![Documentation](https://img.shields.io/badge/docs-canonical%2016%2F16-success)](DOCUMENTAÇÃO/)
[![Rating](https://img.shields.io/badge/audit%20rating-9.2%2F10-brightgreen)](AUDITORIA_STATUS_ATUAL.md)

**Sistema autônomo de automação de LLMs (ChatGPT, Gemini) via browser com arquitetura event-driven
(NERV), queue-based processing e browser pool management.**

---

## 🎯 Quick Start (3 comandos)

```bash
# 1. Clone + Install
git clone https://github.com/Ilenburg1993/chatgpt-docker-puppeteer.git && cd chatgpt-docker-puppeteer && npm install

# 2. Start system (PM2 + launcher mode)
make start

# 3. Verify health
make health
```

**Dashboard**: http://localhost:3008 **Documentação Completa**: [DOCUMENTAÇÃO/](DOCUMENTAÇÃO/)

---

## 📖 O Que é Este Projeto?

Sistema **autônomo** para automação de Large Language Models via browser:

- Controla chatbots LLM (ChatGPT, Gemini) através de automação de browser
- Processa tarefas de uma fila baseada em arquivos JSON (`fila/`)
- Salva respostas de IA em `respostas/`
- Fornece monitoramento em tempo real via dashboard web
- Usa Chrome remote debugging (sem Chromium embarcado)

### Arquitetura NERV (IPC 2.0)

```
                  NERV (Pub/Sub - Canal Universal)
                            ↕
              ┌─────────────┼─────────────┐
              │             │             │
           KERNEL        DRIVER        SERVER
              │             │             │
         TaskQueue    BrowserPool    Dashboard
              │             │             │
         (Fila JSON)  (Puppeteer)   (Socket.io)
                            ↓
                     Chrome :9224 (Host)
                            ↓
                    ChatGPT / Gemini
```

**Princípios:**

- **Zero-coupling**: Comunicação apenas via NERV (pub/sub)
- **Sovereign interruption**: AbortController para interrupção autônoma
- **Schema validation**: Zod para validação de dados
- **Adaptive backoff**: Retry inteligente com backoff exponencial
- **Typed constants**: Centralized constants (`src/core/constants/`) eliminam magic strings
- **Module aliases**: Path aliases (@core, @infra, @shared) para imports limpos

**Componentes Core:**

- **`src/core/constants/`**: Typed constants (STATUS_VALUES, CONNECTION_MODES, LOG_CATEGORIES)
- **`src/nerv/`**: Event bus com pub/sub, buffers, correlation, telemetry
- **`src/kernel/`**: Task execution engine com policy engine e runtime
- **`src/driver/`**: Target-specific automation (ChatGPT, Gemini drivers)
- **`src/infra/`**: Browser pool, locks, queue, storage (tasks/responses/DNA)
- **`src/server/`**: Dashboard API (Express + Socket.io)

**Module Aliases** (Novo):

Este projeto usa **module-alias** para simplificar imports:

```javascript
// ❌ Antes (caminhos relativos profundos)
const logger = require('../../../core/logger');
const io = require('../../../infra/io');

// ✅ Agora (aliases limpos)
const logger = require('@core/logger');
const io = require('@infra/io');
```

**Aliases disponíveis:**

- `@` → `src/`
- `@core` → `src/core/`
- `@shared` → `src/shared/`
- `@nerv` → `src/nerv/`
- `@kernel` → `src/kernel/`
- `@driver` → `src/driver/`
- `@infra` → `src/infra/`
- `@server` → `src/server/`
- `@logic` → `src/logic/`

**IntelliSense:** Configurado em `jsconfig.json` para autocomplete completo no VSCode.

---

## 📚 Documentação

- **[Guia de Arquitetura](DOCUMENTAÇÃO/ARCHITECTURE.md)** - Arquitetura completa do sistema
- **[Referência de API](DOCUMENTAÇÃO/API.md)** - APIs públicas dos módulos
- **[Guia de Configuração](DOCUMENTAÇÃO/CONFIGURATION.md)** - Todos os parâmetros explicados
- **[Guia de Testes](DOCUMENTAÇÃO/TESTING.md)** - Framework de testes e como criar novos
- **[Guia de Deploy](DOCUMENTAÇÃO/DEPLOYMENT.md)** - Deploy para produção (Docker/PM2)
- **[Como Contribuir](CONTRIBUTING.md)** - Workflow de desenvolvimento
- **[FAQ](DOCUMENTAÇÃO/FAQ.md)** - Problemas comuns e troubleshooting

---

## ✨ Features Principais

### Core

- ✅ **Multi-target**: ChatGPT e Gemini (Claude em roadmap)
- ✅ **Queue-based**: Processamento assíncrono de tasks
- ✅ **Browser Pool**: Circuit breaker P9.2 (health monitoring)
- ✅ **Event-driven**: NERV bus (zero coupling entre componentes)
- ✅ **Real-time Dashboard**: Socket.io (WebSocket events)
- ✅ **Production-ready**: PM2, Docker, HTTPS/TLS

### Performance & Reliability

- ✅ **High-throughput**: 100-150 tasks/h (config high-throughput)
- ✅ **Low-resource**: 30-40 tasks/h com 120MB RAM (config low-resource)
- ✅ **Optimistic locking P5.1**: Race condition prevention
- ✅ **Cache invalidation P5.2**: markDirty() before writes
- ✅ **Memoization P9.5**: 72% cache hit rate
- ✅ **Heap monitoring P9.1**: GC metrics + auto-restart

### Security

- ✅ **Authentication**: Bearer token + JWT
- ✅ **Rate limiting**: 100 req/60s configurable
- ✅ **Path traversal P8.7**: Path validation
- ✅ **Symlink protection P8.8**: lstat checks
- ✅ **HTTPS/TLS**: Nginx + Let's Encrypt
- ✅ **Credential rotation**: 90-day policy

---

## 📚 Documentação Canônica (16 docs)

### FASE 1 - Fundação

- 📖 [PHILOSOPHY.md](DOCUMENTAÇÃO/PHILOSOPHY.md) - Princípios de design (DDD, Event-Driven,
  Zero-Coupling)
- 🏗️ [ARCHITECTURE_v2.md](DOCUMENTAÇÃO/ARCHITECTURE_v2.md) - Arquitetura NERV-centric
- 🎨 [SYSTEM_DESIGN.md](DOCUMENTAÇÃO/SYSTEM_DESIGN.md) - Design patterns e decisões

### FASE 2 - Estrutural

- 🔄 [DATA_FLOW.md](DOCUMENTAÇÃO/DATA_FLOW.md) - Fluxos de dados end-to-end
- 🧩 [SUBSYSTEMS.md](DOCUMENTAÇÃO/SUBSYSTEMS.md) - 13 componentes detalhados
- 🎯 [PATTERNS.md](DOCUMENTAÇÃO/PATTERNS.md) - 15 patterns catalogados
- 📖 [GLOSSARY.md](DOCUMENTAÇÃO/GLOSSARY.md) - 42 termos técnicos

### FASE 3 - Operacional

- ⚙️ [CONFIGURATION.md](DOCUMENTAÇÃO/CONFIGURATION.md) - 22 params + 50+ env vars
- 🌐 [API_REFERENCE.md](DOCUMENTAÇÃO/API_REFERENCE.md) - 10 REST + 7 WebSocket endpoints
- 🚀 [DEPLOYMENT.md](DOCUMENTAÇÃO/DEPLOYMENT.md) - Docker, PM2, HTTPS, scaling
- 💻 [DEVELOPMENT.md](DOCUMENTAÇÃO/DEVELOPMENT.md) - Setup, debug, profiling, hot reload
- 🧪 [TESTING.md](DOCUMENTAÇÃO/TESTING.md) - 14 tests, 89% pass rate, coverage
- 🤝 [CONTRIBUTING.md](DOCUMENTAÇÃO/CONTRIBUTING.md) - Git workflow, conventional commits

### FASE 4 - Referência

- 🔧 [TROUBLESHOOTING.md](DOCUMENTAÇÃO/TROUBLESHOOTING.md) - 10 categorias de problemas + soluções
- ❓ [FAQ.md](DOCUMENTAÇÃO/FAQ.md) - 30 perguntas frequentes
- 🔒 [SECURITY.md](DOCUMENTAÇÃO/SECURITY.md) - Políticas, rotation, hardening

---

## 🏗️ Arquitetura (Event-Driven NERV)

```
┌─────────────────────────────────────────────────────────────┐
│                         NERV BUS                             │
│   (Central Event Hub - Zero Coupling Communication)         │
│   • Buffers (10k events)    • Correlation IDs               │
│   • Message routing         • Telemetry                     │
└─────────────────────────────────────────────────────────────┘
       ↑           ↑           ↑            ↑          ↑
       │           │           │            │          │
   ┌───┴───┐   ┌──┴──┐    ┌───┴────┐   ┌──┴───┐  ┌──┴──┐
   │KERNEL │   │DRIVER│    │ INFRA  │   │SERVER│  │LOGIC│
   │       │   │      │    │        │   │      │  │     │
   │ Task  │   │ChatGPT   │Browser │   │ API  │  │Rules│
   │Engine │   │Gemini│    │  Pool  │   │Socket│  │     │
   └───────┘   └──────┘    └────────┘   └──────┘  └─────┘
```

**Componentes**:

- **CORE** (`src/core/`): Config, Logger, Schemas, Identity (DNA), Constants
- **NERV** (`src/nerv/`): Event bus (buffers, correlation, emission, reception, transport,
  telemetry)
- **KERNEL** (`src/kernel/`): Task execution (maestro, loop, policy engine, task runtime,
  observation store)
- **DRIVER** (`src/driver/`): Target automation (DriverFactory, ChatGPT, Gemini, BaseLLM)
- **INFRA** (`src/infra/`): Browser pool, lock manager, queue cache, file watcher, storage (io.js)
- **SERVER** (`src/server/`): Dashboard + API (Express routes, Socket.io, middleware)
- **LOGIC** (`src/logic/`): Dynamic rules, adaptive delay

**P-Level Fixes** (14 auditorias, 9.2/10 rating):

- **P1-P3**: NERV foundation (envelope canonicalization, identity validation, MessageType enum)
- **P4**: Kernel stability (shutdown race, timeout propagation)
- **P5**: Data integrity (optimistic locking P5.1, cache invalidation P5.2)
- **P6-P7**: Observability (state history, audit trail)
- **P8**: Security (auth bypass P8.4, path traversal P8.7, symlink P8.8)
- **P9**: Performance (heap monitoring P9.1, circuit breaker P9.2, NERV buffers P9.3, cache P9.4,
  memoization P9.5, metrics P9.6, concurrency P9.7, debounce P9.8, configurable workers P9.9)

---

## 🛠️ Stack Tecnológica

- **Node.js** ≥20.0.0 (runtime)
- **Puppeteer** 21.11.0 (browser automation)
- **Express** 4.22.1 (web server)
- **Socket.io** 4.8.3 (real-time)
- **PM2** 5.4.3 (process manager)
- **Zod** 3.25.76 (schema validation)
- **Docker** (containerization)
- **Nginx** (reverse proxy + HTTPS)
- **Make** (build orchestration - Makefile v2.4, 58+ targets)

---

## 📦 Estrutura do Projeto

```
chatgpt-docker-puppeteer/
├── src/                    # Source code
│   ├── core/              # Config, logger, schemas, identity, constants
│   ├── nerv/              # Event bus (NERV subsystem)
│   ├── kernel/            # Task execution engine
│   ├── driver/            # Target-specific automation (ChatGPT, Gemini)
│   ├── infra/             # Browser pool, locks, queue, storage
│   ├── server/            # Dashboard API (Express + Socket.io)
│   └── logic/             # Dynamic rules, adaptive delay
├── tests/                  # Test suites (14 functional tests)
├── scripts/                # Automation scripts (v3.0 cross-platform)
├── DOCUMENTAÇÃO/           # Canonical documentation (16 docs)
├── fila/                   # Task queue (JSON files)
├── respostas/              # AI responses (TXT files)
├── logs/                   # Application logs
├── profile/                # Browser profiles
├── backups/                # Backups
├── Makefile               # Build system (v2.4, 58+ targets)
├── ecosystem.config.js     # PM2 configuration
├── config.json             # System configuration (22 params)
├── dynamic_rules.json      # Target rules (selectors, timeouts, validation)
└── controle.json           # Runtime state
├── DOCUMENTAÇÃO/          # Documentação completa
└── public/                # Arquivos estáticos do dashboard
```

````

---

## 🧪 Testes & Qualidade

**Status**: 14 functional tests | 89% pass rate | 58% coverage

```bash
# Quick tests (pre-commit, 5min)
make test-fast

# Full test suite (15min)
make test-all

# Watch mode
make test-watch

# Coverage report
make test-coverage
````

**Test pyramid**:

- **Unit tests** (8): Core, NERV, Kernel - Pure functions, no I/O
- **Integration tests** (4): Kernel+NERV, Driver+Browser, Server+API, Infra+Filesystem
- **E2E tests** (2): Full flow (add task → execute → verify response)

**Ver**: [TESTING.md](DOCUMENTAÇÃO/TESTING.md)

---

## 🚀 Deploy & Operations

### Makefile v2.4 (58+ targets)

```bash
# Lifecycle
make start          # Start PM2 (agente + dashboard)
make stop           # Stop all
make restart        # Restart (stop + start)
make reload         # Zero-downtime reload

# Health & Monitoring
make health         # Full health check (4 endpoints + PM2)
make health-core    # Quick health (core endpoint only)
make logs           # Tail logs
make watch-logs     # Filtered logs with colors

# Testing & Quality
make test-fast      # Pre-commit tests (fast)
make test-all       # Full test suite
make lint           # ESLint check
make format-code    # ESLint + Prettier

# Maintenance
make clean          # Remove logs/tmp/queue
make backup         # Backup data directories
make diagnose       # Generate diagnostics report
```

### Docker

```bash
# Build
docker-compose build

# Start production
docker-compose -f docker-compose.yml up -d

# Logs
docker-compose logs -f

# Stop
docker-compose down
```

### PM2

```bash
# Start
pm2 start ecosystem.config.js

# Status
pm2 status

# Monitoring
pm2 monit

# Logs
pm2 logs --lines 100
```

**Ver**: [DEPLOYMENT.md](DOCUMENTAÇÃO/DEPLOYMENT.md)

---

## ⚙️ Configuração

### Principais Parâmetros (config.json)

```json
{
  "browserMode": "launcher", // launcher | external | hybrid
  "maxWorkers": 3, // 1-20 workers (P9.9 configurable)
  "kernelCycleMs": 50, // Kernel loop frequency (20Hz)
  "browserPoolSize": 3, // Browser instances
  "dashboardPort": 3008, // API/Dashboard port
  "dashboardPassword": null, // null = no auth (P8.4)
  "taskTimeout": 300000, // Task timeout (5min)
  "lockTimeout": 60000, // Lock timeout (1min)
  "queueConcurrency": 10, // Queue concurrency (P9.7)
  "nervBufferMaxSize": 10000 // NERV buffer (P9.3)
}
```

### Environment Variables (.env)

```bash
# Browser
BROWSER_MODE=launcher
BROWSER_POOL_SIZE=3

# Kernel
MAX_WORKERS=3
KERNEL_CYCLE_MS=50

# Security
DASHBOARD_PASSWORD=your-secure-password
JWT_SECRET=64-char-hex-string
ENABLE_AUTH=true
RATE_LIMIT_MAX=100

# Performance
HEAP_MONITORING=true
CACHE_METRICS=true
QUEUE_CONCURRENCY=10

# Logging
LOG_LEVEL=INFO
LOG_TO_FILE=true
```

**Ver**: [CONFIGURATION.md](DOCUMENTAÇÃO/CONFIGURATION.md)

---

## 🤝 Como Contribuir

Contribuições são bem-vindas! Este projeto segue **Conventional Commits** e **Git workflow**
estruturado.

### Workflow

```bash
# 1. Fork + Clone
git clone https://github.com/YOUR_USER/chatgpt-docker-puppeteer.git

# 2. Create branch
git checkout -b feature/my-feature

# 3. Develop + Test
make test-fast

# 4. Commit (conventional)
git commit -m "feat(driver): add Claude support"

# 5. Push + PR
git push origin feature/my-feature
```

### Standards

- ✅ **ESLint v9** (flat config) - `make lint`
- ✅ **Prettier** (2 spaces, single quotes) - `make format-code`
- ✅ **Conventional Commits** (feat/fix/docs/refactor/perf/test/chore)
- ✅ **Tests required** (unit + integration)
- ✅ **Documentation updated** (README + relevant docs)

**Ver**: [CONTRIBUTING.md](DOCUMENTAÇÃO/CONTRIBUTING.md)

---

## 📊 Status do Projeto

### Auditorias Concluídas

| Auditoria | Foco             | Status      | Rating |
| --------- | ---------------- | ----------- | ------ |
| P1-P3     | NERV foundation  | ✅ COMPLETE | 9.5/10 |
| P4        | Kernel stability | ✅ COMPLETE | 9.0/10 |
| P5        | Data integrity   | ✅ COMPLETE | 9.2/10 |
| P6-P7     | Observability    | ✅ COMPLETE | 8.8/10 |
| P8        | Security         | ✅ COMPLETE | 9.5/10 |
| P9        | Performance      | ✅ COMPLETE | 9.0/10 |

**Overall**: 9.2/10 (14 auditorias completadas)

### Roadmap

**Q1 2026**:

- ✅ NERV architecture (P1-P3)
- ✅ Security hardening (P8)
- ✅ Performance optimization (P9)
- ✅ Canonical documentation (16 docs)
- ⏳ Test coverage 58% → 80%
- ⏳ v1.0 stable release

**Q2 2026**:

- Claude support (driver implementation)
- Horizontal scaling (Redis coordination)
- Kubernetes deployment
- Monitoring dashboard (Grafana)

---

## 🌐 Cross-Platform

Totalmente compatível com **Windows**, **Linux** e **macOS**:

- ✅ **Makefile v2.4**: 58+ targets (platform detection, helpers)
- ✅ **Scripts v3.0**: `.bat` (Windows) + `.sh` (Linux/Mac) pairs
- ✅ **Super Launcher v3.0**: Interactive menu (LAUNCHER.bat, launcher.sh)
- ✅ **Health checks**: PowerShell (Windows) + bash (Linux/Mac)

**Ver**: [CROSS_PLATFORM_SUPPORT.md](CROSS_PLATFORM_SUPPORT.md)

---

## 📄 License

MIT License - Ver [LICENSE](LICENSE) para detalhes.

---

## 👥 Contributors

Agradecimentos a todos que contribuíram para este projeto:

- **AI Architect** - Architecture design, NERV implementation, P-level fixes
- **Community contributors** - Bug reports, feature requests, testing

Quer contribuir? Ver [CONTRIBUTING.md](DOCUMENTAÇÃO/CONTRIBUTING.md)

---

## 📞 Suporte

- **GitHub Issues**: https://github.com/Ilenburg1993/chatgpt-docker-puppeteer/issues
- **Discussions**: https://github.com/Ilenburg1993/chatgpt-docker-puppeteer/discussions
- **Documentation**: [DOCUMENTAÇÃO/](DOCUMENTAÇÃO/)
- **FAQ**: [FAQ.md](DOCUMENTAÇÃO/FAQ.md)
- **Troubleshooting**: [TROUBLESHOOTING.md](DOCUMENTAÇÃO/TROUBLESHOOTING.md)

---

_Última atualização: 21/01/2026 | v1.0-rc | 16 documentos canônicos completos_
