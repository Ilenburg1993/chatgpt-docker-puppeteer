# Relatório de Auditoria Exploratória — Bug Hunt

**Versão**: 1.0  
**Data**: 2026-03-01  
**Escopo**: `src/kernel/`, `src/agent/`, `src/nerv/`, `src/driver/`, `src/infra/`,
`src/orchestrator/`  
**Motivo da seleção**: Alta criticidade sistêmica — módulos formam a espinha dorsal do runtime;
churn recente confirmado por changelogs e comentários P0/P1 inline.  
**Perfil**: `deep`  
**Arquivos cobertos**: 40+ arquivos lidos diretamente; grep amplo em ~135 arquivos JS de `src/`.

---

## Resumo Executivo

Foram encontrados **10 achados confirmáveis** (2 Crítico, 3 Alto, 4 Médio, 1 Baixo).  
Os dois achados críticos comprometem mecanismos de proteção do runtime: o circuit breaker do kernel
SSOT nunca dispara, e o loop legacy do kernel pode executar `step()` concorrentemente.  
Ambos necessitam correção antes do próximo ciclo de carga.

---

## Achados

### A001 — CRÍTICO | Circuit breaker do kernel SSOT nunca dispara

**Arquivo**: `src/kernel/kernel.js:167–196` (`createSsotGatewayKernel`)  
**Evidência**:

```js
step()
  .catch(err => {
    consecutiveStepFailures++; // (1) incrementa
    if (consecutiveStepFailures >= MAX_CONSECUTIVE_FAILURES) {
      stop(); // (2) stop — mas...
    }
  })
  .then(() => {
    consecutiveStepFailures = 0; // (3) SEMPRE reseta após .catch()
  });
```

**Problema**: Após `.catch()` tratar o erro, a chain continua para `.then()`, que **sempre** executa
— incluindo após falha. Isso reseta `consecutiveStepFailures = 0` toda vez que `step()` falha,
tornando o circuit breaker inoperante. O comentário diz "Reset contador em caso de sucesso" mas
`.then()` não distingue origem da chain.

**Proposta de correção**:

```js
step()
  .then(() => {
    consecutiveStepFailures = 0;
  }) // reset APENAS em sucesso
  .catch(err => {
    consecutiveStepFailures++;
    // ... telemetria ...
    if (consecutiveStepFailures >= MAX_CONSECUTIVE_FAILURES) {
      stop();
    }
  });
```

---

### A002 — CRÍTICO | KernelLoop.\_scheduleNextTick executa step() concorrentemente

**Arquivo**: `src/kernel/kernel_loop/kernel_loop.js:520–524`  
**Evidência**:

```js
this._timer = this.scheduler.setTimeout(() => {
  this.step(); // async — NÃO aguardado
  this._scheduleNextTick(); // agendado imediatamente, sem esperar step()
}, delay);
```

**Problema**: `this.step()` é uma função `async` chamada sem `await`. O próximo tick é agendado
**antes** do passo atual terminar. Se um ciclo demorar mais que `baseIntervalMs` (50ms), múltiplas
execuções de `step()` podem ser sobrepostas, acessando concorrentemente `nervBridge`,
`executionEngine`, `taskRuntime` e buffers de drenagem — todos com estado compartilhado.

**Proposta de correção**:

```js
this._timer = this.scheduler.setTimeout(async () => {
  await this.step(); // aguarda conclusão
  this._scheduleNextTick(); // agenda APÓS step concluir
}, delay);
```

> **Nota**: `AgentLoop` (src/agent/agent_loop.js) resolve esse padrão corretamente com
> `if (this._running) return;` + flag de mutex. O KernelLoop usa `_running` apenas como flag de
> lifecycle (loop ativo/inativo), não como mutex de ciclo.

---

### A003 — ALTO | sendCommand não aguardado no AttemptWatchdog (erros async silenciosos)

**Arquivo**: `src/agent/attempt_watchdog.js:300–317`  
**Evidência**:

```js
try {
  if (this.nerv) {
    sendCommand(
      // Promise NÃO aguardada
      this.nerv,
      ActorRole.KERNEL,
      ActionCode.DRIVER_ABORT,
      { taskId, reason: 'WATCHDOG_HEARTBEAT_TIMEOUT' },
      attemptId,
      ActorRole.DRIVER
    );
  }
} catch (err) {
  log('WARN', `...`);
}
```

**Problema**: `sendCommand` é uma função `async`. Sem `await`, erros assíncronos não são capturados
pelo `try/catch` local. Falhas de emissão do comando `DRIVER_ABORT` passam silenciosamente, deixando
tarefas em estado RUNNING sem o comando de interrupção ser entregue ao driver.

**Proposta de correção**:

```js
try {
  if (this.nerv) {
    await sendCommand(/* ... */);
  }
} catch (err) {
  log('WARN', `[AttemptWatchdog] DRIVER_ABORT emit falhou para ${taskId}: ...`);
}
```

---

### A004 — ALTO | BrowserPool.release() não limpa pool entry quando page.close() falha

**Arquivo**: `src/infra/browser_pool/pool_manager.js:407–428`  
**Evidência**:

```js
try {
  const monitor = this.lifecycleMonitors.get(taskId);
  if (monitor) {
    monitor.cleanup();
    this.lifecycleMonitors.delete(taskId);
  }

  await page.close(); // pode lançar exceção

  poolEntry.pages.delete(taskId); // NÃO executa se page.close() falhar
  poolEntry.stats.activeTasks = Math.max(0, poolEntry.stats.activeTasks - 1); // idem
} catch (error) {
  log('ERROR', `[BrowserPool] Erro ao liberar página: ${error.message}`);
  // sem cleanup do poolEntry.pages nem stats
}
```

**Problema**: Se `page.close()` lança (comum quando page/browser já crashou), `poolEntry.pages`
retém a referência à página fechada e `activeTasks` não é decrementado. A entrada "fantasma" polui o
pool, impede realocação do slot e causa subcontagem de tasks disponíveis.

**Proposta de correção**:

```js
try {
  await page.close();
} catch (closeErr) {
  log('WARN', `[BrowserPool] page.close() falhou: ${closeErr.message}`);
}
// Limpeza do pool entry é incondicional
poolEntry.pages.delete(taskId);
poolEntry.stats.activeTasks = Math.max(0, poolEntry.stats.activeTasks - 1);
this.stats.totalReleases++;
```

---

### A005 — ALTO | Timer vazando em \_applyDecisions (sem clearTimeout no caminho feliz)

**Arquivo**: `src/kernel/kernel_loop/kernel_loop.js:417–449`  
**Evidência**:

```js
const timeoutPromise = new Promise((_, reject) => {
  setTimeout(() => reject(new Error('Decision application timeout after 5s')), 5000);
  // ⚠ handle do setTimeout NÃO salvo → impossível fazer clearTimeout
});
await Promise.race([decisionsPromise, timeoutPromise]);
```

**Problema**: O timer de 5s é criado em toda chamada a `_applyDecisions` (por tick do kernel, a cada
50ms). Quando `decisionsPromise` resolve antes de 5s (caso normal), o timer continua ativo por até 5
segundos adicionais antes de expirar e chamar `reject` em uma Promise já resolvida. Com o loop a
20Hz e decisões presentes, dezenas de timers pendentes podem coexistir, gerando pressão
desnecessária sobre o GC.

**Proposta de correção**:

```js
let timeoutHandle;
const timeoutPromise = new Promise((_, reject) => {
  timeoutHandle = setTimeout(
    () => reject(new Error('Decision application timeout after 5s')),
    5000
  );
});
try {
  await Promise.race([decisionsPromise, timeoutPromise]);
} finally {
  clearTimeout(timeoutHandle);
}
```

---

### A006 — MÉDIO | Status da tentativa sempre 'FAILED' (ternário sem efeito)

**Arquivo**: `src/agent/queue_worker.js:441–446`  
**Evidência**:

```js
updateAttempt(correlationId, {
  status: retryable ? 'FAILED' : 'FAILED', // ambos os branches idênticos
  ended_at_ms: Date.now(),
  error: msg,
});
```

**Problema**: O ternário avalia `retryable` mas produz `'FAILED'` em ambos os casos. Se o schema de
`task_attempts` prevê um status distinto para tentativas que serão reagendadas (como
`'FAILED_RETRYING'` ou similar), a distinção semântica se perde no banco, dificultando diagnóstico e
dashboards.

**Proposta de correção** (verificar schema antes):

```js
status: retryable ? 'FAILED_RETRYING' : 'FAILED',
```

---

### A007 — MÉDIO | Cleanup assíncrono de locks não é aguardado em SIGINT/SIGTERM

**Arquivo**: `src/infra/locks/resilient_lock.js:91–93, 119–123`  
**Evidência**:

```js
this._cleanupHandlers.sigint = () => cleanup('SIGINT'); // async, resultado descartado
this._cleanupHandlers.sigterm = () => cleanup('SIGTERM');
// ...
process.once('SIGINT', this._cleanupHandlers.sigint);
process.once('SIGTERM', this._cleanupHandlers.sigterm);
```

**Problema**: O handler é uma função síncrona que chama `cleanup()` (assíncrono) e descarta a
Promise. Quando SIGINT/SIGTERM chega, o processo pode encerrar antes que `releaseAll()` complete.
Locks de tarefas em execução ficam não liberados, causando stale locks no próximo boot.

**Proposta de correção**: Dado que signal handlers não podem ser async, o padrão recomendado é
registrar o handler no PM2/graceful-shutdown coordinator e aguardar antes de `process.exit`:

```js
this._cleanupHandlers.sigterm = async () => {
  await cleanup('SIGTERM');
  process.exit(0);
};
```

Ou encadear com o graceful shutdown existente em `src/main.js` que já tem try/await no teardown.

---

### A008 — MÉDIO | activeExecutions vaza entradas para decisões que não são 'DONE'

**Arquivo**: `src/kernel/task_execution_orchestrator.js:388–396`  
**Evidência**:

```js
// Remove do cache se DONE
if (decision?.action === 'DONE') {
  if (typeof this.onTaskCompleted === 'function') {
    await this.onTaskCompleted({ taskId, correlationId, decision });
  }
  this.activeExecutions.delete(taskId);
  this.processedExecutionEvents.delete(taskId);
}
// SEM else: ações NEXT_STEP, ITERATE, etc. NÃO limpam os Maps
```

**Problema**: Para tasks com estratégia `ITERATIVE` ou `MULTI_STEP`, se a decisão pós-execução não
for `'DONE'` e `executeTask()` não for chamado novamente (e.g., falha downstream no re-dispatch), as
entradas em `activeExecutions` e `processedExecutionEvents` persistem indefinidamente. Em runs de
longa duração, isso pode acumular centenas de entradas órfãs.

**Proposta de correção**: Adicionar limpeza explícita para o caso de re-dispatch não ocorrer (via
timeout ou verificação de saúde):

```js
} else {
    // Para ações NEXT_STEP/ITERATE: re-dispatch limpará os Maps via executeTask().
    // Segurança extra: registrar em telemetria para detecção de órfãos.
    this.telemetry?.info?.('orchestrator_non_done_decision', { taskId, action: decision?.action });
}
```

Alternativa mais robusta: adicionar TTL com limpeza periódica das entradas estagnadas.

---

### A009 — MÉDIO | Contexto LLM e persistência de memória não implementados (gaps funcionais)

**Arquivos**:

- `src/orchestrator/context_manager.js:281–282`
- `src/orchestrator/memory_store.js:28, 254`

**Evidência**:

```js
// context_manager.js:282
// TODO: Integrar com LLM para gerar summary
// Por ora, faz summary simples (concatena outputs)

// memory_store.js:28
persistToDisk: options.persistToDisk || false, // Persistir em disk (TODO)

// memory_store.js:254
// TODO: Se persistToDisk=true, salvar patterns em disco
```

**Problema**: `persistToDisk=true` é aceito pelo construtor mas silenciosamente ignorado. Qualquer
consumidor que instancie `MemoryStore({ persistToDisk: true })` terá a falsa impressão de que
padrões estão sendo persistidos. A sumarização de contexto usa concatenação textual no lugar de LLM,
limitando qualidade de workflows multi-step longos.

**Proposta de correção**: Lançar erro explícito ou logar WARN ao instanciar com
`persistToDisk: true` enquanto a feature não é implementada:

```js
if (options.persistToDisk) {
  log('WARN', '[MemoryStore] persistToDisk=true não implementado. Opção ignorada.');
}
```

---

### A010 — BAIXO | Kernel Legacy (\_scheduleNextTick) não aguarda stop antes de reagendar

**Arquivo**: `src/kernel/kernel_loop/kernel_loop.js:513–524`

**Contexto adicional**: Em cenários de race onde `stop()` é chamado durante a execução do callback
do timer (após `this.step()` ser despachado e antes de `_scheduleNextTick()` ser chamado),
`this._running` já é `false`, mas `_scheduleNextTick()` verifica `_running` e retorna imediatamente
— comportamento correto. No entanto, se `stop()` é chamado **dentro** de `step()` (via circuit
breaker do KernelLoop), o timer já foi overwritten com `null` pelo `stop()`. O `_timer` passado ao
`clearTimeout` é o anterior — isso é seguro na maioria dos schedulers.

Documentar este invariante como comentário de código para prevenir regressões futuras.

---

## Priorização

| ID   | Severidade | Módulo                                           | Esforço fix estimado |
| ---- | ---------- | ------------------------------------------------ | -------------------- |
| A001 | CRÍTICO    | kernel/kernel.js                                 | < 5 min              |
| A002 | CRÍTICO    | kernel/kernel_loop.js                            | < 10 min             |
| A003 | ALTO       | agent/attempt_watchdog.js                        | < 5 min              |
| A004 | ALTO       | infra/browser_pool/pool_manager.js               | < 15 min             |
| A005 | ALTO       | kernel/kernel_loop.js                            | < 10 min             |
| A006 | MÉDIO      | agent/queue_worker.js                            | < 5 min              |
| A007 | MÉDIO      | infra/locks/resilient_lock.js                    | 30–60 min            |
| A008 | MÉDIO      | kernel/task_execution_orchestrator.js            | 30 min               |
| A009 | MÉDIO      | orchestrator/context_manager.js, memory_store.js | 10 min (WARN)        |
| A010 | BAIXO      | kernel/kernel_loop.js                            | 5 min (comentário)   |

---

## O que ficou fora do escopo

- `src/server/` (API, realtime, handlers): não coberto nesta rodada.
- `src/missions/` além do `mission_runner.js`: não coberto.
- `src/audit_agent/` e `src/inference_gateway/`: serviços auxiliares, excluídos.
- `src/dashboard-ui/`: frontend, excluído.
- Testes em `tests/`: não auditados nesta rodada.

---

## Próximos passos

1. Corrigir A001 e A002 (CRÍTICO) imediatamente — patches cirúrgicos.
2. Corrigir A003 e A004 (ALTO) no mesmo sprint.
3. Corrigir A005 (ALTO — timer leak) junto com A002 (mesmo arquivo, mesma sessão).
4. Triagem de A006–A009 em backlog de manutenção.
5. Encaminhar A001+A002 para `reactive-bug-audit` com stack trace reproduzível.
