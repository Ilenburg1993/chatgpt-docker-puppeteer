# Plano de Reforço JSDoc & Tipagem — `src/copilot`

**Status**: ✅ Completo — Phases 1-9 finalizadas **Última atualização**: 2026-04-02 **Escopo**: 115
arquivos `.js` em `src/copilot/`

---

## 1. Diagnóstico Atual

### 1.1 Métricas de baseline (pré-refatoração)

| Métrica                                   | Valor |
| ----------------------------------------- | ----- |
| Arquivos `.js` em `src/copilot/`          | 115   |
| Arquivos com `// @ts-check`               | 115   |
| Blocos JSDoc `/** */`                     | 1.899 |
| `@param` tags                             | 576+  |
| `@returns` tags                           | 576   |
| `@throws` tags                            | 21    |
| `@typedef` declarações                    | 187   |
| Usos de `any` em JSDoc (`@type`/`@param`) | 325   |
| — `@type {any}` ou `@type {... any ...}`  | 293   |
| — `@param {any}`                          | 21    |
| — `@returns {any}`                        | 11    |
| Acessos `process.env.VAR` (TS4111)        | 78    |
| Erros strict atuais (tsconfig.strict)     | 0     |
| Erros com `noPropertyAccessFromIndexSig`  | 142   |
| Erros com `noUncheckedIndexedAccess`      | 0     |
| Erros com `exactOptionalPropertyTypes`    | 0     |

### 1.2 Distribuição de `any` por diretório

| Diretório         | Usos de `any` |
| ----------------- | ------------- |
| agent/            | 97            |
| terminal/         | 52            |
| tools/            | 49            |
| bridges/          | 30            |
| conversation-hub/ | 30            |
| lib/              | 23            |
| config/           | 16            |
| api/              | 12            |
| channel/          | 11            |
| routes/           | 7             |
| db/               | 0             |
| core/             | 0             |
| types/            | 0             |

### 1.3 Top-10 arquivos com mais `any`

| #   | Arquivo                       | any |
| --- | ----------------------------- | --- |
| 1   | agent/always-alive.js         | 26  |
| 2   | terminal/http-handlers.js     | 21  |
| 3   | bridges/mcp-tool-bridge.js    | 15  |
| 4   | tools/file-tools.js           | 14  |
| 5   | conversation-hub/socket-ns.js | 12  |
| 6   | lib/session.js                | 10  |
| 7   | conversation-hub/store.js     | 10  |
| 8   | agent/session-event-wirer.js  | 10  |
| 9   | agent/dialog-loop-manager.js  | 10  |
| 10  | tools/todo-tools.js           | 9   |

### 1.4 Estado do TSConfig strict dedicado

Arquivo: `config/typing/strict/tsconfig.strict.src.copilot.json`

```jsonc
{
  "extends": "../../../tsconfig.node.json",
  "compilerOptions": {
    "strict": true,
    "noImplicitAny": true,
    "noImplicitReturns": true,
    "useUnknownInCatchVariables": true,
    "noFallthroughCasesInSwitch": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "forceConsistentCasingInFileNames": true,
    "noEmit": true,
  },
  "include": ["../../../src/copilot/**/*"],
}
```

**Flags já habilitadas (herdadas de `tsconfig.base.json`):**

- `strict: true` (inclui `strictNullChecks`, `strictFunctionTypes`, `strictBindCallApply`,
  `strictPropertyInitialization`, `noImplicitThis`, `noImplicitAny`, `alwaysStrict`,
  `useUnknownInCatchVariables`, `strictBuiltinIteratorReturn`)
- `exactOptionalPropertyTypes: true`
- `noUncheckedIndexedAccess: true`
- `allowUnreachableCode: false`
- `allowUnusedLabels: false`

**Flags adicionadas nesta refatoração:**

- ✅ `noPropertyAccessFromIndexSignature: true` — habilitada (Phase 1, commit `52121d9f`), 0 erros

**Flags restantes a adicionar:**

- `noImplicitOverride: true` → a verificar (classe `AlwaysAliveAgent` extends `EventEmitter`)

---

## 2. Estratégia Geral

### Princípios

1. **Eliminar `any` progressivamente** — substituir por tipos concretos, genéricos ou `unknown`
2. **Habilitar `noPropertyAccessFromIndexSignature`** — criar tipagem forte para `process.env`
3. **Enriquecer JSDoc** — `@param`, `@returns`, `@throws`, `@template` onde aplicável
4. **Criar typedefs centralizados** — para conceitos repetidos (SDK types, event payloads, config)
5. **Não quebrar testes** — 1924 pass deve ser mantido a cada fase

### Métricas-alvo

| Métrica                                       | Antes | Final     | Meta   |
| --------------------------------------------- | ----- | --------- | ------ |
| `@type {any}` (não-catch)                     | 99    | **0**     | 0 ✅   |
| `@type {any}` (catch — irredutível TS1196)    | 138   | 139       | n/a    |
| `@param {any}`                                | 21    | **0**     | 0 ✅   |
| `@returns {any}` / `Promise<any>`             | 11    | **1**     | 0 ⚠️   |
| `ZodSchema<any>` (SDK genérico — irredutível) | —     | 11        | ≤ 11   |
| `Tool<any>` (SDK genérico)                    | —     | **0**     | 0 ✅   |
| Erros `noPropertyAccessFromIndexSig`          | 142   | **0**     | 0 ✅   |
| `noImplicitOverride`                          | —     | **0**     | 0 ✅   |
| `@throws` tags                                | 21    | **37**    | 80+ ⚠️ |
| `@typedef` declarações                        | 187   | **209**   | 220+   |
| `@param` tags                                 | 576   | **789**   | —      |
| `@returns` tags                               | 576   | **577**   | —      |
| `@example` tags                               | —     | **30**    | 50+    |
| `@module` tags                                | —     | 117       | 115    |
| `@see` cross-references                       | —     | **9**     | 30+    |
| Blocos JSDoc `/** */`                         | 1.899 | **1.985** | —      |
| Erros typecheck strict                        | 0     | **0**     | 0 ✅   |

---

## 3. Fases e Subfases

### FASE 1 — Infraestrutura de tipos (F1)

Criar os tipos centrais que serão referenciados por todas as fases seguintes.

#### F1.1 — Tipagem forte de `process.env` (ENV-01..03)

**Objetivo**: Resolver todos os 142 erros `TS4111` criando interface tipada de environment.

- **ENV-01**: Criar `src/copilot/core/env.js` com `@typedef {Object} CopilotEnv` declarando todas as
  variáveis de ambiente usadas em `src/copilot/` (78 acessos, ~35 variáveis distintas)
- **ENV-02**: Criar função helper `getEnv(key, defaultValue)` com tipagem que retorna `string` e
  evita acesso direto via `process.env.VAR` (padrão bracket `process.env['VAR']`)
- **ENV-03**: Habilitar `noPropertyAccessFromIndexSignature` no tsconfig strict copilot e verificar
  erro zero

#### F1.2 — Typedefs centrais SDK (SDK-01..05)

**Objetivo**: Tipar os conceitos do SDK Copilot que são `any` em todo o codebase.

- **SDK-01**: `src/copilot/core/types.js` — adicionar `@typedef` para `CopilotSession`,
  `CopilotClient`, `CopilotTurn`, `SessionConfig`
- **SDK-02**: `src/copilot/core/types.js` — adicionar `@typedef` para `ToolDefinition`,
  `ToolResult`, `ToolCallPayload`
- **SDK-03**: `src/copilot/core/types.js` — adicionar `@typedef` para `DialogMessage`, `DialogTurn`,
  `DialogResponse`
- **SDK-04**: `src/copilot/core/types.js` — adicionar `@typedef` para `AgentTask`, `TaskResult`,
  `TaskStatus`
- **SDK-05**: `src/copilot/core/types.js` — adicionar `@typedef` para event payloads:
  `AgentEventPayload`, `SessionEventPayload`, `UsageInfo`

#### F1.3 — Typedefs para API/HTTP (API-01..03)

- **API-01**: Tipar `Request`/`Response` Express handlers com import adequado de `@types/express`
  (já em devDependencies)
- **API-02**: Tipagem dos payloads de request/response para cada endpoint bridge
- **API-03**: Tipagem dos SSE event payloads

---

### FASE 2 — Eliminação de `any` no core agent (F2)

Foco nos 97 usos de `any` em `src/copilot/agent/`. Prioridade pelos top-5 arquivos.

#### F2.1 — `always-alive.js` (26 any) → (AA-01..08)

- **AA-01**: Tipar `#client` e `#session` com os typedefs SDK-01
- **AA-02**: Tipar `#messageCache` e retorno de `listMessages()`
- **AA-03**: Tipar `#tools` array e `_registeredTools` Map
- **AA-04**: Tipar `getStatusSnapshot()` retorno com typedef explícito
- **AA-05**: Tipar callbacks e handlers de eventos (`on`/`emit` payloads)
- **AA-06**: Tipar `#config` com `SessionConfig` typedef
- **AA-07**: Substituir `@type {any}` em variáveis locais por tipos inferidos/concretos
- **AA-08**: Adicionar `@throws` em métodos que lançam (start, stop, executeTask)

#### F2.2 — `dialog-loop-manager.js` (10 any) → (DLM-01..04)

- **DLM-01**: Tipar `#dialogQueue` e items com `DialogMessage` typedef
- **DLM-02**: Tipar `sendDialogTurn()` params e retorno
- **DLM-03**: Tipar `#watchdogTimer` e callbacks
- **DLM-04**: Adicionar `@throws` em `processQueue()` e `sendTurn()`

#### F2.3 — `session-event-wirer.js` (10 any) → (SEW-01..03)

- **SEW-01**: Tipar payloads dos event handlers (`data` param em cada listener)
- **SEW-02**: Tipar `writeStateAsync()` param com estado concreto
- **SEW-03**: Substituir `/** @type {any} */` por tipo inferido do SDK

#### F2.4 — `entry.js` (6 any) → (ENT-01..02)

- **ENT-01**: Tipar `bootstrapAgent()` config param e retorno
- **ENT-02**: Tipar error handlers com `unknown` (já herdado de `useUnknownInCatchVariables`)

#### F2.5 — Demais agent/ (35 any restantes) → (AGR-01..06)

- **AGR-01**: `task-executor.js` (5) — tipar `AgentTask`, `TaskResult`
- **AGR-02**: `webhook-manager.js` (3) — tipar webhook payload e response
- **AGR-03**: `permission-controller.js` (3) — tipar `PermissionDecision` e `ToolPermission`
- **AGR-04**: `message-queue.js` (3) — tipar queue items com `AgentTask`
- **AGR-05**: `tool-audit-logger.js` (3) — tipar `AuditEntry`
- **AGR-06**: `state-io.js`, `status-snapshot.js`, `reconnect-policy.js`, `dialog-protocol.js`,
  `dialog-watchdog.js`, `agent-contract.js`, `events.js` — varrer restantes

---

### FASE 3 — Eliminação de `any` em tools/ e terminal/ (F3)

#### F3.1 — `tools/` (49 any) → (TL-01..08)

- **TL-01**: `file-tools.js` (14) — tipar file operation params e results
- **TL-02**: `todo-tools.js` (9) — tipar todo list item e operations
- **TL-03**: `hub-tools.js` (7) — tipar hub interaction payloads
- **TL-04**: `git/index.js` (6) — tipar git operation results
- **TL-05**: `task-tools.js` (6) — tipar task management payloads
- **TL-06**: `session-rpc-tools.js` (5) — tipar RPC call/response
- **TL-07**: `web-tools.js` (4) — tipar fetch results
- **TL-08**: `introspection-tools.js` (4), `tool-factory.js`, `permission-tools.js`, restantes

#### F3.2 — `terminal/` (52 any) → (TM-01..07)

- **TM-01**: `http-handlers.js` (21) — tipar req/res handlers Express
- **TM-02**: `dialog.js` (9) — tipar dialog state e message flow
- **TM-03**: `repl.js` (5) — tipar REPL input/output
- **TM-04**: `index.js` (6) — tipar terminal server bootstrap
- **TM-05**: `commands/gh.js` (4) — tipar GitHub CLI wrappers
- **TM-06**: `state.js`, `workspace-context.js`, `file-context.js` — tipar state objects
- **TM-07**: `commands/*` restantes — varrer cada command handler

---

### FASE 4 — Eliminação de `any` em bridges/, lib/, config/ (F4)

#### F4.1 — `bridges/` (30 any) → (BR-01..04)

- **BR-01**: `mcp-tool-bridge.js` (15) — tipar MCP tool calls e responses
- **BR-02**: `nerv-bridge.js` (6) — tipar NervBus event payloads
- **BR-03**: `llm-bridge-client.js`, `inject-llmb.js` — tipar LLM-B protocol
- **BR-04**: `gh-bridge.js`, `git-bridge.js`, `alias-store.js` — tipar bridge contracts

#### F4.2 — `lib/` (23 any) → (LB-01..05)

- **LB-01**: `session.js` (10) — tipar session lifecycle methods
- **LB-02**: `client.js` (8) — tipar client connection methods
- **LB-03**: `utils.js`, `tools-registry.js`, `permissions.js` — tipar helpers
- **LB-04**: `http-request.js`, `url-validator.js` — tipar HTTP helpers
- **LB-05**: `event-helpers.js`, `hooks.js`, `telemetry.js`, `models.js`, `agents.js` — restantes

#### F4.3 — `config/` (16 any) → (CF-01..03)

- **CF-01**: `session-config.js` (5) — tipar config merge e validation
- **CF-02**: `tools/registry.js` (6), `tools/state.js` (5) — tipar tool registry
- **CF-03**: `mcp-servers.js` (4), `system-prompt.js`, `custom-agents.js`, `pinned-files-loader.js`
  — tipar config loaders

---

### FASE 5 — Eliminação de `any` em api/, channel/, conversation-hub/, routes/ (F5)

#### F5.1 — `conversation-hub/` (30 any) → (CH-01..03)

- **CH-01**: `socket-ns.js` (12) — tipar Socket.IO namespace handlers
- **CH-02**: `store.js` (10) — tipar conversation store operations
- **CH-03**: `orchestrator.js` (8) — tipar orchestration payloads

#### F5.2 — `api/` (12 any) → (AP-01..03)

- **AP-01**: `bridge-tasks.js` (5) — tipar task API handlers
- **AP-02**: `bridge-control.js` (4) — tipar control API handlers
- **AP-03**: `bridge-stream.js`, `bridge-dialog.js`, `http-bridge.js`, `sdk-api.js` — restantes

#### F5.3 — `channel/` (11 any) → (CN-01..02)

- **CN-01**: `client.js` (7) — tipar channel client methods
- **CN-02**: `inject.js` (4), `audit.js`, `index.js` — restantes

#### F5.4 — `routes/` (7 any) → (RT-01..02)

- **RT-01**: `client.js` (7) — tipar route handlers
- **RT-02**: `middleware.js`, `agent.js`, `sessions.js`, `webhooks.js` — restantes

---

### FASE 6 — Hardening TSConfig e docs (F6)

#### F6.1 — TSConfig enhancements (TS-01..04)

- **TS-01**: Adicionar `noPropertyAccessFromIndexSignature: true` ao tsconfig strict copilot
  (pré-requisito: ENV-01..03 completos)
- **TS-02**: Adicionar `noImplicitOverride: true` — verificar/anotar overrides em `AlwaysAliveAgent`
- **TS-03**: Verificar que `strictBuiltinIteratorReturn: true` (herdado de strict) não gera erros
- **TS-04**: Rodar análise final de cobertura de tipagem e registrar métricas pós-refatoração

#### F6.2 — JSDoc enhancements gerais (JD-01..05)

- **JD-01**: Adicionar `@throws` em todas as funções que lançam exceções (meta: 80+ tags)
- **JD-02**: Adicionar `@example` em funções de API pública (tools, bridges, lib)
- **JD-03**: Adicionar `@see` cross-references entre módulos relacionados
- **JD-04**: Verificar consistência `@module` em todos os 115 arquivos
- **JD-05**: Adicionar `@template` em funções genéricas (se houver)

#### F6.3 — Verificação final (VF-01..03)

- **VF-01**: Rodar
  `npx tsc --project config/typing/strict/tsconfig.strict.src.copilot.json --noEmit` → 0 erros
- **VF-02**: Rodar
  `npx tsc --project config/typing/strict/tsconfig.strict.src.copilot.json --noEmit --noPropertyAccessFromIndexSignature`
  → 0 erros
- **VF-03**: Rodar test suite completa → 1924+ pass, 0 fail
- Registrar métricas finais neste documento

---

## 4. Rastreamento de Progresso

### Commits realizados

| Commit     | Fase      | Descrição                                                                                                     |
| ---------- | --------- | ------------------------------------------------------------------------------------------------------------- |
| `52121d9f` | Phase 1   | `noPropertyAccessFromIndexSignature` + fix all TS4111 (36 files)                                              |
| `05a4112d` | Phase 2   | Eliminate all non-catch `@type {any}` casts (38 files, ~516 LOC)                                              |
| (pendente) | Phase 3-9 | SDK typedefs, @param/@returns {any} elimination, @throws/@example/@see enrichment, ZodSchema audit (37 files) |

### Mapeamento fases originais → execução real

| Fase original  | O que foi feito                                                                                | Status         |
| -------------- | ---------------------------------------------------------------------------------------------- | -------------- |
| F1.1 (ENV)     | `process.env.VAR` → bracket access em 36 arquivos                                              | ✅ Phase 1     |
| F1.2 (SDK)     | `src/copilot/types/sdk.js` com 13 re-exports SDK                                               | ✅ Phase 3 WIP |
| F2 (agent/)    | 97 `any` eliminados (always-alive, session-event-wirer, task-executor, reconnect-policy, etc.) | ✅ Phase 2+3   |
| F3 (tools/)    | 49 `any` eliminados (tool-factory, session-rpc-tools, file-tools, git/, etc.)                  | ✅ Phase 2     |
| F3 (terminal/) | 52 `any` eliminados (http-handlers, dialog, repl, commands/)                                   | ✅ Phase 2     |
| F4 (bridges/)  | 30 `any` eliminados (mcp-tool-bridge, nerv-bridge, gh-bridge, etc.)                            | ✅ Phase 2     |
| F4 (lib/)      | 23 `any` eliminados (session, client, permissions, hooks, etc.)                                | ✅ Phase 2+3   |
| F4 (config/)   | 16 `any` eliminados (session-config, tools/registry, etc.)                                     | ✅ Phase 2     |
| F5 (hub/)      | 30 `any` eliminados (socket-ns, store, orchestrator, hub)                                      | ✅ Phase 2+3   |
| F5 (api/)      | 12 `any` eliminados (bridge-stream, bridge-tasks, etc.)                                        | ✅ Phase 2+3   |
| F5 (channel/)  | 11 `any` eliminados (inject, client)                                                           | ✅ Phase 2     |
| F5 (routes/)   | 7 `any` eliminados (client, middleware)                                                        | ✅ Phase 2     |
| F6.1 (TS-01)   | `noPropertyAccessFromIndexSignature: true` habilitada                                          | ✅ Phase 1     |
| F6.1 (TS-02)   | `noImplicitOverride: true` — já habilitado, 0 erros                                            | ✅ Phase 5     |
| F6.2 (JD-01)   | `@throws` enrichment — 21 → 37 tags                                                            | ✅ Phase 6     |
| F6.2 (JD-02)   | `@example` enrichment — 25 → 30 tags                                                           | ✅ Phase 8     |
| F6.2 (JD-03)   | `@see` cross-references — 0 → 9 tags                                                           | ✅ Phase 8     |
| F6.3 (VF)      | Verificação final — 0 erros, 1924 pass, 0 fail                                                 | ✅ Phase 9     |

### Itens residuais de `any` (pós-Phase 2+3)

#### Irredutíveis (aceitar como-está)

| Padrão                         | Ocorrências | Razão                                        |
| ------------------------------ | ----------- | -------------------------------------------- |
| `@type {any}` em catch clause  | 139         | TS1196: catch só aceita `any` ou `unknown`   |
| `ZodSchema<any>` (SDK generic) | 11          | SDK exige `any` no type parameter da tool    |
| `@returns {Promise<any>}`      | 1           | `gh-bridge.js:runGhJson` — JSON.parse de CLI |

#### Redutíveis — ✅ Todos resolvidos (Phase 4+7)

Todos os 9 `@returns {any}` foram eliminados, exceto 1 irredutível (`runGhJson` — JSON.parse de
output CLI). `Tool<any>` em `hub-tools.js` foi narrowed para `Tool[]` (default `Tool<unknown>`).

---

## 5. Convenções para esta refatoração

### Padrão para tipagem de `process.env`

```javascript
// ANTES (gera TS4111 com noPropertyAccessFromIndexSignature):
const model = process.env.COPILOT_MODEL || 'default';

// DEPOIS (bracket access — compatível com index signature):
const model = process.env['COPILOT_MODEL'] || 'default';
```

### Padrão para eliminação de `any`

```javascript
// ANTES:
/** @type {any} */
const data = event.data;

// DEPOIS — opção A: tipo concreto via typedef
/** @type {SessionEventPayload} */
const data = event.data;

// DEPOIS — opção B: tipo inline
/** @type {{ kind: string; payload: Record<string, unknown> }} */
const data = event.data;

// DEPOIS — opção C: unknown + refinamento
/** @type {unknown} */
const raw = event.data;
if (typeof raw === 'object' && raw !== null && 'kind' in raw) {
  // type narrowing automático
}
```

### Padrão para `@throws`

```javascript
/**
 * Inicia o agente.
 * @throws {CopilotError} Se o client não foi configurado
 * @throws {Error} Se a sessão já está ativa
 */
async start() { ... }
```

### Padrão para `@template`

```javascript
/**
 * @template T
 * @param {string} key
 * @param {T} defaultValue
 * @returns {T}
 */
function getConfigValue(key, defaultValue) { ... }
```

### Padrão para bracket access em `Record<string, unknown>`

```javascript
// ANTES (TS4111 com noPropertyAccessFromIndexSignature):
const val = config.someKey;

// DEPOIS:
const val = config['someKey'];
```

### Padrão para assertive cast (valor nominalmente nullable)

```javascript
// Quando o contexto garante que o valor não é null/undefined:
/** @type {import('@github/copilot-sdk').CopilotClient} */ (this.#client);
```

---

## 6. Critérios de Qualidade por Commit

1. `npx tsc --project config/typing/strict/tsconfig.strict.src.copilot.json --noEmit` → 0 erros
2. `npx eslint <arquivos alterados>` → 0 erros
3. `npx prettier --check <arquivos alterados>` → 0 erros
4. `node --strip-types --test 'tests/unit/**/*.spec.js'` → 1924+ pass, 0 fail
5. Nenhum `any` novo introduzido

---

## 7. Padrões descobertos durante execução

### SDK `SessionEvent` é inutilizável para event handlers

O tipo `import('@github/copilot-sdk').SessionEvent` é uma **discriminated union com ~66 variantes**.
Quando `session.on('specific.event', callback)` é chamado, o callback recebe a **união completa** —
TypeScript não narra automaticamente. Propriedades como `deltaContent`, `toolCallId`, etc. não
existem em todas as variantes, gerando erros TS7053.

**Solução**: usar typedef local `SdkEvent` com
`{ id?: string; timestamp?: string; type?: string; data?: Record<string, unknown> }` e acessar dados
via bracket notation.

### Catch clause `@type {any}` é irredutível (TS1196)

TypeScript exige que variáveis de catch clause sejam `any` ou `unknown`. Os 138 `@type {any}` em
catch clauses **não podem** ser eliminados — são um artefato da linguagem.

### `exactOptionalPropertyTypes` exige conditional spread

Com esta flag, `{ prop?: string }` **não aceita** `{ prop: undefined }`. O padrão correto é:

```javascript
...(val !== undefined ? { prop: val } : {})
```

### Double-cast para tipos incompatíveis

Quando o tipo fonte e destino não se sobrepõem, usar:

```javascript
/** @type {TargetType} */ (/** @type {unknown} */ (value));
```

### `ZodSchema<any>` do SDK é irredutível

O SDK Copilot define `Tool.parameters` como `ZodSchema<any>`. Casts de Zod schemas requerem
`ZodSchema<any>` como destino — não há alternativa tipada disponível no SDK.

---

## 8. Fases restantes (reorganizadas) — ✅ TODAS COMPLETAS

> As fases F1 a F5 originais foram executadas de forma consolidada nos Phases 1-3. As fases abaixo
> foram executadas nos Phases 4-9 e estão todas completas.

### PHASE 4 — Eliminação de `@returns {any}` ✅

9 → 1 irredutível (`runGhJson`). Todos os demais receberam tipos concretos:

- `lib/session.js` → `Record<string, unknown>`
- `lib/telemetry.js` → OtelSpan/OtelTracer typedefs
- `channel/client.js` → `Record<string, unknown>` event type
- `conversation-hub/orchestrator.js` → `parseError: unknown`
- `tools/file-tools.js` → DirEntry typedef
- `tools/session-rpc-tools.js` → `{ call?: Function } | null` cast

### PHASE 5 — `noImplicitOverride: true` ✅

Flag já habilitada no TSConfig. 0 erros — `AlwaysAliveAgent extends EventEmitter` não faz override
de métodos que requerem a keyword.

### PHASE 6 — `@throws` enrichment ✅

21 → 37 tags (+16). Funções anotadas: `registerCustomAgent`, `createAgent`, `buildReasoningConfig`,
`rpcCall`, `sendToLlmB`, `#executeSendToLlmB`, `#callViaDialogLoop`, `#callViaStructured`,
`#callViaSimpleChat`, `start` (dialog-loop), `register` (webhook), `resumeDialogLoop`, `writeTurn`,
`migrate`, `_doInjectToLlmB`, `chatBatch`, + updates BridgeError em inject.js.

### PHASE 7 — `ZodSchema<any>`/`Tool<any>` audit ✅

13 → 11. `Tool<any>[]` em hub-tools.js → `Tool[]` (defaults to unknown). 11 `ZodSchema<any>`
confirmados como irredutíveis (SDK defineTool type inference chain).

### PHASE 8 — `@example` + `@see` enrichment ✅

- `@example`: 25 → 30 (+5): createTelemetry, recordToolCall, createRegistry, registerTool,
  registerCustomAgent, webhook register
- `@see`: 0 → 9 (+9): createAgent↔createReadOnlyAgent↔createFullAccessAgent,
  supportsReasoning↔getSupportedReasoningEfforts↔buildReasoningConfig,
  hub.orchestrator↔ConversationStore↔HubOrchestrator

### PHASE 9 — Verificação final ✅

- Typecheck: `npx tsc --project config/typing/strict/tsconfig.strict.src.copilot.json --noEmit` →
  **0 erros**
- Tests: `node --strip-types --test 'tests/unit/**/*.spec.js'` → **1924 pass, 0 fail, 2 cancelled**
- 37 files changed, 520 insertions(+), 175 deletions(-)

---

## 9. Referências

- **TSConfig oficial**: https://www.typescriptlang.org/tsconfig
- **JSDoc Reference**: https://www.typescriptlang.org/docs/handbook/jsdoc-supported-types.html
- **TSConfig strict copilot**: `config/typing/strict/tsconfig.strict.src.copilot.json`
- **TSConfig base**: `tsconfig.base.json`
- **TSConfig node**: `tsconfig.node.json`
- **Plano G2**: `DOCUMENTAÇÃO/AUDITORIAS/AGENT-REFACTOR-PLAN-G2.md`
