# Auditoria: hooks/audit.js

**Módulo**: hooks/ · **Fase**: F06-01 · **Data**: 2026-04-03 **Arquivo**:
`src/copilot/hooks/audit.js` · **LOC**: ~210

## Resumo

Ring buffer de auditoria para tool calls do SDK. `AuditRingBuffer` é um buffer circular O(1) push /
O(n) tail. `globalAuditBuffer` é a instância singleton. `createAuditPostToolHandler` é um factory
**deprecated** para `onPostToolUse`.

## Análise Estrutural

### Imports

- `#copilot/observability/logger` — barrel bypass (import direto de `log`)

### Exports

| Export                       | Tipo                 | Consumidores                                  |
| ---------------------------- | -------------------- | --------------------------------------------- |
| `AuditRingBuffer`            | class                | testes, index.js                              |
| `globalAuditBuffer`          | singleton            | tool-interceptor, hook-tools, event-collector |
| `createAuditPostToolHandler` | factory (deprecated) | testes legados                                |
| `getAuditTail`               | function             | hook-tools.js                                 |

### Estado Interno

- `_buffer`: Array pré-alocado (capacity slots via `new Array()`)
- `_writePos`: write pointer (módulo capacity)
- `_total`: total entries written
- `globalAuditBuffer`: singleton module-level (env-driven capacity)

## Achados

### LEAK-HOOK-001 · P3 — `_buffer` com `new Array(capacity)` cria slots sparse

**Evidência**: L68 `this._buffer = new Array(this._capacity)` **Impacto**: sparse arrays em V8 são
ineficientes vs `Array.from({length})`. Impacto baixo dado capacity default 500. **Fix**:
`this._buffer = Array.from({length: this._capacity})`

### ARCH-HOOK-001 · P4 — Barrel bypass: import direto de `#copilot/observability/logger`

**Evidência**: L30 `import { log } from '#copilot/observability/logger'` **Impacto**: Violação P1
(Single import path). Deveria importar de `#copilot/observability`.

### DEAD-HOOK-001 · P3 — `createAuditPostToolHandler` marcado como deprecated

**Evidência**: L143
`@deprecated Desde Fase AL — o feed ao globalAuditBuffer ocorre automaticamente via event-collector.js`
**Impacto**: Dead code mantido para compat. Candidato a remoção em v2.

### UPG-HOOK-001 · P4 — `clear()` re-cria Array, poderia apenas resetar ponteiros

**Evidência**: L123 `this._buffer = new Array(this._capacity)` **Impacto**: Minor allocation.
Alternativa: fill(undefined) + reset pointers.

## Pontuação de Saúde

| Dimensão                  | Score      |
| ------------------------- | ---------- |
| Correção lógica           | 9/10       |
| Segurança                 | 10/10      |
| Performance               | 8/10       |
| Manutenibilidade          | 8/10       |
| Cobertura de testes       | 7/10       |
| Conformidade arquitetural | 7/10       |
| **Média ponderada**       | **8.2/10** |
