# Auditoria Exploratória de Bugs — Bug Hunt

**Versão**: 1.0  
**Data**: 2026-03-01  
**Auditor**: Copilot SWE Agent (exploratory-bug-hunt skill)  
**Escopo**: `src/kernel/`, `src/agent/`, `src/nerv/`, `src/driver/`, `src/infra/`, `src/orchestrator/`  
**Motivo da seleção**: Módulos formam a espinha dorsal do runtime; criticidade sistêmica máxima.  
**Perfil**: `deep`  
**Arquivos cobertos**: ~40 arquivos lidos; grep amplo em ~135 arquivos JS de `src/`.  
**PR associada**: `copilot/audit-code-and-improvements`

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
