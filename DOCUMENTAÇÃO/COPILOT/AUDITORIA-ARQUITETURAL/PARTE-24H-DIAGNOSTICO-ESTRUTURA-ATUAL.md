# PARTE-24H — DIAGNÓSTICO: ESTRUTURA ATUAL DO src/copilot

> **Documento**: PARTE-24H-DIAGNOSTICO-ESTRUTURA-ATUAL.md
> **Versão**: 1.0
> **Data**: 2026-04-12
> **Escopo**: Análise profunda do estado atual de `src/copilot` — problemas estruturais, mistura de responsabilidades, gaps arquiteturais

---

## 0. CONTEXTO

Após a Onda 2.7 (`6a9f366e`), o `src/copilot` é uma ferramenta DEV-only com boot canônico único:
`terminal:llm-b → bootCopilot() → startTerminalServer()`. O server de produção não tem mais
dependência do copilot.

Este documento cataloga o que existe hoje, identifica os problemas estruturais, e prepara o terreno
para a análise da situação ideal (PARTE-24I) e o roadmap de implementação (PARTE-24J).

---

## 1. MAPA VISUAL DA ESTRUTURA ATUAL

```
src/copilot/
├── bootstrap.js             (entry point delegante — 57 LOC)
├── agent.js                 (@deprecated — alias PM2 — 15 LOC)
│
├── agent/          8.242 LOC / 57 files   ← workers, always-alive, dialog loop
├── api/            3.327 LOC / 21 files   ← Express routers, SSE utils, bridge HTTP
├── audit/            910 LOC /  9 files   ← pipeline-permission, audit log
├── bridges/        2.161 LOC / 13 files   ← MCP, NERV adapter, FS bridge
├── channel/        1.444 LOC /  8 files   ← injeção de canal, cliente de canal
├── config/         1.319 LOC /  7 files   ← env vars, auth, pinned files, skills
├── conversation-hub/ 2.633 LOC / 13 files ← hub, store, orchestrator, socket-ns
├── core/           2.750 LOC / 19 files   ← DI container, tokens, timer, errors
├── db/               437 LOC /  3 files   ← SQLite wrapper
├── events/         2.122 LOC / 18 files   ← schemas, bus, catalog
├── hooks/          3.754 LOC / 20 files   ← factory, bus, session state
├── infra/             50 LOC /  1 file    ← TODO: vazio
├── logs/               0 LOC /  0 files   ← TODO: pasta vazia
├── observability/  5.701 LOC / 32 files   ← metrics, collectors, event-catalog
├── plugins/          280 LOC /  3 files   ← discovery, loader
├── sdk/            7.813 LOC / 41 files   ← types, client, schema, inference
├── server/           110 LOC /  1 file    ← @deprecated wiring.js (orphaned)
├── services/         571 LOC /  6 files   ← facades públicas (barrel)
├── terminal/       7.777 LOC / 49 files   ← REPL, inject server, handlers, commands
├── tools/          6.324 LOC / 28 files   ← shell, web, introspection, todo
└── types/            193 LOC /  2 files   ← tipos globais copilot
```

**Total**: ~58.000 LOC / 353 arquivos

---

## 2. ANATOMIA DO SERVIDOR HTTP ATUAL (terminal/server.js)

O servidor HTTP atual vive em **`src/copilot/terminal/server.js`** — 407 LOC.

### O que ele implementa:
- Servidor HTTP/HTTPS nativo (sem Express, sem socket.io)
- 3 rate limiters independentes (inject, write, SSE)
- Autenticação por token em header `X-LLM-B-Token`
- Route dispatcher via `route-table.js`
- 46+ rotas REST declaradas em `route-table.js` (280 LOC)
- SSE stream (`/events`, `/events/critical`) com replay buffer
- Handler especial para Prometheus metrics (`/metrics`)
- CORS configurado para dashboard local

### Handlers distribuídos em 4 arquivos:
| Arquivo | LOC | Domínio |
|---------|-----|---------|
| `handlers/agent.js` | ~150 | inject, pipeline, dialog pause/resume, handoff |
| `handlers/dialog.js` | ~120 | hub sessions, turns, memory |
| `handlers/system-config.js` | ~200 | config, skills, tools |
| `handlers/system-metrics.js` | ~396 | metrics, errors, audit, git, gh |

### Rotas atuais do inject server (:3009):

| Método | Path | Domínio |
|--------|------|---------|
| GET | /health | auth-exempt |
| GET | /hub-health | auth-exempt |
| GET | /metrics | auth-exempt, Prometheus |
| GET | /context | agent context |
| GET | /quota | quota info |
| GET | /pr-budget | PR budget |
| GET | /config | config completa |
| GET | /config/skills | skills list |
| GET | /config/tools | tools config |
| GET | /config/tools/custom | custom tools |
| GET | /errors | error stats |
| GET | /tool-stats | tool stats |
| GET | /history | injection history |
| GET | /audit | audit log |
| GET | /sessions | hub sessions |
| GET | /sessions/:id/turns | turns de sessão |
| GET | /memory | recall memories |
| GET | /gh/issues | GitHub issues |
| GET | /gh/prs | GitHub PRs |
| GET | /gh/ci | GitHub CI |
| GET | /git/status | git status |
| GET | /git/log | git log |
| GET | /events | SSE stream |
| GET | /handoff | handoffs pendentes |
| POST | /system/reset | emergency reset |
| POST | /inject | mensagem inject |
| POST | /dialog/pause | pausar dialog |
| POST | /dialog/resume | retomar dialog |
| POST | /memory | store memory |
| POST | /pipeline | run pipeline |
| POST | /handoff/:id/accept | aceitar handoff |
| POST | /handoff/:id/reject | rejeitar handoff |
| PUT | /config/infinite-session | config sessão infinita |
| PUT | /config/skills | update skills |
| PUT | /config/tools | update tools |
| POST | /config/tools/custom | registrar custom tool |
| DELETE | /config/tools/custom/:name | remover custom tool |
| DELETE | /memory/:id | remover memória |

---

## 3. PROBLEMAS ESTRUTURAIS IDENTIFICADOS

### P1 — SERVER MISTURADO COM TERMINAL (CRÍTICO)

**Problema**: `terminal/server.js` é um servidor HTTP completo (HTTP/HTTPS, rate limiting, auth,
routing, SSE, CORS) mas vive **dentro da pasta `terminal/`**. Isso viola a separação de
responsabilidades:

- `terminal/` deveria conter apenas a lógica de interface do usuário (REPL, comandos, display)
- O servidor HTTP é uma **infraestrutura de rede** independente do terminal

**Consequência**:
- Impossível reusar o servidor sem o terminal
- Impossível adicionar socket.io sem reestruturar o terminal
- `terminal/index.js` faz `createInjectServer()` e ao mesmo tempo gerencia REPL — dois concerns
  completamente distintos
- Qualidade de expansabilidade: baixa

**Evidência**:
```
terminal/
├── server.js      ← 407 LOC de infra servidor HTTP
├── route-table.js ← 280 LOC de tabela de rotas
├── handlers/      ← 866 LOC de handlers HTTP
├── state.js       ← estado SSE (coisa de servidor)
├── rate-limiter-state.js ← rate limiting (coisa de servidor)
│
├── repl.js        ← 423 LOC de REPL readline
├── commands/      ← 22 arquivos de comandos REPL
├── dialog/        ← engine de diálogo
├── index.js       ← orquestra tudo junto
```

O `terminal/index.js` inicializa: aliases, inject server, hub session, agent wiring, reflection
loop e REPL — **5 concerns diferentes em 228 LOC**. Esse acoplamento torna o módulo frágil.

---

### P2 — SEM SOCKET.IO NO COPILOT (LIMITAÇÃO FUNCIONAL)

**Problema**: O `ConversationHub` tem um `socket-ns.js` (458 LOC) completo com namespace `/copilot`,
JWT auth, broadcast de eventos hub, mas **nunca é inicializado** no modo standalone.

`initStandalone()` explicitamente omite o socket:
```js
// OMITE socket.io — sem broadcast tempo real
conversationStore.init();
this.#orchestrator = new HubOrchestrator(conversationStore);
```

**Consequência**:
- Dashboard não recebe eventos em tempo real do hub
- Não é possível ter múltiplos clientes recebendo o mesmo stream de eventos
- SSE existe mas é point-to-point, não broadcast para múltiplos listeners

---

### P3 — `src/copilot/server/` ESTÁ PRATICAMENTE VAZIA (110 LOC)

**Problema**: Existe uma pasta `src/copilot/server/` mas contém apenas `wiring.js` que está marcado
como `@deprecated` desde a Onda 2.7. A pasta está em estado inválido — não serve para nada
estruturalmente.

---

### P4 — `src/copilot/api/` ÓRFÃO

**Problema**: `src/copilot/api/` (3.327 LOC / 21 files) contém:
- `bridge/` — router Express para `/api/copilot`
- `express/` — SDK API Express router
- `sse/` — utilitários SSE (replay buffer, fanout, utils)
- `openapi.json`

Os routers Express (`bridge/`, `express/`) foram usados pelo `src/server/api/router.js` — que
os removeu na Onda 2.7. Agora estão órfãos (não são importados por ninguém no path ativo).

Os utilitários SSE (`sse/`) são usados pelo `terminal/server.js`. Mas estão na pasta errada —
deveriam estar no servidor copilot, não em `api/`.

---

### P5 — BOOTSTRAP SEPARADO DO TERMINAL

**Problema**: Existem dois bootstraps:
- `src/copilot/bootstrap.js` — entry point geral (chama terminal)
- `src/copilot/terminal/bootstrap.js` — entry point do terminal (chama bootstrap geral)

É uma cadeia circular desnecessária. O `terminal/bootstrap.js` chama `bootstrap.js` que chama de
volta para `terminal/index.js`. A lógica de boot é artificial.

---

### P6 — `src/copilot/logs/` VAZIA, `src/copilot/infra/` QUASE VAZIA

**Problema**: `logs/` tem 0 arquivos, `infra/` tem apenas 1 arquivo (50 LOC). São pastas de
intento não realizado. A lógica de logging está em `observability/`, e infra distribuída em
`core/`, `db/`, etc.

---

### P7 — `src/copilot/api/` NÃO É API DO COPILOT — É ADAPTER DO PRODUCTION SERVER

**Problema**: `src/copilot/api/` foi criada para adaptar o copilot **ao servidor de produção** —
eram rotas expostas no :3008. Não são APIs do copilot standalone. O nome `api/` sugere que é a "API
do copilot", mas na prática foi sempre um shim para o server de produção.

---

### P8 — CONVERSATION-HUB/SOCKET-NS.JS É SERVIDOR (NÃO É HUB)

**Problema**: `socket-ns.js` (458 LOC) implementa um namespace Socket.io **completo** com:
- JWT auth
- Middleware de conexão
- Broadcast de mensagens
- Event routing

Mas vive dentro de `conversation-hub/` — misturando lógica de transporte (socket.io) com lógica
de domínio (hub de conversas). O hub deveria ser agnóstico à camada de transporte.

---

## 4. MAPA DE DEPENDÊNCIAS ATUAL

```
terminal/bootstrap.js
  └── bootstrap.js
        ├── observability/bootstrap.js
        ├── tools/index.js
        ├── hooks/bus.js
        ├── audit/pipeline-permission.js
        └── terminal/index.js
              ├── terminal/server.js  ← HTTP server atual (misturado)
              ├── terminal/repl.js
              ├── terminal/di-wiring.js
              ├── conversation-hub/hub.js (initStandalone — sem socket)
              ├── agent/index.js (alwaysAliveAgent)
              └── terminal/terminal-agent-wiring.js
```

### Módulos sem consumidores ativos:
| Módulo | Status |
|--------|--------|
| `src/copilot/api/bridge/` | Órfão — era bridge do production server |
| `src/copilot/api/express/` | Órfão — eram rotas SDK no :3008 |
| `src/copilot/server/wiring.js` | Órfão — @deprecated Onda 2.7 |
| `conversation-hub/socket-ns.js` | Sem init no standalone |

---

## 5. SCORE ARQUITETURAL ATUAL

| Dimensão | Score | Comentário |
|----------|-------|------------|
| Separação de responsabilidades | 4/10 | Server misturado com terminal |
| Extensibilidade | 4/10 | Difícil adicionar socket.io, WebRTC, etc. sem quebrar terminal |
| Testabilidade | 5/10 | Server HTTP testável isolation, mas acoplado com REPL |
| Cobertura standalone | 6/10 | Hub funciona mas sem socket; SSE funciona mas sem broadcast |
| Clareza estrutural | 5/10 | api/ órfã, server/ quase vazia, logs/ vazia |
| Preparação para crescimento | 4/10 | Terminal com 49 arquivos, server embutido nela |

**Score médio**: **4.7/10**

---

## 6. RESUMO DOS ACHADOS

| # | Problema | Severidade | Impacto no crescimento futuro |
|---|---------|------------|-------------------------------|
| P1 | Server HTTP misturado com terminal | 🔴 CRÍTICO | Bloqueia socket.io, WebRTC, múltiplos clientes |
| P2 | Socket.io não inicializado no standalone | 🟠 ALTO | Dashboard sem tempo real |
| P3 | `server/` praticamente vazia | 🟡 MÉDIO | Confusão arquitetural |
| P4 | `api/` órfã | 🟡 MÉDIO | Dead code, confusão sobre propósito |
| P5 | Bootstrap chain circular | 🟡 MÉDIO | Complexidade desnecessária |
| P6 | `logs/`, `infra/` vazias | 🟢 BAIXO | Ruído estrutural |
| P7 | `api/` = adapter production server, não API standalone | 🟠 ALTO | Nome enganoso, propósito incorreto |
| P8 | socket-ns no conversation-hub (transporte misturado com domínio) | 🟡 MÉDIO | Dificulta isolamento do hub |

---

## 7. CHANGELOG

| Versão | Data       | Mudanças |
| ------ | ---------- | -------- |
| 1.0    | 2026-04-12 | Diagnóstico completo pós Onda 2.7 |
