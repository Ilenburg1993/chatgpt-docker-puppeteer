# Auditoria — `otel.js`

**Módulo**: `src/copilot/observability/otel.js` **LOC**: 224 **Data**: 2026-06-10 **Auditor**:
Copilot Full-Audit MF-II

---

## 1. Propósito

Configuração de OpenTelemetry para o `CopilotClient` com graceful degradation. Oferece:

- `buildTelemetryConfig()`: constrói `TelemetryConfig` para `CopilotClientOptions.telemetry`
- `isOtelEnabled()`: verificação rápida via env `COPILOT_OTEL_DISABLED`
- `startSpan(name, attrs, fn)`: wrapper async com span OTEL + propagação de contexto
- `startSpanImmediate(name, attrs)`: span sem wrapper para uso em event handlers (síncrono)

**Variáveis de ambiente**:

- `COPILOT_OTEL_DISABLED=true` — desabilita completamente
- `COPILOT_OTEL_ENDPOINT` — OTLP HTTP endpoint
- `COPILOT_OTEL_EXPORTER_TYPE` — `file` (padrão) ou `otlp-http`
- `COPILOT_OTEL_SOURCE_NAME` — nome da instrumentação
- `COPILOT_OTEL_CAPTURE_CONTENT` — capturar conteúdo de mensagens

---

## 2. Arquitetura interna

```
_tracer: OtelTracer | null           ← null até _getTracer() resolver
_tracerInitPromise: Promise<void>    ← inicia em module load

_getTracer() → async, tenta import('@opentelemetry/sdk-trace-node')
startSpan(name, attrs, fn)   → aguarda _tracerInitPromise, então usa _tracer
startSpanImmediate(name, attrs) → síncrono, usa _tracer (pode ser null se não inicializado)
```

---

## 3. Achados

### FINDING-P4-1 — `_getTracer()` não persiste o estado "falhou" — retry infinito

**Severidade**: P4 — Médio **Localização**: `_getTracer()` (~linha 115)

```js
let _tracer = null;

async function _getTracer() {
    if (_tracer !== null) return _tracer;  // early return apenas se não-null
    try {
        // ... import e setup ...
        _tracer = trace.getTracer(...);
        return _tracer;
    } catch {
        _tracer = null;  // mantém null em falha
        return null;
    }
}
```

**Problema**: Se `@opentelemetry/sdk-trace-node` não estiver instalado, cada chamada a
`_getTracer()` tenta o `import()` dinâmico novamente (porque `_tracer` permanece `null`). O
`_tracerInitPromise` chamado no module load captura a primeira tentativa, mas qualquer chamada
subsequente direta a `_getTracer()` (se houvesse) repetiria o trabalho.

Na prática, como `startSpan` usa `await _tracerInitPromise` e `startSpanImmediate` usa `_tracer`
diretamente (sem chamar `_getTracer()`), o retry não ocorre na prática atual. Porém, o design é
frágil: uma sentinela `_tracerFailed = true` tornaria a intenção explícita.

**Proposta**:

```js
let _tracer = null;
let _tracerFailed = false;

async function _getTracer() {
    if (_tracer !== null || _tracerFailed) return _tracer;
    try {
        // ...
        _tracer = trace.getTracer(...);
    } catch {
        _tracerFailed = true;
    }
    return _tracer;
}
```

---

### FINDING-P5-2 — `startSpanImmediate` usa `_tracer` diretamente sem esperar init

**Severidade**: P5 — Baixo **Localização**: `startSpanImmediate()` (~linha 195)

`startSpanImmediate()` é síncrono e usa `_tracer` diretamente. Se chamado antes de
`_tracerInitPromise` resolver (improvável mas possível durante boot rápido), `_tracer` ainda é
`null` e a função retorna `null` silenciosamente. Isso resulta em spans OTEL perdidos
silenciosamente durante os primeiros milissegundos da sessão.

No caso do `agent-event-observer.js`, o `attach()` é chamado após o agente estar pronto, que é
suficientemente depois do module load — risco mínimo na prática.

**Proposta**: Documentar explicitamente que `startSpanImmediate()` pode retornar `null` se chamado
antes de `_tracerInitPromise` resolver.

---

### FINDING-P5-3 — `startSpanImmediate` não está re-exportado em `index.js`

**Severidade**: P5 — Cosmético **Localização**: `index.js` re-exports vs uso em
`agent-event-observer.js`

`agent-event-observer.js` importa `startSpanImmediate` diretamente de `./otel.js` (correto). Mas
`index.js` só re-exporta `startSpan`, não `startSpanImmediate`. Consumidores externos que usam
`import { startSpanImmediate } from '#copilot/observability'` receberão erro.

**Proposta**: Adicionar `startSpanImmediate` ao barrel em `index.js`.

---

### FINDING-P5-4 — `buildTelemetryConfig()` não valida URL do endpoint (SSRF risk mínimo)

**Severidade**: P5 — Baixo **Localização**: `buildTelemetryConfig()` (~linha 55)

```js
const endpoint = process.env['COPILOT_OTEL_ENDPOINT'];
if (endpoint) {
    return { otlpEndpoint: endpoint, ... };
}
```

O endpoint OTLP é passado diretamente da env sem validação de URL/schema. Se um valor malicioso
fosse injetado em `COPILOT_OTEL_ENDPOINT`, o SDK OTEL faria requests para esse endpoint. Na
arquitetura atual, somente o processo Node.js lê essa env var, então o vetor de ataque é limitado.
Mas para hardening, uma validação `new URL(endpoint).protocol === 'http:' || === 'https:'` seria
defensiva.

---

## 4. Pontos positivos

- **Graceful degradation**: `@opentelemetry/sdk-trace-node` é opcional; se não instalado, OTEL fica
  silenciosamente inativo sem erro no console (falha apenas no import — `catch {}` sem log).
- **`startSpan(name, attrs, fn)` wrapper**: propaga contexto OTEL corretamente via
  `context.with(ctx, fn)`, registra `duration_ms`, `setStatus(OK/ERROR)`, `recordException(err)`.
- **`_tracerInitPromise`**: garante que o tracer seja inicializado antes de qualquer `startSpan`.
- **Default file exporter**: `otel-traces.jsonl` no `LOG_DIR` copilot — isolado do workspace pai.
- **`COPILOT_OTEL_CAPTURE_CONTENT=false` padrão**: PII protegido por default.
- **Exports limpos**: `buildTelemetryConfig`, `isOtelEnabled`, `DEFAULT_OTEL_FILE`, `startSpan`.

---

## 5. Score

| Dimensão                        | Nota       |
| ------------------------------- | ---------- |
| Correção lógica                 | 8/10       |
| Robustez (graceful degradation) | 9/10       |
| API e JSDoc                     | 8/10       |
| Segurança                       | 8/10       |
| **Global**                      | **8.3/10** |

---

_Arquivo gerado automaticamente pelo COPILOT-FULL-AUDIT MF-II._
