# Análise Profunda — `src/copilot/agent` & `src/copilot/terminal`

> **Versão**: 1.0.0 **Data**: 2026-04-24 **Escopo**: Todos os 135 arquivos anexados do repositório
> `chatgpt-docker-puppeteer` **Referência SDK**: GitHub Copilot SDK Public Preview (abril 2026)

---

## Atualização Codex — 2026-04-24

Esta seção registra a validação feita após a auditoria independente original. A auditoria foi usada
como insumo, não como verdade autoevidente: cada item abaixo foi confrontado com o estado atual do
código e com testes unitários/live.

### Corrigido e validado nesta rodada

- **BUG-001 / reconnect SDK**: a sessão retomada/reconectada passa pelo wiring canônico
  (`wireAgentSessionRuntime`), evitando sessão nova sem eventos SDK, histórico, collectors e runtime
  observers.
- **BUG-002 / boot failure duplicado**: o boot do `DialogLoopManager` agora centraliza falha em
  caminho idempotente e tem circuit breaker de falhas repetidas (`DIALOG_BOOT_CIRCUIT_OPEN`) para
  evitar storm de restart/PR.
- **BUG-003 / `TurnQueue.reset()`**: a fila usa geração para impedir decremento tardio de `depth`
  após reset.
- **BUG-004 / listeners de boot**: relays de handoff/question answered passam por cleanup registrado
  no lifecycle.
- **BUG-005 / READY durante stop**: `READY` tardio durante stop autorizado é ignorado para não
  rearmar watchdog nem reiniciar loop encerrado intencionalmente.
- **BUG-006 / shutdown race**: shutdown central passa `preserveDialogLoopIntent`, persiste
  `gracefulShutdown=true` e conserva `dialogLoopActive=true` quando havia loop/READY/pending
  question antes do encerramento.
- **SEC-001 / briefing**: conteúdo de briefing é sanitizado e limitado antes de entrar no
  prompt/contexto.
- **SEC-002 / SSRF**: validação de URL foi endurecida para IPs privados, loopback/link-local e
  resolução insegura.
- **SEC-003 / erros HTTP**: handlers Express diretos e `HandlerResult` 5xx passam por sanitização;
  rotas de health/modules auth-exempt também não expõem stack/path cru em erro 5xx.
- **DESIGN-001 / restart infinito**: o dialog loop ganhou circuit breaker de boot e recovery
  semântico com métricas separadas para `zero_pr` versus restart com PR.
- **DESIGN-002 / critical compaction**: dedupe/rate limit impede emissão crítica repetitiva em cada
  iteração acima do limiar.
- **DESIGN-006 / shadow pending**: shadow de pending question normaliza timestamps e ignora
  `expiresAt=0` inválido.
- **LEAK-004 / cache de mensagens**: cache de histórico foi limitado/expirável.
- **Shutdown terminal**: `/quit` agora usa `runShutdown('terminal.quit')`, não fecha o servidor duas
  vezes, permite drenagem controlada do agente com timeout por handler e encerra explicitamente o
  processo após shutdown concluído.
- **Continuidade pós-turno sem restart**: a política agressiva de reiniciar após `REPLY` sem `READY`
  foi invalidada em live UX. O handler de protocolo agora responde ao `REPLY` com
  `CONTINUE_DIALOG_LOOP`, fazendo a LLM-B reabrir `READY` na mesma task.
- **UX limpa de READY/thinking**: `READY` deixa de aparecer como `[ASK:READY]`, thinking de
  turno/task interna permanece persistido e consultável via `/thinking`, mas não polui o stdout por
  padrão (`TERMINAL_SHOW_THINKING` é opt-in).
- **Restart como exceção**: `terminal-agent-wiring.js` agora só reinicia automaticamente para razões
  allowlisted (`watchdog_restart`, `model_stopped`). Outros `dialog.stopped` são registrados e
  exigem retomada explícita.

### Validado live com `terminal:llm-b`

- Shutdown real via `/quit`: estado persistido com `sessionId=3ae12b1f-76dc-4a01-8abc-eb74b65ac6e3`,
  `dialogLoopActive=true`, `dialogPaused=false`, `gracefulShutdown=true`.
- Restart normal pós-shutdown: mesma sessão SDK retomada e dialog loop voltou a `READY`.
- Live UX regression: a política anterior reiniciava após cada mensagem e duplicava turnos. Foi
  removida.
- Dois turnos REPL consecutivos (`oi`, `oi de novo`) concluíram sem `recovery restart`; após cada
  `REPLY`, o estado voltou para `waiting_for_input`, `pendingQuestion.kind=ready`, `queueSize=0`,
  com `llmb_dialog_recovery_total=0`.
- Testes de UX terminal validam prompt sem `[ASK:READY]`, thinking silencioso quando `/thinking off`
  e restart automático restrito a razões excepcionais.
- Carga com dois injects concorrentes: ambos concluíram (`LOAD-A-OK`, `LOAD-B-OK`), sem timeout,
  fila final 0, recovery semântico concluído.
- Boot failure controlado: `LLM_B_BOOT_TIMEOUT_MS=1 npm run terminal:llm-b` gerou timeout, acionou
  janela de READY tardio e recuperou `READY` sem perder a sessão; restart normal posterior retomou a
  mesma sessão e voltou a `READY`.

### Invalidado ou já coberto no estado atual

- **RACE-003 / `_sendTurnMutex` null**: o caminho atual de turnos é serializado no
  `DialogLoopManager`/`TurnQueue`; o risco descrito para o engine legado não é mais o caminho mestre
  para `/inject`.
- **RACE-004 / listener READY no REPL**: o fluxo atual usa runtime wiring e cleanup de listeners;
  não foi reproduzido leak de listener idempotente no teste live/restart.
- **LEAK-003 / activity emitter**: o terminal registra cleanup no shutdown central
  (`terminal.activityEmitter`) e foi validado em shutdown live.
- **Erros 500 via presentation `HandlerResult`**: embora alguns projections ainda retornem
  `{ status: 500, body.error }`, a ponte HTTP sanitiza qualquer `HandlerResult` 5xx antes de
  responder. Esses pontos não são mais vazamento direto.

### Adiado intencionalmente

- **Decomposição profunda do `AgentContext`**: ainda é o maior débito arquitetural, mas deve ser
  feita por fatias de capability/manager com contratos formais para evitar churn inseguro.
- **Protocol versioning READY/REPLY/STOPPED**: necessário para robustez de longo prazo, mas a rodada
  atual priorizou recovery live, circuit breaker e política 0 PR.
- **Remoção do proxy `alwaysAliveAgent`**: permanece como compatibilidade pública; a arquitetura já
  favorece `getAgent()`, mas a troca total exige migração coordenada de consumidores.
- **Zod v4 e schemas SSE**: melhoria válida, sem urgência funcional nesta rodada.
- **Endpoint `/agent/listeners` e diagnósticos extras**: útil para observabilidade futura; não
  bloqueia o boot/reconnect atual.
- **RACE-001 / write queue de estado**: parcialmente mitigado por writes com policy/drain, mas ainda
  merece rodada própria de teste de concorrência pesada em `state-io.js`.

### Validação automatizada

- `npm run typecheck:strict:src.copilot`
- `npm run typecheck:node`
- `npm run analyze:arch:global:strict` → `hard=0`, `soft=0`
- `npx vitest run tests/unit/copilot` → 269 arquivos passaram, 18 skipped; 4057 testes passaram, 28
  skipped

---

## Índice

1. [Sumário Executivo](#1-sumário-executivo)
2. [Arquitetura — Visão Geral e Avaliação](#2-arquitetura--visão-geral-e-avaliação)
3. [Bugs Confirmados](#3-bugs-confirmados)
4. [Gaps de Segurança](#4-gaps-de-segurança)
5. [Race Conditions e Problemas de Concorrência](#5-race-conditions-e-problemas-de-concorrência)
6. [Memory Leaks](#6-memory-leaks)
7. [Fragilidades de Design (não-bugs, mas riscos)](#7-fragilidades-de-design-não-bugs-mas-riscos)
8. [Melhorias Propostas por Módulo](#8-melhorias-propostas-por-módulo)
9. [Upgrades de Dependências e SDK](#9-upgrades-de-dependências-e-sdk)
10. [Roadmap de Refatoração Priorizado](#10-roadmap-de-refatoração-priorizado)

---

## 1. Sumário Executivo

O projeto implementa um **Terminal Permanente LLM-B** — um agente always-alive sobre o GitHub
Copilot SDK, com REPL interativo, persistência SQLite, protocol READY/REPLY/STOPPED via `ask_user`,
e uma arquitetura de camadas bem estruturada (`agent/`, `presentation/`, `terminal/`).

A qualidade geral é alta para um sistema desta complexidade. Os principais riscos concentram-se em:

| Severidade | Quantidade | Descrição Geral                                         |
| ---------- | ---------- | ------------------------------------------------------- |
| 🔴 Crítico | 3          | Bugs que causam comportamento incorreto em produção     |
| 🟠 Alto    | 7          | Race conditions e memory leaks latentes                 |
| 🟡 Médio   | 12         | Fragilidades de design que amplificam falhas em cascata |
| 🟢 Baixo   | 18+        | Melhorias de qualidade, observabilidade e DX            |

---

## 2. Arquitetura — Visão Geral e Avaliação

### 2.1 Pontos Fortes

- **Separação de concerns exemplar**: `agent/ports/`, `agent/facades/`, `presentation/` e
  `terminal/frontend/` seguem o padrão hexagonal de forma consistente.
- **Política de erros centralizada** (`error-policy.js`): `withAgentErrorPolicy()` abstrai
  classificação de `retry/fatal/ignore` sem duplicar try-catch.
- **Context Object Pattern** (`AgentContext`): elimina passagem de dezenas de parâmetros entre
  módulos extraídos.
- **FSM de status** (`STATUS_TRANSITIONS` em `AgentContext`): guard explícito de transições de
  estado.
- **Boot Pipeline** (`performBootWiring`): steps nomeados com relatório consolidado
  (`AgentBootReport`) é excelente para observabilidade.
- **TurnQueue com backpressure** (`backpressure.js`): serialização por Promise-chain com limite de
  profundidade.

### 2.2 Problemas Arquiteturais Sistêmicos

#### A — God Object Residual em `AgentContext`

O `agent-context.js` tem **~900 linhas** e **70+ métodos**. Apesar da decomposição de sub-estados
(`sessionState`, `dialogState`, etc.), a classe ainda acumula responsabilidades demais:

```
Gestão de sessão SDK → sessionState
Gestão de dialog loop → dialogState
Configuração de modelo → configState
Métricas → metricsState
Lifecycle (quotaMonitor, metricsTimer) → runtimeState
I/O (client) → ioState
```

Cada um desses deveria ter seu próprio manager com API semântica, análogo ao que já foi feito com
`MessageQueue`, `SessionKeepalive`, `BackgroundTasks`.

#### B — Protocolo READY/REPLY/STOPPED Frágil

O protocolo customizado sobre `ask_user` é o coração da arquitetura, mas está implicitamente
acoplado ao comportamento do modelo. Qualquer mudança no prompt do SDK pode quebrar o parsing em
`DialogProtocol.classify()`. Não há versioning nem fallback robusto se o modelo responder com texto
que começa com "READY" por coincidência.

#### C — Singleton Proxy Anti-pattern

O `alwaysAliveAgent` exportado em `always-alive.js` é um `Proxy` sobre `{}`. Isso significa:

- `instanceof AlwaysAliveAgent` retorna `false` (o target é `{}`).
- Bundlers podem não otimizar corretamente o acesso a propriedades via Proxy.
- Ferramentas de debugging mostram `{}` ao inspecionar a referência.

---

## 3. Bugs Confirmados

### 🔴 BUG-001 — Session Events Não São Re-wired Após Reconexão

**Arquivo**: `src/copilot/agent/lifecycle/agent-lifecycle.js` → `agentTryReconnect()` **Arquivo**:
`src/copilot/agent/lifecycle/reconnect-policy.js` → `tryReconnect()`

**Descrição**: Na reconexão, `callbacks.clearSessionEventUnsubs([])` remove os listeners da sessão
anterior e em seguida `initSession(client)` cria uma nova sessão. Porém `initSession()` apenas chama
`buildSessionTools`, `buildSessionHooks` e `finalizeSessionInit` — ele **não** chama
`wireSessionEvents()` nem `performBootWiring()`.

Resultado: após a primeira reconexão, eventos críticos da sessão como
`session.token_budget_warning`, `session.compaction_complete`, `session.idle`,
`tool.execution_start` e `session.keepalive` **nunca são emitidos ao runtime**.

```js
// agent-lifecycle.js (trecho simplificado)
export async function agentTryReconnect(ctx, host, originalError, opts = {}) {
  ctx.setReconnectState(true);
  try {
    return await tryReconnect(originalError, ctx.getClientSnapshot(), ctx.getRuntimeStatus(), {
      // ✗ PROBLEMA: initSession não re-wira eventos
      initSession: (client) => initSession(ctx, client, host),
      clearSessionEventUnsubs: () => {
        const unsubs = ctx.getSessionEventUnsubscribersSnapshot();
        for (const unsub of unsubs) unsub();
        ctx.clearSessionEventUnsubscribers();
      },
      // ...
    });
  } finally {
    ctx.setReconnectState(false);
  }
}
```

**Correção Proposta**:

```js
// Em reconnect-policy.js, após initSession bem-sucedido:
const { session, isResumed } = await initSession(activeClient);

// Re-wire eventos da nova sessão
const newUnsubs = wireSessionEvents(session, isResumed, callbacksForWiring);
ctx.setSessionEventUnsubscribers(newUnsubs);
```

Ou, alternativamente, o callback `initSession` em `agentTryReconnect` deve aceitar uma função que
também performe o wiring, delegando a `performBootWiring` com escopo mínimo (apenas
`wireSessionEvents` e `attachEventCollector`).

---

### 🔴 BUG-002 — Dupla Emissão de 'stopped' em `DialogLoopManager.start()`

**Arquivo**: `src/copilot/agent/dialog/loop-manager.js`

**Descrição**: Em `start()`, há duas fontes que podem emitir `'stopped'`:

1. O `.catch()` no `Promise.resolve(bootSendFn(...))` — emite `'stopped'` se o boot prompt falha.
2. `#failBoot(bootErr)` — também chama `this.emit('stopped', { reason })`.

Se `bootSendFn` falha (ex.: timeout de sessão) **e** `bootPromise` também expira, ambos os caminhos
executam e `'stopped'` é emitido **duas vezes**.

```js
// loop-manager.js — start()
Promise.resolve(bootSendFn(metaPrompt, {...})).catch((e) => {
    if (this.#state.active) {
        this.#state.deactivate();
        this.emit('stopped', { reason: e.message }); // 🔴 emissão #1
    }
});

try {
    await bootPromise;
} catch (bootErr) {
    // ... se bootSendFn já deactivou, #state.active é false
    // mas #failBoot() pode ainda emitir 'stopped' novamente
    if (!(await this.#waitForLateBootReady())) {
        this.#failBoot(bootErr); // 🔴 emissão #2 potencial
    }
}
```

**Impacto**: O `EMITTER_DIALOG_STOPPED` handler em `terminal-agent-wiring.js` chama
`ensureDialogLoop()` em cada 'stopped'. Dupla emissão → dois boots simultâneos → race condition de
PR consumido.

**Correção Proposta**:

```js
// Usar flag para idempotência:
let bootErrorHandled = false;

Promise.resolve(bootSendFn(metaPrompt, {...})).catch((e) => {
    if (this.#state.active && !bootErrorHandled) {
        bootErrorHandled = true;
        this.#state.deactivate();
        this.#watchdogSupervisor.clear();
        this.emit('stopped', { reason: e.message });
    }
});

try {
    await bootPromise;
} catch (bootErr) {
    if (!bootErrorHandled && !(await this.#waitForLateBootReady())) {
        bootErrorHandled = true;
        this.#failBoot(bootErr);
    }
}
```

---

### 🔴 BUG-003 — `TurnQueue.reset()` Causa Depth Negativo

**Arquivo**: `src/copilot/agent/dialog/backpressure.js`

**Descrição**: Quando `reset()` é chamado (via `forceDeactivate()`), `this.#depth` volta a zero e
`this.#gen` é incrementado. Porém, qualquer turn que estava em execução e completar posteriormente
vai chamar `finalizeTurn()` que decrementa `this.#depth`:

```js
enqueue(fn) {
    this.#depth++;
    // ...
    const finalizeTurn = () => {
        this.#depth--;           // ← executado APÓS reset()
        if (this.#depth === 0 && this.#gen === myGen) {
            this.#mutex = Promise.resolve();
        }
    };
    void next.then(finalizeTurn, finalizeTurn);
    return next;
}

reset() {
    this.#mutex = Promise.resolve();
    this.#depth = 0;   // ← zeramos aqui
    this.#gen++;       // ← protege o mutex, mas não o depth
}
```

O `#gen` correto impede que o mutex seja resetado novamente, mas `this.#depth` irá para **-1**
quando `finalizeTurn` executar. Isso não quebra imediatamente, mas `get full()` retornará falso
mesmo com depth real de 1 (após nova enqueue).

**Correção Proposta**:

```js
const myGen = ++this.#gen;
const myEnqueueedDepth = this.#depth; // salvar antes

const finalizeTurn = () => {
  // Só decrementar se ainda somos da geração atual
  if (this.#gen === myGen) {
    this.#depth--;
    if (this.#depth === 0) {
      this.#mutex = Promise.resolve();
    }
  }
  // Se gen mudou (reset chamado), não tocar em #depth
};
```

---

### 🟠 BUG-004 — `stepWireHandoff` e `stepWireQuestionAnsweredRelay` Não Registram Cleanup

**Arquivo**: `src/copilot/agent/session/boot-steps.js`

**Descrição**: Os dois steps abaixo adicionam listeners em `agentEmitter` mas **nunca** os adicionam
a `state.unsubs`, o que significa que em `agentStop()`, quando os unsubs são iterados, esses
listeners ficam para sempre no EventEmitter do agente.

```js
// boot-steps.js
export function stepWireHandoff(agentEmitter, ctx) {
  if (isExperimentalEnabled('fleet')) {
    agentEmitter.on('session.handoff', (data) => {
      // ← NUNCA removido
      ctx.receiveHandoff(data);
    });
  }
}

export function stepWireQuestionAnsweredRelay(agentEmitter, ctx) {
  agentEmitter.on(EMITTER_QUESTION_ANSWERED, (evt) => {
    // ← NUNCA removido
    // ...
  });
}
```

Cada `start()` adiciona mais dois listeners permanentes, acumulando indefinidamente.

**Correção Proposta**:

```js
export function stepWireHandoff(agentEmitter, ctx, state) {
  if (!isExperimentalEnabled('fleet')) return;
  const handler = (data) => {
    ctx.receiveHandoff(data);
    defaultMetrics.recordHandoff();
  };
  agentEmitter.on('session.handoff', handler);
  state.unsubs.push(() => agentEmitter.off('session.handoff', handler));
}

export function stepWireQuestionAnsweredRelay(agentEmitter, ctx, state) {
  const handler = (evt) => {
    if (typeof evt?.answer !== 'string') return;
    void ctx.trackBackgroundTask(Promise.resolve(resolveAgentUserInput(evt.answer)), {
      label: 'hooks.question_answered.relay',
    });
  };
  agentEmitter.on(EMITTER_QUESTION_ANSWERED, handler);
  state.unsubs.push(() => agentEmitter.off(EMITTER_QUESTION_ANSWERED, handler));
}
```

---

### 🟠 BUG-005 — `handleProtocolInput` Emite `EMITTER_LOOP_READY` Durante `stop()`

**Arquivo**: `src/copilot/agent/dialog/loop-manager.js`

**Descrição**: Se `READY` chega do SDK enquanto `stop()` está em andamento
(`#state.stopping === true`), o guard `if (!this.#state.active && !this.#state.stopping)` impede
corretamente a recuperação de protocolo tardio. Porém, a emissão `this.emit(EMITTER_LOOP_READY, {})`
ainda acontece incondicionalmente:

```js
handleProtocolInput({ question }) {
    const kind = DialogProtocol.classify(question);
    if ((kind === 'ready' || kind === 'reply') && !this.#state.active && !this.#state.stopping) {
        this.#recoverFromLateProtocol(kind);
    }
    if (kind === 'ready') {
        this.#watchdogSupervisor.ping();
        this.emit(EMITTER_LOOP_READY, {}); // ← emite mesmo durante stop()
    }
    // ...
}
```

Qualquer `sendTurn()` aguardando `EMITTER_LOOP_READY` em outra fila poderia resolver indevidamente
durante o shutdown.

**Correção Proposta**:

```js
if (kind === 'ready') {
  this.#watchdogSupervisor.ping();
  if (!this.#state.stopping) {
    // só emite se não estamos parando
    this.emit(EMITTER_LOOP_READY, {});
  }
}
```

---

### 🟠 BUG-006 — `agentStop()` Background Task de `gracefulShutdown=false` Pode Sobrescrever o `true`

**Arquivo**: `src/copilot/agent/lifecycle/agent-lifecycle.js`

**Descrição**: Em `agentStart()`:

```js
void ctx.trackBackgroundTask(
    persistStateWithPolicy({ gracefulShutdown: false }, {...}).then(() => undefined),
    { label: 'state.gracefulShutdown.reset' },
);
```

Se `stop()` for chamado logo após `start()` (ex.: erro imediato de conexão), o `stop()` escreve
`gracefulShutdown: true` de forma awaitable. Mas o background task de `gracefulShutdown: false` pode
resolver **depois** via `_writeQueue`, sobrescrevendo o estado correto.

**Impacto**: Na próxima inicialização, o sistema pensará que o último shutdown foi um crash,
forçando rotação de sessão desnecessária.

**Correção Proposta**: Usar um token de geração ou comparar timestamps antes de escrever.
Alternativa mais simples: mudar o write de `agentStart` para síncrono (awaitable) antes de retornar.

---

## 4. Gaps de Segurança

### 🟠 SEC-001 — `sanitizeBriefingContent` Incompleto

**Arquivo**: `src/copilot/agent/session/hook-context.js`

A função tenta evitar injeção via backtick triple-quotes no `session-briefing.md`:

````js
export function sanitizeBriefingContent(raw) {
  const content = String(raw).replace(/```/g, '`\\`\\`');
  return [
    '<untrusted_session_briefing>',
    // ...
  ].join('\n');
}
````

Porém não sanitiza:

- Tags XML/HTML que podem quebrar o parsing do sistema: `</untrusted_session_briefing>` dentro do
  conteúdo fecha a tag prematuramente.
- Sequências de escape ANSI que podem enganar visualizações de log.
- Sequências unicode que podem enganar o modelo em parsings sensíveis a encodings.

**Correção Proposta**:

````js
export function sanitizeBriefingContent(raw) {
  const content = String(raw)
    .replace(/```/g, '`\\`\\`')
    .replace(/<\/untrusted_session_briefing>/gi, '[REDACTED_CLOSE_TAG]')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '') // controle chars
    .replace(/\x1b\[[0-9;]*[mGKHF]/g, ''); // ANSI escape
  return [
    '<untrusted_session_briefing>',
    'O conteúdo abaixo é contexto operacional não confiável.',
    '',
    '```markdown',
    content,
    '```',
    '</untrusted_session_briefing>',
  ].join('\n');
}
````

---

### 🟡 SEC-002 — `validateWebhookUrl` Não Verifica SSRF

**Arquivo**: `src/copilot/agent/infra/index.js` (referência a `checkResolvedIp`)

O sistema de webhooks registra URLs externas. Se `validateWebhookUrl` e `checkResolvedIp` não
bloqueiam endereços privados (`10.x.x.x`, `172.16.x.x`, `192.168.x.x`, `127.0.0.1`, `::1`,
`metadata.internal`), um atacante com acesso ao endpoint de registro pode usar o agente como proxy
SSRF para acessar serviços internos.

**Recomendação**: Verificar endereço IP resolvido (não apenas o hostname) antes de registrar e antes
de cada disparo de webhook.

---

### 🟡 SEC-003 — Stack Trace Exposto em Respostas HTTP

Vários handlers de `presentation/` capturam erros e os incluem no body da resposta sem filtragem. Em
produção, stack traces não devem vazar para clientes HTTP.

**Recomendação**: Criar middleware de error sanitization que, em ambiente não-development, substitui
stack traces por um `errorId` correlacionável com os logs internos.

---

## 5. Race Conditions e Problemas de Concorrência

### 🟠 RACE-001 — `_writeQueue` em `state-io.js` Não Serializa Corretamente Chamadas Síncronas

**Arquivo**: `src/copilot/agent/lifecycle/state-io.js`

```js
let _writeQueue = Promise.resolve();

export async function writeStateAsync(updates) {
    const resultPromise = _writeQueue
        .then(() => _doWriteState(updates))
        .catch(...);

    _writeQueue = resultPromise.then(() => undefined, () => undefined);
    return resultPromise;
}
```

Se duas chamadas síncronas (mesma iteração do event loop) chamam `writeStateAsync()`, ambas leem
`_writeQueue` **antes** de qualquer delas atribuir o novo valor. O resultado: ambas criam chains do
mesmo `_writeQueue`, processam em paralelo, e a segunda lê o `_stateCache` ainda não atualizado pela
primeira.

**Exemplo**:

```js
// Em agentStart, podem acontecer no mesmo tick:
persistStateWithPolicy({ gracefulShutdown: false }, ...); // task 1
// ... dentro de performBootWiring:
persistStateWithPolicy({ dialogLoopActive: true }, ...);  // task 2
```

**Correção Proposta**: Usar um lock baseado em `Promise` explícito, ou `async-mutex`:

```js
import { Mutex } from 'async-mutex';
const _writeMutex = new Mutex();

export async function writeStateAsync(updates) {
  return _writeMutex.runExclusive(() => _doWriteState(updates));
}
```

---

### 🟠 RACE-002 — `ensureDialogLoop()` em `engine.js` Pode Iniciar Loop em Paralelo

**Arquivo**: `src/copilot/terminal/dialog/engine.js`

A flag `_ensureDialogLoopInFlight` protege contra chamadas simultâneas, mas há uma janela:

```js
if (_ensureDialogLoopInFlight !== null) {
  return _ensureDialogLoopInFlight;
}
_ensureDialogLoopInFlight = _doEnsureDialogLoop().finally(() => {
  _ensureDialogLoopInFlight = null; // ← pode não executar se .finally() throw
});
return _ensureDialogLoopInFlight;
```

Se `_doEnsureDialogLoop()` lançar um erro que interrompe o `.finally()` (improvável mas possível),
`_ensureDialogLoopInFlight` permanece não-null para sempre, bloqueando futuros boots.

**Correção Proposta**:

```js
_ensureDialogLoopInFlight = (async () => {
  try {
    await _doEnsureDialogLoop();
  } finally {
    _ensureDialogLoopInFlight = null; // garante limpeza
  }
})();
```

---

### 🟡 RACE-003 — `_sendTurnMutex` em `engine.js` Não Reconecta Após Null

Após `_turnQueueDepth` voltar a zero:

```js
void next.finally(() => {
  _turnQueueDepth--;
  if (_turnQueueDepth === 0) {
    _sendTurnMutex = Promise.resolve(null); // ← reset ok
  }
});
```

Mas se uma exceção não tratada em `next.finally()` ocorrer (ex.: se `finally` for interrompido por
uma task de alta prioridade via `queueMicrotask`), o reset do mutex pode não acontecer. O mutex
ficaria apontando para uma Promise resolvida antiga que pode não propagar corretamente o próximo
turno.

---

### 🟡 RACE-004 — Listener em `repl.js` para `EMITTER_DIALOG_READY` Não é Idempotente

Em `_cmdRestart()`:

```js
onceTerminalAgentRuntimeEvent(EMITTER_DIALOG_READY, onReady);
await stopTerminalDialogMode();
```

Se `stopTerminalDialogMode()` falhar imediatamente e o código entrar no `catch`, o `onReady` ainda
está registrado. O próximo boot bem-sucedido vai resolver o `readyPromise` corretamente, mas o
`timeout` já foi chamado. Possível warning de "Já resolvida" no Promise original.

---

## 6. Memory Leaks

### 🟠 LEAK-001 — Listeners do Dialog Loop Acumulam em `session/event-wirer.js`

**Arquivo**: `src/copilot/agent/session/event-wirer.js`

`wireSessionEvents()` retorna um array de unsubscribers e é chamada em `performBootWiring()`. Porém,
como identificado em BUG-001, na reconexão os eventos da sessão antiga são removidos mas os da nova
sessão não são wired. Em cenários onde o wiring ocorre sem limpeza prévia (ex.: durante boot
recovery de dialog loop), pode haver acumulação.

Além disso, `wireDialogLoopEvents()` em `event-wiring.js` chama
`dialogLoop.removeAllListeners(event)` antes de registrar — isso é correto — mas se
`wireDialogLoopEvents()` for chamado múltiplas vezes (ex.: por `ensureDialogLoopAttached()`), os
listeners do mapa `EVENT_MAP` se acumulam porque `removeAllListeners(event)` remove os antigos mas o
novo `on()` adiciona um novo.

**Mitigação**: Em `ensureDialogLoopAttached()`, o guard
`if (ctx.getDialogLoopAttachedSnapshot()) return;` previne re-wiring, mas é resetado em
`agentStop()`. Correto, mas o fluxo precisa ser auditado para garantir que `wireDialogLoopEvents`
nunca é chamado sem limpeza prévia.

---

### 🟠 LEAK-002 — `BackgroundTasks` Pode Vazar se `#maxPending` For Atingido Repetidamente

**Arquivo**: `src/copilot/agent/background-tasks.js`

Quando `this.#tasks.size >= this.#maxPending`, a task é rejeitada e `logSwallowed` é chamado. Porém,
a Promise original ainda existe no caller (não é `void`-ed em todos os sites). Se o caller não fizer
`await`, a Promise rejetada fica "floating" e pode disparar `unhandledRejection`.

**Correção**: Garantir que todos os callers de `trackBackgroundTask()` façam `void` ou `await`, e
que `BackgroundTasks` sempre retorne uma Promise resolvida mesmo nos casos de overflow (ela já faz
isso — retorna `Promise.resolve()` — mas a Promise original do caller ainda rejeita via
`logSwallowed`).

---

### 🟠 LEAK-003 — `terminalActivityEmitter` em `activity-state.js` Não Tem Cleanup

**Arquivo**: `src/copilot/terminal/activity-state.js`

```js
export const terminalActivityEmitter = new EventEmitter();
terminalActivityEmitter.setMaxListeners(25);
```

Os listeners registrados em `terminal/index.js` e `terminal-agent-wiring.js`:

```js
terminalActivityEmitter.on('activity:changed', activityChangedHandler);
terminalActivityEmitter.on('activity:changed', onActivityChanged);
```

Têm handlers de shutdown registrados (correto). Porém, o `terminalActivityEmitter` tem limite de 25
listeners e o codebase registra múltiplos ao longo do tempo. Se o servidor for reinicializado sem
fechar o processo (hot-reload), os handlers acumulam.

---

### 🟡 LEAK-004 — `SessionMessagesCache` Sem Limite de Tamanho

**Arquivo**: `src/copilot/agent/session/history-sync.js`

```js
async get(session) {
    const messages = await session.getMessages();
    this.#cache = messages;   // ← pode ser array de milhares de mensagens
    this.#cacheAt = now;
    return messages;
}
```

Para sessões longas, `getMessages()` pode retornar centenas ou milhares de objetos. O cache não tem
limite de tamanho. O TTL previne I/O repetido, mas o cache em memória cresce sem bound até
`invalidate()` ser chamado.

**Correção Proposta**:

```js
// Limitar a N mensagens mais recentes no cache
const MAX_CACHED_MESSAGES = 500;
this.#cache = Array.isArray(messages) ? messages.slice(-MAX_CACHED_MESSAGES) : messages;
```

---

## 7. Fragilidades de Design (não-bugs, mas riscos)

### 🟡 DESIGN-001 — Loop de Restart Infinito via `dialog.stopped`

**Arquivo**: `src/copilot/terminal/terminal-agent-wiring.js`

```js
agentEvents.on(EMITTER_DIALOG_STOPPED, (evt) => {
    // ...
    if (!readTerminalRuntimeState().dialogPaused) {
        ensureDialogLoop().catch((e) => log(...));
    }
});
```

E `stopTerminalDialogMode()` também dispara `EMITTER_DIALOG_STOPPED`. Cenário:

1. `EMITTER_DIALOG_STALLED` → `stopTerminalDialogMode()` → `EMITTER_DIALOG_STOPPED` →
   `ensureDialogLoop()` → novo boot
2. Novo boot falha → `EMITTER_DIALOG_STOPPED` → `ensureDialogLoop()` novamente
3. Sem circuit breaker → loop infinito consumindo PRs

**Proposta**: Implementar circuit breaker com contador de falhas consecutivas:

```js
let consecutiveBootFailures = 0;
const MAX_CONSECUTIVE_FAILURES = 3;
const CIRCUIT_BREAKER_RESET_MS = 5 * 60 * 1000;

agentEvents.on(EMITTER_DIALOG_STOPPED, async (evt) => {
  if (consecutiveBootFailures >= MAX_CONSECUTIVE_FAILURES) {
    log(
      'ERROR',
      `[CircuitBreaker] Dialog loop em circuit-open após ${consecutiveBootFailures} falhas.`,
    );
    broadcastSse('dialog.circuit_open', { failures: consecutiveBootFailures });
    setTimeout(() => {
      consecutiveBootFailures = 0;
    }, CIRCUIT_BREAKER_RESET_MS);
    return;
  }
  try {
    await ensureDialogLoop();
    consecutiveBootFailures = 0; // reset on success
  } catch (e) {
    consecutiveBootFailures++;
    log('WARN', `[CircuitBreaker] Falha ${consecutiveBootFailures}/${MAX_CONSECUTIVE_FAILURES}`);
  }
});
```

---

### 🟡 DESIGN-002 — `compaction-policy.js` Dispara Critical Em Toda Iteração Acima de 95%

**Arquivo**: `src/copilot/agent/dialog/compaction-policy.js`

```js
evaluate({ currentTokens, tokenLimit, ratio }) {
    if (ratio >= 95) {
        this.#proactiveRequested = false; // reset proactive flag
        return { ...urgency: 'critical' }; // SEMPRE retorna critical
    }
    // ...
}
```

Quando o token usage fica permanentemente acima de 95% (sessão muito longa), `evaluate()` retorna
`critical` **em cada chamada** de `handleTokenBudget()`. O método é chamado toda vez que o SDK emite
`session.token_budget_warning`, que pode ocorrer a cada turno.

**Impacto**: Múltiplas requisições de compaction crítica por turno, sobrecarregando o SDK e a lógica
de compaction.

**Correção**:

```js
if (ratio >= 95) {
    if (!this.#criticalRequested) {
        this.#criticalRequested = true;
        this.#proactiveRequested = false;
        return { ...urgency: 'critical' };
    }
    return null; // já enviamos critical, aguardar compaction
}
```

E adicionar `reset()` para limpar `#criticalRequested` quando compaction concluir.

---

### 🟡 DESIGN-003 — Boot Prompt Sem Versioning

**Arquivo**: `src/copilot/terminal/dialog/output.js`

O `DEFAULT_BOOT_PROMPT` define o protocolo READY/REPLY/STOPPED verbalmente. Qualquer mudança no
modelo pode alterar como ele interpreta essas instruções. Não há:

- Versionamento do protocolo
- Fallback quando READY não chega em X segundos (já existe timeout, mas sem degradação graciosa)
- Detecção de modelo que não suporta o protocolo

**Proposta**: Incluir um header de versão no boot prompt e um campo de metadado na resposta READY
para validação:

```
READY: {"protocol": "LLM-B/2.0", "capabilities": ["streaming", "tools"]}
```

---

### 🟡 DESIGN-004 — `alwaysAliveAgent` Proxy Quebra `instanceof`

**Arquivo**: `src/copilot/agent/always-alive.js`

```js
export const alwaysAliveAgent = new Proxy({}, { ... });
```

Consequências:

- `alwaysAliveAgent instanceof AlwaysAliveAgent` → `false`
- `Object.keys(alwaysAliveAgent)` → retorna as keys do agente (correto via ownKeys trap)
- Ferramentas de profiling/debugging veem `{}` ao inspecionar

**Alternativa recomendada** — usar getter late-binding via módulo ES:

```js
// alwaysAliveAgent.js
export function getAlwaysAliveAgent() {
  return getAgent(); // lazy singleton, sem Proxy
}
// Para compatibilidade, re-export com nome:
export { getAlwaysAliveAgent as alwaysAliveAgent };
```

---

### 🟡 DESIGN-005 — `cleanupStaleSessions` Sem Rate Limiting

**Arquivo**: `src/copilot/agent/session/cleanup.js`

```js
const outcomes = await Promise.allSettled(toDelete.map(({ id }) => deleteSession(client, id)));
```

Todas as sessões stale são deletadas em paralelo. Em cenários com muitas sessões acumuladas
(reinicializações frequentes), isso pode causar rate limiting do SDK ou sobrecarga do CLI.

**Correção**: Batch de 5 deleções em paralelo, pausando entre batches:

```js
const BATCH_SIZE = 5;
const BATCH_DELAY_MS = 500;

for (let i = 0; i < toDelete.length; i += BATCH_SIZE) {
  const batch = toDelete.slice(i, i + BATCH_SIZE);
  const results = await Promise.allSettled(batch.map(({ id }) => deleteSession(client, id)));
  // ... processar results
  if (i + BATCH_SIZE < toDelete.length) {
    await new Promise((r) => setTimeout(r, BATCH_DELAY_MS));
  }
}
```

---

### 🟡 DESIGN-006 — `pendingQuestionShadowExpiresAt` Aceita Zero Como Válido

**Arquivo**: `src/copilot/agent/dialog/pending-question-shadow.js`

```js
export function getPendingQuestionShadowExpiresAt(shadow, ttlMs) {
    const resolvedTtlMs = ...;
    return typeof shadow.expiresAt === 'number' ? shadow.expiresAt : shadow.meta.askedAt + resolvedTtlMs;
}
```

Se `shadow.expiresAt === 0` (número válido mas semanticamente inválido), a shadow aparecerá como
expirada imediatamente (epoch 0 < Date.now()). Dados corrompidos no JSON de estado poderiam causar
isso.

**Correção**:

```js
return typeof shadow.expiresAt === 'number' && shadow.expiresAt > 0
  ? shadow.expiresAt
  : shadow.meta.askedAt + resolvedTtlMs;
```

---

### 🟡 DESIGN-007 — `sendTurn()` em `engine.js` Descarta Mensagem Silenciosamente

**Arquivo**: `src/copilot/terminal/dialog/engine.js`

```js
if (_turnQueueDepth >= MAX_TURN_QUEUE_SIZE) {
  log('WARN', `[TerminalServer] Fila cheia...`);
  return Promise.resolve(null); // ← SILENCIOSO para o caller
}
```

O caller em `repl.js` faz `await sendTurn(finalMessage, 'user')` sem checar o retorno. Se o usuário
digita uma mensagem quando a fila está cheia, a mensagem **se perde silenciosamente**. O usuário vê
o prompt voltar sem resposta, sem explicação.

**Correção**:

```js
if (_turnQueueDepth >= MAX_TURN_QUEUE_SIZE) {
  broadcastSse('turn.rejected', { reason: 'queue_full', depth: _turnQueueDepth });
  println(
    `\x1b[31m  ⚠ Fila cheia (${_turnQueueDepth}/${MAX_TURN_QUEUE_SIZE}). Aguarde o turno atual concluir.\x1b[0m`,
  );
  return Promise.resolve(null);
}
```

---

## 8. Melhorias Propostas por Módulo

### 8.1 `AgentContext` — Decomposição Continuada

**Situação atual**: 900 linhas, 70+ métodos **Proposta**: Extrair os seguintes managers do contexto:

```
AgentContext
├── SessionManager (session, isResumed, isReconnecting, unsubscribers)
├── DialogManager (pendingQuestion, shadow, dialogLoopAttached)
├── ConfigManager (model, reasoningEffort, mcpBridge)
├── MetricsManager (sendCount, statusSnapshotCache, lastPrInfo)
└── RuntimeManager (status, timers, quotaMonitor, agentObserver, bootReport)
```

Cada manager expõe API semântica restrita e `AgentContext` torna-se um hub de composição, não um
implementador.

---

### 8.2 `DialogLoopManager` — Extração de `BootOrchestrator`

O método `start()` tem 80 linhas com lógica complexa de timeout, late-READY, fallback e
contabilização de PR. Proposta de extração:

```js
class DialogBootOrchestrator {
    constructor(options) { ... }

    async boot(metaPrompt, sendFn) {
        const span = startSpanImmediate('dialog.boot');
        try {
            await this.#attemptBoot(metaPrompt, sendFn);
            this.#costLedger.recordBoot();
        } catch (e) {
            this.#handleBootFailure(e);
            throw e;
        } finally {
            span?.end();
        }
    }

    async #attemptBoot(metaPrompt, sendFn) { ... }
    #handleBootFailure(e) { ... }
}
```

---

### 8.3 `terminal-agent-wiring.js` — Circuit Breaker para Dialog Restart

Ver DESIGN-001. Adicionar:

```js
// circuit-breaker.js
export class DialogRestartCircuitBreaker {
  #failures = 0;
  #state = 'closed'; // 'closed' | 'open' | 'half-open'
  #lastFailureAt = 0;

  constructor({ maxFailures = 3, resetMs = 300_000 } = {}) {
    this.#maxFailures = maxFailures;
    this.#resetMs = resetMs;
  }

  canAttempt() {
    if (this.#state === 'closed') return true;
    if (this.#state === 'open') {
      if (Date.now() - this.#lastFailureAt > this.#resetMs) {
        this.#state = 'half-open';
        return true;
      }
      return false;
    }
    return true; // half-open: allow one attempt
  }

  recordSuccess() {
    this.#failures = 0;
    this.#state = 'closed';
  }
  recordFailure() {
    this.#failures++;
    this.#lastFailureAt = Date.now();
    if (this.#failures >= this.#maxFailures) this.#state = 'open';
  }
}
```

---

### 8.4 `state-io.js` — Migrar para `async-mutex`

Substituir o padrão de `_writeQueue` manual por `Mutex` da biblioteca `async-mutex`:

```js
// Package: async-mutex (já popular, ~100k downloads/semana)
import { Mutex } from 'async-mutex';
const _writeMutex = new Mutex();

export async function writeStateAsync(updates) {
  return _writeMutex.runExclusive(async () => {
    const current = (await readStateAsync()) ?? _defaultState();
    const next = { ...current, ...updates };
    await writeFile(STATE_FILE, JSON.stringify(next, null, 4), 'utf8');
    _stateCache = next;
    return next;
  });
}
```

Vantagens: elimina o padrão de `_writeQueue` manual que tem o bug RACE-001.

---

### 8.5 `hook-context.js` — Cache com TTL para `buildHookSystemContextSafe`

A função lê arquivos do disco em cada boot de sessão. Para sessões de longa duração com múltiplos
reconnects, isso representa I/O desnecessário:

```js
let _contextCache = null;
let _contextCacheAt = 0;
const CONTEXT_CACHE_TTL_MS = 30_000; // 30 segundos

export async function buildHookSystemContextSafe() {
  const now = Date.now();
  if (_contextCache && now - _contextCacheAt < CONTEXT_CACHE_TTL_MS) {
    return _contextCache;
  }
  const raw = await buildHookSystemContext();
  // ... (truncamento existente)
  _contextCache = result;
  _contextCacheAt = now;
  return result;
}

// Invalidar quando skills mudarem
export function invalidateHookContextCache() {
  _contextCache = null;
}
```

E chamar `invalidateHookContextCache()` no handler `pinnedFilesChangedHandler` de
`terminal/index.js`.

---

### 8.6 `alias-store.js` — Persistência de Remoção de Built-ins

Atualmente, remover um built-in alias só afeta o cache em memória. Adicionar suporte a "tombstones":

```js
// Salvar aliases deletados como lista explícita
const _deletedBuiltins = new Set();

export function removeAlias(name) {
  const key = name.startsWith('/') ? name : `/${name}`;
  if (!(key in _aliases)) return false;
  delete _aliases[key];
  if (BUILTIN_ALIASES[key] !== undefined) {
    _deletedBuiltins.add(key); // marcar como excluído
  }
  _saveCustomAliases();
  return true;
}

async function _saveCustomAliasesAsync() {
  const custom = {};
  for (const [k, v] of Object.entries(_aliases)) {
    if (BUILTIN_ALIASES[k] === undefined || BUILTIN_ALIASES[k] !== v) {
      custom[k] = v;
    }
  }
  const data = {
    aliases: custom,
    deletedBuiltins: [..._deletedBuiltins],
  };
  await writeFile(ALIASES_FILE, JSON.stringify(data, null, 2));
}
```

---

### 8.7 `cleanup.js` — Throttled Batch Deletion

Ver DESIGN-005. Implementação de batch:

```js
const CLEANUP_BATCH_SIZE = 5;
const CLEANUP_BATCH_DELAY_MS = 200;

async function deleteBatched(client, sessions) {
  const results = [];
  for (let i = 0; i < sessions.length; i += CLEANUP_BATCH_SIZE) {
    const batch = sessions.slice(i, i + CLEANUP_BATCH_SIZE);
    const batchResults = await Promise.allSettled(batch.map((s) => deleteSession(client, s.id)));
    results.push(...batchResults);
    if (i + CLEANUP_BATCH_SIZE < sessions.length) {
      await new Promise((r) => setTimeout(r, CLEANUP_BATCH_DELAY_MS));
    }
  }
  return results;
}
```

---

### 8.8 `turn-executor.js` — Melhorar Fallback Semântico

O `createAssistantReplyFallback()` captura `delta` e `assistant.message` como fallback quando
`ask_user("REPLY: ...")` não chega. O problema é que `deltaCandidate` acumula todo o streaming do
turno sem limite de tamanho:

```js
const onTaskDelta = (rawEvt) => {
  const chunk = Reflect.get(rawEvt, 'chunk');
  if (typeof chunk === 'string' && chunk.length > 0) {
    deltaCandidate += chunk; // ← unbounded
  }
};
```

**Correção**: Limitar a 50KB ou truncar para fins de detecção (não é o texto completo da resposta):

```js
const MAX_DELTA_FALLBACK = 50_000;
if (deltaCandidate.length < MAX_DELTA_FALLBACK) {
  deltaCandidate += chunk;
}
```

---

### 8.9 Observabilidade — OpenTelemetry Traces Faltantes

Os seguintes caminhos críticos não têm spans OTEL:

- `agentTryReconnect()` completo (há `startSpan('copilot.reconnect')` em reconnect-policy, mas não
  cobre o caller)
- `persistStateWithPolicy()` — writes de estado frequentes sem instrumentação
- `buildHookSystemContextSafe()` — pode ser lento por I/O

**Adições sugeridas**:

```js
// em persistStateWithPolicy:
return startSpan('copilot.state.persist', { label: opts.label ?? 'unknown' },
    () => withAgentErrorPolicy(() => writeStateAsync(data), ...));

// em buildHookSystemContextSafe:
return startSpan('copilot.boot.hookContext', {}, buildHookSystemContextSafe);
```

---

### 8.10 `repl.js` — Completions Incrementais por Histórico

O `_completer` atual sugere apenas comandos fixos. Melhorias:

```js
function _completer(line) {
  if (!line.startsWith('/')) {
    // Auto-complete com palavras do histórico de conversa
    const histWords = readTerminalHistoryFeed()
      .flatMap((t) => t.content.split(/\s+/))
      .filter((w) => w.startsWith(line) && w.length > 3);
    return [[...new Set(histWords)], line];
  }
  // ... comandos existentes
}
```

---

## 9. Upgrades de Dependências e SDK

### 9.1 GitHub Copilot SDK — Public Preview (Abril 2026)

O SDK entrou em Public Preview em 02/04/2026 com novas features:

| Feature Nova                                                                    | Relevância para o projeto                                                   |
| ------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| **Fine-grained system prompt customization** (replace/append/prepend/transform) | `buildSystemMessage()` pode usar a nova API nativa em vez do wrapper custom |
| **Custom agents nomeados** em `~/.copilot/agents`                               | Já usado via `buildCustomAgentsConfig()`                                    |
| **Java SDK** (Maven)                                                            | N/A                                                                         |
| **BYOK** (Bring Your Own Key)                                                   | Permite usar Claude/OpenAI sem subscrição Copilot — útil para ambientes CI  |

**Ação recomendada**: Migrar `buildSystemMessage()` para usar a API nativa de customização de
sistema do SDK, eliminando o wrapper intermediário e aproveitando callbacks `transform` para
contexto dinâmico.

### 9.2 Node.js — Explicit Resource Management (ES2025)

O projeto já usa `Symbol.asyncDispose` e `Symbol.dispose` em `AlwaysAliveAgent`. Aproveitar mais
amplamente:

```js
// Em session/cleanup.js
async function withSession(client, fn) {
  const { session } = await createSession(client, opts);
  await using s = { [Symbol.asyncDispose]: () => session.disconnect() };
  return fn(session);
}
```

### 9.3 `zod` — Schema Validation

O projeto usa Zod para validar `session.json` e estado persistido. Recomendação:

- Atualizar para Zod 4 (lançado em 2025) que oferece ~14x melhor performance de parsing
- Adicionar schemas Zod para os payloads SSE (atualmente são `object` não tipados)

### 9.4 `node:fs/promises` — `FileHandle.readableWebStream()`

Nos módulos que leem arquivos grandes (como `buildHookSystemContextSafe`), considerar usar
`ReadableStream` com backpressure em vez de ler todo o arquivo em buffer:

```js
// Em vez de:
const content = await readFile(BRIEFING_FILE, 'utf8');

// Para arquivos grandes:
const fh = await open(BRIEFING_FILE, 'r');
const stream = fh.readableWebStream();
const reader = stream.getReader();
let content = '';
let bytesRead = 0;
while (bytesRead < MAX_READ_LIMIT) {
  const { done, value } = await reader.read();
  if (done) break;
  content += new TextDecoder().decode(value);
  bytesRead += value.length;
}
```

---

## 10. Roadmap de Refatoração Priorizado

### Sprint 1 — Bugs Críticos (imediato)

| Item                                                     | Arquivo                                     | Impacto    | Esforço |
| -------------------------------------------------------- | ------------------------------------------- | ---------- | ------- |
| BUG-001: Re-wire session events após reconnect           | `agent-lifecycle.js`, `reconnect-policy.js` | 🔴 Crítico | Alto    |
| BUG-002: Dupla emissão 'stopped' no boot                 | `loop-manager.js`                           | 🔴 Crítico | Médio   |
| BUG-003: TurnQueue depth negativo                        | `backpressure.js`                           | 🔴 Crítico | Baixo   |
| BUG-004: Listeners handoff/question-answered sem cleanup | `boot-steps.js`                             | 🟠 Alto    | Baixo   |
| BUG-005: LOOP_READY durante stop()                       | `loop-manager.js`                           | 🟠 Alto    | Baixo   |

### Sprint 2 — Segurança e Concorrência (semana 2)

| Item                                       | Arquivo                    | Impacto  | Esforço |
| ------------------------------------------ | -------------------------- | -------- | ------- |
| RACE-001: Mutex write queue                | `state-io.js`              | 🟠 Alto  | Médio   |
| BUG-006: gracefulShutdown race             | `agent-lifecycle.js`       | 🟠 Alto  | Médio   |
| SEC-001: sanitizeBriefingContent           | `hook-context.js`          | 🟠 Alto  | Baixo   |
| DESIGN-001: Circuit breaker dialog restart | `terminal-agent-wiring.js` | 🟡 Médio | Médio   |
| DESIGN-002: Compaction critical rate limit | `compaction-policy.js`     | 🟡 Médio | Baixo   |

### Sprint 3 — Memory, Performance e DX (semana 3-4)

| Item                                    | Arquivo                             | Impacto  | Esforço |
| --------------------------------------- | ----------------------------------- | -------- | ------- |
| LEAK-001: Dialog loop listeners cleanup | `event-wirer.js`, `event-wiring.js` | 🟠 Alto  | Médio   |
| LEAK-003: Activity emitter cleanup      | `activity-state.js`, `index.js`     | 🟡 Médio | Baixo   |
| LEAK-004: SessionMessagesCache limit    | `history-sync.js`                   | 🟡 Médio | Baixo   |
| DESIGN-005: Throttled cleanup           | `cleanup.js`                        | 🟡 Médio | Baixo   |
| DESIGN-007: Turn rejection com feedback | `engine.js`                         | 🟡 Médio | Baixo   |
| 8.5: Cache para hookContext             | `hook-context.js`                   | 🟢 Baixo | Baixo   |

### Sprint 4 — Refatoração Arquitetural (planejamento)

| Item                                          | Esforço Estimado |
| --------------------------------------------- | ---------------- |
| Decomposição de `AgentContext` em managers    | 2-3 semanas      |
| Extração de `DialogBootOrchestrator`          | 1 semana         |
| Migração `buildSystemMessage` para SDK nativo | 0.5 semana       |
| Proxy → getter late-binding                   | 0.5 semana       |
| Atualização Zod v4 + schemas SSE              | 1 semana         |

---

## Apêndice A — Checklist de Testes Críticos

Para cada bug corrigido, os seguintes testes devem cobrir:

### BUG-001 (Session Re-wire)

```
✓ Após agentTryReconnect(), session.token_budget_warning é recebido
✓ Após agentTryReconnect(), session.compaction_complete reseta o flag de compaction
✓ Após agentTryReconnect(), tool.execution_start é emitido no próximo turno
✓ sessionEventUnsubscribers contém exatamente N unsubs (mesmo count da sessão original)
```

### BUG-002 (Dupla emissão)

```
✓ 'dialog.stopped' é emitido exatamente 1 vez quando bootSendFn falha com timeout
✓ 'dialog.stopped' é emitido exatamente 1 vez quando bootPromise expira
✓ ensureDialogLoop() não é chamado 2x simultâneos após falha de boot
```

### BUG-003 (TurnQueue depth)

```
✓ forceDeactivate() seguido de novo start() → depth === 0 antes do primeiro enqueue
✓ queueDepth nunca vai negativo mesmo com reset() chamado durante execução
✓ get full() retorna false após reset() + novo enqueue
```

### RACE-001 (Write mutex)

```
✓ 100 chamadas simultâneas a writeStateAsync() produzem exatamente 1 arquivo escrito
✓ Estado final reflete TODOS os updates, não apenas o último
✓ Nenhuma write sobrescreve a anterior completamente (merge correto)
```

---

## Apêndice B — Comandos de Diagnóstico Sugeridos

Adicionar ao `/diagnose`:

```
dialog.bootFailures     — contador de falhas de boot desde o início
circuit.state           — estado do circuit breaker (closed/open/half-open)
writeQueue.depth        — profundidade atual da fila de writes de estado
cache.hookContext.age   — idade do cache do hookContext (ms)
listeners.agentEmitter  — contagem de listeners por evento (para detectar leaks)
```

Adicionar endpoint HTTP `GET /agent/listeners` que retorna:

```json
{
  "by_event": {
    "session.token_budget_warning": 1,
    "session.compaction_complete": 1,
    "question.pending": 2,
    ...
  },
  "total": 45,
  "max_configured": 50
}
```

---

## Apêndice C — Referências

- GitHub Copilot SDK Public Preview: https://github.com/github/copilot-sdk
- Copilot SDK Public Preview changelog (abril 2026):
  https://github.blog/changelog/2026-04-02-copilot-sdk-in-public-preview/
- Node.js Promise-chain mutex pattern:
  https://nodejsdesignpatterns.com/blog/node-js-race-conditions/
- EventEmitter Memory Leak best practices:
  https://medium.com/@hemangibavasiya08/common-memory-leak-patterns-in-node-js
- Explicit Resource Management (TC39): https://github.com/tc39/proposal-explicit-resource-management
- `async-mutex` package: https://github.com/DirtyHairy/async-mutex
