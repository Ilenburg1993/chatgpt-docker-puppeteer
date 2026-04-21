# PARTE-19A — Auditoria: Imports Diretos do SDK `@github/copilot-sdk`

**Data**: 2026-07-21 **Escopo**: `src/copilot/**/*.js` (exceto `src/copilot/sdk/`) **Política
violada**: Todo acesso ao SDK deve passar pelo wrapper `src/copilot/sdk/` (alias `#copilot/sdk`)

---

## 1. Situação Atual

### 1.1 Dimensão do problema

| Métrica                                          | Valor                                         |
| ------------------------------------------------ | --------------------------------------------- |
| Arquivos com imports diretos do SDK              | **53**                                        |
| Linhas com `@github/copilot-sdk` fora do wrapper | **123**                                       |
| Tipos distintos referenciados diretamente        | **15**                                        |
| Runtime imports diretos (não-JSDoc)              | **2** (inevitáveis — leitura de package.json) |
| Type-only violations (JSDoc inline)              | **121**                                       |

### 1.2 Natureza das violações

**99% das violações são type-only (JSDoc)** — não há imports runtime do SDK fora do wrapper. As
violações são da forma:

```js
// ❌ Import direto em JSDoc inline
/** @type {import('@github/copilot-sdk').Tool[]} */

// ❌ @typedef local redeclarando tipo do SDK
/** @typedef {import('@github/copilot-sdk').CopilotSession} CopilotSession */

// ❌ @param / @returns com tipo SDK inline
/** @param {import('@github/copilot-sdk').PermissionHandler} handler */
```

**2 runtime imports inevitáveis** (acesso ao `package.json` do módulo npm para obter versão):

- `src/copilot/api/bridge/control.js:22` — `req('@github/copilot-sdk/package.json')`.version
- `src/copilot/tools/introspection-tools.js:157` —
  `_req('@github/copilot-sdk/package.json')`.version

### 1.3 Tipos mais referenciados diretamente

| Tipo                    | Ocorrências | Já em `types.js` |
| ----------------------- | ----------- | ---------------- |
| `ZodSchema`             | 32          | ✅               |
| `Tool`                  | 32          | ✅               |
| `CopilotSession`        | 15          | ✅               |
| `MessageOptions`        | 12          | ✅               |
| `CopilotClient`         | 8           | ✅               |
| `PermissionHandler`     | 7           | ✅               |
| `ToolHandler`           | 2           | ✅               |
| `SystemMessageConfig`   | 2           | ✅               |
| `ToolInvocation`        | 1           | ✅               |
| `SystemPromptSection`   | 1           | ✅               |
| `SessionListFilter`     | 1           | ✅               |
| `SessionConfig`         | 1           | ✅               |
| `ModelInfo`             | 1           | ✅               |
| `CustomAgentConfig`     | 1           | ✅               |
| `AssistantMessageEvent` | 1           | ✅               |

**Conclusão**: Todos os 15 tipos já existem em `src/copilot/sdk/types.js` (SSOT). A migração é de
referência, não de conteúdo.

### 1.4 Arquivos violadores por subsistema

**`src/copilot/agent/`** (core do agente — 14 arquivos):

- `agent-context.js` — 2 typedefs (CopilotClient, CopilotSession)
- `always-alive.js` — 2 inline (MessageOptions attachments, ModelInfo)
- `types.js` — 3 typedefs + 1 inline
- `infra/message-queue.js` — 1 inline (MessageOptions)
- `infra/permission-controller.js` — 2 inline (PermissionHandler)
- `infra/task-executor.js` — 3 (MessageOptions, CopilotSession)
- `infra/tools-bootstrap.js` — 2 (Tool)
- `lifecycle/agent-lifecycle.js` — 3 (CopilotClient, CopilotSession)
- `lifecycle/reconnect-policy.js` — 1 (CopilotClient)
- `lifecycle/session-setup.js` — 1 (CopilotSession)
- `messaging/agent-messaging.js` — 2 (MessageOptions)
- `session/boot-wiring.js` — 3 (CopilotClient, CopilotSession, Tool)
- `session/cleanup.js` — 1 (CopilotClient)
- `session/event-wirer.js` — 2 (CopilotSession x2)
- `session/history-sync.js` — 1 (CopilotSession)
- `session/initializer.js` — 5 (CopilotClient, CopilotSession, Tool, PermissionHandler,
  SystemMessageConfig)

**`src/copilot/tools/`** (tools para LLM-B — 14 arquivos):

- Maioria usa `Tool`, `ZodSchema`, `ToolHandler` inline
- `tool-factory.js` — 4 (ToolHandler, Tool)
- `session-rpc-tools.js` — 9 (ZodSchema x8 + Tool)
- `shell/index.js` — 3 (ZodSchema x2 + Tool)
- E outros 11 arquivos similares

**`src/copilot/api/`** (3 arquivos):

- `bridge/control.js` — 1 runtime (inevitável)
- `bridge/tasks.js` — 1 inline (MessageOptions)
- `express/session-crud.js` — 1 typedef (SessionListFilter)
- `express/session-messaging.js` — 2 inline (AssistantMessageEvent, MessageOptions)

**`src/copilot/bridges/`** (2 arquivos):

- `mcp-tool-bridge.js` — 3 (Tool x3)
- `nerv-bridge.js` — 1 (CopilotSession)

**`src/copilot/config/`** (3 arquivos):

- `custom-agents.js` — 1 typedef (CustomAgentConfig)
- `session-config.js` — 3 typedefs (PermissionHandler, SessionConfig, Tool)
- `system-prompt.js` — 2 (SystemMessageConfig, SystemPromptSection)

**`src/copilot/observability/`** (3 arquivos):

- `collectors/context.js` — 1 typedef (CopilotSession)
- `event-collector.js` — 2 (CopilotSession)
- `tool-stats.js` — 1 (ToolInvocation)

**`src/copilot/hooks/registry.js`** (1 arquivo) — menção em comentário, não import

**`src/copilot/audit/pipeline.js`** (1 arquivo) — 3 (PermissionHandler)

**`src/copilot/channel/`** (3 arquivos) — 3 (MessageOptions x2, ChannelAttachment)

---

## 2. Situação Ideal

### 2.1 Regra canônica

```
NUNCA: import('@github/copilot-sdk').TypeName
SEMPRE: import('#copilot/sdk/types').TypeName  (em @typedef)
OU:     import('../sdk/types.js').TypeName      (em inline)
```

### 2.2 Padrão correto por caso de uso

**Caso 1 — @typedef local** (define tipo para uso no arquivo):

```js
// ❌ Atual
/** @typedef {import('@github/copilot-sdk').CopilotSession} CopilotSession */

// ✅ Ideal
/** @typedef {import('#copilot/sdk/types').CopilotSession} CopilotSession */
```

**Caso 2 — @type inline** (anotação de variável):

```js
// ❌ Atual
const sendOpts = /** @type {import('@github/copilot-sdk').MessageOptions} */ ({...});

// ✅ Ideal (opção A — usar typedef local)
/** @typedef {import('#copilot/sdk/types').MessageOptions} MessageOptions */
const sendOpts = /** @type {MessageOptions} */ ({...});

// ✅ Ideal (opção B — inline via types.js)
const sendOpts = /** @type {import('#copilot/sdk/types').MessageOptions} */ ({...});
```

**Caso 3 — @param / @returns inline**:

```js
// ❌ Atual
/** @param {import('@github/copilot-sdk').Tool[]} tools */

// ✅ Ideal
/** @param {import('#copilot/sdk/types').Tool[]} tools */
```

**Caso 4 — Runtime accesso ao package.json** (inevitável):

```js
// ✅ Aceitável — sem alternativa via wrapper
const pkg = require('@github/copilot-sdk/package.json');
```

### 2.3 Benefícios da migração

1. **Centralização**: mudanças de nome de tipo no SDK precisam ser atualizadas em 1 local
   (`types.js`) em vez de 53 arquivos
2. **Rastreabilidade**: grep por `#copilot/sdk/types` revela todos os consumers de tipos SDK
3. **Encapsulamento**: o wrapper pode interceptar, documentar e deprecar tipos conforme necessário
4. **Consistência**: mesma convenção que já é seguida para runtime (`#copilot/sdk`)

---

## 3. Roadmap de Execução

### Convenção de numeração

Faixas `S01`–`S20` (prefixo **S** = SDK-wrapper). Integradas com faixas pendentes do PARTE-18C.

### Tabela mestre

| Faixa   | Prioridade | Descrição                                                                                                                                                  | Linhas est.  | Risco | Status     |
| ------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ | ----- | ---------- |
| **S01** | 🟡 P1      | Migrar typedefs em `src/copilot/agent/` (agent-context, types, lifecycle)                                                                                  | ~15 ed.      | Baixo | ✅ DONE    |
| **S02** | 🟡 P1      | Migrar typedefs em `src/copilot/agent/session/` (boot-wiring, history-sync, event-wirer, initializer, cleanup)                                             | ~20 ed.      | Baixo | ✅ DONE    |
| **S03** | 🟡 P1      | Migrar inline types em `src/copilot/agent/infra/` (message-queue, permission-controller, task-executor, tools-bootstrap)                                   | ~10 ed.      | Baixo | ✅ DONE    |
| **S04** | 🟡 P1      | Migrar inline types em `src/copilot/agent/messaging/` + `always-alive.js`                                                                                  | ~6 ed.       | Baixo | ✅ DONE    |
| **S05** | 🟢 P2      | Migrar typedefs em `src/copilot/config/` (session-config, system-prompt, custom-agents)                                                                    | ~8 ed.       | Baixo | ✅ DONE    |
| **S06** | 🟢 P2      | Migrar inline types em `src/copilot/tools/tool-factory.js` + `tools/index.js`                                                                              | ~8 ed.       | Baixo | ✅ DONE    |
| **S07** | 🟢 P2      | Migrar inline types em `src/copilot/tools/` (session-rpc-tools, session-tools, code-tools, hook-tools, hub-tools, web-tools, permission-tools, task-tools) | ~20 ed.      | Baixo | ✅ DONE    |
| **S08** | 🟢 P2      | Migrar inline types em `src/copilot/tools/` subpastas (file/, git/, shell/, todo/)                                                                         | ~25 ed.      | Baixo | ✅ DONE    |
| **S09** | 🟢 P2      | Migrar em `src/copilot/api/` (bridge/tasks, express/{session-crud,session-messaging})                                                                      | ~6 ed.       | Baixo | ✅ DONE    |
| **S10** | 🟢 P2      | Migrar em `src/copilot/bridges/` + `observability/` + `audit/` + `channel/`                                                                                | ~12 ed.      | Baixo | ✅ DONE    |
| **S11** | 🟢 P2      | Validar: zero ocorrências de `@github/copilot-sdk` (exceto runtime inevitáveis + SDK wrapper)                                                              | diagnóstico  | Baixo | ✅ DONE    |
| **F75** | 🟢 P2      | loop-manager decomposição: extrair `pr-metrics.js` + `compaction-handler.js`                                                                               | ~80 extração | Médio | ✅ DONE    |
| **F80** | 🟢 P2      | Testes diretos: `boot-wiring.js` + `history-sync.js`                                                                                                       | ~120         | Médio | ✅ DONE    |
| **F65** | 🟡 P1      | Remover APIs deprecated sync de `snapshot.js` e `state-io.js`                                                                                              | ~80 remoção  | Médio | ⏳ BLOCKED |

### Fases

**Fase 1 — Agent Core (S01–S04)**: Arquivos mais críticos e mais referenciados. Menor risco pois são
typedefs locais não exportados.

**Fase 2 — Config + Tools (S05–S08)**: Tools e config são estáveis mas têm maior densidade de
`ZodSchema` inline.

**Fase 3 — API + Bridges + Observability (S09–S10)**: Fronteira da API e integrações externas.

**Fase 4 — Validação + Pendentes 18C (S11, F75, F80)**: Validação final e faixas pendentes do
roadmap anterior.

**Bloqueada**: F65 aguarda remover uso de deprecated APIs nos tests.

---

## 4. Critério de Aceitação

- `rg "@github/copilot-sdk" src/ -t js | grep -v "src/copilot/sdk/" | grep -v "package.json" | grep -v "^.*comment"`
  retorna 0 linhas
- `npm run typecheck:node` — zero erros
- `npm run lint` — zero erros novos

---

## 5. Exemplos Canônicos

### Convertendo um arquivo com múltiplos typedefs (ex: `boot-wiring.js`)

```js
// Antes:
/** @typedef {import('@github/copilot-sdk').CopilotClient} CopilotClient */
/** @typedef {import('@github/copilot-sdk').CopilotSession} CopilotSession */

// Depois (via #copilot/sdk/types):
/** @typedef {import('#copilot/sdk/types').CopilotClient} CopilotClient */
/** @typedef {import('#copilot/sdk/types').CopilotSession} CopilotSession */
```

### Convertendo inline em tools (ex: `session-rpc-tools.js`)

```js
// Antes:
parameters: /** @type {import('@github/copilot-sdk').ZodSchema<{ content: string }>} */ (z.object({...})),

// Depois (sem typedef local — inline via types.js):
parameters: /** @type {import('#copilot/sdk/types').ZodSchema<{ content: string }>} */ (z.object({...})),
```

---

_Documento gerado automaticamente — 2026-07-21_
