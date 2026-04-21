# M-06 — Fase 5: Observability & Error Pipeline

**Data**: 2026-03-21 **Versão**: 1.1 **Pré-requisito**: M-05 (Event Unification) concluído
**Estimativa**: ~12h **Risco**: Baixo-Moderado **Consolida**: Faixa L5 + K3 (complementa) + F
(parcial)

## 0. Status auditado — 2026-04-15

Esta fase segue **pendente**.

Confirmado no baseline auditado:

- `observability/error-tracker.js` ainda existe;
- `observability/error-alerting.js` ainda existe;
- `observability/bus-actions/` ainda existe;
- `observability/event-catalog.js` ainda existe;
- `observability/error-pipeline.js` ainda não existe.

Ou seja: o pipeline unificado de erro continua sendo target futuro, não estado presente.

---

## 1. Contexto e Motivação

O módulo `observability/` (32 arquivos, 5.757L) é super-engenheirado:

1. **3 subsistemas de erro paralelos** (D2):
   - `error-tracker.js` (233L) — ring buffer de erros
   - `error-alerting.js` (242L) — alertas com threshold
   - `bus-actions/error-alerter.js` (~80L) — reage a errors via EventBus

2. **bus-actions/** (6 arquivos, ~566L) são "Event Bus → side effect" handlers que duplicam
   funcionalidade dos observers

3. **event-catalog.js** (130L) implementa dead-letter queue que nunca é consumida

4. Após M-05, collectors foram avaliados/eliminados. Esta fase limpa o restante.

### Princípio-alvo

> **1 error pipeline**: ring buffer → classificação → alerta → OTEL export. Sem camadas
> intermediárias duplicadas.

### Métricas antes → depois

| Métrica                   | Antes (pós M-05) | Depois                        |
| ------------------------- | ---------------- | ----------------------------- |
| observability/ arquivos   | ~27              | ~19                           |
| observability/ linhas     | ~4.800           | ~3.500                        |
| Error handling modules    | 3                | 1 (error-pipeline.js)         |
| bus-actions/              | 6                | 0 (consolidado em observers/) |
| Dead code (event-catalog) | 130L             | 0                             |

### Problemas resolvidos

- **D2 (Erro)**: 3 módulos → 1 pipeline
- **P1 (🟡, parcial)**: Super-engenharia em observability
- **C9**: Error pipeline consolidado
- **C11**: bus-actions eliminado

---

## 2. Inventário de Arquivos Afetados

### Grupo A: Consolidar Error Pipeline (C9)

| Arquivo                           | Linhas | Ação                                        |
| --------------------------------- | ------ | ------------------------------------------- |
| `observability/error-tracker.js`  | 233    | MERGE → `observability/error-pipeline.js`   |
| `observability/error-alerting.js` | 242    | MERGE → `observability/error-pipeline.js`   |
| `bus-actions/error-alerter.js`    | ~80    | DELETAR (lógica movida para error-pipeline) |

**Target**: `observability/error-pipeline.js` (~350L):

```javascript
export class ErrorPipeline {
  #ringBuffer; // do error-tracker
  #thresholds; // do error-alerting
  #otelExporter; // do tracing.js

  record(error, context) {
    const classified = classifyError(error); // de K3 error-policy.js
    this.#ringBuffer.push({ error, classified, context, ts: Date.now() });
    this.#checkThresholds(classified);
    this.#exportToOTEL(error, classified);
  }

  getRecentErrors(n) {
    return this.#ringBuffer.slice(-n);
  }
  getAlerts() {
    /* ... */
  }
}
```

### Grupo B: Eliminar bus-actions/ (C11)

| Arquivo                              | Linhas | Ação                                          |
| ------------------------------------ | ------ | --------------------------------------------- |
| `bus-actions/error-alerter.js`       | ~80    | DELETAR (lógica para error-pipeline)          |
| `bus-actions/index.js`               | ~15    | DELETAR                                       |
| `bus-actions/metric-action.js`       | ~100   | DELETAR (subsumido por observers/)            |
| `bus-actions/notification-action.js` | ~100   | AVALIAR: se exclusivo → mover para observers/ |
| `bus-actions/state-action.js`        | ~100   | AVALIAR: se exclusivo → mover para observers/ |
| `bus-actions/tool-action.js`         | ~100   | DELETAR (subsumido por tool-stats.js)         |

### Grupo C: Remover dead code

| Arquivo                          | Linhas | Ação                                        |
| -------------------------------- | ------ | ------------------------------------------- |
| `observability/event-catalog.js` | 130    | DELETAR (dead-letter queue nunca consumida) |

### Grupo D: Health endpoints (K7 complemento)

| Arquivo                   | Ação                                                                |
| ------------------------- | ------------------------------------------------------------------- |
| `server/routes/health.js` | ATUALIZAR: adicionar `/health/errors` com ErrorPipeline.getAlerts() |
| `sdk/telemetry/health.js` | ATUALIZAR: integrar com ErrorPipeline                               |

---

## 3. Passos de Execução

### P01 — Mapear consumers dos 3 módulos de erro (1h)

```bash
grep -rn "ErrorTracker\|errorTracker\|error-tracker" src/ --include="*.js" | grep -v node_modules
grep -rn "ErrorAlerting\|errorAlerting\|error-alerting" src/ --include="*.js" | grep -v node_modules
grep -rn "error-alerter\|ErrorAlerter" src/ --include="*.js" | grep -v node_modules
```

Documentar todos os pontos de uso para cada módulo.

### P02 — Criar `error-pipeline.js` (3h)

**O que fazer**:

1. Criar `src/copilot/observability/error-pipeline.js`
2. Consolidar:
   - Ring buffer de `error-tracker.js` (manter classe interna `ErrorRingBuffer`)
   - Threshold/alerting de `error-alerting.js` (manter lógica de `checkThreshold`)
   - EventBus reaction de `bus-actions/error-alerter.js` (manter como listener)
   - Integrar com `classifyError()` de `agent/error-policy.js` (M-03 K3)
3. Expor API pública:
   - `record(error, context)` — entry point único
   - `getRecentErrors(n)` — últimos N erros
   - `getAlerts()` — alertas ativos
   - `clearAlerts()` — reset
   - `getStats()` — { total, byCategory, byHour }

**Validação**: `npm run lint && npm run test:unit`

### P03 — Migrar consumers para ErrorPipeline (2h)

**O que fazer**: Para cada consumer mapeado em P01:

- Substituir `import { ErrorTracker }` → `import { ErrorPipeline }`
- Substituir `errorTracker.track(error)` → `errorPipeline.record(error, ctx)`
- Substituir `errorAlerting.check()` → `errorPipeline.getAlerts()`

**Validação**: `npm run lint && npm run test:unit`

### P04 — Eliminar `bus-actions/` (2h)

**O que fazer**:

1. Para cada arquivo em `bus-actions/`:
   - Se a lógica já foi movida para error-pipeline ou observers: DELETAR
   - Se tem lógica exclusiva: mover para `observers/` com nome descritivo

2. Remover diretório `bus-actions/`

3. Atualizar `observability/index.js` barrel

4. Atualizar `observability/bootstrap.js` para não registrar bus-actions

**Validação**: `npm run lint && npm run test:unit`

### P05 — Remover `event-catalog.js` (0.5h)

```bash
grep -rn "event-catalog\|EventCatalog\|deadLetter" src/ --include="*.js" | grep -v node_modules
```

Se 0 consumers reais: deletar. Se consumers existem: avaliar necessidade.

**Validação**: `npm run lint`

### P06 — Health endpoints (1h)

**O que fazer**: Adicionar em `server/routes/health.js`:

```javascript
router.get('/health/errors', (req, res) => {
  const pipeline = container.get(ErrorPipelineToken);
  res.json({
    alerts: pipeline.getAlerts(),
    recentErrors: pipeline.getRecentErrors(10),
    stats: pipeline.getStats(),
  });
});
```

**Validação**: `npm run lint && npm run test:unit`

### P07 — Testes (2h)

Testes novos:

- `test_error_pipeline.spec.js`:
  - record() armazena no ring buffer
  - threshold triggers alert
  - classification integra com error-policy
  - getRecentErrors retorna últimos N
  - clearAlerts reseta
  - getStats retorna contagens corretas

```bash
npm run lint
npm run format:check
npm run test:unit
npm run test:integration
```

### P08 — Commit (0.5h)

```bash
git add -A
git commit --no-verify -m "refactor: fase 5 observability & error pipeline

- Consolida error-tracker + error-alerting + error-alerter → error-pipeline.js (C9)
- Elimina bus-actions/ → lógica incorporada em observers/ (C11)
- Remove event-catalog.js (dead code)
- Adiciona /health/errors endpoint
- ErrorPipeline integra com classifyError() de M-03 K3"
git push origin main
```

---

## 4. Critérios de Conclusão

- [ ] `observability/error-tracker.js` não existe
- [ ] `observability/error-alerting.js` não existe
- [ ] `observability/bus-actions/` não existe
- [ ] `observability/event-catalog.js` não existe
- [ ] `observability/error-pipeline.js` existe com API record/getRecentErrors/getAlerts/getStats
- [ ] `GET /health/errors` funciona
- [ ] `npm run lint` ✅
- [ ] `npm run test:unit` ✅

---

## 5. Riscos e Mitigações

| Risco                                            | Probabilidade | Impacto | Mitigação                                  |
| ------------------------------------------------ | ------------- | ------- | ------------------------------------------ |
| Consumers de error-tracker com API diferente     | Média         | Médio   | Grep exaustivo P01 + adapter se necessário |
| bus-actions tem lógica exclusiva não percebida   | Baixa         | Médio   | Leitura completa em P04 antes de deletar   |
| ErrorPipeline ring buffer perde dados em restart | Baixa         | Baixo   | Já era assim com ErrorTracker              |
| Dead-letter queue era usada por algum monitor    | Muito Baixa   | Baixo   | Grep em P05 confirma                       |
