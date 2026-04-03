# Auditoria — `metrics.js`

**Módulo**: `src/copilot/observability/metrics.js` **LOC**: 515 **Data**: 2026-06-10 **Auditor**:
Copilot Full-Audit MF-II

---

## 1. Propósito

`MetricsStore` com suporte a percentis (p50/p95/p99) para métricas de:

- Latência de tool calls (histograma rolling, 500 amostras por ferramenta)
- Token usage (input/output/cache por modelo)
- SessionMetrics (started/ended/errors)
- DialogMetrics (turns, stalls, timeouts, latência de turn)
- TaskMetrics (completed/failed, duração de task)
- StreamingMetrics (chunks interval; CR-01)
- QuestionMetrics (latência de resposta a question; CS-02)
- Contadores genéricos (`recordCounter`) e gauges instantâneos (`recordGauge`)
- Snapshot periódico em `logs/metrics.jsonl` via `startPeriodicSnapshot`

---

## 2. Arquitetura interna

```
createMetricsStore()
├── _tools: Record<name, { total, success, errors, histogram }>
├── _tokens: TokenUsageMetrics { input, output, cacheRead, cacheWrite, byModel }
├── _sessions: SessionMetrics { started, ended, errors }
├── _dialog: { turnsTotal, turnsSuccess, stallsTotal, timeoutsTotal, stallSumMs, histogram }
├── _tasks: { completed, failed, histogram }
├── _streaming: { chunksTotal, histogram }   ← CR-01
├── _questions: { total, histogram }          ← CS-02
├── _counters: Record<string, number>
├── _gauges: Record<string, { value, ts }>
└── _snapshotTimer: setInterval (opcional)
```

`createHistogram(maxSamples=500)`:

- Ring buffer com `_samples.shift()` ao overflow
- Lazy sort on snapshot (flag `_sorted`)
- `percentile(sorted, p)` usa `Math.ceil((p/100) * n) - 1` (nearest rank)

---

## 3. Achados

### FINDING-P4-1 — `_sum` acumula amostras removidas do ring buffer **[FIXED]**

**Severidade**: P4 — Médio **Localização**: `createHistogram()` (~linha 155–170)

`_sum` é incrementado em cada `record()` mas **nunca decrementado** quando a amostra mais antiga é
removida via `_samples.shift()`. Após o buffer encher (500 amostras), `_sum` continua acumulando
indefinidamente, enquanto `_samples` permanece com exatamente 500 entradas.

Consequência: `getSummary().tools["x"].latency.sum` reporta valores absurdamente altos após muitos
tool calls. A média calculada com esse sum (`sum / count`) seria incorreta.

```js
// Atual:
record(ms) {
    if (_samples.length >= maxSamples) _samples.shift(); // remove mais antiga
    _samples.push(ms);    // adiciona nova
    _sum += ms;           // ← nunca desconta o valor removido
}
```

**Proposta**:

```js
record(ms) {
    if (_samples.length >= maxSamples) {
        _sum -= _samples.shift(); // desconta o removido
    }
    _samples.push(ms);
    _sorted = false;
    if (ms < _min) _min = ms;
    if (ms > _max) _max = ms;
    _sum += ms;
}
```

---

### FINDING-P4-2 — `_min` e `_max` não são recalculados após shift

**Severidade**: P4 — Médio **Localização**: `createHistogram()` record()

`_min` e `_max` são atualizados incrementalmente mas **nunca revisados** quando o valor min/max é
removido do buffer. Após encher o buffer e fazer shift repetido, o `_min`/`_max` podem representar
amostras que não existem mais — os percentis estarão corretos (calculados do array atual), mas
`min`/`max` no snapshot serão stale.

**Proposta**: Recalcular `_min`/`_max` somente no `snapshot()`:

```js
snapshot() {
    if (!_samples.length) return { count: 0, sum: 0, min: 0, max: 0, p50: 0, p95: 0, p99: 0 };
    if (!_sorted) { _samples.sort((a, b) => a - b); _sorted = true; }
    return {
        count: _samples.length,
        sum: _sum,
        min: _samples[0],             // correto após sort
        max: _samples[_samples.length - 1],
        p50: percentile(_samples, 50),
        p95: percentile(_samples, 95),
        p99: percentile(_samples, 99),
    };
}
```

---

### FINDING-P5-3 — `startPeriodicSnapshot` importa módulos dinamicamente a cada intervalo

**Severidade**: P5 — Baixo **Localização**: `startPeriodicSnapshot()` (~linha 370)

```js
_snapshotTimer = setInterval(() => {
  void (async () => {
    const { appendFile: appendFileFn, mkdir: mkdirFn } = await import('node:fs/promises');
    const pathMod = await import('node:path');
    // ...
  })();
}, ms);
```

`import()` dinâmico dentro de `setInterval` — embora o Node.js cache módulos nativos, a resolução
assíncrona + overhead de Promise ocorre a cada tick do intervalo (default: 5 min). Impacto real é
mínimo, mas é um antipadrão desnecessário.

**Proposta**: Usar `import` estático no topo do arquivo (módulo já usa ESM com `// @ts-check`).

---

### FINDING-P5-4 — `reset()` cria novos histogramas com `maxSamples=500` fixo

**Severidade**: P5 — Cosmético **Localização**: `reset()` (~linha 445)

Se o `createMetricsStore()` for customizado com `maxSamples` diferente (hipotético, mas possível via
refatoração futura), `reset()` colocaria histogramas com o valor padrão 500. Atualmente não há
parâmetro de `maxSamples` no nível do store, mas a inconsistência é latente.

---

### FINDING-P5-5 — `percentile()` para amostras muito pequenas (< 10) pode ser inestável

**Severidade**: P5 — Baixo **Localização**: `percentile(sorted, p)` (~linha 130)

Para `n=1`, `percentile(sorted, 99)` → `idx = min(ceil(0.99) - 1, 0) = 0` → correto. Para `n=2`,
`p99` → `idx = min(ceil(1.98) - 1, 1) = 1` → correto. O comportamento é matematicamente válido, mas
ao reportar p99 com apenas 10 amostras, o percentil tem margem de erro enorme (cada amostra vale
10%). Não é um bug, mas deveria ser documentado.

---

## 4. Pontos positivos

- Histograma por ferramenta com ring buffer: evita acúmulo ilimitado de amostras.
- Lazy sort com flag `_sorted`: evita re-sort desnecessário quando nenhuma nova amostra chega.
- `metricsSummary` faz cópia de todos os objetos antes de retornar: safe para uso concorrente
  (Node.js single-thread, mas bom hábito).
- Snapshot periódico com `timer.unref()`: não impede processo de encerrar.
- Singleton `defaultMetrics` exportado — consumo imediato sem factory call.
- Separação clara de dimensões: `_dialog`, `_tasks`, `_streaming`, `_questions` como objetos
  independentes com histogramas próprios.

---

## 5. Score

| Dimensão            | Nota     |
| ------------------- | -------- |
| Correção matemática | 7/10     |
| API e JSDoc         | 9/10     |
| Robustez            | 8/10     |
| Performance         | 8/10     |
| **Global**          | **8/10** |

---

## 6. Status de Correção

### [FIXED] FINDING-P4-2 — `_min`/`_max` stale recalculados no snapshot()

`snapshot()` agora usa `_samples[0]` e `_samples[_samples.length - 1]` após sort, ao invés de
`_min`/`_max` tracking incremental. Esses valores são sempre corretos pois o array já está ordenado.
As variáveis `_min`/`_max` foram mantidas no `record()` para possível uso futuro, mas não são mais
lidas no `snapshot()`.

### [FIXED] FINDING-P5-3 — imports dinâmicos em setInterval movidos para topo

`appendFile`, `mkdir` (de `node:fs/promises`) e `join` (de `node:path`) foram movidos para imports
estáticos no topo do arquivo (`_appendFile`, `_mkdir`, `_join`). O `startPeriodicSnapshot()` agora
usa as referencias estáticas diretamente, sem overhead de Promise a cada tick do intervalo.

**Pontuação atualizada: 8.7/10**

---

_Arquivo gerado automaticamente pelo COPILOT-FULL-AUDIT MF-II._
