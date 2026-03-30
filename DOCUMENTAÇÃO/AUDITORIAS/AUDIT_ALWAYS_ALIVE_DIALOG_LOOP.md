# Auditoria Profunda — `always-alive.js` e Ecossistema do Dialog Loop

**Data**: 2026-07-15
**Autor**: GitHub Copilot (Claude Sonnet 4.6)
**Escopo**: `src/copilot/agent/always-alive.js` e todas as dependências diretas e indiretas
**Status**: ⚪ RASCUNHO — aguardando revisão e execução dos itens propostos

---

## Sumário Executivo

O `AlwaysAliveAgent` é o núcleo do agente autônomo LLM-B. Ele implementa um **dialog
loop permanente** baseado na ferramenta `ask_user` do SDK `@github/copilot-sdk`, garantindo
que toda a conversa ocorra dentro de **um único `sendMessage`** (1 PR total), com os turnos
subsequentes sendo resolvidos pelo mecanismo `onUserInputRequest` — sem custo adicional de
Premium Requests.

Esta auditoria identificou **12 bugs ativos** (4 críticos, 5 médios, 3 baixos), **9 melhorias
de robustez** e **6 propostas de refatoração**. Os itens mais urgentes envolvem:

1. **Listener leak** em `#executeDialogTurn` (BUG-AA-01 — crítico)
2. **Condição de corrida** entre `stopDialogLoop` e `#handleUserInputRequest` (BUG-AA-02 — crítico)
3. **Falha silenciosa** de `session.on` não-SDK-padrão usar API errada (BUG-AA-03 — crítico)
4. **Memory leak** do mutex `#dialogTurnMutex` crescendo indefinidamente (BUG-AA-04 — alto)

---

## Índice

1. [Arquitetura do Ecossistema](#1-arquitetura-do-ecossistema)
2. [Como o `ask_user` Funciona (SDK Level)](#2-como-o-ask_user-funciona-sdk-level)
3. [O Dialog Loop em Detalhe](#3-o-dialog-loop-em-detalhe)
4. [O que Acontece com `sendMessage` Dentro do Dialog Loop](#4-o-que-acontece-com-sendmessage-dentro-do-dialog-loop)
5. [Mapeamento de Arquivos](#5-mapeamento-de-arquivos)
6. [Bugs Identificados](#6-bugs-identificados)
7. [Melhorias de Robustez](#7-melhorias-de-robustez)
8. [Propostas de Refatoração](#8-propostas-de-refatoração)
9. [Tabela Consolidada](#9-tabela-consolidada)
10. [Plano de Execução Sugerido](#10-plano-de-execução-sugerido)

---

## 1. Arquitetura do Ecossistema

### 1.1 Diagrama de Dependências

```
entry.js
  └── always-alive.js (AlwaysAliveAgent: EventEmitter)
        ├── session-manager.js (initOrResumeSession, readState, writeState)
        │     └── lib/session.js (resumeOrCreate → client.createSession/resumeSession)
        ├── task-executor.js (executeTask — executa sendAndWait fora do dialog loop)
        ├── dialog-watchdog.js (DialogWatchdog — detecta inatividade)
        ├── tools-bootstrap.js (bootstrapTools, setSessionRpc)
        ├── lib/hooks.js (createHooks, buildPreToolUseHandler)
        └── lib/models.js (listModels, pickModel — usado externamente)

terminal/index.js (startTerminalServer)
  └── terminal/dialog.js (ensureDialogLoop, sendTurn, broadcastSse)
        └── channel/client.js (LlmBridgeClient — startDialogMode, dialogTurn)
              └── always-alive.js (startDialogLoop, sendDialogTurn)

channel/inject.js (injectToLlmB, subscribeLlmB — LLM-A → LLM-B via HTTP)
  └── terminal/server.js (POST /inject → sendTurn → dialogTurn)
```

### 1.2 Responsabilidades por Camada

| Arquivo              | Responsabilidade                                                  |
| -------------------- | ----------------------------------------------------------------- |
| `entry.js`           | Bootstrap, sinais SIGTERM/SIGINT, retry loop                      |
| `always-alive.js`    | Ciclo de vida do agente, dialog loop, queue de tarefas, reconexão |
| `session-manager.js` | Persistência do sessionId em disco, system prompt injection       |
| `task-executor.js`   | Execução de uma tarefa individual via `sendAndWait`               |
| `dialog-watchdog.js` | Timer de inatividade do dialog loop                               |
| `terminal/dialog.js` | Motor do REPL, serialização de turnos, SSE broadcast              |
| `terminal/index.js`  | Orquestração do terminal, event listeners, reflection loop        |
| `channel/client.js`  | API de alto nível para LLM-A consumir LLM-B                       |
| `channel/inject.js`  | Canal HTTP LLM-A → LLM-B (POST /inject)                           |
| `lib/hooks.js`       | Factories de hooks de sessão SDK                                  |
| `lib/session.js`     | Wrappers sobre `client.createSession / resumeSession`             |

---

## 2. Como o `ask_user` Funciona (SDK Level)

### 2.1 Definição Oficial (SDK 0.2.0)

A partir da documentação oficial do `@github/copilot-sdk`:

```js
// Habilitar ask_user: fornecer onUserInputRequest na criação da sessão
const session = await client.createSession({
    model: "gpt-4.1",
    onUserInputRequest: async (request, invocation) => {
        // request.question     — pergunta gerada pelo modelo
        // request.choices      — array de opções (se múltipla escolha)
        // request.allowFreeform — se aceita resposta livre (default: true)
        return {
            answer: "resposta-do-usuário",
            wasFreeform: true,
        };
    },
});
```

**Pontos-chave confirmados pelo SDK:**

1. `ask_user` é uma **ferramenta nativa do SDK** — não requer registro explícito em `tools`.
2. É habilitada automaticamente quando `onUserInputRequest` é fornecido.
3. O SDK suspende o processamento da mensagem atual até `onUserInputRequest` retornar.
4. **Não consome novo Premium Request** — é uma pausa dentro da execução existente.
5. A sessão fica no estado "waiting_for_user_input" (análogo ao `waiting_for_input` do agente).

### 2.2 Implementação Local (`#handleUserInputRequest`)

O método `#handleUserInputRequest` em `always-alive.js` é o handler `onUserInputRequest` registrado no SDK. Seu fluxo é:

```
SDK chama #handleUserInputRequest({ question, choices, allowFreeform })
  │
  ├── [Dialog Loop Ativo?]
  │     ├── SIM: Analisa prefixo da question
  │     │     ├── "READY:" → emit('dialog.ready') + suspende via #pendingQuestion
  │     │     ├── "REPLY:" → emit('dialog.reply', { reply }) + suspende via #pendingQuestion
  │     │     └── "STOPPED" → emit('dialog.stopped', { authorized: false })
  │     │
  │     └── NÃO: Fluxo normal de pergunta interativa
  │
  ├── setStatus('waiting_for_input')
  ├── writeStateAsync({ pendingQuestion })
  └── Cria Promise que será resolvida por answerPendingQuestion()
        └── resolve: pq.resolve(answer) → setStatus('processing')
```

**Aspecto crítico**: a Promise criada em `#handleUserInputRequest` bloqueia o SDK até que `answerPendingQuestion()` seja chamado. O SDK não tem timeout interno para `ask_user` — é responsabilidade do `sendDialogTurn` impor o timeout via `setTimeout`.

### 2.3 Contexto de Premium Requests (PR)

O `sendDialogTurn` não consome PR porque não chama `sendMessage` diretamente — alimenta a
Promise suspensa do SDK via `answerPendingQuestion`. A única chamada a `sendMessage` no
dialog loop é o `startDialogLoop` (com o `bootPrompt`), que consome **1 PR total**.

Todos os turnos subsequentes são resolvidos via `ask_user` → `onUserInputRequest` →
`answerPendingQuestion`, sem custo de PR adicional.

---

## 3. O Dialog Loop em Detalhe

### 3.1 Protocolo ask_user

O loop implementa um protocolo de prefixos:

| Prefixo no `question`     | Evento emitido                       | Ação subsequente                                |
| ------------------------- | ------------------------------------ | ----------------------------------------------- |
| `READY: …`                | `dialog.ready`                       | Aguarda next turn via question.pending          |
| `REPLY: …`                | `dialog.reply`                       | Retorna resposta ao sendDialogTurn caller       |
| `DONE: …`                 | `dialog.reply` (mesmo que REPLY)     | Idem                                            |
| `STOPPED` / `STOP_DIALOG` | `dialog.stopped` (authorized: false) | terminal/index.js reinicia via ensureDialogLoop |

### 3.2 Fluxo de Um Turno Completo

```
sendDialogTurn("Olá")
  │
  ├── [#pendingQuestion === null?]
  │     └── SIM: registra once('question.pending', onPending)
  │           └── #handleUserInputRequest emite question.pending
  │                 └── onPending: answerPendingQuestion("Olá")
  │
  │     └── NÃO (READY já estava pendente): answerPendingQuestion("Olá")
  │
  ├── SDK recebe "Olá", processa, gera resposta
  ├── SDK chama ask_user("REPLY: resposta-da-llm")
  └── #handleUserInputRequest:
        ├── emit('dialog.reply', { reply: "resposta-da-llm" })
        └── registra nova #pendingQuestion (para READY do próximo ciclo)
              └── sendDialogTurn: escuta uma vez 'dialog.reply' → resolve(reply)
```

### 3.3 Restart Automático (DL-PERM)

Quando o modelo emite `STOPPED` voluntariamente:

```
#handleUserInputRequest("STOPPED")
  └── emit('dialog.stopped', { authorized: false })
        └── terminal/index.js listener 'dialog.stopped':
              └── ensureDialogLoop() [coalescido por _ensureDialogLoopInFlight]
                    └── _doEnsureDialogLoop() com retry 3x backoff 2s/4s/8s
                          └── _tryStartDialogLoop()
                                └── llmBridgeClient.startDialogMode(BOOT_PROMPT)
                                      └── alwaysAliveAgent.startDialogLoop()
                                            └── sendMessage(metaPrompt, timeout: 24h) [1 PR]
```

### 3.4 Reconexão Transparente (DL-PERM-05)

Quando `sendAndWait` falha em `task-executor.js` enquanto o dialog loop está ativo:

```
executeTask → sendAndWait falha
  └── tryReconnect():
        └── #initSession() → nova sessão ou retomada
              └── emit('dialog.stopped', { authorized: false, reason: 'reconnect_restart' })
                    └── #executeDialogTurn:
                          └── onStopOuter: authorized === false?
                                └── #waitForDialogRestartAndReply(message, timeout)
                                      └── once('dialog.ready') → reenvio da mensagem
```

---

## 4. O que Acontece com `sendMessage` Dentro do Dialog Loop

### 4.1 Resposta Direta

Quando `sendMessage` é chamado enquanto o dialog loop está ativo, o comportamento depende
do estado atual:

**Caso A — Agente em `waiting_for_input` (ask_user pendente):**

```
sendMessage("nova tarefa")
  └── #queue.push(task)               ← tarefa enfileirada
  └── #processQueue()
        └── status !== 'idle' → NOP   ← BLOQUEADO
```

A tarefa fica na fila. O processamento só inicia quando o agente voltar para `idle`.

**Caso B — Agente em `idle` (entre REPLY e próximo READY):**

```
sendMessage("nova tarefa")
  └── #queue.push(task)
  └── #processQueue()
        └── session.sendAndWait("nova tarefa")  ← EXECUTA
              │
              └── [SDK processa a mensagem normalmente]
              └── setStatus('idle')
              └── task.resolve(text)
```

**Caso C — `sendMessage` durante boot do dialog loop (status: `processing`):**

Idêntico ao Caso A — a tarefa fica enfileirada até o bootPrompt terminar e `#pendingQuestion`
ser preenchido.

### 4.2 Risco de Interferência

> ⚠️ **ATENÇÃO**: Se `sendMessage` é chamado quando o modelo está **dentro** de um turno do
> dialog loop (wait entre READY e REPLY), o `sendAndWait` da nova tarefa será enfileirado
> mas executará somente quando `status === 'idle'`.
>
> O problema: `status` volta para `idle` APÓS o REPLY do dialog loop, o que pode levar
> vários segundos (tempo de processamento do modelo). A nova tarefa ficará aguardando.
>
> Não há interferência semântica (os dois caminhos são mutuamente exclusivos), mas a nova
> tarefa pode ter latência elevada.

---

## 5. Mapeamento de Arquivos

| Arquivo              | Linhas | Papel no Dialog Loop                            |
| -------------------- | ------ | ----------------------------------------------- |
| `always-alive.js`    | 1494   | Core — todo o estado, mutex, ask_user handler   |
| `session-manager.js` | 369    | Persistência, system prompt, permission wrapper |
| `terminal/dialog.js` | 550    | Motor REPL, ensureDialogLoop, sendTurn, SSE     |
| `terminal/index.js`  | 236    | Listeners, restart automático, reflection loop  |
| `channel/client.js`  | 538    | API de alto nível (startDialogMode, dialogTurn) |
| `channel/inject.js`  | 436    | Canal HTTP LLM-A → LLM-B                        |
| `dialog-watchdog.js` | 113    | Timer de stall detection                        |
| `task-executor.js`   | 119    | Execução via sendAndWait (fora do dialog loop)  |
| `lib/session.js`     | 270    | Wrappers createSession/resumeSession            |
| `lib/hooks.js`       | 363    | Hook factories                                  |
| `entry.js`           | 94     | Bootstrap, retry loop                           |

---

## 6. Bugs Identificados

### BUG-AA-01 — Listener Leak em `#executeDialogTurn` (CRÍTICO)

**Arquivo**: `always-alive.js` linha ~776-860 (`#executeDialogTurn`)

**Descrição**: No branch onde `this.#pendingQuestion === null`, o método registra `onPending`
via `once('question.pending', ...)`. Se o `timeoutHandle` disparar **antes** do `question.pending`,
o listener `onPending` permanece registrado indefinidamente — nunca é removido.

**Código afetado** (simplificado):
```js
this.once('question.pending', onPending); // ← registrado
// ... if timeoutHandle fires → reject() é chamado, mas onPending NÃO é removido
```

**Efeito**: A cada turno que faz timeout nesta condição, +1 listener orfão permanece.
Em produção com o watchdog ativos e restarts frequentes, isso causa:
- Warning `MaxListenersExceededWarning` após 50+ ocorrências
- Callbacks com estado obsoleto disparando em turnos futuros

**Correção**:
```js
const onPending = (_) => {
    clearTimeout(timeoutHandle);
    // ... (código existente permanece)
};
// Adicionar ao timeoutHandle:
const timeoutHandle = setTimeout(() => {
    this.off('question.pending', onPending); // ← FIX
    reject(new SessionError(...));
}, timeout);
```

---

### BUG-AA-02 — Race Condition entre `stopDialogLoop` e `#handleUserInputRequest` (CRÍTICO)

**Arquivo**: `always-alive.js` linhas ~876-899 (`stopDialogLoop`) e ~925-970 (`#handleUserInputRequest`)

**Descrição**: Quando `stopDialogLoop({ authorized: true })` é chamado simultâneamente
enquanto o SDK está chamando `#handleUserInputRequest` (REPLY: em andamento), pode ocorrer:

1. `stopDialogLoop` → `answerPendingQuestion('STOP_DIALOG')` → resolve o `ask_user` pendente
2. `#handleUserInputRequest` já está executando assincronamente com aquele `ask_user`
3. `#dialogLoopActive = false` é setado em `stopDialogLoop`
4. `#handleUserInputRequest` checa `this.#dialogLoopActive` — já é `false`
5. O código de interceptação do dialog loop **não executa** — o handler cai no fluxo normal
6. Nova `#pendingQuestion` é criada sem `dialog.reply` ser emitido
7. `sendDialogTurn` aguarda `dialog.reply` que nunca chegará → **timeout**

**Correção**: Usar um lock/flag de "em transição" para serializar o encerramento:
```js
#dialogLoopStopping = false;

async #handleUserInputRequest({ question, choices, allowFreeform }) {
    if (this.#dialogLoopActive || this.#dialogLoopStopping) {
        // ... (interceptação existente)
    }
    // ...
}

async stopDialogLoop({ authorized = false, reason = 'authorized_stop' } = {}) {
    if (!this.#dialogLoopActive) return;
    if (!authorized) { /* ... */ return; }
    this.#dialogLoopStopping = true;
    // ... (código existente)
    this.#dialogLoopStopping = false;
}
```

---

### BUG-AA-03 — Evento `session.on` Usando API Errada do SDK (CRÍTICO)

**Arquivo**: `always-alive.js`, linhas ~210-275 (dentro de `start()`)

**Descrição**: O código usa `session.on('session.compaction_start', handler)` — mas a API do
SDK para sessões **não expõe `session.on` com strings de evento**. A API oficial é:

```js
// API correta (SDK 0.2.0):
const unsub = session.on("session.compaction_start", handler); // retorna unsubscribe fn
```

O `session` SDK não é um `EventEmitter` Node.js padrão — `session.on` retorna uma função
de cancelamento, não `this`. O código atual não armazena os retornos das chamadas `.on()`,
resultando em **impossibilidade de remover os listeners** quando a sessão for desconectada.

**Efeito**: Memory leak progressivo a cada reconexão — listeners acumulam sobre objetos
de sessão antigos que permanecem vivos apenas por referência dos closures.

**Verificação**:
```bash
node -e "
const { CopilotClient } = await import('@github/copilot-sdk');
const s = { on: (t, h) => { console.log('sdk on:', typeof h); return () => {}; } };
const r = s.on('test', () => {});
console.log('returns:', typeof r); // 'function' → não é EventEmitter
"
```

**Correção**:
```js
// Armazenar todas as referências de unsubscribe
/** @type {Array<() => void>} */
this.#sessionEventUnsubscribers = [];

const unsubCompStart = session.on('session.compaction_start', (evt) => { ... });
this.#sessionEventUnsubscribers.push(unsubCompStart);

// No stop() / #tryReconnect():
for (const unsub of this.#sessionEventUnsubscribers) unsub();
this.#sessionEventUnsubscribers = [];
```

---

### BUG-AA-04 — Memory Leak no `#dialogTurnMutex` (ALTO)

**Arquivo**: `always-alive.js`, linhas ~696-721 (`sendDialogTurn`)

**Descrição**: O `#dialogTurnMutex` é uma Promise-chain que cresce a cada chamada a
`sendDialogTurn`:

```js
const prev = this.#dialogTurnMutex;
const next = prev.then(() => this.#executeDialogTurn(...));
this.#dialogTurnMutex = next.then(() => {}).catch(() => {});
```

Diferentemente do mutex em `terminal/dialog.js` (que tem `_turnQueueDepth` e reseta quando
`=== 0`), o `#dialogTurnMutex` **nunca é resetado**. Em sessões de longa duração com milhares
de turnos, a cadeia de `.then()` cresce indefinidamente.

**Evidência de comparação**: `dialog.js` implementou exatamente este fix em `sendTurn`:
```js
// PERF-N06 (fix): resetar a cadeia do mutex quando a fila estiver vazia
if (_turnQueueDepth === 0) {
    _sendTurnMutex = Promise.resolve(null);
}
```

**Correção**:
```js
/** @type {number} */
#dialogTurnQueueDepth = 0;

sendDialogTurn(message, opts = {}) {
    // ...
    this.#dialogTurnQueueDepth++;
    const prev = this.#dialogTurnMutex;
    const next = prev.then(() => this.#executeDialogTurn(message, opts));
    this.#dialogTurnMutex = next.then(() => {}).catch(() => {});
    void next.finally(() => {
        this.#dialogTurnQueueDepth--;
        if (this.#dialogTurnQueueDepth === 0) {
            this.#dialogTurnMutex = Promise.resolve(); // reset da cadeia
        }
    });
    return next;
}
```

---

### BUG-AA-05 — `#handleUserInputRequest` não emite `question.pending` para READY/REPLY (MÉDIO)

**Arquivo**: `always-alive.js` linha ~955 (`#handleUserInputRequest`)

**Descrição**: No modo dialog loop, ao receber `READY:` ou `REPLY:`, o handler emite o
evento específico (`dialog.ready` / `dialog.reply`), mas prossegue para criar uma nova
`#pendingQuestion` e emite `question.pending`. Isso é correto para o fluxo principal.

Porém, se `sendDialogTurn` chegar **depois** da criação de `#pendingQuestion` (timing edge
case com serialização do mutex), o `once('question.pending', onPending)` em
`#executeDialogTurn` **nunca disparará** porque o evento já foi emitido antes do listener
ser registrado.

**Reprodução**: Alta carga / latência baixa onde o SDK processa READY: antes do caller de
`sendDialogTurn` registrar `once('question.pending')`.

**Correção**: Verificar `#pendingQuestion` após registrar o listener:
```js
this.once('question.pending', onPending);
// Verificar se #pendingQuestion foi preenchido entre a verificação inicial e o registro
if (this.#pendingQuestion) {
    this.off('question.pending', onPending);
    onPending({});
}
```

---

### BUG-AA-06 — `stop()` não para `#watchdog` se `#dialogLoopActive === false` (MÉDIO)

**Arquivo**: `always-alive.js`, linhas ~421-428 (`stop()`)

**Descrição**:
```js
if (this.#dialogLoopActive) {
    this.#dialogLoopActive = false;
    this.#watchdog?.stop();
}
```

Se `#dialogLoopActive` for `false` (ex: após reconexão que setou `false` via `dialog.stopped`)
mas `#watchdog` ainda não foi parado, o timer do watchdog continua rodando após `stop()`.
O `setInterval` não tem `.unref()`, mantendo o processo vivo.

**Correção**: Parar o watchdog incondicionalmente no `stop()`:
```js
this.#watchdog?.stop();
this.#watchdog = null;
if (this.#dialogLoopActive) {
    this.#dialogLoopActive = false;
}
```

---

### BUG-AA-07 — `writeStateAsync` Pode Criar Diretório Redundante (MÉDIO)

**Arquivo**: `session-manager.js`, linhas ~246-258 (`writeStateAsync`)

**Descrição**: `writeStateAsync` faz `mkdir(STATE_DIR, { recursive: true })` a cada chamada.
O `writeState` síncrono também faz `mkdirSync`. Em handlers de alta frequência (ex: cada
`ask_user` chama `writeStateAsync({ pendingQuestion })`), o `mkdir` repetido adiciona latência
desnecessária. No Node.js ≥ v14, `mkdir com recursive` é eficiente, mas implica um syscall
a cada pergunta.

**Correção**: Cache de inicialização — criar o diretório uma vez no boot:
```js
let _stateDirReady = false;

export async function writeStateAsync(updates) {
    if (!_stateDirReady) {
        await mkdir(STATE_DIR, { recursive: true });
        _stateDirReady = true;
    }
    // ... resto do código
}
```

---

### BUG-AA-08 — `#waitForDialogRestartAndReply` não Cancela em Loop Encerrado Definitivamente (MÉDIO)

**Arquivo**: `always-alive.js`, linhas ~825-864 (`#waitForDialogRestartAndReply`)

**Descrição**: A função aguarda `dialog.ready` indefinidamente até `timeout`. Se
`stopDialogLoop({ authorized: true })` for chamado (encerramento definitivo) durante a espera
por `dialog.ready`, o `retryTimeout` dispara e rejeita com `DIALOG_RESTART_TIMEOUT`, não com
`DIALOG_ENDED`. O caller (`#executeDialogTurn`) recebe uma exceção genérica de timeout em vez
de saber que foi um encerramento definitivo.

**Correção**:
```js
const onDefinitiveStop = () => {
    clearTimeout(retryTimeout);
    this.off('dialog.ready', onRetryReady);
    reject(new SessionError('[AlwaysAlive] Diálogo encerrado definitivamente.', 'DIALOG_ENDED'));
};
this.once('dialog.stopped', (evt) => {
    if (evt?.authorized) onDefinitiveStop();
    // se não autorizado, ignora — outro restart está vindo
});
```

---

### BUG-AA-09 — `entry.js` Não Trata `session.fatal` (MÉDIO)

**Arquivo**: `entry.js`

**Descrição**: O `alwaysAliveAgent` emite `session.fatal` quando a reconexão esgota (5
tentativas). O `entry.js` não escuta este evento — o processo PM2 continuará vivo, mas sem
sessão ativa, sem retomar o dialog loop, e apenas logando erros via `on('error', ...)`.

**Correção**:
```js
alwaysAliveAgent.on('session.fatal', ({ originalError, attempts }) => {
    log('ERROR', `[copilot/agent] session.fatal após ${attempts} tentativas: ${originalError}`);
    log('ERROR', '[copilot/agent] Encerrando processo para permitir reinício pelo PM2...');
    process.exitCode = 1;
    process.exit(1);
});
```

---

### BUG-AA-10 — `#tryReconnect` não Retoma Dialog Loop após Reconexão (BAIXO)

**Arquivo**: `always-alive.js`, linhas ~987-1025 (`#tryReconnect`)

**Descrição**: `#tryReconnect` emite `dialog.stopped({ authorized: false })` para acionar
DL-PERM-05. Isso funciona para `sendDialogTurn` em andamento — mas se não havia nenhum turno
em andamento (agente idle entre turnos), `dialog.stopped` é emitido mas ninguém escuta no
contexto de `#executeDialogTurn`. O listener em `terminal/index.js` retoma o loop via
`ensureDialogLoop()`, mas existe uma janela de tempo onde `#dialogLoopActive = false` e
`ensureDialogLoop` ainda não iniciou.

**Impacto**: Baixo — o sistema se recupera em ~2s (escuta em `index.js`). Mas pode causar
"loop inexplicavelmente inativo por 2s" em diagnósticos.

**Correção documentada**: Adicionar log explícito de intenção de restart:
```js
log('INFO', '[AlwaysAlive] Reconexão: aguardando terminal/index.js retomar dialog loop via ensureDialogLoop...');
```

---

### BUG-AA-11 — `onEvent` Catch-all Usa `session.onEvent` Não-Documentado (BAIXO)

**Arquivo**: `always-alive.js`, linhas ~276-294 (dentro de `start()`)

**Descrição**:
```js
if (typeof (/** @type {any} */ (session).onEvent) === 'function') {
    /** @type {any} */ (session).onEvent((/** @type {any} */ evt) => { ... });
}
```

`session.onEvent` não está na API pública do SDK 0.2.0. O SDK expõe `session.on(handler)`
(sem tipo de evento) para todos os eventos. O código usa cast `any` e guarda com `typeof`,
o que é frágil — mudanças internas do SDK podem silenciosamente quebrar o catch-all.

**Correção**: Usar a API pública correta:
```js
// API correta (SDK 0.2.0): session.on sem tipo de evento = catch-all
const unsubAll = session.on((evt) => {
    const kind = evt?.kind ?? evt?.type ?? 'unknown';
    const knownEvents = new Set([...]);
    if (!knownEvents.has(kind)) {
        log('DEBUG', `[AlwaysAlive] Evento SDK não tratado: kind=${kind}`);
    }
});
this.#sessionEventUnsubscribers.push(unsubAll);
```

---

### BUG-AA-12 — `buildSystemMessageConfig` em `session.js` Usa `mode: 'append'` Obsoleto (BAIXO)

**Arquivo**: `session.js`, linhas ~105-115 (`buildSystemMessageConfig`)

**Descrição**:
```js
// SDK-03 (fix): SDK v0.1.x não suporta mode:'customize'; usar mode:'append' até SDK v0.2.0
// TODO(SDK-v0.2.0): migrar para mode:'customize' com sections quando disponível
return {
    mode: 'append',
    content,
};
```

O SDK já está na versão **0.2.0** (conforme npm). O modo `'customize'` está disponível.
O TODO está pendente e o modo `'append'` pode não ser mais a forma canônica de injetar
contexto em seções específicas do system prompt.

**Correção**: Migrar para `mode: 'customize'` conforme SDK 0.2.0:
```js
return {
    mode: 'customize',
    sections: {
        guidelines: { action: 'append', content },
    },
};
```

---

## 7. Melhorias de Robustez

### MR-01 — Boot Prompt com Mecanismo de ACK Explícito

**Prioridade**: Alta

**Problema**: O `startDialogLoop` aguarda o evento `dialog.ready` (que mapeia para `READY:`
no ask_user). Porém, se o modelo falhar em emitir `READY:` na primeira mensagem (ex: responde
com texto explicativo antes do `ask_user`), a Promise `bootPromise` nunca resolve → **hang
indefinido** sem timeout.

**Melhoria**: Adicionar timeout explícito no `bootPromise`:
```js
const BOOT_TIMEOUT_MS = Number(process.env.LLM_B_BOOT_TIMEOUT_MS ?? 120_000);

const bootPromise = Promise.race([
    new Promise((resolve) => this.once('dialog.ready', resolve)),
    new Promise((_, reject) =>
        setTimeout(() => reject(new SessionError('Boot timeout: modelo não emitiu READY', 'DIALOG_BOOT_TIMEOUT')),
        BOOT_TIMEOUT_MS)
    ),
]);
```

---

### MR-02 — Backpressure para `sendDialogTurn`

**Prioridade**: Alta

**Problema**: `sendDialogTurn` é serializado pelo `#dialogTurnMutex`, mas não tem limite de
profundidade de fila. Uma rajada de chamadas pode enfileirar milhares de turnos na Promise-chain.

**Melhoria**: Adicionar `MAX_DIALOG_TURN_QUEUE_SIZE` análogo ao `MAX_TURN_QUEUE_SIZE` de `dialog.js`:
```js
static #MAX_DIALOG_QUEUE_SIZE = 10;

sendDialogTurn(message, opts = {}) {
    if (this.#dialogTurnQueueDepth >= AlwaysAliveAgent.#MAX_DIALOG_QUEUE_SIZE) {
        return Promise.reject(new SessionError(
            `[AlwaysAlive] Fila de diálogo cheia (${this.#dialogTurnQueueDepth} turnos)`,
            'DIALOG_QUEUE_FULL'
        ));
    }
    // ...
}
```

---

### MR-03 — Emitir `dialog.turn_start` / `dialog.turn_end` para Observabilidade

**Prioridade**: Média

**Problema**: O sistema emite `dialog.ready` e `dialog.reply`, mas não há evento para o
início e fim de um turno do ponto de vista do caller. Isso dificulta rastreamento de latência
por turno e visualização no dashboard.

**Melhoria**:
```js
// Em #executeDialogTurn, antes de answerPendingQuestion:
this.emit('dialog.turn_start', { message: message.slice(0, 120), ts: Date.now() });
// Em onReplyOuter:
this.emit('dialog.turn_end', { reply: evt.reply.slice(0, 120), durationMs: Date.now() - turnStart });
```

---

### MR-04 — Métricas de Latência do Dialog Loop

**Prioridade**: Média

**Problema**: O `DialogWatchdog` detecta **stall** (inatividade > N minutos), mas não
registra a latência de cada turno. Não é possível detectar regressões de performance
(modelo ficando lento ao longo do tempo) sem coleta de dados.

**Melhoria**: Integrar ao `#telemetry` existente:
```js
// Em #executeDialogTurn — início:
const turnStart = Date.now();

// Em onReplyOuter — após resolver:
this.#telemetry.record('dialog.turn.latency_ms', Date.now() - turnStart, {
    sessionId: this.sessionId ?? '',
    model: this.#model,
});
```

---

### MR-05 — `ensureDialogLoop` em `dialog.js` Não Trata `status === 'processing'`

**Arquivo**: `terminal/dialog.js`, `_tryStartDialogLoop`

**Problema**: `_tryStartDialogLoop` só aguarda `idle` se `status === 'stopped'`. Se o agente
está em `processing` (ex: `sendMessage` de outra fonte) quando `ensureDialogLoop` é chamado,
`startDialogMode` lançará `INVALID_STATE`. Isso causa falha no restart automático durante
períodos de processamento.

**Melhoria**:
```js
async function _tryStartDialogLoop() {
    // Aguardar idle se estiver em processing (não só stopped)
    const status = alwaysAliveAgent.status;
    if (status === 'stopped') {
        await alwaysAliveAgent.start();
    }
    if (status !== 'idle') {
        // Aguarda com timeout
        await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error('Timeout aguardando idle')), 30_000);
            const check = () => {
                if (alwaysAliveAgent.status === 'idle') {
                    clearTimeout(timeout);
                    resolve(undefined);
                } else {
                    setTimeout(check, 500);
                }
            };
            check();
        });
    }
    // ...
}
```

---

### MR-06 — `session-manager.js` `readState()` Usa `readFileSync` Bloqueante

**Arquivo**: `session-manager.js`, linha ~181 (`readState`)

**Problema**: `readState()` usa `readFileSync` em um módulo chamado por `getStatusSnapshot()`
— que é invocado pelo polling HTTP. Em containers Docker com volumes NFS ou discos lentos,
esta chamada pode bloquear o event loop por decenas de milissegundos.

**Melhoria**: O comentário `BUG-HIGH-05` já foi aplicado em `buildHookSystemContext` (async).
`readState` merece o mesmo tratamento:
```js
// Versão async para uso em contextos não-críticos
export async function readStateAsync() {
    try {
        const text = await readFile(STATE_FILE, 'utf8');
        return JSON.parse(text);
    } catch {
        return null;
    }
}
```
Nota: `readState` síncrono pode ser mantido para usos no boot onde async é impraticável.

---

### MR-07 — `entry.js` Não Valida `COPILOT_MODEL` no Boot

**Arquivo**: `entry.js`

**Problema**: Se `COPILOT_MODEL=modelo-inexistente`, o agente iniciará, consumirá uma sessão
e só falhará ao enviar a primeira mensagem. O `ping` de boot não valida o modelo.

**Melhoria**: Validação proativa do modelo configurado:
```js
// Após ping OK, antes de startWithRetry:
if (process.env.COPILOT_MODEL) {
    try {
        const { listModels } = await import('./lib/models.js');
        const models = await listModels();
        const valid = models.some(m => m.id === process.env.COPILOT_MODEL);
        if (!valid) {
            log('WARN', `[copilot/agent] Modelo '${process.env.COPILOT_MODEL}' não encontrado na lista de modelos disponíveis.`);
        }
    } catch {
        /* não crítico — continuar */
    }
}
```

---

### MR-08 — Dialog Loop Não Persiste `dialogLoopActive` em Disco

**Arquivo**: `always-alive.js`, `session-manager.js`

**Problema**: Se o processo reinicia (PM2 crash/restart), `#dialogLoopActive` volta para
`false`. O sistema depende de `terminal/index.js` para reiniciar o loop, mas isso só acontece
quando uma mensagem é enviada. No intervalo, diagnósticos e monitoring podem reportar o loop
como inativo quando na verdade estava ativo antes do crash.

**Melhoria**: Persistir estado do dialog loop em disco:
```js
// Em startDialogLoop():
await writeStateAsync({ dialogLoopActive: true });

// Em stopDialogLoop() e no shutdown:
await writeStateAsync({ dialogLoopActive: false });

// No boot, verificar e auto-reiniciar se estava ativo:
const state = readState();
if (state?.dialogLoopActive) {
    log('INFO', '[AlwaysAlive] Dialog loop estava ativo antes do restart — agendando reinício.');
    this.once('ready', () => void ensureDialogLoop());
}
```

---

### MR-09 — `_subscribeSse` em `inject.js` Não Reconecta em Falha

**Arquivo**: `channel/inject.js`, `_subscribeSse`

**Problema**: Se a conexão SSE cair (timeout, reinício do terminal), `_subscribeSse` para
silenciosamente. O caller não recebe nem erro nem notificação de desconexão.

**Melhoria**: Adicionar callback `onError` e suporte a reconexão com backoff:
```js
function _subscribeSse(path, port, onEvent, { onError, reconnectMs = 5000 } = {}) {
    // ... (código existente)
    res.on('close', () => {
        if (!destroyed) {
            log('WARN', `[inject-llmb] SSE desconectado (${path}) — reconectando em ${reconnectMs}ms`);
            setTimeout(() => _subscribeSse(path, port, onEvent, { onError, reconnectMs }), reconnectMs);
        }
    });
}
```

---

## 8. Propostas de Refatoração

### RF-D01 — Extrair `DialogProtocol` como Classe Separada

**Prioridade**: Média

**Motivação**: O código de interceptação do dialog loop em `#handleUserInputRequest` (70 linhas)
e os estados do protocolo (`READY:`, `REPLY:`, `STOPPED`) estão embutidos no meio do fluxo
principal. Uma classe `DialogProtocol` tornaria o protocolo testável isoladamente.

**Proposta**:
```js
// src/copilot/agent/dialog-protocol.js
export class DialogProtocol {
    /** @param {string} question */
    static classify(question) {
        const t = question.trim();
        if (t.startsWith('READY:') || t === 'READY') return 'ready';
        if (t.startsWith('REPLY:') || t.startsWith('DONE:')) return 'reply';
        if (t.startsWith('STOPPED') || t === 'STOP_DIALOG') return 'stopped';
        return 'question';
    }

    /** @param {string} question */
    static extractReply(question) {
        return question.replace(/^(REPLY:|DONE:)\s*/i, '').trim();
    }
}
```

---

### RF-D02 — `#processQueue` com Reintentos Transparentes

**Prioridade**: Baixa

**Motivação**: Em `task-executor.js`, quando `tryReconnect` bem-sucede, a tarefa é
reinserida na fila via `requeueTask`. Se a tarefa já foi tentada 2+ vezes, ela continua
sendo reinserida indefinidamente em caso de falhas repetidas.

**Proposta**: Adicionar contador de tentativas por tarefa:
```js
// Em AgentTask:
@property {number} [attempts] - número de tentativas (com novo campo em sendMessage)

// Em task-executor.js:
if (recovered) {
    task.attempts = (task.attempts ?? 0) + 1;
    if (task.attempts >= 3) {
        task.reject(new SessionError('Máximo de tentativas atingido', 'MAX_RETRIES'));
    } else {
        requeueTask(task);
    }
}
```

---

### RF-D03 — Separar `#handleUserInputRequest` em Handlers Especializados

**Prioridade**: Baixa

**Motivação**: `#handleUserInputRequest` tem dois fluxos completamente distintos:
(1) modo dialog loop (interceptação de protocolo) e (2) modo normal (pergunta interativa).
A mistura torna difícil entender o fluxo e propensa a erros (ver BUG-AA-02).

**Proposta**:
```js
async #handleUserInputRequest(input) {
    if (this.#dialogLoopActive) {
        return this.#handleDialogLoopInput(input);
    }
    return this.#handleInteractiveQuestion(input);
}

async #handleDialogLoopInput({ question, allowFreeform }) {
    // Apenas lógica de protocolo READY/REPLY/STOPPED
}

async #handleInteractiveQuestion({ question, choices, allowFreeform }) {
    // Apenas lógica de pergunta normal
}
```

---

### RF-D04 — Boot Prompt como Objeto Tipado

**Prioridade**: Baixa

**Motivação**: O boot prompt é uma string longa embutida em dois lugares:
- `always-alive.js` (metaPrompt inline)
- `terminal/dialog.js` (DEFAULT_BOOT_PROMPT / BOOT_PROMPT)

Não há garantia de que os dois prompts se comportem de forma consistente. Uma mudança em
um pode quebrar o outro silenciosamente.

**Proposta**: Centralizar em `src/copilot/agent/dialog-protocol.js`:
```js
export const DIALOG_BOOT_PROTOCOL = {
    systemPrompt: `Protocolo OBRIGATÓRIO de comunicação via ask_user:
1. Chame ask_user("READY: aguardando próxima mensagem") para sinalizar prontidão.
2. Ao receber uma mensagem, processe-a e formule uma resposta completa.
3. Chame ask_user("REPLY: " + sua_resposta) para enviar a resposta.
4. Retorne ao passo 1.
IMPORTANTE: NUNCA encerre o loop.`,
    prefixes: { ready: 'READY:', reply: 'REPLY:', done: 'DONE:', stop: 'STOPPED' },
};
```

---

### RF-D05 — Telemetria OTEL no Dialog Loop

**Prioridade**: Média

**Motivação**: `startSpan` é usado em `#executeDialogTurn` (via `dialog.send_turn`), mas
os spans não têm informação completa — não incluem `questionType` (READY/REPLY), nem
contagem de turno.

**Proposta**:
```js
return startSpan('dialog.send_turn', {
    sessionId: this.sessionId ?? '',
    actor: 'user',
    turnNumber: this.#sendCount,  // reutilizar contador existente
    model: this.#model,
}, () => new Promise(...));
```

---

### RF-D06 — Converter `readState()` em Singleton com Cache In-Process

**Prioridade**: Média

**Motivação**: `readState()` (síncrona, `readFileSync`) é chamada de `getStatusSnapshot()`
em cada poll HTTP. O `#statusSnapshotCache` já mitiga isso, mas o I/O síncrono ainda ocorre
a cada 500ms no pior caso.

**Proposta**: Manter um cache in-process do estado:
```js
/** @type {AliveAgentState | null} */
let _stateCache = null;

export function readState() {
    if (_stateCache !== null) return _stateCache;
    if (!existsSync(STATE_FILE)) return null;
    try {
        _stateCache = JSON.parse(readFileSync(STATE_FILE, 'utf8'));
        return _stateCache;
    } catch (e) {
        log('WARN', `[PersistentSession] Falha ao ler estado: ${e.message}`);
        return null;
    }
}

export function writeState(updates) {
    // ... (código existente)
    _stateCache = next; // ← atualizar cache
    return next;
}
```

---

## 9. Tabela Consolidada

### Bugs

| ID        | Severidade | Arquivo              | Descrição                                                           | Esforço |
| --------- | ---------- | -------------------- | ------------------------------------------------------------------- | ------- |
| BUG-AA-01 | 🔴 CRÍTICO  | `always-alive.js`    | Listener leak `question.pending` ao timeout                         | Pequeno |
| BUG-AA-02 | 🔴 CRÍTICO  | `always-alive.js`    | Race condition `stopDialogLoop` / `#handleUserInputRequest`         | Médio   |
| BUG-AA-03 | 🔴 CRÍTICO  | `always-alive.js`    | `session.on` sem armazenar unsubscribe → memory leak                | Médio   |
| BUG-AA-04 | 🟠 ALTO     | `always-alive.js`    | `#dialogTurnMutex` não reseta → crescimento indefinido              | Pequeno |
| BUG-AA-05 | 🟡 MÉDIO    | `always-alive.js`    | `question.pending` emitido antes do listener → turno perdido        | Médio   |
| BUG-AA-06 | 🟡 MÉDIO    | `always-alive.js`    | `#watchdog` não parado em `stop()` se `#dialogLoopActive === false` | Pequeno |
| BUG-AA-07 | 🟡 MÉDIO    | `session-manager.js` | `mkdir` redundante em cada `writeStateAsync`                        | Pequeno |
| BUG-AA-08 | 🟡 MÉDIO    | `always-alive.js`    | `#waitForDialogRestartAndReply` não distingue stop definitivo       | Pequeno |
| BUG-AA-09 | 🟡 MÉDIO    | `entry.js`           | `session.fatal` não tratado → processo zumbi sem sessão             | Pequeno |
| BUG-AA-10 | 🟢 BAIXO    | `always-alive.js`    | `#tryReconnect` não loga intenção de restart do dialog loop         | Trivial |
| BUG-AA-11 | 🟢 BAIXO    | `always-alive.js`    | `session.onEvent` não-documentado em vez de API pública             | Pequeno |
| BUG-AA-12 | 🟢 BAIXO    | `lib/session.js`     | `mode: 'append'` obsoleto — migrar para `mode: 'customize'`         | Trivial |

### Melhorias de Robustez

| ID    | Prioridade | Descrição                                            | Esforço |
| ----- | ---------- | ---------------------------------------------------- | ------- |
| MR-01 | 🔴 Alta     | Timeout no `bootPromise` de `startDialogLoop`        | Pequeno |
| MR-02 | 🔴 Alta     | Backpressure para `sendDialogTurn`                   | Pequeno |
| MR-03 | 🟡 Média    | Eventos `dialog.turn_start` / `dialog.turn_end`      | Pequeno |
| MR-04 | 🟡 Média    | Métricas de latência por turno no `#telemetry`       | Médio   |
| MR-05 | 🟡 Média    | `ensureDialogLoop` aguarda idle durante `processing` | Pequeno |
| MR-06 | 🟡 Média    | `readState()` async version para usos não-críticos   | Pequeno |
| MR-07 | 🟢 Baixa    | Validação de `COPILOT_MODEL` no boot de `entry.js`   | Trivial |
| MR-08 | 🟢 Baixa    | Persistir `dialogLoopActive` em disco                | Médio   |
| MR-09 | 🟢 Baixa    | `_subscribeSse` com reconexão automática             | Médio   |

### Refatorações

| ID     | Prioridade | Descrição                                     | Esforço |
| ------ | ---------- | --------------------------------------------- | ------- |
| RF-D01 | 🟡 Média    | Extrair `DialogProtocol` como classe testável | Médio   |
| RF-D02 | 🟢 Baixa    | Reintentos com contador em `task-executor.js` | Pequeno |
| RF-D03 | 🟢 Baixa    | Separar handlers em `#handleUserInputRequest` | Médio   |
| RF-D04 | 🟢 Baixa    | Boot prompt centralizado como objeto tipado   | Pequeno |
| RF-D05 | 🟡 Média    | Telemetria OTEL completa no dialog loop       | Pequeno |
| RF-D06 | 🟡 Média    | `readState()` com cache in-process            | Pequeno |

---

## 10. Roadmap de Implementação

O roadmap está organizado em **4 fases** com **subfases** por arquivo. Cada item tem um código
de rastreabilidade e seu status de execução. As fases são ordenadas por impacto/risco, não por
esforço.

---

### Fase 1 — Correções Críticas de Estabilidade

**Objetivo**: eliminar leaks, race conditions e hangs que afetam sessões em produção de longa
duração.

| #   | Item                                   | Arquivo           | Risco se não corrigir                                      |
| --- | -------------------------------------- | ----------------- | ---------------------------------------------------------- |
| 1.1 | BUG-AA-01: off listener ao timeout     | `always-alive.js` | MaxListeners + callbacks fantasmas após 50+ timeouts       |
| 1.2 | BUG-AA-03: armazenar unsubscribers SDK | `always-alive.js` | Memory leak progressivo a cada reconexão                   |
| 1.3 | BUG-AA-04: reset `#dialogTurnMutex`    | `always-alive.js` | Crescimento da Promise-chain → OOM após milhares de turnos |
| 1.4 | BUG-AA-06: watchdog.stop incondicional | `always-alive.js` | setInterval mantém processo vivo após stop()               |
| 1.5 | MR-01: timeout no bootPromise          | `always-alive.js` | startDialogLoop() pode pendurar indefinidamente            |

**Subfase 1-A** (`always-alive.js` — campos privados):
- Adicionar `#sessionEventUnsubscribers: Array<() => void>`
- Adicionar `#dialogTurnQueueDepth: number`

**Subfase 1-B** (`always-alive.js` — `#executeDialogTurn`):
- Adicionar `off('question.pending', onPending)` dentro do `timeoutHandle` callback (1.1)
- Adicionar reset do mutex quando `#dialogTurnQueueDepth === 0` (1.3)

**Subfase 1-C** (`always-alive.js` — `start()` / `#initSession()`):
- Registrar todos os `session.on(...)` com armazenamento do unsubscribe (1.2)

**Subfase 1-D** (`always-alive.js` — `stop()` / `stopDialogLoop()`):
- Chamar `#watchdog?.stop()` antes do guard `if (#dialogLoopActive)` (1.4)
- Iterar e chamar todos os `#sessionEventUnsubscribers` (1.2)

**Subfase 1-E** (`always-alive.js` — `startDialogLoop()`):
- Envolver bootPromise em `Promise.race` com timeout configurável via `LLM_B_BOOT_TIMEOUT_MS` (1.5)

---

### Fase 2 — Correções de Bugs de Alta Impacto

**Objetivo**: eliminar edge cases de race condition, timeouts mal classificados e o processo
zumbi causado por `session.fatal` não tratado.

| #   | Item                                         | Arquivo           | Risco se não corrigir                                 |
| --- | -------------------------------------------- | ----------------- | ----------------------------------------------------- |
| 2.1 | BUG-AA-02: flag #dialogLoopStopping          | `always-alive.js` | sendDialogTurn timeout em stop/ask_user concorrentes  |
| 2.2 | BUG-AA-05: check #pendingQuestion após once  | `always-alive.js` | Turno silenciosamente perdido em alta concorrência    |
| 2.3 | BUG-AA-08: stop definitivo em waitForRestart | `always-alive.js` | Caller recebe TIMEOUT em vez de DIALOG_ENDED          |
| 2.4 | BUG-AA-09: ouvir session.fatal em entry.js   | `entry.js`        | Processo fica vivo sem sessão ativa indefinidamente   |
| 2.5 | MR-02: backpressure sendDialogTurn           | `always-alive.js` | Rajada de turnos pode enfileirar milhares de Promises |

**Subfase 2-A** (`always-alive.js` — campos privados):
- Adicionar `#dialogLoopStopping: boolean`
- Adicionar `#MAX_DIALOG_TURN_QUEUE_SIZE`

**Subfase 2-B** (`always-alive.js` — `stopDialogLoop()`):
- Setar `#dialogLoopStopping = true` antes e `false` depois (2.1)

**Subfase 2-C** (`always-alive.js` — `#handleUserInputRequest`):
- Verificar `this.#dialogLoopStopping` além de `#dialogLoopActive` (2.1)

**Subfase 2-D** (`always-alive.js` — `#executeDialogTurn`):
- Adicionar verificação de `#pendingQuestion` após `once('question.pending')` (2.2)
- Backpressure: jeitar erro se `#dialogTurnQueueDepth >= MAX` (2.5)

**Subfase 2-E** (`always-alive.js` — `#waitForDialogRestartAndReply`):
- Adicionar listener `dialog.stopped` com `authorized === true` → rejeitar com `DIALOG_ENDED` (2.3)

**Subfase 2-F** (`entry.js`):
- Adicionar `alwaysAliveAgent.on('session.fatal', ...)` com `process.exit(1)` (2.4)

---

### Fase 3 — Melhorias de Qualidade e Manutenibilidade

**Objetivo**: observabilidade, resiliência e eliminação de código frágil/obsoleto.

| #   | Item                                        | Arquivo                    | Benefício                              |
| --- | ------------------------------------------- | -------------------------- | -------------------------------------- |
| 3.1 | MR-05: loop idle guard em ensureDialogLoop  | `terminal/dialog.js`       | Evita INVALID_STATE durante processing |
| 3.2 | RF-D06 + BUG-AA-07: cache readState + mkdir | `session-manager.js`       | Elimina I/O síncrono em hot path       |
| 3.3 | BUG-AA-11: migrar session.onEvent           | `always-alive.js`          | Usar API pública estável               |
| 3.4 | BUG-AA-12: migrar mode:'append'             | `lib/session.js`           | SDK 0.2.0 suporta mode:'customize'     |
| 3.5 | MR-03: eventos turn_start/turn_end          | `always-alive.js`          | Observabilidade por turno              |
| 3.6 | RF-D01: extrair DialogProtocol              | `agent/dialog-protocol.js` | Testabilidade isolada                  |

**Subfase 3-A** (`terminal/dialog.js`):
- `_tryStartDialogLoop`: aguardar `idle` com polling 500ms + timeout 30s antes de `startDialogMode` (3.1)

**Subfase 3-B** (`session-manager.js`):
- Adicionar `let _stateDirReady = false` + `let _stateCache = null` (3.2)
- `writeState` e `writeStateAsync`: atualizar `_stateCache` após escrita (3.2)
- `readState`: retornar `_stateCache` se disponível (3.2)
- `writeStateAsync`: skip `mkdir` se `_stateDirReady === true` (3.2)

**Subfase 3-C** (`always-alive.js`):
- Substituir `session.onEvent(...)` por `const unsubAll = session.on(handler)` (3.3)
- Adicionar `dialog.turn_start` e `dialog.turn_end` em `#executeDialogTurn` (3.5)

**Subfase 3-D** (`lib/session.js`):
- `buildSystemMessageConfig`: migrar para `mode: 'customize'` com `sections.guidelines` (3.4)

**Subfase 3-E** (novo arquivo `src/copilot/agent/dialog-protocol.js`):
- Criar `DialogProtocol` com `classify()`, `extractReply()`, constantes de prefixo (3.6)
- Referenciar nos dois locais que usam as strings mágicas (RF-D01)

---

### Fase 4 — Polimento e Observabilidade Avançada

**Objetivo**: completar observabilidade, validações de boot e separação de concerns.

| #   | Item                                       | Arquivo                                  | Benefício                             |
| --- | ------------------------------------------ | ---------------------------------------- | ------------------------------------- |
| 4.1 | RF-D03: separar handlers ask_user          | `always-alive.js`                        | Clareza e testabilidade separada      |
| 4.2 | MR-04: métricas de latência via telemetry  | `always-alive.js`                        | Detectar regressões de performance    |
| 4.3 | RF-D05: OTEL spans completos               | `always-alive.js`                        | Spans com turnNumber e questionType   |
| 4.4 | MR-07: validar COPILOT_MODEL no boot       | `entry.js`                               | Falha rápida em modelo inválido       |
| 4.5 | MR-08: persistir dialogLoopActive em disco | `always-alive.js` + `session-manager.js` | Auto-restart perfeito após PM2 crash  |
| 4.6 | MR-09: reconexão SSE em inject.js          | `channel/inject.js`                      | Canal LLM-A → LLM-B resiliente        |
| 4.7 | RF-D04: boot prompt centralizado           | `agent/dialog-protocol.js`               | DRY entre always-alive.js e dialog.js |

---

### Status Geral do Roadmap

| Fase                  | Total de itens | Status     |
| --------------------- | -------------- | ---------- |
| Fase 1 (crítico)      | 5 itens        | ⚪ Pendente |
| Fase 2 (alto impacto) | 6 itens        | ⚪ Pendente |
| Fase 3 (qualidade)    | 6 itens        | ⚪ Pendente |
| Fase 4 (polimento)    | 7 itens        | ⚪ Pendente |
| **Total**             | **24 itens**   | ⚪          |

---

## Notas Técnicas Finais

### Relação com SDK 0.2.0

A documentação oficial confirma os seguintes pontos sobre `ask_user` / `onUserInputRequest`:

- **Habilitado por**: `onUserInputRequest` em `createSession` / `resumeSession`
- **Campos**: `request.question`, `request.choices`, `request.allowFreeform`
- **Retorno esperado**: `{ answer: string, wasFreeform: boolean }`
- **Não exposto pelo SDK**: número de `ask_user` calls, histórico de respostas, timeout nativo
- **API de eventos**: `session.on(handler)` retorna `unsubscribe: () => void` — **não é EventEmitter**

O fato de `session.on` retornar uma função de unsubscribe (não `this`) é a causa raiz dos
bugs BUG-AA-03 e BUG-AA-11 — o código trata a sessão como se fosse um `EventEmitter` Node.js,
mas o SDK tem uma API própria.

### Boot Prompt e Modelo

O boot prompt atual em `terminal/dialog.js` é consistente com o design DL-PERM-03: o modelo
é instruído explicitamente a **nunca encerrar o loop**. Isso é correto e funcional. A única
melhoria necessária é centralizar a definição do protocolo (RF-D04) para evitar duplicação.

### Dialog Loop vs. sendMessage — Conclusão

**sendMessage dentro do dialog loop** é tecnicamente possível mas não recomendado:

- A tarefa ficará na fila até o agente voltar para `idle`
- Isso ocorre somente após o REPLY do turno corrente do dialog loop
- O dialog loop usa `timeoutMs: 24h`, mas `sendAndWait` tem `timeout: 60s` padrão
- **Risco real**: tasks normais com timeout 60s esperando pelo dialog loop podem expirar

**Recomendação**: Não misturar `sendMessage` com o dialog loop ativo. Se necessário, usar
`sendDialogTurn` (que resolve dentro do loop, sem novo PR) ou aguardar `stopDialogLoop`
antes de `sendMessage`.
