# Sistema de Hooks — Análise Profunda e Roadmap de Implementação

**Status**: Ativo — Fases A–M concluídas; fases N–Q em execução **Data**: 2026-06-27 **Última
atualização**: 2026-07-03 **Escopo**: `src/copilot/hooks/` (módulo unificado, isolado) + integração
com `agent/`, `lib/` e `routes/`

---

## 1. Visão Geral e Motivação

### 1.1 Situação atual (diagnóstico)

O sistema de hooks do `src/copilot` está **fragmentado** em múltiplos locais sem uma pasta dedicada:

| Arquivo atual                              | Responsabilidade                                                          | Problema                                                 |
| ------------------------------------------ | ------------------------------------------------------------------------- | -------------------------------------------------------- |
| `src/copilot/lib/hooks.js`                 | Factory `createHooks()` para os 6 slots SDK                               | ✅ Bem estruturado, mas isolado                           |
| `src/copilot/lib/permissions.js`           | `PermissionHandler` / `onPermissionRequest`                               | ⚠️ Conceitualmente é um hook, está em lib/                |
| `src/copilot/agent/session-hooks.js`       | `onSessionStart`, `onSessionEnd`, `onErrorOccurred` para AlwaysAliveAgent | ⚠️ Hooks de ciclo de vida do agente misturados com agent/ |
| `src/copilot/tools/hook-tools.js`          | Custom Tools `hook_get_audit_tail`, `request_user_input`                  | ⚠️ "Hook tools" mas está em tools/                        |
| `src/copilot/agent/session-initializer.js` | Passa `hooks` para `createSession()`/`resumeSession()`                    | ⚠️ Hooks criados inline sem factory explícita             |
| `src/copilot/lib/session.js`               | `buildSessionConfig()` monta hooks na config de sessão                    | ⚠️ Lógica de composição de hooks inline                   |
| `src/copilot/agent/tool-audit-logger.js`   | Log de auditoria de tools                                                 | ⚠️ Relacionado a `onPostToolUse`, mas separado            |

**Contaminação**: `session-initializer.js` referencia `BRIEFING_FILE` e `SESSION_JSON_FILE` de
`.github/hooks/state/` — misturando os hooks operacionais (`.github/hooks/`) com os hooks do SDK
(`@github/copilot-sdk`). São sistemas completamente distintos.

### 1.2 O que o SDK suporta (API oficial `@github/copilot-sdk`)

#### Hooks da sessão (`SessionHooks` — via `createSession({ hooks })`)

| Hook                    | Input                                                                    | Output                                                                              | Funcionalidade                                         |
| ----------------------- | ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------- | ------------------------------------------------------ |
| `onPreToolUse`          | `{ toolName, toolArgs, timestamp, cwd }`                                 | `{ permissionDecision: 'allow'\|'deny'\|'ask', modifiedArgs?, additionalContext? }` | Intercepta tool antes de executar; pode modificar args |
| `onPostToolUse`         | `{ toolName, toolArgs, toolResult, timestamp, cwd }`                     | `{ additionalContext? }`                                                            | Processa resultado após execução                       |
| `onUserPromptSubmitted` | `{ prompt, timestamp, cwd }`                                             | `{ modifiedPrompt? }`                                                               | Intercepta prompt do usuário; pode modificar           |
| `onSessionStart`        | `{ source: 'startup'\|'resume'\|'new', initialPrompt?, timestamp, cwd }` | `{ additionalContext? }`                                                            | Executado ao iniciar/retomar sessão                    |
| `onSessionEnd`          | `{ reason, finalMessage?, error?, timestamp, cwd }`                      | `void`                                                                              | Limpeza ao encerrar sessão                             |
| `onErrorOccurred`       | `{ error, errorContext, recoverable, timestamp, cwd }`                   | `{ errorHandling: 'retry'\|'skip'\|'abort', retryCount? }`                          | Controle de recuperação de erros                       |

#### Handler de permissão (`onPermissionRequest` — via `createSession({ onPermissionRequest })`)

Tecnicamente **não é um hook** (é parâmetro obrigatório separado), mas conceitualmente faz parte do
mesmo sistema de controle de execução.

| Kind          | Descrição                              |
| ------------- | -------------------------------------- |
| `shell`       | Executar comando shell                 |
| `write`       | Escrever/editar arquivo                |
| `read`        | Ler arquivo                            |
| `mcp`         | Chamar tool MCP                        |
| `custom-tool` | Chamar tool registrada pelo usuário    |
| `url`         | Fetch de URL                           |
| `memory`      | Memória persistente de sessão          |
| `hook`        | Invocar hook ou integração server-side |

#### Handler de input interativo (`onUserInputRequest` — via `createSession({ onUserInputRequest })`)

Habilita a tool nativa `ask_user` do CLI.

| Input                                    | Output                    |
| ---------------------------------------- | ------------------------- |
| `{ question, choices?, allowFreeform? }` | `{ answer, wasFreeform }` |

### 1.3 Gaps identificados

**Gap 1 — `onUserPromptSubmitted.modifiedPrompt` não utilizado** O SDK suporta modificar o prompt
antes de ser processado via `modifiedPrompt`, mas o retorno atual do handler
(`onUserPromptSubmitted` em `hooks.js`) apenas loga e não retorna `modifiedPrompt`. Não há nenhuma
funcionalidade de transformação de prompt implementada.

**Gap 2 — `onPreToolUse.modifiedArgs` não utilizado** O SDK suporta modificar argumentos de tools
via `modifiedArgs` no retorno de `onPreToolUse`, mas nenhum handler do projeto usa isso.

**Gap 3 — `onPostToolUse` sem retorno de `additionalContext`** O handler de `onPostToolUse` em
`auditLog` mode apenas loga, mas não injeta `additionalContext` de volta ao modelo.

**Gap 4 — `onSessionStart.additionalContext` não utilizado** `onSessionStart` pode retornar
`additionalContext` para enriquecer o contexto do modelo. Os handlers atuais retornam `{}` vazio.

**Gap 5 — `onUserInputRequest` não configurável via factory** `onUserInputRequest` é passado
diretamente sem passar pela factory `createHooks()`.

**Gap 6 — Ausência de hook pipeline/middleware** Não existe composição de múltiplos handlers em
pipeline exceto `composePreToolUseHandlers()`.

**Gap 7 — Sem sistema de eventos de hooks (hook bus)** Não há bus de eventos para hooks — impossível
adicionar observadores sem modificar o handler.

**Gap 8 — Sem hook registry tipado** Não há registro centralizado de hooks disponíveis com seus
contratos (input/output types).

**Gap 9 — `onPermissionRequest` e `onUserInputRequest` fora da factory** Esses dois handlers são
passados sem passar pelo sistema de hooks — desacoplamento incompleto.

**Gap 10 — Tool `hook_get_audit_tail` lê `.github/hooks/state/audit.jsonl`** Isso mistura logs do
hook system operacional (`.github/`) com o feedback do SDK.

---

## 2. Arquitetura Proposta: `src/copilot/hooks/`

```
src/copilot/hooks/
├── index.js                    # Barrel: re-exporta toda a API pública do módulo
├── types.js                    # @typedef JSDoc: todos os tipos do sistema de hooks
├── registry.js                 # HookRegistry: registro tipado de hooks disponíveis
├── factory.js                  # createHooks() e presets (migrado de lib/hooks.js)
├── composer.js                 # composeHandlers(), pipeline(), createHookBus()
├── permission-handler.js       # createPermissionHandler() (migrado de lib/permissions.js)
├── user-input-handler.js       # createUserInputHandler() — NOVO
├── prompt-transformer.js       # Transformadores de onUserPromptSubmitted — NOVO
├── tool-interceptor.js         # Interceptores de onPreToolUse / onPostToolUse — NOVO
├── session-lifecycle.js        # onSessionStart / onSessionEnd handlers — NOVO
├── error-handler.js            # Estratégias de onErrorOccurred (retry/skip/abort) — NOVO
├── audit.js                    # Auditoria centralizada para hooks (migrado de tool-audit-logger.js)
├── bus.js                      # HookEventBus: observadores sem acoplamento — NOVO
└── presets/
    ├── minimal.js              # createMinimalHooks()
    ├── audit.js                # createAuditHooks()
    ├── safe.js                 # createSafeHooks()
    ├── deny-all.js             # createDenyAllHooks()
    └── production.js           # createProductionHooks() — NOVO
```

### 2.1 Princípios de design

1. **Isolamento total**: nenhuma referência a `.github/hooks/` ou `session-briefing.md`
2. **Injeção de dependências**: sem imports ou side effects no carregamento
3. **Composição sobre herança**: handlers compostos via `compose()` e `pipeline()`
4. **Tipagem explícita**: todos os inputs/outputs com JSDoc `@typedef`
5. **Zero surpresas**: handlers puros, sem estado global mutável
6. **API estável**: `index.js` estático — nada muda sem versionamento

---

## 3. Roadmap de Implementação

### Fase A — Criação da pasta `src/copilot/hooks/` e migração base

**Objetivo**: Criar a estrutura e migrar código existente sem quebrar nada.

#### A.1 — Criar `src/copilot/hooks/types.js`

Centralizar todos os `@typedef` de hooks em um só lugar:

- `SessionHooks`, `HookConfig`, `PreToolUseHookInput`, `PostToolUseHookInput`
- `UserPromptSubmittedHookInput`, `SessionStartHookInput`, `SessionEndHookInput`
- `ErrorOccurredHookInput`, `InvocationContext`
- `PermissionHandlerConfig`, `UserInputHandlerConfig`
- `HookPipeline<T>`, `HookMiddleware<T>`, `HookBusEvent`

#### A.2 — Migrar `src/copilot/lib/hooks.js` → `src/copilot/hooks/factory.js`

- Mover `createHooks()`, `createMinimalHooks()`, `createAuditHooks()`, `createDenyAllHooks()`,
  `createSafeHooks()`
- Mover `composePreToolUseHandlers()`, `createErrorNotifierHook()`
- Atualizar imports: `#copilot/hooks/factory` ou `#copilot/hooks`
- Manter `src/copilot/lib/hooks.js` como re-export de compatibilidade por 2 fases

#### A.3 — Migrar `src/copilot/lib/permissions.js` → `src/copilot/hooks/permission-handler.js`

- Mover `createPermissionHandler()`, `makeApproved()`, `makeDenied()`
- Atualizar `src/copilot/agent/permission-controller.js` para importar de `#copilot/hooks`
- Manter `src/copilot/lib/permissions.js` como re-export de compatibilidade

#### A.4 — Migrar `src/copilot/agent/session-hooks.js` → `src/copilot/hooks/session-lifecycle.js`

- Mover `createSessionHooks()` para `session-lifecycle.js`
- Adicionar typedefs locais para `SessionHooksContext`
- Atualizar `src/copilot/agent/always-alive.js` para importar de `#copilot/hooks`
- Manter `src/copilot/agent/session-hooks.js` como re-export de compatibilidade

#### A.5 — Criar `src/copilot/hooks/index.js` (barrel)

Exportar tudo da API pública de forma estável:

```js
export {
  createHooks,
  createMinimalHooks,
  createAuditHooks,
  createSafeHooks,
  createDenyAllHooks,
} from './factory.js';
export {
  createPermissionHandler,
  approveAllHandler,
  denyAllHandler,
} from './permission-handler.js';
export { createSessionHooks } from './session-lifecycle.js';
export { composeHandlers, pipeline } from './composer.js';
export { createUserInputHandler } from './user-input-handler.js';
```

#### A.6 — Registrar alias `#copilot/hooks` no `package.json`

```json
"#copilot/hooks": "./src/copilot/hooks/index.js"
```

---

### Fase B — Novos handlers para gaps do SDK

**Objetivo**: Implementar funcionalidades do SDK ainda não exploradas.

#### B.1 — `src/copilot/hooks/prompt-transformer.js` (Gap 1)

Implementar pipeline de transformação de prompts via `onUserPromptSubmitted`:

```js
// API pública:
export function createPromptTransformer(opts)
// opts: { sanitize?, addContext?, prefixWith?, maxLength?, onTransform? }
// Retorno do handler: { modifiedPrompt: transformedPrompt }
```

Funcionalidades:

- `sanitize`: remove PII simples (emails, tokens, keys)
- `addContext`: injeta contexto de workspace (cwd, branch, etc.)
- `prefixWith`: adiciona prefixo fixo ao prompt
- `maxLength`: trunca prompt se passar do limite
- `onTransform`: callback custom pré-processamento

#### B.2 — `src/copilot/hooks/tool-interceptor.js` (Gaps 2 e 3)

Interceptores para `onPreToolUse` e `onPostToolUse`:

```js
// API pública:
export function createToolInterceptor(opts)
// opts: {
//   onPre?: (input) => { modifiedArgs?, decision? },
//   onPost?: (input) => { additionalContext? },
//   argTransformers?: { [toolName]: (args) => args },
//   resultEnrichers?: { [toolName]: (result) => additionalContext }
// }
```

Funcionalidades:

- `argTransformers`: mapeia tool name → função que transforma args (Gap 2)
- `resultEnrichers`: mapeia tool name → função que gera `additionalContext` (Gap 3)
- Validação de args antes da execução
- Sanitização de resultados sensíveis antes de retornar ao modelo

#### B.3 — `src/copilot/hooks/user-input-handler.js` (Gap 5)

Factory para `onUserInputRequest`:

```js
// API pública:
export function createUserInputHandler(opts)
// opts: {
//   resolver?: (question, choices) => Promise<{ answer, wasFreeform }>,
//   timeout?: number,
//   fallback?: string
// }
```

Integra com o resolver do `hook-tools.js` (`resolveUserInput`/`_pendingInputResolvers`).

#### B.4 — `src/copilot/hooks/error-handler.js` (melhoria)

Estratégias configuráveis de recuperação:

```js
// API pública:
export function createErrorHandler(strategy)
// strategy: 'retry' | 'skip' | 'abort' | Record<errorContext, strategy>
// Retorno: { errorHandling, retryCount? }

export function createCircuitBreakerHandler(opts)
// opts: { maxRetries, resetAfterMs, onTrip? }
// Implementa padrão circuit-breaker para evitar retry infinito
```

#### B.5 — Enriquecer `onSessionStart` com `additionalContext` (Gap 4)

Atualizar `createSessionHooks()` para retornar contexto ao modelo:

- `cwd`, `branch`, `nodeVersion`, `hostname`
- Estado atual do agente (modelo ativo, sessões abertas)
- Snapshot de configuração relevante

---

### Fase C — HookBus e sistema de observadores

**Objetivo**: Desacoplar observadores dos handlers sem modificar assinaturas.

#### C.1 — `src/copilot/hooks/bus.js`

```js
// API pública:
export class HookBus extends EventEmitter
// eventos: 'pre_tool_use', 'post_tool_use', 'prompt_submitted', 'session_start', 'session_end', 'error_occurred', 'permission_request', 'user_input_request'

export function createBusMiddleware(bus)
// Retorna hooks que emitem em bus sem alterar comportamento
```

Usos:

- Métricas (contagem de tools por sessão)
- Dashboard em tempo real (SSE → frontend)
- Alertas (ferramentas potencialmente perigosas)
- Rastreabilidade completa

#### C.2 — Integrar `HookBus` no `createHooks()`

```js
export function createHooks(cfg = {}) {
  const { bus, ...restCfg } = cfg;
  // ...
  if (bus) {
    hooks = composeBusMiddleware(hooks, bus);
  }
  return hooks;
}
```

#### C.3 — Expor `HookBus` via SSE no servidor

Adicionar endpoint `/api/sdk/hooks/events` (Server-Sent Events) que emite eventos do `HookBus` em
tempo real para o frontend.

---

### Fase D — HookRegistry

**Objetivo**: Registro centralizado e introspecção de hooks disponíveis.

#### D.1 — `src/copilot/hooks/registry.js`

```js
// API pública:
export class HookRegistry
// .register(name, schema) — registra um hook com schema de input/output
// .get(name) — retorna schema de um hook
// .list() — lista todos os hooks registrados
// .validate(name, input) — valida input de um hook
// .isRegistered(name) — verifica se hook está registrado

export const SDK_HOOKS = new HookRegistry()
// Pré-populado com os 6 hooks do SDK + onPermissionRequest + onUserInputRequest
```

#### D.2 — Validação automática via registry

Adicionar validação de input em `createHooks()` quando `DEBUG=true`:

```js
if (process.env.NODE_ENV !== 'production') {
  hooks.onPreToolUse = validateWrapper(hooks.onPreToolUse, SDK_HOOKS.get('onPreToolUse'));
}
```

#### D.3 — Rota de introspecção `/api/sdk/hooks/registry`

Retornar lista de hooks registrados, schemas e implementações ativas.

---

### Fase E — Composer avançado

**Objetivo**: Composição poderosa de pipelines de hooks.

#### E.1 — `src/copilot/hooks/composer.js`

```js
// API pública:
export function composeHandlers(...handlers)   // chain: primeiro resultado com decisão vence
export function pipeline(...middlewares)       // pipeline: cada um pode transform input/output
export function fallback(primary, fallbackFn) // fallback se primary throwou
export function raceWithTimeout(handler, ms)  // timeout: abort se demorar mais que ms
export function memoize(handler, keyFn)       // cache: evita re-executar baseado em key
export function conditional(predicate, handler, elseHandler?) // condicional: só executa se predicate(input) === true
```

#### E.2 — Aplicar composição em `createHooks()`

Substituir lógica if/else dentro de `createHooks()` por composição via `pipeline()`:

```js
hooks.onPreToolUse = pipeline(
  auditLogMiddleware,
  resolveDecisionMiddleware({ allowTools, denyTools }),
  askMiddleware({ askHandler }),
);
```

---

### Fase F — Preset `production.js` e hardening

**Objetivo**: Preset pronto para produção com segurança e observabilidade.

#### F.1 — `src/copilot/hooks/presets/production.js`

```js
export function createProductionHooks(opts = {})
// opts: { bus?, errorNotifier?, toolAllowList?, auditSink? }
```

Combina:

- `onPreToolUse`: allowList obrigatória + auditoria
- `onPostToolUse`: log estruturado + métricas
- `onUserPromptSubmitted`: sanitização de PII + truncamento
- `onSessionStart`: contexto rico (`additionalContext`)
- `onSessionEnd`: métricas de sessão
- `onErrorOccurred`: circuit-breaker + notificação

#### F.2 — Testes de regressão

Criar suite de testes `tests/unit/copilot/hooks/` cobrindo:

- `factory.js`: todos os presets e combinações de config
- `composer.js`: composição e pipeline
- `permission-handler.js`: todos os kinds de `PermissionRequest`
- `prompt-transformer.js`: transformações e sanitização
- `error-handler.js`: circuit breaker e estratégias
- `bus.js`: emissão de eventos

---

### Fase G — Limpeza de arquivos migrados

**Objetivo**: Remover código duplicado após migração confirmada.

#### G.1 — Atualizar imports em toda a codebase

```bash
# Migrar imports de lib/hooks → hooks/factory ou hooks/
find src/copilot -name "*.js" -exec sed -i "s|#copilot/lib/hooks|#copilot/hooks|g" {} \;
find src/copilot -name "*.js" -exec sed -i "s|from '../lib/hooks.js'|from '#copilot/hooks'|g" {} \;
```

#### G.2 — Remover arquivos legados

- `src/copilot/lib/hooks.js` → remover (substituído por `hooks/factory.js`)
- `src/copilot/lib/permissions.js` → remover (substituído por `hooks/permission-handler.js`)
- `src/copilot/agent/session-hooks.js` → remover (substituído por `hooks/session-lifecycle.js`)

#### G.3 — Atualizar alias no package.json

```json
"#copilot/hooks": "./src/copilot/hooks/index.js",
"#copilot/lib/hooks": "./src/copilot/hooks/index.js"
```

---

### Fase H — Integração com tool-audit-logger e webhook

**Objetivo**: Conectar o sistema de hooks ao pipeline de auditoria e webhooks.

#### H.1 — Substituir `tool-audit-logger.js` por hook `onPostToolUse`

Atualmente `tool-audit-logger.js` tem lógica separada. Migrar para `onPostToolUse` dentro do
`HookBus`:

```js
// hooks/audit.js
export function createAuditPostToolHandler(auditLogger)
// retorna onPostToolUse que delega ao auditLogger existente
```

#### H.2 — Webhook via `HookBus`

Emitir eventos de webhook (`session.start`, `session.end`, etc.) via listeners no `HookBus` em vez
de chamadas diretas em `session-lifecycle.js`.

#### H.3 — Documentar API pública do módulo hooks

Gerar `src/copilot/hooks/README.md` com:

- API completa com exemplos
- Diagrama de fluxo de hooks
- Tabela de compatibilidade SDK

---

## 4. Tabela de Rastreamento de Gaps

| Gap | Descrição                                            | Fase | Arquivo alvo            | Status                                                          |
| --- | ---------------------------------------------------- | ---- | ----------------------- | --------------------------------------------------------------- |
| G1  | `onUserPromptSubmitted.modifiedPrompt` não utilizado | B.1  | `prompt-transformer.js` | ✅ Concluído                                                     |
| G2  | `onPreToolUse.modifiedArgs` não utilizado            | B.2  | `tool-interceptor.js`   | ✅ Concluído                                                     |
| G3  | `onPostToolUse.additionalContext` não retornado      | B.2  | `tool-interceptor.js`   | ✅ Concluído                                                     |
| G4  | `onSessionStart.additionalContext` vazio             | B.5  | `session-lifecycle.js`  | ✅ Concluído — retorna host, node, model, sessionId, source      |
| G5  | `onUserInputRequest` fora da factory                 | B.3  | `user-input.js`         | ✅ Concluído                                                     |
| G6  | Sem composição para todos os hooks                   | E.1  | `composer.js`           | ✅ Concluído                                                     |
| G7  | Sem HookBus/observadores                             | C.1  | `bus.js`                | ✅ Concluído                                                     |
| G8  | Sem registry tipado                                  | D.1  | `registry.js`           | ✅ Concluído                                                     |
| G9  | `onPermissionRequest` fora do módulo hooks           | A.3  | `permission-handler.js` | ✅ Concluído                                                     |
| G10 | `hook_get_audit_tail` usa `.github/hooks/`           | H.1  | `audit.js`              | ✅ Concluído — ring buffer SDK isolado; compliance como fallback |

---

## 5. Isolamento: SDK Hooks vs. `.github/hooks/`

**Problema**: `session-initializer.js` contém referências a
`.github/hooks/state/session-briefing.md` e `session.json` — misturando os hooks operacionais do
Copilot Agent com os hooks do SDK.

**Tipos distintos:**

| Tipo                  | Localização                                        | Propósito                                                   |
| --------------------- | -------------------------------------------------- | ----------------------------------------------------------- |
| **SDK Hooks**         | `@github/copilot-sdk` → `createSession({ hooks })` | Controle de execução de tools e ciclo de vida da sessão SDK |
| **Operacional Hooks** | `.github/hooks/`                                   | Controle de compliance do agente GitHub Copilot (VS Code)   |

**Regra**: `src/copilot/hooks/` **NUNCA** deve importar de `.github/hooks/` ou qualquer path
relativo a `.github/`. Se precisar de dados do estado operacional, recebe via injeção de
dependência.

---

## 6. Alias e Imports

### Aliases a criar/atualizar em `package.json`:

```json
{
  "imports": {
    "#copilot/hooks": "./src/copilot/hooks/index.js",
    "#copilot/hooks/factory": "./src/copilot/hooks/factory.js",
    "#copilot/hooks/permission": "./src/copilot/hooks/permission-handler.js",
    "#copilot/hooks/composer": "./src/copilot/hooks/composer.js",
    "#copilot/hooks/bus": "./src/copilot/hooks/bus.js",
    "#copilot/hooks/registry": "./src/copilot/hooks/registry.js"
  }
}
```

> Os aliases `#copilot/lib/hooks` e `#copilot/lib/permissions` serão mantidos como re-exports de
> compatibilidade até a Fase G.

---

## 7. Diagrama de Fluxo

```
createSession(config)
      │
      ├─ hooks: createHooks(cfg)        ← src/copilot/hooks/factory.js
      │         │
      │         ├─ onPreToolUse ─────── composer.pipeline(
      │         │                           auditMiddleware,
      │         │                           toolInterceptor,
      │         │                           permissionCheck,
      │         │                           bus.emit('pre_tool_use')
      │         │                       )
      │         │
      │         ├─ onPostToolUse ─────── composer.pipeline(
      │         │                           resultEnricher,
      │         │                           auditLogger,
      │         │                           bus.emit('post_tool_use')
      │         │                       )
      │         │
      │         ├─ onUserPromptSubmitted ← promptTransformer(sanitize, addContext)
      │         ├─ onSessionStart ─────── sessionLifecycle.onStart (+ additionalContext)
      │         ├─ onSessionEnd ───────── sessionLifecycle.onEnd
      │         └─ onErrorOccurred ────── errorHandler(circuitBreaker)
      │
      ├─ onPermissionRequest ─────────── src/copilot/hooks/permission-handler.js
      └─ onUserInputRequest ──────────── src/copilot/hooks/user-input-handler.js

HookBus ←────── emite eventos de todos os hooks
    │
    ├── SSE /api/sdk/hooks/events ──── frontend dashboard
    ├── webhook-manager               ← session.start, session.end
    └── tool-audit-logger             ← audit.jsonl interno
```

---

## 8. Critérios de Sucesso

### Critérios originais (Fases A–G): todos concluídos

- [x] **Módulo `src/copilot/hooks/` criado e isolado**
- [x] **Alias `#copilot/hooks` registrado no `package.json`** (+ todos os aliases granulares)
- [x] **Todos os 6 hooks SDK** implementados com suporte a retornos completos (modifiedArgs,
      modifiedPrompt, additionalContext)
- [x] **`onPermissionRequest` e `onUserInputRequest`** gerenciados pelo módulo `hooks/`
- [x] **`HookBus`** funcional com emit de todos os eventos
- [x] **`HookRegistry`** com todos os hooks SDK registrados e seus schemas
- [x] **Suite de testes** `tests/unit/copilot/test_hooks_module.spec.js` — 79 testes **79/79 ✔**
- [x] **Zero regressões**: 2054/2054 testes passando
- [x] **Lint e format clean**: `npm run lint && npm run format:check`
- [x] **Typecheck clean**: `npx tsc --project tsconfig.node.json --noEmit` exit 0
- [x] **100% dos gaps (G1-G10) endereçados** — todos concluídos
- [x] **Zero referências a `.github/hooks/`** dentro de `src/copilot/hooks/` ✅
- [x] **`error-handler.js`** com circuit-breaker e estratégias configuráveis ✅ (Fase I)
- [x] **`presets/production.js`** pronto para produção com segurança completa ✅ (Fase J)
- [x] **`src/copilot/hooks/README.md`** com API, exemplos e diagrama ✅ (Fase L)

### Critérios das novas fases (N–Q)

- [ ] **Fase N**: todos os 6 hooks SDK wired em `always-alive.js` via `createHooks()` composto
- [ ] **Fase O**: `factory.js` chama `appendAuditEntry` em `onPostToolUse` com `auditLog: true`
- [ ] **Fase P**: arquivos @deprecated convertidos para re-exports (sem duplicação de código)
- [ ] **Fase Q**: rota `/api/sdk/hooks/audit` e `/api/sdk/hooks/registry` funcionando
- [ ] **Re-exports de compatibilidade** nos arquivos legados sem ciclos de dependência

---

## 9. Status de Implementação por Arquivo (Fases A–M)

| Arquivo                                    | Status   | Cobertura de testes              |
| ------------------------------------------ | -------- | -------------------------------- |
| `src/copilot/hooks/types.js`               | ✅ Criado | N/A (zero runtime)               |
| `src/copilot/hooks/factory.js`             | ✅ Criado | 11 testes                        |
| `src/copilot/hooks/permission-handler.js`  | ✅ Criado | 7 testes                         |
| `src/copilot/hooks/session-lifecycle.js`   | ✅ Criado | 3 testes                         |
| `src/copilot/hooks/composer.js`            | ✅ Criado | 5 testes                         |
| `src/copilot/hooks/bus.js`                 | ✅ Criado | 3 testes                         |
| `src/copilot/hooks/registry.js`            | ✅ Criado | 5 testes                         |
| `src/copilot/hooks/prompt-transformer.js`  | ✅ Criado | 7 testes                         |
| `src/copilot/hooks/tool-interceptor.js`    | ✅ Criado | 10 testes                        |
| `src/copilot/hooks/user-input.js`          | ✅ Criado | 4 testes                         |
| `src/copilot/hooks/index.js`               | ✅ Criado | 1 teste (barrel smoke)           |
| `src/copilot/hooks/presets/minimal.js`     | ✅ Criado | 2 testes                         |
| `src/copilot/hooks/presets/audit.js`       | ✅ Criado | 2 testes                         |
| `src/copilot/hooks/presets/safe.js`        | ✅ Criado | 3 testes                         |
| `src/copilot/hooks/presets/deny-all.js`    | ✅ Criado | 3 testes                         |
| `src/copilot/hooks/presets/interactive.js` | ✅ Criado | 3 testes                         |
| `src/copilot/hooks/error-handler.js`       | ✅ Criado | — (Fase I concluída)             |
| `src/copilot/hooks/presets/production.js`  | ✅ Criado | — (Fase J concluída)             |
| `src/copilot/hooks/audit.js`               | ✅ Criado | 16 testes (Gap 10 — ring buffer) |
| `src/copilot/hooks/README.md`              | ✅ Criado | — (Fase L concluída)             |

---

## 13. (Histórico) Fases Complementares I–L — já executadas

> Fases I, J, K (parcial) e L foram planejadas aqui e estão hoje concluídas. Fase K ainda pendente
> (veja Fase P acima).

### Fase I — `error-handler.js` com circuit-breaker (Gap 4 parcial + B.4)

**Objetivo**: Completar a implementação de `onErrorOccurred` com estratégias configuráveis e padrão
circuit-breaker para resiliência.

#### I.1 — Criar `src/copilot/hooks/error-handler.js`

```js
// API pública:
export function createErrorHandler(opts)
// opts: {
//   strategy?: 'retry' | 'skip' | 'abort' | ((ctx) => strategy),
//   maxRetries?: number,
//   recoverableContexts?: string[],   // erros contextos que podem ser retry
//   abortContexts?: string[],         // contextos que devem abort imediatamente
// }

export function createCircuitBreakerHandler(opts)
// opts: { maxRetries, resetAfterMs, onTrip?, onReset? }
// Padrão circuit-breaker: após maxRetries falhas, abre o circuito
// e retorna 'abort' por resetAfterMs ms antes de tentar novamente

export function createContextualErrorHandler(strategyMap)
// strategyMap: { [errorContext]: 'retry' | 'skip' | 'abort' }
// Ex: { rate_limit: 'retry', network_error: 'retry', permission: 'abort' }
```

#### I.2 — Integrar `error-handler.js` nos presets `safe` e `production`

O preset `safe` já tem estratégia básica. Substituir por `createContextualErrorHandler` para melhor
controle.

#### I.3 — Testes para `error-handler.js`

- Circuit-breaker: trip após N falhas, reset após tempo
- Estratégia contextual: cada contexto → decisão correta
- Fallback padrão: qualquer contexto desconhecido → 'abort'

---

### Fase J — `presets/production.js`

**Objetivo**: Preset completo para produção, combinando todos os módulos.

#### J.1 — Criar `src/copilot/hooks/presets/production.js`

```js
export function createProductionHooks(opts = {})
// opts: {
//   bus?: HookBus,
//   errorNotifier?: (error, context) => void,
//   toolAllowList?: string[],   // whitelist de tools permitidas
//   auditSink?: (entry) => void, // destino do audit log (default: core/logger)
//   piiPatterns?: RegExp[],     // padrões PII para sanitização de prompts
// }
```

Combina:

- `onPreToolUse`: allowList configurável + interceptor + bus.emit
- `onPostToolUse`: resultEnricher com `additionalContext` rico + audit
- `onUserPromptSubmitted`: sanitização PII + truncamento
- `onSessionStart`: `additionalContext` com cwd, branch, nodeVersion, hostname
- `onSessionEnd`: métricas de sessão no audit trail
- `onErrorOccurred`: circuit-breaker com notificação customizável
- `onPermissionRequest`: modo restrito (allowList) com ask para o resto

#### J.2 — Atualizar `session-initializer.js`

Integrar `createProductionHooks()` como opção padrão quando em modo produção.

---

### Fase K — Re-exports de compatibilidade (Fase G original)

**Objetivo**: Manter zero quebra de compatibilidade nos imports legados.

#### K.1 — Atualizar `src/copilot/lib/hooks.js`

```js
// Manter como re-export de compatibilidade
export * from '#copilot/hooks/factory';
```

#### K.2 — Atualizar `src/copilot/lib/permissions.js`

```js
// Re-export de compatibilidade
export * from '#copilot/hooks/permission-handler';
```

#### K.3 — Atualizar `src/copilot/agent/session-hooks.js`

```js
// Re-export de compatibilidade
export { createSessionHooks } from '#copilot/hooks/session-lifecycle';
```

#### K.4 — Aliases granulares no `package.json`

```json
"#copilot/hooks/factory": "./src/copilot/hooks/factory.js",
"#copilot/hooks/permission": "./src/copilot/hooks/permission-handler.js",
"#copilot/hooks/composer": "./src/copilot/hooks/composer.js",
"#copilot/hooks/bus": "./src/copilot/hooks/bus.js",
"#copilot/hooks/registry": "./src/copilot/hooks/registry.js",
"#copilot/hooks/session": "./src/copilot/hooks/session-lifecycle.js"
```

---

### Fase L — README e documentação do módulo hooks

**Objetivo**: API documentada e usável por qualquer contributor.

#### L.1 — Criar `src/copilot/hooks/README.md`

Conteúdo:

1. **Visão geral** — o que o módulo faz e por que existe
2. **Quick start** — exemplo mínimo funcional
3. **API Reference** — tabela de todas as exportações com links para JSDoc
4. **Presets** — quando usar cada preset
5. **Composição** — como usar `composer.js` para pipelines
6. **HookBus** — como observar eventos sem modificar handlers
7. **Exemplos avançados** — produção, auditoria, deny-all
8. **Diagrama de fluxo** (mermaid)
9. **Migração** — de `lib/hooks.js` e `lib/permissions.js` para `#copilot/hooks`

#### L.2 — Adicionar referência ao README.md principal e à ARCHITECTURE.md

---

## 10. Análise Arquitetural Profunda (2026-07-03)

> Esta seção registra a análise conduzida após a conclusão das fases A–M. Identificou o **gap
> crítico de integração** e três novos eixos de trabalho (Fases N–Q).

### 10.1 Gap Crítico: O Módulo Existe mas NÃO Está Integrado

O `src/copilot/hooks/` é um módulo isolado, bem testado e documentado — mas **nunca é realmente
usado na sessão SDK de produção**. A sessão é criada em `always-alive.js` (linha ~1015) assim:

```js
// SITUAÇÃO ATUAL — apenas 3 de 6 hooks configurados
import { createSessionHooks } from './session-hooks.js'; // arquivo @deprecated

hooks: createSessionHooks({
    getTelemetry: () => this.#telemetry,
    emitWebhook: ...,
    getModel: ...,
    scheduleFallback: ...,
    emit: ...,
}),
```

Resultado:

- `onSessionStart` / `onSessionEnd` / `onErrorOccurred`: ✅ configurados via `session-hooks.js`
  (arquivo @deprecated com impl própria)
- `onPreToolUse`: ❌ **nunca wired** — nenhuma política de allow/deny via hooks SDK
- `onPostToolUse`: ❌ **nunca wired** — ring buffer nunca recebe eventos de produção
- `onUserPromptSubmitted`: ❌ **nunca wired** — PII sanitizer nunca executado

O `createHooks()` e `createProductionHooks()` do módulo `hooks/` são **letra morta** em produção.

### 10.2 Três Sistemas de Auditoria Concorrentes

Existem 3 sistemas de auditoria que se sobrepõem:

| Sistema                        | Localização            | O que registra                  | Destino                       |
| ------------------------------ | ---------------------- | ------------------------------- | ----------------------------- |
| `channel/audit.js`             | SDK tool call tracking | start + complete com durationMs | `logs/tool-audit.jsonl`       |
| `agent/tool-audit-logger.js`   | Permission decisions   | approved/denied + highRisk      | `logs/tool-audit.jsonl`       |
| `hooks/audit.js` (ring buffer) | Hook events SDK        | onPostToolUse timing + result   | memória (sem consumidor real) |

Os dois primeiros escrevem no **mesmo arquivo JSONL**. O terceiro (ring buffer) nunca recebe dados
em produção porque `onPostToolUse` não está wired.

**Solução**: quando `onPostToolUse` for wired via `createHooks({ auditLog: true })`, o `factory.js`
deve chamar `appendAuditEntry()` para popular o ring buffer. Os dois sistemas JSONL continuam
complementares — cada um tem uma responsabilidade distinta.

### 10.3 Arquivos @deprecated com Implementação Dupla

Os três arquivos marcados como `@deprecated` ainda têm implementações COMPLETAS e independentes:

| Arquivo                              | Status Real                                      | Problema                                                         |
| ------------------------------------ | ------------------------------------------------ | ---------------------------------------------------------------- |
| `src/copilot/lib/hooks.js`           | Implementação própria de createHooks             | Duplicata de `hooks/factory.js`                                  |
| `src/copilot/lib/permissions.js`     | Implementação própria de createPermissionHandler | Duplicata de `hooks/permission-handler.js`                       |
| `src/copilot/agent/session-hooks.js` | Implementação própria de createSessionHooks      | Versão inferior (retorna `{}` em onSessionStart vs rich context) |

A Fase K (re-exports) foi planejada mas nunca executada.

### 10.4 Aviso de Dependência Circular: lib/hooks → hooks/index

Se `lib/hooks.js` for convertido para re-export de `#copilot/hooks` (= `hooks/index.js`):

```
hooks/session-lifecycle.js  →  #copilot/lib/index  →  #copilot/lib/hooks  →  #copilot/hooks  →  hooks/session-lifecycle.js
```

**CICLO!** A solução é re-exportar de módulos específicos:

- `lib/hooks.js` → re-export de `#copilot/hooks/factory` (NÃO do barrel)
- `lib/permissions.js` → re-export de `#copilot/hooks/permission-handler`
- `agent/session-hooks.js` → re-export de `#copilot/hooks/session-lifecycle`

### 10.5 HookBus: Implementado mas sem Consumidor

`HookBus` (Gap 7) foi implementado e testado — mas:

- Nenhum código de produção cria um `HookBus`
- Nenhum hook emite eventos no bus em produção
- Não existe endpoint SSE `/api/sdk/hooks/events`
- Não existe rota `/api/sdk/hooks/registry` para introspecção

### 10.6 Separação Correta: SDK Hooks vs Operacional Hooks

O `session-initializer.js` lê `.github/hooks/state/session-briefing.md` e `session.json` para
injetar contexto operacional no `systemMessage` da sessão SDK. Isso é **correto** — não é
contaminação. O ISOLAMENTO aplica-se apenas a `src/copilot/hooks/` (que está limpo), não a
`session-initializer.js` (que é o ponto de integração legítimo).

---

## 11. Fases N–Q — Integração, Convergência e Exposição

> Fases executadas após análise arquitetural aprofundada em 2026-07-03.

### Fase N — Integração plena do módulo hooks em `always-alive.js`

**Objetivo**: Wire todos os 6 hooks SDK usando o novo módulo, eliminando a dependência do arquivo
@deprecated.

#### N.1 — Alterar import em `always-alive.js`

```js
// ANTES (deprecated):
import { createSessionHooks } from './session-hooks.js';

// DEPOIS (hooks module):
import { createSessionHooks } from '#copilot/hooks/session-lifecycle';
import { createHooks } from '#copilot/hooks/factory';
```

#### N.2 — Compor hooks completos em `#initSession()`

```js
// Pre-computar hooks antes do initOrResumeSession
const lifecycleHooks = createSessionHooks({
  getTelemetry: () => this.#telemetry,
  emitWebhook: (event, payload) => this.#webhooks.emit(event, payload),
  getModel: () => this.#model,
  scheduleFallback: (model) => this.#dialogLoop.scheduleFallback(model),
  emit: (event, payload) => this.emit(event, payload),
});

const hooks = createHooks({
  auditLog: true, // activa onPostToolUse no ring buffer
  onSessionStart: lifecycleHooks.onSessionStart, // override com telemetria + webhook
  onSessionEnd: lifecycleHooks.onSessionEnd,
  onErrorOccurred: lifecycleHooks.onErrorOccurred, // override com fallback model
});
```

Resultado: todos os 6 slots configurados em produção pela primeira vez.

#### N.3 — Testes de integração

Adicionar/atualizar testes que verificam que `createHooks()` retorna todos os 6 slots e que a
composição lifecycle+factory funciona.

---

### Fase O — Ring buffer recebe eventos reais de produção

**Objetivo**: Quando `createHooks({ auditLog: true })` for configurado, o `onPostToolUse` deve
popular o ring buffer.

#### O.1 — Atualizar `factory.js` para chamar `appendAuditEntry`

No `createHooks()`, quando `auditLog: true` e nenhum `onPostToolUse` customizado for fornecido:

```js
import { appendAuditEntry } from './audit.js';

// No handler de onPostToolUse default (auditLog=true):
const postToolFn = async (input, invocation) => {
  const ts = new Date().toISOString();
  appendAuditEntry({
    toolName: input.toolName ?? 'unknown',
    sessionId: invocation?.sessionId ?? '',
    hookName: 'onPostToolUse',
    durationMs: 0, // SDK não o expõe aqui; pode ser melhorado futuramente
    ts,
  });
  log(
    'DEBUG',
    `[hooks/factory] onPostToolUse: tool='${input.toolName}' sessionId='${invocation?.sessionId}'`,
  );
};
```

#### O.2 — Verificar que `hook_get_audit_tail` reflete eventos reais

Após N.2 + O.1: `hook_get_audit_tail` deve retornar eventos reais de produção do ring buffer.

---

### Fase P — Converter arquivos @deprecated para re-exports limpos

**Objetivo**: Eliminar duplicação de código, mantendo compatibilidade retroativa com todos os
importadores existentes.

#### P.1 — `src/copilot/lib/hooks.js` → re-export de `#copilot/hooks/factory`

```js
// NOVO CONTEÚDO (substitui ~400 linhas):
export * from '#copilot/hooks/factory';
```

**Sem ciclo**: `hooks/factory.js` não importa de `lib/hooks.js` ou `lib/index.js`.

#### P.2 — `src/copilot/lib/permissions.js` → re-export de `#copilot/hooks/permission-handler`

```js
// NOVO CONTEÚDO:
export * from '#copilot/hooks/permission-handler';
```

#### P.3 — `src/copilot/agent/session-hooks.js` → re-export de `#copilot/hooks/session-lifecycle`

```js
// NOVO CONTEÚDO:
export { createSessionHooks } from '#copilot/hooks/session-lifecycle';
/** @typedef {import('#copilot/hooks/session-lifecycle').SessionLifecycleContext} SessionHooksContext */
```

Preservamos o typedef alias `SessionHooksContext` por compatibilidade retroativa.

#### P.4 — Testes de regressão

Verificar que todos os 2054+ testes continuam passando após as substituições.

---

### Fase Q — Rota `/api/sdk/hooks` para introspecção

**Objetivo**: Expor o estado do sistema de hooks via API HTTP.

#### Q.1 — Criar `src/copilot/routes/hooks.js`

Endpoints:

| Método | Rota              | Descrição                                     |
| ------ | ----------------- | --------------------------------------------- |
| `GET`  | `/hooks/audit`    | Retorna ring buffer tail (últimas N entradas) |
| `GET`  | `/hooks/registry` | Lista hooks SDK registrados com seus schemas  |

```js
import { getAuditTail } from '#copilot/hooks/audit';
import { SDK_HOOKS } from '#copilot/hooks/registry';

router.get('/hooks/audit', (req, res) => {
  const n = Math.min(Number(req.query.n) || 20, 200);
  res.json({ entries: getAuditTail(n) });
});

router.get('/hooks/registry', (req, res) => {
  res.json({ hooks: SDK_HOOKS.list() });
});
```

#### Q.2 — Registrar em `sdk-api.js`

```js
import hooksRouter from '../routes/hooks.js';
router.use('/', hooksRouter);
```

---

## 12. Status de Implementação Atualizado (2026-07-03)

| Arquivo                                    | Status     | Notas                                                   |
| ------------------------------------------ | ---------- | ------------------------------------------------------- |
| `src/copilot/hooks/types.js`               | ✅ Criado   | N/A (zero runtime)                                      |
| `src/copilot/hooks/factory.js`             | ✅ Criado   | Fase O adicionará appendAuditEntry                      |
| `src/copilot/hooks/permission-handler.js`  | ✅ Criado   | —                                                       |
| `src/copilot/hooks/session-lifecycle.js`   | ✅ Criado   | Superset de agent/session-hooks.js                      |
| `src/copilot/hooks/composer.js`            | ✅ Criado   | —                                                       |
| `src/copilot/hooks/bus.js`                 | ✅ Criado   | Sem consumidor em produção ainda (post-Q)               |
| `src/copilot/hooks/registry.js`            | ✅ Criado   | Exposto via rota na Fase Q                              |
| `src/copilot/hooks/prompt-transformer.js`  | ✅ Criado   | Wired via createHooks na Fase N                         |
| `src/copilot/hooks/tool-interceptor.js`    | ✅ Criado   | Disponível para uso via createHooks                     |
| `src/copilot/hooks/user-input.js`          | ✅ Criado   | —                                                       |
| `src/copilot/hooks/error-handler.js`       | ✅ Criado   | (Fase I concluída)                                      |
| `src/copilot/hooks/audit.js`               | ✅ Criado   | Ring buffer; Fase O adiciona consumidor real            |
| `src/copilot/hooks/index.js`               | ✅ Criado   | Barrel completo                                         |
| `src/copilot/hooks/README.md`              | ✅ Criado   | (Fase L concluída)                                      |
| `src/copilot/hooks/presets/minimal.js`     | ✅ Criado   | —                                                       |
| `src/copilot/hooks/presets/audit.js`       | ✅ Criado   | —                                                       |
| `src/copilot/hooks/presets/safe.js`        | ✅ Criado   | —                                                       |
| `src/copilot/hooks/presets/deny-all.js`    | ✅ Criado   | —                                                       |
| `src/copilot/hooks/presets/interactive.js` | ✅ Criado   | —                                                       |
| `src/copilot/hooks/presets/production.js`  | ✅ Criado   | (Fase J concluída)                                      |
| `src/copilot/agent/always-alive.js`        | ⏳ Fase N   | Wiring todos os 6 slots com novo módulo hooks           |
| `src/copilot/lib/hooks.js`                 | ⏳ Fase P.1 | Converter @deprecated → re-export de hooks/factory      |
| `src/copilot/lib/permissions.js`           | ⏳ Fase P.2 | Converter @deprecated → re-export de hooks/perm-handler |
| `src/copilot/agent/session-hooks.js`       | ⏳ Fase P.3 | Converter @deprecated → re-export de hooks/session      |
| `src/copilot/routes/hooks.js`              | ⏳ Fase Q.1 | NOVO — rota /api/sdk/hooks/audit + /registry            |

---

## 9. Referências

- SDK README: `node_modules/@github/copilot-sdk/README.md`
- SDK Tipos: `node_modules/@github/copilot-sdk/dist/cjs/types.js`
- SDK Session: `node_modules/@github/copilot-sdk/dist/cjs/session.js`
- Implementação: `src/copilot/hooks/` (módulo canônico)
- Ponto de integração: `src/copilot/agent/always-alive.js` → `session-initializer.js`
- Hook tools: `src/copilot/tools/hook-tools.js`
