# PARTE-24G — ARQUITETURA IDEAL: COPILOT COMO FERRAMENTA DE DESENVOLVIMENTO

> **Documento**: PARTE-24G-ARQUITETURA-COPILOT-DEV.md **Versão**: 1.0 **Data**: 2026-04-12
> **Escopo**: Definição da arquitetura ideal para `src/copilot` como módulo de desenvolvimento

---

## 0. PREMISSA FUNDAMENTAL

> **`src/copilot` NÃO é uma feature de produção.** É uma **ferramenta de desenvolvimento**
> equivalente a um DevTools avançado.

O `src/copilot` implementa a LLM-B — um agente de IA local que roda no ambiente de desenvolvimento.
É o par da LLM-A (Copilot do VS Code). A LLM-B:

- Recebe instruções via terminal REPL ou HTTP inject (:3009)
- Executa tarefas de código (audit, refactor, test)
- Persiste sessões e conversas localmente
- Expõe SSE para observabilidade em tempo real
- Interage com o repositório diretamente

**Analogia**: LLM-B está para o código como o Chrome DevTools está para o browser — ferramenta
integrada ao workflow de desenvolvimento, não funcionalidade do produto.

---

## 1. POR QUE EXISTEM 3 MODOS HOJE (E POR QUE SÓ DEVERIA EXISTIR 1)

### Os 3 Modos Atuais

| Modo       | Entry                          | O que adiciona                                 | Por que existe                                                  |
| ---------- | ------------------------------ | ---------------------------------------------- | --------------------------------------------------------------- |
| `terminal` | `npm run terminal:llm-b`       | REPL + inject :3009 + PinnedFiles + reflection | **Propósito original**: ferramenta dev standalone               |
| `agent`    | PM2 `copilot-sdk-agent`        | Agent loop + IPC + retry + shutdown            | **Premissa errada**: copilot em produção como processo separado |
| `server`   | `src/server/main.js` embarcado | NERV bridge + socket.io + ConversationHub      | **Premissa errada**: copilot integrado ao server de produção    |

### O Problema

Os modos `agent` e `server` foram construídos sob a premissa de que o copilot operaria em produção —
como addon do server HTTP ou como processo PM2 separado. **Essa premissa é incorreta.**

O copilot é uma ferramenta de dev. Ele:

- Não precisa de NERV (sistema de eventos do server de produção)
- Não precisa de socket.io (websockets do server de produção)
- Não precisa de Express routes em `/api/copilot`
- Não precisa rodar como PM2 process separado do terminal

### O Modo Canônico

**`terminal` é o único modo que faz sentido como primário.** Os outros são adaptações para cenários
que não são o cenário primário de uso.

---

## 2. O QUE A LLM-B PRECISA (E NÃO PRECISA) DE UM SERVER

### O que a LLM-B **TEM** e funciona bem (inject server :3009)

O terminal já roda um HTTP server na porta 3009 (`terminal/server.js`) com:

| Categoria    | Endpoints                                                    | Utilidade                                                  |
| ------------ | ------------------------------------------------------------ | ---------------------------------------------------------- |
| **Inject**   | `POST /inject`                                               | LLM-A envia mensagens para LLM-B                           |
| **SSE**      | `GET /events`                                                | Stream de eventos em tempo real (logs, status, tool calls) |
| **Control**  | `POST /dialog/pause`, `/resume`                              | Controle do agent loop                                     |
| **Context**  | `GET /context`, `/config`, `/config/skills`, `/config/tools` | Ler estado do agent                                        |
| **History**  | `GET /history`, `/sessions`, `/sessions/:id/turns`           | Ler conversas passadas                                     |
| **Audit**    | `GET /audit`                                                 | Relatórios de auditoria                                    |
| **Health**   | `GET /health`, `/hub-health`, `/metrics`                     | Diagnóstico                                                |
| **Git**      | `GET /git/status`, `/git/log`                                | Estado do repositório                                      |
| **GitHub**   | `GET /gh/issues`, `/gh/prs`, `/gh/ci`                        | Dados do GitHub                                            |
| **Memory**   | `GET/PUT/DELETE /memory`                                     | Memória persistente do agent                               |
| **Tools**    | `GET/PUT /config/tools`, `POST /config/tools/custom`         | Gestão de tools                                            |
| **Pipeline** | `POST /pipeline`                                             | Execução de pipelines de auditoria                         |
| **System**   | `POST /system/reset`                                         | Reset do agent                                             |
| **Handoff**  | `GET /handoff`, `POST /handoff/:id/accept`                   | Handoff entre agents                                       |
| **Quota**    | `GET /quota`, `/pr-budget`                                   | Budget de API calls                                        |

**São 30+ endpoints** — já é um server completo e auto-suficiente.

### O que o `src/server/main.js` adiciona (via mode=server)

| O que                                     | Relevância para DEV                                     |
| ----------------------------------------- | ------------------------------------------------------- |
| NERV EventBus adapter                     | ❌ NERV é o event bus do server de produção             |
| Inbound NERV commands (SEND_MESSAGE etc.) | ❌ Duplica funcionalidade do inject server              |
| ConversationHub com socket.io             | ⚠️ Socket namespace /copilot — para dashboard real-time |
| AlwaysAliveAgent autostart                | ⚠️ Agent auto-inicia — mas terminal já faz isso         |
| Express routes `/api/copilot/*`           | ⚠️ Bridge HTTP — mas inject :3009 já faz isso           |
| Express routes `/api/hub/*`               | ⚠️ ConversationHub REST — relevante se dashboard usar   |

### Análise: O que vale preservar do modo server?

**Preservar**:

1. **ConversationHub com persistência** — sessões e turns gravados em DB, consultáveis pelo
   dashboard
2. **Express routes `/api/hub/*`** — para o dashboard-ui consultar conversas
3. **AlwaysAliveAgent autostart** — mas isso já existe no terminal

**Eliminar/absorver**:

1. NERV adapter — sem utilidade para dev
2. Inbound NERV commands — duplicam /inject
3. Express routes `/api/copilot/*` — duplicam :3009

---

## 3. BENEFÍCIOS DE TER UM SERVER PARA O COPILOT DEV

### Cenário A: Terminal standalone (atual — :3009)

```
VS Code (LLM-A) ──HTTP──→ Terminal LLM-B (:3009)
                          ├── REPL readline
                          ├── AlwaysAliveAgent
                          ├── PinnedFiles
                          ├── Reflection loop
                          └── SSE events
```

**Vantagens**: Simples, auto-contido, nenhuma dependência externa. **Limitações**: Sem dashboard UI,
sem persistência elegante, sem websockets.

### Cenário B: Terminal + Dashboard (potencial)

```
VS Code (LLM-A) ──HTTP──→ Terminal LLM-B (:3009)
                          ├── Agent + REPL + SSE
                          └── ConversationStore

Dashboard UI ──HTTP──→ Terminal LLM-B (:3009)
              ├── GET /sessions, /history, /audit
              ├── GET /events (SSE)
              └── PUT /config/*, /memory
```

**Insight**: O terminal :3009 JÁ TEM todos os endpoints que o dashboard precisaria. Não há
necessidade de montar o copilot no server de produção (:3008) para ter dashboard.

### Cenário C: Terminal com WebSocket (se necessário no futuro)

```
Terminal LLM-B (:3009)
  ├── HTTP endpoints (já existem)
  ├── SSE events (já existe)
  └── WebSocket upgrade (:3009)  ← futuro, se necessário
      └── Bi-directional real-time
```

WebSocket pode ser adicionado ao inject server se SSE for insuficiente. Não precisa de socket.io do
server de produção.

---

## 4. ARQUITETURA IDEAL PROPOSTA

### Princípio: **1 processo, 1 boot, 1 server**

```
┌──────────────────────────────────────────────────────────────────────┐
│  bootCopilot()  — Entry point ÚNICO                                  │
│                                                                      │
│  Phase 1: bootstrapObservability()                                   │
│  Phase 2: bootstrapLateDeps() + AUDIT_BUS                           │
│  Phase 3: startTerminalServer()  ← SEMPRE                           │
│    ├── wireTerminalDI()                                              │
│    ├── PinnedFilesLoader                                             │
│    ├── ConversationStore (local DB)                                  │
│    ├── AlwaysAliveAgent.start()                                      │
│    ├── Reflection loop                                               │
│    ├── Inject HTTP server (:3009)                                    │
│    │   ├── 30+ endpoints já existentes                               │
│    │   ├── SSE /events                                               │
│    │   └── futuro: WebSocket upgrade                                 │
│    └── REPL readline                                                 │
│                                                                      │
│  Entry: npm run terminal:llm-b                                       │
│  PM2:   llm-b-terminal                                               │
└──────────────────────────────────────────────────────────────────────┘
```

### O que muda

| Antes                                 | Depois                                               |
| ------------------------------------- | ---------------------------------------------------- |
| 3 modos: terminal / agent / server    | **1 modo: terminal (canônico)**                      |
| `bootCopilot({ mode })` com switch    | `bootCopilot()` — sempre terminal                    |
| server/main.js faz wiring copilot     | server/main.js **NÃO** toca no copilot               |
| PM2 `copilot-sdk-agent` como processo | **Removido** (agent roda dentro do terminal)         |
| NERV bridge para copilot              | **Removido** (copilot é standalone)                  |
| Express routes `/api/copilot/*`       | **Opcional**: proxy reverso :3008→:3009, ou removido |
| Dashboard usa socket.io do server     | **Dashboard usa SSE/HTTP do :3009 diretamente**      |

### Backwards compatibility

O `src/server/main.js` fica mais limpo — remove o bloco `COPILOT_SDK_ENABLED` inteiro. Se o usuário
quiser acessar o copilot via o server principal, pode usar um proxy reverso simples de
:3008/api/copilot → :3009.

---

## 5. ROADMAP DE IMPLEMENTAÇÃO

### Onda 2.7 — Single Boot Path (L53.14–L53.20)

#### L53.14 — Simplificar `bootCopilot()` para modo único

**O que**: Remover o parâmetro `mode`. `bootCopilot()` sempre executa `startTerminalServer()`.

```js
// ANTES
export async function bootCopilot({ mode, context }) { ... switch(mode) ... }

// DEPOIS
export async function bootCopilot() {
    // Phase 1-2: mesmas
    // Phase 3: sempre terminal
    const { startTerminalServer } = await import('./terminal/index.js');
    await startTerminalServer();
}
```

**Backwards compat**: `agent.js` e `terminal/bootstrap.js` continuam como thin entries que chamam
`bootCopilot()` (sem args).

#### L53.15 — Deprecar modo `server` em server/main.js

**O que**: Remover o bloco `COPILOT_SDK_ENABLED` inteiro de `server/main.js`. O copilot roda como
processo separado via terminal:llm-b, não embarcado no server.

**O que server perde**: ~15 LOC do bootCopilot call + wiring. **O que server ganha**: Zero
acoplamento com copilot.

#### L53.16 — Consolidar `agent.js` no terminal

**O que**: As features únicas do `startAgentLoop()` (plugin discovery, HookBus bridge, retry, IPC,
shutdown handlers) são absorvidas no terminal se forem úteis. Se não, são descartadas.

Análise do que startAgentLoop() faz:

- Plugin discovery → ✅ útil, mover para terminal
- HookBus→EventBus bridge → ✅ útil, mover para terminal
- startWithRetry → ⚠️ terminal já inicia agent, mas sem retry
- IPC handling (PM2 commands) → ❌ irrelevante para terminal
- SIGTERM/SIGINT handlers → ✅ terminal já tem graceful shutdown
- Error tracker global → ✅ já existe em bootstrap

**Resultado**: ~30% de startAgentLoop() é absorvido no terminal. O resto é descartado.

#### L53.17 — Atualizar PM2 config

**O que**: Remover `copilot-sdk-agent` do ecosystem.config.cjs. Manter apenas `llm-b-terminal`.

#### L53.18 — Deprecar server/wiring.js + NERV bridge

**O que**: Marcar `server/wiring.js` como deprecated. O módulo continua existindo mas não é chamado
por nenhum boot path.

#### L53.19 — Atualizar smoke test

**O que**: Ajustar checks para refletir 1 entry point canônico em vez de 3.

#### L53.20 — Docs + PARTE-24H

**O que**: Atualizar PARTE-24D roadmap e criar PARTE-24H com resultado final.

---

## 6. DECISÃO DE DESIGN: POR QUE NÃO REMOVER server/wiring.js AGORA

O `server/wiring.js` e o modo `server` representam a integração copilot ↔ server de produção. Mesmo
sendo desnecessários para o caso de uso primário (dev), eles podem ser úteis para:

1. **Dashboard-UI** que roda no :3008 e quer acessar conversas via socket.io
2. **Futuro**: se o copilot evoluir para algo que roda em produção

**Proposta**: Deprecar (não remover). Remover o `if COPILOT_SDK_ENABLED` do server/main.js mas
manter server/wiring.js como módulo disponível para uso futuro.

---

## 7. BENEFÍCIOS DO :3009 COMO SERVER ÚNICO DO COPILOT

| Benefício            | Descrição                                                             |
| -------------------- | --------------------------------------------------------------------- |
| **Isolamento total** | Copilot não depende do server de produção. Pode rodar sem server.     |
| **Simplicidade**     | 1 processo, 1 porta, 1 boot. Sem split entre :3008 e :3009.           |
| **Segurança**        | Server de produção não expõe APIs do copilot para o mundo.            |
| **Performance**      | Sem overhead de NERV bridge, socket.io namespace, Express middleware. |
| **Debugging**        | Logs, errors e eventos estão todos no mesmo processo.                 |
| **Portabilidade**    | Copilot pode rodar em qualquer máquina sem o server de produção.      |
| **Dashboard direto** | Dashboard pode apontar para :3009 diretamente (CORS já configurado).  |
| **Hot-reload**       | PinnedFiles + skills reload sem reiniciar nada além do terminal.      |
| **SSE nativo**       | Streaming de eventos sem socket.io overhead.                          |

---

## 8. CHANGELOG

| Versão | Data       | Mudanças                                                              |
| ------ | ---------- | --------------------------------------------------------------------- |
| 2.0    | 2026-04-12 | Onda 2.7 implementada: L53.14–L53.20 completos, lint ✅, typecheck ✅ |
| 1.0    | 2026-04-12 | Análise completa, proposta de single boot, roadmap Onda 2.7           |

---

## 9. STATUS DA ONDA 2.7 (pós-implementação)

| Step   | Arquivo                              | Status | Descrição                                                  |
| ------ | ------------------------------------ | ------ | ---------------------------------------------------------- |
| L53.14 | `src/copilot/bootstrap.js`           | ✅     | Modo único — `bootCopilot()` sem parâmetros                |
| L53.14 | `src/copilot/terminal/bootstrap.js`  | ✅     | Chama `bootCopilot()` sem args                             |
| L53.14 | `src/copilot/agent.js`               | ✅     | Marcado `@deprecated`, alias para bootCopilot()            |
| L53.15 | `src/server/main.js`                 | ✅     | Bloco bootCopilot server removido (L53.15 comment)         |
| L53.16 | `src/server/api/router.js`           | ✅     | Imports e rotas /api/copilot, /api/sdk, /api/hub removidos |
| L53.17 | `src/copilot/server/wiring.js`       | ✅     | Marcado `@deprecated` (orphaned desde Onda 2.7)            |
| L53.18 | `terminal/index.js`                  | ✅     | `conversationHub.initStandalone()` já funcionava           |
| L53.19 | `scripts/check-copilot-autonomy.mjs` | ✅     | 8/8 checks passam, Check 5 (modo único) adicionado         |

### Validações finais:

- `npm run lint` → ✅ 0 erros
- `npm run typecheck:node` → ✅ 0 erros
- `node scripts/check-copilot-autonomy.mjs` → ✅ 8/8 OK
