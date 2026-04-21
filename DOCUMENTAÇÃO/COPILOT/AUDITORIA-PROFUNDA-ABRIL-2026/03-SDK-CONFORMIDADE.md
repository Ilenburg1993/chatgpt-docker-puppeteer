# 03-SDK-CONFORMIDADE — Auditoria de Conformidade com `@github/copilot-sdk`

**Auditoria Profunda de `src/copilot`** · Abril 2026 **Foco**: Conformidade arquitetural e de
contrato com `@github/copilot-sdk` v0.2.1 **Documentado em**: 2026-04-18

---

## 1. Versão do SDK em Uso

```json
// package.json
"@github/copilot-sdk": "^0.2.1"
```

### Contrato do SDK (v0.2.1 — mapeado por memória de repositório)

| Contrato                 | Detalhes                                                                                                                 |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| `CopilotClient`          | Instância conectada via `client.start()`                                                                                 |
| `client.stop()`          | Retorna `Promise<Error[]>` — array de erros, não lança                                                                   |
| `CopilotSession`         | Criada/retomada via `client.createSession()` / `client.resumeSession()`                                                  |
| `session.sendTurn(turn)` | Envia turno ao modelo                                                                                                    |
| Hook `onErrorOccurred`   | Recebe `{error: string, errorContext: string, recoverable: boolean}`, espera `{errorHandling: 'retry'\|'skip'\|'abort'}` |
| Erros do SDK             | **Não exporta classes tipadas** — todos são `Error` genérico com string message                                          |

---

## 2. Análise do Barrel `#copilot/sdk`

O projeto encapsula o SDK em `src/copilot/sdk/` com re-exportações via barrel `#copilot/sdk`.

### Arquivos de Re-export do Barrel

```
sdk/index.js (barrel)
  └── sdk/session/client.js    → re-export CopilotClient, getClient, stopClient, forceStopClient
  └── sdk/session/lifecycle.js → createSession, resumeSession, waitForEvent
  └── sdk/tools/               → buildCustomTools, ToolRegistry
  └── sdk/models/              → listModels, getDefaultModel
  └── sdk/rpc.js               → RPC utilities
```

### Status de Conformidade do Barrel

**POSITIVO**: `sdk/session/client.js` wraps `CopilotClient` com:

- Circuit breaker (`sdkConnectionCircuitBreaker`)
- `getClient()` singleton com C13-01 anti-retry-storm
- `stopClient()` que corretamente lida com `Promise<Error[]>` retornado por `client.stop()`
- Registry de sessões ativas externalizado para `infra/sdk-session-registry.js`

**POSITIVO**: `forceStopClient()` usa duck-typing para `forceStop` via `anyClient.forceStop?.()` —
graceful fallback se SDK não expor o método.

---

## 3. Violations de Import Direto (ARCH violation — CAT-001 do catálogo anterior)

> **Re-triagem em 2026-04-17:** não foi encontrado import runtime direto de `@github/copilot-sdk`
> fora da própria camada `src/copilot/sdk/`. Os matches fora de `sdk/` são referências em
> JSDoc/comentários e documentação, não violações de runtime.

Importações diretas de `@github/copilot-sdk` fora do barrel `#copilot/sdk`:

### Arquivos Legítimos (dentro de `sdk/` — aceitável)

```
sdk/session/client.js       → importa CopilotClient para re-export
sdk/session/client-events.js
sdk/session/client-facade.js
sdk/session/permissions.js
sdk/session/lifecycle.js
sdk/tools/registry.js, core.js, custom.js
sdk/models/helpers.js
sdk/rpc.js, sdk/config.js, sdk/constants.js
sdk/agent/agents.js
```

### Arquivos FORA de `sdk/` com ocorrência textual — JSDoc/comentários

```
tools/session-rpc-tools.js       → menções em comentários/JSDoc
tools/experimental-rpc-tools.js  → typedefs JSDoc
tools/introspection-tools.js     → referência a package.json do SDK
tools/tool-factory.js            → comentário explicativo
hooks/registry.js                → texto documental
agent/lifecycle/session-setup.js → typedefs JSDoc
agent/lifecycle/reconnect-policy.js → typedefs JSDoc
agent/types.js                   → typedefs JSDoc
```

| ID                        | Sev | Descrição                                                                                                                                                                   |
| ------------------------- | --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **CAT-001 / ARCH-SDK-01** | P3  | Reclassificado: não há import runtime direto fora de `sdk/`; o backlog restante é migrar referências JSDoc/comentários para typedefs/barrels internos quando fizer sentido. |

---

## 4. Conformidade do Hook `onErrorOccurred`

### Contrato Esperado pelo SDK

```typescript
// Input
{
  error: string;          // mensagem de erro (string, não Error object)
  errorContext: string;   // contexto onde ocorreu
  recoverable: boolean;   // sugestão do SDK
}
// Output esperado
{
  errorHandling: 'retry' | 'skip' | 'abort';
  retryCount?: number;    // opcional
}
```

### Implementação em `hooks/error-handler.js`

**CONFORME**:

- `createErrorHandler()` → retorna `{ errorHandling: decided }` ou
  `{ errorHandling: 'retry', retryCount: n }`
- `createCircuitBreakerHandler()` → retorna os mesmos formatos
- `fatalPatterns` / `transientPatterns` para classificar erros por string matching (necessário pois
  SDK não exporta classes de erro tipadas)

**CONFORME**: `createContextualErrorHandler()` — mapa de contexto → estratégia com fallback.

**ACHADO**:

| ID              | Sev | Descrição                                                                                                                                                                                                                                                                                                                                                                             |
| --------------- | --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **GAP-HOOK-01** | P3  | `createErrorHandler` e `createCircuitBreakerHandler` usam `retryCounts` / `circuits` em closure — state compartilhado por **todas as sessões** se o mesmo handler for reutilizado entre sessões. Se um handler factory for instanciado uma vez e passado para múltiplas sessões (possível via `buildSessionHooks`), os contadores de retry/circuit-breaker se acumulam cross-session. |

---

## 5. Conformidade do Hook `onToolCall`

### Contrato Esperado

```typescript
{
  tool: string;
  input: Record<string, unknown>;
}
// Output:
{
  approved: boolean;
  modifiedInput?: Record<string, unknown>;
}
```

### Análise

Auditado indiretamente via `agent/lifecycle/session-setup.js` e `sdk/session/permissions.js`:

- `buildSessionHooks()` em `session-setup.js` compila hooks usando `PermissionManager`
- `PermissionManager` (`sdk/session/permissions.js`) implementa as políticas `approve_all`,
  `audit_only`, `selective`

**CONFORME**: retorna `{ approved: boolean }` corretamente.

| ID              | Sev | Descrição                                                                                                                                                 |
| --------------- | --- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **GAP-HOOK-02** | P3  | `modifiedInput` (input modification) não é utilizado por nenhum hook de permissão — feature do SDK não aproveitada. Não é bug, mas gap de funcionalidade. |

---

## 6. Conformidade do `client.stop()` → `Promise<Error[]>`

### Implementação em `stopClient()`

```js
const errors = await _client.stop();
if (errors.length > 0) {
  log('WARN', `[lib/sdk-client] Erros ao parar: ${errors.map((e) => e.message).join(', ')}`);
}
_client = null;
return errors;
```

**CONFORME**: Trata corretamente o retorno `Error[]` em vez de assumir void.

**POSITIVO**: Erros são logados mas não relançados — chamador pode inspecionar o retorno de
`stopClient()`.

---

## 7. Conformidade de `waitForEvent()`

### Função `waitForEvent` no barrel

Wrapper de SDK exportado via `sdk/session/lifecycle.js`:

```js
export { waitForEvent } from '@github/copilot-sdk';
```

Re-exportado diretamente — sem wrapper adicional.

**RISCO**:

| ID             | Sev | Descrição                                                                                                                                                                                                                      |
| -------------- | --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **GAP-SDK-01** | P3  | `waitForEvent` do SDK é re-exportado puro (sem wrapper). Se o SDK mudar a assinatura desta função em versão futura, todos os 12+ usos no projeto precisarão ser atualizados. Um wrapper local adicionaria indireção de versão. |

---

## 8. Mapeamento de Hierarquia de Erros

O projeto define hierarquia própria para complementar o SDK:

```
CopilotError (base)
├── SessionError     → erros de lifecycle de sessão
├── BridgeError      → erros de comunicação entre componentes
├── ConfigError      → erros de configuração
├── ToolError        → erros em execução de tools
├── TimeoutError     → timeouts específicos do copilot
├── ValidationError  → erros de validação de input
├── StateTransitionError → transições de estado inválidas
└── CircuitOpenError → circuit breaker aberto
```

**POSITIVO**: Hierarquia clara e bem definida em `core/errors.js` — permite handling tipado mesmo
sem suporte do SDK.

**ACHADO**:

| ID             | Sev | Descrição                                                                                                                                                                                          |
| -------------- | --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **GAP-SDK-02** | P3  | `BridgeError` e `StateTransitionError` são raramente propagados — muitos catch blocks no agent catcham `Error` genérico e relançam como `SessionError`. Perde-se a especificidade de tipo de erro. |

---

## 9. Resumo de Conformidade

| Área                             | Status        | Detalhes                                                |
| -------------------------------- | ------------- | ------------------------------------------------------- |
| `CopilotClient` wrapping         | ✅ CONFORME   | Circuit breaker, singleton, C13-01                      |
| `client.stop()` → `Error[]`      | ✅ CONFORME   | Tratamento correto do array de erros                    |
| `onErrorOccurred` hook           | ✅ CONFORME   | Retorno `{errorHandling}` correto                       |
| `onToolCall` hook                | ✅ CONFORME   | `{approved}` retornado corretamente                     |
| Import direto do SDK             | ✅ RUNTIME OK | Fora de `sdk/`, os matches atuais são JSDoc/comentários |
| `waitForEvent` re-export         | ⚠️ RISCO      | Sem wrapper de versão                                   |
| Estado cross-session em handlers | ⚠️ RISCO      | Shared state em closures                                |

### Achados do Documento

| ID                    | Sev | Arquivo                                           | Descrição                                                                          |
| --------------------- | --- | ------------------------------------------------- | ---------------------------------------------------------------------------------- |
| ARCH-SDK-01 / CAT-001 | P3  | `tools/*, hooks/registry.js, agent/lifecycle/...` | Re-triado: sem imports runtime fora do barrel; restam ocorrências JSDoc/comentário |
| GAP-HOOK-01           | P3  | `hooks/error-handler.js`                          | State de retry/circuit compartilhado entre sessões em closures                     |
| GAP-HOOK-02           | P3  | `sdk/session/permissions.js`                      | `modifiedInput` SDK feature não utilizada                                          |
| GAP-SDK-01            | P3  | `sdk/session/lifecycle.js`                        | `waitForEvent` re-export sem wrapper de versão                                     |
| GAP-SDK-02            | P3  | Múltiplos                                         | `BridgeError`/`StateTransitionError` não propagados — perde especificidade         |

---

_Próximo: [04-CHANNEL-COMMUNICATION.md](./04-CHANNEL-COMMUNICATION.md)_
