# `src/copilot/hooks/` — Sistema de Hooks do SDK

Módulo isolado e modular para orquestrar todos os **hooks do `@github/copilot-sdk`** de forma
composível, testável e sem acoplamento com outras partes do workspace.

---

## Instalação / Importação

```js
// API pública completa
import { createHooks, createPermissionHandler, createHookBus } from '#copilot/hooks';

// Módulos específicos (aliases granulares)
import { createHooks } from '#copilot/hooks/factory';
import { createPermissionHandler } from '#copilot/hooks/permission';
import { createSessionHooks } from '#copilot/hooks/session';
import { pipeline, fallback } from '#copilot/hooks/composer';
import { createHookBus } from '#copilot/hooks/bus';
import { SDK_HOOKS } from '#copilot/hooks/registry';
import { createErrorHandler, createCircuitBreakerHandler } from '#copilot/hooks/error';
```

---

## Quick Start — mínimo funcional

```js
import { createHooks, createPermissionHandler } from '#copilot/hooks';
import { CopilotClient } from '@github/copilot-sdk';

const client = new CopilotClient({ token: process.env.GITHUB_TOKEN });

const session = await client.createSession({
  hooks: createHooks({ auditLog: true }),
  onPermissionRequest: createPermissionHandler({ allowAll: true }),
});
```

---

## API Reference

### `factory.js` — Factories de hooks

| Export                                   | Descrição                         |
| ---------------------------------------- | --------------------------------- |
| `createHooks(cfg?)`                      | Cria todos os 6 hooks do SDK      |
| `createMinimalHooks()`                   | Passa tudo sem logging            |
| `createAuditHooks()`                     | Logging completo, sem bloquear    |
| `createDenyAllHooks()`                   | Nega todas as tools               |
| `createSafeHooks(extraAllowed?)`         | Leitura livre, writes/shell = ask |
| `composePreToolUseHandlers(...handlers)` | Chain de handlers pre-tool        |
| `createErrorNotifierHook(onError)`       | Notifica callback em erros        |

**Config de `createHooks(cfg)`:**

```ts
{
    auditLog?: boolean;            // loga pre/post tool e session events
    debugTools?: boolean;          // loga args e decisões de permissão
    allowTools?: string[];         // whitelist (vazio = allow all)
    denyTools?: string[];          // blacklist
    denyPatterns?: RegExp[];       // regex sobre toolName
    onPermissionAsk?: (request) => Promise<boolean | 'deny'>;
    onPreToolUse?: PreToolUseHandler;
    onPostToolUse?: PostToolUseHandler;
    onUserPromptSubmitted?: UserPromptSubmittedHandler;
    onSessionStart?: SessionStartHandler;
    onSessionEnd?: SessionEndHandler;
    onErrorOccurred?: ErrorOccurredHandler;
}
```

---

### `permission-handler.js` — onPermissionRequest

| Export                                       | Descrição                          |
| -------------------------------------------- | ---------------------------------- |
| `createPermissionHandler(cfg?)`              | Cria handler configurável          |
| `createApproveAllPermission()`               | Aprova absolutamente tudo          |
| `createAuditOnlyPermission()`                | Aprova e loga cada decisão         |
| `createRestrictedPermission(allowedTools)`   | Só tools específicas são aprovadas |
| `createSafePermission(additionalDenyTools?)` | Nega shell/write por padrão        |

**Config de `createPermissionHandler(cfg)`:**

```ts
{
    allowAll?: boolean;                                            // permite tudo
    allowTools?: string[];                                         // whitelist
    denyTools?: string[];                                          // blacklist
    denyPatterns?: RegExp[];                                       // regex
    auditMode?: boolean;                                           // loga sem alterar
    onRequest?: (request) => Promise<boolean | 'deny' | undefined>;
}
```

---

### `prompt-transformer.js` — onUserPromptSubmitted com modifiedPrompt (Gap 1)

| Export                                   | Descrição                                        |
| ---------------------------------------- | ------------------------------------------------ |
| `createPromptTransformer(opts?)`         | Handler com pipeline de transformação de prompts |
| `createSensitiveDataRedactor(patterns?)` | Redacta tokens Bearer, api-keys, secrets         |
| `createContextInjector(ctx)`             | Injeta prefix/suffix fixo ao prompt              |
| `createLoggingPromptHook()`              | Loga prompts sem modificar                       |

**`modifiedPrompt`** é retornado quando o prompt sofreu transformação, instrução o SDK a usar o
valor transformado.

---

### `tool-interceptor.js` — modifiedArgs (Gap 2) + additionalContext (Gap 3)

| Export                               | Descrição                                           |
| ------------------------------------ | --------------------------------------------------- |
| `createToolInterceptor(opts?)`       | Interceptor configurável de pre/post tool           |
| `createArgSanitizerHook(rules?)`     | Modifica args (defaults, overrides, strip, redação) |
| `createBlocklistHook(tools)`         | Nega tools específicas                              |
| `createAllowlistHook(tools)`         | Nega qualquer tool fora da lista                    |
| `createResultLoggerHook(opts?)`      | Loga resultados de tools                            |
| `createResultEnricherHook(enrichFn)` | Retorna additionalContext enriquecido               |

---

### `session-lifecycle.js` — onSessionStart / onSessionEnd / onErrorOccurred

| Export                           | Descrição                                      |
| -------------------------------- | ---------------------------------------------- |
| `createSessionHooks(ctx)`        | Conjunto completo de hooks de ciclo de vida    |
| `createSessionStartHook(opts?)`  | Hook de início de sessão com additionalContext |
| `createSessionEndHook(opts?)`    | Hook de encerramento com log e telemetria      |
| `createErrorOccurredHook(opts?)` | Hook de erro com retry/skip/abort configurável |

**Contexto de `createSessionHooks(ctx)`:**

```ts
{
    getTelemetry: () => TelemetryStore;
    emitWebhook: (event: string, payload: object) => Promise<void>;
    getModel: () => string;
    scheduleFallback: () => void;
    emit: (event: string, ...args: unknown[]) => void;
}
```

---

### `error-handler.js` — Circuit Breaker e estratégias

| Export                                        | Descrição                                        |
| --------------------------------------------- | ------------------------------------------------ |
| `createErrorHandler(opts?)`                   | Estratégia fixa ou função de decisão             |
| `createCircuitBreakerHandler(opts?)`          | Padrão circuit-breaker (trip + reset automático) |
| `createContextualErrorHandler(map, default?)` | Mapa de `errorContext` → estratégia              |

**Circuit Breaker:**

- Começa fechado (normal)
- Após N falhas consecutivas para o mesmo `errorContext` → **abre** (abort)
- Após `resetAfterMs` ms → **fecha** automaticamente
- `onTrip` / `onReset` para notificações externas

---

### `user-input.js` — onUserInputRequest (Gap 5)

| Export                                    | Descrição                               |
| ----------------------------------------- | --------------------------------------- |
| `createUserInputHandler(cfg?)`            | Handler com resolver, timeout, fallback |
| `createStaticInputHandler(staticMap)`     | Respostas estáticas por substring       |
| `createQueuedInputHandler()`              | Fila com `answerNext()` para testes     |
| `createInteractiveInputHandler(promptFn)` | Delega para função interativa externa   |

---

### `bus.js` — HookBus (Gap 6)

| Export                  | Descrição                                      |
| ----------------------- | ---------------------------------------------- |
| `createHookBus()`       | Event emitter por hookName + wildcard `*`      |
| `attachBus(hooks, bus)` | Observa hooks existentes via bus sem modificar |

**Eventos emitidos:** `pre_tool_use`, `post_tool_use`, `user_prompt_submitted`, `session_start`,
`session_end`, `error_occurred`

---

### `registry.js` — HookRegistry (Gap 8)

| Export                 | Descrição                                     |
| ---------------------- | --------------------------------------------- |
| `SDK_HOOKS`            | Registry pré-populado com 8 hooks do SDK      |
| `createHookRegistry()` | Registry vazio para custom hooks              |
| `getDefaultRegistry()` | Acesso ao SDK_HOOKS singleton                 |
| `getHookSchema(name)`  | Schema (inputFields, outputFields) de um hook |
| `listHookNames()`      | Lista todos os hooks registrados              |

---

### `composer.js` — Composição de pipelines

| Export                              | Descrição                                          |
| ----------------------------------- | -------------------------------------------------- |
| `composeHandlers(...handlers)`      | Chain: retorna no primeiro resultado com decisão   |
| `pipeline(...handlers)`             | Pipeline: executa todos e faz merge dos resultados |
| `fallback(primary, fallbackFn)`     | Usa fallback se o primário lança                   |
| `raceWithTimeout(handler, ms)`      | Abandona handler se demorar mais que ms            |
| `conditional(pred, handler, else?)` | Executa apenas se predicado verdadeiro             |
| `chainHooks(hooks1, hooks2)`        | Combina dois objetos SessionHooks                  |
| `withFallback(primary, fallback)`   | Combina hooks com fallback por slot                |
| `withTimeout(handler, ms)`          | Wraps single handler com timeout                   |

---

## Presets

| Preset                          | Quando usar                                                        |
| ------------------------------- | ------------------------------------------------------------------ |
| `createMinimalPreset()`         | Desenvolvimento — sem logging, sem bloqueio                        |
| `createAuditPreset()`           | Auditoria completa — loga tudo, não bloqueia nada; audit trail     |
| `createSafePreset(opts)`        | Padrão recomendado — leitura livre, writes/shell pedem confirmação |
| `createDenyAllPreset()`         | Modo somente-leitura — todas as tools negadas                      |
| `createInteractivePreset(opts)` | Todas as tools pedem confirmação interativa                        |
| `createProductionHooks(opts)`   | Produção — circuit-breaker, PII scrub, allowList, auditoria        |

---

## Exemplos Avançados

### Pipeline com auditoria e timeout

```js
import { createHooks } from '#copilot/hooks/factory';
import { pipeline, raceWithTimeout } from '#copilot/hooks/composer';
import { createPromptTransformer } from '#copilot/hooks/prompt-transformer';
import { createCircuitBreakerHandler } from '#copilot/hooks/error';

const hooks = createHooks({
  auditLog: true,
  onUserPromptSubmitted: pipeline(
    createPromptTransformer({ maxLength: 10000 }),
    raceWithTimeout(createPromptTransformer({ prefix: '[prod] ' }), 500),
  ),
  onErrorOccurred: createCircuitBreakerHandler({ maxRetries: 3, resetAfterMs: 60_000 }),
});
```

### Observar eventos sem modificar handlers

```js
import { createHooks } from '#copilot/hooks/factory';
import { createHookBus, attachBus } from '#copilot/hooks/bus';

const bus = createHookBus();
bus.on('*', (event) => console.log('[audit]', event.hookName, event.sessionId));

const baseHooks = createHooks({ auditLog: true });
const hooks = attachBus(baseHooks, bus); // transparente: retornos inalterados
```

### Preset de produção completo

```js
import { createProductionHooks } from '#copilot/hooks/presets/production';

const { hooks, onPermissionRequest } = createProductionHooks({
  toolAllowList: ['read_file', 'list_dir', 'grep_search', 'web_search'],
  toolDenyList: ['run_in_terminal', 'delete_file'],
  errorNotifier: (err, ctx) => myMonitoring.capture(err, { context: ctx }),
  circuitBreakerMaxRetries: 5,
  circuitBreakerResetMs: 120_000,
});

const session = await client.createSession({ hooks, onPermissionRequest });
```

---

## Diagrama de Fluxo

```
createSession(config)
      │
      ├─ hooks ─────────── src/copilot/hooks/factory.js
      │   ├─ onPreToolUse ────── composer.pipeline(
      │   │                          argSanitizerHook,
      │   │                          blocklistHook,
      │   │                          bus.emit('pre_tool_use')
      │   │                      )
      │   ├─ onPostToolUse ───── resultEnricherHook → additionalContext
      │   ├─ onUserPromptSubmitted ── promptTransformer → modifiedPrompt
      │   ├─ onSessionStart ──── sessionStartHook → additionalContext rico
      │   ├─ onSessionEnd ─────── sessionEndHook → telemetria
      │   └─ onErrorOccurred ─── circuitBreakerHandler → retry/skip/abort
      │
      ├─ onPermissionRequest ── src/copilot/hooks/permission-handler.js
      └─ onUserInputRequest ─── src/copilot/hooks/user-input.js
```

---

## Migração de `lib/hooks.js` → `#copilot/hooks`

```diff
- import { createHooks } from '#copilot/lib/hooks';
+ import { createHooks } from '#copilot/hooks';

- import { createPermissionHandler } from '#copilot/lib/permissions';
+ import { createPermissionHandler } from '#copilot/hooks';

- import { createSessionHooks } from '../agent/session-hooks.js';
+ import { createSessionHooks } from '#copilot/hooks/session';
```

> Os arquivos legados `lib/hooks.js`, `lib/permissions.js` e `agent/session-hooks.js` mantêm
> funcionamento idêntico mas estão marcados como `@deprecated`. Serão removidos na Fase K do roadmap
> após migração de todos os importadores.

---

## Estrutura de Arquivos

```
src/copilot/hooks/
├── index.js                 # Barrel: API pública completa
├── types.js                 # Typedefs JSDoc centralizados (zero runtime)
├── factory.js               # createHooks() e presets básicos
├── permission-handler.js    # createPermissionHandler()
├── session-lifecycle.js     # createSessionHooks() onSessionStart/End/Error
├── composer.js              # pipeline(), fallback(), conditional() etc.
├── bus.js                   # createHookBus() — event emitter desacoplado
├── registry.js              # SDK_HOOKS registry + validação de schemas
├── prompt-transformer.js    # onUserPromptSubmitted com modifiedPrompt
├── tool-interceptor.js      # onPreToolUse (modifiedArgs) + onPostToolUse
├── user-input.js            # onUserInputRequest handlers
├── error-handler.js         # createErrorHandler() + createCircuitBreakerHandler()
└── presets/
    ├── minimal.js           # createMinimalPreset()
    ├── audit.js             # createAuditPreset()
    ├── safe.js              # createSafePreset()
    ├── deny-all.js          # createDenyAllPreset()
    ├── interactive.js       # createInteractivePreset()
    └── production.js        # createProductionHooks()
```
