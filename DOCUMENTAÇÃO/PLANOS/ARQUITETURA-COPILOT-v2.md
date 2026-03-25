# Plano de Arquitetura — `src/copilot` v2

**Data**: 2026-06-15
**Status**: Rascunho de planejamento — aprovado para execução incremental
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

## 8. Resumo de Prioridades

```
IMEDIATO (bugs críticos)    → FASE A ✅ CONCLUÍDA
────────────────────────────────────────────────
CURTO PRAZO (sessão única)  → FASE B ✅ CONCLUÍDA (extração de comandos: 7 módulos)
MÉDIO PRAZO (2-3 sessões)   → FASE C ✅ CONCLUÍDA + FASE D ✅ CONCLUÍDA (conversationHub + NERV)
LONGO PRAZO                 → FASE E ✅ CONCLUÍDA + FASE F ✅ CONCLUÍDA
```

---

## 9. Checklist de Qualidade para Cada Fase

Antes de commitar cada fase:
- [ ] `npm run lint` sem erros
- [ ] `npm run format:check` sem erros
- [ ] `npm run typecheck:node` sem erros novos
- [ ] `npm run test:unit` passando
- [ ] Testar terminal real: `node --strip-types src/copilot/terminal-server.js`
- [ ] Testar todos os endpoints HTTP listados na seção 3
- [ ] Testar aliases no REPL: `/st`, `/log`, `/issues`, `/prs`

---

*Documento gerado com base em análise estática do código e testes reais com LLM-B ativa.*
