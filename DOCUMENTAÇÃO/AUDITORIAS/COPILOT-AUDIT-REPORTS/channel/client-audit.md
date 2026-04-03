# channel/client.js — Auditoria

**Módulo**: `src/copilot/channel/` **Arquivo**: `client.js` **LOC**: 608 | **Score**: 8.7/10

## Responsabilidade

`LlmBridgeClient`: cliente conversacional de alto nível sobre o `AlwaysAliveAgent`. Suporta:

- `chat(message, opts)` — envio com streaming via `task.delta`
- `chatStructured(input, opts)` — protocolo StructuredMessage (Sprint A)
- `chatBatch(messages, opts)` — semáforo de concorrência por slot
- `startDialogMode / dialogTurn / stopDialogMode` — dialog loop (§15.8)
- `answer(answer)` — resposta a `question.pending`
- `history / getLastNPairs / clearHistory / seedHistory` — gestão de histórico

Dependency injection via `setBridgeAgent(agent)` para evitar circular dep (ARCH-03).

## Achados

### P4 — `chatBatch` com concurrency > 1: task.queued listener cross-contamination **[FIXED]**

**Localização**: `client.js chatBatch` → `this.chat(msg, chatOpts)` paralelo em slots distintos

**Descrição**: Quando `concurrency ≥ 2`, múltiplos `chat()` executam com sobreposição via
`Promise.all`. Cada instância registra:

```js
requireAgent().on('task.queued', onTaskQueued);
```

Quando a tarefa A emite `task.queued`, AMBOS os listeners de A e B disparam com o `taskId` de A. O
listener de B captura o `activeTaskId` de A — e passa a coletar os deltas de A como se fossem de B.
Resultado: `chatBatch` com concurrency > 1 pode misturar chunks entre respostas.

**Mitigação atual**: `BUG-CRIT-06` está documentado no JSDoc: _"AlwaysAliveAgent serializa
internamente — paralelismo real exige múltiplas instâncias."_ Em prática, o `AlwaysAliveAgent`
processa uma tarefa de cada vez, portanto a contaminação só ocorre se as tarefas se sobrepõem no
momento do `queued` event.

**Sugestão**: Desregistrar `task.queued` imediatamente após capturar o próprio `taskId` (usar
`requireAgent().once('task.queued', ...)` com guard por correlationId ou timestamp).
Alternativamente, forçar `concurrency=1` no `LlmBridgeClient` singleton e documentar que múltipla
concorrência exige múltiplas instâncias.

---

### P5 — `stopDialogMode` hardcoda `reason: 'watchdog_restart'`

**Localização**: `client.js:stopDialogMode`

**Descrição**: `stopDialogLoop({ authorized: true, reason: 'watchdog_restart' })`. Quando chamado
fora do contexto de watchdog (ex.: shutdown controlado), o motivo `watchdog_restart` dispara lógica
de restart no handler de `index.js` incompatível com a intenção. Não existe parâmetro para
sobrescrever a razão.

**Sugestão**: Aceitar `reason` como parâmetro opcional com default `'manual'` ou `'client_stop'`.

---

### P5 — `chat()`: `task.queued` listener permanece como `on` (não `once`)

**Localização**: `client.js:205` — `requireAgent().on('task.queued', onTaskQueued)`

**Descrição**: Usa `on` (multi-disparo) em vez de `once`. Se por qualquer razão mais de um
`task.queued` for emitido durante o turno, `activeTaskId` será sobrescrito com o ID mais recente,
desviando a coleta de chunks. O `finally` limpa com `off` adequadamente — mas `once` seria mais
correto.

**Sugestão**: Usar `requireAgent().once('task.queued', onTaskQueued)` com cleanup seguro no
`finally` via `off`.

---

## Destaques Positivos

- **ARCH-03**: injeção de dependência limpa via `setBridgeAgent()` — sem circular import
- **ARCH-05/06/07**: `#maxHistorySize` configurável + trim com `WARN` log ao truncar
- **BUG-MED-02**: histórico do usuário registrado apenas após sucesso de envio
- **UPG-06**: `chatBatch` com semáforo por slot e guard de 50 mensagens via `RangeError`
- `getLastNPairs`: implementação cursor-based sem arrays intermediários desnecessários
- `#history` como campo privado com acesso imutável via `ReadonlyArray`
- `chatStructured` popula `parseError` quando resposta não é StructuredMessage válido (BUG-04)
- `dialogTurn` propaga `task.delta` via `onDelta` callback (BUG-H05)
- `#registerDialogListeners` extrai lógica de registro/cleanup — DRY

---

_Gerado automaticamente pelo COPILOT-FULL-AUDIT MF-II._
