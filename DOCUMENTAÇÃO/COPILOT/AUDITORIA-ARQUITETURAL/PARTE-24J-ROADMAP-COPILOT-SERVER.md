# PARTE-24J — ROADMAP COMPLETO: COPILOT SERVER DEDICADO E ARQUITETURA ROBUSTA

> **Documento**: PARTE-24J-ROADMAP-COPILOT-SERVER.md **Versão**: 1.0 **Data**: 2026-04-12
> **Escopo**: Roadmap de implementação detalhado para chegar da estrutura atual à arquitetura ideal
> descrita na PARTE-24I

---

## 0. ESTADO DE PARTIDA

**Commit base**: `6a9f366e` — Onda 2.7 (copilot DEV-only, boot único, server desacoplado)

**Diagnóstico completo**: PARTE-24H-DIAGNOSTICO-ESTRUTURA-ATUAL.md

**Situação ideal**: PARTE-24I-SITUACAO-IDEAL-COPILOT-SERVER.md

**Score atual**: 4.7/10 → **Score alvo**: 8.5/10

---

## 1. VISÃO GERAL DAS ONDAS

```
Onda 3.0  — Criação de src/copilot/server/ básico (Express + HTTP)
Onda 3.1  — Migração de rotas terminal → server/routes/
Onda 3.2  — Socket.IO + namespaces (copilot hub com socket nativo)
Onda 3.3  — Terminal cleanup (UI-only — remove server logic)
Onda 3.4  — Conversation Hub refactor (domínio limpo, socket separado)
Onda 3.5  — api/ cleanup + integração de SDK no server
Onda 3.6  — Bootstrap unificado + smoke tests atualizados
Onda 3.7  — Documentação, validação final, score check
```

**Critério de conclusão**: Cada onda é atômica — lint ✅, typecheck ✅, smoke ✅ antes do commit.

---

## 2. ONDA 3.0 — CRIAÇÃO DO SERVER COPILOT BÁSICO

**Objetivo**: Criar `src/copilot/server/` como módulo autônomo com Express + HTTP server. Nesta
onda, o servidor convive com o atual `terminal/server.js` — não substitui ainda.

**Referência**: Resolve P3 (server/ vazia) parcialmente

### L54.1 — Criar `src/copilot/server/app.js`

**O que**: Express app com middleware básico (CORS, JSON, rate-limit global, auth middleware).

```js
// src/copilot/server/app.js
import express from 'express';
import { createAuthMiddleware } from './middleware/auth.js';
import { createRateLimiters } from './middleware/rate-limiter.js';

export function createCopilotApp() {
  const app = express();
  app.use(express.json({ limit: '10mb' }));
  // CORS para dashboard local
  app.use(createCorsMiddleware());
  return { app };
}
```

**Acceptance**: `app.js` exporta `createCopilotApp()` — testável isolado.

### L54.2 — Criar `src/copilot/server/middleware/auth.js`

**O que**: Mover lógica de auth do `terminal/server.js` para middleware Express formal.

```js
// src/copilot/server/middleware/auth.js
export function createAuthMiddleware(token) {
  return (req, res, next) => {
    if (req.path === '/health') return next();
    const provided = req.headers['x-llm-b-token'];
    if (!timingSafeEqual(provided, token)) return res.status(401).json({ error: 'Unauthorized' });
    next();
  };
}
```

**Acceptance**: Middleware reutilizável, testável com mock req/res.

### L54.3 — Criar `src/copilot/server/middleware/rate-limiter.js`

**O que**: Mover os 3 rate limiters do `terminal/server.js` para middleware Express formal.

**Acceptance**: Rate limiters isolados, sem dependência de state global do terminal.

### L54.4 — Criar `src/copilot/server/index.js`

**O que**: Factory function `createCopilotServer()` que cria app + http.Server.

```js
// src/copilot/server/index.js
import http from 'node:http';
import { createCopilotApp } from './app.js';

export async function createCopilotServer() {
  const { app } = createCopilotApp();
  const server = http.createServer(app);
  return { app, server };
}
```

**Acceptance**: `createCopilotServer()` exportado, cria server sem inicializar ainda.

---

## 3. ONDA 3.1 — MIGRAÇÃO DE ROTAS PARA server/routes/

**Objetivo**: Migrar handlers do `terminal/handlers/` para express routers em `server/routes/`.
Nesta onda, as rotas são duplicadas (terminal ainda funciona) — migração incremental.

**Referência**: Resolve P1 (server misturado com terminal) — fase 1

### L55.1 — Criar `src/copilot/server/routes/health.js`

**O que**: Router Express para `/health`, `/hub-health`, `/metrics`.

```js
import { Router } from 'express';
const router = Router();
router.get('/health', handleHealth);
router.get('/hub-health', handleHubHealth);
router.get('/metrics', handleMetrics);
export default router;
```

### L55.2 — Criar `src/copilot/server/routes/agent.js`

**O que**: Router Express para `/inject`, `/pipeline`, `/dialog/pause`, `/dialog/resume`,
`/context`, `/quota`, `/handoff`.

### L55.3 — Criar `src/copilot/server/routes/config.js`

**O que**: Router Express para `/config`, `/config/skills`, `/config/tools`, `/config/tools/custom`,
`/config/infinite-session`.

### L55.4 — Criar `src/copilot/server/routes/memory.js`

**O que**: Router Express para `/memory`, `/sessions`, `/sessions/:id/turns`.

### L55.5 — Criar `src/copilot/server/routes/observability.js`

**O que**: Router Express para `/errors`, `/tool-stats`, `/history`, `/audit`, `/pr-budget`.

### L55.6 — Criar `src/copilot/server/routes/git.js`

**O que**: Router Express para `/git/status`, `/git/log`.

### L55.7 — Criar `src/copilot/server/routes/github.js`

**O que**: Router Express para `/gh/issues`, `/gh/prs`, `/gh/ci`.

### L55.8 — Criar `src/copilot/server/router.js`

**O que**: Monta todos os subrouters no app Express.

```js
// src/copilot/server/router.js
export function mountRoutes(app) {
  app.use('/', healthRouter);
  app.use('/', agentRouter);
  app.use('/', configRouter);
  app.use('/', memoryRouter);
  app.use('/', observabilityRouter);
  app.use('/', gitRouter);
  app.use('/', githubRouter);
}
```

**Acceptance**: Todos os endpoints do terminal estão replicados via Express routers.

---

## 4. ONDA 3.2 — SOCKET.IO + NAMESPACES

**Objetivo**: Adicionar Socket.IO ao copilot server. Inicializar ConversationHub **com** socket.
Esta é a mudança mais impactante — habilita dashboard em tempo real.

**Referência**: Resolve P2 (sem socket.io), P8 (socket-ns misturado com domínio)

### L56.1 — Adicionar `socket.io` como dependência (verificar se já existe)

```bash
# Verificar se já está no package.json (pode já existir para o server de produção)
grep "socket.io" package.json
```

Se não existir:

```bash
npm install socket.io
```

**Nota**: O server de produção (`src/server/`) já usa socket.io — não é nova dep.

### L56.2 — Criar `src/copilot/server/socket.js`

**O que**: Configura Socket.IO server, monta namespace `/copilot` (mover de
`conversation-hub/socket-ns.js`).

```js
// src/copilot/server/socket.js
import { Server as SocketServer } from 'socket.io';

export function createCopilotSocket(httpServer) {
  const io = new SocketServer(httpServer, {
    cors: {
      origin: ['http://localhost:3000', 'http://localhost:5173'],
      methods: ['GET', 'POST'],
    },
    path: '/socket.io',
  });

  // Namespace /copilot — ConversationHub
  const hubNs = io.of('/copilot');
  mountHubNamespace(hubNs);

  // Namespace /events — stream de eventos copilot
  const eventsNs = io.of('/events');
  mountEventsNamespace(eventsNs);

  // Namespace /agent — controle do AlwaysAliveAgent
  const agentNs = io.of('/agent');
  mountAgentNamespace(agentNs);

  return { io, hubNs, eventsNs, agentNs };
}
```

**Acceptance**: Socket.IO server criado com 3 namespaces.

### L56.3 — Mover `conversation-hub/socket-ns.js` para `server/socket/hub-ns.js`

**O que**: Mover o namespace hub (458 LOC) para `server/socket/hub-ns.js`. Manter export compatível
para não quebrar `hub.js`.

**Acceptance**: `conversation-hub/socket-ns.js` mantém re-export; lógica real em `server/socket/`.

### L56.4 — Atualizar `conversation-hub/hub.js`

**O que**: Remover `initStandalone()` como método alternativo. O init padrão agora recebe `io` via
`createCopilotSocket()`. Manter `initStandalone()` como compatibilidade temporária durante
transição.

**Acceptance**: `conversationHub.init({ io })` funções com socket.io real.

### L56.5 — Integrar socket ao `server/index.js`

```js
// src/copilot/server/index.js
export async function createCopilotServer() {
  const { app } = createCopilotApp();
  const server = http.createServer(app);
  const { io } = createCopilotSocket(server);
  conversationHub.init({ io }); // hub com socket!
  mountRoutes(app);
  return { app, server, io };
}
```

---

## 5. ONDA 3.3 — TERMINAL CLEANUP (UI-ONLY)

**Objetivo**: Remover toda lógica de servidor HTTP do `terminal/`. Depois desta onda, `terminal/` é
puramente a camada de UI (REPL, comandos, display).

**Referência**: Resolve P1 (server misturado com terminal) — fase 2 (conclusão)

### L57.1 — Atualizar `terminal/index.js`

**O que**: Substituir `createInjectServer()` por `startCopilotServer()` do novo `server/`. Remover
imports de `server.js`, `route-table.js`, `state.js`, `rate-limiter-state.js`.

**Antes:**

```js
import { createInjectServer } from './server.js';
// ...
const injectServer = createInjectServer();
injectServer.listen(3009);
```

**Depois:**

```js
import { startCopilotServer } from '../server/index.js';
// ...
await startCopilotServer(); // server separado cuida de tudo
```

### L57.2 — Mover `terminal/state.js` para `server/state.js`

**O que**: SSE client state pertence ao servidor, não ao terminal.

### L57.3 — Deprecar `terminal/server.js` e `terminal/route-table.js`

**O que**: Marcar como `@deprecated` com comentário. Estes arquivos serão removidos na Onda 3.7.

### L57.4 — Mover `terminal/handlers/` para `server/handlers/`

**O que**: Handlers HTTP são lógica de servidor, não de terminal.

**Alternativa**: Manter handlers como módulos compartilhados importados pelos routers. Não há
necessidade de duplicar — routers em `server/routes/` podem importar handlers diretamente.

**Decision**: Mover handlers para `server/handlers/` — routers são thin, handlers têm lógica.

---

## 6. ONDA 3.4 — CONVERSATION HUB REFACTOR (DOMÍNIO LIMPO)

**Objetivo**: Tornar o `conversation-hub/` um módulo de domínio puro — sem transporte, sem
socket.io, sem Express. O acoplamento a socket.io fica exclusivamente em `server/socket/`.

**Referência**: Resolve P8 (socket-ns misturado com domínio)

### L58.1 — Verificar dependências do `hub.js` em `socket-ns.js`

**O que**: Mapear quais funções de socket-ns.js são chamadas por hub.js e criar interface limpa.

**Pattern a aplicar**: Dependency Injection — hub.js recebe `socketAdapter` opcional.

### L58.2 — Criar `conversation-hub/socket-adapter.js`

**O que**: Interface para o hub se comunicar com socket sem depender de socket.io diretamente.

```js
// conversation-hub/socket-adapter.js
/**
 * @typedef {Object} SocketAdapter
 * @property {(event: string, data: unknown) => void} broadcast - Envia evento para todos
 * @property {(sessionId: string, event: string, data: unknown) => void} emit - Envia para sessão
 */

export const nullSocketAdapter = {
  broadcast: () => {},
  emit: () => {},
};
```

### L58.3 — Atualizar `hub.js` para usar `SocketAdapter`

**O que**: Remover import direto de `socket-ns.js`. Usar `SocketAdapter` via DI.

```js
class ConversationHub {
  /** @type {import('./socket-adapter.js').SocketAdapter} */
  #socketAdapter = nullSocketAdapter;

  init({ io, socketAdapter }) {
    this.#socketAdapter = socketAdapter ?? createSocketAdapterFromIO(io);
    // ...
  }
}
```

---

## 7. ONDA 3.5 — API/ CLEANUP + SDK NO SERVER

**Objetivo**: Resolver o status de `src/copilot/api/` — parte órfã, parte reutilizável.

**Referência**: Resolve P4 (api/ órfã), P7 (api/ era adapter de production server)

### L59.1 — Auditar cada arquivo em `src/copilot/api/`

**O que**: Classificar: (a) integrar ao novo server/, (b) manter como lib compartilhada, (c)
remover.

**Mapeamento esperado**: | Arquivo | Destino | |---------|---------| | `api/bridge/` | ⚠️ Era bridge
do production server. Avaliar se tem valor standalone. | | `api/express/` | ✅ SDK API router —
integrar em `server/routes/sdk.js` | | `api/sse/fanout.js` | ✅ Mover para `server/sse/fanout.js` |
| `api/sse/replay-buffer.js` | ✅ Mover para `server/sse/replay-buffer.js` | | `api/sse/utils.js` |
✅ Mover para `server/sse/utils.js` | | `api/openapi.json` | ✅ Mover para `server/openapi.json`,
adicionar novos endpoints |

### L59.2 — Criar `server/routes/sdk.js`

**O que**: Integrar SDK API (do `api/express/`) como router Express em `/sdk`.

```
GET  /sdk/models   ← modelos disponíveis
POST /sdk/complete ← completion direta
GET  /sdk/health   ← status do SDK
```

### L59.3 — Criar `server/openapi.json` atualizado

**O que**: OpenAPI spec completo do copilot server — todos os 40+ endpoints + novos.

---

## 8. ONDA 3.6 — BOOTSTRAP UNIFICADO + VALIDAÇÕES

**Objetivo**: Simplificar o bootstrap para 1 path limpo. Remover chain bootstrap →
terminal/bootstrap.

**Referência**: Resolve P5 (bootstrap chain circular)

### L60.1 — Simplificar `bootstrap.js`

**O que**: `bootCopilot()` chama diretamente `startCopilotServer()` do novo server/.

```js
// src/copilot/bootstrap.js
export async function bootCopilot() {
  bootstrapObservability();
  bootstrapLateDeps({ buildTool });
  await startCopilotServer(); // server/ cuida de tudo (terminal incluído)
}
```

### L60.2 — Remover `terminal/bootstrap.js`

**O que**: O `terminal/bootstrap.js` se tornou redundante — o `bootstrap.js` raiz é suficiente.
Manter apenas por backwards compat com PM2 se necessário (como alias vazio).

### L60.3 — Atualizar `check-copilot-autonomy.mjs`

**O que**: Check 5 (modo único) continua válido. Adicionar:

- Check 6: `server/index.js` existe e exporta `startCopilotServer()`
- Check 7: Zero imports de `terminal/server.js` fora de `terminal/` (server movido)
- Check 8: `conversationHub` tem `init({ io })` funcional (não apenas standalone)

### L60.4 — Atualizar `ecosystem.config.cjs`

**O que**: Garantir que o PM2 entry `llm-b-terminal` aponta para `terminal/bootstrap.js` ou
`bootstrap.js` (único point de entrada).

---

## 9. ONDA 3.7 — CLEANUP FINAL + DOCUMENTAÇÃO

**Objetivo**: Remover arquivos deprecated, atualizar documentação, validar score final.

### L61.1 — Remover arquivos deprecated

| Arquivo                                      | Status               | Ação                             |
| -------------------------------------------- | -------------------- | -------------------------------- |
| `src/copilot/server/wiring.js`               | @deprecated Onda 2.7 | Remover                          |
| `src/copilot/terminal/server.js`             | @deprecated Onda 3.3 | Remover                          |
| `src/copilot/terminal/route-table.js`        | @deprecated Onda 3.3 | Remover                          |
| `src/copilot/terminal/rate-limiter-state.js` | @deprecated Onda 3.3 | Remover                          |
| `src/copilot/api/bridge/`                    | Órfão desde Onda 2.7 | Avaliar: remover ou integrar     |
| `src/copilot/conversation-hub/socket-ns.js`  | Movido para server/  | Manter como re-export ou remover |

### L61.2 — Consolidar `logs/` e `infra/`

**Opção A**: Remover pastas vazias. **Opção B**: Preencher com conteúdo: `infra/` = wrappers de FS,
network; `logs/` = log formatters.

### L61.3 — Atualizar `src/copilot/README.md`

**O que**: Documentar a nova estrutura modular com mapa visual atualizado.

### L61.4 — Atualizar `ARCHITECTURE.md` principal

**O que**: Seção copilot — refletir nova arquitetura server dedicado.

---

## 10. TABELA DE PRIORIDADES

| Onda | Prioridade | Dependências | Impacto                  |
| ---- | ---------- | ------------ | ------------------------ |
| 3.0  | 🔴 ALTA    | nenhuma      | Base do server           |
| 3.1  | 🔴 ALTA    | 3.0          | Express routers          |
| 3.2  | 🔴 ALTA    | 3.0          | Socket.IO + dashboard RT |
| 3.3  | 🟠 MÉDIA   | 3.0, 3.1     | Terminal limpo           |
| 3.4  | 🟠 MÉDIA   | 3.2, 3.3     | Hub domínio puro         |
| 3.5  | 🟡 NORMAL  | 3.0, 3.1     | API/ cleanup             |
| 3.6  | 🟡 NORMAL  | 3.0–3.5      | Bootstrap unificado      |
| 3.7  | 🟢 BAIXA   | 3.0–3.6      | Cleanup + docs           |

---

## 11. CRITÉRIOS DE SUCESSO

### Por onda:

- Lint ✅ + Typecheck ✅ + Smoke test ✅ antes de cada commit
- Zero regressões no terminal (boot, inject, SSE)
- ConversationHub funciona em ambos os modos durante transição

### Final (Onda 3.7 completa):

- `src/copilot/server/` tem pelo menos: `index.js`, `app.js`, `socket.js`, `router.js`,
  `middleware/`, `routes/`
- `terminal/` não importa mais de `terminal/server.js` ou `terminal/route-table.js`
- `conversationHub.init({ io })` funciona no boot standalone
- Dashboard pode se conectar via socket.io ao copilot server
- `node scripts/check-copilot-autonomy.mjs` → todos os checks passam
- Score arquitetural ≥ 8.0/10

---

## 12. NOTAS DE IMPLEMENTAÇÃO

### Sobre compatibilidade backward:

- Durante a migração, manter `terminal/server.js` funcionando até Onda 3.3
- Usar feature flags se necessário: `COPILOT_USE_NEW_SERVER=true`
- Socket.IO é aditivo — não quebra SSE existente

### Sobre tamanho dos commits:

- Cada passo (L54.x, L55.x) deve ser um commit atômico
- Usar mensagens `refactor(onda3.X): L5Y.Z — [descrição curta]`
- Push após cada onda completa (não a cada commit)

### Sobre testes:

- `terminal/server.js` tem testes implícitos via `test:integration`
- Verificar quais testes dependem do inject server antes de Onda 3.3
- Criar testes para `server/app.js` que sejam independentes do terminal

---

## 13. PERGUNTAS EM ABERTO

| Questão                                                         | Relevância | Impacto                                      |
| --------------------------------------------------------------- | ---------- | -------------------------------------------- |
| `api/bridge/` tem valor standalone?                             | Médio      | Define se é integrado ao server/ ou removido |
| Terminal deve ter REPL + server no mesmo processo?              | Alto       | Impacta L57.1                                |
| Socket.IO no copilot deve usar porta :3009 ou separada?         | Médio      | Impacta networking do dashboard              |
| `agent.js` @deprecated deve ser removido ou mantido para PM2?   | Baixo      | Cleanup                                      |
| `initStandalone()` deve ser mantido em modo de compatibilidade? | Médio      | Transição suave                              |

---

## 14. CHANGELOG

| Versão | Data       | Mudanças                      |
| ------ | ---------- | ----------------------------- |
| 1.0    | 2026-04-12 | Roadmap completo Onda 3.0–3.7 |
