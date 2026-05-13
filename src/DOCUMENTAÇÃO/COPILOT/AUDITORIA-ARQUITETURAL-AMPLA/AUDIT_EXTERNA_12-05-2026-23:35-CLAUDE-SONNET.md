# Auditoria Arquitetural — `src/copilot/agent/`
**Data:** 2026-05-12
**Escopo:** `src/copilot/agent/**` (107 arquivos, ~18 000 linhas)
**SDK de referência:** `@github/copilot-sdk` 0.3.0
**Contexto arquitetural:** migração barrel-first 2.1 (em andamento em `presentation/`, ainda não iniciada em `agent/`)
**Projeto:** `Ilenburg1993/chatgpt-docker-puppeteer`

---

## 0) Síntese Executiva

O módulo `agent/` é o domínio operacional central do projeto: mantém sessão SDK, loop de diálogo, fila de mensagens, lifecycle do `AlwaysAliveAgent` e todas as suas dependências externas. Após múltiplas ondas de decomposição (F35–F70+), o módulo apresenta arquitetura fisicamente madura em suas subpastas (`dialog/`, `lifecycle/`, `session/`, `facades/`, `ports/`, `runtime/`), mas conserva **três classes de problemas de natureza distinta**:

1. **Bugs operacionais** — falhas concretas de comportamento em runtime, algumas críticas (P0/P1), localizadas principalmente no pipeline de boot, no shutdown do dialog loop e na gestão de estado persistido.
2. **Gaps de compatibilidade com SDK 0.3.0** — uso de APIs depreciadas ou ausência de APIs obrigatórias introduzidas na versão 0.3.0, detectados em `session-setup.js`, `always-alive.js` e `runtime-contracts.js`.
3. **Déficit arquitetural vs. estratégia 2.1** — o módulo ainda opera sob o modelo de barrel plano que a estratégia 2.1 já eliminou em `presentation/`. O `index.js` raiz usa `export *` irrestrito, não existe governança de superfície pública e os imports cruzados entre subdomínios não passam por barrels.

A seção §7 propõe um roadmap de 5 ondas para alinhar `agent/` à estratégia 2.1.

---

## 1) Bugs Críticos — P0

### P0-1 · `forceDeactivate()` deixa turns pendentes em hang eterno

**Arquivo:** `src/copilot/agent/dialog/orchestrators/loop-manager.js`

```js
forceDeactivate() {
    this.#state.deactivate();
    this.#endLoopSpan(false);
    this.#turnQueue.reset();          // ← reseta geração e zera depth
    this.#watchdogSupervisor.clear();
    this.emit('stopped', { reason: 'force_deactivate', authorized: false });
    this.emit(EMITTER_LOOP_CHANGED, { active: false, ... });
}
```

**Problema:** `TurnQueue.reset()` redefine o mutex interno e incrementa `#gen`, mas as Promises já enfileiradas por `sendTurn()` continuam esperando `EMITTER_LOOP_REPLY`, `EMITTER_LOOP_READY` ou `EMITTER_LOOP_STOPPED`. O evento `'stopped'` emitido a seguir é recebido pelo `onStopOuter` em `turn-result-persistence.js`, que por sua vez chama `waitForRestartAndReplyFn(msg, timeout, reason)` — mas como o loop está desativado, o `EMITTER_LOOP_READY` nunca chega. Se `timeout` for `null` (padrão), o turn fica suspenso indefinidamente até o processo ser encerrado.

**Correção:**
```js
forceDeactivate() {
    this.#state.deactivate();
    this.#endLoopSpan(false);
    // Rejeitar turns pendentes ANTES de emitir 'stopped'
    // para que onStopOuter receba authorized: true e rejeite
    // sem tentar restart.
    this.#turnQueue.reset();
    this.#watchdogSupervisor.clear();
    // authorized: true sinaliza ao onStopOuter que não deve
    // chamar waitForRestartAndReplyFn
    this.emit('stopped', { reason: 'force_deactivate', authorized: true });
    this.emit(EMITTER_LOOP_CHANGED, { active: false, ts: Date.now(), reason: 'force_deactivate' });
}
```

Alternativamente, introduzir um canal de rejeição direto em `TurnQueue.reset()` que rejeite todas as Promises em voo com `SessionError('DIALOG_FORCE_DEACTIVATE')`.

---

### P0-2 · `toolSessionContext` inicializado duas vezes no construtor de `AgentContext`

**Arquivo:** `src/copilot/agent/agent-context.js`

```js
export class AgentContext {
    // …
    /** @type {import('#copilot/sdk').ToolSessionContext} */
    toolSessionContext = createToolSessionContext();          // ← 1ª criação (field initializer)

    // …
    constructor(emitter, options = {}) {
        // …
        this.toolSessionContext = createToolSessionContext();  // ← 2ª criação (construtor)
    }
}
```

**Problema:** Dois contextos de ferramenta são criados e o primeiro é imediatamente descartado. Se `createToolSessionContext()` alocar recursos (handles, listeners, subscriptions), há vazamento. O SDK 0.3.0 pode registrar o `ToolSessionContext` em estruturas globais na criação, tornando o leak observável.

**Correção:** Remover o field initializer ou o assignment no construtor (manter apenas um):
```js
toolSessionContext; // sem initializer
constructor(emitter, options = {}) {
    // …
    this.toolSessionContext = createToolSessionContext();
}
```

---

### P0-3 · Top-level `await` em módulo crítico bloqueia toda a árvore de imports

**Arquivo:** `src/copilot/agent/session/initializers/initializer.js`

```js
// F51: Carrega configuração persistida de ferramentas (assíncrono).
await loadAgentSdkToolsConfigAsync();
```

**Problema:** Este `await` no nível de módulo ES faz com que **qualquer importador** de `initializer.js` (inclusive `session/index.js`, `agent/index.js`, e qualquer rota HTTP que importe `#copilot/agent`) precise aguardar a carga da configuração de ferramentas antes de executar qualquer código. Se `loadAgentSdkToolsConfigAsync()` falhar ou demorar (timeout de rede, arquivo corrompido), toda a inicialização do servidor trava sem possibilidade de recuperação parcial.

**Correção:** Mover a carga para dentro de `initOrResumeSession()` com cache de módulo:
```js
let _toolsConfigLoaded = false;

export async function initOrResumeSession(client, sessionOptions) {
    if (!_toolsConfigLoaded) {
        await loadAgentSdkToolsConfigAsync();
        _toolsConfigLoaded = true;
    }
    // …
}
```

---

### P0-4 · `clearState()` durante `writeStateAsync()` em voo pode resultar em state fantasma

**Arquivo:** `src/copilot/agent/lifecycle/state/state-io.js`

O comentário do código reconhece o Bug 1 com o `_clearGen` counter. O problema persiste: `_doWriteState` faz `await readStateAsync()` e depois `await writeStateFileJson(next)`. Se `clearState()` for chamado entre esses dois awaits, `_clearGen` incrementa, e o guard final `if (_clearGen === genAtStart)` impede a atualização do cache — mas a escrita em disco (`writeStateFileJson`) **já foi executada**. O arquivo `sdk-always-alive.json` conterá dados do estado anterior ao clear.

```js
async function _doWriteState(updates) {
    const genAtStart = _clearGen;
    const current = (await readStateAsync()) ?? _defaultState();   // ← await 1
    const next = { ...current, ...updates };
    await writeStateFileJson(next);                                // ← await 2: já escreve no disco
    if (_clearGen === genAtStart) {                                // ← só protege o cache
        _stateCache = next;
    }
    return next;
}
```

**Correção:** Verificar `_clearGen` antes da escrita em disco:
```js
async function _doWriteState(updates) {
    const genAtStart = _clearGen;
    const current = (await readStateAsync()) ?? _defaultState();
    if (_clearGen !== genAtStart) return _defaultState(); // clearState() durante leitura
    const next = { ...current, ...updates };
    if (_clearGen !== genAtStart) return _defaultState(); // clearState() após leitura
    await writeStateFileJson(next);
    if (_clearGen === genAtStart) {
        _stateCache = next;
    }
    return next;
}
```

---

## 2) Bugs de Alta Severidade — P1

### P1-1 · Setters de `AgentContext` não tratam `undefined`

**Arquivo:** `src/copilot/agent/agent-context.js`

```js
set client(value) {
    if (value === null) {        // ← undefined passa aqui
        this.clearClient();
        return;
    }
    this.setClient(value);      // ← setClient(undefined) chama ioState.client = undefined
}
```

O mesmo padrão ocorre nos setters `session`, `pendingQuestion`, `metricsTimer`, `mcpReconnectCancel`, `agentObserver` e `quotaMonitor`. Quando algum caller passa `undefined` inadvertidamente (erro de tipagem JS, resultado de função opcional), o valor `undefined` é escrito no estado interno e pode causar `TypeError` em checagens posteriores do tipo `if (this.ioState.client !== null)`.

**Correção:** Tratar `undefined` como `null` nos setters:
```js
set client(value) {
    if (value == null) {  // == captura null e undefined
        this.clearClient();
        return;
    }
    this.setClient(value);
}
```

---

### P1-2 · `AgentContext.startKeepalive` usa propriedade direta em vez de método semântico

**Arquivo:** `src/copilot/agent/agent-context.js`

```js
startKeepalive(options = {}) {
    if (this.status === 'stopped' || !this.hasActiveSession()) {  // ← this.status diretamente
```

Toda a API de `AgentContext` foi projetada para encapsular o estado via métodos semânticos (`isStopped()`, `isIdle()`, etc.), mas esta checagem acessa `this.status` — que dispara o getter que acessa `this.runtimeState.status`. Além da inconsistência estilística, se o FSM for refatorado para um objeto separado, esta linha não será coberta pela busca `this.isStopped()`.

**Correção:**
```js
if (this.isStopped() || !this.hasActiveSession()) {
```

---

### P1-3 · `DialogBootCircuit.recordSuccess()` nunca é chamado no fluxo normal

**Arquivo:** `src/copilot/agent/dialog/boot/loop-boot-runner.js` e `loop-manager.js`

Em `runDialogLoopBoot()`:
```js
input.bootCircuit.recordSuccess();  // ← chamado corretamente aqui
```

Em `DialogLoopManager.start()`:
```js
try {
    await runDialogLoopBoot({ …, bootCircuit: this.#bootCircuit, … });
} catch (err) {
    this.#state.deactivate();
    this.#endLoopSpan(false);
    this.#watchdogSupervisor.clear();
    this.emit(EMITTER_LOOP_CHANGED, …);
    this.#bootCircuit.recordFailure();   // ← duplo registro de falha
    throw err;
}
```

`runDialogLoopBoot` já chama `bootCircuit.recordFailure()` internamente via `markBootFailed()` antes de lançar. Depois, `loop-manager.js` chama `recordFailure()` novamente no catch externo. Isso **dobra o contador de falhas**, fazendo o circuit breaker disparar com metade das falhas configuradas.

**Correção:** Remover o `this.#bootCircuit.recordFailure()` do `catch` externo em `loop-manager.js`, pois já foi registrado em `runDialogLoopBoot`.

---

### P1-4 · `waitForRestartAndReply` não cancela listeners ao receber `EMITTER_LOOP_STOPPED` com `authorized: true`

**Arquivo:** `src/copilot/agent/dialog/executors/turn-executor.js`

```js
const onRetryStopped = (rawEvt) => {
    const stoppedEvt = normalizeStopEvent(rawEvt);
    settleReject(new SessionError(
        `[DialogLoopManager] stopped durante retry (${stoppedEvt?.reason ?? 'unknown'})`,
        'DIALOG_STOPPED_DURING_RETRY',
    ));
};
```

O listener `onRetryReply` é registrado com `emitter.once(EMITTER_LOOP_REPLY, onRetryReply)`, mas `onRetryStopped` não remove `onRetryReply` antes de rejeitar. Se ambos `EMITTER_LOOP_REPLY` e `EMITTER_LOOP_STOPPED` forem emitidos (cenário de race entre `stop()` e reply), o `onRetryReply` ficará registrado como listener órfão até que o EventEmitter seja GC'd ou o processo encerre.

**Correção:** Adicionar cleanup explícito no `onRetryStopped`:
```js
const onRetryStopped = (rawEvt) => {
    if (onRetryReply) emitter.off(EMITTER_LOOP_REPLY, onRetryReply);
    const stoppedEvt = normalizeStopEvent(rawEvt);
    settleReject(new SessionError(…));
};
```

---

### P1-5 · `AgentContext.STATUS_TRANSITIONS` permite violação silenciosa — FSM não é enforced

**Arquivo:** `src/copilot/agent/agent-context.js`

```js
setStatus(status, emitter) {
    if (this.status === status) return;
    const allowed = AgentContext.STATUS_TRANSITIONS[this.status];
    if (allowed && !allowed.has(status)) {
        log('WARN', `[AgentContext] Transição de status inválida: ${this.status} → ${status}`);
    }
    this.status = status;  // ← transição aplicada mesmo sendo inválida
```

O FSM registrado em `STATUS_TRANSITIONS` não é enforced — serve apenas para logging. Transições inválidas como `stopped → processing` ou `waiting_for_input → starting` são aplicadas silenciosamente após o log. Em produção, isso pode corromper o estado do agente sem nenhuma exceção observável.

**Correção proposta:** Lançar em ambiente de desenvolvimento, ou pelo menos impedir a transição:
```js
setStatus(status, emitter) {
    if (this.status === status) return;
    const allowed = AgentContext.STATUS_TRANSITIONS[this.status];
    if (allowed && !allowed.has(status)) {
        const msg = `[AgentContext] Transição de status inválida: ${this.status} → ${status}`;
        log('ERROR', msg);
        if (process.env.NODE_ENV !== 'production') {
            throw new Error(msg);
        }
        return; // em produção: ignorar transição inválida é mais seguro que aplicar
    }
    this.status = status;
    this.invalidateStatusSnapshot();
    emitter.emit(EMITTER_STATUS, status);
}
```

---

### P1-6 · `reconnect-policy.js` não reseta `ctx.isReconnecting` quando `shouldAbort()` retorna `true` no meio do loop

**Arquivo:** `src/copilot/agent/lifecycle/orchestrators/agent-lifecycle.js`

```js
export async function agentTryReconnect(ctx, host, originalError, opts = {}) {
    // …
    ctx.setReconnectState(true);
    try {
        return await tryReconnect(…);
    } finally {
        ctx.setReconnectState(false);  // ← correto
    }
}
```

O `finally` garante o reset, mas dentro de `tryReconnect` (em `reconnect-policy.js`) há:
```js
if (shouldAbort?.()) {
    log('INFO', '[AlwaysAlive] Reconexão abortada: host em shutdown.');
    return false;
}
```

Quando `shouldAbort()` retorna `true` e `tryReconnect` retorna `false`, o `finally` de `agentTryReconnect` corretamente reseta `isReconnecting`. Isso está **correto**. Porém, o problema surge se a função `tryReconnect` for chamada diretamente sem o wrapper (por testes ou módulos internos), sem o `finally` envoltório — nesse caso, `isReconnecting` ficará como `true` permanentemente.

**Recomendação:** Adicionar documentação explícita que `tryReconnect` não gerencia `isReconnecting` e que o caller é responsável pelo cleanup. Ou mover o gerenciamento de `isReconnecting` para dentro de `tryReconnect` para encapsulamento completo.

---

### P1-7 · `SessionKeepalive.#tick` não rearmará se `performKeepalive` lançar exceção não capturada

**Arquivo:** `src/copilot/agent/session/lifecycle/keepalive.js`

```js
async #tick(callbacks) {
    if (this.#tickInFlight) return;
    this.#tickInFlight = true;
    try {
        // …
        const keepaliveResult = await withAgentErrorPolicy(() => performKeepalive(), { … });
        // …
    } finally {
        this.#tickInFlight = false;
    }
}
```

`withAgentErrorPolicy` captura erros internamente e retorna `{ ok: false }`, então exceções de `performKeepalive` estão cobertas. Porém, as checagens anteriores (e.g., `isDialogLoopActive()`, `isIdle()`) **não estão** dentro de `withAgentErrorPolicy`. Se `callbacks.isDialogLoopActive()` ou `callbacks.isIdle()` lançarem (TypeErrors por runtime inesperado), a exceção escapa do `try/finally`, mas o `finally` garante `#tickInFlight = false`. O `setInterval` continuará chamando `#tick` normalmente. **Isso está correto** — mas falta log do erro inesperado para diagnóstico.

**Recomendação:** Envolver o body completo do `#tick` em try/catch para logar exceções inesperadas:
```js
async #tick(callbacks) {
    if (this.#tickInFlight) return;
    this.#tickInFlight = true;
    try {
        // … body …
    } catch (e) {
        log('WARN', `[SessionKeepalive] tick inesperado: ${toError(e).message}`);
    } finally {
        this.#tickInFlight = false;
    }
}
```

---

### P1-8 · `boot-dialog-recovery.js` — recovery timer não é cancelável após `agent.stop()`

**Arquivo:** `src/copilot/agent/session/boot/boot-dialog-recovery.js`

```js
export function scheduleDialogBootRecovery(ctx) {
    const bootRecoveryTimer = setTimeout(() => {
        if (ctx.getStatus() === 'stopped') return;  // ← guarda único
        void ctx.trackBackgroundTask(runDialogBootRecovery(ctx), { … });
    }, BOOT_RECOVERY_DELAY_MS);
    bootRecoveryTimer.unref?.();
    registerTimer('agent.dialogBootRecovery', 'timeout', bootRecoveryTimer);
}
```

O timer é registrado em `registerTimer` (o que permite cancelamento), mas o cancel não é chamado em `agentStop()` ou `teardownRuntimeSidecars()`. Se o agente for parado dentro da janela de `BOOT_RECOVERY_DELAY_MS`, o timer dispara, o guarda `ctx.getStatus() === 'stopped'` é verificado antes de `trackBackgroundTask`, mas a checagem posterior dentro de `runDialogBootRecovery` também existe. O problema real é que o timer retém uma referência ao `ctx`, impedindo GC mesmo após stop.

**Correção:** Retornar o cancel function e incorporá-la no teardown:
```js
export function scheduleDialogBootRecovery(ctx) {
    const timer = setTimeout(…, BOOT_RECOVERY_DELAY_MS);
    timer.unref?.();
    return () => clearTimeout(timer);  // ← cancel function
}
```

E em `boot-wiring.js`, adicionar o cancel ao `state.unsubs`.

---

## 3) Bugs de Média Severidade — P2

### P2-1 · `isBootTimeoutError` usa match de string frágil

**Arquivo:** `src/copilot/agent/dialog/boot/loop-boot-runner.js`

```js
export function isBootTimeoutError(error) {
    const message = typeof candidate?.message === 'string' ? candidate.message : String(error);
    return candidate?.code === 'DIALOG_TIMEOUT' || message.includes('Boot timeout');
}
```

`'Boot timeout'` é uma substring que pode colidir com mensagens de outros sistemas. Se a mensagem for internacionalizada futuramente ou o texto mudar, silencia falhas reais de boot.

**Correção:** Usar apenas o código de erro canônico:
```js
return candidate?.code === 'DIALOG_TIMEOUT'
    || candidate?.code === 'DIALOG_BOOT_TIMEOUT'; // adicionar código específico
```

---

### P2-2 · `MessageQueue.drain()` copia erros de forma desnecessariamente agressiva

**Arquivo:** `src/copilot/agent/infra/message-queue.js`

```js
if (err instanceof Error && tasks.length > 1) {
    taskErr = Object.assign(…);
}
```

A condição `tasks.length > 1` é avaliada **fora** do loop — não cresce nem diminui. Para um array de 5 elementos, **todos** os 5 recebem cópias do erro, inclusive o último, que poderia receber a instância original. O comentário sugere que a intenção era copiar para todos exceto o último, mas o resultado é copiar para todos. Isso é correto defensivamente, mas ineficiente e a lógica é confusa.

**Correção com semântica mais clara:**
```js
for (let i = 0; i < tasks.length; i++) {
    const task = tasks[i];
    const taskErr = i < tasks.length - 1
        ? Object.assign(new Error(err.message), err, { stack: err.stack })
        : err;  // último task recebe instância original
    task.reject(taskErr);
}
```

---

### P2-3 · `AgentContext.setStatus` e `setRuntimeStatus` — dual API propensa a confusão

**Arquivo:** `src/copilot/agent/agent-context.js`

Existem dois métodos:
- `setRuntimeStatus(status)` — atualiza estado sem emitir evento
- `setStatus(status, emitter)` — atualiza estado E emite `EMITTER_STATUS`

O setter `set status(value)` chama `setRuntimeStatus` (sem evento). Isso significa que qualquer código que faça `ctx.status = 'idle'` nunca emite `EMITTER_STATUS`. A API pública do `AlwaysAliveAgent` usa `setStatus(status, emitter)` corretamente, mas módulos internos que usam o setter diretamente (como tests ou código legado) silenciam eventos.

**Recomendação:** Deprecar o setter `set status(value)` e tornar `setRuntimeStatus` privado (`#setRuntimeStatus`), forçando uso de `setStatus(status, emitter)` ou `setRuntimeStatus` apenas para atualizações que deliberadamente não emitem eventos (uso interno do FSM).

---

### P2-4 · `hook-context.js` — leitura de `BRIEFING_FILE` não limita concorrência

**Arquivo:** `src/copilot/agent/session/context/hook-context.js`

```js
const fileStat = await stat(BRIEFING_FILE);
let content;
if (fileStat.size > SEC02_READ_LIMIT) {
    const fh = await open(BRIEFING_FILE, 'r');
    const buf = Buffer.alloc(SEC02_READ_LIMIT);
    await fh.read(buf, 0, SEC02_READ_LIMIT, 0);
    await fh.close();
    // …
} else {
    content = await readFile(BRIEFING_FILE, 'utf8');
}
```

Se `buildHookSystemContextSafe()` for chamada concorrentemente (múltiplos boots simultâneos, testes de carga), múltiplos file handles serão abertos para o mesmo arquivo. Em ambientes com limite de descritores (Docker com `ulimit`), isso pode causar `EMFILE`.

**Correção:** Implementar mutex simples para `buildHookSystemContext`:
```js
let _buildContextPromise = null;
export async function buildHookSystemContextSafe() {
    if (_buildContextPromise) return _buildContextPromise;
    _buildContextPromise = buildHookSystemContext().finally(() => { _buildContextPromise = null; });
    return _buildContextPromise;
}
```

---

### P2-5 · `sanitizeBriefingContent` — regex não cobre todas as sequências de escape ANSI

**Arquivo:** `src/copilot/agent/session/context/hook-context.js`

```js
.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')
```

Esta regex cobre sequences `CSI` padrão (`ESC[`), mas não cobre:
- Sequences `OSC` (`ESC]`): usadas em hyperlinks de terminal
- Sequences `DCS` (`ESC P`): Device Control Strings
- Sequences `ST` (`ESC \`)

Um `session-briefing.md` malicioso ou corrompido que contenha essas sequences poderia fazer o modelo ver artefatos ou delimitadores inesperados.

**Correção:**
```js
// Remover todos os escape sequences ANSI/VT100 de forma abrangente
.replace(/\x1b(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~]|\][^\x07\x1b]*(?:\x07|\x1b\\))/g, '')
```

---

### P2-6 · `AgentContext.getQueueSnapshot()` expõe o objeto `oldest` por referência

**Arquivo:** `src/copilot/agent/agent-context.js`

```js
getQueueSnapshot() {
    return {
        size: this.messageQueue.size,
        oldest: this.messageQueue.oldest,  // ← referência à AgentTask viva
    };
}
```

`AgentTask` contém `resolve` e `reject` (callbacks de Promise). Expor por referência permite que consumers externos resolvam ou rejeitem tasks da fila, violando o encapsulamento. `buildStatusSnapshot` usa `queueOldest` para calcular `oldestTaskWaitMs` — só precisa de `enqueuedAt`.

**Correção:**
```js
getQueueSnapshot() {
    const oldest = this.messageQueue.oldest;
    return {
        size: this.messageQueue.size,
        oldest: oldest ? { id: oldest.id, enqueuedAt: oldest.enqueuedAt } : undefined,
    };
}
```

---

### P2-7 · `pruneSnapshotFilesAsync` — race condition em ambientes multi-processo

**Arquivo:** `src/copilot/agent/session/state/snapshot-store.js`

```js
export async function pruneSnapshotFilesAsync(keep = MAX_SNAPSHOTS) {
    const snapshots = await listSnapshotFilesAsync();
    if (snapshots.length <= keep) return 0;
    const toRemove = snapshots.slice(keep);
    // … rm em loop
}
```

Em ambiente com múltiplos workers (PM2 com `instances > 1`), dois processos podem listar, ver `length > keep`, e ambos tentarem remover os mesmos arquivos. `rm({ force: true })` torna isso idempotente, mas a contagem retornada `removed` será incorreta (ambos contarão o mesmo arquivo).

**Recomendação:** Usar arquivo de lock (`snapshots/.prune.lock`) ou tolerar a imprecisão documentando a limitação.

---

### P2-8 · `DialogLoopManager.stop()` — shutdown timer pode não ser limpo se `drainPromise` já tiver resolvido antes do `Promise.race`

**Arquivo:** `src/copilot/agent/dialog/orchestrators/loop-manager.js`

```js
void drainPromise.finally(() => {
    if (shutdownTimer !== null) clearTimeout(shutdownTimer);
});
try {
    await Promise.race([drainPromise, new Promise((resolve) => {
        shutdownTimer = setTimeout(() => {
            timedOut = true;
            this.forceDeactivate();
            resolve(undefined);
        }, shutdownTimeoutMs);
    })]);
} finally {
    if (shutdownTimer !== null) {
        clearTimeout(shutdownTimer);
    }
}
```

Se `drainPromise` já estava resolvida (fila estava vazia), `drainPromise.finally()` dispara **antes** de `shutdownTimer` ser criado (pois a criação do timer está dentro do `new Promise(...)` do race). `drainPromise.finally` então tenta `clearTimeout(null)` — inofensivo mas inútil. O `Promise.race` resolve imediatamente com o drain. O `finally` externo limpa `shutdownTimer` se não-null. **Não há bug real aqui**, mas a lógica é complexa e difícil de auditar.

**Recomendação:** Simplificar usando AbortController:
```js
const ac = new AbortController();
const timeoutHandle = setTimeout(() => { timedOut = true; this.forceDeactivate(); ac.abort(); }, shutdownTimeoutMs);
try {
    await drainPromise;
} catch { /* drain rejeitou ou foi abortado */ } finally {
    clearTimeout(timeoutHandle);
}
```

---

## 4) Observações de Baixa Severidade — P3

### P3-1 · `BackgroundTasks.#maxPending = 1000` pode acumular silenciosamente

O limite de 1000 tarefas em background é extremamente alto para um único agente. O log de warning é emitido ao ultrapassar, mas não há telemetria diferenciada. Recomenda-se reduzir para 200 e adicionar métricas de nível de backlog.

---

### P3-2 · `agent/index.js` reexporta `export * from './dialog/index.js'` sem restrição

Qualquer símbolo adicionado a `dialog/index.js` torna-se automaticamente parte da API pública do módulo `agent`. Isso viola o princípio de superfície explícita da estratégia 2.1.

---

### P3-3 · `alwaysAliveAgent` (Proxy) recalcula `getAgent()` em cada acesso de propriedade

```js
export const alwaysAliveAgent = new Proxy({}, {
    get(_target, prop) {
        const agent = getAgent();  // ← instanciação + registro a cada get
        const value = Reflect.get(agent, prop, agent);
        // …
    }
});
```

`getAgent()` chama `registerAgentRuntime` e `ensureAgentEventBusBridge` em toda operação de get de propriedade. Ambas têm guards de idempotência, mas ainda executam verificações e chamadas de função em cada acesso. Em hot paths como `agent.status` chamado em loop de polling, isso acumula overhead.

**Correção:** Cachear a instância no Proxy após a primeira resolução:
```js
let _cachedAgentForProxy = null;
export const alwaysAliveAgent = new Proxy({}, {
    get(_target, prop) {
        if (!_cachedAgentForProxy) _cachedAgentForProxy = getAgent();
        // mas invalidar cache quando resetAgent() for chamado
        const value = Reflect.get(_cachedAgentForProxy, prop, _cachedAgentForProxy);
        // …
    }
});
```

E `resetAgent()` deve zerar `_cachedAgentForProxy = null`.

---

### P3-4 · `hook-context.js` lê `BRIEFING_FILE` e `SESSION_JSON_FILE` a cada chamada

Ambos os arquivos são lidos em todo `buildHookSystemContext()` sem cache. Para cada boot de sessão e cada reconexão, há 2–4 operações de I/O de filesystem. Em containers com volume NFS (comum em DevContainers WSL2), isso pode ser lento.

**Recomendação:** Adicionar cache com TTL de 30s para o conteúdo do briefing.

---

### P3-5 · `SessionMessagesCache` sem limite de memória para items individuais

```js
this.#cache = messages.length > this.#maxItems ? messages.slice(-this.#maxItems) : messages;
```

O limite é em número de mensagens (padrão 1000), mas cada mensagem pode ser grande (especialmente em sessões com attachments ou código gerado). 1000 mensagens de 10KB = 10MB de cache em memória.

**Recomendação:** Adicionar limite em bytes além do limite em contagem.

---

### P3-6 · `AgentPermissionController` sem snapshot de auditoria quando `mode = 'audit_only'`

O modo `'audit_only'` aprova tudo mas deveria logar cada decisão. A implementação atual delega ao `PermissionController` do SDK, mas não há log observável no `agent/` layer para modo `audit_only`. O audit trail está em `#copilot/audit` mas não há ponte explícita.

---

### P3-7 · `normalizeAgentError` em `error-policy.js` usa duck-typing frágil

```js
function normalizeAgentError(error) {
    if (typeof toError === 'function') return toError(error);
    return error instanceof Error ? error : new Error(String(error));
}
```

`if (typeof toError === 'function')` sempre será verdadeiro após o import — essa guarda é desnecessária e confusa. Provavelmente um remanescente de refatoração.

---

## 5) Gaps de Compatibilidade com SDK 0.3.0

### SDK-1 · `setModel` vs `switchModel` — API depreciada

**Arquivo:** `src/copilot/agent/runtime-contracts.js`

```js
const maybeSetModel = Reflect.get(session, 'setModel');
if (typeof maybeSetModel !== 'function') return false;
const maybeResult = setSessionModel(session, modelId, …);
```

O SDK 0.3.0 introduziu `session.switchModel()` como substituto de `session.setModel()`. A API `setModel` pode estar depreciada ou ausente em 0.3.0. A função `setSessionModel` em `#copilot/sdk` presumivelmente já faz o fallback correto, mas o Reflect.get verificando `'setModel'` pode falhar se a propriedade foi removida do tipo público.

**Verificação necessária:** Confirmar se `setSessionModel` do barrel `#copilot/sdk` já usa `switchModel` internamente. Se não, atualizar:
```js
// SDK 0.3.0: preferir switchModel
const switchFn = Reflect.get(session, 'switchModel') ?? Reflect.get(session, 'setModel');
if (typeof switchFn !== 'function') return false;
```

---

### SDK-2 · `systemMessage` — verificar compatibilidade com modo `"customize"` do SDK 0.3.0

**Arquivo:** `src/copilot/agent/session/initializers/initializer.js`

O código usa `buildLiveSystemMessage()` da `config/system-prompt/`. O SDK 0.3.0 introduziu `systemMessage.mode: "customize"` para injeção de contexto sem substituir o system prompt base do Copilot. A implementação atual pode estar usando o modo padrão (`"override"` ou equivalente), o que sobrescreveria o system prompt do Copilot ao invés de complementá-lo.

**Verificação necessária:** Confirmar que `SessionConfigBuilder.systemMessage()` usa `mode: "customize"` em 0.3.0:
```js
builder.systemMessage({
    mode: 'customize',   // SDK 0.3.0
    sections: { guidelines: hookContext }
});
```

---

### SDK-3 · `Symbol.asyncDispose` — Node.js 22+ apenas

**Arquivo:** `src/copilot/agent/always-alive.js`

```js
async [Symbol.asyncDispose]() {
    await this.stop();
}
[Symbol.dispose]() {
    this.stop().catch((e) => logSwallowed(e, 'AlwaysAliveAgent.Symbol.dispose'));
}
```

`Symbol.asyncDispose` é Stage 4 e está disponível nativa no Node.js 22+. Em Node.js 20 (LTS), pode não estar disponível sem flag. O `devcontainer.json` do projeto deve especificar `node >= 22` se este padrão for usado sem polyfill.

**Recomendação:** Adicionar guarda:
```js
if (Symbol.asyncDispose) {
    AlwaysAliveAgent.prototype[Symbol.asyncDispose] = async function() { await this.stop(); };
}
```

---

### SDK-4 · `onPermissionRequest` — verificar se é obrigatório em 0.3.0

**Arquivo:** `src/copilot/agent/lifecycle/setup/session-setup.js`

```js
builder.onPermissionRequest(getPermissionHandler(ctx))
```

O SDK 0.2.0 tornou `onPermissionRequest` obrigatório. Em 0.3.0, verificar se a assinatura mudou para aceitar também `onPermissionRequest: async (req) => ({ kind: 'approve', message: '...' })` no formato estendido.

---

### SDK-5 · `createQueuedElicitationHandler` — sem timeout para elicitations pendentes

**Arquivo:** `src/copilot/agent/ports/hook-port.js` / `context-factories.js`

O handler de elicitation criado não implementa timeout automático. Em SDK 0.3.0, elicitations pendentes sem resposta após um período podem causar memory leak (entradas acumuladas em `listPending`). Adicionar cleanup periódico:

```js
const MAX_ELICITATION_AGE_MS = 5 * 60 * 1000;
// No METRICS_INTERVAL_MS tick:
// queued.listPending().filter(e => Date.now() - e.createdAt > MAX_ELICITATION_AGE_MS)
//   .forEach(e => queued.clearPending(e.id, { action: 'cancel' }));
```

---

### SDK-6 · `performBootWiring` não subscreve `session.plan_changed`

**Arquivo:** `src/copilot/agent/session/wiring/event-wirer.js`

O README de `agent/` menciona que eventos vanilla como `session.plan_changed` devem ser consumidos via `sdk/`. Nenhum dos handlers em `event-handlers/` ou em `event-wirer.js` registra listener para `session.plan_changed`. Se o SDK 0.3.0 emitir este evento, ele cairá no `wireCatchAll` sem processamento semântico.

---

## 6) Análise Arquitetural — Déficit vs. Estratégia 2.1

A estratégia barrel-first 2.1, já aplicada em `presentation/`, define:

> "módulos de fora **podem** depender, mas **somente via superfícies públicas explícitas**"

O módulo `agent/` ainda não implementa esta estratégia. O diagnóstico abaixo mapeia o estado atual vs. o target.

### 6.1 Barrel Raiz Plano (`agent/index.js`)

**Estado atual:**
```js
export * from './dialog/index.js';        // ← reexporta TUDO de dialog/
export * from './health-check.js';
export * from './infra/index.js';
export * from './lifecycle/index.js';
export * from './messaging/index.js';
export * from './session/index.js';
export * from './state/index.js';
```

Qualquer símbolo adicionado a qualquer subdomínio vira automaticamente API pública de `#copilot/agent`. Não há como distinguir API pública de detalhe interno.

**Target 2.1:**
```js
// agent/index.js — barrel puro com exports explícitos
export { AlwaysAliveAgent, alwaysAliveAgent, getAgent, resetAgent } from './always-alive.js';
export { classifyAgentError } from './error-policy.js';
export * from './runtime-registry.js';

// Sub-superfícies por subdomínio (sem export *)
export type { AgentStatus, AgentStatusSnapshot, IAlwaysAliveAgent } from './types.js';
```

### 6.2 Ausência de Superfícies Explícitas no `package.json`

Em `presentation/`, o `package.json` declara:
```json
"#copilot/presentation": "src/copilot/presentation/index.js",
"#copilot/presentation/agent": "src/copilot/presentation/agent/index.js",
"#copilot/presentation/routing": "…"
```

Para `agent/`, não existe equivalente para sub-domínios. Imports externos que precisam de `dialog/` ou `lifecycle/` são forçados a importar pelo barrel raiz ou fazer deep imports diretos — nenhum dos dois é governado.

**Target:**
```json
"#copilot/agent": "src/copilot/agent/index.js",
"#copilot/agent/dialog": "src/copilot/agent/dialog/index.js",
"#copilot/agent/lifecycle": "src/copilot/agent/lifecycle/index.js",
"#copilot/agent/session": "src/copilot/agent/session/index.js",
"#copilot/agent/facades": "src/copilot/agent/facades/index.js"
```

### 6.3 Deep Imports em `always-alive.js` e `agent-runtime-surface.js`

`always-alive.js` importa de `agent-runtime-surface.js`, que por sua vez reexporta de ~12 módulos diferentes em subdomínios distintos. Isso cria um hub de importação que é semanticamente opaco: o reader de `always-alive.js` precisa seguir dois níveis de indireção para entender de onde vem cada função.

**Target 2.1:** `always-alive.js` deveria importar exclusivamente de `facades/index.js` (que já existe) e de arquivos raiz (`agent-context.js`, `agent-runtime-surface.js`). O `agent-runtime-surface.js` deveria ser eliminado ou transformado em alias barrel de `facades/`.

### 6.4 Hotspots que Justificam Decomposição Própria

Análogos ao `agent-control.js` em `presentation/` (1663 linhas), o `agent/` tem:

| Arquivo              | Linhas | Desvio                                                               |
| -------------------- | ------ | -------------------------------------------------------------------- |
| `agent-context.js`   | ~1050  | Mistura estado, API semântica, FSM e helpers                         |
| `always-alive.js`    | ~800   | Fachada pública mas ainda orquestra alguns concerns                  |
| `loop-manager.js`    | ~560   | Orquestrador bem estruturado, mas start/stop/resume cada vez maiores |
| `agent-lifecycle.js` | ~490   | Lifecycle correto mas `wireAgentSessionRuntime` tem >100 linhas      |
| `agent-messaging.js` | ~480   | Bem estruturado, `executeTask` pode ser extraído                     |

**Decomposição recomendada para `AgentContext`:**
```
agent/context/
  index.js              # barrel
  agent-context.js      # classe core (estado + FSM)
  context-api.js        # API semântica (métodos de leitura/escrita)
  context-managers.js   # Boundary API (dialogLoop, keepalive, webhooks)
  context-factories.js  # (já existe, mover para cá)
```

### 6.5 Imports Cruzados sem Governança

```
lifecycle/orchestrators/agent-lifecycle.js
  → facades/agent-runtime-state.js       ✓ (via façade)
  → session/boot/boot-wiring.js          ✓ (via session/)
  → session/initializers/initializer.js  ✓
  → ports/logging-port.js                ✓

session/boot/boot-wiring.js
  → facades/agent-sdk-access.js          ✓
  → error-policy.js                      ✗ (cross-domain: session/ → root)
  → ports/logging-port.js                ✓
```

`error-policy.js` é importado diretamente por módulos de `session/`, `dialog/`, `lifecycle/` e `messaging/`. Deveria estar em `ports/` ou ser exposto via um barrel de `agent/core/` próprio.

---

## 7) Roadmap de Correção e Migração

### Onda AG-1 — Correções Críticas (P0/P1) · Sprint imediato

| #      | Ação                                                                 | Arquivo            |
| ------ | -------------------------------------------------------------------- | ------------------ |
| AG-1.1 | Corrigir `forceDeactivate()` para authorized=true                    | `loop-manager.js`  |
| AG-1.2 | Remover dupla inicialização de `toolSessionContext`                  | `agent-context.js` |
| AG-1.3 | Mover `await loadAgentSdkToolsConfigAsync()` para lazy init          | `initializer.js`   |
| AG-1.4 | Corrigir `_doWriteState` para verificar `_clearGen` antes da escrita | `state-io.js`      |
| AG-1.5 | Corrigir duplo `recordFailure()` em `loop-manager.js` catch          | `loop-manager.js`  |
| AG-1.6 | Corrigir setters de `AgentContext` para tratar `undefined`           | `agent-context.js` |
| AG-1.7 | Cleanup de listeners órfãos em `waitForRestartAndReply`              | `turn-executor.js` |

### Onda AG-2 — Hardening e SDK 0.3.0 · Sprint seguinte

| #      | Ação                                                         | Arquivo                   |
| ------ | ------------------------------------------------------------ | ------------------------- |
| AG-2.1 | Verificar e migrar `setModel` → `switchModel` para SDK 0.3.0 | `runtime-contracts.js`    |
| AG-2.2 | Confirmar `systemMessage.mode: "customize"` em SDK 0.3.0     | `initializer.js`          |
| AG-2.3 | Adicionar guarda Node.js para `Symbol.asyncDispose`          | `always-alive.js`         |
| AG-2.4 | Adicionar timeout de GC para elicitations pendentes          | `context-factories.js`    |
| AG-2.5 | Subscrever `session.plan_changed` em `event-wirer.js`        | `event-wirer.js`          |
| AG-2.6 | Refatorar FSM `setStatus` para enforced em dev               | `agent-context.js`        |
| AG-2.7 | Adicionar cancel function ao `scheduleDialogBootRecovery`    | `boot-dialog-recovery.js` |
| AG-2.8 | Corrigir `isBootTimeoutError` para usar apenas código        | `loop-boot-runner.js`     |

### Onda AG-3 — Barrel-First PBF-1 (taxonomia física) · Próxima sprint

Análogo à Onda PBF-1 de `presentation/`, mas adaptado ao perfil de `agent/`:

```
agent/
  index.js              # barrel puro — exports explícitos apenas
  always-alive.js       # fachada principal (sem mudança)
  agent-runtime-surface.js → ABSORVER por facades/index.js

  context/              # NOVO subdomínio
    index.js
    agent-context.js    # mover de raiz
    context-api.js      # extrair métodos semânticos
    context-managers.js # extrair Boundary API
    context-factories.js # mover de raiz

  dialog/               # JÁ EXISTE — normalizar barrel
  lifecycle/            # JÁ EXISTE — normalizar barrel
  session/              # JÁ EXISTE — normalizar barrel
  facades/              # JÁ EXISTE — tornar canonical
  ports/                # JÁ EXISTE — normalizar barrel
  runtime/              # JÁ EXISTE — normalizar barrel
  state/                # JÁ EXISTE — normalizar barrel
  messaging/            # JÁ EXISTE — normalizar barrel
  infra/                # JÁ EXISTE — normalizar barrel
```

### Onda AG-4 — Superfícies Explícitas no `package.json`

```json
"#copilot/agent": "src/copilot/agent/index.js",
"#copilot/agent/context": "src/copilot/agent/context/index.js",
"#copilot/agent/dialog": "src/copilot/agent/dialog/index.js",
"#copilot/agent/lifecycle": "src/copilot/agent/lifecycle/index.js",
"#copilot/agent/session": "src/copilot/agent/session/index.js",
"#copilot/agent/facades": "src/copilot/agent/facades/index.js",
"#copilot/agent/ports": "src/copilot/agent/ports/index.js",
"#copilot/agent/runtime": "src/copilot/agent/runtime/index.js"
```

### Onda AG-5 — Decomposição dos Hotspots

**`AgentContext`** → decomposição por responsabilidade (ver §6.4)
**`agent-lifecycle.js`** → extrair `wireAgentSessionRuntime` para `session/boot/session-runtime-wiring.js`
**`agent-messaging.js`** → extrair `executeTask` para `messaging/task-executor.js`
**`loop-manager.js`** → extrair `resume()` e `stop()` para `dialog/orchestrators/loop-lifecycle.js`

---

## 8) Guardrails Arquiteturais Recomendados

Com base no padrão aplicado em `presentation/` e adaptado ao `agent/`:

```
1. agent/index.js nunca usa export * — apenas exports nomeados explícitos.
2. agent/ não importa de terminal/ nem de server/ nem de presentation/ como fonte de verdade.
3. Imports de presentation/ para agent/ passam exclusivamente por facades/.
4. always-alive.js importa apenas de facades/index.js e de context/ e de ports/.
5. Cada subdomínio (dialog/, lifecycle/, session/, etc.) tem barrel próprio
   e exports explícitos — nenhum usa export * sem filtragem.
6. Arquivos acima de 600 linhas requerem ADR local ou plano de decomposição
   no module-map do subdomínio.
7. error-policy.js migra para ports/error-policy-port.js para tornar-se
   acessível via porta semântica, não por import direto cross-domain.
```

---

## 9) Resumo de Severidade

| Código | Classificação                                           | Quantidade | Impacto                                         |
| ------ | ------------------------------------------------------- | ---------- | ----------------------------------------------- |
| P0     | Crítico — bug em produção confirmado                    | 4          | Hangs, corrupção de estado, falha de boot       |
| P1     | Alto — bug latente de alta probabilidade                | 8          | Vazamento, estado incorreto, reconexão quebrada |
| P2     | Médio — comportamento incorreto em cenários específicos | 8          | Degradação, falha em carga, segurança           |
| P3     | Baixo — qualidade, performance, manutenabilidade        | 7          | Débito técnico acumulado                        |
| SDK    | Gap de compatibilidade com SDK 0.3.0                    | 6          | Falha silenciosa em features novas              |
| ARCH   | Déficit arquitetural vs. estratégia 2.1                 | 5 áreas    | Governança, manutenção, testabilidade           |

**Total de itens identificados: 38**

---

*Relatório gerado a partir de análise manual de 107 arquivos (~18 000 linhas). Nenhuma ferramenta de lint automatizada foi utilizada conforme contrato de auditoria do projeto.*
