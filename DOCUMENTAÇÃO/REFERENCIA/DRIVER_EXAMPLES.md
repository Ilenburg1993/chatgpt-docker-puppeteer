**Exemplos e Playbook — NERV → Driver**

Este arquivo traz exemplos concretos de envelopes (NERV) trocados entre Kernel/NERV e Drivers, além
de um playbook de recuperação automática para o caso `TARGET_CLOSED`.

---

Estrutura de envelope (convencional):

- `actor`: origem (kernel, driver, server)
- `messageType`: `command` | `event` | `telemetry`
- `actionCode`: identificador da ação (ver `src/core/constants`)
- `correlationId`: UUID de correlação da transação
- `target`: destino lógico (driver id, kernel)
- `payload`: conteúdo específico da ação

---

1. Comando: executar tarefa no driver

```json
{
  "actor": "kernel",
  "messageType": "command",
  "actionCode": "DRIVER_EXECUTE_TASK",
  "correlationId": "550e8400-e29b-41d4-a716-446655440000",
  "target": "driver:page-42",
  "payload": {
    "taskId": "task-123",
    "spec": { "text": "Resuma o artigo X", "timeoutMs": 120000 },
    "pageId": "page-42"
  }
}
```

2. Evento: driver iniciou execução

```json
{
  "actor": "driver",
  "messageType": "event",
  "actionCode": "DRIVER_TASK_STARTED",
  "correlationId": "550e8400-e29b-41d4-a716-446655440000",
  "target": "kernel",
  "payload": { "taskId": "task-123", "driverState": "TYPING" }
}
```

3. Evento: driver completou com sucesso

```json
{
  "actor": "driver",
  "messageType": "event",
  "actionCode": "DRIVER_TASK_COMPLETED",
  "correlationId": "550e8400-e29b-41d4-a716-446655440000",
  "target": "kernel",
  "payload": { "taskId": "task-123", "result": { "success": true, "output": "..." } }
}
```

4. Evento: driver falhou (exemplo `TARGET_CLOSED`)

```json
{
  "actor": "driver",
  "messageType": "event",
  "actionCode": "DRIVER_TASK_FAILED",
  "correlationId": "550e8400-e29b-41d4-a716-446655440000",
  "target": "kernel",
  "payload": {
    "taskId": "task-123",
    "error": { "code": "TARGET_CLOSED", "message": "Page was closed", "history": [] }
  }
}
```

5. Telemetria vital (canal desacoplado)

```json
{
  "actor": "driver",
  "messageType": "telemetry",
  "actionCode": "DRIVER_VITAL",
  "correlationId": "550e8400-e29b-41d4-a716-446655440000",
  "target": "telemetry",
  "payload": { "type": "TRIAGE_ALERT", "severity": "MEDIUM", "evidence": {} }
}
```

---

Playbook automático de recuperação (Kernel) — cenário `TARGET_CLOSED`

Objetivo: recuperar automaticamente quando um driver perde a página (ex.: crash do navegador),
minimizando retrabalho e notificando operadores apenas se a recuperação falhar.

Passos (alto nível):

1. Detecção

- Ouvir envelopes com `actionCode == DRIVER_TASK_FAILED` e `payload.error.code == 'TARGET_CLOSED'`.

2. Contenção imediata

- Log + marcar `driver` como `DEGRADED`/`DESTROYED` no registro de drivers.
- Se ainda houver referência, chamar `await driver.destroy()` com `catch()` silencioso.

3. Invalidação de cache

- `factory.invalidatePageCache(pageId)` — garante que a nova aquisição cria nova `page`.

4. Tentativa controlada de recuperação

- Tentar re-adquirir driver via `factory.getDriver(pageId)` com backoff exponencial (ex.: 3
  tentativas: 1s, 2s, 4s).
- Se obtiver driver novo: marcar tarefa como `PENDING`/requeue e re-disparar execução.

5. Escalação/Failover

- Se as tentativas esgotarem, marcar a tarefa `FAILED` com `reason: driver_unavailable`.
- Emitir incidente via Telemetry/Alerting (ex.: `telemetry.emit('incident', {...})`) para ação
  humana.

6. Observabilidade

- Incluir `correlationId` em todos os passos e contagens de tentativa em métricas
  (`driver_recover_attempts`).

Trecho de pseudocódigo (node.js) — handler simplificado:

```javascript
nerv.on('envelope', async (env) => {
  if (env.actionCode !== 'DRIVER_TASK_FAILED') return;
  const err = env.payload?.error;
  if (!err || err.code !== 'TARGET_CLOSED') return;

  const { taskId, pageId } = env.payload;
  const drv = driverManager.getByPageId(pageId);
  if (drv) await drv.destroy().catch(() => {});
  factory.invalidatePageCache(pageId);

  let attempt = 0;
  while (attempt < 3) {
    try {
      const newDriver = await factory.getDriver({ pageId });
      if (newDriver) {
        kernel.requeueTask(taskId, { reason: 'recovered_driver' });
        return;
      }
    } catch (e) {
      await sleep(1000 * Math.pow(2, attempt));
      attempt++;
    }
  }

  // Escalação
  kernel.failTask(taskId, { reason: 'driver_unavailable', details: err });
  telemetry.emit('incident', {
    correlationId: env.correlationId,
    taskId,
    pageId,
    attempts: attempt,
  });
});
```

Observações operacionais e configuração

- Colocar essa rotina em `KernelNERVBridge` ou um pequeno service dentro do Kernel (ex.:
  `driverRecoveryService`).
- Deixar `autoRecovery.enabled = true|false` em `config.json` e expor thresholds (`maxAttempts`,
  `baseBackoffMs`).

---

Próximos passos recomendados

- Implementar handler de recuperação como módulo testável e adicionar testes unitários (mock
  factory + mock driver).
- Adicionar métricas (`driver_recover_attempts`, `driver_recover_success`) e dashboards.
