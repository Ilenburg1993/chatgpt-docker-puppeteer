# Auditoria Exploratória de Bugs — Bug Hunt

**Versão**: 4.0  
**Data inicial**: 2026-03-01 | **Atualizado**: 2026-03-01 (Rodada 4)  
**Auditor**: Copilot SWE Agent (exploratory-bug-hunt v2.0 skill)  
**Escopo total**: `src/kernel/`, `src/agent/`, `src/nerv/`, `src/driver/`, `src/infra/`, `src/orchestrator/`, `src/server/`, `src/missions/`, `src/shared/`, `src/integration/`, `src/audit_agent/`, `src/inference_gateway/`, `src/logic/`, `src/validation/`, `src/core/`, `src/types/`, `scripts/`, `src/dashboard-ui/`  
**Perfil**: `deep`  
**Arquivos cobertos**: ~140 arquivos lidos em 4 rodadas; grep em ~135 arquivos JS/MJS de `src/` + `scripts/` + `src/dashboard-ui/`.  
**PR associada**: `copilot/audit-code-and-improvements`

---

## Resumo Executivo

Foram encontrados e registrados achados confirmados em 3 rodadas de auditoria.

**Rodada 1** — `src/kernel/`, `src/agent/`, `src/infra/`, `src/orchestrator/`:  
10 achados, 7 corrigidos (incluindo 2 Críticos).

**Rodada 2** — `src/server/`, `src/driver/modules/`, `src/shared/`, `src/infra/queue/`:  
10 achados, 10 corrigidos (incluindo 1 Crítico e 4 Altos).

**Rodada 3** — `src/integration/`, `src/audit_agent/`, `src/inference_gateway/`, `src/logic/`, `src/validation/`, `src/core/`, `src/types/`, `scripts/` + varredura de codebase completa:  
15 achados, 15 corrigidos.

**Rodada 4** — `src/dashboard-ui/`, `src/server/api/controllers/`, `src/server/realtime/bus/`, `ecosystem.config.cjs`, `.github/workflows/copilot-setup-steps.yml`:  
8 achados, 8 corrigidos (incluindo 2 segurança, 2 memory leaks, 1 TODO implementado, 3 PM2).

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

### Rodada 3

| ID   | Severidade | Arquivo                                                              | Status     |
|------|-----------|----------------------------------------------------------------------|------------|
| C001 | CRÍTICO   | `src/validation/llm_judge.js`                                        | ✅ Corrigido |
| C002 | ALTO      | `src/integration/mcp/upstream-stdio.mjs`                            | ✅ Corrigido |
| C003 | MÉDIO     | `src/nerv/health/health.js`                                          | ✅ Corrigido (C9) |
| C004 | MÉDIO     | `src/agent/mission_runner.js`                                        | ✅ Corrigido (C9) |
| C005 | MÉDIO     | `src/agent/queue_worker.js`                                          | ✅ Corrigido (C9) |
| C006 | MÉDIO     | `src/logic/adaptive.js`                                              | ✅ Corrigido (C9) |
| C007 | MÉDIO     | `src/missions/workflow_generator.js`                                 | ✅ Corrigido (C9) |
| C008 | MÉDIO     | `src/infra/queue/task_loader.js` (3 locais)                          | ✅ Corrigido (C9) |
| C009 | MÉDIO     | `src/infra/storage/dna_store.js`                                     | ✅ Corrigido (C9) |
| C010 | MÉDIO     | `src/core/i18n.js`                                                   | ✅ Corrigido (C9) |
| C011 | MÉDIO     | `src/core/schemas/migrator_v4_to_v5.js` (2 locais)                  | ✅ Corrigido (C9) |
| C012 | BAIXO     | `src/driver/modules/` (frame_navigator, handle_manager, input_resolver, recovery_system, submission_controller, triage) | ✅ Corrigido (C6 — parseInt radix) |
| C013 | BAIXO     | `src/infra/ConnectionOrchestrator.js`, `src/infra/io.js`, `src/server/api/controllers/tasks.js`, `src/server/api/router.js` | ✅ Corrigido (C6) |
| C014 | BAIXO     | `scripts/ops/status_fila.js`, `scripts/ops/flow_manager.js`, `scripts/validate_config.js`, `scripts/gerador_tarefa.js`, `scripts/importar_prompts.js`, `scripts/fixes/fix-unused-vars.js` | ✅ Corrigido (C6) |
| S001 | MÉDIO     | `.github/workflows/copilot-setup-steps.yml`                          | ✅ Corrigido (C7) |

### Rodada 4

| ID   | Severidade | Arquivo                                                              | Status     |
|------|-----------|----------------------------------------------------------------------|------------|
| D001 | ALTO      | `src/dashboard-ui/src/composables/useNotifications.js`              | ✅ Corrigido |
| D002 | ALTO      | `src/server/api/controllers/dashboard.js` (auth brute force)         | ✅ Corrigido |
| D003 | MÉDIO     | `src/server/realtime/bus/pm2_bridge.js` (MANAGED_PROCESSES)          | ✅ Corrigido |
| D004 | MÉDIO     | `src/server/api/controllers/metrics.js` (getTaskMetrics 501)         | ✅ Implementado |
| D005 | MÉDIO     | `src/server/api/router.js` (getTaskMetrics não roteado)               | ✅ Corrigido |
| D006 | BAIXO     | `ecosystem.config.cjs` (dashboard-web sem autorestart/min_uptime)    | ✅ Corrigido |
| D007 | BAIXO     | `ecosystem.config.cjs` (chrome-proxy sem exp_backoff)                | ✅ Corrigido |
| D008 | MÉDIO     | `.github/workflows/copilot-setup-steps.yml` (bootstrap incompleto)  | ✅ Reescrito v2.0 |

---

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

## Rodada 3 — Achados Detalhados

### C001 — CRÍTICO | llm_judge._callLLM: timeout timer não cancelado após Promise.race()

**Arquivo**: `src/validation/llm_judge.js:316`

**Problema**: Timer de timeout criado dentro de `new Promise((_, reject) => { timeoutId = setTimeout(...) })`.
Quando `responsePromise` resolvia antes do timeout, o `timeoutId` ficava ativo por até `this.timeout` ms
(padrão 15 s), acumulando em chamadas concorrentes.

**Correção**: Adicionado bloco `try/finally { clearTimeout(timeoutId) }` em torno do `Promise.race()`.

---

### C002 — ALTO | upstream-stdio.stop(): timer de kill nunca cancelado

**Arquivo**: `src/integration/mcp/upstream-stdio.mjs:327`

**Problema**: `setTimeout` de kill de emergência (5 s) criado dentro de `new Promise(resolve => ...)`.
Quando o processo filho saía antes do prazo, o timer disparava, logava mensagem falsa e chamava
`.kill('SIGTERM')` em referência potencialmente nula.

**Correção**: `killTimeoutId` salvo; `clearTimeout(killTimeoutId)` chamado após `Promise.race()`.

---

### C003–C011 — MÉDIO | JSON.parse(JSON.stringify(x)) como clone (C9 — Performance)

**Arquivos**: `src/nerv/health/health.js`, `src/agent/mission_runner.js`, `src/agent/queue_worker.js`,
`src/logic/adaptive.js`, `src/missions/workflow_generator.js`, `src/infra/queue/task_loader.js` (3×),
`src/infra/storage/dna_store.js`, `src/core/i18n.js`, `src/core/schemas/migrator_v4_to_v5.js` (2×).

**Problema**: `JSON.parse(JSON.stringify(obj))` é uma forma de deep clone lenta, que serializa para
string e deserializa. Para objetos JS simples (sem funções/símbolos), `structuredClone()` é nativo no
Node.js 17+ e ~3-10× mais rápido.

**Correção**: Todas as 11 ocorrências substituídas por `structuredClone(obj)`.

---

### C012–C014 — BAIXO | parseInt() sem radix 10 (C6 — Parsing)

**Arquivos (42 ocorrências)**:
- `src/driver/modules/` (6 arquivos)
- `src/infra/ConnectionOrchestrator.js`, `src/infra/io.js`
- `src/server/api/controllers/tasks.js`, `src/server/api/router.js`
- `scripts/ops/`, `scripts/validate_config.js`, `scripts/gerador_tarefa.js`, `scripts/importar_prompts.js`, `scripts/fixes/fix-unused-vars.js`

**Problema**: `parseInt(str)` sem radix pode ter comportamento ambíguo com strings prefixadas com `0x`
ou `0` em engines legadas. Viola a ESLint rule `radix`. Embora Node.js 24 trate como base 10 por padrão,
a declaração explícita do radix é uma best practice de clareza e portabilidade.

**Correção**: `, 10` adicionado a todas as chamadas (exceto onde radix já estava presente).

---

### S001 — MÉDIO | copilot-setup-steps.yml sem permissions explícito

**Arquivo**: `.github/workflows/copilot-setup-steps.yml` (criado nesta rodada)

**Problema**: Job sem `permissions` declarado herda permissões padrão do repositório, que podem ser
permissivas. Boas práticas do GitHub Actions exigem least-privilege explícito.

**Correção**: `permissions: contents: read` adicionado ao job.

---

## O que ficou fora do escopo desta auditoria (3 rodadas)

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

## O que ficou fora do escopo desta auditoria (3 rodadas)

- `src/dashboard-ui/` (frontend — não auditado)
- `tests/` (não auditados como fonte de bugs, mas sem regressões introduzidas)
- `src/nerv/correlation/correlation_store.js`: `setInterval` sem `clearInterval` no export — intencional via `.unref()` (design choice)

---

## Impacto nos Testes

Antes das 3 rodadas e após todas as correções: **755 pass / 12 fail** (789 total).
Os 12 testes que falham são pré-existentes (integrações externas: SQLite fixtures, shell scripts, NSS checks).
Nenhuma regressão introduzida pelas correções de qualquer rodada.

---

## Sumário de Segurança

- CodeQL: 0 alertas em todas as rodadas
- Sem secrets hardcoded encontrados
- Sem SQL injection, path traversal ou dados sensíveis expostos em logs
- Bugs corrigidos eliminam: crash paths (null dereference), resource leaks (handles PM2, timers, async),
  dados incorretos para clientes (Promise bruta, HTTP 200 indevido), e clones lentos (JSON.parse/stringify)
- **Rodada 4**: Auth rate limiting dedicado adicionado ao login (20 req/15min vs 100/min geral)
- **Rodada 4**: MANAGED_PROCESSES dinâmico no pm2_bridge garante que processos opcionais (audit-agent, inference-gateway, ollama-host-supervisor) sejam monitorados quando ENABLE_AUDIT_AGENT_PM2_PROCESSES=true

---

## Próximos Passos (Backlog)

1. **A007** — Integrar `resilient_lock` cleanup com graceful shutdown coordinator.
2. **A008** — Adicionar TTL ou sweep periódico em `activeExecutions` para detecção de órfãos.
3. Expandir auditoria para `src/dashboard-ui/` (bundle size, accessibility, coverage tests).
4. Expandir auditoria para `tests/` (identificar testes quebrados ou com cobertura insuficiente).
5. Implementar `persistToDisk` em MemoryStore ou remover a opção.

---

## Achados — Rodada 4

### D001 — ALTO | useNotifications: timers setTimeout não rastreados

**Arquivo**: `src/dashboard-ui/src/composables/useNotifications.js`

**Problema**: `addNotification()` criava `setTimeout` sem armazenar o `timerId`. `removeNotification()`
e `clearAll()` não tinham como cancelar os timers pendentes. Se `clearAll()` fosse chamado antes do
timer disparar, o timer dispararia em background tentando remover itens que já tinham sido removidos.

**Correção**: Adicionado `Map<string, TimerID> notifTimers` como singleton. `addNotification()` registra
o timer. `removeNotification()` cancela o timer antes de remover do array. `clearAll()` cancela todos
os timers pendentes e limpa o Map.

---

### D002 — ALTO | dashboard.js: login sem rate limiting dedicado

**Arquivo**: `src/server/api/controllers/dashboard.js`

**Problema**: O endpoint `POST /api/dashboard/auth/login` herdava apenas o `apiLimiter` geral
(100 req/min em produção), insuficiente para proteção contra brute force de credenciais.

**Correção**: Adicionado `authLimiter` dedicado com janela de 15 minutos, limite de 20 tentativas
por IP, e `skipSuccessfulRequests: true`. Aplicado diretamente na rota de login.

---

### D003 — MÉDIO | pm2_bridge: MANAGED_PROCESSES não inclui processos opcionais

**Arquivo**: `src/server/realtime/bus/pm2_bridge.js`

**Problema**: `MANAGED_PROCESSES` era uma lista estática `['agente-gpt', 'dashboard-web', 'chrome-proxy']`.
Quando `ENABLE_AUDIT_AGENT_PM2_PROCESSES=true`, os processos `audit-agent`, `inference-gateway` e
`ollama-host-supervisor` eram ignorados pelo PM2 Bridge — seus eventos não chegavam ao Dashboard.

**Correção**: `MANAGED_PROCESSES` agora é calculado dinamicamente incluindo `OPTIONAL_PROCESSES` quando
a variável de ambiente está ativa. `CORE_PROCESSES` e `OPTIONAL_PROCESSES` são exportados separadamente
para diagnóstico.

---

### D004 e D005 — MÉDIO | metrics.js: getTaskMetrics retornava 501 + não estava roteado

**Arquivos**: `src/server/api/controllers/metrics.js`, `src/server/api/router.js`

**Problema**: `getTaskMetrics` estava exportado mas retornava `501 Not Implemented` e não estava
roteado no router (nenhum `app.get('/api/metrics/tasks', ...)` existia).

**Correção**: Implementado `getTaskMetrics()` real usando `countTasks()` do `task_repo` com
`Promise.all` para contar tasks por cada status de forma eficiente. Adicionada rota
`GET /api/metrics/tasks` no router.

---

### D006 e D007 — BAIXO | ecosystem.config.cjs: campos PM2 inconsistentes entre processos

**Arquivo**: `ecosystem.config.cjs`

**Problema**: `dashboard-web` não tinha `exp_backoff_restart_delay`, `min_uptime` nem `autorestart`.
`chrome-proxy` não tinha `exp_backoff_restart_delay`. `agente-gpt` não tinha `min_uptime` nem `autorestart`.
Isso causava comportamento de restart inconsistente entre processos em caso de crash.

**Correção**: Todos os três processos principais agora têm campos uniformes:
`autorestart: true`, `exp_backoff_restart_delay: 100`, `min_uptime: '10s'`.

---

### D008 — MÉDIO | copilot-setup-steps.yml: bootstrap incompleto

**Arquivo**: `.github/workflows/copilot-setup-steps.yml`

**Problema**: v1 do workflow tinha apenas 7 steps com `--ignore-scripts` (quebrando módulos nativos),
sem checkout, sem PM2 global, sem build do dashboard-ui, sem GH CLI, sem ferramentas Python, com timeout
de apenas 15 minutos.

**Correção**: Reescrito como v2.0 com 11 steps completos: checkout, Node.js 24, system tools
(correspondendo ao Dockerfile), Python/build-essential para node-gyp, GH CLI, `npm ci` com scripts
nativos, PM2 global, TypeScript toolchain, build do dashboard-ui, Git config, e environment summary
detalhado. Timeout aumentado para 59 minutos (máximo permitido pela plataforma).

