# 📋 AUDITORIA: ARQUIVOS ROOT (Fundação do Sistema)

> **Nota:** auditoria point-in-time de 20/01/2026. Nomes de arquivos e comandos refletem o estado
> observado naquele momento e podem divergir do baseline atual.

**Data**: 2026-01-20 **Auditor**: GitHub Copilot (Claude Sonnet 4.5) **Escopo**: Arquivos na pasta
raiz do projeto (não inclusos em src/) **Status**: 🟢 SAUDÁVEL (com recomendações de limpeza)

---

## 🎯 Sumário Executivo

Esta auditoria analisa os **arquivos fundacionais** que residem na pasta root do projeto -
configurações, entry points, deploy, package management, scripts, e documentação de alto nível.
Estes arquivos não estão dentro de `src/` mas são **CRÍTICOS** para o funcionamento do sistema.

### Principais Achados

- ✅ **80+ arquivos root identificados** (config, deploy, scripts, docs)
- ✅ **Entry point bem estruturado** (index.js → src/main.js proxy pattern)
- ✅ **Deploy moderno** (multi-stage Dockerfile, 3 docker-compose variants)
- ✅ **Package management completo** (80+ npm scripts documentados)
- ⚠️ **20+ arquivos .md obsoletos** identificados (limpeza recomendada)
- ⚠️ **Configurações fragmentadas** (5 arquivos JSON + .env + jsconfig)
- 🐛 **2 bugs P2** encontrados (BAT scripts obsoletos)

---

## 📦 1. INVENTÁRIO COMPLETO

### 1.1 Entry Points

| Arquivo       | LOC  | Propósito                                | Audit Level | Status   |
| ------------- | ---- | ---------------------------------------- | ----------- | -------- |
| `index.js`    | 15   | Proxy para src/main.js (compatibilidade) | 360         | ✅ ATIVO |
| `src/main.js` | ~200 | Entry point real (boot sequence)         | 700         | ✅ ATIVO |

**Análise**: Entry point arquitetura é **clean** - `index.js` é um proxy fino para manter
compatibilidade com package.json, PM2, Docker CMD, e scripts legacy. O código real está em
`src/main.js`.

```javascript
// index.js (15 linhas)
/* Entry Point Proxy - Delegates to src/main.js
   Exists for compatibility with:
   - package.json "main" field
   - Docker CMD
   - PM2 ecosystem.config.js
   - Legacy scripts */
require('./src/main');
```

---

### 1.2 Configurações (8 arquivos)

| Arquivo               | LOC | Propósito                           | Validação       | Status      |
| --------------------- | --- | ----------------------------------- | --------------- | ----------- |
| `config.json`         | 55  | Configuração mestra (29 parâmetros) | Zod (config.js) | ✅ COMPLETA |
| `dynamic_rules.json`  | 50  | DNA v5 - Selectors evolutivos       | schemas.js      | ✅ ATIVA    |
| `controle.json`       | 3   | Estado de execução (PAUSED/RUNNING) | Manual          | ✅ ATIVA    |
| `fila.json`           | 12  | Exemplo de estrutura de fila        | schemas.js      | ⚠️ EXEMPLO  |
| `ecosystem.config.js` | 80  | PM2 - 2 apps (agente + dashboard)   | PM2 schema      | ✅ ATIVA    |
| `jsconfig.json`       | 43  | IntelliSense/navegação VS Code      | VS Code         | ✅ ATIVA    |
| `eslint.config.mjs`   | 255 | ESLint v9 Flat Config               | ESLint v9       | ✅ ATIVA    |
| `.env` (example)      | ?   | Template de variáveis de ambiente   | Manual          | ⚠️ FALTA    |

**Gaps Críticos**:

- ❌ **Falta `.env.example`**: Usuários não sabem quais env vars existem
- ⚠️ **`fila.json` é ambíguo**: Parece config mas é apenas exemplo (renomear para
  `fila.example.json`)

---

### 1.3 Deploy & Orchestration (8 arquivos)

#### Dockerfiles

| Arquivo          | LOC | Propósito                      | Otimização   | Status   |
| ---------------- | --- | ------------------------------ | ------------ | -------- |
| `Dockerfile`     | 96  | Multi-stage Alpine (produção)  | ✅ Otimizado | ✅ ATIVA |
| `Dockerfile.dev` | 48  | Node:20 full (desenvolvimento) | ⚠️ Básica    | ✅ ATIVA |

**Análise Dockerfile Produção**:

- ✅ Multi-stage build (deps → runtime)
- ✅ Alpine base (~40% size reduction vs Debian)
- ✅ Non-root user (security)
- ✅ Healthcheck dedicado (scripts/healthcheck.js)
- ✅ Volumes bem definidos (fila, respostas, logs, profile)
- ✅ dumb-init para signal handling
- ✅ PUPPETEER_SKIP_CHROMIUM_DOWNLOAD (usa Chrome remoto)

#### Docker Compose

| Arquivo                    | LOC | Propósito                         | Ambiente | Status   |
| -------------------------- | --- | --------------------------------- | -------- | -------- |
| `docker-compose.yml`       | 106 | Configuração base (remote Chrome) | Dev/Prod | ✅ ATIVA |
| `docker-compose.prod.yml`  | 179 | Named volumes + env vars          | Produção | ✅ ATIVA |
| `docker-compose.linux.yml` | 130 | Linux-specific (extra_hosts)      | Linux    | ✅ ATIVA |

**Diferenças-chave**:

- **Base**: Bind mounts para dev (`./fila:/app/fila`)
- **Prod**: Named volumes (`fila-prod:/app/fila`) + env file + versioning
- **Linux**: `extra_hosts: host.docker.internal:host-gateway` (Docker Desktop não existe)

#### Build Tools

| Arquivo               | LOC | Propósito                           | Targets | Status   |
| --------------------- | --- | ----------------------------------- | ------- | -------- |
| `Makefile`            | 258 | 20+ comandos Docker/test/monitoring | 20+     | ✅ ATIVA |
| `ecosystem.config.js` | 80  | PM2 - 2 processos gerenciados       | 2 apps  | ✅ ATIVA |

**Makefile Highlights** (258 linhas):

- **Dev**: `make build`, `make start`, `make dev`, `make logs`, `make shell`
- **Prod**: `make build-prod`, `make start-prod`, `make stop-prod`
- **Test**: `make test`, `make test-health`, `make test-lock`
- **Monitoring**: `make monitoring`, `make health`, `make stats`
- **Maintenance**: `make clean`, `make backup`, `make restore`, `make prune`

**ecosystem.config.js** (PM2 Apps):

```javascript
apps: [
  {
    name: 'agente-gpt', // Maestro (task execution)
    script: './index.js',
    node_args: '--expose-gc', // Manual GC para long-running
    max_memory_restart: '1G',
    exp_backoff_restart_delay: 100,
  },
  {
    name: 'dashboard-web', // Mission Control (API + Socket.io)
    script: './src/server/main.js',
    env: { PORT: 3008, DAEMON_MODE: 'true' },
  },
];
```

---

### 1.4 Package Management

| Arquivo             | LOC  | Propósito                      | Status   |
| ------------------- | ---- | ------------------------------ | -------- |
| `package.json`      | 197  | Metadados + 80+ scripts + deps | ✅ ATIVA |
| `package-lock.json` | ~20k | Lock exato de dependências     | ✅ ATIVA |

#### package.json - 80+ Scripts Catalogados

**Categorias de Scripts**:

##### 🚀 Execução (8 scripts)

- `start` → `node index.js` (produção)
- `dev` → `nodemon index.js` (desenvolvimento)
- `watch` → `nodemon --watch src/` (watch mode)
- `daemon:start` → `npx pm2 start ecosystem.config.cjs`
- `daemon:stop`, `daemon:restart`, `daemon:logs`, `daemon:status`

##### 📊 Queue Management (8 scripts)

- `queue:status` → Mostra estado da fila
- `queue:status:watch` → Monitor em tempo real
- `queue:add` → Adiciona tarefa
- `queue:flush`, `queue:clear`, `queue:remove`, `queue:inspect`, `queue:export`

##### 🔍 Code Analysis (12 scripts)

- `analyze:complexity` → Relatório de complexidade ciclomática
- `analyze:dependencies` → Grafo de dependências (madge)
- `analyze:circular` → Detecta import circulares
- `analyze:duplicates` → Código duplicado (jscpd)
- `analyze:unused` → Código morto (potencialmente)
- `analyze:size` → Tamanho de bundles
- `analyze:types` → Checagem de tipos (JSDoc + TypeScript declarations)
- `analyze:all` → Executa todos
- `analyze:report` → Gera relatório consolidado
- `diagram:dependencies`, `diagram:architecture`, `diagram:flow`

##### 🧪 Testing (15+ scripts)

- `test` → `npm test` (runner nativo Node.js)
- `test:unit` → Apenas testes unitários
- `test:integration` → Testes de integração
- `test:e2e` → End-to-end
- `test:watch`, `test:watch:unit` → Watch mode
- `test:coverage` → Relatório c8
- `test:ci` → CI mode com coverage mínima
- `test:debug` → Node inspector
- `test:health`, `test:config`, `test:lock`, `test:stall`, `test:schema` → Testes específicos
- `test:legacy` → Runner antigo (scripts/run-tests.js)
- `test:win`, `test:linux` → Platform-specific runners

##### 🎨 Code Quality (10 scripts)

- `lint` → `eslint .`
- `lint:fix` → Auto-fix
- `lint:quiet` → Apenas erros (sem warnings)
- `format` → `prettier --write .`
- `format:check` → Verifica sem escrever
- `validate` → Valida config.json
- `validate:pre-start` → Pre-flight check
- `validate:all` → Lint + format + test
- `validate:code` → Lint + format (sem teste)
- `check` → Alias para validate:code

##### 🧹 Maintenance (8 scripts)

- `clean` → Remove logs/tmp/queue
- `clean:all` → Limpeza profunda
- `clean:logs` → Apenas logs
- `clean:cache` → npm cache + node_modules/.cache
- `reset:hard` → Limpa tudo + reinstala deps
- `doctor` → Script de diagnóstico (`scripts/doctor.js`)
- `diagnose` → Análise de crashes
- `setup` → Configuração inicial

##### 🛠️ Utilities (10+ scripts)

- `preinstall` → Bloqueia yarn (npm only)
- `postinstall` → Mensagem de sucesso
- `prepare` → Husky setup (se existir)
- `migrate:constants` → Codemod para constants
- `verify:constants` → Valida uso de constants
- `backup:data` → Backup de fila/respostas
- `restore:data` → Restaura backup

**Análise**:

- ✅ **Cobertura excelente**: Scripts para toda operação imaginável
- ✅ **Namespacing consistente**: `category:action` pattern
- ⚠️ **Documentação falta**: Não há README explicando todos os scripts (recomendação: criar
  `SCRIPTS.md`)

---

### 1.5 Scripts Legacy (2 arquivos)

| Arquivo            | LOC | Propósito                       | Plataforma | Status      |
| ------------------ | --- | ------------------------------- | ---------- | ----------- |
| `rodar_agente.bat` | 147 | Supervisor Windows com watchdog | Windows    | ⚠️ OBSOLETO |
| `INICIAR_TUDO.BAT` | 50  | Launcher legado (PM2)           | Windows    | 🐛 BUG      |

#### Análise `rodar_agente.bat`

**Status**: ⚠️ **PARCIALMENTE OBSOLETO**

**Propósito Original**:

- Supervisor Windows para `index.js` com auto-restart
- Watchdog: reinicia em crashes (delay exponencial)
- Logging em `logs/wrapper_boot.log`
- Verificações pre-flight (Node.js instalado, Chrome rodando)

**Problemas**:

1. **Conflito com PM2**: Este script implementa watchdog manual, mas PM2 já faz isso melhor
2. **Aponta para `index.js`** mas usuários devem usar `npm run daemon:start` (PM2)
3. **Não compatível com Docker**: Hardcoded paths Windows
4. **Audit Level 10** (antigo) vs moderno "Audit Level: 700"

**Recomendação**:

- Mover para `scripts/legacy/` com nota: "Use `npm run daemon:start` instead"
- OU atualizar para ser um wrapper de `npx pm2 start ecosystem.config.cjs` com verificações
  Windows-specific

#### Análise `INICIAR_TUDO.BAT`

**Status**: 🐛 **BUG CRÍTICO**

**Problemas Encontrados**:

```bat
call npx pm2 start server.js --name dashboard-web --no-autorestart
call npx pm2 start index.js --name agente-gpt --stop --node-args="--expose-gc"
```

**Bugs**:

1. ❌ **Aponta para `server.js`** que não existe mais (renomeado para `src/server/main.js`)
2. ❌ **Conflito com ecosystem.config.js**: PM2 deve usar `npx pm2 start ecosystem.config.cjs` (não
   scripts individuais)
3. ❌ **Comando `--stop` inválido**: PM2 não tem flag `--stop` (apenas `pm2 stop <name>` depois)
4. ❌ **Abre http://localhost:3000** mas porta real é 3008

**Recomendação**:

```bat
REM CORREÇÃO
call npm run daemon:start
timeout /t 5 >nul
start http://localhost:3008
```

---

### 1.6 Documentação Root (20+ arquivos .md)

#### Documentação Ativa (Mantém)

| Arquivo                    | LOC  | Propósito                     | Status   | Recomendação |
| -------------------------- | ---- | ----------------------------- | -------- | ------------ |
| `README.md`                | 304  | Entrada principal do projeto  | ✅ ATIVA | Manter       |
| `CONTRIBUTING.md`          | 80   | Guia de contribuição          | ✅ ATIVA | Manter       |
| `LICENSE`                  | ~200 | MIT License                   | ✅ ATIVA | Manter       |
| `CHANGELOG.md`             | ?    | Histórico de versões          | ✅ ATIVA | Manter       |
| `DOCKER_SETUP.md`          | ?    | Setup Docker detalhado        | ✅ ATIVA | Manter       |
| `CHROME_EXTERNAL_SETUP.md` | ?    | Setup Chrome remote debugging | ✅ ATIVA | Manter       |
| `SECURITY_SCAN_POLICY.md`  | ?    | Política de segurança         | ✅ ATIVA | Manter       |

#### Documentação de Trabalho (Mantém ou Move)

| Arquivo                              | LOC | Propósito                      | Status      | Recomendação                       |
| ------------------------------------ | --- | ------------------------------ | ----------- | ---------------------------------- |
| `DOCUMENTACAO_AUDITORIA_COMPLETA.md` | 536 | Auditoria de 99 .md files      | 🔄 TRABALHO | Mover → `DOCUMENTAÇÃO/AUDITORIAS/` |
| `MINI_AUDITORIAS_SUBSISTEMAS.md`     | ?   | Template para 8 auditorias     | 🔄 TRABALHO | Mover → `DOCUMENTAÇÃO/AUDITORIAS/` |
| `FASE_ESCLARECIMENTO.md`             | ?   | 14 dúvidas técnicas            | 🔄 TRABALHO | Mover → `DOCUMENTAÇÃO/AUDITORIAS/` |
| `CONSTANTS_INVENTORY.md`             | ?   | Inventário de constantes       | 🔄 TRABALHO | Mover → `DOCUMENTAÇÃO/TECHNICAL/`  |
| `TESTS_*.md` (4 files)               | ?   | Estratégia/cobertura de testes | 🔄 TRABALHO | Mover → `DOCUMENTAÇÃO/TESTING/`    |
| `TYPES_ARCHITECTURE.md`              | ?   | Análise de type safety         | 🔄 TRABALHO | Manter (referência TS migration)   |
| `TYPESCRIPT_MIGRATION_ANALYSIS.md`   | ?   | Plano de migração TS           | 🔄 TRABALHO | Manter (referência TS migration)   |
| `IMPLEMENTATION_PLAN.md`             | ?   | Plano de type safety           | 🔄 TRABALHO | Manter                             |

#### Documentação Obsoleta (Deletar ou Arquivar)

| Arquivo                                  | Razão                          | Recomendação                           |
| ---------------------------------------- | ------------------------------ | -------------------------------------- |
| `FASE1_CONCLUIDA.md`                     | ✅ Fase completada (histórica) | Mover → `analysis/legacy/`             |
| `FASE2_CONCLUIDA.md`                     | ✅ Fase completada (histórica) | Mover → `analysis/legacy/`             |
| `MERGE_UPGRADE_COMPLETE.md`              | ✅ Upgrade completado          | Mover → `analysis/legacy/`             |
| `CONFIGURATION_OPTIMIZATION_COMPLETE.md` | ✅ Otimização completada       | Mover → `analysis/legacy/`             |
| `ESLINT_IMPROVEMENTS_COMPLETE.md`        | ✅ Melhoria completada         | Mover → `analysis/legacy/`             |
| `DOCKERFILE_OPTIMIZATION_REPORT.md`      | ✅ Otimização completada       | Mover → `analysis/legacy/`             |
| `OPTIMIZATION_RECOMMENDATIONS.md`        | ⚠️ Obsoleto (já aplicado?)     | Verificar + mover ou deletar           |
| `OPTIMIZATION_SUMMARY.md`                | ⚠️ Obsoleto (já aplicado?)     | Verificar + mover ou deletar           |
| `TEST_REPORT_FINAL.md`                   | ⚠️ Report antigo?              | Verificar data + mover                 |
| `TESTS_AUDIT_RESULTS.md`                 | ⚠️ Audit antigo?               | Verificar data + mover                 |
| `ANALISE_NERV_ENVELOPE.md`               | ⚠️ Análise pontual             | Mover → `DOCUMENTAÇÃO/TECHNICAL/NERV/` |

**Sumário**:

- ✅ **7 arquivos ativos** (README, CONTRIBUTING, LICENSE, etc.)
- 🔄 **10 arquivos de trabalho** (auditorias, planos - mover para DOCUMENTAÇÃO/)
- ⚠️ **11 arquivos obsoletos** (fases concluídas - mover para analysis/legacy/)

---

### 1.7 Outros Arquivos Root

| Arquivo              | Propósito                            | Status          |
| -------------------- | ------------------------------------ | --------------- |
| `.gitignore`         | Excluir node_modules, logs, etc.     | ✅ ATIVA        |
| `.prettierrc`        | Formatação (single quotes, 4 spaces) | ✅ ATIVA        |
| `.editorconfig`      | Configuração de editor               | ✅ ATIVA        |
| `test_nerv_pulse.js` | Teste pontual NERV                   | ⚠️ TEMPORÁRIO   |
| `test-puppeteer.js`  | Teste de conectividade browser       | ✅ ÚTIL         |
| `colect.py`          | Script Python (?)                    | ❓ DESCONHECIDO |
| `prompts.txt`        | Prompts de exemplo?                  | ❓ DESCONHECIDO |

**Pendências**:

- ❓ **`colect.py`**: Propósito desconhecido (verificar se usado)
- ❓ **`prompts.txt`**: Parece exemplo de prompts (mover para docs se útil)
- ⚠️ **`test_nerv_pulse.js`**: Teste ad-hoc (mover para `tests/` ou deletar)

---

## 🔍 2. ANÁLISE TÉCNICA PROFUNDA

### 2.1 Entry Point Architecture

**Flow**:

```
npm start
  ↓
index.js (proxy - 15 LOC)
  ↓
src/main.js (boot sequence - 200 LOC)
  ↓
[NERV Boot] → [Config Load] → [Infra Init] → [Kernel Start] → [Server Start]
```

**Decisão de Design**: Por que `index.js` proxy?

**Razões Identificadas**:

1. **Compatibilidade package.json**: `"main": "index.js"` é convenção
2. **Docker CMD**: `CMD ["node", "index.js"]` mais óbvio que `src/main.js`
3. **PM2 ecosystem.config.js**: Scripts apontam para `./index.js`
4. **Scripts legacy**: BAT files esperam `index.js` na raiz

**Avaliação**: ✅ **Padrão correto** (similar a `bin/` em CLI tools)

---

### 2.2 Configuração: 5 Arquivos JSON + .env

**Problema Identificado**: Configurações fragmentadas em múltiplos arquivos

| Arquivo               | Tipo de Config        | Reloadable?             | Validação |
| --------------------- | --------------------- | ----------------------- | --------- |
| `config.json`         | Parâmetros do sistema | ✅ Sim (hot-reload)     | Zod       |
| `dynamic_rules.json`  | Selectors DNA         | ✅ Sim (hot-reload)     | Zod       |
| `controle.json`       | Estado PAUSED/RUNNING | ✅ Sim (watch)          | Manual    |
| `fila.json`           | Exemplo (NÃO CONFIG)  | N/A                     | N/A       |
| `ecosystem.config.js` | PM2 apps              | ❌ Não (restart needed) | PM2       |

**Análise**:

- ✅ **Separação de concerns boa**: Sistema (config.json), DNA (dynamic_rules.json), Estado
  (controle.json)
- ✅ **Hot-reload funcional**: File watchers invalidam caches
- ⚠️ **`fila.json` enganosa**: Nome sugere config mas é apenas exemplo
- ❌ **`.env` ausente**: Não há template de variáveis de ambiente

**Recomendações**:

1. Renomear `fila.json` → `fila.example.json`
2. Criar `.env.example` com:

   ```bash
   # Chrome Remote Debugging
   CHROME_WS_ENDPOINT=ws://localhost:9224

   # Server
   PORT=3008
   NODE_ENV=development

   # Logs
   LOG_LEVEL=info

   # PM2
   DAEMON_MODE=false

   # Docker
   TZ=America/Sao_Paulo
   ```

---

### 2.3 Deploy: Multi-Stage Dockerfile Análise

**Dockerfile Produção** (96 linhas):

```dockerfile
# Stage 1: Dependencies (Build Cache Optimized)
FROM node:20-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production --ignore-scripts && npm cache clean --force

# Stage 2: Production Image
FROM node:20-alpine
RUN apk add --no-cache ca-certificates curl dumb-init
WORKDIR /app
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true NODE_ENV=production

COPY --from=deps /app/node_modules ./node_modules
COPY package.json ecosystem.config.js config.json dynamic_rules.json ./
COPY scripts/ public/ src/ ./

RUN mkdir -p fila respostas logs profile \
  && chown -R node:node /app
USER node

VOLUME ["/app/fila", "/app/respostas", "/app/logs", "/app/profile"]
EXPOSE 3008

HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD node scripts/healthcheck.js

ENTRYPOINT ["/usr/bin/dumb-init", "--"]
CMD ["npx", "pm2-runtime", "start", "ecosystem.config.js"]
```

**Otimizações Identificadas**:

1. ✅ **Multi-stage**: Separa deps de runtime (apenas prod deps no final)
2. ✅ **Alpine base**: ~40% menor que Debian slim
3. ✅ **Layer caching**: package.json copiado antes de src/
4. ✅ **Non-root user**: `USER node` (security)
5. ✅ **dumb-init**: Proper signal handling (SIGTERM → graceful shutdown)
6. ✅ **Healthcheck dedicado**: `scripts/healthcheck.js` (não inline node -e)
7. ✅ **Volumes explícitos**: Dados persistentes separados

**Comparação com Dockerfile.dev**:

- Dev: Node:20 full (não Alpine), instala deps incluindo devDependencies
- Dev: Volumes incluem `/app/node_modules` (hot-reload)
- Dev: Expõe porta 9229 (Node inspector)
- Dev: CMD é `npm run dev` (nodemon)

**Avaliação**: ✅ **Dockerfile produção é EXCELLENT** (segue best practices)

---

### 2.4 Docker Compose: 3 Variants Análise

#### Diferenças-chave:

| Feature              | docker-compose.yml               | docker-compose.prod.yml      | docker-compose.linux.yml     |
| -------------------- | -------------------------------- | ---------------------------- | ---------------------------- |
| Volumes              | Bind mounts (`./fila:/app/fila`) | Named volumes (`fila-prod:`) | Named volumes (`fila-data:`) |
| Env vars             | Inline                           | File (`.env`)                | Inline                       |
| host.docker.internal | Assume Docker Desktop            | Assume Docker Desktop        | `extra_hosts: host-gateway`  |
| Image naming         | Default                          | `${VERSION:-latest}` tag     | Default                      |
| Restart policy       | `unless-stopped`                 | `unless-stopped`             | `unless-stopped`             |

**Quando usar cada um**:

- **Base (docker-compose.yml)**: Desenvolvimento local Windows/macOS com Docker Desktop
- **Prod (docker-compose.prod.yml)**: Produção com named volumes + env file + versioning
- **Linux (docker-compose.linux.yml)**: Linux nativo (sem Docker Desktop) - extra_hosts fix

**Gap Identificado**:

- ⚠️ **Falta `docker-compose.dev.yml`**: Deveria usar `Dockerfile.dev` com hot-reload
- Atualmente apenas `docker-compose.yml` existe para dev, mas usa `Dockerfile` (produção)

**Recomendação**: Criar `docker-compose.dev.yml`:

```yaml
services:
  agent:
    build:
      context: .
      dockerfile: Dockerfile.dev
    volumes:
      - ./src:/app/src:ro # Hot-reload source
      - ./config.json:/app/config.json:ro
      - ./dynamic_rules.json:/app/dynamic_rules.json:ro
      - node_modules:/app/node_modules # Isolated deps
```

---

### 2.5 PM2 Ecosystem: 2 Apps Análise

**App 1: agente-gpt** (Maestro - Task Execution Kernel)

```javascript
{
  name: 'agente-gpt',
  script: './index.js',
  node_args: '--expose-gc',           // Manual GC control
  watch: false,                       // Desabilitado (data mutation)
  ignore_watch: ['logs', 'fila', 'respostas', 'tmp', '*.lock'],
  max_memory_restart: '1G',           // Proteção memory leak
  exp_backoff_restart_delay: 100,     // Delay exponencial em crash
  env: { NODE_ENV: 'production', FORCE_COLOR: '1' }
}
```

**App 2: dashboard-web** (Mission Control - API + Socket.io)

```javascript
{
  name: 'dashboard-web',
  script: './src/server/main.js',     // Entry point modular V700
  watch: false,
  env: { PORT: 3008, NODE_ENV: 'production', DAEMON_MODE: 'true' }
}
```

**Decisões de Design**:

1. **`--expose-gc`**: Permite `global.gc()` manual para long-running tasks (evita memory leak)
2. **`watch: false`**: Desabilitado porque fila/logs mutam constantemente (falsos positivos)
3. **`max_memory_restart: 1G`**: Safety net para memory leaks graduais
4. **`exp_backoff_restart_delay`**: Evita restart loop em falhas persistentes

**Logs Separados**:

- `logs/agente-error.log` / `logs/agente-out.log`
- `logs/dashboard-error.log` / `logs/dashboard-out.log`

**Avaliação**: ✅ **Configuração PM2 é ROBUSTA** (considera long-running process issues)

---

### 2.6 package.json: 80+ Scripts Análise

**Problemas Identificados**:

1. ⚠️ **Falta documentação**: 80+ scripts sem README explicando cada um
   - **Solução**: Criar `DOCUMENTAÇÃO/SCRIPTS.md` com tabela completa

2. ⚠️ **Inconsistência naming**: Alguns usam `:` outros não
   - Exemplo: `test:unit` vs `diagnose` (deveria ser `diagnostics:run`?)
   - **Recomendação**: Padronizar `category:action` sempre

3. ⚠️ **Scripts obsoletos**:
   - `test:legacy` → Aponta para `scripts/run-tests.js` (antigo)
   - `test:win`, `test:linux` → Apontam para BAT/SH com bugs
   - **Recomendação**: Remover ou marcar como deprecated

4. ⚠️ **Falta scripts úteis**:
   - Não há `db:migrate`, `db:seed` (se houver DB no futuro)
   - Não há `preview:build` (testar Dockerfile local)
   - **Recomendação**: Considerar adicionar se útil

**Scripts Mais Usados** (inferidos):

```bash
npm start            # Produção
npm run dev          # Desenvolvimento (nodemon)
npm run daemon:start # PM2 daemon
npm test             # Testes
npm run lint:fix     # Fix ESLint
npm run queue:status # Monitor fila
npm run diagnose     # Diagnosticar problemas
npm run clean        # Limpeza
```

---

## 🐛 3. BUGS & GAPS ENCONTRADOS

### 3.1 Bugs Críticos (P1)

**Nenhum P1 encontrado** ✅

### 3.2 Bugs Médios (P2)

#### Bug #1: `INICIAR_TUDO.BAT` Desatualizado

**Severidade**: P2 (usuários Windows podem falhar no boot)

**Localização**: `INICIAR_TUDO.BAT` linhas 24-25

**Problema**:

```bat
call npx pm2 start server.js --name dashboard-web --no-autorestart
```

**Erro**: `server.js` não existe (renomeado para `src/server/main.js` em V700)

**Correção**:

```bat
call npm run daemon:start
timeout /t 5 >nul
start http://localhost:3008
```

**Impacto**: Usuários Windows que executam este BAT recebem erro
`Error: Cannot find module 'server.js'`

---

#### Bug #2: `rodar_agente.bat` Obsoleto

**Severidade**: P2 (confusão sobre qual script usar)

**Localização**: `rodar_agente.bat` (147 linhas)

**Problema**:

- Implementa watchdog manual para `index.js`
- Conflita com PM2 que já faz watchdog melhor
- Usuários não sabem se devem usar este BAT ou `npm run daemon:start`
- Hardcoded paths Windows (não funciona no Docker)

**Correção**:

1. **Opção A (Deprecar)**: Mover para `scripts/legacy/` com README:

   ```markdown
   # Legacy Windows Launcher

   ⚠️ DEPRECATED - Use `npm run daemon:start` instead
   ```

2. **Opção B (Atualizar)**: Tornar wrapper de PM2 com verificações Windows-specific:

   ```bat
   REM Verificar Chrome
   curl http://localhost:9224/json/version >nul 2>&1
   if errorlevel 1 (
       echo [ERROR] Chrome not running on port 9224
       exit /b 1
   )

   REM Usar PM2
   call npm run daemon:start
   ```

**Recomendação**: **Opção A (Deprecar)** - PM2 é superior, BAT adiciona complexidade

---

### 3.3 Gaps Críticos (P1)

#### Gap #1: `.env.example` Ausente

**Severidade**: P1 (novos usuários não sabem configurar)

**Problema**: Projeto usa variáveis de ambiente mas não documenta quais existem

**Solução**: Criar `.env.example`:

```bash
# =============================================================================
# .env.example - Template de Variáveis de Ambiente
# Copie para .env e ajuste valores
# =============================================================================

# --- Chrome Remote Debugging ---
# URL WebSocket do Chrome (se não usar launcher mode)
CHROME_WS_ENDPOINT=ws://localhost:9224

# Modo de conexão browser (launcher | external | auto)
BROWSER_MODE=launcher

# --- Server ---
# Porta do dashboard web
PORT=3008

# Ambiente (development | production)
NODE_ENV=development

# --- Logging ---
# Nível de log (DEBUG | INFO | WARN | ERROR)
LOG_LEVEL=info

# --- PM2 ---
# Se está rodando via PM2 daemon (true | false)
DAEMON_MODE=false

# --- Docker ---
# Timezone (para logs)
TZ=America/Sao_Paulo
```

---

#### Gap #2: `fila.json` Nome Enganoso

**Severidade**: P2 (confusão sobre se é config ou exemplo)

**Problema**: `fila.json` parece arquivo de configuração mas é apenas exemplo de estrutura

**Solução**: Renomear para `fila.example.json` e adicionar comentário:

```json
{
  "_comment": "EXEMPLO - A fila real fica em fila/*.json (não este arquivo)",
  "fila": [
    {
      "id": "task-001",
      "prompt": "Explique em um parágrafo o que é ontologia negativa.",
      "status": "PENDING",
      "prioridade": 1,
      "criadoEm": "2026-01-12T21:00:00Z",
      "resultado": null
    }
  ]
}
```

---

#### Gap #3: Scripts Sem Documentação

**Severidade**: P2 (onboarding lento)

**Problema**: 80+ scripts em package.json sem documentação central

**Solução**: Criar `DOCUMENTAÇÃO/SCRIPTS.md`:

```markdown
# 📜 NPM Scripts Reference

## 🚀 Execução

| Script  | Comando            | Descrição                         |
| ------- | ------------------ | --------------------------------- |
| `start` | `node index.js`    | Inicia agente em modo produção    |
| `dev`   | `nodemon index.js` | Modo desenvolvimento (hot-reload) |
| ...     | ...                | ...                               |

## 📊 Queue Management

...
```

---

### 3.4 Gaps Médios (P2)

#### Gap #4: `docker-compose.dev.yml` Ausente

**Problema**: Falta docker-compose específico para desenvolvimento com hot-reload

**Solução**: Criar `docker-compose.dev.yml` (já descrito em 2.4)

---

#### Gap #5: Documentação Obsoleta Não Arquivada

**Problema**: 11 arquivos .md obsoletos (FASE1_CONCLUIDA, MERGE_UPGRADE_COMPLETE, etc.) poluem root

**Solução**: Mover para `analysis/legacy/` com README explicando

---

## 🧪 4. TESTES & VALIDAÇÃO

### 4.1 Arquivos com Testes

- ✅ **`test-puppeteer.js`**: Teste de conectividade browser (útil)
- ⚠️ **`test_nerv_pulse.js`**: Teste ad-hoc NERV (temporário)

**Recomendação**:

- Manter `test-puppeteer.js` (útil para diagnóstico)
- Mover `test_nerv_pulse.js` → `tests/manual/` ou deletar se obsoleto

### 4.2 Scripts de Teste

**Cobertura**:

- ✅ Unit tests: `npm run test:unit`
- ✅ Integration tests: `npm run test:integration`
- ✅ E2E tests: `npm run test:e2e`
- ✅ Coverage: `npm run test:coverage`
- ✅ Watch mode: `npm run test:watch`
- ✅ Testes específicos: `test:health`, `test:config`, `test:lock`, `test:stall`

**Avaliação**: ✅ **Cobertura de testes excelente**

---

## 📋 5. APIs & INTERFACES

### 5.1 Entry Point API

**Contrato**:

```javascript
// index.js
require('./src/main'); // Proxy simples
```

**src/main.js** (inferido de ecosystem.config.js):

```javascript
// Boot sequence:
// 1. Load config.json + dynamic_rules.json
// 2. Initialize NERV (event bus)
// 3. Initialize Infra (Browser Pool, Locks, Queue)
// 4. Start Kernel (task execution engine)
// 5. Start Server (dashboard + API)
// 6. Listen for NERV events
```

### 5.2 Configuração API

**config.json** (29 parâmetros validados):

```json
{
  "BROWSER_MODE": "launcher",
  "DEFAULT_MODEL_ID": "gpt-5",
  "CYCLE_DELAY": 2000,
  "TASK_TIMEOUT_MS": 1800000,
  ...
}
```

**dynamic_rules.json** (DNA v5):

```json
{
  "_meta": {
    "version": 5,
    "last_updated": "2026-01-18",
    "evolution_count": 2
  },
  "targets": {
    "chatgpt.com": {
      "input_box": "#prompt-textarea",
      "send_button": "button[data-testid='send-button']"
    }
  },
  "global_selectors": { ... }
}
```

**controle.json** (Estado):

```json
{
  "estado": "PAUSED" // ou "RUNNING"
}
```

### 5.3 Docker API

**Healthcheck Endpoint**:

```javascript
// scripts/healthcheck.js
// Verifica se dashboard responde em http://localhost:3008/api/health
```

**Volumes**:

- `/app/fila` → Task queue (JSON files)
- `/app/respostas` → AI responses (text files)
- `/app/logs` → System logs
- `/app/profile` → Browser profile data

---

## ⚠️ 6. INCONSISTÊNCIAS

### 6.1 Naming Inconsistencies

1. **Scripts**: `test:unit` vs `diagnose` (falta namespace em alguns)
2. **Dockerfiles**: `Dockerfile` vs `Dockerfile.dev` (ok), mas falta `.prod` suffix
3. **Docker Compose**: `.yml` vs `.linux.yml` (inconsistente - deveria ser `.base.yml`, `.prod.yml`,
   `.linux.yml`)

### 6.2 Documentation Scatter

- README em root
- DOCUMENTAÇÃO/ tem subdocs
- 20+ .md files no root (mistura working + obsolete)
- Falta index central linkando tudo

**Recomendação**: Criar `DOCUMENTAÇÃO/INDEX.md` linkando todos docs

---

## 💡 7. RECOMENDAÇÕES

### 7.1 Prioridade P1 (Implementar Imediatamente)

1. ✅ **Criar `.env.example`** com todas env vars documentadas
2. ✅ **Corrigir `INICIAR_TUDO.BAT`** (usa `npm run daemon:start`)
3. ✅ **Renomear `fila.json` → `fila.example.json`** com comentário explicativo
4. ✅ **Criar `DOCUMENTAÇÃO/SCRIPTS.md`** com tabela de 80+ scripts

### 7.2 Prioridade P2 (Próximas 2 Semanas)

5. ✅ **Deprecar `rodar_agente.bat`** (mover para `scripts/legacy/`)
6. ✅ **Mover docs obsoletas** para `analysis/legacy/` (11 arquivos)
7. ✅ **Criar `docker-compose.dev.yml`** com hot-reload
8. ✅ **Criar `DOCUMENTAÇÃO/INDEX.md`** linkando todos docs

### 7.3 Prioridade P3 (Melhorias Futuras)

9. ⚠️ **Padronizar naming** de scripts (sempre `category:action`)
10. ⚠️ **Adicionar `preview:build`** script para testar Dockerfile local
11. ⚠️ **Considerar consolidar** config files (5 JSON + .env é muito?)
12. ⚠️ **Documentar PM2 ecosystem** no README (muitos não sabem o que é)

---

## 📚 8. MATERIAL PARA DOCUMENTAÇÃO CANÔNICA

### 8.1 Conceitos-Chave

1. **Entry Point Proxy Pattern**: Por que `index.js` → `src/main.js`
2. **Multi-Stage Docker Build**: Como otimizar imagem para produção
3. **PM2 Dual Process**: Por que 2 apps separados (agente + dashboard)
4. **Hot-Reload Config**: Como config.json/dynamic_rules.json são reloadable
5. **DNA Evolution**: Como dynamic_rules.json evolui (evolution_count)
6. **Remote Chrome Debugging**: Por que PUPPETEER_SKIP_CHROMIUM_DOWNLOAD

### 8.2 Diagramas Recomendados

1. **Entry Point Flow**: index.js → src/main.js → boot sequence
2. **Config Files Map**: Quais configs, onde ficam, quando reloadam
3. **Docker Architecture**: Multi-stage build + volumes
4. **PM2 Process Tree**: agente-gpt + dashboard-web + restart policies
5. **Deploy Variants**: docker-compose.yml vs .prod.yml vs .linux.yml

### 8.3 Exemplos de Uso

#### Exemplo 1: Setup Inicial

```bash
# 1. Clone
git clone https://github.com/Ilenburg1993/chatgpt-docker-puppeteer.git
cd chatgpt-docker-puppeteer

# 2. Configure
cp .env.example .env
nano .env # Ajuste CHROME_WS_ENDPOINT se necessário

# 3. Instale deps
npm install

# 4. Inicie Chrome
google-chrome --remote-debugging-port=9224 --user-data-dir="~/chrome-automation"

# 5. Inicie agente
npm run daemon:start

# 6. Acesse dashboard
open http://localhost:3008
```

#### Exemplo 2: Deploy Docker Produção

```bash
# 1. Build produção
docker build -t chatgpt-agent:v1.0 .

# 2. Inicie com docker-compose
docker-compose -f docker-compose.prod.yml up -d

# 3. Verifique logs
docker logs -f chatgpt-agent-prod

# 4. Monitore health
curl http://localhost:3008/api/health
```

#### Exemplo 3: Desenvolvimento Local

```bash
# 1. Modo development (nodemon hot-reload)
npm run dev

# 2. OU com Docker
docker-compose -f docker-compose.dev.yml up

# 3. Monitore fila em tempo real
npm run queue:status -- --watch

# 4. Adicione tarefa
echo '{"id":"test-001","prompt":"Test","status":"PENDING"}' > fila/test-001.json
```

#### Exemplo 4: Troubleshooting

```bash
# 1. Verificar conectividade browser
node test-puppeteer.js

# 2. Diagnosticar problemas
npm run diagnose

# 3. Ver logs PM2
npm run daemon:logs

# 4. Verificar health
curl http://localhost:3008/api/health | jq

# 5. Limpar dados corrompidos
npm run clean
npm run daemon:restart
```

#### Exemplo 5: Manutenção

```bash
# 1. Backup dados
npm run backup:data

# 2. Limpar logs antigos
npm run clean:logs

# 3. Verificar integridade queue
npm run queue:status

# 4. Analisar código
npm run analyze:all
npm run analyze:report

# 5. Atualizar dependências
npm outdated
npm update
npm audit fix
```

---

## 🏁 9. CONCLUSÃO

### 9.1 Status Geral

**Root Files**: 🟢 **SAUDÁVEL** com algumas recomendações de limpeza

**Pontos Fortes**:

- ✅ Entry point architecture bem estruturado (proxy pattern)
- ✅ Deploy moderno (multi-stage Docker, 3 compose variants)
- ✅ PM2 configurado robustamente (2 apps, watchdog, memory limits)
- ✅ package.json excelente (80+ scripts cobrindo todas operações)
- ✅ Configuração hot-reload funcional

**Pontos Fracos**:

- ⚠️ 11 arquivos .md obsoletos poluindo root
- ⚠️ 2 BAT scripts desatualizados (bugs P2)
- ⚠️ Falta `.env.example` e documentação de scripts
- ⚠️ Configurações fragmentadas (5 JSON + .env)

### 9.2 Prioridade de Ação

**IMEDIATO** (antes de prosseguir para NERV audit):

1. Criar `.env.example`
2. Corrigir `INICIAR_TUDO.BAT`
3. Renomear `fila.json` → `fila.example.json`
4. Criar `DOCUMENTAÇÃO/SCRIPTS.md`

**PRÓXIMAS 2 SEMANAS**: 5. Mover docs obsoletas para `analysis/legacy/` 6. Deprecar
`rodar_agente.bat` 7. Criar `docker-compose.dev.yml` 8. Criar `DOCUMENTAÇÃO/INDEX.md`

### 9.3 Impacto na Documentação Canônica

**Seções a Criar**:

- `GETTING_STARTED.md` → Usa exemplos de setup deste audit
- `DEPLOYMENT.md` → Documenta Docker + PM2 + docker-compose variants
- `CONFIGURATION.md` → Explica 5 config files + .env + hot-reload
- `SCRIPTS.md` → Tabela de 80+ scripts com descrições

**Material Coletado**:

- 6 conceitos-chave documentados
- 5 diagramas propostos
- 5 exemplos de uso completos (setup, deploy, dev, troubleshoot, maintenance)

### 9.4 Aprovação para Prosseguir

✅ **Root files audit COMPLETO**

**Próximos Passos**:

1. Usuário revisa este audit (00_ROOT_FILES_AUDIT.md)
2. Se aprovado: implementar correções P1 (4 itens - ~30min)
3. Revisar 01_CORE_AUDIT.md se necessário
4. Prosseguir para **02_NERV_AUDIT.md**

---

**Assinatura**: GitHub Copilot (Claude Sonnet 4.5) **Timestamp**: 2026-01-20T15:30:00Z **Audit
Level**: 32 (Root Files Foundation) **Linhas Totais**: ~1000 LOC
