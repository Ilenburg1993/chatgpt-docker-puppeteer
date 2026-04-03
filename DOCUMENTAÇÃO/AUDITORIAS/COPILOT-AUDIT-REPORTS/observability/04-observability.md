# 04 — Auditoria Consolidada: `observability/`

**Módulo**: `src/copilot/observability/` **Data**: 2026-06-10 **Auditor**: Copilot Full-Audit MF-II
**Arquivos auditados**: 9 (3784 LOC total)

---

## 1. Inventário de arquivos

| #   | Arquivo                   | LOC  | Score  | MD individual                                                  |
| --- | ------------------------- | ---- | ------ | -------------------------------------------------------------- |
| 1   | `event-collector.js`      | 1247 | 7.0/10 | [event-collector-audit.md](event-collector-audit.md)           |
| 2   | `agent-event-observer.js` | 841  | 8.5/10 | [agent-event-observer-audit.md](agent-event-observer-audit.md) |
| 3   | `metrics.js`              | 515  | 7.5/10 | [metrics-audit.md](metrics-audit.md)                           |
| 4   | `audit-log.js`            | 290  | 7.0/10 | [audit-log-audit.md](audit-log-audit.md)                       |
| 5   | `logger.js`               | 270  | 6.5/10 | [logger-audit.md](logger-audit.md)                             |
| 6   | `error-tracker.js`        | 232  | 8.0/10 | [error-tracker-audit.md](error-tracker-audit.md)               |
| 7   | `otel.js`                 | 224  | 7.5/10 | [otel-audit.md](otel-audit.md)                                 |
| 8   | `hooks-audit-preset.js`   | 120  | 7.8/10 | [hooks-audit-preset-audit.md](hooks-audit-preset-audit.md)     |
| 9   | `index.js`                | 45   | 8.3/10 | [observability-index-audit.md](observability-index-audit.md)   |

**Score médio do módulo**: **7.6/10**

---

## 2. Mapa de achados consolidado

### Por severidade

| ID        | Severity | Arquivo                 | Descrição                                                                                             |
| --------- | -------- | ----------------------- | ----------------------------------------------------------------------------------------------------- |
| OBS-P4-01 | P4       | event-collector.js      | `MAX_EVENTS_BYTES` não aplicado — crescimento ilimitado do JSONL                                      |
| OBS-P4-02 | P4       | event-collector.js      | `session.idle` bypassa `_persistSet` — inconsistência                                                 |
| OBS-P4-03 | P4       | event-collector.js      | `scheduleFlush` usa `setImmediate` sem exit-flush — eventos perdidos em crash                         |
| OBS-P4-04 | P4       | audit-log.js            | `getAuditSummary()` lê arquivo inteiro em memória (O(n) RAM)                                          |
| OBS-P4-05 | P4       | audit-log.js            | `flush()` do ring buffer é acumulativo — duplicate entries se chamado 2×                              |
| OBS-P4-06 | P4       | logger.js               | `rotateFile()` + `appendFileSync` síncrono em todo `log()` — bloqueia event loop                      |
| OBS-P4-07 | P4       | logger.js               | `cleanOldFiles()` com `readdirSync`/`statSync` chamadas 3× no module load                             |
| OBS-P4-08 | P4       | hooks-audit-preset.js   | `onPreToolUse` sempre retorna `'allow'` — `allowAll: false` não tem efeito no pré-hook                |
| OBS-P4-09 | P4       | hooks-audit-preset.js   | `onErrorOccurred` sempre retorna `errorHandling: 'skip'` — swallows erros não-recuperáveis            |
| OBS-P5-10 | P5       | agent-event-observer.js | `status` event registrado 2× — potencial double-counting                                              |
| OBS-P5-11 | P5       | agent-event-observer.js | `_compactionSpan` pode vazar se `compaction_start` disparar sem `complete`                            |
| OBS-P5-12 | P5       | agent-event-observer.js | `_questionStarts` usa `Date.now()` vs `_turnStarts` com `performance.now()` — base inconsistente      |
| OBS-P5-13 | P5       | metrics.js              | `_samples.shift()` é O(n) — não é ring buffer real                                                    |
| OBS-P5-14 | P5       | metrics.js              | `_sum` acumula sem decrementar ao efetuar shift — average incorreto após maxSamples                   |
| OBS-P5-15 | P5       | audit-log.js            | Rotação mantém apenas 1 backup — `.1` sobrescrito silenciosamente                                     |
| OBS-P5-16 | P5       | error-tracker.js        | `_idCounter` module-level — compartilhado entre instâncias (IDs únicos globais, não locais)           |
| OBS-P5-17 | P5       | error-tracker.js        | `destroy()` chama `clearErrors()` resetando `_totalRegistered` — stats incorretos após destroy        |
| OBS-P5-18 | P5       | otel.js                 | `_tracer = null` após falha de init sem flag separado — `_getTracer()` tenta re-importar em todo call |
| OBS-P5-19 | P5       | otel.js                 | `NodeTracerProvider` sem exporters — spans criados mas nunca enviados                                 |
| OBS-P5-20 | P5       | otel.js                 | `startSpanImmediate` síncrono; se chamado antes de `_tracerInitPromise`, retorna `null`               |
| OBS-P5-21 | P5       | index.js                | `startSpanImmediate` não re-exportado no barrel                                                       |
| OBS-P5-22 | P5       | index.js                | `MAX_EVENTS_BYTES` re-exportado mas não aplicado internamente — API gap conceitual                    |

---

## 3. Análise cross-cutting

### 3.1 I/O Síncrono em logger.js (CRíTICO para performance)

O achado mais impactante do módulo: `logger.js` usa `appendFileSync` + `statSync` + `renameSync` em
**todo** evento de log. Dado que o sistema de observabilidade é chamado em alta frequência (a cada
tool call, dialog, chunk, etc.), isso bloqueia o event loop sistematicamente.

```
log() call
  └── rotateFile()        ← fs.statSync (bloqueia ~0.1ms)
  └── appendFileSync()    ← fs.appendFileSync (bloqueia ~0.5-5ms por chamada)
```

Com 100 eventos por segundo = 60-500ms de bloqueio por segundo. Inviável em prod.

**Correção recomendada**: substituir por writes assíncronos com buffer de batching (igual a
`audit-log.js` que usa `scheduleFlushTool()`).

### 3.2 Singletons compartilhados e isolamento de instâncias

Múltiplos módulos expõem **singletons** (`defaultMetrics`, `defaultAuditLog`, `defaultErrorTracker`,
`defaultEventCollector`). Isso é conveniente mas cria acoplamento implícito:

- `createHooksAuditPreset()` compartilha `defaultAuditLog` → `clearAuditTrail()` afeta TODAS as
  instâncias
- `createErrorTracker._idCounter` é module-level → instâncias não têm IDs isolados
- `defaultEventCollector` é criado na inicialização do módulo → sem lazy-init

**Padrão alternativo**: fornecer `createWithDefaults()` explícito que inicializa singletons sob
demanda em vez de na carga do módulo.

### 3.3 Falta de exit-flush em event-collector.js e audit-log.js

Ambos usam `setImmediate` para batching de writes, o que é eficiente mas não garante flush antes de
SIGTERM/SIGKILL. Em crashes do processo, eventos não flushed são perdidos.

**Correção padrão**: registrar `process.on('exit', flush)` + `process.on('SIGTERM', flush)`.

### 3.4 OTEL parcialmente funcional

`otel.js` tem toda a infraestrutura de spans mas **nunca os envia** porque `NodeTracerProvider` é
criado sem exporters. O sistema rastreia spans mas eles ficam em memória e são descartados.

Se OTEL for um objetivo real do sistema, é necessário adicionar pelo menos um exporter:

- `ConsoleSpanExporter` para desenvolvimento
- `OTLPTraceExporter` para produção

### 3.5 `hooks-audit-preset.js` — Clarificação de pré-hook vs permission handler

O preset confunde dois conceitos distintos do SDK:

- `onPreToolUse` → hook para aceitar/rejeitar ferramentas **antes** da execução
- `onPermissionRequest` → handler de permissão interativa/configurável

O preset sempre aprova via `onPreToolUse` (correto para preset de audit-only, não para access
control). A confusão potencial: o campo `allowAll` existe mas só afeta `onPermissionRequest`, não o
`onPreToolUse`.

---

## 4. Achados por arquivo (resumo)

### event-collector.js (Score: 7.0)

- **Ponto forte**: ~70 event handlers, correlação de tool latency, `_persistSet` O(1)
- **Gap principal**: `MAX_EVENTS_BYTES` não enforced → arquivo pode crescer sem limite
- **Gap secundário**: sem exit-flush via `process.on('exit')`

### agent-event-observer.js (Score: 8.5)

- **Ponto forte**: TTL para `_turnStarts` e `_questionStarts`, `_safe()` wrapper, `detach()` limpo
- **Gap principal**: `status` event duplo → double-count possível
- **Gap secundário**: `_compactionSpan` pode vazar em cenário de compaction_start repetido

### metrics.js (Score: 7.5)

- **Ponto forte**: histogramas com p50/p95/p99, `startPeriodicSnapshot` com `unref()`
- **Gap principal**: `_sum` inconsistente após `maxSamples` ultrapassado
- **Gap secundário**: `_samples.shift()` O(n) vs O(1) ring buffer real

### audit-log.js (Score: 7.0)

- **Ponto forte**: TTL para `_pending` (CQ-06), rotação de arquivo
- **Gap principal**: `getAuditSummary()` carrega arquivo inteiro em RAM
- **Gap secundário**: `flush()` duplica entradas se chamado repetidamente

### logger.js (Score: 6.5)

- **Ponto forte**: `_logRingBuffer` em memória, `log.setLevel()` dinâmico
- **Gap crítico**: I/O síncrono (`appendFileSync` + `statSync`) em hot path
- **Impacto**: bloqueia event loop em uso intenso

### error-tracker.js (Score: 8.0)

- **Ponto forte**: ring buffer, global handlers guardados, `destroy()` limpo
- **Gap menor**: `_idCounter` global, `_totalRegistered` resetado em `destroy()`

### otel.js (Score: 7.5)

- **Ponto forte**: graceful degradation se SDK não instalado, `_tracerInitPromise`
- **Gap funcional**: `NodeTracerProvider` sem exporters — traces são no-ops em produção

### hooks-audit-preset.js (Score: 7.8)

- **Ponto forte**: `allowAll: false` default, warning de segurança, API compacta
- **Gap conceitual**: `onPreToolUse` always-allow pode confundir com `allowAll` behavior

### index.js (Score: 8.3)

- **Ponto forte**: barrel completo, singletons expostos, sem side-effects
- **Gap menor**: `startSpanImmediate` ausente; `MAX_EVENTS_BYTES` re-exportado sem uso real

---

## 5. Ranking de impacto

| Rank | Achado    | Impacto operacional                                                      |
| ---- | --------- | ------------------------------------------------------------------------ |
| 1    | OBS-P4-06 | I/O síncrono em logger — bloqueia event loop sistematicamente            |
| 2    | OBS-P4-03 | Event-collector sem exit-flush — perda de eventos em crash               |
| 3    | OBS-P4-08 | `onPreToolUse` sempre aprova — expectativa de segurança não atendida     |
| 4    | OBS-P4-04 | `getAuditSummary` carrega arquivo inteiro — OOM possível em JSONL grande |
| 5    | OBS-P4-01 | `MAX_EVENTS_BYTES` não enforced — crescimento ilimitado do arquivo       |
| 6    | OBS-P5-19 | OTEL sem exporters — traces nunca enviados                               |
| 7    | OBS-P5-14 | `_sum` incorreto após shift — métricas de média imprecisas               |
| 8    | OBS-P4-09 | `onErrorOccurred` swallows erros não-recuperáveis                        |

---

## 6. Propostas de refatoração prioritárias

### Sprint 1 — Crítico (P4)

1. **logger.js → async writes**: substituir `appendFileSync` por `setImmediate`/stream writers com
   buffer. Modelo: como `audit-log.js` já faz via `_toolWriteQueue`.

2. **event-collector.js → exit flush**: adicionar `process.on('exit', () => flush(true))` e
   `process.on('SIGTERM', ...)` para garantir eventos em buffer são gravados no kill.

3. **hooks-audit-preset.js → documentar allow-always explicitamente**: adicionar JSDoc e comentário
   no código esclarecendo que é audit-only e não access-control.

4. **audit-log.js → streaming summary**: substituir `readFile` + split em `getAuditSummary` por
   stream readline reverso com limite early-exit.

### Sprint 2 — Qualidade (P5)

5. **metrics.js → ring buffer real**: substituir `Array.push()`/`shift()` por índice circular +
   `_sum` decremental no replace.

6. **otel.js → exporter configurável**: adicionar suporte a `OTEL_EXPORTER_OTLP_ENDPOINT` env para
   ativar exporter sem mudança de código; fallback `ConsoleSpanExporter` em dev.

7. **agent-event-observer.js → deduplicar `status`**: consolidar os dois handlers de `status` em um
   único, com lógica condicional para CT-03 vs. general.

8. **index.js → exportar `startSpanImmediate`**: adicionar ao barrel.

---

## 7. Score final do módulo

| Critério                | Nota                                           |
| ----------------------- | ---------------------------------------------- |
| Cobertura de eventos    | 9/10                                           |
| Qualidade de I/O        | 5/10 (logger síncrono)                         |
| Segurança               | 7/10 (hooks allow-always; allowAll default ok) |
| Robustez (TTL, cleanup) | 7.5/10                                         |
| Instrumentação OTEL     | 6/10 (sem exporters)                           |
| API pública (barrel)    | 8/10                                           |
| **Média global**        | **7.6/10**                                     |

---

_Arquivo consolidado gerado automaticamente pelo COPILOT-FULL-AUDIT MF-II. Referência:
`04-observability.md` v1.0._
