# PARTE-25D — ROADMAP DE MIGRAÇÃO CONTÍNUA: `src/copilot/`

> **Documento**: PARTE-25D-ROADMAP-MIGRACAO.md
> **Série**: PARTE-25 (nova auditoria arquitetural completa)
> **Data**: 2026-04-13
> **Base**: HEAD = `db7334a7` (Ondas 3.0–3.9 completas)
> **Objetivo**: Roadmap de ondas de migração contínuas e atômicas rumo à arquitetura-alvo

---

## CONVENÇÕES DO ROADMAP

- **Onda X.Y**: notação de versão sequencial (continuando de 3.9)
- **Atômica**: cada onda é um único commit, revertível independentemente
- **Greenfield**: nunca quebra funcionalidade existente — sempre additive-first ou replace-then-delete
- **Verificável**: cada onda tem critérios de aceitação claros
- **Prioridade**: P1=Crítico, P2=Alto, P3=Médio, P4=Baixo, P5=Cosmético/Expansão

---

## SUMÁRIO DE ONDAS

| Onda | Nome | Prioridade | Tamanho | Depende de |
|------|------|------------|---------|------------|
| **4.0** | SSE endpoint canônico em server/ | P1 | M | — |
| **4.1** | Sessions CRUD em server/routes/ | P1 | M | — |
| **4.2** | api/bridge migrado para server/routes/ | P1 | G | 4.0 |
| **4.3** | api/express migrado para server/routes/ | P1 | G | 4.1 |
| **4.4** | server/sse/state.js com implementação própria | P2 | M | 4.0 |
| **4.5** | services/ integrado com server/routes/ | P2 | M | 4.1, 4.2, 4.3 |
| **4.6** | sdk/ subdividido em session/, tools/, rpc/ | P2 | G | — |
| **4.7** | api/bridge remov. como código fonte (stubs ou delete) | P3 | P | 4.2 |
| **4.8** | api/express remov. como código fonte (stubs ou delete) | P3 | P | 4.3 |
| **4.9** | conversation-hub/hub.js: remover initStandalone @deprecated | P3 | P | — |
| **5.0** | autonomy check expandido para 15 checks | P2 | P | 4.5 |
| **5.1** | Webhooks router em server/routes/ | P3 | M | 4.3 |
| **5.2** | OpenAPI spec atualizada para server/routes/ | P3 | M | 4.7, 4.8 |
| **5.3** | terminal/state.js separação de concerns | P3 | M | 4.4 |
| **5.4** | infra/ expansão ou remoção | P4 | P | — |
| **5.5** | sdk/ subdiretório session/ | P3 | M | 4.6 |
| **5.6** | sdk/ subdiretório tools/ | P3 | M | 4.6 |
| **5.7** | sdk/ subdiretório rpc/ | P3 | M | 4.6 |
| **5.8** | Health checks por domínio | P3 | M | 4.5 |
| **5.9** | Schema validation em server/routes/ inputs | P2 | G | 4.5 |

---

## PARTE I — ONDAS P1 (CRÍTICAS): 4.0 → 4.5

---

### ONDA 4.0 — SSE Endpoint Canônico em `server/routes/`

**Prioridade**: P1  
**Tamanho**: Médio (~60 LOC)  
**Depende de**: Nada (é additive)

**Problema resolvido**:  
`api/bridge/stream.js` implementa `GET /stream` (SSE global) mas não está montado em `server/`. Clientes externos não têm como se subscrever a eventos via SSE pelo servidor canônico.

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
- `GET /events` retorna `text/event-stream` com headers corretos
- Conexões são visíveis via `GET /health` (no reply buffer)
- Novo check no autonomy script: `server/routes/sse.js` existe

---

### ONDA 4.1 — Sessions CRUD em `server/routes/`

**Prioridade**: P1  
**Tamanho**: Médio (~120 LOC)  
**Depende de**: Nada (é additive via services/)

**Problema resolvido**:  
`api/express/sessions.js` implementa CRUD completo de sessões mas está orphaned — não montado em nenhum servidor ativo. O `server/routes/` não tem endpoint de sessões.

**O que fazer**:

1. Criar `src/copilot/server/routes/sessions.js`:
   - `GET /sessions` — lista sessões ativas
   - `GET /sessions/:id` — detalhes da sessão
   - `GET /sessions/active` — sessão em foreground
   - `DELETE /sessions/:id` — encerra sessão
   - Usar `#copilot/services` (createSessionService) para I/O

2. Registrar em `server/router.js`

**Critérios de aceitação**:
- `GET /sessions` retorna lista (pode ser vazia)
- `GET /sessions/active` retorna sessão ativa ou 404
- Smoke test: `GET /sessions` → JSON

---

### ONDA 4.2 — `api/bridge/` Migrado para `server/routes/copilot-api.js`

**Prioridade**: P1  
**Tamanho**: Grande (~150 LOC migrados)  
**Depende de**: Onda 4.0 (SSE ready)

**Problema resolvido**:  
`api/bridge/` tem 5 arquivos com rotas `/api/copilot/*` não montadas no `server/`. Os routers são funcionais mas sem consumidor.

**O que fazer**:

1. Criar `src/copilot/server/routes/copilot-api.js`:
   - Referencia diretamente as lógicas de `api/bridge/control.js`, `tasks.js`, `dialog.js`
   - `stream.js` → delega para `server/routes/sse.js` (Onda 4.0)
   - Monta em `/api/copilot/`

2. Registrar em `server/router.js`

3. `api/bridge/index.js` → adicionar comentário `@deprecated — use server/routes/copilot-api.js`

**Critérios de aceitação**:
- `GET /api/copilot/status` retorna status do agente
- `GET /api/copilot/health` retorna `{ ok: true }`
- `POST /api/copilot/inject` aceita payload e enfileira

---

### ONDA 4.3 — `api/express/` Migrado para `server/routes/sdk/`

**Prioridade**: P1  
**Tamanho**: Grande (~200 LOC migrados)  
**Depende de**: Onda 4.1 (sessions ready)

**Problema resolvido**:  
`api/express/` tem SDK API completa (10 arquivos) sem montagem no servidor canônico.

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
- Com `COPILOT_SDK_ENABLED=true`: `GET /api/sdk/ping` retorna `{ ok: true }`
- Sem `COPILOT_SDK_ENABLED`: rotas não montadas

---

### ONDA 4.4 — `server/sse/state.js` com Implementação Própria

**Prioridade**: P2  
**Tamanho**: Médio (~80 LOC)  
**Depende de**: Onda 4.0 (SSE endpoint finalizado)

**Problema resolvido**:  
`server/sse/state.js` re-exporta de `terminal/state.js` — inversão de camada (transport depende de UI).

**O que fazer**:

1. Mover implementação de `getSseClients`, `getSseCriticalClients`, `getTerminalReplayBuffer` de `terminal/state.js` para `server/sse/state.js`

2. Atualizar `terminal/state.js` para importar de `server/sse/state.js` quando precisar dessas funções:
   ```js
   export { getSseClients, getSseCriticalClients, getTerminalReplayBuffer } from '../server/sse/state.js';
   ```

3. Atualizar `server/sse/state.js` para ser a fonte de verdade (remover re-export)

**Critérios de aceitação**:
- `server/sse/state.js` contém a implementação real
- `terminal/state.js` não contém estado SSE
- `rg "from.*terminal/state" src/copilot/server/` retorna 0 resultados

---

### ONDA 4.5 — `services/` Integrado com `server/routes/`

**Prioridade**: P2  
**Tamanho**: Médio (~50 LOC de updates)  
**Depende de**: Ondas 4.2, 4.3

**Problema resolvido**:  
`server/routes/` acessa domínio diretamente em vez de passar pela camada de serviço. `services/` existe e tem a API correta mas não está no path crítico.

**O que fazer**:

1. Atualizar `server/routes/agent.js` para importar de `#copilot/services`:
   ```js
   import { alwaysAliveAgent } from '#copilot/services';
   ```

2. Atualizar demais routes que acessam domínio diretamente

3. Verificar que nenhum route importa de `agent/` diretamente

**Critérios de aceitação**:
- `rg "from.*agent/always-alive" src/copilot/server/routes/` retorna 0 resultados
- `rg "from '#copilot/services'" src/copilot/server/routes/` retorna ≥1 resultado

---

## PARTE II — ONDAS P2/P3 (ALTAS/MÉDIAS): 4.6 → 5.2

---

### ONDA 4.6 — `sdk/` Subdividido

**Prioridade**: P2  
**Tamanho**: Grande (reorganização de 41 arquivos)  
**Depende de**: Nada (é additive — cria subdiretórios, move arquivos sem mudar conteúdo)

**Problema resolvido**:  
`sdk/` tem 41 arquivos planos (apenas `models/` como subdiretório). Dificulta navegação, onboarding, e testabilidade.

**O que fazer** (em 3 sub-ondas ou juntas):

```
sdk/session/
  session.js, sdk-session-wrapper.js, rpc-session.js

sdk/tools/
  tools.js, tools-registry.js, tools-state.js, custom-tools.js

sdk/rpc/
  rpc.js, rpc-ops.js, server-rpc.js, experimental-rpc.js
```

Para cada arquivo movido:
1. Criar o arquivo no novo local com conteúdo idêntico
2. Converter o arquivo original em re-export stub (compatibilidade)
3. Atualizar `sdk/index.js` para importar do novo local

**Critérios de aceitação**:
- Todos os importadores externos do `sdk/` continuam funcionando
- `npm run typecheck:node` sem novos erros

---

### ONDA 4.7 — `api/bridge/` Como Re-export Stubs

**Prioridade**: P3  
**Tamanho**: Pequeno (converter 5 arquivos)  
**Depende de**: Onda 4.2 (quando backend está em `server/routes/`)

**O que fazer**:
- Converter `api/bridge/control.js`, `dialog.js`, `stream.js`, `tasks.js`, `index.js` em stubs `@deprecated` → `server/routes/copilot-api.js`

---

### ONDA 4.8 — `api/express/` Como Re-export Stubs

**Prioridade**: P3  
**Tamanho**: Pequeno (converter 10 arquivos)  
**Depende de**: Onda 4.3

**O que fazer**:
- Converter todos os arquivos de `api/express/` em stubs `@deprecated` → `server/routes/sdk/`

---

### ONDA 4.9 — Remover `initStandalone()` de `conversation-hub/hub.js`

**Prioridade**: P3  
**Tamanho**: Pequeno (~20 LOC)  
**Depende de**: Verificar que `terminal/index.js` usa `init({ io })` corretamente

**O que fazer**:
1. Verificar que `conversationHub.init({ io })` funciona end-to-end com Socket.IO
2. Remover `initStandalone()` de `hub.js`
3. Atualizar qualquer chamador que ainda usa `initStandalone()`

---

### ONDA 5.0 — Autonomy Check Expandido para 15 Checks

**Prioridade**: P2  
**Tamanho**: Pequeno (expandir `scripts/check-copilot-autonomy.mjs`)  
**Depende de**: Onda 4.5

**O que fazer**:
Adicionar checks 10–15 ao `check-copilot-autonomy.mjs`:
```
Check 10: api/sse/*.js são todos re-export stubs
Check 11: server/routes/ tem ≥ 8 routers (após Ondas 4.0–4.1)
Check 12: Zero require() em src/copilot/
Check 13: Todos os módulos têm index.js
Check 14: services/ tem ao menos 1 importador em server/routes/
Check 15: server/sse/state.js não faz re-export de terminal/state.js
```

---

### ONDA 5.1 — Webhooks Router em `server/routes/`

**Prioridade**: P3  
**Tamanho**: Médio  
**Depende de**: Onda 4.3

**O que fazer**:
1. Criar `server/routes/webhooks.js` com CRUD de webhooks
2. Registrar em `server/router.js`

---

### ONDA 5.2 — OpenAPI Spec Atualizada

**Prioridade**: P3  
**Tamanho**: Médio  
**Depende de**: Ondas 4.7, 4.8 (quando api/ é todo re-export)

**O que fazer**:
1. Atualizar `api/openapi.json` para refletir as rotas canônicas de `server/routes/`
2. Adicionar validação de spec ao `check-copilot-autonomy.mjs`

---

## PARTE III — ONDAS P3/P4 (MÉDIAS/BAIXAS): 5.3 → 5.9

---

### ONDA 5.3 — `terminal/state.js` Separação de Concerns

**Depende de**: Onda 4.4

**O que fazer**:
1. Remover `getSseClients`, `getSseCriticalClients`, `getTerminalReplayBuffer` de `terminal/state.js` (já migrados para `server/sse/state.js` na Onda 4.4)
2. Verificar que todos os importadores de `terminal/state.js` que usavam SSE state agora importam de `server/sse/state.js`

---

### ONDA 5.4 — `infra/` Expansão ou Remoção

**Depende de**: Decisão de design

**Opção A (Expansão)**:
- Adicionar `infra/queue.js` — wrapper de fila (BullMQ ou p-queue)
- Adicionar `infra/storage.js` — wrapper de storage (filesystem abstraction)
- Adicionar `infra/lockfile.js` — lockfile manager

**Opção B (Remoção)**:
- Mover `infra/di-tokens.js` → `core/di-tokens.js`
- Deletar pasta `infra/`

---

### ONDA 5.5–5.7 — `sdk/` Subdiretórios (Sequencial ou Paralelo)

Ver Onda 4.6 — sub-ondas para cada subdiretório:
- **5.5**: `sdk/session/`
- **5.6**: `sdk/tools/`
- **5.7**: `sdk/rpc/`

---

### ONDA 5.8 — Health Checks por Domínio

**O que fazer**:
1. Cada módulo principal expõe `healthCheck()` via seu `index.js`
2. `server/routes/health.js` agrega os health checks de todos os módulos
3. `GET /health` retorna status per-module

---

### ONDA 5.9 — Schema Validation em `server/routes/` Inputs

**O que fazer**:
1. Criar `server/middleware/validate.js` — factory de middleware de validação Zod
2. Aplicar a todas as rotas POST/PUT em `server/routes/`
3. Retornar 400 com erros de validação estruturados

---

## VISUALIZAÇÃO DO ROADMAP

```
Q1 2026
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
4.0  SSE endpoint         [████░░░░░░░░░░░░░░░░]
4.1  Sessions CRUD        [████░░░░░░░░░░░░░░░░]
4.2  api/bridge → server  [════████░░░░░░░░░░░░] (após 4.0)
4.3  api/express → server [════════████░░░░░░░░] (após 4.1)
4.4  SSE state own impl   [════████░░░░░░░░░░░░] (após 4.0)
4.5  services → routes    [════════════████░░░░] (após 4.2+4.3)

Q2 2026
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
4.6  sdk/ subdivide       [████░░░░░░░░░░░░░░░░]
4.7  api/bridge stubs     [════████░░░░░░░░░░░░] (após 4.2)
4.8  api/express stubs    [════████░░░░░░░░░░░░] (após 4.3)
4.9  hub initStandalone   [████░░░░░░░░░░░░░░░░]
5.0  autonomy 15 checks   [════════████░░░░░░░░] (após 4.5)

Q3 2026
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
5.1  Webhooks router      [════████░░░░░░░░░░░░]
5.2  OpenAPI update       [════════████░░░░░░░░] (após stubs)
5.3  terminal/state sep   [════████░░░░░░░░░░░░] (após 4.4)
5.4  infra/ decisão       [████░░░░░░░░░░░░░░░░]
5.5  sdk/session/         [════████░░░░░░░░░░░░]
5.6  sdk/tools/           [════════████░░░░░░░░]
5.7  sdk/rpc/             [════════████░░░░░░░░]
5.8  Health per-domain    [════════════████░░░░]
5.9  Schema validation    [════════════████░░░░]
```

---

## CRITÉRIOS DE CONCLUSÃO DO ROADMAP

O roadmap estará **completo** quando:

1. ✅ `api/bridge/` e `api/express/` são re-export stubs (0 código funcional duplicado)
2. ✅ `server/routes/` tem 9+ routers cobrindo todos os endpoints
3. ✅ `services/` é consumida por `server/routes/`
4. ✅ `server/sse/state.js` tem implementação própria sem re-export de `terminal/`
5. ✅ `sdk/` tem 4 subdiretórios: `models/`, `session/`, `tools/`, `rpc/`
6. ✅ `check-copilot-autonomy.mjs` passa 15/15 checks
7. ✅ `conversation-hub/hub.js` sem `initStandalone()`
8. ✅ `api/openapi.json` reflete rotas canônicas de `server/`
9. ✅ Todos os módulos têm health check exposto
10. ✅ Schema validation em todas as rotas mutadoras

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
