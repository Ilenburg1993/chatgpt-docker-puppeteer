# Sistema de Hooks — Análise Profunda e Roadmap de Implementação

**Status**: Proposta ativa  
**Data**: 2026-06-27  
**Escopo**: `src/copilot/hooks/` (novo módulo unificado)

---

## 1. Visão Geral e Motivação

### 1.1 Situação atual (diagnóstico)

O sistema de hooks do `src/copilot` está **fragmentado** em múltiplos locais sem uma pasta dedicada:

| Arquivo atual | Responsabilidade | Problema |
|---|---|---|
| `src/copilot/lib/hooks.js` | Factory `createHooks()` para os 6 slots SDK | ✅ Bem estruturado, mas isolado |
| `src/copilot/lib/permissions.js` | `PermissionHandler` / `onPermissionRequest` | ⚠️ Conceitualmente é um hook, está em lib/ |
| `src/copilot/agent/session-hooks.js` | `onSessionStart`, `onSessionEnd`, `onErrorOccurred` para AlwaysAliveAgent | ⚠️ Hooks de ciclo de vida do agente misturados com agent/ |
| `src/copilot/tools/hook-tools.js` | Custom Tools `hook_get_audit_tail`, `request_user_input` | ⚠️ "Hook tools" mas está em tools/ |
| `src/copilot/agent/session-initializer.js` | Passa `hooks` para `createSession()`/`resumeSession()` | ⚠️ Hooks criados inline sem factory explícita |
| `src/copilot/lib/session.js` | `buildSessionConfig()` monta hooks na config de sessão | ⚠️ Lógica de composição de hooks inline |
| `src/copilot/agent/tool-audit-logger.js` | Log de auditoria de tools | ⚠️ Relacionado a `onPostToolUse`, mas separado |

**Contaminação**: `session-initializer.js` referencia `BRIEFING_FILE` e `SESSION_JSON_FILE` de `.github/hooks/state/` — misturando os hooks operacionais (`.github/hooks/`) com os hooks do SDK (`@github/copilot-sdk`). São sistemas completamente distintos.

### 1.2 O que o SDK suporta (API oficial `@github/copilot-sdk`)

#### Hooks da sessão (`SessionHooks` — via `createSession({ hooks })`)

| Hook | Input | Output | Funcionalidade |
|---|---|---|---|
| `onPreToolUse` | `{ toolName, toolArgs, timestamp, cwd }` | `{ permissionDecision: 'allow'\|'deny'\|'ask', modifiedArgs?, additionalContext? }` | Intercepta tool antes de executar; pode modificar args |
| `onPostToolUse` | `{ toolName, toolArgs, toolResult, timestamp, cwd }` | `{ additionalContext? }` | Processa resultado após execução |
| `onUserPromptSubmitted` | `{ prompt, timestamp, cwd }` | `{ modifiedPrompt? }` | Intercepta prompt do usuário; pode modificar |
| `onSessionStart` | `{ source: 'startup'\|'resume'\|'new', initialPrompt?, timestamp, cwd }` | `{ additionalContext? }` | Executado ao iniciar/retomar sessão |
| `onSessionEnd` | `{ reason, finalMessage?, error?, timestamp, cwd }` | `void` | Limpeza ao encerrar sessão |
| `onErrorOccurred` | `{ error, errorContext, recoverable, timestamp, cwd }` | `{ errorHandling: 'retry'\|'skip'\|'abort', retryCount? }` | Controle de recuperação de erros |

#### Handler de permissão (`onPermissionRequest` — via `createSession({ onPermissionRequest })`)

Tecnicamente **não é um hook** (é parâmetro obrigatório separado), mas conceitualmente faz parte do mesmo sistema de controle de execução.

| Kind | Descrição |
|---|---|
| `shell` | Executar comando shell |
| `write` | Escrever/editar arquivo |
| `read` | Ler arquivo |
| `mcp` | Chamar tool MCP |
| `custom-tool` | Chamar tool registrada pelo usuário |
| `url` | Fetch de URL |
| `memory` | Memória persistente de sessão |
| `hook` | Invocar hook ou integração server-side |

#### Handler de input interativo (`onUserInputRequest` — via `createSession({ onUserInputRequest })`)

Habilita a tool nativa `ask_user` do CLI.

| Input | Output |
|---|---|
| `{ question, choices?, allowFreeform? }` | `{ answer, wasFreeform }` |

### 1.3 Gaps identificados

**Gap 1 — `onUserPromptSubmitted.modifiedPrompt` não utilizado**  
O SDK suporta modificar o prompt antes de ser processado via `modifiedPrompt`, mas o retorno atual do handler (`onUserPromptSubmitted` em `hooks.js`) apenas loga e não retorna `modifiedPrompt`. Não há nenhuma funcionalidade de transformação de prompt implementada.

**Gap 2 — `onPreToolUse.modifiedArgs` não utilizado**  
O SDK suporta modificar argumentos de tools via `modifiedArgs` no retorno de `onPreToolUse`, mas nenhum handler do projeto usa isso.

**Gap 3 — `onPostToolUse` sem retorno de `additionalContext`**  
O handler de `onPostToolUse` em `auditLog` mode apenas loga, mas não injeta `additionalContext` de volta ao modelo.

**Gap 4 — `onSessionStart.additionalContext` não utilizado**  
`onSessionStart` pode retornar `additionalContext` para enriquecer o contexto do modelo. Os handlers atuais retornam `{}` vazio.

**Gap 5 — `onUserInputRequest` não configurável via factory**  
`onUserInputRequest` é passado diretamente sem passar pela factory `createHooks()`.

**Gap 6 — Ausência de hook pipeline/middleware**  
Não existe composição de múltiplos handlers em pipeline exceto `composePreToolUseHandlers()`.

**Gap 7 — Sem sistema de eventos de hooks (hook bus)**  
Não há bus de eventos para hooks — impossível adicionar observadores sem modificar o handler.

**Gap 8 — Sem hook registry tipado**  
Não há registro centralizado de hooks disponíveis com seus contratos (input/output types).

**Gap 9 — `onPermissionRequest` e `onUserInputRequest` fora da factory**  
Esses dois handlers são passados sem passar pelo sistema de hooks — desacoplamento incompleto.

**Gap 10 — Tool `hook_get_audit_tail` lê `.github/hooks/state/audit.jsonl`**  
Isso mistura logs do hook system operacional (`.github/`) com o feedback do SDK.

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

- Mover `createHooks()`, `createMinimalHooks()`, `createAuditHooks()`, `createDenyAllHooks()`, `createSafeHooks()`
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
export { createHooks, createMinimalHooks, createAuditHooks, createSafeHooks, createDenyAllHooks } from './factory.js';
export { createPermissionHandler, approveAllHandler, denyAllHandler } from './permission-handler.js';
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

Adicionar endpoint `/api/sdk/hooks/events` (Server-Sent Events) que emite eventos do `HookBus` em tempo real para o frontend.

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

Atualmente `tool-audit-logger.js` tem lógica separada. Migrar para `onPostToolUse` dentro do `HookBus`:

```js
// hooks/audit.js
export function createAuditPostToolHandler(auditLogger)
// retorna onPostToolUse que delega ao auditLogger existente
```

#### H.2 — Webhook via `HookBus`

Emitir eventos de webhook (`session.start`, `session.end`, etc.) via listeners no `HookBus` em vez de chamadas diretas em `session-lifecycle.js`.

#### H.3 — Documentar API pública do módulo hooks

Gerar `src/copilot/hooks/README.md` com:
- API completa com exemplos
- Diagrama de fluxo de hooks
- Tabela de compatibilidade SDK

---

## 4. Tabela de Rastreamento de Gaps

| Gap | Descrição | Fase | Arquivo alvo |
|---|---|---|---|
| G1 | `onUserPromptSubmitted.modifiedPrompt` não utilizado | B.1 | `prompt-transformer.js` |
| G2 | `onPreToolUse.modifiedArgs` não utilizado | B.2 | `tool-interceptor.js` |
| G3 | `onPostToolUse.additionalContext` não retornado | B.2 | `tool-interceptor.js` |
| G4 | `onSessionStart.additionalContext` vazio | B.5 | `session-lifecycle.js` |
| G5 | `onUserInputRequest` fora da factory | B.3 | `user-input-handler.js` |
| G6 | Sem composição para todos os hooks | E.1 | `composer.js` |
| G7 | Sem HookBus/observadores | C.1 | `bus.js` |
| G8 | Sem registry tipado | D.1 | `registry.js` |
| G9 | `onPermissionRequest` fora do módulo hooks | A.3 | `permission-handler.js` |
| G10 | `hook_get_audit_tail` usa `.github/hooks/` | H.1 | `audit.js` |

---

## 5. Isolamento: SDK Hooks vs. `.github/hooks/`

**Problema**: `session-initializer.js` contém referências a `.github/hooks/state/session-briefing.md` e `session.json` — misturando os hooks operacionais do Copilot Agent com os hooks do SDK.

**Tipos distintos:**

| Tipo | Localização | Propósito |
|---|---|---|
| **SDK Hooks** | `@github/copilot-sdk` → `createSession({ hooks })` | Controle de execução de tools e ciclo de vida da sessão SDK |
| **Operacional Hooks** | `.github/hooks/` | Controle de compliance do agente GitHub Copilot (VS Code) |

**Regra**: `src/copilot/hooks/` **NUNCA** deve importar de `.github/hooks/` ou qualquer path relativo a `.github/`. Se precisar de dados do estado operacional, recebe via injeção de dependência.

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

> Os aliases `#copilot/lib/hooks` e `#copilot/lib/permissions` serão mantidos como re-exports de compatibilidade até a Fase G.

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

Ao final da Fase G, o sistema de hooks deve satisfazer:

- [ ] **100% dos gaps (G1-G10) endereçados** com implementação real ou stub documentado
- [ ] **Zero referências a `.github/hooks/`** dentro de `src/copilot/hooks/`
- [ ] **Todos os 6 hooks SDK** implementados com suporte a retornos completos (modifiedArgs, modifiedPrompt, additionalContext)
- [ ] **`onPermissionRequest` e `onUserInputRequest`** gerenciados pelo módulo `hooks/`
- [ ] **`HookBus`** funcional com emit de todos os eventos
- [ ] **`HookRegistry`** com todos os hooks SDK registrados e seus schemas
- [ ] **Suite de testes** `tests/unit/copilot/hooks/` com cobertura ≥ 80%
- [ ] **Zero quebra de compatibilidade**: `1962/1962` testes passando
- [ ] **Lint e format clean**: `npm run lint && npm run format:check`

---

## 9. Referências

- SDK README: `node_modules/@github/copilot-sdk/README.md`
- SDK Tipos: `node_modules/@github/copilot-sdk/dist/cjs/types.js`
- SDK Session: `node_modules/@github/copilot-sdk/dist/cjs/session.js`
- Implementação atual: `src/copilot/lib/hooks.js`
- Permissões: `src/copilot/lib/permissions.js`
- Session lifecycle: `src/copilot/agent/session-hooks.js`
- Hook tools: `src/copilot/tools/hook-tools.js`
