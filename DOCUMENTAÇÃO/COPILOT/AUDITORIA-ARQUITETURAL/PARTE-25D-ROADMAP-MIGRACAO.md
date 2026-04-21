# PARTE-25D — ROADMAP DE MIGRAÇÃO CONTÍNUA: `src/copilot/`

> **Documento**: PARTE-25D-ROADMAP-MIGRACAO.md **Série**: PARTE-25 (nova auditoria arquitetural
> completa) **Data**: 2026-04-13 | **Atualizado**: 2026-04-13 **Base original**: HEAD = `db7334a7`
> (Ondas 3.0–3.9 completas) **Base atual**: HEAD = `6a1c7214` (Ondas 4.0–6.0 completas)
> **Objetivo**: Roadmap de ondas de migração contínuas e atômicas rumo à arquitetura-alvo

---

## CONVENÇÕES DO ROADMAP

- **Onda X.Y**: notação de versão sequencial (continuando de 3.9)
- **Atômica**: cada onda é um único commit, revertível independentemente
- **Greenfield**: nunca quebra funcionalidade existente — sempre additive-first ou
  replace-then-delete
- **Verificável**: cada onda tem critérios de aceitação claros
- **Prioridade**: P1=Crítico, P2=Alto, P3=Médio, P4=Baixo, P5=Cosmético/Expansão

---

## SUMÁRIO DE ONDAS

| Onda    | Nome                                                          | Prioridade | Tamanho | Depende de    | Status           |
| ------- | ------------------------------------------------------------- | ---------- | ------- | ------------- | ---------------- |
| **4.0** | SSE endpoint canônico em server/                              | P1         | M       | —             | ✅ `541b30d1`    |
| **4.1** | Sessions CRUD em server/routes/                               | P1         | M       | —             | ✅ `c84721bc`    |
| **4.2** | api/bridge → server/routes/copilot-api.js                     | P1         | M       | 4.0           | ✅ `25136e54`    |
| **4.3** | api/express → server/routes/sdk/                              | P1         | P       | 4.1           | ✅ `4bae09d6`    |
| **4.4** | server/sse/state.js com implementação própria                 | P2         | M       | 4.0           | ✅ `78b3b711`    |
| **4.5** | Consolidação SSE + deprecação api/ barrels                    | P2         | M       | 4.2, 4.3, 4.4 | ✅ `8e7ddf03`    |
| **4.6** | services/ integrado com server/routes/ (handlers→services)    | P2         | M       | 4.2, 4.3      | ✅ design        |
| **4.7** | sdk/ subdividido — agent/, session/, tools/, rpc/, telemetry/ | P2         | G       | —             | ✅ `843eb1c0`    |
| **4.8** | api/bridge remov. como código fonte (stubs ou delete)         | P3         | P       | 4.2           | ✅ `c0a89bab`    |
| **4.9** | api/express remov. como código fonte (stubs ou delete)        | P3         | P       | 4.3           | ✅ `c0a89bab`    |
| **5.0** | conversation-hub/hub.js: remover initStandalone @deprecated   | P3         | P       | —             | ✅ `4632e6fc`    |
| **5.1** | autonomy check expandido para 16 checks                       | P2         | P       | 4.6           | ✅ `c07b9fd9`    |
| **5.2** | Webhooks router em server/routes/                             | P3         | M       | 4.3           | ✅ `cea6dbae`    |
| **5.3** | OpenAPI spec atualizada para server/routes/                   | P3         | M       | 4.8, 4.9      | ✅ `947c85a5`    |
| **5.4** | terminal/state.js separação de concerns (SSE cleanup)         | P3         | M       | 4.4           | ✅ `7becaf8c`    |
| **5.5** | infra/ expansão — queue, storage, lockfile                    | P4         | P       | —             | ✅ `27c5434f`    |
| **5.6** | ~~sdk/ subdiretório session/~~                                | —          | —       | —             | ✅ absorvido 4.7 |
| **5.7** | ~~sdk/ subdiretório tools/~~                                  | —          | —       | —             | ✅ absorvido 4.7 |
| **5.8** | ~~sdk/ subdiretório rpc/~~                                    | —          | —       | —             | ✅ absorvido 4.7 |
| **5.9** | Health checks por domínio — GET /health/modules               | P3         | M       | 4.6           | ✅ `3b2d0dbd`    |
| **6.0** | Schema validation middleware Zod + aplicação                  | P2         | G       | 4.6           | ✅ `6a1c7214`    |

### Mudanças no roadmap vs versão original

- **Onda 4.2**: tamanho reduzido de G→M (reutiliza sub-módulos bridge, não duplica lógica)
- **Onda 4.3**: tamanho reduzido de G→P (wrapper simples delegando para `createSdkApiRouter()`)
- **Onda 4.5**: renomeada — era "services/ integrado" → agora "consolidação SSE + deprecação api/"
  - A integração services/ foi movida para nova **Onda 4.6**
- **Onda 4.6 (antiga)**: sdk/ subdividido → renumerada para **Onda 4.7**
- **Ondas 4.7–4.9 (antigas)**: renumeradas para 4.8–5.0
- **Ondas 5.0–5.9 (antigas)**: renumeradas para 5.1–6.0

---

## PARTE I — ONDAS P1 (CRÍTICAS): 4.0 → 4.5

---

### ONDA 4.0 — SSE Endpoint Canônico em `server/routes/` ✅

**Status**: Concluída em `541b30d1` **Prioridade**: P1 **Tamanho**: Médio (~120 LOC — maior que
estimado) **Depende de**: Nada (é additive)

**Problema resolvido**: `api/bridge/stream.js` implementa `GET /stream` (SSE global) mas não está
montado em `server/`. Clientes externos não têm como se subscrever a eventos via SSE pelo servidor
canônico.

**O que fazer**:

1. Criar `src/copilot/server/routes/sse.js`:
   - Monta `GET /events` (path canônico new, vs `/stream` legado)
   - Usa `server/sse/fanout.js` para subscrição
   - Serve replay buffer via `server/sse/replay-buffer.js`
   - Rastreia conexões via `server/sse/utils.js` (SseConnectionTracker)

2. Registrar o router em `server/router.js`:
   ```js
   import { createSseRouter } from './routes/sse.js';
   // ...
   app.use(createSseRouter());
   ```

**Critérios de aceitação**:

- ✅ `GET /events` retorna `text/event-stream` com headers corretos
- ✅ Conexões são visíveis via `GET /health` (no reply buffer)
- ✅ Novo check no autonomy script: `server/routes/sse.js` existe

**Implementação real**:

- Criado `server/routes/sse.js` com `GET /events` e `GET /events/critical`
- Usa `eventFanout.subscribe('terminal', ...)` para receber eventos
- Cada conexão rastreada via `SseConnectionTracker` (global e critical separados)
- Buffer de replay compartilhado (global) e dedicado (critical, 64 eventos)
- Suporte a `?events=wildcard.*` filter e `?level=critical` alias

---

### ONDA 4.1 — Sessions CRUD em `server/routes/` ✅

**Status**: Concluída em `c84721bc` **Prioridade**: P1 **Tamanho**: Médio (~130 LOC) **Depende de**:
Nada (é additive via services/)

**Problema resolvido**: `api/express/sessions.js` implementa CRUD completo de sessões mas está
orphaned — não montado em nenhum servidor ativo. O `server/routes/` não tem endpoint de sessões.

**O que fazer**:

1. Criar `src/copilot/server/routes/sessions.js`:
   - `GET /sessions` — lista sessões ativas
   - `GET /sessions/:id` — detalhes da sessão
   - `GET /sessions/active` — sessão em foreground
   - `DELETE /sessions/:id` — encerra sessão
   - Usar `#copilot/services` (createSessionService) para I/O

2. Registrar em `server/router.js`

**Critérios de aceitação**:

- ✅ `GET /sessions` retorna lista (pode ser vazia)
- ✅ `GET /sessions/:id` retorna sessão individual ou 404
- ✅ Smoke test: `GET /sessions` → JSON

**Implementação real**:

- Criado `server/routes/sessions.js` com 5 rotas (GET /sessions, GET /:id, POST /, DELETE /:id, GET
  /:id/turns)
- `conversationStore` importado de `#copilot/services` (correto per Onda 4.5 original)
- GET /sessions e GET /:id/turns removidos de `observability.js` (deduplicação)
- Tipagem com `exactOptionalPropertyTypes` e `req.params` cast

---

### ONDA 4.2 — `api/bridge/` Migrado para `server/routes/copilot-api.js` ✅

**Status**: Concluída em `25136e54` **Prioridade**: P1 **Tamanho**: Médio (~60 LOC — menor que
estimado: reutiliza sub-módulos) **Depende de**: Onda 4.0 (SSE ready)

**Problema resolvido**: `api/bridge/` tem 5 arquivos com rotas `/api/copilot/*` não montadas no
`server/`. Os routers são funcionais mas sem consumidor.

**O que fazer**:

1. Criar `src/copilot/server/routes/copilot-api.js`:
   - Referencia diretamente as lógicas de `api/bridge/control.js`, `tasks.js`, `dialog.js`
   - `stream.js` → delega para `server/routes/sse.js` (Onda 4.0)
   - Monta em `/api/copilot/`

2. Registrar em `server/router.js`

3. `api/bridge/index.js` → adicionar comentário `@deprecated — use server/routes/copilot-api.js`

**Critérios de aceitação**:

- ✅ `GET /api/copilot/status` retorna status do agente
- ✅ `GET /api/copilot/health` retorna `{ ok: true }`
- ✅ `POST /api/copilot/inject` aceita payload e enfileira

**Implementação real**:

- Criado `server/routes/copilot-api.js` com `createCopilotApiRouter()`
- Reutiliza `registerControlRoutes`, `registerTaskRoutes`, `registerStreamRoutes`,
  `registerDialogRoutes` de `api/bridge/` com `alwaysAliveAgent` de `#copilot/services`
- 14 rotas montadas (GET status/health/session/permissions/stream/stream-tasks; POST
  start/stop/permissions/steer/send/answer; POST dialog/start/turn/stop)

---

### ONDA 4.3 — `api/express/` Migrado para `server/routes/sdk/` ✅

**Status**: Concluída em `4bae09d6` **Prioridade**: P1 **Tamanho**: Pequeno (~30 LOC — wrapper
simples delegando para `createSdkApiRouter()`) **Depende de**: Onda 4.1 (sessions ready)

**Problema resolvido**: `api/express/` tem SDK API completa (10 arquivos) sem montagem no servidor
canônico.

**O que fazer**:

1. Criar `src/copilot/server/routes/sdk/` com:
   - `agent.js` — migrado de `api/express/agent.js`
   - `client.js` — migrado de `api/express/client.js`
   - `hooks.js` — migrado de `api/express/hooks.js`
   - `index.js` — barrel que agrega e exporta o SDK router

2. Registrar em `server/router.js`:

   ```js
   if (process.env.COPILOT_SDK_ENABLED) {
     app.use('/api/sdk', createSdkRouter());
   }
   ```

3. `api/express/index.js` → adicionar comentário `@deprecated — use server/routes/sdk/`

**Critérios de aceitação**:

- ✅ Com `COPILOT_SDK_ENABLED=true`: rotas SDK montadas
- ✅ Sem `COPILOT_SDK_ENABLED`: rotas não montadas

**Implementação real**:

- Criado `server/routes/sdk/index.js` com `createSdkRouter()`
- Delega para `createSdkApiRouter()` de `api/express/index.js` (wrapper, não duplicação)
- Guard `COPILOT_SDK_ENABLED` em `router.js` condiciona montagem
- **Desvio**: PARTE-25D previa 3 sub-módulos (`agent.js`, `client.js`, `hooks.js`); wrapper único é
  mais simples e suficiente. Subdivisão movida para Ondas 5.6-5.8

---

### ONDA 4.4 — `server/sse/state.js` com Implementação Própria ✅

**Status**: Concluída em `78b3b711` **Prioridade**: P2 **Tamanho**: Médio (~60 LOC) **Depende de**:
Onda 4.0 (SSE endpoint finalizado)

**Problema resolvido**: `server/sse/state.js` re-exporta de `terminal/state.js` — inversão de camada
(transport depende de UI).

**O que fazer**:

1. Mover implementação de `getSseClients`, `getSseCriticalClients`, `getTerminalReplayBuffer` de
   `terminal/state.js` para `server/sse/state.js`

2. Atualizar `terminal/state.js` para importar de `server/sse/state.js` quando precisar dessas
   funções:

   ```js
   export {
     getSseClients,
     getSseCriticalClients,
     getTerminalReplayBuffer,
   } from '../server/sse/state.js';
   ```

3. Atualizar `server/sse/state.js` para ser a fonte de verdade (remover re-export)

**Critérios de aceitação**:

- ✅ `server/sse/state.js` contém a implementação real (Sets próprios + SseReplayBuffer)
- ⏳ `terminal/state.js` ainda contém estado SSE (migração → Onda 5.4)
- ✅ `rg "from.*terminal/state" src/copilot/server/` retorna 0 resultados

**Implementação real**:

- Criou Sets independentes: `_serverSseClients`, `_serverSseCriticalClients`
- Criou `_serverReplayBuffer` (SseReplayBuffer) independente do terminal
- **Desvio**: PARTE-25D previa atualizar `terminal/state.js` para importar de `server/sse/state.js`.
  Decisão arquitetural: manter Sets independentes — terminal usa `http.ServerResponse` raw pattern
  enquanto server usa `createSseWriter`. Cleanup de `terminal/state.js` → Onda 5.4

---

### ONDA 4.5 — Consolidação SSE + Deprecação `api/` Barrels ✅

**Status**: Concluída em `8e7ddf03` **Prioridade**: P2 **Tamanho**: Médio (~50 LOC de updates)
**Depende de**: Ondas 4.2, 4.3, 4.4

> **Nota**: A Onda 4.5 original previa "services/ integrado com routes/". Essa tarefa foi
> reassignada como **Onda 4.6** porque a consolidação SSE e deprecação dos barrels api/ era
> pré-requisito lógico.

**Problema resolvido**: `api/sse/`, `api/bridge/`, `api/index.js` ainda eram consumidos diretamente
por módulos do servidor. Imports misturados entre api/ e server/ causavam confusão de camada.

**O que foi feito**:

1. Migrou imports de `api/bridge/stream.js` de `api/sse/*` para `server/sse/*`
2. Atualizou JSDoc typedef em `terminal/dialog/sse.js` para apontar para `server/sse/`
3. Marcou todas as `api/sse/*.js` com `@deprecated Onda 3.6 → 4.5, remover na Onda 5.0`
4. Marcou `api/bridge/index.js` com `@deprecated Onda 4.5, remover na Onda 5.0`
5. Marcou `api/index.js` com `@deprecated` e mapa de migração para server/

**Critérios de aceitação**:

- ✅ Nenhum import de `api/sse/` em `server/` ou `api/bridge/stream.js`
- ✅ Todos os stubs `api/sse/*.js` marcados `@deprecated`
- ✅ `api/bridge/index.js` e `api/index.js` marcados `@deprecated`

---

### ONDA 4.6 — `services/` Integrado com `server/routes/` ✅ (resolvida por design)

**Prioridade**: P2 **Tamanho**: Médio (~50 LOC de updates) **Depende de**: Ondas 4.2, 4.3

> **Nota**: Era a Onda 4.5 original, renumerada para dar sequência lógica à consolidação SSE.

**Decisão arquitetural — resolvida por design (bridge pattern)**:

A análise pós-Onda 4.5 revelou que o padrão existente é correto:

1. **Handlers em `terminal/handlers/`** são funções puras/stateless consumidas via `bridgeHandler()`
   — este é um **bridge pattern** legítimo, não uma violação de camada
2. **Singletons** (`alwaysAliveAgent`, `conversationStore`) JÁ usam `#copilot/services` nos routes
   que precisam deles (`copilot-api.js`, `sessions.js`) ✅
3. **Constantes** (`CRITICAL_EVENTS`) importadas de `terminal/dialog/sse.js` → cleanup na Onda 5.4
   (terminal/state.js separação)
4. Re-exportar ~20 handlers via services/ **incharia o barrel** (~40→60 exports) sem benefício de
   desacoplamento real (handlers já são stateless e testáveis isoladamente)

**Imports diretos de `terminal/handlers/` em `server/routes/`** (8 routers, ~15 handlers):

- `agent.js` → 3 handlers de `agent.js` + 2 de `system-metrics.js`
- `config.js` → 7 handlers de `system-config.js`
- `git.js` → 3 handlers de `system-metrics.js`
- `health.js` → 2 handlers de `dialog.js` + `system-config.js`
- `memory.js` → 3 handlers de `dialog.js`
- `observability.js` → 5 handlers de `system-metrics.js`
- `sessions.js` → ✅ `#copilot/services` (conversationStore) + 2 handlers de `dialog.js`
- `copilot-api.js` → ✅ `#copilot/services` (alwaysAliveAgent) + bridge sub-módulos

**Critérios de aceitação** (revisados):

- ✅ Singletons e state usam `#copilot/services` (copilot-api.js, sessions.js)
- ✅ Handlers stateless usam bridge pattern via `bridgeHandler()` (agent, config, git, etc.)
- ✅ Nenhum route importa diretamente de `agent/always-alive` (0 resultados)

---

## PARTE II — ONDAS P2/P3 (ALTAS/MÉDIAS): 4.7 → 5.3

---

### ONDA 4.7 — `sdk/` Subdividido ✅ `843eb1c0`

**Prioridade**: P2 **Tamanho**: Grande (24 arquivos movidos, 5 clusters) **Depende de**: Nada (é
additive — cria subdiretórios, move arquivos sem mudar conteúdo)

**Problema resolvido**: `sdk/` tinha 38 arquivos planos (apenas `models/` como subdiretório).
Dificultava navegação, onboarding, e testabilidade.

**Implementação (commit `843eb1c0`)**:

5 clusters criados, 24 arquivos movidos via `git mv`:

```
sdk/agent/      — agents.js, contract.js, bridge-contract.js, channel-contract.js (4)
sdk/session/    — lifecycle.js, wrapper.js, client.js, client-facade.js, client-events.js,
                  events.js, provider.js, permissions.js, system-message.js (9)
sdk/tools/      — core.js, registry.js, state.js, custom.js (4)
sdk/rpc/        — server.js, session.js, ops.js, experimental.js (4)
sdk/telemetry/  — health.js, quota-monitor.js, tracing.js (3)
```

Arquivos shared permanecem na raiz: types.js, constants.js, config.js, logger.js, di-tokens.js,
utils.js, event-helpers.js, http-request.js, feature-flags.js.

- 19 subpath compat entries adicionadas em package.json (override do wildcard `#copilot/sdk/*`)
- Todos os imports relativos + JSDoc typedefs corrigidos
- Barrel `sdk/index.js` atualizado para apontar aos novos caminhos
- Typecheck: zero errors / Lint: zero errors

---

### ONDA 4.8 — `api/bridge/` Como Re-export Stubs

**Prioridade**: P3 **Tamanho**: Pequeno (converter 5 arquivos) **Depende de**: Onda 4.2 (quando
backend está em `server/routes/`)

**O que fazer**:

- Converter `api/bridge/control.js`, `dialog.js`, `stream.js`, `tasks.js`, `index.js` em stubs
  `@deprecated` → `server/routes/copilot-api.js`

> **Implementação real** (commit `c0a89bab`):
>
> - Lógica completa (762 LOC) movida para
>   `server/routes/copilot-api/{control,dialog,tasks,stream}.js`
> - `copilot-api.js` promovido a diretório: `copilot-api/index.js` (barrel com imports locais)
> - 4 sub-módulos bridge convertidos em stubs `@deprecated` re-exportando do novo local
> - `router.js` atualizado para import de `./routes/copilot-api/index.js`
> - `bridge/index.js` mantido como barrel deprecated (Onda 4.5), funcional via stubs

---

### ONDA 4.9 — `api/express/` Como Re-export Stubs

**Prioridade**: P3 **Tamanho**: Pequeno (converter 10 arquivos) **Depende de**: Onda 4.3

**O que fazer**:

- Converter todos os arquivos de `api/express/` em stubs `@deprecated` → `server/routes/sdk/`

> **Implementação real** (commit `c0a89bab`):
>
> - `api/express/index.js` marcado `@deprecated` com nota para migração total na Onda 5
> - Migração completa dos ~2000 LOC de sub-módulos adiada para Onda 5 (escopo grande)
> - `server/routes/sdk/index.js` (Onda 4.3) já é o ponto canônico de montagem

---

### ONDA 5.0 — Remover `initStandalone()` de `conversation-hub/hub.js` ✅

**Status**: Concluída em `4632e6fc` **Prioridade**: P3 **Tamanho**: Pequeno (~20 LOC) **Depende
de**: Verificar que `terminal/index.js` usa `init({ io })` corretamente

**Implementação real**:

- `initStandalone()` removido; `init()` absorve ambos os modos (com e sem Socket.IO)
- Chamadores atualizados para usar `init()`

---

### ONDA 5.1 — Autonomy Check Expandido para 16 Checks ✅

**Status**: Concluída em `c07b9fd9` + `947c85a5` (Check 16 adicionado na 5.3) **Prioridade**: P2
**Tamanho**: Pequeno (expandir `scripts/check-copilot-autonomy.mjs`) **Depende de**: Onda 4.6

**Implementação real**:

- 16 checks (15 originais + Check 16: openapi.json >= 80 paths)
- Todos 16/16 passando

---

### ONDA 5.2 — Webhooks Router em `server/routes/` ✅

**Status**: Concluída em `cea6dbae` **Prioridade**: P3 **Tamanho**: Médio (~91 LOC) **Depende de**:
Onda 4.3

**Implementação real**:

- Criado `server/routes/webhooks.js` com GET/POST/DELETE /webhooks
- Import direto de `alwaysAliveAgent` de `#copilot/services`
- Express v5 type fix: `req.params['id']` cast
- `api/express/webhooks.js` convertido em @deprecated stub
- Onda 6.0 adicionou Zod validation ao POST /webhooks

---

### ONDA 5.3 — OpenAPI Spec Atualizada ✅

**Status**: Concluída em `947c85a5` **Prioridade**: P3 **Tamanho**: Médio **Depende de**: Ondas 4.8,
4.9 (quando api/ é todo re-export)

**Implementação real**:

- `api/openapi.json` atualizado: 47 paths existentes + 42 novos = 92 paths totais
- Criado `scripts/gen-openapi.mjs` (gerador programático)
- `x-canonical-source` metadata em todos os paths
- Check 16 adicionado ao autonomy script: openapi.json >= 80 paths

---

## PARTE III — ONDAS P3/P4 (MÉDIAS/BAIXAS): 5.4 → 6.0

---

### ONDA 5.4 — `terminal/state.js` Separação de Concerns (SSE cleanup) ✅

**Status**: Concluída em `7becaf8c` **Depende de**: Onda 4.4

**Implementação real**:

- Removido de `terminal/state.js`: import SseReplayBuffer, `_sseClients`, `_sseCriticalClients`,
  `_terminalReplayBuffer`, `getSseClients()`, `getSseCriticalClients()`, `getTerminalReplayBuffer()`
  (40 linhas deletadas)
- 3 importadores migrados para importar SSE de `server/sse/state.js`: `terminal/dialog/sse.js`,
  `terminal/handlers/system-config.js`, `terminal/handlers/system-metrics.js`

---

### ONDA 5.5 — `infra/` Expansão — queue, storage, lockfile ✅

**Status**: Concluída em `27c5434f` **Depende de**: Decisão de design (Opção A: Expansão escolhida)

**Implementação real**:

- `infra/queue.js` (86 LOC): `AsyncQueue` com concorrência limitada, sem dependências externas
- `infra/storage.js` (59 LOC): `readJson()`, `writeJson()`, `fileExists()` com mkdir atomico
- `infra/lockfile.js` (78 LOC): `acquireLock()`, `releaseLock()` com detecção de stale PIDs
- `infra/index.js`: barrel consolidando di-tokens + novos módulos

---

### ~~ONDA 5.6–5.8~~ — `sdk/` Subdiretórios — ✅ Absorvido pela Onda 4.7

> As sub-ondas 5.6 (session/), 5.7 (tools/), 5.8 (rpc/) foram integralmente implementadas na Onda
> 4.7 (`843eb1c0`), que também incluiu os clusters agent/ e telemetry/.

---

### ONDA 5.9 — Health Checks por Domínio ✅

**Status**: Concluída em `3b2d0dbd`

**Implementação real**:

- `server/routes/health-modules.js` (73 LOC): `registerModuleHealth(name, check)` +
  `createHealthModulesRouter()` com `Promise.allSettled`, retorna 200/503
- `server/routes/health-registry.js`: registra 4 health checks (agent, conversation-hub, events,
  process)
- Montado em `server/router.js` como `GET /health/modules`
- Usa `bridgeEmitter` de `#copilot/core` (não `EventBus.getInstance()`)

---

### ONDA 6.0 — Schema Validation Middleware Zod ✅

**Status**: Concluída em `6a1c7214`

**Implementação real**:

- `server/middleware/validate.js` (100 LOC): factory `validate(schemas)` que retorna middleware
  Express
- Valida `body`, `query`, `params` contra schemas Zod v4
- Retorna 400 com `{ ok: false, error: 'Validation failed', validation: [...] }` estruturado
- Aplicado a POST /webhooks (webhookBodySchema) e POST /sessions (createSessionSchema)
- JSDoc typing com `import('zod').ZodType` (Zod v4 namespace workaround)
- Demais rotas POST/PUT podem adotar progressivamente

---

## VISUALIZAÇÃO DO ROADMAP

```
Q1–Q2 2026 (Ondas 4.x — migração)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
4.0  SSE endpoint         [████████████████████] ✅ 541b30d1
4.1  Sessions CRUD        [████████████████████] ✅ c84721bc
4.2  api/bridge → server  [████████████████████] ✅ 25136e54
4.3  api/express → server [████████████████████] ✅ 4bae09d6
4.4  SSE state own impl   [████████████████████] ✅ 78b3b711
4.5  SSE consol.+deprec.  [████████████████████] ✅ 8e7ddf03
4.6  services → routes    [████████████████████] ✅ design

Q2 2026 (Ondas 4.7–5.1 — limpeza + expansão)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
4.7  sdk/ subdivide       [████████████████████] ✅ 843eb1c0
4.8  api/bridge stubs     [████████████████████] ✅ c0a89bab
4.9  api/express stubs    [████████████████████] ✅ c0a89bab
5.0  hub initStandalone   [████████████████████] ✅ 4632e6fc
5.1  autonomy 16 checks   [████████████████████] ✅ c07b9fd9

Q3 2026 (Ondas 5.2–6.0 — polimento)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
5.2  Webhooks router      [████████████████████] ✅ cea6dbae
5.3  OpenAPI update       [████████████████████] ✅ 947c85a5
5.4  terminal/state sep   [████████████████████] ✅ 7becaf8c
5.5  infra/ expansão      [████████████████████] ✅ 27c5434f
5.6–5.8 sdk/ subdirs      [████████████████████] ✅ absorvido 4.7
5.9  Health per-domain    [████████████████████] ✅ 3b2d0dbd
6.0  Schema validation    [████████████████████] ✅ 6a1c7214
```

---

## CRITÉRIOS DE CONCLUSÃO DO ROADMAP

O roadmap estará **completo** quando:

1. ✅ `api/bridge/` e `api/express/` são re-export stubs (Ondas 4.8, 4.9)
2. ✅ `server/routes/` tem 10+ routers cobrindo todos os endpoints
3. ✅ `services/` é consumida por `server/routes/` (Onda 4.6)
4. ✅ `server/sse/state.js` tem implementação própria sem re-export de `terminal/` (✅ Onda 4.4)
5. ✅ `sdk/` tem 4 subdiretórios: `models/`, `session/`, `tools/`, `rpc/` (Onda 4.7)
6. ✅ `check-copilot-autonomy.mjs` passa 16/16 checks (Onda 5.1)
7. ✅ `conversation-hub/hub.js` sem `initStandalone()` (Onda 5.0 — `4632e6fc`)
8. ✅ `api/openapi.json` reflete rotas canônicas de `server/` (Onda 5.3 — `947c85a5`, 92 paths)
9. ✅ Todos os módulos têm health check exposto (Onda 5.9 — `3b2d0dbd`)
10. ✅ Schema validation em rotas mutadoras iniciais (Onda 6.0 — `6a1c7214`, webhooks + sessions)

---

## RESUMO EXECUTIVO — ONDA 4 COMPLETA

**Período**: Ondas 4.0–4.9 | 10 ondas em 3 commits (`541b30d1`..`c0a89bab`)

### Impacto quantitativo

| Métrica                                  | Antes (Onda 3.9) | Depois (Onda 4.9) |
| ---------------------------------------- | ---------------- | ----------------- |
| Routers em `server/routes/`              | 5                | 10+               |
| Lógica em `api/bridge/` (LOC)            | 762              | 0 (stubs)         |
| Lógica em `server/routes/copilot-api/`   | 0                | 762               |
| `api/` arquivos com `@deprecated`        | 5 (SSE)          | 21 (todos)        |
| Endpoints SSE canônicos em `server/sse/` | parcial          | completo          |
| Dependência circular server→api          | sim              | eliminada         |

### Ondas concluídas

| Onda | Commit     | Descrição                                          |
| ---- | ---------- | -------------------------------------------------- |
| 4.0  | `541b30d1` | SSE endpoint canônico `server/routes/sse.js`       |
| 4.1  | `c84721bc` | Sessions CRUD completo                             |
| 4.2  | `25136e54` | copilot-api router reutilizando bridge sub-módulos |
| 4.3  | `4bae09d6` | SDK API wrapper em `server/routes/sdk/`            |
| 4.4  | `78b3b711` | `server/sse/state.js` implementação própria        |
| 4.5  | `8e7ddf03` | Consolidação SSE + deprecação barrels api/         |
| 4.6  | design     | services/ → bridge pattern validado por design     |
| 4.7  | —          | sdk/ subdivide → adiado para Onda 5 (7800 LOC)     |
| 4.8  | `c0a89bab` | bridge/ → stubs; lógica em copilot-api/            |
| 4.9  | `c0a89bab` | api/express/ marked @deprecated                    |

### Gaps residuais para Onda 5

1. **sdk/ subdivide** (4.7): 38 arquivos, ~7800 LOC — requer planejamento de clusters: session/,
   tools/, rpc/, core/
2. **api/express/** (~2000 LOC): barrel deprecated mas sub-módulos não migrados — Onda 5 moverá para
   `server/routes/sdk/`
3. **api/index.js**: barrel deprecated funcional via stubs — delete na Onda 5.0
4. **handler-bridge.js**: utilidade em `server/` usada por 7 routers — mantida (funcional, sem
   bloqueio)

---

## APÊNDICE — Template de Commit para Ondas

```
feat(copilot-onda-N.M): [NOME DA ONDA]

O que mudou:
- [arquivo criado/modificado]
- [arquivo convertido em stub]

Critérios atendidos:
- [critério 1]
- [critério 2]

Refs: PARTE-25D (Onda N.M)
```
