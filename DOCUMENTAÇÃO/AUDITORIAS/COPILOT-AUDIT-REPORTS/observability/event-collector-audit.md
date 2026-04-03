# Auditoria — `event-collector.js`

**Módulo**: `src/copilot/observability/event-collector.js` **LOC**: 1 247 **Data**: 2026-06-10
**Auditor**: Copilot Full-Audit MF-II

---

## 1. Propósito

Captura sistemática de 70+ tipos de eventos do SDK Copilot para telemetria, observabilidade e
persistência em `logs/events.jsonl`. Implementa:

- Factory `createEventCollector(opts)` → `{ attach }` (padrão, não classe)
- Singleton `defaultEventCollector` + `initEventCollector(opts)` + re-export `MAX_EVENTS_BYTES`
- `attach(session, sessionId)`: registra handlers via `session.on()`, retorna array de unsubscribers

---

## 2. Arquitetura interna

| Componente                 | Papel                                                                      |
| -------------------------- | -------------------------------------------------------------------------- |
| `_writeQueue: string[]`    | Fila de linhas JSON a gravar em `events.jsonl`                             |
| `scheduleFlush()`          | `setImmediate` — flush assíncrono em batch                                 |
| `persistEvent(entry)`      | Push na fila + agenda flush                                                |
| `_pending: Map<tcId, {}>`  | Correlação `tool.execution_start` → `tool.execution_complete` (latência)   |
| `_turnStart: Map<tId, ts>` | Correlação `assistant.turn_start` → `assistant.turn_end` (duração de turn) |
| `DEFAULT_PERSIST_TYPES`    | `Object.freeze(new Set([...~60 event strings...]))` — O(1) de lookup       |

**Dependências**:

- `#copilot/hooks/audit` → `globalAuditBuffer.push()`
- `./logger.js` → `log()`
- `./metrics.js` → `MetricsStore`
- `./error-tracker.js` → `ErrorTracker`
- `#copilot/hooks/bus` → `HookBus`

---

## 3. Mapa de eventos cobertos

### Ferramentas (~8 handlers)

`tool.execution_start`, `tool.execution_complete`, `tool.execution_progress` (ephemeral),
`tool.execution_partial_result`, `tool.user_requested`, `tool.execution_progress` (Fase BF),
`tool.execution_partial_result` (Fase BF).

### Assistente / Dialog (~6 handlers)

`assistant.usage`, `assistant.turn_start/end`, `assistant.message`, `assistant.intent`,
`assistant.reasoning` (Fase BF), `assistant.streaming_delta` (Fase BF — size buckets).

### Sessão (~20 handlers)

`session.start`, `session.resume`, `session.error`, `session.shutdown`, `session.truncation`,
`session.compaction_start/complete`, `session.tools_updated`, `session.mcp_servers_loaded`,
`session.mode_changed`, `session.model_change`, `session.plan_changed`,
`session.background_tasks_changed`, `session.warning`, `session.idle`, `session.task_complete`,
`session.context_changed`, `session.handoff`, `session.skills_loaded`, `session.extensions_loaded`,
`session.mcp_server_status_changed`, `session.snapshot_rewind` (BF), `session.title_changed` (BF),
`session.workspace_file_changed` (BF), `session.info` (BF), `session.usage_info`.

### Usuário (~2 handlers)

`user.message` (PII-safe: só `contentLength` + attachments), `user_input.requested/completed`.

### Permissões / Hooks / Skills (~6 handlers)

`permission.requested/completed`, `hook.start/end`, `skill.invoked`.

### Subagentes (~5 handlers)

`subagent.started/completed/failed/selected/deselected`.

### MCP / External Tools / Commands (~8 handlers)

`mcp.oauth_required/completed`, `external_tool.requested/completed`,
`command.execute/queued/completed`, `commands.changed` (BF).

### Outros (~4 handlers)

`elicitation.requested/completed`, `abort`, `system.notification`, `system.message` (BF),
`pending_messages.modified` (BF), `exit_plan_mode.requested/completed`.

---

## 4. Achados

### FINDING-P4-1 — `MAX_EVENTS_BYTES` exportado mas não aplicado

**Severidade**: P4 — Médio **Localização**: `persistEvent()`, constante `MAX_EVENTS_BYTES`
(~linha 15)

`MAX_EVENTS_BYTES` é definido (env `COPILOT_EVENTS_MAX_BYTES` ou 5 MB) e até _re-exportado_ via
`index.js`, mas `persistEvent()` **nunca verifica o tamanho** do arquivo antes de gravar. O
`events.jsonl` cresce sem limite enquanto o processo estiver em execução.

```js
// Atual — sem verificação de tamanho:
function persistEvent(entry) {
  _writeQueue.push(JSON.stringify(entry) + '\n');
  scheduleFlush();
}
```

**Proposta de correção**:

```js
async function _flushQueue() {
  const batch = _writeQueue.splice(0);
  if (!batch.length) return;
  await mkdir(LOGS_DIR, { recursive: true });
  // Verificar tamanho antes de gravar
  try {
    const { size } = await stat(EVENTS_FILE);
    if (size >= MAX_EVENTS_BYTES) {
      await rename(EVENTS_FILE, EVENTS_FILE + '.1');
    }
  } catch {
    /* arquivo ainda não existe */
  }
  await appendFile(EVENTS_FILE, batch.join(''), 'utf8');
}
```

---

### FINDING-P4-2 — `session.idle` ignora `_persistSet`

**Severidade**: P4 — Médio **Localização**: handler `session.idle` (~linha 420)

Todos os outros handlers verificam `_persistSet.has(eventType)` antes de chamar `persistEvent()`. O
handler de `session.idle` chama `persistEvent()` **incondicionalmente**, ignorando a política de
filtro configurada pelo usuário via `persistTypes`.

```js
// Atual — inconsistente:
session.on('session.idle', (evt) => {
    persistEvent({ type: 'session.idle', ... });  // sem check _persistSet
});
```

**Proposta**:

```js
session.on('session.idle', (evt) => {
    if (_persistSet.has('session.idle')) persistEvent({ type: 'session.idle', ... });
    metrics?.recordCounter('session.idle');
});
```

---

### FINDING-P4-3 — `scheduleFlush` usa `setImmediate` sem flush em exit

**Severidade**: P4 — Médio **Localização**: `scheduleFlush()` (~linha 50)

Se o processo encerrar imediatamente após enfileirar eventos (ex: crash, `SIGTERM` rápido), o
`setImmediate` ainda não executou e os eventos são **perdidos silenciosamente**.

**Proposta**:

```js
// Adicionar listener de beforeExit/exit:
process.on('beforeExit', () => {
  if (_writeQueue.length > 0) {
    // flush síncrono de emergência
    const batch = _writeQueue.splice(0);
    try {
      fs.appendFileSync(EVENTS_FILE, batch.join(''), 'utf8');
    } catch {}
  }
});
```

---

### FINDING-P5-4 — `_pending` e `_turnStart` sem TTL

**Severidade**: P5 — Baixo **Localização**: Maps no escopo de `attach()` (~linhas 120–140)

Se tool calls ou turns iniciarem e nunca chegarem ao evento de conclusão (ex: sessão abandonada
abruptamente), as entradas nos Maps crescem indefinidamente pelo tempo de vida da sessão.
`agent-event-observer.js` (841 LOC) implementou TTL explícito para seu `_turnStarts` — aqui não.

**Proposta**: Implementar TTL cleanup análogo ao agente:

```js
// No handler tool.execution_start, antes de inserir:
const _TOOL_TTL_MS = 5 * 60 * 1000;
const now = performance.now();
for (const [id, entry] of _pending) {
  if (now - entry.ts > _TOOL_TTL_MS) _pending.delete(id);
}
```

---

### FINDING-P5-5 — Log "pre-BF" com conta incorreta

**Severidade**: P5 — Cosmético **Localização**: ~linha 1000

Log de diagnóstico diz "pre-BF: X handlers registrados" mas é impresso **antes** dos handlers da
Fase BF serem registrados, o que faz a conta parecer incompleta. O número real de handlers
registrados é ~14 a mais que o reportado.

**Proposta**: Mover o log de diagnóstico para depois de todos os handlers serem registrados, ou
separar logs por fase claramente.

---

### FINDING-P5-6 — `external_tool.completed` não persiste `toolName`

**Severidade**: P5 — Baixo **Localização**: handler `external_tool.completed` (Fase BF, ~linha 950)

```js
session.on('external_tool.completed', (evt) => {
  persistEvent({ type: 'external_tool.completed', requestId: evt.requestId });
  // toolName e resultado ausentes
});
```

`external_tool.requested` persiste `toolName` e traceparent W3C correto, mas
`external_tool.completed` só guarda `requestId`. Impossível correlacionar qual ferramenta foi no log
sem join manual.

**Proposta**: `persistEvent({ ..., toolName: evt.toolName, durationMs: evt.durationMs })`.

---

## 5. Pontos positivos

- Separação clara entre Fase original e **Fase BF** (bloco identificado no código).
- `DEFAULT_PERSIST_TYPES` como `Object.freeze(new Set(...))` — lookup O(1) e imutabilidade
  garantida.
- PII protegido por padrão: `captureUserContent` e `captureAssistantContent` são `false`.
- Quota warning automático (`assistant.usage` — remaining < 10%).
- Hook bus re-emite `post_tool_use` após `tool.execution_complete` — desacoplamento correto.

---

## 6. Score

| Dimensão              | Nota       |
| --------------------- | ---------- |
| Cobertura de eventos  | 9/10       |
| Correção lógica       | 7/10       |
| Robustez (edge cases) | 6/10       |
| Qualidade JSDoc       | 8/10       |
| **Global**            | **7.5/10** |

---

## 7. Status de Correção

### [FIXED] FINDING-P4-1 / LEAK-OBS-001 — Rotação de arquivo quando >= MAX_EVENTS_BYTES

`scheduleFlush` agora verifica o tamanho do arquivo com `stat()` antes de fazer append. Se
`size >= MAX_EVENTS_BYTES`, renomeia `events.jsonl` para `events.jsonl.1` antes do append. Imports
de `rename` e `stat` adicionados do `node:fs/promises`.

### [FIXED] FINDING-P4-2 — `session.idle` agora verifica `_persistSet`

O handler `session.idle` agora verifica `_persistSet.has('session.idle')` antes de chamar
`persistEvent()`, evitando persistência de eventos excluídos do conjunto configurado.

### [FIXED] FINDING-P5-4 — TTL cleanup para `_pending` e `_turnStart`

Adicionado `_TOOL_CALL_TTL_MS = 5 * 60 * 1000` (5 minutos). Na entrada de `tool.execution_start` e
`assistant.turn_start`, o código agora varre e remove entradas antigas ou "órfãs" do Map antes de
inserir novas.

### [FIXED] FINDING-P4-3 — `scheduleFlush` sem flush em exit

`process.on('beforeExit', ...)` adicionado no nível do módulo para drenar `_writeQueue` antes do
processo encerrar. Garante que eventos enfileirados não se percam no shutdown normal.

### [FIXED] FINDING-P5-5 — Log "pre-BF" com conta incorreta

Log diagnóstico `${unsubs.length} handlers registrados (pre-BF)` removido por ser enganoso (contava
handlers registrados antes da fase BF). Apenas o log com contagem final permanece.

### [FIXED] FINDING-P5-6 — `external_tool.completed` agora inclui `toolName` e `durationMs`

Handler atualizado com cast seguro para extrair `toolName` e `durationMs` do payload de evento,
melhorando correlação e rastreabilidade de ferramentas externas nos logs persistidos.

**Pontuação atualizada: 9.5/10**

---

_Arquivo gerado automaticamente pelo COPILOT-FULL-AUDIT MF-II._
