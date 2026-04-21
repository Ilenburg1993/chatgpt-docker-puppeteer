# PARTE-24I — SITUAÇÃO IDEAL: COPILOT COM SERVER DEDICADO E ARQUITETURA ROBUSTA

> **Documento**: PARTE-24I-SITUACAO-IDEAL-COPILOT-SERVER.md **Versão**: 1.0 **Data**: 2026-04-12
> **Escopo**: Proposta de arquitetura ideal para `src/copilot` — server dedicado, socket.io,
> isolamento de terminal, expansibilidade máxima

---

## 0. PREMISSA E PRINCÍPIOS

**Premissa**: `src/copilot` é ferramenta DEV-only. A LLM-B é o par da LLM-A. Quanto mais robusta e
expansível for a infraestrutura do copilot, mais produtivo é o workflow de desenvolvimento.

### Princípios arquiteturais:

1. **Separação clara de camadas**: transporte (HTTP/WS), aplicação (handlers), domínio (hub, agent)
2. **Server dedicado**: `src/copilot/server/` com Express + Socket.IO — independente e robusto
3. **Terminal = UI layer only**: REPL, comandos, display — sem lógica de servidor
4. **Gateway único**: todo acesso externo ao copilot passa pelo `copilot/server/`
5. **Expansível**: pronto para WebRTC, auth, plugins de transporte, múltiplos clientes
6. **Standalone garantido**: funciona completamente sem o server de produção (:3008)
7. **Bootstrap limpo**: 1 arquivo, sem chains, sem modos opcionais

---

## 1. ESTRUTURA IDEAL

```
src/copilot/
│
├── bootstrap.js             ← entry point único (limpo, sem chains)
│
├── server/                  ← INFRAESTRUTURA DE REDE DEDICADA (novo)
│   ├── index.js             ← cria app Express + HTTP server + Socket.IO
│   ├── app.js               ← configura Express (CORS, auth middleware, rate limiters)
│   ├── socket.js            ← inicializa Socket.IO, monta namespaces
│   ├── router.js            ← monta todos os routers (REST + SSE)
│   ├── middleware/
│   │   ├── auth.js          ← token auth middleware
│   │   ├── rate-limiter.js  ← rate limiters (inject, write, sse)
│   │   └── error-handler.js ← error boundary
│   ├── routes/
│   │   ├── health.js        ← /health, /hub-health, /metrics
│   │   ├── agent.js         ← /inject, /pipeline, /dialog, /handoff, /context, /quota
│   │   ├── config.js        ← /config, /config/skills, /config/tools
│   │   ├── memory.js        ← /memory, /sessions, /sessions/:id/turns
│   │   ├── observability.js ← /errors, /tool-stats, /history, /audit
│   │   ├── git.js           ← /git/status, /git/log
│   │   └── github.js        ← /gh/issues, /gh/prs, /gh/ci
│   └── sse/                 ← SSE standalone (mover de api/sse)
│       ├── fanout.js
│       ├── replay-buffer.js
│       └── utils.js
│
├── terminal/                ← UI LAYER ONLY (reduzido)
│   ├── index.js             ← inicializa REPL, wiring de agente, reflection loop
│   ├── repl.js              ← REPL readline
│   ├── dialog.js            ← print helpers
│   ├── di-wiring.js         ← DI wiring para ferramentas do terminal
│   ├── terminal-agent-wiring.js ← event listeners do agente
│   ├── alias-store.js       ← aliases REPL
│   ├── workspace-context.js ← contexto do workspace
│   └── commands/            ← comandos REPL (22 arquivos — permanecem)
│
├── conversation-hub/        ← DOMÍNIO LIMPO (refatorado)
│   ├── hub.js               ← hub sem socket (apenas domínio)
│   ├── store.js             ← SQLite store
│   ├── orchestrator.js      ← lógica de diálogo
│   ├── events.js            ← constantes de eventos
│   └── index.js             ← barrel
│   (socket-ns.js → movido para server/socket.js)
│
├── api/                     ← API SDK do copilot (renomeado para uso real)
│   └── (routers Express do SDK — integrados ao server/router.js)
│
├── agent/         ← sem mudanças estruturais (workers)
├── audit/         ← sem mudanças estruturais
├── bridges/       ← sem mudanças estruturais
├── channel/       ← sem mudanças estruturais
├── config/        ← sem mudanças estruturais
├── core/          ← sem mudanças estruturais
├── db/            ← sem mudanças estruturais
├── events/        ← sem mudanças estruturais
├── hooks/         ← sem mudanças estruturais
├── observability/ ← sem mudanças estruturais
├── plugins/       ← sem mudanças estruturais
├── sdk/           ← sem mudanças estruturais
├── services/      ← sem mudanças estruturais
├── tools/         ← sem mudanças estruturais
└── types/         ← sem mudanças estruturais
```

---

## 2. ARQUITETURA DO copilot/server/

### 2.1 Stack Tecnológica

| Camada         | Tecnologia                              | Justificativa                                        |
| -------------- | --------------------------------------- | ---------------------------------------------------- |
| HTTP Server    | Node.js `http.createServer()`           | Sem deps externas, integra nativamente com Socket.IO |
| REST Framework | Express 4.x                             | Já no projeto, middleware ecosystem maduro           |
| WebSocket      | Socket.IO v4                            | Namespaces, rooms, JWT auth, reconnect automático    |
| SSE            | Implementação nativa (mover de api/sse) | Simples, sem overhead                                |
| Rate Limiting  | In-memory (Redis-ready)                 | Atual funciona; Redis opcional para multi-instância  |
| Auth           | Token via header + JWT (para socket)    | Atual header auth + JWT existente em socket-ns.js    |

### 2.2 Diagrama de Inicialização

```
bootCopilot()
  │
  ├─► bootstrapObservability()
  ├─► bootstrapLateDeps()
  │
  └─► startCopilotServer()           ← NOVO entry point do server
        │
        ├─► createApp()             ← Express app + middleware
        │     ├── cors()
        │     ├── auth middleware
        │     └── rate limiters
        │
        ├─► createHttpServer(app)   ← http.Server
        │
        ├─► createSocketIO(server)  ← Socket.IO Server
        │     ├── namespace /copilot  (ConversationHub)
        │     └── namespace /events  (SSE upgrade para WS)
        │
        ├─► mountRoutes(app)        ← todos os routers REST
        │     ├── /health
        │     ├── /inject
        │     ├── /config
        │     ├── /memory
        │     ├── /sessions
        │     ├── /audit
        │     ├── /git
        │     └── /gh
        │
        ├─► initConversationHub({ io }) ← init com socket! (não mais standalone)
        │
        ├─► startTerminal()         ← REPL + dialog UI
        │
        └─► server.listen(3009)
```

### 2.3 Socket.IO Namespaces

| Namespace  | Propósito                                       | Clientes                               |
| ---------- | ----------------------------------------------- | -------------------------------------- |
| `/copilot` | ConversationHub — sessões, turns, mensagens     | Dashboard, LLM-A, ferramentas externas |
| `/events`  | Stream de eventos copilot (substituição do SSE) | Dashboard, monitores, observadores     |
| `/agent`   | Status do AlwaysAliveAgent — start/stop/estado  | Dashboard                              |

### 2.4 Novos Endpoints REST

Mantém todos os endpoints atuais + adiciona:

| Método | Path                 | Novo?     | Descrição                                 |
| ------ | -------------------- | --------- | ----------------------------------------- |
| GET    | /health              | existente | \_                                        |
| GET    | /ws/info             | **NOVO**  | Info sobre conexões socket ativas         |
| POST   | /sessions/:id/send   | **NOVO**  | Envia mensagem para sessão do hub         |
| GET    | /sessions/:id/status | **NOVO**  | Status da sessão em tempo real            |
| POST   | /agent/start         | **NOVO**  | Inicia AlwaysAliveAgent programaticamente |
| POST   | /agent/stop          | **NOVO**  | Para AlwaysAliveAgent                     |
| GET    | /agent/status        | **NOVO**  | Status detalhado do agente                |
| GET    | /openapi.json        | **NOVO**  | OpenAPI spec do servidor copilot          |
| GET    | /sdk/models          | **NOVO**  | Modelos disponíveis no SDK                |
| POST   | /sdk/complete        | **NOVO**  | Completion direta via SDK                 |

---

## 3. COPILOT SERVER vs TERMINAL: SEPARAÇÃO DEFINITIVA

### Antes (atual):

```
terminal/
├── server.js       ← servidor HTTP
├── route-table.js  ← rotas
├── handlers/       ← handlers HTTP
├── state.js        ← estado HTTP
├── rate-limiter.js ← rate limiting
├── repl.js         ← REPL
└── commands/       ← comandos REPL
```

### Depois (ideal):

```
server/                 ← INFRA DE REDE
├── index.js
├── app.js
├── socket.js
├── router.js
├── middleware/
├── routes/
└── sse/

terminal/               ← UI LAYER
├── index.js            (orquestra apenas REPL + agent wiring)
├── repl.js
├── dialog.js
├── di-wiring.js
├── terminal-agent-wiring.js
├── alias-store.js
├── workspace-context.js
└── commands/
```

**Regra**: `terminal/` **NUNCA** importa de `server/`. O server inicializa o terminal via
callback/event.

---

## 4. CONVERSATION HUB COM SOCKET.IO NATIVO

### Problema atual:

`initStandalone()` omite socket.io → dashboard sem tempo real.

### Solução ideal:

`init({ io })` é a forma padrão de inicialização. O server cria o socket.io e passa para o hub.

```js
// server/index.js
const io = createSocketIO(server);
conversationHub.init({ io }); // hub COM socket.io — COMPLETO

// hub/socket-ns.js → movido para server/socket.js
// - monta namespace /copilot no io
// - JWT auth
// - broadcast de eventos hub
```

Dashboard pode se conectar via `socket.io-client` ou HTTP — ambos funcionam.

---

## 5. BENEFÍCIOS DA ARQUITETURA IDEAL

| Benefício                | Detalhes                                                                      |
| ------------------------ | ----------------------------------------------------------------------------- |
| **Separação limpa**      | server/ cuida de rede, terminal/ cuida de UI                                  |
| **Socket.IO nativo**     | Dashboard em tempo real sem polling                                           |
| **Express robusto**      | Middleware ecosystem, integração fácil com SDK                                |
| **Expansível**           | Adicionar WebRTC, auth OAuth2, plugins de transporte sem tocar no terminal    |
| **Multi-cliente**        | Múltiplos dashboards conectados ao mesmo namespace socket                     |
| **Testável**             | Server isolado = testável com supertest; terminal isolado = testável com mock |
| **Standalone garantido** | copilot/server não importa nada de src/server (produção)                      |
| **API clara**            | /openapi.json — copilot tem spec formal                                       |
| **Agent control**        | /agent/\* — start/stop/status via REST                                        |
| **SDK integrado**        | /sdk/\* — completions diretas, não só via terminal                            |

---

## 6. COMPARAÇÃO ANTES x DEPOIS

| Aspecto            | Atual                                  | Ideal                                       |
| ------------------ | -------------------------------------- | ------------------------------------------- |
| Server HTTP        | `terminal/server.js` (407 LOC, manual) | `server/app.js` + Express                   |
| Socket.IO          | Não inicializado no standalone         | Namespace `/copilot`, `/events`, `/agent`   |
| Rotas              | 38+ rotas em route-table.js            | Express Router por domínio                  |
| Auth               | Token simples em header                | Token + JWT para socket                     |
| Terminal           | UI + server + handlers misturados      | Apenas REPL + comandos                      |
| ConversationHub    | initStandalone (sem socket)            | init({ io }) completo                       |
| `server/`          | 1 arquivo deprecated                   | ~15 arquivos separados por responsabilidade |
| `api/`             | Órfã (era production server adapter)   | Integrada ao server/ ou removida            |
| Score arquitetural | 4.7/10                                 | 8.5/10                                      |

---

## 7. PREPARAÇÃO PARA O FUTURO

O `src/copilot` crescerá. A arquitetura ideal deve suportar:

### Curto prazo (próximas ondas):

- Dashboard UI conectada via socket.io ao copilot server
- Múltiplas abas do dashboard recebendo o mesmo stream
- MCP via socket além de HTTP

### Médio prazo:

- Extensões de navegador se comunicando com copilot server
- LLM-A e LLM-B em máquinas diferentes (dev remoto)
- Plugins de terceiros se registrando via HTTP no copilot server

### Longo prazo:

- Copilot server com autenticação OAuth2 (múltiplos usuários dev)
- Audit e replay de sessões com streaming
- Copilot como MCP server nativo (protocolo MCP via HTTP/WS)

A arquitetura ideal com `server/` dedicado prepara para todos esses cenários sem reescritas.

---

## 8. CHANGELOG

| Versão | Data       | Mudanças                               |
| ------ | ---------- | -------------------------------------- |
| 1.0    | 2026-04-12 | Proposta completa de arquitetura ideal |
