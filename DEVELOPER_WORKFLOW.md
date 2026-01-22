# Developer Workflow Guide

**Última atualização:** 22/01/2026
**Versão:** 1.1 (module-alias migration)
**Makefile:** v2.4 (573 linhas, 49+ targets)

## 📋 Filosofia: Makefile como Interface Única

O **Makefile v2.4** é a interface centralizada para todas operações de desenvolvimento. Em vez de memorizar comandos npm, scripts bash, ou comandos Docker, use `make <target>`.

### Benefícios
- ✅ **Cross-platform**: Mesmos comandos em Windows/Linux/macOS
- ✅ **Padronizado**: Uma forma consistente de fazer cada tarefa
- ✅ **Documentado**: `make help` sempre disponível
- ✅ **Composição**: Targets chamam outros targets (DRY)
- ✅ **Shortcuts**: Comandos de 1 letra para operações frequentes

---

## 🔧 Convenções de Código: Module Aliases (NOVO)

### ⚠️ IMPORTANTE: Use Aliases, Não Caminhos Relativos

Este projeto migrou para **module-alias** (v2.2.3) em 22/01/2026. SEMPRE use aliases ao invés de `../../../`:

```javascript
// ❌ ERRADO (caminhos relativos - DEPRECATED)
const logger = require('../../../core/logger');
const io = require('../../infra/io');
const { ActorRole } = require('../../../shared/nerv/constants');

// ✅ CORRETO (aliases)
const logger = require('@core/logger');
const io = require('@infra/io');
const { ActorRole } = require('@shared/nerv/constants');
```

### 📚 Aliases Disponíveis

| Alias     | Caminho       | Uso                                           |
| --------- | ------------- | --------------------------------------------- |
| `@`       | `src/`        | Raiz do código (raramente usado)              |
| `@core`   | `src/core/`   | Config, logger, constants, schemas, forensics |
| `@shared` | `src/shared/` | NERV constants, utilities compartilhadas      |
| `@nerv`   | `src/nerv/`   | Event bus, pub/sub, correlation               |
| `@kernel` | `src/kernel/` | Task execution engine, policy                 |
| `@driver` | `src/driver/` | ChatGPT, Gemini drivers                       |
| `@infra`  | `src/infra/`  | Browser pool, locks, queue, storage           |
| `@server` | `src/server/` | Dashboard, API, Socket.io                     |
| `@logic`  | `src/logic/`  | Business rules, domain logic                  |

### 🎯 Como Escolher o Alias Certo

**1. Config, Logger, Constants → `@core`**
```javascript
const CONFIG = require('@core/config');
const { log } = require('@core/logger');
const { STATUS_VALUES } = require('@core/constants/tasks');
```

**2. Browser, Queue, Storage → `@infra`**
```javascript
const io = require('@infra/io');
const pool = require('@infra/pool/pool_manager');
const locks = require('@infra/locks/lock_manager');
```

**3. NERV Events, IPC → `@shared` ou `@nerv`**
```javascript
const { ActorRole, MessageType } = require('@shared/nerv/constants');
const emitter = require('@nerv/emitter');
```

**4. API, Dashboard → `@server`**
```javascript
const socket = require('@server/engine/socket');
const routes = require('@server/api/routes');
```

### 🛠️ IntelliSense & Autocomplete

O VSCode está configurado (`jsconfig.json`) para autocomplete dos aliases:

1. Digite `require('@c` → IntelliSense sugere `@core`, `@kernel`
2. Digite `@core/` → IntelliSense lista `config`, `logger`, `constants/`, etc.
3. **Ctrl+Click** em um import salta direto para o arquivo

### ✅ Validação (antes de commit)

```bash
# 1. Verificar se há imports relativos profundos (deprecated)
grep -r "require(['\"]\.\..*\.\./\.\." src --include="*.js" | wc -l
# Deve retornar: 0 (zero imports com ../../ ou ../../../)

# 2. Verificar se aliases estão funcionando
npm test

# 3. ESLint deve passar limpo
make lint
```

---

## 🌅 Morning Routine (Iniciando o dia)

```bash
# 1. Ver configuração do ambiente
make info

# 2. Ver estatísticas do VS Code
make vscode-info

# 3. Verificar mudanças pendentes
make git-changed

# 4. Iniciar o sistema (PM2 + dashboard)
make start

# 5. Verificar saúde dos endpoints
make health

# 6. Ver logs em tempo real (opcional)
make logs
```

**Tempo estimado:** 2-3 minutos

---

## 🔧 Development Loop (Durante o trabalho)

### Modo Development (com nodemon)
```bash
# Inicia com hot-reload
make dev

# Em outro terminal: monitorar queue
make queue-watch
```

### Fazer mudanças no código
```bash
# 1. Editar arquivos

# 2. Verificar lint durante edição (ESLint on-type ativado no VS Code)

# 3. Formatar código manualmente (se necessário)
make format-code

# 4. Rodar testes específicos
node tests/test_<nome>.js

# 5. Rodar todos os testes
make test-all
```

### Verificar qualidade do código
```bash
# Lint apenas (sem fixes)
make lint

# Lint com auto-fix
make lint-fix

# Formatar tudo (ESLint + Prettier)
make format-code
```

---

## 🧪 Testing Strategy

### Testes Rápidos (desenvolvimento)
```bash
# Teste de integração do Launcher
make test-integration

# Teste de health logic
make test-health

# Teste individual
node tests/test_config_validation.js
```

### Testes Completos (antes de commit)
```bash
# Todos os testes
make test-all

# Check completo (deps + health + tests)
make full-check
```

### CI/CD Tests
```bash
# Simular pipeline CI
make ci-test

# Lint CI-friendly (max-warnings 0)
make ci-lint
```

---

## 📝 Commit & Push Workflow

### Fluxo Padrão
```bash
# 1. Ver mudanças detalhadas
make git-changed

# 2. Formatar código
make format-code

# 3. Rodar testes
make test-integration

# 4. Stage arquivos
git add <files>

# 5. Commit
git commit -m "feat: descrição"

# 6. Push
git push
```

### Fluxo Seguro (com gate checks)
```bash
# Push com lint + test + push automático
make git-push-safe

# Isso faz:
# 1. Verifica uncommitted changes
# 2. Roda ESLint (max-warnings 0)
# 3. Roda testes de integração
# 4. Faz push se tudo passar
# 5. Falha se qualquer check falhar
```

### Commit de configurações do VS Code
```bash
# Commit automático de .vscode/ com mensagem detalhada
make commit-settings
```

---

## 🛠️ Maintenance Tasks

### Atualizar dependências
```bash
# Ver pacotes outdated
make update-deps

# Atualizar manualmente
npm update
npm install <package>@latest

# Verificar novamente
make check-deps
```

### Limpeza
```bash
# Limpeza básica (logs, tmp, queue)
make clean

# Limpeza profunda (node_modules + reinstall)
make workspace-clean
```

### Backup
```bash
# Backup de dados (fila, respostas, perfis)
make backup
```

---

## 🐛 Debugging & Diagnostics

### Ver logs
```bash
# Logs do PM2 (follow)
make logs

# Logs da aplicação apenas
make logs-app

# Logs de erro apenas
make logs-error

# Watch logs (script dedicado)
make watch
```

### Diagnóstico
```bash
# Relatório completo de diagnóstico
make diagnose

# Health check detalhado
make health

# Status do PM2
make status
# ou
make pm2

# Monitor TUI do PM2
make pm2-monit
```

### Debug de problemas
```bash
# 1. Ver estado atual
make info

# 2. Verificar processos PM2
make pm2-list

# 3. Ver logs recentes
make logs

# 4. Restart sistema
make restart

# 5. Se persistir: rebuild completo
make rebuild
```

---

## 🌙 Evening Routine (Finalizando o dia)

```bash
# 1. Commitar trabalho pendente
make git-changed
git add .
git commit -m "work in progress"

# 2. Backup de dados
make backup

# 3. Parar sistema
make stop

# 4. Verificar status (deve estar offline)
make status
```

**Tempo estimado:** 2-3 minutos

---

## ⚡ Shortcuts Essenciais

### Comandos de 1 letra
```bash
make s   # start
make st  # stop
make r   # restart
make h   # health
make l   # logs
make t   # test
make c   # clean
make b   # backup
make q   # queue
make d   # dashboard
make i   # info
make v   # vscode-info
make g   # git-changed
```

### Quick Operations
```bash
make quick CMD=pause     # Pausar sistema
make quick CMD=resume    # Resume sistema
make quick CMD=health    # Health check rápido
make quick CMD=status    # Status rápido
make quick CMD=backup    # Backup rápido
```

---

## 🎯 VS Code Integration

### Verificar configurações
```bash
# Estatísticas do settings.json
make vscode-info

# Output:
# - Lines count
# - Configs count (~280+)
# - Key optimizations preview
```

### Recarregar VS Code
```bash
# Ver instruções de reload
make reload-vscode

# Ou direto:
# Ctrl+Shift+P → "Developer: Reload Window"
```

### Features do VS Code otimizadas
- **Copilot**: length 1000 (2x context), temperature 0.2
- **Inlay Hints**: Literals + return types (toggle: Ctrl+Shift+P)
- **Terminal**: Autocomplete + persistent sessions + 1000 history
- **Git**: Merge editor visual + auto-prune + branch protection
- **Editor**: 10 tabs limit + smooth scrolling + unicode highlight
- **Privacy**: Zero telemetry

---

## 🔄 Recovery Scenarios

### Sistema não inicia
```bash
# 1. Verificar dependências
make check-deps

# 2. Parar tudo
make stop

# 3. Limpar locks/temp
make clean

# 4. Rebuild
make rebuild

# 5. Verificar saúde
make health
```

### Testes falhando
```bash
# 1. Verificar ambiente
make info

# 2. Limpar cache
npm cache clean --force

# 3. Reinstalar deps
make install-deps

# 4. Rodar testes novamente
make test-all
```

### Conflitos de Git
```bash
# 1. Ver mudanças
make git-changed

# 2. Usar merge editor do VS Code
# (ativado nas configurações)

# 3. Resolver conflitos visualmente

# 4. Testar antes de commit
make test-integration
```

---

## 📊 Monitoring & Queue

### Monitorar queue
```bash
# Status estático
make queue

# Status com watch (atualiza a cada 2s)
make queue-watch

# Adicionar task
make queue-add
```

### Dashboard HTML
```bash
# Abrir dashboard no browser
make dashboard

# Acessa: http://localhost:2998/launcher-dashboard
```

### Launcher interativo
```bash
# Menu interativo (Windows + Linux)
make launcher

# 10 operações disponíveis:
# 1. Start, 2. Stop, 3. Restart, 4. Status
# 5. Logs, 6. Health, 7. Queue, 8. Backup
# 9. Tests, 10. Exit
```

---

## 🐳 Docker (Secondary Option)

```bash
# Build imagem
make docker-build

# Start containers
make docker-start

# Logs
make docker-logs

# Shell no container
make docker-shell

# Stop
make docker-stop

# Clean completo
make docker-clean
```

**Nota:** PM2-first é a estratégia principal. Docker é opcional.

---

## 📚 References

- **Makefile**: [Makefile](Makefile) (573 linhas, v2.4)
- **Cross-platform docs**: [CROSS_PLATFORM_SUPPORT.md](CROSS_PLATFORM_SUPPORT.md)
- **Architecture**: [DOCUMENTAÇÃO/ARCHITECTURE.md](DOCUMENTAÇÃO/ARCHITECTURE.md)
- **Testing**: [TESTS_STRATEGY.md](TESTS_STRATEGY.md)
- **Copilot instructions**: [.github/copilot-instructions.md](.github/copilot-instructions.md)

---

## ✅ Best Practices Checklist

### Antes de cada commit
- [ ] `make format-code` - Formatar código
- [ ] `make lint` - Verificar lint
- [ ] `make test-integration` - Rodar testes
- [ ] `make git-changed` - Ver mudanças
- [ ] `git add` + `git commit` - Commit com mensagem clara

### Antes de cada push
- [ ] `make test-all` - Todos os testes
- [ ] `make health` - Health checks
- [ ] `git push` - Push para remote

### Ou simplesmente
- [ ] `make git-push-safe` - Faz tudo automaticamente

### Daily
- [ ] `make start` - Iniciar sistema
- [ ] `make health` - Verificar saúde
- [ ] `make backup` - Backup ao final do dia
- [ ] `make stop` - Parar sistema

---

## 🎓 Tips & Tricks

### 1. Múltiplos terminais
- Terminal 1: `make dev` (nodemon)
- Terminal 2: `make queue-watch` (monitoramento)
- Terminal 3: Comandos ad-hoc

### 2. VS Code Tasks
Todos os npm scripts estão disponíveis como VS Code tasks (`.vscode/tasks.json`):
- `Ctrl+Shift+B` → Build tasks
- `Ctrl+Shift+P` → Run Task

### 3. Git aliases (opcional)
```bash
git config alias.changed "!make git-changed"
git config alias.pushsafe "!make git-push-safe"
```

Agora pode usar:
```bash
git changed     # = make git-changed
git pushsafe    # = make git-push-safe
```

### 4. VS Code keyboard shortcuts
- `Ctrl+Shift+P` → Command Palette
- `Ctrl+` ` → Toggle terminal
- `Ctrl+K Ctrl+0` → Fold all
- `Ctrl+K Ctrl+J` → Unfold all

### 5. PM2 ecosystem
Configuração em `ecosystem.config.js`:
- Memoria: 512MB max
- Restart: sempre
- Watch: false (use `make dev` para watch)
- Logs: `logs/` directory

---

**Última revisão:** 21/01/2026
**Contribuidores:** AI Coding Agent + User
**Versão do guia:** 1.0
**Status:** ✅ Production-ready
