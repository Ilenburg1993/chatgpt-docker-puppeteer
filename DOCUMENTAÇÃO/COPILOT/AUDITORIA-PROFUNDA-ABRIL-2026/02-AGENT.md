# 02-AGENT — Auditoria do Módulo `agent/`

**Auditoria Profunda de `src/copilot`** · Abril 2026 **Módulo**: `src/copilot/agent/`
**Subcomponentes**: `always-alive.js`, `dialog/loop-manager.js`, `session/keepalive.js`,
`lifecycle/agent-lifecycle.js`, `messaging/`, `health-check.js` **Documentado em**: 2026-04-18

---

## 1. Mapa do Módulo

```
agent/
├── always-alive.js              (facade principal — extends EventEmitter, ~280L após O3)
├── agent-context.js             (AgentContext — shared state entre módulos internos)
├── dialog/
│   ├── loop-manager.js          (~630L — orchestrador de turns, watchdog, compaction)
│   ├── turn-executor.js         (execução individual de cada turn)
│   ├── watchdog.js              (DialogWatchdog — detecção de stall)
│   ├── backpressure.js          (TurnQueue — fila serializada com maxSize)
│   ├── protocol.js              (DialogProtocol — boot prompt, respostas padrão)
│   └── model-fallback.js        (ModelFallbackState)
├── lifecycle/
│   ├── agent-lifecycle.js       (agentStart, agentStop, initSession)
│   ├── state-io.js              (readState, writeStateAsync)
│   ├── reconnect-policy.js      (tryReconnect)
│   └── session-setup.js         (buildSessionTools, buildSessionHooks, buildSessionOptions)
├── session/
│   ├── keepalive.js             (SessionKeepalive — heartbeat periódico)
│   ├── initializer.js           (initOrResumeSession)
│   ├── boot-steps.js            (fases de boot da sessão)
│   ├── ownership.js             (syncActiveSessionOwnership)
│   ├── history-sync.js          (syncSdkHistory)
│   └── snapshot.js              (createSnapshot, saveSnapshotAsync)
├── messaging/
│   └── agent-messaging.js       (sendMessage, steerMessage, answerPendingQuestion)
├── facades/
│   ├── agent-model-config.js    (getModel, setModel, reasoningEffort)
│   ├── agent-session-ops.js     (abortCurrentMessage, pingDialogWatchdog)
│   └── agent-webhook-ops.js     (registerWebhook, unregisterWebhook)
└── health-check.js              (getAgentHealthSnapshot)
```

---

## 2. Arquivo: `always-alive.js`

**Função**: Facade principal do agente — instância singleton, extends EventEmitter. **LOC**: ~280
(pós-refactor O3 que extraiu messaging, state, lifecycle)

### Arquitetura

O `AlwaysAliveAgent` foi extensamente refatorado nas fases F35–F39 e O3:

- **F35**: Introdução de `AgentContext` como estado compartilhado
- **F36**: Extração de lifecycle para `agent-lifecycle.js`
- **F38**: Extração de messaging para `agent-messaging.js`
- **F39**: Extração de state para `agent-state.js`
- **O3**: Extração de facades para reduzir LOC da classe

### Achados

| ID               | Sev | Descrição                                                                                                                                                                                                                                                                                                                                |
| ---------------- | --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **GAP-AGENT-01** | P2  | O construtor registra `this.on('__processQueue', ...)` — evento interno usando prefixo `__` sem namespacing via EventBus. Qualquer código externo que acesse a instância do agente pode emitir `__processQueue` acidentalmente ou intencionalmente, causando processamento prematuro da fila. Deveria ser método privado ou usar Symbol. |
| **GAP-AGENT-02** | P3  | `setMaxListeners(MAX_LISTENERS)` com default 50 via env `AGENT_MAX_LISTENERS`. Sem configuração, `MAX_LISTENERS=50`. Se forem adicionados mais de 50 listeners (ex: muitos SSE clients + tasks + bridges), warning do Node.js é suprimido — perde diagnóstico útil de leaks.                                                             |

### Status adicional do hardening (2026-04-17)

- `AgentContext` ganhou helpers semânticos (`invalidateStatusSnapshot`, `incrementSendCount`,
  `setPendingQuestion`, `clearPendingQuestion`) para reduzir mutação crua no hot path;
- `error-policy.js` passou a expor `withAgentErrorPolicy(...)`, já adotado em
  `messaging/agent-messaging.js` e `lifecycle/reconnect-policy.js`;
- `loop-manager.js` e `agent-messaging.js` reduziram bypasses de contrato de host, removendo casts
  quentes para `EventEmitter`;
- `agent/lifecycle/entry.js` e `presentation/agent-control.js` migraram para `getAgent()` como
  caminho canônico do singleton.
- numa segunda onda, a mutation API do `AgentContext` foi ampliada (`setClient`, `clearClient`,
  `setSession`, `clearSession`, `setContextState`, `setLastCheckpointPath`, `setDialogLoopAttached`,
  `setBootReport`), o `session-setup.js` perdeu parte da dívida artificial de tipos e o boot do
  agent passou a produzir `bootReport` por step.
- numa frente dedicada ao `ask_user`, o runtime passou a distinguir pergunta viva do SDK de sombra
  persistida restaurada do disco (`pendingQuestionShadow`), com classificação semântica
  (`ready/reply/stopped/question`) refletida em health, terminal e snapshots.

### Positivos

- Extração em múltiplos módulos reduziu `always-alive.js` de ~638L para ~280L — testabilidade
  melhorada
- `AgentContext` como shared state elimina estado disperso em propriedades da classe
- Multi-token DI (`ALWAYS_ALIVE_AGENT`, `PERMISSION_AGENT`, etc.) intencional e documentado

---

## 3. Arquivo: `dialog/loop-manager.js`

**Função**: Orchestrador central do loop de diálogo — turns, watchdog, compaction, backpressure.
**LOC**: ~630

### Mecanismos Auditados

#### 3.1 Guard Atômico `#resuming` (F42.6 — fix BUG-SD-007)

```js
/** @type {boolean} F42.6 (BUG-SD-007 fix): guard atômico para prevenir interleaving entre resume/start */
#resuming = false;
```

**Avaliação**: Usa booleano simples — em JavaScript single-threaded com event loop, isso é
suficiente. Não há verdadeiro interleaving síncrono. **OK**.

#### 3.2 TurnQueue (backpressure — F59)

```js
this.#turnQueue = new TurnQueue({ maxSize: options.maxQueueSize ?? DIALOG_QUEUE_MAX });
```

`sendTurn()` enfileira via `this.#turnQueue.enqueue()` — serialização e backpressure delegadas.
**Avaliação positiva**: rejeita se fila cheia com erro descritivo.

#### 3.3 Boot Protocol

```js
const bootPromise = waitForEvent(this, 'ready', {
    timeoutMs: this.#bootTimeoutMs,
    timeoutError: `[DialogLoopManager] Boot timeout após ${this.#bootTimeoutMs}ms`,
});
// ... watchdog.start() ...
bootSendFn(metaPrompt, { timeoutMs: LONG_TASK_TIMEOUT_MS }).catch(...)
await bootPromise;
```

**Achado**:

| ID              | Sev | Descrição                                                                                                                                                                                                                                                                                                                           |
| --------------- | --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **GAP-LOOP-01** | P2  | `bootSendFn().catch()` é fire-and-forget com log e emit interno. Se `bootSendFn` lançar **sincronicamente** (ex: `#host.sendMessage` não está disponível), a exceção não é capturada pelo `.catch()` (que só captura rejeições de Promise). Precisaria de try/catch antes ou wrapper `Promise.resolve(bootSendFn(...)).catch(...)`. |

#### 3.4 Watchdog

```js
this.#watchdog = new DialogWatchdog({
  intervalMs: this.#watchdogIntervalMs,
  stallThresholdMs: this.#watchdogStallMs,
  onStall: (stalledMs) => this.emit(EMITTER_LOOP_STALLED, { stalledMs }),
  onPreStallWarning: (stalledMs) => this.emit(EMITTER_LOOP_PRE_STALL_WARNING, { stalledMs }),
});
```

**Avaliação**: Bem estruturado. Eventos emitidos corretamente. F41B.7 (pré-stall a 80%) bem
documentado.

#### 3.5 PR Metrics Persistidas

```js
const saved = readState()?.prMetrics;
if (saved && typeof saved === 'object') {
    this.#prMetrics = { boots: Number(saved.boots) || 0, ... };
}
```

**Positivo**: PR metrics sobrevivem a restarts — permite tracking de consumo de PRs entre
reinicializações.

#### 3.6 `sendTurn()` — Guard

```js
sendTurn(message, { timeout = 60_000, signal } = {}) {
    if (!this.#active) {
        return Promise.reject(new SessionError(..., 'DIALOG_NOT_ACTIVE'));
    }
    if (signal?.aborted) {
        return Promise.reject(new DOMException(..., 'AbortError'));
    }
```

**Positivo**: Double guard (active + signal) antes de enfileirar.

### Achados Loop Manager

| ID              | Sev | Descrição                                                                                                                                                 |
| --------------- | --- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **GAP-LOOP-01** | P2  | `bootSendFn()` podia lançar sincronamente — **mitigado em 2026-04-17 com `Promise.resolve(bootSendFn(...)).catch(...)`**                                  |
| **GAP-LOOP-02** | P3  | `#compactionRequested` flag nunca resetada após compaction bem-sucedida (risk de compaction bloqueada em next cycle se compaction falhar silenciosamente) |

---

## 4. Arquivo: `session/keepalive.js`

**Função**: Heartbeat periódico via SDK para manter sessão ativa em idle. **LOC**: ~120

### BUG CONFIRMADO — CAT-008 / BUG-KEEP-01

> **Status de execução (2026-04-17): corrigido no código.** Foi adicionado o guard `#tickInFlight`
> em `src/copilot/agent/session/keepalive.js`, impedindo overlap entre ticks assíncronos.

```js
start(callbacks) {
    if (this.#running) return;
    this.#running = true;
    this.#interval = setInterval(() => {
        void this.#tick(callbacks);  // ← async sem overlap guard!
    }, this.#intervalMs);
}
```

**Problema**: `#tick()` é `async`. Se um tick leva mais tempo que o intervalo (ex: SDK travado, rede
lenta), múltiplos ticks concorrentes executam simultaneamente. Isso pode causar:

- Múltiplos pings simultâneos ao SDK
- Telemetria de heartbeat multiplicada
- Condição de corrida se `#tick` modifica estado interno

**Severidade**: P1 — afeta confiabilidade de sessões longas.

### Correção Recomendada

```js
start(callbacks) {
    if (this.#running) return;
    this.#running = true;
    const runTick = async () => {
        if (!this.#running) return;
        try {
            await this.#tick(callbacks);
        } finally {
            if (this.#running) {
                this.#tickTimeout = setTimeout(runTick, this.#intervalMs);
            }
        }
    };
    this.#tickTimeout = setTimeout(runTick, this.#intervalMs);
}
```

---

## 5. Arquivo: `lifecycle/agent-lifecycle.js`

**Função**: Implementa `agentStart()`, `agentStop()`, `initSession()`. **LOC**: ~350

### Achados

| ID            | Sev | Descrição                                                                                                                                                                                                                                                                   |
| ------------- | --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **GAP-LC-01** | P2  | `agentStart()` tem guard `if (ctx.status !== 'stopped') { log('WARN'); return; }`. Retorna silenciosamente sem lançar erro. Caller que espera um start bem-sucedido e verifica o status depois pode não perceber que o start foi ignorado — potencial bug de estado oculto. |
| **GAP-LC-02** | P3  | Import de `setExperimentalSession` e `setSessionRpc` de `tools/bootstrap.js` — acoplamento direto de agent-lifecycle ao módulo de tools. Deveria passar por DI ou callback.                                                                                                 |

### Positivos

- `STOP_BOOT_WAIT_MS` usado como timeout para esperar boot terminar antes de stop — evita race
  condition bem documentada
- `tryReconnect` em módulo separado com política configurável
- `performBootWiring()` separado de `agentStart()` — boot em fases testáveis

### Status adicional do boot real (2026-04-17)

- `readStateAsync()` agora compartilha uma promise de leitura em voo, reduzindo a chance de
  múltiplos readers tentarem parsear/remover o mesmo snapshot corrompido durante o boot;
- `_doWriteState()` passou a basear merges em `await readStateAsync()` quando o cache está frio,
  evitando sobrescrita cega de estado persistido logo na inicialização;
- `runDialogBootRecovery()` agora sai silenciosamente quando o boot normal ainda está em
  `processing`, eliminando warnings falsos de F53 durante retomada saudável;
- `session.custom_agents_updated` foi adicionado ao conjunto de eventos SDK conhecidos, evitando
  alerta espúrio de “SDK pode ter sido atualizado” no caminho normal de boot.

---

## 6. Arquivo: `health-check.js`

**Função**: Snapshot de saúde do agente para diagnóstico. **LOC**: ~80

### Avaliação

Sem bugs críticos encontrados. Função `getAgentHealthSnapshot()` agrega:

- Status do agente, sessionId, modelo
- Profundidade da fila, watchdog state
- Métricas de PR, uptime

**Positivo**: Usado em health endpoints da API — diagnóstico rico.

### Status adicional do health (2026-04-17)

O health do agent ficou mais acionável nesta segunda onda:

- `backgroundPendingLabels` expõe rótulos das tarefas fire-and-forget ainda pendentes;
- `bootReport` agrega o último ciclo de boot do agent;
- o check `boot` passa a reportar `failedSteps` e `lastCompletedAt`.
- `riskFlags` resume os riscos canônicos do snapshot operacional.
- `recommendedAction` aponta a próxima ação sugerida para troubleshooting.

---

## 7. Resumo de Achados do Módulo Agent

| ID                        | Severidade | Arquivo                        | Descrição                                                                                                                     |
| ------------------------- | ---------- | ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| **BUG-KEEP-01** / CAT-008 | **P1**     | `session/keepalive.js:67-70`   | `#tick()` async sem overlap guard em setInterval — **corrigido em 2026-04-17 com `#tickInFlight`**                            |
| **GAP-AGENT-01**          | P2         | `always-alive.js`              | `__processQueue` evento interno sem encapsulamento — acessível externamente — **mitigado em 2026-04-17 com `Symbol` interno** |
| **GAP-LC-01**             | P2         | `lifecycle/agent-lifecycle.js` | `agentStart()` já não é silencioso: hoje faz `log + emit(EMITTER_ERROR)`; ainda resta decidir se também deve lançar erro      |
| **GAP-LOOP-01**           | P2         | `dialog/loop-manager.js`       | `bootSendFn()` podia lançar sincronamente — **mitigado em 2026-04-17 com `Promise.resolve(...).catch(...)`**                  |
| **GAP-AGENT-02**          | P3         | `always-alive.js`              | `setMaxListeners(50)` suprime warnings legítimos                                                                              |
| **GAP-LOOP-02**           | P3         | `dialog/loop-manager.js`       | `#compactionRequested` nunca resetado após falha                                                                              |
| **GAP-LC-02**             | P3         | `lifecycle/agent-lifecycle.js` | Acoplamento direto a `tools/bootstrap.js`                                                                                     |

### Severidade Geral do Módulo: **P1 (Alto)**

BUG-KEEP-01 era um bug real de concorrência que afetava sessões longas. Foi corrigido no código
atual.

> **Status adicional (2026-04-17): `GAP-AGENT-01` mitigado.** O evento interno de processamento da
> fila deixou de usar string pública e passou a usar `EMITTER_PROCESS_QUEUE` com `Symbol`, reduzindo
> colisão/acesso acidental por consumidores externos.

> **Status adicional (2026-04-17): boot recovery e state I/O endurecidos.** A retomada de sessão não
> volta mais a emitir warnings F53 falsos quando o bootstrap normal já está conduzindo a ativação do
> dialog loop, e a leitura do snapshot persistido passou a ser serializada em memória.

> **Status adicional (2026-04-17): contracts/error policy/lazy singleton endurecidos.** O módulo
> agent entrou numa nova fase de hardening: mutation helpers em `AgentContext`, wrapper central
> `withAgentErrorPolicy(...)`, menos casts no hot path e migração incremental para `getAgent()`.

> **Status adicional (2026-04-17): error policy e persistência auxiliar avançaram.**
> `dialog/agent-dialog-controller.js` agora usa `withAgentErrorPolicy(...)` em `start/stop/resume`,
> `session/ownership.js` ganhou wrappers com policy canônica para o vínculo SDK↔hub, e
> `persistStateWithPolicy(...)` foi propagado para `agent-lifecycle`, `agent-messaging`,
> `user-input-handler`, `loop-manager`, `turn-executor` `boot-steps` e `initializer`. Nesta mesma
> onda, `user-input-handler.js` deixou de persistir perguntas interativas duas vezes e passou a
> evitar I/O redundante em mensagens internas de protocolo do dialog loop.

> **Status adicional (2026-04-17): contracts runtime e abort cleanup endurecidos.**
> `runtime-contracts.js` passou a concentrar guards/compat shims (`assertEmitterHost(...)`,
> `trySetLiveSessionModel(...)`), `boot-steps.js` perdeu o cast residual para `ctx.mcpBridge` e
> `turn-executor.js` ganhou cleanup explícito de listeners de `AbortSignal`.

> **Status adicional (2026-04-17): boundary de hooks removido e superfície SDK explicitada.**
> `sdk/types.js` e `hooks/types.js` foram alinhados ao SDK 0.2.0, `session-setup.js` deixou de
> exigir cast para registrar hooks, e o `AlwaysAliveAgent` passou a expor `getSdkHandles()` /
> `getSdkResourceSnapshot()` + operações canônicas de status/auth/foreground/custom agents.

> **Status adicional (2026-04-17): boot observability integrada ao health.** O pipeline de boot
> agora produz `bootReport` com duração/falha por etapa, e o health do agent passou a expor backlog
> rotulado (`backgroundPendingLabels`) e falhas de boot (`boot.steps_failed`).

> **Status adicional (2026-04-17): runner de boot com degradação controlada.** `runBootPipeline()`
> agora executa cada step sob a policy canônica do agent, distinguindo `failed` (fatal), `degraded`
> (erro retryable em etapa opcional) e `skipped` (abort explícito em etapa opcional). O health
> também passou a refletir `boot.steps_degraded` quando o boot conclui com perda parcial de
> capacidades laterais.

> **Status adicional (2026-04-17): leitura semântica do AgentContext avançou.** Os módulos quentes
> deixaram de depender do shape cru de `sessionState/dialogState/configState/...` para leituras
> comuns. `health-check`, `state/agent-state`, facades e getters públicos do `AlwaysAliveAgent`
> passaram a usar getters/helpers do próprio `AgentContext`, reduzindo acoplamento estrutural no
> runtime.

---

_Próximo: [03-SDK-CONFORMIDADE.md](./03-SDK-CONFORMIDADE.md)_
