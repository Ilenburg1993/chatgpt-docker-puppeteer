# Auditoria: hooks/composer.js

**Módulo**: hooks/ · **Fase**: F06-03 · **Data**: 2026-04-03 **Arquivo**:
`src/copilot/hooks/composer.js` · **LOC**: ~180

## Resumo

Utilitários de composição funcional para handlers de hooks: `composeHandlers` (chain com early
return), `pipeline` (todos executam, merge de resultados), `fallback`, `raceWithTimeout`,
`conditional`, `memoize`.

## Análise Estrutural

### Imports

- `#copilot/observability/logger` — barrel bypass

### Exports

| Export            | Tipo     | Descrição                            |
| ----------------- | -------- | ------------------------------------ |
| `composeHandlers` | function | Chain — para no primeiro com decisão |
| `pipeline`        | function | Todos executam, merge output         |
| `fallback`        | function | Primary + fallback on error          |
| `raceWithTimeout` | function | Timeout wrapper                      |
| `conditional`     | function | Predicado → handler / else           |
| `memoize`         | function | Cache por keyFn                      |

### Estado Interno

- `memoize()`: `Map<string, unknown>` interno — sem TTL, sem eviction, sem limit

## Achados

### LEAK-HOOK-002 · P2 — `memoize()` cache sem TTL nem eviction

**Evidência**: L162 `const cache = new Map()` — cresce indefinidamente **Cenário**: Se usado para
memoizar resultados de tools com chaves variadas (e.g., toolName+args), o Map cresce sem limite ao
longo da sessão. **Fix**: Adicionar maxSize ou TTL, ou WeakRef.

### BUG-HOOK-002 · P3 — `raceWithTimeout` não cancela o handler original

**Evidência**: L117-126 — `Promise.race` resolve com undefined no timeout, mas o handler original
continua executando **Impacto**: Side effects do handler ocorrem mesmo após timeout. O resultado é
descartado mas a execução não é abortada (sem AbortController).

### PERF-HOOK-001 · P4 — `pipeline` faz spread merge a cada handler

**Evidência**: L77 `merged = { ...merged, ...result }` — O(n) per handler **Impacto**: Negligível
para pipelines pequenos (típico: 2-5 handlers).

### ARCH-HOOK-003 · P4 — Barrel bypass: logger import direto

**Evidência**: L12

### UPG-HOOK-003 · P4 — `raceWithTimeout` poderia usar AbortController

**Evidência**: L117 — Promise.race sem cancelamento **Fix**: Propagar AbortSignal para handlers que
o suportam.

## Pontuação de Saúde

| Dimensão                  | Score      |
| ------------------------- | ---------- |
| Correção lógica           | 8/10       |
| Segurança                 | 10/10      |
| Performance               | 8/10       |
| Manutenibilidade          | 9/10       |
| Cobertura de testes       | 6/10       |
| Conformidade arquitetural | 7/10       |
| **Média ponderada**       | **8.0/10** |
