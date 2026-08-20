# Análise do Fluxo `sendDialogTurn` — Ponta a Ponta

**Data**: 2026-07-16 **Autor**: GitHub Copilot (Claude Sonnet 4.6) **Escopo**: Todos os caminhos de
entrada de mensagem → `sendDialogTurn` → resposta LLM-B **Status**: ✅ IMPLEMENTADO — ver seção
[Plano de Implementação](#plano-de-implementação)

---

## Sumário Executivo

Este documento mapeia **todos os caminhos possíveis** pelos quais uma mensagem chega ao
`sendDialogTurn` do `AlwaysAliveAgent`, identifica gaps, bugs e oportunidades de melhoria, e propõe
implementações concretas.

### Bugs Encontrados

| ID          | Severidade | Descrição                                                                                                                                                                                                                               |
| ----------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **FLOW-01** | 🔴 CRÍTICO | Mensagens do terminal (usuário humano) **não são injetadas no Orchestrator** — LLM-A nunca vê a conversa do usuário com LLM-B via terminal                                                                                              |
| **FLOW-02** | 🔴 CRÍTICO | RF-PR-05: troca de modelo em `#tryReconnect` **não é 0-PR** — `resumeOrCreate` pode criar nova sessão porque o `sessionId` no estado é do modelo anterior, incompatível                                                                 |
| **FLOW-03** | 🟡 MÉDIO   | `ensureDialogLoop()` em `dialog.js` não distingue entre "puxa mensagem antes de loop pronto" e "timeout na inicialização" — erros de boot silenciosos                                                                                   |
| **FLOW-04** | 🟡 MÉDIO   | `HubOrchestrator.#callViaDialogLoop` não persiste a mensagem do usuário no ConversationStore antes de chamar `sendDialogTurn` — se falhar, o turno LLM-A é gravado mas o de LLM-B não                                                   |
| **FLOW-05** | 🟠 BAIXO   | `dialog.js._executeTurn` não passa o `hubSessionId` ao chamar `conversationHub.writeTurn` — usa o ID do módulo global (`getHubSessionId()`) que pode estar defasado em caso de mudança de sessão                                        |
| **FLOW-06** | 🟠 BAIXO   | `bridge-dialog.js POST /dialog/turn` não verifica `dialogLoopActive` antes de chamar `sendDialogTurn` — o guard já existe em `sendDialogTurn`, mas o erro `409` informativo só seria gerado para `status !== 'idle'` em `/dialog/start` |

### Melhorias Propostas

| ID | Tipo | Descrição | | --------------- | --------------- |
--------------------------------------------------------------------------------------------------------------

| ----- | ------------------------------------------- | | **FLOW-UPG-01** | Observabilidade | Emitir
evento `user.turn_injected_to_orchestrator` quando terminal sincroniza com o Orchestrator (fix
FLOW-01) | | **FLOW-UPG-02** | Resiliência | RF-PR-05: aplicar fallback model em `startDialogLoop()`
(0-PR garantido) em vez de `#tryReconnect` | | **FLOW-UPG-03** | Rastreabilidade | Adicionar
`turnSource: 'terminal'                                                                              | 'api' | 'orchestrator'`no
evento`dialog.turn_start` | | **FLOW-UPG-04** | Diagnóstico | `bridge-dialog.js /dialog/turn` deve
retornar `dialogLoopActive` no body de erro 409 | | **FLOW-UPG-05** | Robustez | `dialog.js`:
timeout de `ensureDialogLoop()` deve emitir `Nerv` com severity=error para alertar monitoramento |

---

## Índice

1. [Arquitetura de Caminhos de Mensagem](#1-arquitetura-de-caminhos-de-mensagem)
2. [Caminho A — Usuário → Terminal → LLM-B](#2-caminho-a--usuário--terminal--llm-b)
3. [Caminho B — LLM-A → Orchestrator → LLM-B](#3-caminho-b--llm-a--orchestrator--llm-b)
4. [Caminho C — API HTTP → bridge-dialog → LLM-B](#4-caminho-c--api-http--bridge-dialog--llm-b)
5. [Caminho D — API HTTP `/inject` → Orchestrator → (LLM-A poll)](#5-caminho-d--api-http-inject--orchestrator--llm-a-poll)
6. [sendDialogTurn em Detalhe (always-alive.js)](#6-senddialogTurn-em-detalhe-always-alivejs)
7. [Bug FLOW-01 — Gap Terminal ↔ Orchestrator](#7-bug-flow-01--gap-terminal--orchestrator)
8. [Bug FLOW-02 — RF-PR-05 não é 0-PR](#8-bug-flow-02--rf-pr-05-não-é-0-pr)
9. [Plano de Implementação](#plano-de-implementação)
10. [Tabela Consolidada](#tabela-consolidada)

---

## 1. Arquitetura de Caminhos de Mensagem

O sistema tem **quatro caminhos distintos** pelos quais uma mensagem pode chegar ao
`sendDialogTurn`:

```
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                       CAMINHOS DE MENSAGEM → sendDialogTurn                            │
│                                                                                        │
│  ┌──────────────┐   readline 'line'    ┌──────────────┐   _executeTurn()               │
│  │   USUÁRIO    │──────────────────────▶ repl.js      │──────────────────────────────┐ │
│  │  (terminal)  │                      └──────────────┘                              │ │
│  └──────────────┘                                                                     │ │
│                                                                                        ▼ │
│  ┌──────────────┐   sendToLlmB()       ┌──────────────┐   dialogTurn()   ┌──────────────┴─┐
│  │   LLM-A     │──────────────────────▶│ orchestrator │─────────────────▶│  client.js     │
│  │ (Copilot)   │                      │    .js       │                  │ LlmBridgeClient│
│  └──────────────┘                      └──────────────┘                  └───────┬────────┘
│                                                                                    │
│  ┌──────────────┐   POST /dialog/turn  ┌──────────────┐   sendDialogTurn()        │
│  │   API HTTP   │──────────────────────▶ bridge-       │──────────────────────────┤
│  │   Externa    │                      │ dialog.js    │                           │
│  └──────────────┘                      └──────────────┘                           │
│                                                                                    ▼
│  ┌──────────────┐   POST /inject       ┌──────────────┐                ┌──────────────────┐
│  │   API HTTP   │──────────────────────▶ hub-router   │   (LLM-A faz  │  AlwaysAliveAgent │
│  │  (usuário   │                      │    .js       │   poll e envia │  .sendDialogTurn()│
│  │   remoto)   │                      └──────────────┘   via orch.)   └──────────────────┘
│  └──────────────┘                                                                    │
│                                                                                       ▼
│                                                                           ┌──────────────────┐
│                                                                           │   LLM-B (SDK)    │
│                                                                           │  ask_user loop   │
│                                                                           └──────────────────┘
└─────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Caminho A — Usuário → Terminal → LLM-B

### Fluxo Completo

```
1. Usuário digita no terminal → readline emite 'line'
2. repl.js rl.on('line', async (line) => { ... })
   ├── Se /comando → dispatchCmd() [sem sendTurn]
   ├── Se @path → addAttachment(p) + strip @refs
   └── Se mensagem → sendTurn(finalMessage, 'user')  [dialog.js]

3. dialog.js sendTurn(message, 'user')
   └── _sendTurnMutex.then(_executeTurn)
       │   [serializa: max 10 na fila, MAX_TURN_QUEUE_SIZE=10]
       │
       ├── Verificar contexto: ≥85% warn, ≥95% erro
       ├── setBusy(true) + broadcastSse('busy', {busy:true, actor})
       ├── Readline prompt → PROMPT_WAITING
       ├── Enriquecer mensagem (attachments embed + plan mode prefix)
       ├── await ensureDialogLoop()   [NEW-PAUSE-04 guard aqui]
       │     ├── Guard 1: dialogLoopActive → return early
       │     ├── Guard 2: dialogPaused → return early (NEW-PAUSE-04)
       │     └── _doEnsureDialogLoop() → retry 3x (2s/4s/8s)
       │           └── _tryStartDialogLoop()
       │                 └── llmBridgeClient.startDialogMode(BOOT_PROMPT)
       │
       ├── await llmBridgeClient.dialogTurn(enrichedMessage, { timeout: TURN_TIMEOUT_MS })
       │     [client.js LlmBridgeClient.dialogTurn]
       │     └── alwaysAliveAgent.sendDialogTurn(message, { timeout })
       │           [always-alive.js — ver seção 6]
       │
       ├── printExchange(actor, message, reply, durationMs)
       ├── conversationHub.store.writeTurn(sessionId, {role:'user', content})
       ├── conversationHub.store.writeTurn(sessionId, {role:'llm_b', content:reply})
       └── emitNerv('copilot:turn:sent') + emitNerv('copilot:turn:complete')
```

### Observações Críticas

- **FLOW-01** ⚠️: O `conversationHub.store.writeTurn()` chamado em `dialog.js` grava diretamente no
  ConversationStore, **bypassando o HubOrchestrator**. Consequência: LLM-A que usa
  `orchestrator.sendToLlmB()` não tem visibilidade das mensagens do terminal. O evento `turn:sent`
  do Orchestrator nunca é emitido para turnos vindos do terminal.

- **FLOW-05** ⚠️: O `getHubSessionId()` usado em `dialog.js` é um getter global de `state.js`. Se o
  hub session ID mudar (ex: `/resume <id>`), o getter é atualizado, mas se houver um turno em
  andamento no mutex no momento da troca, a gravação usará o ID correto (pois `getHubSessionId()` é
  chamado no momento do `writeTurn`, não quando a mensagem é enfileirada). Risco baixo.

---

## 3. Caminho B — LLM-A → Orchestrator → LLM-B

### Fluxo Completo

```
1. LLM-A chama ferramentas do hub:
   - hub-tools.js / ask_llm_b()
   - direct: hub.orchestrator.sendToLlmB(hubSessionId, message, opts)

2. orchestrator.js HubOrchestrator.sendToLlmB(hubSessionId, message, opts)
   └── #inflightBySession mutex (por sessão)
       └── #executeSendToLlmB(hubSessionId, message, opts)
           │
           ├── Verificar agente ativo (status !== 'stopped')
           ├── Normalizar message → messageContent (string)
           │
           ├── [PERSISTE turn LLM-A]
           │   store.writeTurn(hubSessionId, { role:'llm_a', content, model:'copilot-claude-sonnet-4.6' })
           │   → emit 'turn:sent'
           │
           ├── Decidir caminho:
           │   ├── agentInst.dialogLoopActive === true → #callViaDialogLoop()
           │   ├── useStructured && object message → #callViaStructured()
           │   └── fallback → #callViaSimpleChat()
           │
           ├── #callViaDialogLoop(message, content, hubSessionId, turnNumber, timeoutMs)
           │   ├── Registra listener 'task.delta' para emitir 'turn:delta' em tempo real
           │   └── await agentInst.sendDialogTurn(content, { timeout })
           │         [mesmo path que Caminho A, ver seção 6]
           │
           └── [PERSISTE turn LLM-B]
               store.writeTurn(hubSessionId, { role:'llm_b', content:reply, durationMs })
               → emit 'turn:complete'
```

### Observações

- O Orchestrator tem **serialização por sessão** (`#inflightBySession`). Isso garante que dois
  `sendToLlmB()` para a mesma sessão não executem em paralelo.
- O Caminho B **sempre persiste ambos os lados** (LLM-A e LLM-B) no ConversationStore via o
  Orchestrator — rastreabilidade completa.
- Quando `dialogLoopActive=false`, cai para `#callViaSimpleChat` (1 PR!). O log WARN é emitido, mas
  não há retry com dialog loop — oportunidade de melhoria.

---

## 4. Caminho C — API HTTP → bridge-dialog → LLM-B

### Fluxo Completo

```
1. POST /dialog/turn { message, timeout }
   bridge-dialog.js → agent.sendDialogTurn(message, { timeout })
   └── AlwaysAliveAgent.sendDialogTurn() [ver seção 6]
       └── Resposta → { ok: true, reply }

NOTA: Este caminho NÃO persiste nada no ConversationStore.
```

### Observações

- **FLOW-06** ⚠️: A rota `POST /dialog/turn` não verifica `agent.dialogLoopActive` explicitamente.
  Isso é aceitável porque `sendDialogTurn` faz a verificação internamente e lança `SessionError` com
  código `DIALOG_NOT_ACTIVE`. O erro retornado é 500, não 409 — poderia ser mais informativo.
- Este caminho é projetado para uso externo (LLM-A via bridge HTTP), não para o terminal.

---

## 5. Caminho D — API HTTP `/inject` → Orchestrator → (LLM-A poll)

### Fluxo Completo

```
1. POST /api/copilot/sessions/:id/message { content }
   copilot-hub-router.js → hub.injectUserMessage(sessionId, content)

2. orchestrator.js injectUserMessage(hubSessionId, content)
   ├── store.injectUserMessage(hubSessionId, content)  [persiste com status='pending']
   ├── emit 'user:injected'
   └── Se turno em andamento: emit 'turn:user_pending'

3. LLM-A (em algum momento) chama:
   hub-tools.js poll_user_messages() → orchestrator.pollUserMessages(hubSessionId)
   └── store.getPendingUserMessages() + markAllUserMessagesRead()
   → LLM-A processa as mensagens e responde via sendToLlmB()
```

### Observações

- Mensagens injetadas via API são **assíncronas** — LLM-A precisa fazer polling ativo.
- O evento `turn:user_pending` notifica LLM-A de que há mensagens pendentes durante um turn.
- Este caminho é o único que garante que mensagens do usuário sejam visíveis para LLM-A.

---

## 6. `sendDialogTurn` em Detalhe (`always-alive.js`)

### Camadas de Proteção

```
sendDialogTurn(message, { timeout=60s, signal })
│
├── Guard 1: !dialogLoopActive → rejeita SessionError('DIALOG_NOT_ACTIVE')
├── Guard 2: signal?.aborted → rejeita AbortError (UPG-01)
├── Guard 3: queueDepth >= MAX (10) → rejeita SessionError('DIALOG_QUEUE_FULL')
├── Watchdog ping (DL-PERM-04)
│
├── #dialogTurnQueueDepth++
├── Mutex: encadeia na cauda do prev promise
│   BUG-AA-04 fix: resetar mutex quando queueDepth === 0
│
└── #executeDialogTurn(message, { timeout, signal })
    │
    ├── emit 'dialog.turn_start'
    ├── writeStateAsync({ pendingTurnMessage, pendingTurnTs, pendingTurnConsumedPR:false })
    │
    ├── startSpan('dialog.send_turn', ...)
    │   └── new Promise((resolve, reject) =>
    │       │
    │       ├── setTimeout(timeout) → rejeita com 'DIALOG_TIMEOUT'  [BUG-AA-01 fix]
    │       │
    │       ├── once('dialog.reply', onReplyOuter)  → resolve(reply) + emit 'dialog.turn_end'
    │       ├── once('dialog.stopped', onStopOuter)
    │       │     → authorized=true: rejeita 'DIALOG_ENDED'
    │       │     → authorized=false: #waitForDialogRestartAndReply()  [DL-PERM-05]
    │       │
    │       ├── Se signal: addEventListener('abort') → rejeita AbortError
    │       │
    │       └── Alimentar o ask_user:
    │           ├── Se #pendingQuestion existe:
    │           │     answerPendingQuestion(message)
    │           └── Senão: once('question.pending', onPending)
    │                 └── [quando modelo chega ao ask_user]:
    │                       answerPendingQuestion(message)
    │                       + once('dialog.reply') + once('dialog.stopped')
    │
    └── answerPendingQuestion(answer):
         this.#pendingQuestion.resolve(answer)
         this.#pendingQuestion = null
```

### Protocolo READY/REPLY (LLM-B)

```
startDialogLoop(bootPrompt):
  sendMessage(bootPrompt) → 1 PR total
    LLM-B executa:
      while(true) {
        ask_user("READY: aguardando...")   ← suspende, emite 'question.pending'
        input = wait                       ← resolvido por answerPendingQuestion()
        // processa input
        ask_user("REPLY: <resposta>")      ← emite 'dialog.reply' (filtrado do protocolo)
        input = wait
        // ou ask user for real question
      }
```

### Tratamento de Parada e Restart (DL-PERM-05)

Se `dialog.stopped` disparar com `authorized=false` **durante** um `sendDialogTurn`:

1. Cancela listeners ativos
2. Chama `#waitForDialogRestartAndReply(message, timeout, reason)`
3. Aguarda `dialog.ready` (novo boot completou)
4. Reenvia a mensagem original **uma vez**
5. Se `dialog.stopped` durante o retry → rejeita `DIALOG_STOPPED_DURING_RETRY`

---

## 7. Bug FLOW-01 — Gap Terminal ↔ Orchestrator

### Problema

Quando o usuário digita no terminal e `dialog.js` chama `llmBridgeClient.dialogTurn()`, o turno é
gravado diretamente no ConversationStore (`store.writeTurn(role:'user')`) mas **não passa pelo
HubOrchestrator**. Isso cria uma assimetria:

| Fonte da mensagem     | ConversationStore | HubOrchestrator `turn:sent` | LLM-A pode ver?   |
| --------------------- | ----------------- | --------------------------- | ----------------- |
| Terminal (`sendTurn`) | ✅ gravado        | ❌ não emitido              | ❌ NÃO            |
| LLM-A (`sendToLlmB`)  | ✅ gravado        | ✅ emitido                  | ✅ SIM            |
| API `/inject`         | ✅ gravado        | N/A (via poll)              | ✅ SIM (via poll) |

**Consequência**: LLM-A que usa `orchestrator.sendToLlmB()` e `pollUserMessages()` **nunca vê** as
mensagens que o usuário digitou diretamente no terminal. O histórico no ConversationStore fica
completo, mas os eventos em tempo real do Orchestrator não refletem essas mensagens.

### Solução Proposta (FLOW-UPG-01)

Em `dialog.js._executeTurn()`, após a gravação direta no store, **também chamar**
`orchestrator.injectUserMessage()` para notificar o Orchestrator — ou melhor, emitir o turn via o
caminho do Orchestrator:

```js
// Em dialog.js._executeTurn(), após o writeTurn direto:
// FLOW-UPG-01: notificar Orchestrator para que LLM-A veja a mensagem
try {
    const hid = getHubSessionId();
    if (hid) {
        conversationHub.orchestrator.emit('turn:sent', {
            hubSessionId: hid,
            turnId: userTurnId,
            role: 'user',
            content: enrichedMessage,
            turnNumber: /* ... */,
            source: 'terminal',
        });
    }
} catch { /* não bloquear */ }
```

Ou, de forma mais completa: criar um método `notifyTerminalTurn(hubSessionId, userMsg, replyMsg)` no
ConversationHub que apenas emite os eventos sem re-persistir.

---

## 8. Bug FLOW-02 — RF-PR-05 não é 0-PR

### Problema

A implementação atual do RF-PR-05 (fallback de modelo em rate_limit/quota) aplica o modelo
substituído em `#tryReconnect()`, que então chama `#initSession()` → `initOrResumeSession()` →
`resumeOrCreate()`.

O problema: `resumeOrCreate()` tenta retomar a sessão com `existingSessionId = state.sessionId` (o
ID da sessão do modelo **anterior**). O SDK Copilot não garante que uma sessão criada com
`model: 'gpt-4.1'` possa ser retomada com `model: 'gpt-4.1-mini'`. Na prática, `resumeSession` com
modelo diferente provavelmente falha, e `resumeOrCreate` cai para `createSession()` = **1 PR**.

### Solução (FLOW-UPG-02)

Mover a aplicação do `#pendingModelFallback` para `startDialogLoop()`, que é chamado na **próxima
inicialização** do loop. Isso garante que:

1. A sessão atual fica ativa com o modelo original até expirar/morrer naturalmente
2. Na próxima `startDialogLoop()` (via DL-PERM-05 restart ou manual), o novo modelo é usado
3. A nova sessão tem custo normal de 1 PR — não há PR extra comparado ao restart normal

```js
// Em always-alive.js startDialogLoop():
async startDialogLoop(bootPrompt) {
    // RF-PR-05 (fix): aplicar fallback antes de qualquer nova sessão
    if (this.#pendingModelFallback && this.#fallbackModel) {
        const prev = this.#model;
        this.#model = this.#fallbackModel;
        this.#pendingModelFallback = false;
        this.emit('pr.fallback_model', { previousModel: prev, newModel: this.#fallbackModel });
        log('WARN', `[AlwaysAlive] RF-PR-05 (0-PR): modelo trocado ${prev} → ${this.#model} no startDialogLoop`);
    }
    // ... resto do método
}
```

E **remover** a aplicação do fallback de `#tryReconnect()` — `#tryReconnect` é chamado durante
reconexão de sessão encerrada (1 PR inevitável), não deve ter side effects extra de mudança de
modelo.

---

## Plano de Implementação

### Fase 1 — Correção RF-PR-05 (FLOW-02) — 0-PR garantido

- [ ] Remover aplicação do `#pendingModelFallback` de `#tryReconnect()` em `always-alive.js`
- [ ] Adicionar aplicação do `#pendingModelFallback` em `startDialogLoop()` antes do
      `#initSession()`
- [ ] Preservar o `emit('pr.fallback_model')` no novo local

### Fase 2 — Fix FLOW-01 — Terminal notifica Orchestrator

- [ ] Adicionar método `notifyTerminalTurn(hubSessionId, userTurnId, llmBTurnId, source)` no
      `ConversationHub` (ou diretamente no `HubOrchestrator`)
- [ ] Chamar esse método em `dialog.js._executeTurn()` após o `writeTurn` existente
- [ ] Emitir `turn:sent` (usuário) e `turn:complete` (llm_b) via Orchestrator

### Fase 3 — Melhorias (FLOW-UPG-03 ao FLOW-UPG-05)

- [ ] FLOW-UPG-03: Adicionar `turnSource` no evento `dialog.turn_start`
- [ ] FLOW-UPG-04: `bridge-dialog.js /dialog/turn` — retornar `dialogLoopActive` no body de erro
- [ ] FLOW-UPG-05: emit Nerv `severity:error` quando `ensureDialogLoop` falhar após todos retries

---

## Tabela Consolidada

| ID          | Tipo     | Severidade | Arquivo                                  | Status          |
| ----------- | -------- | ---------- | ---------------------------------------- | --------------- |
| FLOW-01     | Bug      | 🔴 CRÍTICO | `dialog.js`, `orchestrator.js`, `hub.js` | ✅ IMPLEMENTADO |
| FLOW-02     | Bug      | 🔴 CRÍTICO | `always-alive.js`                        | ✅ IMPLEMENTADO |
| FLOW-03     | Bug      | 🟡 MÉDIO   | `dialog.js`                              | 🔵 BACKLOG      |
| FLOW-04     | Bug      | 🟡 MÉDIO   | `orchestrator.js`                        | 🔵 BACKLOG      |
| FLOW-05     | Bug      | 🟠 BAIXO   | `dialog.js`                              | 🔵 BACKLOG      |
| FLOW-06     | Bug      | 🟠 BAIXO   | `bridge-dialog.js`                       | ✅ IMPLEMENTADO |
| FLOW-UPG-01 | Melhoria | —          | `dialog.js`, `hub.js`                    | ✅ IMPLEMENTADO |
| FLOW-UPG-02 | Melhoria | —          | `always-alive.js`                        | ✅ IMPLEMENTADO |
| FLOW-UPG-03 | Melhoria | —          | `always-alive.js`                        | ✅ IMPLEMENTADO |
| FLOW-UPG-04 | Melhoria | —          | `bridge-dialog.js`                       | ✅ IMPLEMENTADO |
| FLOW-UPG-05 | Melhoria | —          | `dialog.js`                              | ✅ IMPLEMENTADO |
