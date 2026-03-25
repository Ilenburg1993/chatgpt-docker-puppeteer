# Plano de Arquitetura — `src/copilot` v2

**Data**: 2026-06-15 — **Última atualização**: 2026-03-25
**Status**: Fases A–M concluídas — v2.1 alcançada
**Autores**: Análise automática via audit de código + testes reais com LLM-B

---

## 1. Situação Atual — Diagnóstico Completo

### 1.1 Inventário de arquivos (com tamanhos)

```
src/copilot/
├── terminal-server.js           1677 linhas  ← MONÓLITO — problema central
├── always-alive.js               917 linhas  ← AlwaysAliveAgent (bem estruturado)
├── sdk-api.js                    840 linhas  ← Express Router /api/sdk/*
├── gh-bridge.js                  710 linhas  ← Bridge GitHub CLI
├── conversation-hub/store.js     580 linhas  ← SQLite ConversationStore
├── inject-llmb.js                407 linhas  ← HTTP injection API
├── tools/file-tools.js           613 linhas
├── tools/shell-tools.js          406 linhas
├── lib/client.js                 406 linhas  ← Utilitários Copilot Client
├── git-bridge.js                 400 linhas  ← Bridge Git CLI
├── conversation-hub/orchestrator.js 387 linhas ← HubOrchestrator (SUBUTILIZADO)
├── llm-bridge-client.js          371 linhas  ← LlmBridgeClient (singleton)
├── http-bridge.js                339 linhas  ← Express Router /api/copilot/*
├── conversation-hub/socket-ns.js 304 linhas  ← Socket.io namespace (não integrado)
├── tools/hub-tools.js            324 linhas
├── tools/introspection-tools.js  231 linhas
├── tools/hook-tools.js           225 linhas
├── lib/hooks.js                  299 linhas
├── lib/telemetry.js              278 linhas
├── lib/session.js                269 linhas
├── cli-terminal.js               259 linhas  ← Terminal CLI simplificado (duplicação parcial)
├── lib/tools-registry.js         253 linhas
├── config/system-prompt.js       217 linhas
├── conversation-hub/hub.js       213 linhas  ← Socket.io hub (não usado pelo terminal)
├── lib/models.js                 210 linhas
├── lib/permissions.js            206 linhas
├── session-manager.js            199 linhas
├── mcp-tool-bridge.js            194 linhas
├── nerv-bridge.js                183 linhas
├── config/session-config.js      167 linhas
├── tools/task-tools.js           165 linhas
├── lib/agents.js                 164 linhas
├── alias-store.js                163 linhas
├── sdk-client.js                 147 linhas
├── tools/git-tools.js            137 linhas
├── lib/index.js                  132 linhas
├── tools/code-tools.js           126 linhas
├── config/mcp-servers.js          98 linhas
├── tools/session-tools.js         76 linhas
├── agent.js                       71 linhas
└── (tipos, índices, etc.)
```

**Total: ~44 arquivos, ~12.500 linhas**

### 1.2 Problemas Estruturais Identificados

#### Problema P1 — Monólito `terminal-server.js` (1677 linhas)

O arquivo mistura **7 responsabilidades distintas** sem separação de camadas:

| Responsabilidade                                     | Linhas aprox. | Deveria estar em                  |
| ---------------------------------------------------- | ------------- | --------------------------------- |
| HTTP inject server (raw `node:http`)                 | ~400          | `terminal/server.js`              |
| Handlers de endpoints HTTP (health, git, gh, memory) | ~320          | `terminal/http-handlers.js`       |
| REPL readline (stdin/stdout)                         | ~250          | `terminal/repl.js`                |
| Comandos do REPL (14 comandos)                       | ~350          | `terminal/commands/*.js`          |
| Dialog loop (ensureDialogLoop, sendTurn)             | ~100          | `terminal/dialog.js`              |
| Hub session management (boot, retomada)              | ~80           | aproveitando `session-manager.js` |
| SSE event broadcast                                  | ~80           | `terminal/events.js`              |

#### Problema P2 — Dois stacks HTTP paralelos sem unificação

- **Stack A**: `node:http` raw na porta 3009 (`terminal-server.js`) — usado pelo terminal
- **Stack B**: Express Router em `/api/copilot/*` (`http-bridge.js`) — usado pelo servidor principal
- **Stack C**: Express Router em `/api/sdk/*` (`sdk-api.js`) — usado pelo servidor principal

Os stacks A e B têm sobreposição funcional (health, inject, dialog control) sem compartilhar lógica.

#### Problema P3 — `HubOrchestrator` subutilizado

`conversation-hub/orchestrator.js` existe com eventos `turn:sent`, `turn:complete`, `user:injected`,
`session:created` — mas `terminal-server.js` escreve turnos **diretamente** via
`conversationStore.writeTurn()`, ignorando o orchestrator. Os consumidores dessas emissões
(dashboard, NERV) nunca recebem os eventos dos turnos do terminal.

#### Problema P4 — Socket.io hub não integrado ao terminal

`conversation-hub/hub.js` e `socket-ns.js` proveem infraestrutura Socket.io para streaming de
turnos em tempo real — mas `terminal-server.js` usa SSE artesanal (`/events`) em vez de reutilizar
essa infraestrutura.

#### Problema P5 — `cli-terminal.js` duplica parcialmente `terminal-server.js`

Dois terminais REPL existem lado a lado com lógica sobreposta. Não está claro qual é o canônico para
qual cenário.

---

## 2. Bugs Identificados via Auditoria de Código + Testes Reais

| ID        | Severidade | Arquivo                      | Descrição                                                                                                                                                                                                                                       | Status          |
| --------- | ---------- | ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| **BUG-1** | 🔴 CRÍTICO  | `terminal-server.js:43,1390` | `resolve()` do `alias-store` **não era importado nem chamado** na função `rl.on('line')`. Aliases built-in (`/st`, `/log`, `/issues`, `/prs`, `/gst`, etc.) nunca expandiam no REPL — iam direto ao `default:` e exibiam "Comando desconhecido" | ✅ **CORRIGIDO** |
| **BUG-2** | 🟡 MÉDIO    | `terminal-server.js:662`     | `gitStashList` era importado dinamicamente dentro de `cmdGit()` (`const { gitStashList } = await import(...)`) — inconsistente com todos os outros imports estáticos; impacto: overhead de dynamic import em cada chamada                       | ✅ **CORRIGIDO** |
| **BUG-3** | 🟢 BAIXO    | `terminal-server.js:/count`  | `/count` chamava `readTurns(_hubSessionId ?? '', ...)` — se `_hubSessionId` fosse null, passava string vazia silenciosamente retornando 0 turnos sem mensagem de erro                                                                           | ✅ **CORRIGIDO** |
| **GAP-1** | 🏗️ DESIGN   | `terminal-server.js`         | `HubOrchestrator` bypassado — writes diretos ao `conversationStore`                                                                                                                                                                             | Planejado v2.1  |
| **GAP-2** | 🏗️ DESIGN   | Global                       | Dois stacks HTTP paralelos sem camada compartilhada                                                                                                                                                                                             | Planejado v2.1  |
| **GAP-3** | 🏗️ DESIGN   | `terminal-server.js`         | SSE artesanal em vez de reutilizar Socket.io hub                                                                                                                                                                                                | Planejado v2.2  |
| **GAP-4** | 🏗️ DESIGN   | `terminal-server.js`         | 1677 linhas monólito                                                                                                                                                                                                                            | Planejado v2.1  |

---

## 3. Resultados dos Testes Reais com LLM-B

Todos os endpoints foram testados com terminal real (`node --strip-types src/copilot/terminal-server.js`):

| Endpoint              | Método | Resultado  | Observações                                            |
| --------------------- | ------ | ---------- | ------------------------------------------------------ |
| `/health`             | GET    | ✅ HTTP 200 | `dialogLoopActive:true, agentStatus:waiting_for_input` |
| `/git/status`         | GET    | ✅ HTTP 200 | `entries:1`                                            |
| `/git/log?n=3`        | GET    | ✅ HTTP 200 | `commits:3, latest:59c4364`                            |
| `/gh/issues?limit=2`  | GET    | ✅ HTTP 200 | `ok:true, issues:1`                                    |
| `/gh/prs?limit=2`     | GET    | ✅ HTTP 200 | `ok:true, prs:2`                                       |
| `/gh/ci?limit=3`      | GET    | ✅ HTTP 200 | `ok:true, runs:3`                                      |
| `/inject`             | POST   | ✅ HTTP 200 | `duration:4662ms`, LLM-B respondeu corretamente        |
| `/memory`             | POST   | ✅ HTTP 201 | `ok:true, id:badf0393`                                 |
| `/memory?tag=test`    | GET    | ✅ HTTP 200 | `ok:true, count:1`                                     |
| `/memory/:id`         | DELETE | ✅ HTTP 200 | `ok:true`                                              |
| `/sessions`           | GET    | ✅ HTTP 200 | `sessions:3, current:c19f96d0`                         |
| `/sessions/:id/turns` | GET    | ✅ HTTP 200 | `turns:2`                                              |

**100% dos endpoints validados e funcionando corretamente.**

---

## 4. Avaliação: LIB vs API

### Cenário atual
O sistema já é, de facto, uma **biblioteca interna + facade HTTP** dentro do mesmo processo Node.js.
A questão é se a facade HTTP deve ser um microserviço separado ou permanecer integrada.

### Recomendação: **LIB-first com facades HTTP finas — mesmo processo**

**Justificativa:**

| Critério                   | Microserviço separado                         | LIB-first (recomendado)            |
| -------------------------- | --------------------------------------------- | ---------------------------------- |
| Latência de comunicação    | Alta (IPC/HTTP entre processos)               | Zero (chamada de função direta)    |
| Complexidade de deploy     | Alta (2+ processos, health checks, etc.)      | Baixa (1 processo)                 |
| Compartilhamento de estado | Requer serialização                           | Compartilhamento direto de memória |
| SQLite (maestro.sqlite)    | Precisa de acesso compartilhado ou replicação | Acesso direto                      |
| Debugging                  | Mais difícil (spans distribuídos)             | Mais fácil (stack trace único)     |
| Escalabilidade horizontal  | Melhor                                        | Limitada (mas não é requisito)     |

**Conclusão**: Para este projeto, **uma LIB bem modularizada** dentro do mesmo processo é a solução
correta. A facade HTTP (porta 3009 + Express `api/copilot/*`) são simplesmente routers finos sobre
a LIB — não microserviços independentes.

---

## 5. Arquitetura Alvo v2 — Estrutura de Arquivos e Pastas

```
src/copilot/
│
├── ── CAMADA 1: NÚCLEO (core) ─────────────────────────────────────────────────
│
├── core/                              ← NOVO: contratos e tipos centrais
│   ├── types.js                       ← Tipos JSDoc/TS exportados (move de types/)
│   ├── errors.js                      ← Classes de erro específicas do subsistema
│   ├── constants.js                   ← Constantes (portas, limites, nomes)
│   └── index.js
│
├── ── CAMADA 2: AGENTE E SESSÃO ────────────────────────────────────────────────
│
├── agent/                             ← NOVO: extrai de always-alive.js / agent.js
│   ├── always-alive.js                ← AlwaysAliveAgent (move de raiz)
│   ├── entry.js                       ← Entry point PM2 (move de agent.js)
│   ├── session-manager.js             ← (move de raiz)
│   └── index.js
│
├── ── CAMADA 3: CLIENTE SDK ────────────────────────────────────────────────────
│
├── lib/                               ← EXISTENTE — expandir
│   ├── client.js                      ← (existente)
│   ├── models.js                      ← (existente)
│   ├── session.js                     ← (existente)
│   ├── telemetry.js                   ← (existente)
│   ├── tools-registry.js              ← (existente)
│   ├── hooks.js                       ← (existente)
│   ├── agents.js                      ← (existente)
│   ├── permissions.js                 ← (existente)
│   └── index.js                       ← (existente, barrel export)
│
├── ── CAMADA 4: BRIDGE CLIENT ──────────────────────────────────────────────────
│
├── bridge/                            ← NOVO: extrai llm-bridge-client.js
│   ├── llm-bridge-client.js           ← LlmBridgeClient singleton (move de raiz)
│   ├── inject-llmb.js                 ← HTTP injection utils (move de raiz)
│   └── index.js
│
├── ── CAMADA 5: TERMINAL ────────────────────────────────────────────────────────
│
├── terminal/                          ← NOVO: extrai de terminal-server.js (1677L → partes)
│   ├── server.js                      ← HTTP inject server (raw node:http, porta 3009)
│   ├── repl.js                        ← Readline REPL (startRepl, prompt)
│   ├── dialog.js                      ← ensureDialogLoop(), sendTurn(), sendTurnFromHttp()
│   ├── events.js                      ← SSE broadcast + listeners do alwaysAliveAgent
│   ├── session.js                     ← Hub session boot/retomada
│   ├── commands/                      ← Um arquivo por grupo de comandos
│   │   ├── session.js                 ← /status, /history, /db-history, /db-sessions, /who
│   │   │                              │   /count, /clear, /restart, /quit
│   │   ├── memory.js                  ← /remember, /recall, /forget
│   │   ├── gh.js                      ← /gh [subcmd] (cmdGh)
│   │   ├── git.js                     ← /git [subcmd] (cmdGit)
│   │   ├── alias.js                   ← /alias + resolve() wiring no dispatch
│   │   └── help.js                    ← /help
│   └── index.js                       ← startTerminalServer() — coordena server + repl
│
├── ── CAMADA 6: BRIDGES EXTERNOS ────────────────────────────────────────────────
│
├── bridges/                           ← NOVO: agrupa todas as bridges externas
│   ├── gh-bridge.js                   ← (move de raiz)
│   ├── git-bridge.js                  ← (move de raiz)
│   ├── alias-store.js                 ← (move de raiz)
│   ├── nerv-bridge.js                 ← (move de raiz)
│   ├── mcp-tool-bridge.js             ← (move de raiz)
│   └── index.js
│
├── ── CAMADA 7: HUB DE CONVERSAÇÃO ─────────────────────────────────────────────
│
├── conversation-hub/                  ← EXISTENTE — já bem organizado, integrar melhor
│   ├── store.js                       ← (existente — SQLite ConversationStore)
│   ├── orchestrator.js                ← (existente — INTEGRAR com terminal em v2.1)
│   ├── hub.js                         ← (existente — Socket.io hub)
│   ├── socket-ns.js                   ← (existente — Socket.io namespace)
│   └── index.js                       ← (existente)
│
├── ── CAMADA 8: FERRAMENTAS (TOOLS) ─────────────────────────────────────────────
│
├── tools/                             ← EXISTENTE — bem organizado, manter
│   ├── file-tools.js
│   ├── shell-tools.js
│   ├── git-tools.js
│   ├── code-tools.js
│   ├── hook-tools.js
│   ├── hub-tools.js
│   ├── introspection-tools.js
│   ├── session-tools.js
│   ├── task-tools.js
│   └── index.js
│
├── ── CAMADA 9: API HTTP (FACHADA) ──────────────────────────────────────────────
│
├── api/                               ← NOVO: unifica http-bridge.js e sdk-api.js
│   ├── copilot-router.js              ← (move de http-bridge.js) Express /api/copilot/*
│   ├── sdk-router.js                  ← (move de sdk-api.js) Express /api/sdk/*
│   └── index.js                       ← monta os dois routers
│
├── ── CAMADA 10: CONFIGURAÇÃO ────────────────────────────────────────────────────
│
├── config/                            ← EXISTENTE — manter
│   ├── index.js
│   ├── mcp-servers.js
│   ├── session-config.js
│   └── system-prompt.js
│
└── ── ENTRYPOINTS ────────────────────────────────────────────────────────────────
    │
    ├── agent.js                       ← Entry PM2 (wrapper fino sobre agent/entry.js)
    └── (terminal entrypoint via terminal/index.js)
```

### Diagrama de dependências (camadas)

```
                ┌─────────────────────────────────┐
                │           terminal/              │ ← readline, HTTP inject
                │     (commands/, server, repl)    │
                └──────────────┬──────────────────-┘
                               │ usa
        ┌──────────────────────▼─────────────────────────┐
        │           bridge/llm-bridge-client              │ ← dialog turns
        │           bridge/inject-llmb                    │
        └──────────────────────┬──────────────────────────┘
                               │ usa
        ┌──────────────────────▼─────────────────────────┐
        │             agent/always-alive                  │ ← AlwaysAliveAgent
        └──────┬───────────────┬────────────────┬─────────┘
               │               │                │
    ┌──────────▼──┐   ┌────────▼────────┐  ┌────▼──────────────┐
    │    lib/     │   │ conversation-hub │  │  tools/           │
    │  (sdk, ses) │   │  (store, orch)   │  │  (file, shell...) │
    └──────┬──────┘   └─────────────────┘  └───────────────────┘
           │
    ┌──────▼──────┐
    │   core/     │ ← tipos, erros, constantes
    └─────────────┘

    ┌──────────────────────┐
    │   api/ (fachada)     │ ← Express routers finos
    │  copilot + sdk       │   delegam para bridge/agent/hub
    └──────────────────────┘

    ┌──────────────────────┐
    │   bridges/           │ ← gh-bridge, git-bridge, nerv, mcp, alias
    └──────────────────────┘
```

---

## 6. Plano de Execução — Fases Incrementais

### FASE A — Fixes imediatos (CONCLUÍDA)

**Prazo**: imediato (sem refatoração, só bugs)

- [x] **BUG-1**: Adicionar `resolve` ao import de `alias-store.js` + chamar antes do dispatch do REPL
- [x] **BUG-2**: Mover `gitStashList` para imports estáticos em `terminal-server.js`
- [x] **BUG-3**: Guard em `/count` quando `_hubSessionId` é null

### FASE B — Extração de comandos do REPL ✅ CONCLUÍDA

**Prazo**: curto prazo (sessão única)
**Objetivo**: Reduzir `terminal-server.js` de 1677 → ~1016 linhas extraindo comandos.
**Resultado**: 661 linhas de lógica migradas para 7 módulos (`commands/`); 884 linhas de código novo com JSDoc completo.

**Escopo** (todos concluídos):
1. ✅ Criar `src/copilot/terminal/commands/session.js` (status, history, db-history, db-sessions, who, count, clear, answer)
2. ✅ Criar `src/copilot/terminal/commands/memory.js` (remember, recall, forget)
3. ✅ Criar `src/copilot/terminal/commands/gh.js` (move `cmdGh()`)
4. ✅ Criar `src/copilot/terminal/commands/git.js` (move `cmdGit()`)
5. ✅ Criar `src/copilot/terminal/commands/alias.js` (move `cmdAlias()`)
6. ✅ Criar `src/copilot/terminal/commands/help.js` (move `cmdHelp()`)
7. ✅ Criar `src/copilot/terminal/commands/index.js` (barrel re-export)
8. ✅ Adaptar `terminal-server.js` para importar e delegar via ctx pattern

**Padrão ctx adotado**: todas as funções de comando recebem um `ctx` object (`{ println, hubSessionId?, injectPort?, ... }`) — desacopladas do escopo global.

**Benefícios alcançados**:
- Testabilidade individual por comando
- Organização por responsabilidade
- Facilita adicionar novos comandos sem tocar no monólito

### FASE C — Extração do HTTP server e endpoints ✅ CONCLUÍDA

**Objetivo**: Separar HTTP inject server do REPL em módulos coesos dentro de `terminal/`.

**Entregues**:
1. `src/copilot/terminal/state.js` — estado global compartilhado (busy, rl, hubSessionId, sseClients)
2. `src/copilot/terminal/dialog.js` — `ensureDialogLoop()`, `sendTurn()`, `broadcastSse()`, `println()`, `printExchange()`
3. `src/copilot/terminal/server.js` — `createInjectServer()` + todos os endpoints HTTP
4. `src/copilot/terminal/repl.js` — `setupAgentListeners()`, `startRepl()`
5. `src/copilot/terminal/index.js` — `startTerminalServer()` (orquestrador)
6. `terminal-server.js`: 1016 → 39 linhas (wrapper de entrypoint)

**Resultado**: `terminal-server.js` passa de 1677 linhas originais a 39 linhas; todos os módulos passam em `node --check` e `eslint --max-warnings 0`.

### FASE D — Integrar HubOrchestrator ✅ CONCLUÍDA

**Objetivo**: Eliminar GAP-1 fazendo o terminal usar `conversationHub` (singleton) em vez de
`conversationStore` diretamente, e propagar eventos `turn:sent` / `turn:complete` para NERV.

**Entregues**:
1. `terminal/dialog.js`: importa `conversationHub` e `emitNerv`; `sendTurn()` usa `conversationHub.store.writeTurn()` + emite `copilot:turn:sent` e `copilot:turn:complete` via NERV
2. `terminal/index.js`: `startTerminalServer()` usa `conversationHub.store.init()` e `conversationHub.store.createHubSession()`; todos os `writeTurn` de watchdog/fatal migrados para `conversationHub.store.writeTurn()`
3. Todos os arquivos passam em `node --check` e `eslint --max-warnings 0`

### FASE E — Mover arquivos para nova estrutura de pastas ✅ CONCLUÍDA

**Objetivo**: Criar caminhos canônicos conforme layout v2 preservando compatibilidade.

**Estratégia adotada**: Re-exports canônicos (não movimentação física), pois existem
~30 arquivos externos (testes + server) que importam os módulos originais.

**Arquivos criados** (re-exports → originais):
```
bridges/alias-store.js       → ../alias-store.js
bridges/gh-bridge.js         → ../gh-bridge.js
bridges/git-bridge.js        → ../git-bridge.js
bridges/nerv-bridge.js       → ../nerv-bridge.js
bridges/mcp-tool-bridge.js   → ../mcp-tool-bridge.js
bridges/llm-bridge-client.js → ../llm-bridge-client.js
bridges/inject-llmb.js       → ../inject-llmb.js
agent/always-alive.js        → ../always-alive.js
agent/entry.js               → ../agent.js
agent/session-manager.js     → ../session-manager.js
api/copilot-router.js        → ../http-bridge.js
api/sdk-router.js            → ../sdk-api.js
```

**terminal/ atualizado**: imports internos agora usam caminhos canônicos (`bridges/`, `agent/`).
**Compatibilidade**: arquivos originais mantidos; testes e server não foram alterados.

### FASE F — Unificar stacks HTTP ✅ CONCLUÍDA

**Objetivo**: Eliminar GAP-2, fazendo porta 3009 e `/api/copilot/*` compartilhar handlers.

**Abordagem implementada**: Criado `terminal/http-handlers.js` com lógica pura (sem `req`/`res`).
Cada handler recebe parâmetros tipados e retorna `{ status, body, cors? }`.
`terminal/server.js` foi reduzido para wrapper de transporte (leitura de body, escrita HTTP),
delegando toda lógica de negócio para os handlers.

**Benefícios**:
- Lógica de negócio testável sem dependência de `req`/`res`
- `server.js`: 404 → 257 linhas (36% de redução)
- Futura integração com Express router via `api/copilot-router.js` requer apenas adaptação slim
- SSE (`/events`) permanece em `server.js` por necessitar de `req.on('close')` para remoção de clientes

---

### FASE G — Decomposição modular de always-alive.js ✅ CONCLUÍDA (`89a4319c`)

**Objetivo**: Reduzir `always-alive.js` (917 linhas) extraindo responsabilidades auto-contidas.

**Análise de viabilidade**: Campos privados ES2022 (`#campo`) não permitem extração simples de métodos
para fora da classe. A única decomposição viável sem reescrita total é extrair sub-módulos stateful
que recebem/gerenciam seu próprio estado interno, sendo compostos via campo privado na classe principal.

#### G.1 — WebhookManager ✅ (`9eda8c65`)

`agent/webhook-manager.js` com classe `WebhookManager` autônoma.
`AlwaysAliveAgent` substitui `#webhookUrls = new Map()` por `#webhooks = new WebhookManager()`,
delegando `registerWebhook`/`unregisterWebhook`/`listWebhooks`/`#emitWebhook` ao novo módulo.
`always-alive.js`: 917 → 886 linhas.

#### G.2 — AGENT_EVENTS constante exportada ✅

`agent/events.js` exporta constante `AGENT_EVENTS` com os 12+ nomes de evento do agente.
`listenerDiagnostics()` usa essa constante em vez de array inline.

#### G.3 — DialogWatchdog como classe injetada ✅

`agent/dialog-watchdog.js` com classe `DialogWatchdog({ stallMs, intervalMs, onStall })`.
`AlwaysAliveAgent` tem `#watchdog = new DialogWatchdog(...)`.

#### G.4 — bootstrapTools helper ✅

`agent/tools-bootstrap.js` com função pura `bootstrapTools(registry, allToolsList, mcpTools)`.

#### G.5 — executeTask extração do IIFE inline ✅

`agent/task-executor.js` com função `executeTask(session, task, ctx)`.

**Resultado real**:
- `always-alive.js`: 917 → 777 linhas (−140 linhas)
- 5 sub-módulos em `agent/` — todos testáveis de forma isolada
- Commit: `89a4319c`

---

### FASE H — Modularização de sdk-api.js ✅ CONCLUÍDA (`d2148020`)

**Objetivo**: Reduzir `sdk-api.js` (915 linhas) extraindo as rotas em sub-routers por domínio.

**Resultado**:
- `sdk-api.js`: 915 → 34 linhas (orquestrador puro)
- `routes/client.js`: 206 linhas — ping, status, auth, models, tools, client start/stop/force-stop (8 rotas)
- `routes/sessions.js`: 557 linhas — todos os 15 endpoints /sessions/*
- `routes/agent.js`: 197 linhas — /agent/info, tools, telemetry, state, stream SSE (6 rotas)
- `routes/webhooks.js`: 90 linhas — /webhooks CRUD com validação de URL (3 rotas)
- Testes: traversal recursivo do router.stack adaptado para sub-routers aninhados
- Commit: `d2148020`

**GAP cobertos**: SDK auditado (`dd74a835`) — todos os 33 endpoints implementados conforme SDK v0.1.32.
SDK v0.2.0 bloqueado (requer `@github/copilot@^1.0.10` que ainda não foi publicado).

---

## 7. Decisões de Design Registradas

### D1 — Não criar microserviço separado
O subsistema `copilot` permanece no mesmo processo Node.js. A LIB é a fonte da verdade; HTTP é fachada.

### D2 — `cli-terminal.js` é depreciado
`terminal-server.js` (após refatoração) se torna o único terminal REPL canônico. `cli-terminal.js`
será removido na FASE E após migração verificada.

### D3 — Aliases são responsabilidade de `bridges/alias-store.js`
`resolve()` deve sempre ser chamado no dispatch antes de qualquer comando `/`. Nenhuma outra lógica
de comando deve conhecer aliases diretamente.

### D4 — `HubOrchestrator` é o único escritor de turnos
Após FASE D, nenhum código fora de `conversation-hub/orchestrator.js` deve chamar
`conversationStore.writeTurn()` diretamente. A abstração é o Orchestrator.

### D5 — Socket.io hub é opcional
A integração do `terminal-server` com `socket-ns.js` (streaming em tempo real via WS) é desejável
mas não crítica. Implementar apenas se o dashboard precisar de streaming de turnos do terminal.

---

## 8. Resumo de Prioridades — Status atual

```
FASE A  ✅ CONCLUÍDA   Bugs críticos (alias-store, gitStashList, /count guard)
FASE B  ✅ CONCLUÍDA   Extração de comandos para terminal/commands/ (7 módulos)
FASE C  ✅ CONCLUÍDA   HTTP server, dialog, repl, events em terminal/
FASE D  ✅ CONCLUÍDA   Integração HubOrchestrator + NERV
FASE E  ✅ CONCLUÍDA   Re-exports canônicos em bridges/, agent/, api/
FASE F  ✅ CONCLUÍDA   Unificação stacks HTTP (http-handlers.js)
FASE G  ✅ CONCLUÍDA   Modularização always-alive.js → agent/ (5 sub-módulos)
FASE H  ✅ CONCLUÍDA   Modularização sdk-api.js → routes/ (4 sub-routers)
FASE I  ✅ CONCLUÍDA   Localização canônica: agent/ + bridges/ (3fd5a93e, af705488, ae6d1cb3)
────────────────────────────────────────────────────────────────────────────────
FASE J  ✅ CONCLUÍDA   Integrar Socket.io hub no terminal — dual-emit SSE + Socket.io (dialog.js)
FASE K  ✅ CONCLUÍDA   api/ canônica: http-bridge.js e sdk-api.js movidos para api/ (f00e2e8c)
FASE L  ✅ CONCLUÍDA   Remove cli-terminal.js e test_cli_terminal.spec.js (fc7eb58f)
FASE M  ✅ CONCLUÍDA   Criar core/ com constants, errors, types (893a183a)
FASE N  ✅ CONCLUÍDA   Consolidar AGENT_EVENTS — elimina cópia local em http-bridge.js (85148e2e)
FASE O  ✅ CONCLUÍDA   Criar channel/ módulo canônico LLM-A ↔ LLM-B (6964fcc4)
```

---

## 9. Próximas Fases Detalhadas (v2.1 e além)

### FASE I — Consolidar agent/ e bridges/ como localização canônica ✅ CONCLUÍDA (`3fd5a93e`, `af705488`, `ae6d1cb3`)

**Objetivo**: Inverter a direção dos re-exports — arquivos em `agent/` e `bridges/` passam a ter
a implementação real; arquivos na raiz de `src/copilot/` viram thin re-exports de compatibilidade.

**Executado**:

| Arquivo raiz (thin re-export agora) | Canônico (implementação real)         |
| ----------------------------------- | ------------------------------------- |
| `always-alive.js` (11L)             | `agent/always-alive.js` (777L)        |
| `session-manager.js` (12L)          | `agent/session-manager.js` (199L)     |
| `agent.js` (12L)                    | `agent/entry.js` (71L)                |
| `gh-bridge.js` (12L)                | `bridges/gh-bridge.js` (711L)         |
| `git-bridge.js` (12L)               | `bridges/git-bridge.js` (401L)        |
| `alias-store.js` (12L)              | `bridges/alias-store.js` (164L)       |
| `nerv-bridge.js` (12L)              | `bridges/nerv-bridge.js` (183L)       |
| `mcp-tool-bridge.js` (12L)          | `bridges/mcp-tool-bridge.js` (194L)   |
| `llm-bridge-client.js` (12L)        | `bridges/llm-bridge-client.js` (371L) |
| `inject-llmb.js` (12L)              | `bridges/inject-llmb.js` (407L)       |

**Resultado**: 10 arquivos migrados; imports relativos ajustados; testes de source analysis
atualizados para ler arquivos canônicos. 1474 testes passando, 0 falhas.

---

### FASE J — Integrar Socket.io hub (dual-emit) ✅ CONCLUÍDA

**Objetivo**: Fazer `broadcastSse()` em `terminal/dialog.js` emitir **também** via o namespace
`/copilot` do Socket.io, além do SSE raw já existente.

**Executado**:
- `terminal/dialog.js` — adicionado import de `getCopilotNamespace` de `conversation-hub/socket-ns.js`
- `broadcastSse(event, data)` reestruturado:
  - SSE raw continua funcionando (clientes no Set `_sseClients` / `_sseCriticalClients`)
  - Após os loops SSE, `getCopilotNamespace()` é verificado; se não-null: `ns.emit(event, { ...data, hubSessionId })`
  - **No-op seguro quando terminal corre como processo separado** (namespace = null no processo isolado)
- `/events` SSE permanece intacto em `server.js` — nenhuma quebra de compatibilidade
- Dashboard (ou qualquer client Socket.io no `/copilot` namespace) pode subscrever eventos do terminal via WS

**Comportamento em produção (PM2 separado)**: `getCopilotNamespace()` retorna `null` → sem efeito extra; degradação limpa
**Comportamento integrado (mesmo processo)**: namespace montado → emit real via Socket.io

**Risco**: mínimo (SSE permanece primário; socket.io é aditivo)
- 1465 testes passando, lint limpo

---

### FASE K — api/ como localização canônica para http-bridge e sdk-api ✅ CONCLUÍDA (`f00e2e8c`)

**Objetivo**: Inverter a direção dos re-exports de `api/` — `api/http-bridge.js` e `api/sdk-api.js`
passam a ter a implementação real; raízs viram thin re-exports.

**Executado**:
- `src/copilot/http-bridge.js` (339L) → `src/copilot/api/http-bridge.js`; ajuste de `./always-alive.js` → `../always-alive.js`
- `src/copilot/sdk-api.js` (33L) → `src/copilot/api/sdk-api.js`; ajuste de `./routes/` → `../routes/`
- Raízes viraram thin re-exports com `export { default } + export *`
- `api/copilot-router.js` e `api/sdk-router.js` atualizados para `./X` (mesmo dir)
- 3 arquivos de testes: 7 readFile atualizados para `api/` path
- 1465 testes passando, 0 falhas

---

### FASE L — Remover cli-terminal.js ✅ CONCLUÍDA (`fc7eb58f`)

**Objetivo**: Eliminar duplicação com `terminal/`. Decisão D2 já tomada.

**Executado**:
- Removido `src/copilot/cli-terminal.js` (standalone REPL — sem importadores em produção)
- Removido `tests/unit/copilot/test_cli_terminal.spec.js` (9 testes removidos; total: 1465)
- Ecosystem.config.cjs não referenciava o arquivo

---

### FASE M — Criar core/ com contratos centrais ✅ CONCLUÍDA (`893a183a`)

**Objetivo**: Centralizar tipos, erros e constantes em `src/copilot/core/`.

**Executado**:
- `core/constants.js` — `LLM_B_TERMINAL_PORT` (3009), `MAX_QUEUE_SIZE` (100), re-export `AGENT_EVENTS`
- `core/errors.js` — `CopilotError`, `SessionError`, `BridgeError` com `code` semântico
- `core/types.js` — barrel re-exportando `types/index.js` (StructuredMessage)
- `core/index.js` — barrel único
- Aliases `#copilot/core` e `#copilot/core/*` adicionados em `package.json`
- Apenas novos arquivos; nenhuma lógica existente movida

### FASE N — Consolidar AGENT_EVENTS em core/ ✅ CONCLUÍDA (`85148e2e`)

**Objetivo**: Eliminar a cópia local de `AGENT_EVENTS` em `http-bridge.js` (14 eventos, desatualizada) e substituir pelo import do array canônico em `core/` (18 eventos).

**Executado**:
- Remove `const AGENT_EVENTS = [...]` local de `src/copilot/api/http-bridge.js` (14 eventos)
- Adiciona `import { AGENT_EVENTS } from '#copilot/core'` — fonte canônica: `agent/events.js` via `core/constants.js`
- Novos eventos agora disponíveis no SSE `/stream`: `'error'`, `'session.fatal'`, `'dialog.stalled'`
- Atualiza testes de static-inspection (`test_session_manager_streaming.spec.js`, `test_http_bridge_dialog.spec.js`) para ler `agent/events.js` (fonte canônica) em vez de `http-bridge.js`
- 1465 testes unitários, 0 falhas

**Resultado**: `http-bridge.js` é single-source-of-truth-free — toda lista de eventos é governada por `agent/events.js`.

---

### FASE O — Módulo channel/: Camada Dedicada LLM-A ↔ LLM-B ✅ CONCLUÍDA (`6964fcc4`)

**Objetivo**: Criar `src/copilot/channel/` como o módulo canônico para toda comunicação entre
LLM-A (GitHub Copilot — este agente) e LLM-B (Copilot SDK / gpt-4.1). Consolida e organiza
o que estava espalhado entre `bridges/inject-llmb.js` e `bridges/llm-bridge-client.js`.

**Executado**:

| Arquivo novo              | Conteúdo                                                                            |
| ------------------------- | ----------------------------------------------------------------------------------- |
| `channel/inject.js`       | Canônico: HTTP injection ao terminal server (POST /inject, GET /health, SSE, pipeline) |
| `channel/client.js`       | Canônico: LlmBridgeClient (chat, chatStructured, startDialogMode, dialogTurn, etc.) |
| `channel/index.js`        | Barrel: re-exports nomeados + `CHANNEL_VERSION = '1'`                               |

- Alias `#copilot/channel` e `#copilot/channel/*` adicionados em `package.json`
- `bridges/inject-llmb.js` e `bridges/llm-bridge-client.js` → thin re-exports de compat
- Root `inject-llmb.js` e `llm-bridge-client.js` → apontam direto ao `channel/`
- Re-export chain: root → channel/ (todos os consumidores existentes intactos)
- 1465 testes passando, lint limpo

**Impacto futuro** (Sprints planejados):
- **Sprint B** (Session Persistence v2): `channel/history.js` para serializar turnos
- **Sprint C** (Tool Call Auditing): `channel/audit.js` para log JSONL de tool calls
- **Sprint D** (Parallel Queue): `channel/batch.js` para `chatBatch()`
- **Sprint E** (LLM-A Self-Description): `channel/context.js` para introspection

---

### FASE P — Hardening de Erros: CopilotError/SessionError/BridgeError ⏳

**Objetivo**: Substituir `throw new Error(mensagem genérica)` por tipos semânticos de `core/errors.js`
nos módulos principais do copilot — `inject-llmb.js`, `always-alive.js`, `http-bridge.js`, `session-manager.js`.

**Plano**:
- `bridges/inject-llmb.js` (ou `channel/inject.js` após Fase O): substituir todos os `throw new Error` por `throw new BridgeError(msg, code)`
- `agent/always-alive.js`: `SessionError` para falhas de ciclo de vida da sessão
- `api/http-bridge.js`: `BridgeError` para erros de request/response
- `agent/session-manager.js`: `SessionError` nos getters/setters que validam estado
- Regra: cada `catch (err)` deve reemitir como tipo semântico ou logar com `err.code`
- Nenhuma lógica nova — apenas substituição de tipo de erro

---

### FASE Q — Tool Call Auditing: Log JSONL de Tool Calls (Sprint C) ⏳

**Objetivo**: Registrar em `logs/tool-audit.jsonl` cada tool call executado por LLM-B:
`{ ts, sessionId, tool, argsSummary, resultSummary, durationMs, success }`.

**Plano**:
- Criar `channel/audit.js` com função `logToolCall(entry)` → append em `logs/tool-audit.jsonl`
- Hook em `agent/tools-bootstrap.js`: wrapper audit em volta de cada tool registrado
- SSE no `/stream` pode incluir evento `tool.audit` (opt-in via query param)
- Arquivo rotativo: quando > 10MB, rotacionar para `tool-audit.jsonl.1`
- Exportar `getAuditSummary(sessionId)` → últimas N entradas de uma sessão

---

### FASE R — Extrair Rotas http-bridge.js em Sub-Routers ⏳

**Objetivo**: Dividir `api/http-bridge.js` (~320 linhas) em sub-routers focados, como foi feito
com `sdk-api.js` na Fase H.

**Plano**:

| Sub-router novo              | Rotas                                           |
| ---------------------------- | ----------------------------------------------- |
| `api/bridge-stream.js`       | `GET /stream` (SSE endpoint principal)           |
| `api/bridge-dialog.js`       | `POST /dialog/start`, `/dialog/turn`, `/dialog/stop` |
| `api/bridge-tasks.js`        | `POST /task`, `DELETE /task/:id`                 |
| `api/bridge-control.js`      | `GET /status`, `POST /stop`, `POST /restart`     |

- `api/http-bridge.js` vira aggregator (importa e monta sub-routers)
- Cada sub-router tem seus próprios testes de análise estrutural
- Sem quebra de compatibilidade de rotas

---

### FASE S — Session Persistence v2: Histórico nos Retomadas (Sprint B) ⏳

**Objetivo**: Quando LLM-B retoma uma sessão (`AlwaysAliveAgent.start()` com `sessionId` existente),
recebe um resumo estruturado dos últimos N turnos no `systemMessage`, reduzindo repetição de contexto.

**Plano**:
- `channel/history.js`: serializa turnos (LlmBridgeClient.history → resumo compacto)
- `agent/session-manager.js`: salva `history_summary` no arquivo de sessão JSON
- `agent/always-alive.js`: injeta `historySummary` no `systemMessage` quando `continuedSession=true`
- N configurável: `config.session.historyWindowTurns ?? 10`
- Testes: mock de sessão com histórico → verificar que systemMessage inclui resumo

---

### FASE T — Tipar AGENT_EVENTS como Union-Type (satisfies operator) ⏳

**Objetivo**: Usar TypeScript `as const satisfies ReadonlyArray<AgentEvent>` em `agent/events.js`
para que cada uso de string de evento seja verificado em tempo de compilação.

**Plano**:
- `core/types.js`: exportar `AgentEvent = typeof AGENT_EVENTS[number]` (union de strings)
- `agent/events.js`: anotar com `/** @type {ReadonlyArray<import('../core/types.js').AgentEvent>} */`
- NERV/SSE: substituir `string` por `AgentEvent` onde os eventos são emitidos/consumidos
- `npm run typecheck:node` deve capturar qualquer event-name inválido

---

## 10. Checklist de Qualidade para Cada Fase

Antes de commitar cada fase:
- [ ] `npm run lint` sem erros
- [ ] `npm run format:check` sem erros
- [ ] `npm run typecheck:node` sem erros novos
- [ ] `npm run test:unit` passando (1474+ testes)
- [ ] Testar terminal real: `node --strip-types src/copilot/terminal-server.js`
- [ ] Testar todos os endpoints HTTP listados na seção 3
- [ ] Testar aliases no REPL: `/st`, `/log`, `/issues`, `/prs`

---

*Documento gerado com base em análise estática do código e testes reais com LLM-B ativa.*
*Atualizado em 2026-03-25 após conclusão das Fases K, L e M. Arquitetura v2.1 atingida: todas as fases A–M concluídas.*
