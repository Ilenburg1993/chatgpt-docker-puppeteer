# Auditoria: hooks/error-handler.js

**Módulo**: hooks/ · **Fase**: F06-04 · **Data**: 2026-04-03 **Arquivo**:
`src/copilot/hooks/error-handler.js` · **LOC**: ~265

## Resumo

Três estratégias de error handling para `onErrorOccurred`:

1. `createErrorHandler` — estratégia fixa ou contextual com retry counting
2. `createCircuitBreakerHandler` — circuit breaker com auto-reset por tempo
3. `createContextualErrorHandler` — mapa direto context → strategy

## Análise Estrutural

### Imports

- `#copilot/observability/logger` — barrel bypass

### Exports

| Export                         | Tipo    | Descrição                     |
| ------------------------------ | ------- | ----------------------------- |
| `createErrorHandler`           | factory | Configurable retry + strategy |
| `createCircuitBreakerHandler`  | factory | Circuit breaker pattern       |
| `createContextualErrorHandler` | factory | Strategy map                  |

### Estado Interno

- `createErrorHandler`: `retryCounts: Map<string, number>` — sem TTL, sem eviction
- `createCircuitBreakerHandler`: `circuits: Map<string, CircuitBreakerState>` — sem eviction

## Achados

### LEAK-HOOK-003 · P2 — `retryCounts` Map cresce sem limite em `createErrorHandler`

**Evidência**: L86 `const retryCounts = new Map()` — entries são criadas por contextKey mas só
deletadas no branch de maxRetries atingido **Cenário**: Se erros de contextos variados ocorrem sem
atingir maxRetries, o Map cresce indefinidamente. **Fix**: Adicionar cleanup periódico ou max
entries.

### LEAK-HOOK-004 · P2 — `circuits` Map cresce sem limite em `createCircuitBreakerHandler`

**Evidência**: L163 `const circuits = new Map()` — entries criadas por contextKey, nunca removidas
**Cenário**: Após reset do circuit, o state permanece (com failures=0), nunca é evicted. **Fix**:
Evict entries após N resets ou usar TTL.

### BUG-HOOK-003 · P3 — `createErrorHandler` retorna `{ retryCount }` que não é documentado no SDK

**Evidência**: L97 `return { errorHandling: 'retry', retryCount: currentRetries + 1 }` **Impacto**:
O SDK espera `ErrorOccurredHookOutput` com `errorHandling` e opcionalmente `retryCount`. Se o SDK
ignora `retryCount`, não há bug. Mas é um campo extra não garantido pelo contrato.

### ARCH-HOOK-004 · P4 — Barrel bypass: logger import direto

**Evidência**: L12

## Pontuação de Saúde

| Dimensão                  | Score      |
| ------------------------- | ---------- |
| Correção lógica           | 8/10       |
| Segurança                 | 10/10      |
| Performance               | 7/10       |
| Manutenibilidade          | 8/10       |
| Cobertura de testes       | 5/10       |
| Conformidade arquitetural | 7/10       |
| **Média ponderada**       | **7.5/10** |
