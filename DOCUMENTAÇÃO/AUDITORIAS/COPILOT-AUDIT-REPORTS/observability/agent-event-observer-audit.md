# Auditoria — `agent-event-observer.js`

**Módulo**: `src/copilot/observability/agent-event-observer.js` **LOC**: 841 **Data**: 2026-06-10
**Auditor**: Copilot Full-Audit MF-II

---

## 1. Propósito

Observador do EventEmitter do `AlwaysAliveAgent` (Fase P). Conecta-se ao agente e alimenta
`MetricsStore` e `ErrorTracker` com eventos do ciclo de vida interno do agente:

- Dialog loop: `turn_start/end`, `stalled`, `turn_timeout`
- Tasks: `completed`, `error`
- Ferramentas do agente: `tool.execution_start/complete`
- Session lifecycle: `usage`, `history_synced`, `compaction_start/complete`
- Question lifecycle: `question.pending/answered` (latência via histogram)
- Background/shell completions
- Agent lifecycle: `ready`, `stopped`, `before-stop`

---

## 2. Arquitetura interna

| Componente                                   | Papel                                                                |
| -------------------------------------------- | -------------------------------------------------------------------- |
| `_registrations[]`                           | Lista de `{ emitter, event, listener }` para cleanup via `detach()`  |
| `_turnStarts: Map<turnId, { ts, span }>`     | Correlação `turn_start` → `turn_end`; TTL 5 min                      |
| `_toolStarts: Map<callId, { toolName, ts }>` | Correlação `tool.execution_start` → `complete` (local em `attach()`) |
| `_questionStarts: Map<qId, ts>`              | Correlação `question.pending` → `answered`; TTL 30 min               |
| `_compactionSpan`                            | Span OTEL único para `session.compaction_start/complete`             |
| `_lastChunkTs`                               | Timestamp do chunk anterior para histograma de intervalo             |
| `_safe(fn, ctx)`                             | Wrapper que captura exceções e loga WARN — sem crash de processes    |
| `_on(emitter, event, listener)`              | Registro rastreado para cleanup                                      |

**Dependências**:

- `./logger.js` → `log()`
- `./otel.js` → `startSpanImmediate()` (para spans de turn/compaction)

---

## 3. Achados

### FINDING-P5-1 — `status` event registrado duas vezes (listeners duplicados)

**Severidade**: P5 — Baixo **Localização**: ~linha 347 (CT-03 reconnect) e ~linha 418 (handler
genérico de status)

O evento `status` é registrado duas vezes como listener no mesmo `emitter`. Ambos serão chamados em
cada emissão:

```js
// Registro 1 (CT-03 reconnect):
_on(
  agent,
  'status',
  _safe((raw) => {
    const val = typeof raw === 'string' ? raw : (raw?.status ?? '');
    if (val.startsWith('reconnecting:')) metrics.recordCounter('agent.reconnect.attempt');
  }, 'status'),
);

// Registro 2 (handler genérico — linha ~418):
_on(
  agent,
  'status',
  _safe((evt) => {
    metrics.recordCounter(`agent.status.${evt?.status ?? 'unknown'}`);
  }, 'status'),
);
```

Quando `status` for `'reconnecting:...'`, **ambos** são executados. O `recordCounter` genérico
incrementará `agent.status.reconnecting:…` (string completa com `:…`) além do contador de reconnect.
Adicionalmente, o segundo handler faz `evt?.status` onde `evt` pode ser string — se o emitter emitir
`'reconnecting:v3'` como string, `evt?.status` é `undefined`, resultando em `agent.status.unknown`.

**Proposta**: Unificar em um único handler que trata ambas as semânticas:

```js
_on(
  agent,
  'status',
  _safe((raw) => {
    const val = typeof raw === 'string' ? raw : (raw?.status ?? 'unknown');
    if (val.startsWith('reconnecting:')) metrics.recordCounter('agent.reconnect.attempt');
    metrics.recordCounter(`agent.status.${val}`);
  }, 'status'),
);
```

---

### FINDING-P5-2 — `_questionStarts` usa `Date.now()` vs `_turnStarts` usa `performance.now()`

**Severidade**: P5 — Baixo **Localização**: `question.pending` (~linha 580) vs `dialog.turn_start`
(~linha 105)

Inconsistência de base de tempo dentro do mesmo módulo:

- `_turnStarts` usa `performance.now()` (monotônico, ms desde processo start, alta resolução)
- `_questionStarts` usa `Date.now()` (epoch ms, susceptível a NTP skew)

O comentário "CN-01 fix: TTL agora usa performance.now()" no handler de turn mostra que a migração
para `performance.now()` foi intencional — mas não aplicada ao handler de questions.

**Proposta**: Padronizar para `performance.now()` em `_questionStarts` (ou manter `Date.now()` mas
documentar explicitamente porque se optou pelo epoch).

---

### FINDING-P5-3 — `_compactionSpan` tracker único para compaction

**Severidade**: P5 — Baixo **Localização**: `session.compaction_start` (~linha 312),
`session.compaction_complete` (~linha 320)

`_compactionSpan` é uma variável `let` no escopo closure de `attach()`. Apenas **uma** compaction
pode ser rastreada por vez. Se `compaction_start` disparar duas vezes sem `compaction_complete`
intermediário (edge case, mas possível), o span anterior é **leaked** (nunca chamado `.end()`).

```js
_on(
  agent,
  'session.compaction_start',
  _safe(() => {
    _compactionSpan = startSpanImmediate('copilot.compaction');
    // anterior _compactionSpan (se existia) não é fechado
  }, 'session.compaction_start'),
);
```

**Proposta**: Fechar o span existente antes de criar novo:

```js
if (_compactionSpan) {
  _compactionSpan.end();
  _compactionSpan = null;
}
_compactionSpan = startSpanImmediate('copilot.compaction');
```

---

### FINDING-P5-4 — `_toolStarts` sem TTL explícito (risk de leak)

**Severidade**: P5 — Baixo **Localização**: `tool.execution_start` (~linha 270),
`tool.execution_complete` (~linha 280)

O Map `_toolStarts` (local no escopo de `attach()`) é alimentado em `tool.execution_start` e limpo
em `tool.execution_complete`. Se uma ferramenta iniciar e o processo never emitir o evento
`complete` (crash, abandon), a entrada fica forever no Map. Diferente de `_turnStarts` que tem TTL
explícito de 5 minutos, `_toolStarts` não tem.

**Proposta**: Adicionar TTL cleanup análogo ao `_turnStarts`:

```js
const _TOOL_START_TTL_MS = 2 * 60 * 1000;
// em tool.execution_start, antes de set():
const now = performance.now();
for (const [id, entry] of _toolStarts) {
  if (now - entry.ts > _TOOL_START_TTL_MS) _toolStarts.delete(id);
}
```

---

## 4. Pontos positivos

- **TTL no `_turnStarts`** (CN-01 fix): limpeza proativa com `performance.now()` — excelente prática
  para evitar memory leak em sessões longas.
- **CO-03 spans OTEL para turns**: `startSpanImmediate('copilot.dialog.turn')` com atributos de
  duração e sucesso — observabilidade rica sem overhead síncrono.
- **`_safe()` wrapper universal**: toda exceção em handlers é capturada e logada como WARN; nunca
  derruba o EventEmitter do agente.
- **`detach()` completo**: limpa `_registrations`, `_turnStarts` e `_lastChunkTs` — sem leaks na
  desmontagem.
- **CN-02 fix**: `question.pending` sem `questionId` não gera chave fallback no Map, evitando
  colisão silenciosa.
- **CR-02**: Histograma de intervalo entre chunks (`recordStreamingChunk`) com reset a cada turn —
  métricas de streaming limpas.
- **CS-02**: `recordQuestionLatency` para histogram de latência de questions — presença rara e
  valiosa.

---

## 5. Score

| Dimensão              | Nota       |
| --------------------- | ---------- |
| Cobertura de eventos  | 9/10       |
| Correção lógica       | 8/10       |
| Robustez (edge cases) | 8/10       |
| Qualidade JSDoc       | 9/10       |
| **Global**            | **8.5/10** |

---

## 6. Status de Correção

### [FIXED] FINDING-P5-1 — Handlers `'status'` duplicados unificados

Os dois handlers `'status'` (linha ~343 para reconnect + linha ~580 para contador genérico) foram
unificados em um único handler que detecta `val.startsWith('reconnecting:')` e também registra o
contador `agent.status.${val}`.

### [FIXED] FINDING-P5-2 — `_questionStarts` migrado para `performance.now()`

O Map `_questionStarts` agora armazena timestamps de `performance.now()` (monotônico). A comparação
TTL e o cálculo de duração também foram atualizados para usar `performance.now()`.

### [FIXED] FINDING-P5-3 — Guard `_compactionSpan` close-before-open

Antes de criar um novo `_compactionSpan`, o código agora verifica se já existe um span aberto e o
fecha (`_compactionSpan.end()`) antes de criar o novo.

### [FIXED] FINDING-P5-4 — TTL cleanup para `_toolStarts`

Adicionado `_TOOL_START_TTL_MS = 2 * 60 * 1000` (2 minutos). Na entrada de `tool.execution_start`, o
código agora varre e remove entradas antigas do Map `_toolStarts` antes de inserir novas.

**Pontuação atualizada: 9.0/10**

---

_Arquivo gerado automaticamente pelo COPILOT-FULL-AUDIT MF-II._
