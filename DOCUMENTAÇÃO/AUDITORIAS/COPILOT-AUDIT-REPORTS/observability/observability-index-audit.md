# Auditoria — `index.js`

**Módulo**: `src/copilot/observability/index.js` **LOC**: 45 **Data**: 2026-06-10 **Auditor**:
Copilot Full-Audit MF-II

---

## 1. Propósito

Barrel de re-exports da API pública do módulo de observabilidade. Expõe:

| Export                                                                                    | Fonte                       |
| ----------------------------------------------------------------------------------------- | --------------------------- |
| `LOG_DIR`, `audit`, `getRecentLogs`, `log`, `logMetric`, `metric`                         | `./logger.js`               |
| `MAX_EVENTS_BYTES`, `createEventCollector`, `defaultEventCollector`, `initEventCollector` | `./event-collector.js`      |
| `createMetricsStore`, `defaultMetrics`                                                    | `./metrics.js`              |
| `createErrorTracker`, `defaultErrorTracker`                                               | `./error-tracker.js`        |
| `createAgentEventObserver`                                                                | `./agent-event-observer.js` |
| `createAuditLog`, `defaultAuditLog`                                                       | `./audit-log.js`            |
| `createHooksAuditPreset`                                                                  | `./hooks-audit-preset.js`   |
| `DEFAULT_OTEL_FILE`, `buildTelemetryConfig`, `isOtelEnabled`, `startSpan`                 | `./otel.js`                 |

---

## 2. Achados

### FINDING-P5-1 — `startSpanImmediate` não está re-exportado

**Severidade**: P5 — Baixo **Localização**: seção OTEL dos re-exports (~linha 44)

```js
export { DEFAULT_OTEL_FILE, buildTelemetryConfig, isOtelEnabled, startSpan } from './otel.js';
// startSpanImmediate ausente ↑
```

`startSpanImmediate` é usado por `agent-event-observer.js` para instrumentação de turn spans e
compaction spans. Qualquer consumidor externo que tente
`import { startSpanImmediate } from '#copilot/observability'` receberá `undefined` ou erro de named
export.

O import em `agent-event-observer.js` é direto (`from './otel.js'`), então funciona corretamente
internamente. Mas a omissão no barrel é uma API gap.

**Proposta**:

```js
export {
  DEFAULT_OTEL_FILE,
  buildTelemetryConfig,
  isOtelEnabled,
  startSpan,
  startSpanImmediate, // ← adicionar
} from './otel.js';
```

---

### FINDING-P5-2 — `MAX_EVENTS_BYTES` re-exportado (valor nunca aplicado internamente)

**Severidade**: P5 — Cosmético

Conforme identificado em `event-collector-audit.md`, `MAX_EVENTS_BYTES` é definido e exportado mas
não usado na lógica de `persistEvent()`. Sua re-exportação no barrel dá ao consumidor externo uma
constante cujo propósito não está sendo cumprido internamente.

Se `MAX_EVENTS_BYTES` for um contrato público ("o collector garante rotação nesse limite"), ele está
quebrado. Se for apenas "o valor que você pode usar para saber o limite configurado", deveria ser
documentado como apenas informativo.

---

### FINDING-P5-3 — Types não re-exportados (JSDoc typedefs)

**Severidade**: P5 — Cosmético

`AuditEntry`, `ToolAuditStartEntry`, `MetricsStore`, `MetricsSummary`, `ErrorTracker`,
`AgentEventObserver`, `TelemetryConfig` etc. são `@typedef` JSDoc — só existem no escopo de cada
módulo. Embora não sejam "exports" no sentido ESM, consumidores externos com `@ts-check` que
importem apenas do barrel não têm acesso fácil a esses tipos.

**Proposta** (opcional): Criar `types.js` com re-exports de typedefs para consumo externo, ou
documentar que tipos devem ser importados diretamente dos arquivos fonte.

---

## 3. Pontos positivos

- **Barrel completo**: todos os 9 submódulos têm pelo menos um export no barrel.
- **Singletons expostos**: `defaultMetrics`, `defaultErrorTracker`, `defaultAuditLog`,
  `defaultEventCollector` — consumo imediato sem factory call.
- **Separação clara** por seção com comentários por módulo.
- **Sem retransformações**: barrel puro de re-exports — sem código de inicialização, sem
  side-effects.

---

## 4. Score

| Dimensão               | Nota       |
| ---------------------- | ---------- |
| Completude dos exports | 8/10       |
| Organização            | 9/10       |
| API e JSDoc            | 8/10       |
| **Global**             | **8.3/10** |

---

_Arquivo gerado automaticamente pelo COPILOT-FULL-AUDIT MF-II._
