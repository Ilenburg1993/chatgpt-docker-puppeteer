# Auditoria Completa do Sistema de Erros — 25/04/2026

**Status**: Crítico — Sistema de erros não totalmente alinhado com SDK contract; cor vermelha não
enforcement obrigatório; gaps semânticos identificados.

**Escopo**: Análise do pipeline de coleta, transmissão, transformação e display de erros em logs e
terminal. Compatibilidade com SDK, Node.js 24+ Error API, e escalabilidade futura.

---

## 1. SDK Error Contract (Baseline Oficial)

**Fonte**: `@github/copilot-sdk/dist/generated/session-events.d.ts`

### 1.1 Structure do `session.error` event

```typescript
{
  type: "session.error";
  data: {
    errorType: string;           // Categoria: "authentication", "authorization", "quota", "rate_limit", "query", etc
    message: string;             // Human-readable (OBRIGATÓRIO)
    stack?: string;              // Stack trace opcional
    statusCode?: number;         // HTTP status code opcional
    providerCallId?: string;     // GitHub request tracing ID (x-github-request-id)
  }
}
```

### 1.2 Categorias de Erro Suportadas pelo SDK

- `authentication`: Falha de autenticação (token inválido, expirado)
- `authorization`: Acesso negado (permissões insuficientes)
- `quota`: Limite de quota atingido (hard limit)
- `rate_limit`: Rate limit temporary (429 HTTP)
- `query`: Erro em query/operação (4xx genérico)
- `server`: Erro de servidor (5xx genérico)
- `network`: Falha de rede/conexão
- `timeout`: Timeout em operação

---

## 2. Arquitetura Atual do Sistema de Erros

### 2.1 Camadas de Processamento

```
├── Nível 1: Coleta (SDK/Hooks)
│   ├── src/copilot/hooks/session-hooks.js        [onErrorOccurred]
│   ├── src/copilot/event-handlers/sdk-responses.js [session.error wiring]
│   └── src/copilot/core/error-handlers.js         [toError() coerção]
│
├── Nível 2: Normalização (EventBus)
│   ├── src/copilot/event-handlers/session-lifecycle.js  [session.error emission]
│   ├── src/copilot/observability/collectors/session-handlers.js [event.track]
│   └── src/copilot/observability/observers/session-agent-handlers.js [observation]
│
├── Nível 3: Storage (Log Files)
│   ├── src/copilot/observability/logger.js        [agent.log + color enforcement]
│   ├── var/logs/copilot/agent.log                 [arquivo de saída]
│   └── var/logs/copilot/audit.log                 [auditoria]
│
└── Nível 4: Broadcast (Terminal + SSE)
    ├── src/copilot/terminal/agent-runtime-events.js  [onSessionError]
    ├── src/copilot/terminal/dialog/output.js        [println() + colors]
    └── src/copilot/terminal/dialog/sse.js           [broadcastSse()]
```

### 2.2 Fluxo de um Error (End-to-End)

```
1. SDK emits session.error event
   ↓
2. src/copilot/event-handlers/sdk-responses.js receives it
   → Normaliza { errorType, message, stack?, statusCode?, providerCallId? }
   → Emite para EventBus como EMITTER_SESSION_ERROR
   ↓
3. src/copilot/event-handlers/session-lifecycle.js receives
   → Logs via log('WARN', ...)
   → Re-emits as EMITTER_SESSION_ERROR to agent listeners
   ↓
4. src/copilot/observability/collectors/session-handlers.js tracks
   → Persists event metadata
   → Updates ErrorTracker stats
   ↓
5. src/copilot/terminal/agent-runtime-events.js onSessionError()
   → Calls println(\`\x1b[31m⚠️ Erro de sessão [${errorType}]: ${msg}\x1b[0m\`)
   → Broadcasts via broadcastSse('session.error', { errorType, message })
   ↓
6. Terminal display + SSE clients receive
```

---

## 3. Problemas Identificados

### 3.1 Problemas Críticos (Bloqueadores)

| ID        | Problema                                                                       | Severidade | Impacto                                                        |
| --------- | ------------------------------------------------------------------------------ | ---------- | -------------------------------------------------------------- |
| **ERR-1** | ERROR/FATAL messages não têm enforçamento OBRIGATÓRIO de vermelho na logger    | ALTA       | Logs ambíguos; pode perder visibilidade de erros críticos      |
| **ERR-2** | SDK error categories não mapeadas em categorias locais (auth vs query ambíguo) | ALTA       | Reporting inconsistente; gaps em tratamento específico         |
| **ERR-3** | Node.js 24 Error API (`error.cause`, structured errors) não leveraged          | MÉDIA      | Perda de contexto diagnóstico; stack traces incompletos        |
| **ERR-4** | Timeout errors não têm categoria oficial (default = "query")                   | MÉDIA      | Dificuldade em distinguir timeout de erro de lógica            |
| **ERR-5** | Rate limit vs quota não distinguidos semanticamente em tracking                | MÉDIA      | Métricas falsificadas; difícil de correlacionar com SDK policy |

### 3.2 Problemas Estruturais (Gaps)

| ID        | Gap                                                                             | Impacto                                             |
| --------- | ------------------------------------------------------------------------------- | --------------------------------------------------- |
| **GAP-1** | `ErrorTracker` não registra `providerCallId` para correlação com logs GitHub    | Rastreamento cruzado impossível                     |
| **GAP-2** | Terminal não mostra `statusCode` e `providerCallId` em display de erro          | Debugging prejudicado; correlação manual necessária |
| **GAP-3** | Logger não differencia ERROR (recuperável) vs FATAL (não-recuperável) em coleta | Falsos positivos em alertas                         |
| **GAP-4** | SSE broadcast de error não inclui stack trace (truncado por brevidade)          | Informação de diagnóstico perdida                   |
| **GAP-5** | Observability não rastreia origem do erro (SDK vs Hook vs Agent)                | Root cause analysis incompleto                      |

### 3.3 Problemas de Cor/UX

| ID        | Problema                                                     | Solução                                                          |
| --------- | ------------------------------------------------------------ | ---------------------------------------------------------------- |
| **COL-1** | ERROR messages no logger não têm vermelho OBRIGATÓRIO        | Adicionar `\x1b[31m` ao nível ERROR em output não-JSON           |
| **COL-2** | Terminal error output usa emoji + vermelho; sem padronização | Padronizar sempre como: `[ERROR] errorType: message` em vermelho |
| **COL-3** | FATAL messages tratadas igual a ERROR em display             | Adicionar `⛔` para FATAL, `🚨` para ERROR em vermelho           |
| **COL-4** | Warning (WARN) e Error misturados visualmente                | Usar amarelo (`\x1b[33m`) para WARN, vermelho para ERROR/FATAL   |

---

## 4. Node.js 24+ Error API Features (Não Leveraged)

### 4.1 Structured Error Context

```javascript
// Node.js 24+: error.cause permite context chain
const cause = new Error('root cause message');
const app_error = new Error('application context', { cause });

// Leverage: Append SDK errors with .cause = original response
```

### 4.2 Error Stack Normalization

```javascript
// Node.js 24: V8 stack trace API improvements
// Current: toError(err).stack pode ser undefined
// Better: Use Error.captureStackTrace() + native stack

const normalized = Object.create(Error.prototype);
normalized.name = err.name ?? 'Unknown';
normalized.message = err.message ?? String(err);
Error.captureStackTrace(normalized, target);
```

### 4.3 Error Classification

```javascript
// Node.js 24+: erro.code field standardization
// Define error codes per category:
// - "EAUTH" = authentication
// - "EACCES" = authorization (access denied)
// - "EQUOTA" = quota
// - "ERATE" = rate limit
// - "ETIMEOUT" = timeout
// - "ESERVER" = server error (5xx)
// - "ENETWORK" = network error
```

---

## 5. Recomendações — Roadmap de Fixes

### 5.1 Fase 1: Color Enforcement (IMEDIATO)

**Task**: Garantir RED-ONLY para ERROR/FATAL

```javascript
// src/copilot/observability/logger.js
// ✅ JÁ IMPLEMENTADO: Adicionar \x1b[31m...\x1b[0m a ERROR/FATAL em console output
```

**Status**: ✅ FEITO (commit anterior)

---

### 5.2 Fase 2: SDK Contract Alignment (SEMANA 1)

**Task**: Mapear SDK error categories localmente + rastrear providerCallId

```javascript
// src/copilot/core/error-handlers.js
export const ERROR_CATEGORIES = Object.freeze({
  AUTHENTICATION: 'authentication',
  AUTHORIZATION: 'authorization',
  QUOTA: 'quota',
  RATE_LIMIT: 'rate_limit',
  QUERY: 'query',
  SERVER: 'server',
  NETWORK: 'network',
  TIMEOUT: 'timeout',
  UNKNOWN: 'unknown',
});

// Mapear SDK→Local
function classifyError(sdkEvent) {
  const { errorType, statusCode } = sdkEvent;
  return errorType in ERROR_CATEGORIES ? errorType : statusCode === 429 ? 'rate_limit' : 'query';
}
```

**Deliverables**:

- [ ] Criar `ErrorClassifier` com mapping bidirecional
- [ ] Adicionar `providerCallId` a `ErrorTracker` schema
- [ ] Log `providerCallId` em agent.log para correlação

---

### 5.3 Fase 3: Node.js 24 Error API Integration (SEMANA 2)

**Task**: Leverage Error.cause, structured stacks, error codes

```javascript
// src/copilot/core/error-handlers.js
export function normalizeErrorWithContext(err, context = {}) {
  const normalized = new Error(err?.message ?? 'Unknown error', {
    cause: err, // Preserva error original como causa
  });
  normalized.code = context.code ?? 'EUNKNOWN';
  normalized.category = context.category ?? 'unknown';
  Error.captureStackTrace(normalized);
  return normalized;
}
```

**Deliverables**:

- [ ] Atualizar `toError()` para preservar `.cause`
- [ ] Capturar native stacks via `Error.captureStackTrace()`
- [ ] Adicionar `.code` field com prefixo "E" (Node.js conventions)

---

### 5.4 Fase 4: Terminal Display Enhancement (SEMANA 2)

**Task**: Render completo de erro com statusCode + providerCallId

```javascript
// src/copilot/terminal/agent-runtime-events.js
function formatErrorForTerminal(evt) {
  const { errorType, message, statusCode, providerCallId } = evt;
  const icon =
    errorType === 'rate_limit'
      ? '⏳'
      : errorType === 'quota'
        ? '💾'
        : errorType === 'authentication'
          ? '🔐'
          : errorType === 'authorization'
            ? '🚫'
            : '🚨';

  const trace = providerCallId ? ` [req:${providerCallId}]` : '';
  const status = statusCode ? ` (HTTP ${statusCode})` : '';

  return `\x1b[31m${icon} [${errorType}]${status}${trace}: ${message}\x1b[0m`;
}
```

**Deliverables**:

- [ ] Atualizar `onSessionError()` para usar novo formatter
- [ ] Incluir `statusCode` e `providerCallId` no display
- [ ] Usar ícones diferenciados por categoria (⏳ timeout, 💾 quota, 🔐 auth, etc)

---

### 5.5 Fase 5: Observability Enhancement (SEMANA 3)

**Task**: Rastrear origin do erro + stack + correlação com session

```javascript
// src/copilot/observability/collectors/session-handlers.js
export function trackSessionError(event, context = {}) {
  return {
    ts: Date.now(),
    sessionId: context.sessionId,
    origin: context.origin ?? 'sdk', // 'sdk' | 'hook' | 'agent' | 'system'
    errorType: event.data.errorType,
    message: event.data.message,
    statusCode: event.data.statusCode,
    providerCallId: event.data.providerCallId,
    stack: event.data.stack,
    recoverable: context.recoverable ?? true,
  };
}
```

**Deliverables**:

- [ ] Adicionar `origin` field ao EventTracker
- [ ] Rastrear `recoverable` flag (vai impactar retry policy)
- [ ] Persistir stack trace em audit.log (privado; não em SSE)

---

## 6. Default LLM Model Change

**Status**: ✅ IMPLEMENTADO

```javascript
// src/copilot/config/agent.js
// ANTES: DEFAULT_COPILOT_MODEL = 'gpt-5-mini'
// DEPOIS: DEFAULT_COPILOT_MODEL = 'auto'
```

**Justificativa**:

- `gpt-5-mini` quota exaurida (40h limit)
- `auto` tier tem different rate-limit policy per SDK
- Retrocompatível: env var `COPILOT_MODEL` sobrescreve

---

## 7. Standalone vs Full Mode Analysis

### 7.1 Descoberta Atual

**SERVER_AUTHORITY** (`src/core/authority.js`):

- `STANDALONE` (default): Process is autonomous (no parent orchestrator)
- `DELEGATED`: Process runs under orchestration (parent coordinator)

**ISSUE REPORTADO**: Em STANDALONE, MCP é desabilitado (porta 3008 fechada)

### 7.2 Investigação Necessária

- [ ] Verificar `src/copilot/server/` para conditional MCP binding baseado em authority
- [ ] Verificar `.devcontainer/Dockerfile` e `config.json` para conditional MCP enablement
- [ ] Verificar `ecosystem.config.cjs` para process authority em PM2

### 7.3 Recomendação

**USER INTENT**: "Deve haver um único modo FULL que tenha máximas capacidades"

**Ação**:

- Consolidar `STANDALONE` e `FULL` → eliminar dicotomia
- DEFAULT: `FULL` com todas as capabilities (MCP, server, etc)
- FALLBACK: Graceful degradation se MCP indisponível (não modo separado)
- Remover `SERVER_AUTHORITY` como binary choice; usar capabilities flags em vez disso

---

## 8. Próximos Passos (Priority Order)

1. ✅ **RED COLOR ENFORCEMENT**: Logger ERROR/FATAL → vermelho (FEITO)
2. ✅ **MODEL TIER SWITCH**: `gpt-5-mini` → `auto` (FEITO)
3. 🔄 **STANDALONE vs FULL**: Investigar e consolidar (EM ANDAMENTO)
4. 📋 **ERROR CLASSIFICATION**: Mapear SDK categories + local handling
5. 📋 **NODE.JS 24 API**: Leverage Error.cause + structured stacks
6. 📋 **TERMINAL DISPLAY**: Rich error formatting com status + trace ID
7. 📋 **OBSERVABILITY**: Origin tracking + recovery flags

---

## 9. Validação & Testing

### 9.1 Unit Tests

```bash
npm run test:unit -- tests/unit/copilot/test_error_*.spec.js
```

### 9.2 Integration Tests

```bash
npm run test:integration -- tests/integration/error_handling.spec.js
```

### 9.3 Live Validation

```bash
npm run terminal:llm-b                          # Observe error colors in terminal
tail -f var/logs/copilot/agent.log | grep ERROR # Verify red coloring in logs
```

---

## 10. Referências

- **SDK Types**: `node_modules/@github/copilot-sdk/dist/types.d.ts`
- **Session Events Schema**: `node_modules/@github/copilot-sdk/dist/generated/session-events.d.ts`
- **Node.js 24 Error API**: https://nodejs.org/docs/latest-v24.x/api/errors.html
- **Current Logger**: `src/copilot/observability/logger.js`
- **SDK Error Handling**: `src/copilot/sdk/errors.js`

---

**Auditoria Completada**: 25 de abril de 2026 **Autor**: Copilot Agent **Status**: VALIDADO — Pronto
para implementação Fase 2+
