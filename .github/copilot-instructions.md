# Team Onboarding Guide - chatgpt-docker-puppeteer

> **Se você é um programador começando nesta equipe, isto é o que você precisa saber.**

- PROGRAMAMOS PRIMARIAMENTE EM NODE V24.

## O Que Este Projeto Faz

Sistema autônomo que controla LLMs (ChatGPT, Gemini) via browser automation para executar **missões longas** (4-24h). Não são tasks isoladas — são workflows multi-etapa com validação LLM-as-judge, checkpoint recovery e acumulação de contexto.

**Stack**: Node.js 24 + Puppeteer + PM2 + Docker (Windows host + WSL2 container)

## Arquitetura em 60 Segundos

```
4 Camadas:
┌─────────────────────────────────────┐
│ INTERFACE (Dashboard + API REST)    │  ← Express + Socket.io
├─────────────────────────────────────┤
│ MISSION (Orquestração de Workflows) │  ← MissionManager + OrchestratorEngine
├─────────────────────────────────────┤
│ ORCHESTRATION (Execução de Steps)   │  ← Kernel + Policy Engine
├─────────────────────────────────────┤
│ EXECUTION (Drivers LLM)              │  ← ChatGPT/Gemini drivers (Puppeteer)
└─────────────────────────────────────┘

Backbone: NERV Event Bus (zero acoplamento direto)
```

**Hierarquia de Conceitos**:
```
MISSION (4-24h workflow)
  └─> WORKFLOW (conjunto de steps)
       └─> STEP (operação lógica)
            └─> TASK (unidade de execução)
                 └─> DRIVER (ChatGPT/Gemini via browser)
```

## Onde Está o Código

```
src/
├── main.js                    # Boot sequence (6 fases)
├── nerv/                      # Event bus (IPC backbone)
│   ├── core.js               # Pub/sub central
│   └── adapters/             # Bridges para Kernel/Driver/Server
├── kernel/                    # Task execution engine
│   ├── execution_engine.js   # Executa tasks
│   ├── kernel_loop.js        # Main loop
│   └── policy_engine.js      # Decisões de retry/timeout
├── driver/                    # Browser automation
│   ├── chatgpt/              # ChatGPT driver (Puppeteer)
│   ├── gemini/               # Gemini driver (Puppeteer)
│   └── factory.js            # Driver selector
├── infra/                     # Infraestrutura
│   ├── browser_pool/         # Pool de browsers (conexão + health)
│   │   ├── pool_manager.js   # Gerencia instâncias
│   │   └── ConnectionOrchestrator.js  # 3 modos: launcher/external/auto
│   ├── proxy/                # Chrome Proxy (v3.0 - Windows → Container)
│   │   └── chromeProxyService.js  # HTTP + WebSocket proxy
│   ├── io/                   # Filesystem (atomic writes)
│   └── locks/                # PID-validated locks
├── mission/                   # Mission system (em construção)
│   ├── MissionManager.js     # Orquestrador de missões
│   └── templates/            # 97 mission templates
├── server/                    # API + Dashboard
│   ├── api/router.js         # Express routes
│   └── dashboard/            # HTML + Socket.io
└── core/                      # Config, schemas, logger, constants

Configs:
├── config.json                # Main config (hot-reload)
├── dynamic_rules.json         # Regras dinâmicas
├── ecosystem.config.js        # PM2 config (agent + dashboard)
└── .puppeteerrc.cjs           # Puppeteer config + shared helpers

Scripts:
├── Makefile                   # Build orchestrator (58+ targets)
└── scripts/                   # Automation (.bat + .sh pairs)
```

## Como Rodar

### Quick Start (Linux/WSL)
```bash
# 1. Instalar dependências
make install-deps

# 2. Iniciar sistema (PM2)
make start                # Inicia agent + dashboard

# 3. Health check
make health               # Valida 4 endpoints + PM2

# 4. Logs
make logs-follow          # Tail logs em tempo real
```

### Comandos Essenciais (Makefile)
```bash
# Lifecycle
make start                # PM2 start
make stop                 # PM2 stop
make restart              # PM2 restart

# Testing
make test-fast            # Pre-commit tests (segundos)
make test-all             # Full test suite

# Monitoring
make logs-follow          # Tail logs
make dashboard            # Abrir dashboard

# Quality
make format-code          # ESLint + Prettier
make git-push-safe        # 5-step validation antes de push

# Info
make info                 # Configuração atual
make version              # Versões (Makefile v2.4, etc.)
```

### Chrome Proxy Architecture (v3.0 - CRÍTICO)

**Problema**: Docker Desktop (WSL2) não consegue conectar diretamente ao Chrome no Windows host.

**Solução**: HTTP + WebSocket proxy no container (porta 9224) que roteia para Chrome no Windows (porta 9225).

```
Container (Node.js)  ──proxy:9224──>  Windows Host (Chrome:9225)
                          ↑
                   chromeProxyService.js
                   - Reescreve URLs (ws://localhost → ws://host.docker.internal)
                   - Reescreve headers (Host: localhost)
                   - Health checks + graceful shutdown
```

**Scripts Windows**:
```batch
START-CHROME-SIMPLE.bat        # Inicia Chrome com remote debugging
wsl-chrome-integration.sh      # Valida integração (6 testes)
test-proxy-simple.js           # 6 integration tests
```

**Docs**: Veja `DOCUMENTAÇÃO/CONNECTION_ARCHITECTURE/` (2,600+ linhas, 4 docs completos)

## Padrões de Código (OBRIGATÓRIOS)

### 1. NERV-First Communication
❌ **NUNCA** faça chamadas diretas entre componentes:
```javascript
// ERRADO - acoplamento direto
const kernel = require('./kernel/execution_engine');
kernel.executeTask(task);
```

✅ **SEMPRE** use eventos NERV:
```javascript
// CORRETO - zero acoplamento
const nerv = require('./nerv/core');
nerv.emit({
    type: 'DRIVER_EXECUTE',
    action: 'EXECUTE',
    payload: { task }
});
```

### 2. Constants (Never Magic Strings)
❌ **NUNCA** use strings mágicas:
```javascript
// ERRADO
if (task.status === 'PENDING') { ... }
if (connectionMode === 'launcher') { ... }
```

✅ **SEMPRE** importe de `src/core/constants/`:
```javascript
// CORRETO
const { STATUS_VALUES } = require('@core/constants/tasks');
const { CONNECTION_MODES } = require('@core/constants/browser');

if (task.status === STATUS_VALUES.PENDING) { ... }
if (connectionMode === CONNECTION_MODES.LAUNCHER) { ... }
```

### 3. Atomic File Operations
❌ **NUNCA** escreva diretamente:
```javascript
// ERRADO - não é atômico, corrompe em crashes
fs.writeFileSync('fila/task.json', JSON.stringify(task));
```

✅ **SEMPRE** use helpers de `io.js`:
```javascript
// CORRETO - atomic write (temp file + rename)
const io = require('@infra/io');
await io.saveTask(task);
```

### 4. Exit Codes (Scripts)
❌ **NUNCA** omita exit codes:
```bash
# ERRADO - CI/CD não detecta falhas
#!/usr/bin/env bash
some_command
# script termina sem exit code explícito
```

✅ **SEMPRE** retorne 0 (sucesso) ou 1 (erro):
```bash
# CORRETO
#!/usr/bin/env bash
set -euo pipefail

if ! some_command; then
    echo "[FAIL] Command failed"
    exit 1
fi

echo "[OK] Success"
exit 0
```

### 5. JSON Parsing (Scripts)
❌ **NUNCA** use regex/grep para JSON:
```bash
# ERRADO - fragile, false positives
curl http://localhost:2998/health | grep -q '"status"'
```

✅ **SEMPRE** use parsers adequados:
```bash
# CORRETO - bash
curl -s http://localhost:2998/health | jq -r '.status'

# CORRETO - PowerShell
$response = Invoke-RestMethod -Uri "http://localhost:2998/health"
if ($response.status -in @('ok', 'healthy')) { ... }
```

### 6. Cross-Platform (Scripts)
❌ **NUNCA** crie apenas .sh OU .bat:
```bash
# ERRADO - só funciona no Linux
scripts/deploy.sh
```

✅ **SEMPRE** crie AMBOS (.sh + .bat):
```bash
# CORRETO - suporte Windows + Linux
scripts/deploy.sh         # Linux/macOS
scripts/deploy.bat        # Windows
```

## Anti-Patterns (O Que Evitar)

### ❌ Direct File Writes
- Não use `fs.writeFileSync()` diretamente → Use `io.saveTask()`
- Atomic writes (temp file + rename) previnem corrupção

### ❌ Magic Strings
- Não use `'PENDING'`, `'RUNNING'` → Use `STATUS_VALUES.PENDING`
- Imports de `src/core/constants/`

### ❌ Direct Component Coupling
- Não importe `kernel.js` diretamente de `driver.js`
- NERV events para tudo

### ❌ Regex on JSON
- Não use `grep`, `awk`, `regex` para parsear JSON
- Use `jq` (bash) ou `Invoke-RestMethod` (PowerShell)

### ❌ Missing Exit Codes
- Scripts DEVEM retornar 0 (success) ou 1 (error)
- CI/CD quebra sem exit codes

### ❌ Hardcoded Paths
- Não use `./fila/task.json` → Use `path.join(ROOT, 'fila', 'task.json')`
- Cross-platform compatibility

## Estado do Projeto (Fev 2026)

### ✅ Implementado (Funcional)
- NERV Event Bus (backbone)
- Kernel + Drivers (execução de tasks)
- Chrome Proxy v3.0 (Windows ↔ Container)
- ConnectionOrchestrator v3.0 (3 modos)
- MissionManager (orquestração)
- 97 mission templates criados
- Build system (Makefile v2.4, 58+ targets)
- Scripts v3.0 (cross-platform parity)

### 🚧 Em Construção (Parcial)
- Endpoints REST `/missions` (POST, GET, PATCH, DELETE)
- Dashboard UI completo (HTML + React + Socket.io)
- Testes E2E abrangentes
- LLM-as-judge validation (citado, não codificado)
- Checkpoint recovery (<5min granularity)
- Context accumulation entre steps

### 📚 Documentação
- ARCHITECTURE.md v3.0 (3,018 linhas, completo)
- CONNECTION_ARCHITECTURE/ (2,600+ linhas, 4 docs)
- ARCHITECTURE_V4.md (14.5% completo - 8/55 capítulos)

## Debugging & Troubleshooting

### Logs
```bash
# Tail logs
make logs-follow

# Watch com filtros
make watch

# Crash reports
ls logs/crash_reports/
```

### Health Checks
```bash
# Quick check (core endpoint)
make health-core

# Full check (4 endpoints + PM2)
make health

# PM2 status
make pm2-status
```

### Common Issues

**1. Chrome não conecta (Docker)**
- ✅ Chrome DEVE rodar no Windows (porta 9225)
- ✅ Proxy DEVE rodar no container (porta 9224)
- ✅ Validar: `bash wsl-chrome-integration.sh all`
- 📖 Docs: `DOCUMENTAÇÃO/CONNECTION_ARCHITECTURE/`

**2. PM2 não inicia**
```bash
# Verificar se PM2 está instalado
command -v pm2

# Verificar processos
pm2 list

# Logs
pm2 logs
```

**3. Tests falhando**
```bash
# EVITAR: npm test (broken script)
# USAR: make test-fast (pre-commit)
make test-fast

# Testes individuais
node tests/test_config_validation.js
```

## Onde Buscar Ajuda

### Documentação Essencial
1. **ARCHITECTURE.md** (3,018 linhas) - Arquitetura completa v3.0
2. **CONNECTION_ARCHITECTURE/** (2,600+ linhas) - Chrome Proxy deep dive
3. **ARCHITECTURE_V4.md** (parcial) - Mission system architecture
4. **Makefile** (linha 1) - `make help` lista todos os targets

### Code Navigation (VSCode)
- `jsconfig.json`: Module aliases configurados (`@core`, `@infra`, `@shared`)
- Imports: Use `@core/logger` em vez de `../../core/logger`
- Search: Ctrl+Shift+F para buscar padrões no workspace

### Testing
- `tests/` - 14 testes funcionais mantidos
- `tests/helpers.js` - Helpers para mocking
- `make test-fast` - Quick tests (pre-commit)
- `make test-all` - Full suite

## Workflow de Desenvolvimento

### Pre-Commit
```bash
# 1. Format code
make format-code

# 2. Quick tests
make test-fast

# 3. Health check
make health-core

# 4. Commit
git commit -m "feat: ..."
```

### Safe Push
```bash
# 5-step validation (branch check + lint + tests)
make git-push-safe
```

### CI/CD
- GitHub Actions v2.0: 8 parallel jobs
- ESLint strict mode (--max-warnings 0)
- Multi-platform (Ubuntu + Windows + macOS)
- Module-alias enforcement

## Próximos Passos (Para Você)

1. **Setup local**: `make install-deps && make start`
2. **Ler docs**: `ARCHITECTURE.md` + `CONNECTION_ARCHITECTURE/`
3. **Rodar health**: `make health`
4. **Explorar código**: Comece por `src/main.js` (boot sequence)
5. **Primeiro bug fix**: Pegue issue no GitHub
6. **Primeira feature**: Implemente endpoint `/missions` (veja `src/server/api/router.js`)

---
**Versão**: 4.0 (Reescrita Completa - Fev 2026)
**Filosofia**: Conciso, Prático, Orientado a Ação
**Status**: ✅ Projeto em Construção Ativa</content>
  <parameter name="filePath">/workspaces/chatgpt-docker-puppeteer/.github/copilot-instructions.md
