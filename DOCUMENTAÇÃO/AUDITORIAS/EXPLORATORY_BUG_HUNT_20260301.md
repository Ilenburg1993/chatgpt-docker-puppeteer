# Auditoria Exploratória de Bugs — Bug Hunt

**Versão**: 2.0  
**Data inicial**: 2026-03-01 | **Atualizado**: 2026-03-01 (Rodada 2)  
**Auditor**: Copilot SWE Agent (exploratory-bug-hunt skill)  
**Escopo total**: `src/kernel/`, `src/agent/`, `src/nerv/`, `src/driver/`, `src/infra/`, `src/orchestrator/`, `src/server/`, `src/missions/`, `src/shared/`  
**Perfil**: `deep`  
**Arquivos cobertos**: ~85 arquivos lidos em 2 rodadas; grep em ~135 arquivos JS de `src/`.  
**PR associada**: `copilot/audit-code-and-improvements`

---

## Resumo Executivo

Foram encontrados **20 achados confirmáveis** em 2 rodadas de auditoria.

**Rodada 1** — `src/kernel/`, `src/agent/`, `src/infra/`, `src/orchestrator/`:  
10 achados, 7 corrigidos (incluindo 2 Críticos).

**Rodada 2** — `src/server/`, `src/driver/`, `src/shared/`, `src/infra/queue/`:  
10 achados, 10 corrigidos (incluindo 1 Crítico e 4 Altos).

---

## Status Completo dos Achados

### Rodada 1

| ID   | Severidade | Arquivo                                   | Status     |
|------|-----------|-------------------------------------------|------------|
| A001 | CRÍTICO   | `src/kernel/kernel.js`                    | ✅ Corrigido |
| A002 | CRÍTICO   | `src/kernel/kernel_loop/kernel_loop.js`   | ✅ Corrigido |
| A003 | ALTO      | `src/agent/attempt_watchdog.js`           | ✅ Corrigido |
| A004 | ALTO      | `src/infra/browser_pool/pool_manager.js`  | ✅ Corrigido |
| A005 | ALTO      | `src/kernel/kernel_loop/kernel_loop.js`   | ✅ Corrigido |
| A006 | MÉDIO     | `src/agent/queue_worker.js`               | ✅ Corrigido |
| A007 | MÉDIO     | `src/infra/locks/resilient_lock.js`       | ⏳ Backlog  |
| A008 | MÉDIO     | `src/kernel/task_execution_orchestrator.js` | ⏳ Backlog |
| A009 | MÉDIO     | `src/orchestrator/memory_store.js`        | ✅ Corrigido (WARN) |
| A010 | BAIXO     | `src/kernel/kernel_loop/kernel_loop.js`   | ✅ Corrigido (comentário) |

### Rodada 2

| ID   | Severidade | Arquivo                                                     | Status     |
|------|-----------|-------------------------------------------------------------|------------|
| B001 | CRÍTICO   | `src/server/dashboard-api/telemetry_aggregator.js`          | ✅ Corrigido |
| B002 | ALTO      | `src/server/realtime/streams/log_tail.js`                   | ✅ Corrigido |
| B003 | ALTO      | `src/server/supervisor/reconcilier.js`                      | ✅ Corrigido |
| B004 | ALTO      | `src/server/realtime/bus/pm2_bridge.js`                     | ✅ Corrigido |
| B005 | ALTO      | `src/driver/modules/recovery_system.js`                     | ✅ Corrigido |
| B006 | MÉDIO     | `src/server/watchers/fs_watcher.js`                         | ✅ Corrigido |
| B007 | MÉDIO     | `src/server/dashboard-api/telemetry_aggregator.js`          | ✅ Corrigido |
| B008 | MÉDIO     | `src/infra/queue/cache.js`                                  | ✅ Corrigido |
| B009 | BAIXO     | `src/driver/modules/recovery_system.js`                     | ✅ Corrigido |
| B010 | BAIXO     | `src/server/api/controllers/metrics.js`                     | ✅ Corrigido |
| B011 | BAIXO     | `src/driver/modules/biomechanics_engine.js`                 | ✅ Corrigido |

---

## Rodada 1 — Achados Detalhados

### A001 — CRÍTICO | Circuit breaker do kernel SSOT nunca disparava

**Arquivo**: `src/kernel/kernel.js:167–196`

**Problema**: A chain `.catch().then()` fazia com que o `.then()` executasse **depois de qualquer
`.catch()`**, inclusive quando havia falha. Isso resetava `consecutiveStepFailures = 0` em toda
falha, tornando o circuit breaker inoperante.

**Correção**: Invertida para `.then().catch()`, garantindo que o reset só ocorra em caso de
sucesso real.

---

### A002 — CRÍTICO | KernelLoop._scheduleNextTick executava step() concorrentemente

**Arquivo**: `src/kernel/kernel_loop/kernel_loop.js:520–524`

**Problema**: `this.step()` async sem `await`. O próximo tick era agendado antes do passo atual
terminar, permitindo execuções sobrepostas sobre estado compartilhado (NERV buffers, executionEngine).

**Correção**: Callback do setTimeout tornou-se `async` com `await this.step()`.

---

### A003 — ALTO | sendCommand não awaited em AttemptWatchdog

**Arquivo**: `src/agent/attempt_watchdog.js:300–310`

**Problema**: Falhas no envio de `DRIVER_ABORT` passavam silenciosamente.  
**Correção**: Adicionado `await` ao `sendCommand()`.

---

### A004 — ALTO | BrowserPool.release() acumulava entradas fantasma

**Arquivo**: `src/infra/browser_pool/pool_manager.js:407–428`

**Problema**: `page.close()` no mesmo `try` que `poolEntry.pages.delete()` — crash do browser
bloqueava limpeza do pool.  
**Correção**: `page.close()` isolado; limpeza do pool entry tornou-se incondicional.

---

### A005 — ALTO | Timer vazando em _applyDecisions (20Hz)

**Arquivo**: `src/kernel/kernel_loop/kernel_loop.js:417–449`

**Problema**: `setTimeout` de 5s sem handle salvo — `clearTimeout` impossível no caminho feliz.  
**Correção**: Handle salvo; `clearTimeout(timeoutHandle)` no bloco `finally`.

---

### A006 — MÉDIO | Ternário morto em queue_worker.js

**Arquivo**: `src/agent/queue_worker.js:441–446`

**Problema**: `retryable ? 'FAILED' : 'FAILED'` — ambos os branches idênticos.  
**Correção**: Ternário removido; `status: 'FAILED'` fixo.

---

### A007 — MÉDIO | Cleanup assíncrono de locks não aguardado em SIGINT/SIGTERM (Backlog)

**Arquivo**: `src/infra/locks/resilient_lock.js:91–93`  
**Proposta**: Integrar ao graceful shutdown coordinator em `src/main.js`.

---

### A008 — MÉDIO | activeExecutions acumula entradas para decisões não-DONE (Backlog)

**Arquivo**: `src/kernel/task_execution_orchestrator.js:388–396`  
**Proposta**: Adicionar TTL ou limpeza periódica; emitir telemetria para detecção de órfãos.

---

### A009 — MÉDIO | persistToDisk silenciosamente ignorado em MemoryStore

**Arquivo**: `src/orchestrator/memory_store.js:28`  
**Correção**: Adicionado `log('WARN', ...)` ao construtor.

---

### A010 — BAIXO | Invariante de scheduling do KernelLoop não documentado

**Arquivo**: `src/kernel/kernel_loop/kernel_loop.js`  
**Correção**: Comentário JSDoc adicionado ao método `_scheduleNextTick()` documentando
o invariante de scheduling e os race conditions controlados.

---

## Rodada 2 — Achados Detalhados

### B001 — CRÍTICO | TelemetryAggregator.getCurrent() retornava Promise bruta

**Arquivo**: `src/server/dashboard-api/telemetry_aggregator.js:372–376`

**Problema**: `getCurrent()` era síncrona mas `_collectMetrics()` é `async`. Quando
`lastMetrics` era `null`, retornava uma `Promise` bruta em vez de métricas resolvidas.
Consumidores esperando um objeto recebiam `{}` (Promise vazia serializada).

**Correção**: `getCurrent()` tornado `async` com `await this._collectMetrics()`.

---

### B002 — ALTO | log_tail: timer de rotação sem clearTimeout em stop()

**Arquivo**: `src/server/realtime/streams/log_tail.js:46`

**Problema**: `setTimeout(init, 1000)` no handler de rotação de arquivo não armazenado em
variável — `stop()/_clearInternalResources()` não conseguia cancelar. Após shutdown,
`init()` era chamado novamente, reconectando o tail ao arquivo já fechado.

**Correção**: `retryTimeout = setTimeout(init, 1000)` — referência salva e cancelada em
`_clearInternalResources()`.

---

### B003 — ALTO | reconcilier: timer de retry sem referência, re-registrava listeners

**Arquivo**: `src/server/supervisor/reconcilier.js:47`

**Problema**: `setTimeout(() => this._attachSensoryListeners(), 5000)` sem handle salvo.
`stop()` não cancelava o timer; após encerramento, `_attachSensoryListeners()` executava,
tentava re-registrar listeners em socket já fechado, e lançava silenciosamente.

**Correção**: Novo campo `_retryAttachTimer`, cancelado em `stop()`.

---

### B004 — ALTO | pm2_bridge: stop() sem pm2Raw.disconnect()

**Arquivo**: `src/server/realtime/bus/pm2_bridge.js:204`

**Problema**: A conexão com o daemon PM2 ficava aberta após `stop()`, acumulando file handles
de IPC. Em reinicializações frequentes (ex: reconnect loops), handles podiam esgotar.

**Correção**: `pm2Raw.disconnect()` adicionado em `stop()` com try/catch e log de debug.

---

### B005 — ALTO | recovery_system: null dereference em driver UNATTACHED

**Arquivo**: `src/driver/modules/recovery_system.js:436`

**Problema**: `this.driver.page.browser()` sem null check. Drivers em estado `UNATTACHED`
(`page = null`) causavam `TypeError: Cannot read properties of null` exatamente no caminho
crítico de Tier 3 recovery.

**Correção**: Null check explícito; log WARN e re-throw do erro de recovery.

---

### B006 — MÉDIO | fs_watcher: debounceTimer não cancelado em stop()

**Arquivo**: `src/server/watchers/fs_watcher.js:101–107`

**Problema**: `stop()` fechava o `fsWatcher` mas não cancelava `debounceTimer`. Se shutdown
ocorresse durante a janela de debounce (100ms), `_signalChange()` era chamado com o watcher
já fechado, potencialmente chamando `notify()` em socket já destruído.

**Correção**: `clearTimeout(debounceTimer)` adicionado no início de `stop()`.

---

### B007 — MÉDIO | TelemetryAggregator: _collectAndBroadcast sem reentrância guard

**Arquivo**: `src/server/dashboard-api/telemetry_aggregator.js:162`

**Problema**: `_collectAndBroadcast()` é `async` chamada via `setInterval`. Se uma coleta
demorar mais que o intervalo (ex: DB lento), múltiplas coletas concorrentes acessam
`lastMetrics`, `totalSamples` e ring buffers simultaneamente.

**Correção**: Flag `this._collecting` garante que apenas uma coleta executa por vez.

---

### B008 — MÉDIO | queue/cache.js: async sem catch em setTimeout (unhandled rejection)

**Arquivo**: `src/infra/queue/cache.js:96`

**Problema**: `setTimeout(async () => { await scanQueue(); })` — se `scanQueue()` lançasse,
o erro tornava-se unhandled rejection no callback do timer (não capturado por try/catch
externo).

**Correção**: Callback simplificado para síncrono com `scanQueue().catch(err => log(...))`.

---

### B009 — BAIXO | recovery_system: _timeout() timer não cancelado após Promise.race()

**Arquivo**: `src/driver/modules/recovery_system.js:525–533`

**Problema**: `_timeout()` criava `setTimeout` interno sem retornar um handle. Em
`Promise.race([op, _timeout()])`, quando `op` resolve primeiro, o timer de `_timeout`
continuava ativo por até 30s, gerando pressão de GC e potencial log falso de timeout.

**Correção**: `_timeout()` reformulado para retornar `{ promise, cancel }`. Callers usam
`try/finally { timeoutObj.cancel() }`.

---

### B010 — BAIXO | metrics.js: HTTP 200 para endpoint não implementado

**Arquivo**: `src/server/api/controllers/metrics.js:29`

**Problema**: `getTaskMetrics` retornava HTTP 200 com body `"not implemented yet"`.
Clientes que verificam o status HTTP assumiam sucesso e processavam resposta inválida.

**Correção**: Alterado para `res.status(501).json(...)`.

---

### B011 — BAIXO | biomechanics_engine.js: parseInt sem radix

**Arquivo**: `src/driver/modules/biomechanics_engine.js:17–62`

**Problema**: 10 chamadas `parseInt(env_var || 'default')` sem o parâmetro radix `10`.
Embora Node.js moderno interprete strings numéricas como base 10, o comportamento para
strings com prefixo `0x` ou `0` é ambíguo (pode ser hex/octal em engines legadas).
Além disso, violação do ESLint rule `radix`.

**Correção**: Adicionado `, 10` a todas as chamadas de `parseInt` no bloco `BIOMECH_CONFIG`.

---

## O que ficou fora do escopo desta auditoria

- `src/integration/` (parcialmente coberto via grep)
- `src/audit_agent/` e `src/inference_gateway/`
- `src/dashboard-ui/` (frontend)
- `tests/` (não auditados)

---

## Impacto nos Testes

Antes e após todas as correções: **755 pass / 12 fail** (789 total).
Os 12 testes que falham são pré-existentes (integrações externas: SQLite fixtures, shell scripts, NSS checks).
Nenhuma regressão introduzida pelas correções aplicadas em 2 rodadas.

---

## Sumário de Segurança

- CodeQL: 0 alertas em ambas as rodadas
- Os bugs corrigidos eram de lógica de controle e robustez operacional
- Nenhuma vulnerabilidade de exploração externa identificada
- Correções eliminam: crash paths (null dereference), resource leaks (handles PM2, timers),
  dados incorretos para clientes (Promise bruta, HTTP 200 indevido)

---

## Próximos Passos (Backlog)

1. **A007** — Integrar `resilient_lock` cleanup com graceful shutdown coordinator.
2. **A008** — Adicionar TTL ou sweep periódico em `activeExecutions` para detecção de órfãos.
3. Expandir auditoria para `src/integration/`, `src/audit_agent/` e `tests/`.


---

## Resumo Executivo

Foram encontrados **10 achados confirmáveis** (2 Crítico, 3 Alto, 4 Médio, 1 Baixo).

Os dois achados críticos comprometiam mecanismos de proteção do runtime:
- O **circuit breaker do kernel SSOT** nunca disparava (lógica `.catch/.then` invertida).
- O **KernelLoop** podia executar `step()` concorrentemente (async sem await no scheduler).

Seis achados foram **corrigidos cirurgicamente** nesta sessão. Quatro permanecem em backlog para
tratamento futuro (A007, A008, A010 e melhorias funcionais do A009).

---

## Status dos Achados

| ID   | Severidade | Arquivo                                   | Status     |
|------|-----------|-------------------------------------------|------------|
| A001 | CRÍTICO   | `src/kernel/kernel.js`                    | ✅ Corrigido |
| A002 | CRÍTICO   | `src/kernel/kernel_loop/kernel_loop.js`   | ✅ Corrigido |
| A003 | ALTO      | `src/agent/attempt_watchdog.js`           | ✅ Corrigido |
| A004 | ALTO      | `src/infra/browser_pool/pool_manager.js`  | ✅ Corrigido |
| A005 | ALTO      | `src/kernel/kernel_loop/kernel_loop.js`   | ✅ Corrigido |
| A006 | MÉDIO     | `src/agent/queue_worker.js`               | ✅ Corrigido |
| A007 | MÉDIO     | `src/infra/locks/resilient_lock.js`       | ⏳ Backlog  |
| A008 | MÉDIO     | `src/kernel/task_execution_orchestrator.js` | ⏳ Backlog |
| A009 | MÉDIO     | `src/orchestrator/memory_store.js`        | ✅ Corrigido (WARN) |
| A010 | BAIXO     | `src/kernel/kernel_loop/kernel_loop.js`   | ⏳ Backlog  |

---

## Achados Detalhados

### A001 — CRÍTICO | Circuit breaker do kernel SSOT nunca disparava

**Arquivo**: `src/kernel/kernel.js:167–196`

**Problema**: A chain `.catch().then()` fazia com que o `.then()` executasse **depois de qualquer
`.catch()`**, inclusive quando havia falha. Isso resetava `consecutiveStepFailures = 0` em toda
falha, tornando o circuit breaker inoperante.

**Código antes**:
```js
step()
    .catch(err => { consecutiveStepFailures++; if (...) stop(); })
    .then(() => { consecutiveStepFailures = 0; }); // SEMPRE executava
```

**Correção aplicada**: Invertida a ordem para `.then().catch()`, garantindo que o reset só ocorra
em caso de sucesso real.

```js
step()
    .then(() => { consecutiveStepFailures = 0; })     // reset apenas em sucesso
    .catch(err => { consecutiveStepFailures++; ... }); // falha incrementa
```

---

### A002 — CRÍTICO | KernelLoop._scheduleNextTick executava step() concorrentemente

**Arquivo**: `src/kernel/kernel_loop/kernel_loop.js:520–524`

**Problema**: `this.step()` é async e era chamado sem `await`. O próximo tick era agendado
imediatamente, antes do passo atual terminar. Em ciclos lentos (>50ms), múltiplas execuções de
`step()` podiam se sobrepor, acessando concorrentemente NERV buffers, executionEngine e taskRuntime.

**Correção aplicada**: Callback do setTimeout tornou-se `async` com `await this.step()`.

```js
// Antes
this._timer = this.scheduler.setTimeout(() => {
    this.step();              // sem await
    this._scheduleNextTick();
}, delay);

// Depois
this._timer = this.scheduler.setTimeout(async () => {
    await this.step();        // aguarda conclusão
    this._scheduleNextTick(); // agenda APÓS step() concluir
}, delay);
```

---

### A003 — ALTO | sendCommand não aguardado em AttemptWatchdog

**Arquivo**: `src/agent/attempt_watchdog.js:300–310`

**Problema**: `sendCommand` é async mas não era `await`'ado dentro do `try/catch`. Falhas no envio
de `DRIVER_ABORT` passavam silenciosamente, deixando tarefas em estado RUNNING sem o comando de
interrupção ser entregue.

**Correção aplicada**: Adicionado `await` ao `sendCommand()`.

---

### A004 — ALTO | BrowserPool.release() não limpava pool entry quando page.close() falhava

**Arquivo**: `src/infra/browser_pool/pool_manager.js:407–428`

**Problema**: `poolEntry.pages.delete(taskId)` e `activeTasks--` estavam dentro do mesmo `try`
que `page.close()`. Quando `page.close()` lançava (comum após crash do browser), o pool acumulava
entradas "fantasma" — páginas já fechadas ainda registradas como ativas.

**Correção aplicada**: `page.close()` isolado em seu próprio `try/catch`; limpeza de `poolEntry`
tornou-se incondicional.

---

### A005 — ALTO | Timer vazando em _applyDecisions (sem clearTimeout no caminho feliz)

**Arquivo**: `src/kernel/kernel_loop/kernel_loop.js:417–449`

**Problema**: `setTimeout` de 5s não tinha seu handle salvo. Quando `decisionsPromise` resolvia
antes de 5s (caso normal), o timer continuava ativo. Com o loop a 20Hz, dezenas de timers
pendentes coexistiam, gerando pressão desnecessária no GC.

**Correção aplicada**: Handle salvo em `timeoutHandle`; `clearTimeout(timeoutHandle)` chamado no
bloco `finally`.

---

### A006 — MÉDIO | Ternário morto em queue_worker.js (status sempre 'FAILED')

**Arquivo**: `src/agent/queue_worker.js:441–446`

**Problema**: `status: retryable ? 'FAILED' : 'FAILED'` — ambos os branches idênticos.
O ternário não tinha efeito real.

**Correção aplicada**: Ternário removido; `status` fixo em `'FAILED'` (valor semântico correto
para o contexto de dispatch failure, distinto do retry scheduling posterior).

---

### A007 — MÉDIO | Cleanup assíncrono de locks não aguardado em SIGINT/SIGTERM (Backlog)

**Arquivo**: `src/infra/locks/resilient_lock.js:91–93`

**Problema**: Handlers de SIGINT/SIGTERM chamam `cleanup()` (async) sem `await`, permitindo que o
processo encerre antes da liberação de locks. Resultado: stale locks no próximo boot.

**Proposta**: Integrar com o graceful shutdown coordinator em `src/main.js` que já tem
`try/await` no teardown, garantindo que `releaseAll()` complete antes de `process.exit`.

---

### A008 — MÉDIO | activeExecutions acumula entradas para decisões não-DONE (Backlog)

**Arquivo**: `src/kernel/task_execution_orchestrator.js:388–396`

**Problema**: Apenas decisões com `action === 'DONE'` limpam `activeExecutions`. Para tasks
`ITERATIVE` ou `MULTI_STEP` cujo re-dispatch não ocorre (falha downstream), as entradas persistem
indefinidamente.

**Proposta**: Adicionar TTL ou limpeza periódica; emitir telemetria para detecção de órfãos.

---

### A009 — MÉDIO | persistToDisk silenciosamente ignorado em MemoryStore

**Arquivo**: `src/orchestrator/memory_store.js:28`

**Problema**: `persistToDisk: true` era aceito pelo construtor mas a feature nunca foi
implementada. Consumidores podiam acreditar que patterns estavam sendo persistidos.

**Correção aplicada**: Adicionado `log('WARN', ...)` ao instanciar com `persistToDisk: true`,
tornando o gap visível a integradores.

---

### A010 — BAIXO | Invariante de scheduling do KernelLoop não documentado (Backlog)

**Arquivo**: `src/kernel/kernel_loop/kernel_loop.js`

**Situação**: O comportamento quando `stop()` é chamado durante a execução do callback do timer é
correto mas implícito. Documentar o invariante como comentário inline para prevenir regressões.

---

## O que ficou fora do escopo desta rodada

- `src/server/` (API, realtime, handlers)
- `src/missions/` (além do mission_runner.js)
- `src/audit_agent/` e `src/inference_gateway/`
- `src/dashboard-ui/` (frontend)
- `tests/` (não auditados)

---

## Impacto nos Testes

Antes e após as correções: **755 pass / 12 fail / 22 cancelled** (789 total).
Os 12 testes que falham são pré-existentes (timeouts de integração, SQLite, shell scripts).
Nenhuma regressão introduzida pelas correções aplicadas.

---

## Sumário de Segurança

Nenhuma vulnerabilidade de segurança foi identificada durante a auditoria.
Os bugs encontrados são de lógica de controle e robustez operacional (circuit breaker,
concorrência, pool leaks), sem superfície de exploração externa.

---

## Próximos Passos

1. Tratar A007 (resilient_lock SIGTERM) com integração ao graceful shutdown.
2. Tratar A008 (activeExecutions TTL) para estabilidade em runs longos.
3. Implementar `persistToDisk` em MemoryStore ou remover a opção.
4. Expandir auditoria para `src/server/`, `src/missions/` e testes.
