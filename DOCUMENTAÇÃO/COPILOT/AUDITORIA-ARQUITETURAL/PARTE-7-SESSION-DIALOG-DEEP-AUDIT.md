# PARTE 7 — Auditoria Profunda: Sessions & Dialog Loop

**Data**: 2026-03-20
**Última atualização**: 2026-03-20
**Status**: Canônico
**Escopo**: Arquitetura completa de sessões SDK, dialog loop, persistência, reconexão e resiliência

---

## Índice

1. [Visão Geral da Arquitetura Atual](#1-visão-geral-da-arquitetura-atual)
2. [Mapeamento de Componentes](#2-mapeamento-de-componentes)
3. [Análise de Funcionalidades SDK vs Implementação](#3-análise-de-funcionalidades-sdk-vs-implementação)
4. [Bugs Identificados](#4-bugs-identificados)
5. [Gaps Arquiteturais](#5-gaps-arquiteturais)
6. [Análise do Dialog Loop — Resiliência a Restart de PC](#6-análise-do-dialog-loop--resiliência-a-restart-de-pc)
7. [Situação Ideal com Upgrades](#7-situação-ideal-com-upgrades)
8. [Roadmap Detalhado — Fases e Sub-fases](#8-roadmap-detalhado--fases-e-sub-fases)

---

## 1. Visão Geral da Arquitetura Atual

### 1.1 Fluxo de Sessão

```
┌──────────────────────────────────────────────────────────────────────┐
│                         BOOT SEQUENCE                                │
│                                                                      │
│  AlwaysAliveAgent.start()                                            │
│    ├─ new CopilotClient()                                            │
│    ├─ #initSession(client)                                           │
│    │    ├─ buildMcpTools()                                           │
│    │    ├─ bootstrapTools(registry, mcpTools)                        │
│    │    ├─ createSessionHooks(ctx)  ← hooks/session-lifecycle.js     │
│    │    ├─ createHooks({ auditLog, ...lifecycle })                   │
│    │    ├─ attachBus(hooks)                                          │
│    │    └─ initOrResumeSession(client, opts)                         │
│    │         ├─ _readState() → sessionId                             │
│    │         ├─ _validateSessionForResume(id, lastActivity)          │
│    │         └─ resumeOrCreate(client, id, opts) ← lib/session.js   │
│    │              ├─ try: resumeSession(client, id, opts)            │
│    │              └─ catch: createSession(client, opts)              │
│    │                                                                 │
│    ├─ wireSessionEvents(session, isResumed, callbacks)               │
│    ├─ defaultEventCollector.attach(session)                          │
│    ├─ createAgentEventObserver()                                     │
│    └─ emit('ready')                                                  │
│                                                                      │
│  → status: 'idle'                                                    │
│                                                                      │
│  ┌── DIALOG LOOP (modo contínuo) ──────────────────────────────┐     │
│  │  startDialogLoop(bootPrompt?)                               │     │
│  │    ├─ #ensureDialogLoopAttached()                           │     │
│  │    │    ├─ dialogLoop.attach(host)  ← AgentHost interface   │     │
│  │    │    ├─ wireDialogLoopEvents(dlm, emit)                  │     │
│  │    │    └─ wiring: token_budget_warning, compaction_complete │     │
│  │    └─ dialogLoop.start(bootPrompt)                          │     │
│  │         ├─ boot: sendMessageDialogBoot(metaPrompt,24h)      │     │
│  │         ├─ waitForEvent('ready', bootTimeoutMs)             │     │
│  │         └─ watchdog.start()                                 │     │
│  │                                                             │     │
│  │  SDK ask_user cycle:                                        │     │
│  │    onUserInputRequest(question)                             │     │
│  │      │                                                      │     │
│  │      ├─ dialogLoop.active?                                  │     │
│  │      │   ├─ YES: handleDialogLoopInput()                    │     │
│  │      │   │    ├─ DialogProtocol.classify(question)          │     │
│  │      │   │    │   → 'ready' | 'reply' | 'stopped'          │     │
│  │      │   │    └─ handleInteractiveQuestion()  ← suspende   │     │
│  │      │   │                                                  │     │
│  │      │   └─ NO: handleInteractiveQuestion()                 │     │
│  │      │         └─ new Promise(resolve => pendingQuestion)   │     │
│  │      │                                                      │     │
│  │  sendDialogTurn(message)                                    │     │
│  │    └─ dialogLoop.sendTurn(message, opts)                    │     │
│  │         ├─ mutex serialization                              │     │
│  │         ├─ emitTurnStart(emitter, message, counter)         │     │
│  │         ├─ buildTurnResolutionListeners(emitter, opts)      │     │
│  │         └─ dispatchTurnToHost(emitter, opts)                │     │
│  │              ├─ pendingQuestion? → answerPendingQuestion    │     │
│  │              └─ !pendingQuestion → wait question.pending    │     │
│  └─────────────────────────────────────────────────────────────┘     │
│                                                                      │
│  ┌── TASK QUEUE (modo direto) ─────────────────────────────────┐     │
│  │  sendMessage(message, opts)                                 │     │
│  │    └─ #enqueueTask() → #processQueue()                      │     │
│  │         └─ executeTask(session, task, callbacks)             │     │
│  └─────────────────────────────────────────────────────────────┘     │
│                                                                      │
│  ┌── RECONEXÃO ────────────────────────────────────────────────┐     │
│  │  #tryReconnect(error)                                       │     │
│  │    ├─ tryReconnect(err, client, status, callbacks)          │     │
│  │    │    ├─ client.stop()                                    │     │
│  │    │    ├─ #initSession(client) ← reconnect cycle           │     │
│  │    │    └─ dialogLoop.active → notifyReconnect()            │     │
│  │    └─ backoff: base*2^(n-1) + jitter, cap 30s, max 5       │     │
│  └─────────────────────────────────────────────────────────────┘     │
│                                                                      │
│  ┌── SHUTDOWN ─────────────────────────────────────────────────┐     │
│  │  stop({ shutdownTimeoutMs })                                │     │
│  │    ├─ emit('before-stop')                                   │     │
│  │    ├─ aguarda tarefa atual (até shutdownTimeoutMs)           │     │
│  │    ├─ dialogLoop.forceDeactivate()                          │     │
│  │    ├─ F41.4: createSnapshot() + saveSnapshot()              │     │
│  │    ├─ writeStateAsync({ sendCount })                        │     │
│  │    ├─ messageQueue.drain()                                  │     │
│  │    ├─ session.disconnect()                                  │     │
│  │    └─ client.stop()                                         │     │
│  └─────────────────────────────────────────────────────────────┘     │
└──────────────────────────────────────────────────────────────────────┘
```

### 1.2 Stack de Persistência

| Camada                  | Mecanismo                                   | Dados Persistidos                                                                       |
| ----------------------- | ------------------------------------------- | --------------------------------------------------------------------------------------- |
| **SDK nativo**          | `~/.copilot/session-state/{sessionId}/`     | Conversation history, tool results, planning state, artifacts, checkpoints              |
| **state-io.js**         | `.github/hooks/state/sdk-always-alive.json` | sessionId, model, sendCount, pendingQuestion, dialogLoopActive, dialogPaused, prMetrics |
| **session-snapshot.js** | `.github/hooks/state/snapshots/`            | Snapshot completo do agente (session + dialog + PR metrics)                             |
| **ConversationStore**   | SQLite (via conversation-hub)               | Histórico de conversação sincronizado do SDK                                            |

### 1.3 Protocolo Dialog Loop

O dialog loop usa um **protocolo textual customizado** sobre `ask_user`:

```
BOOT → sendMessage(buildBootPrompt(), {timeoutMs: 24h})
     → modelo emite "READY: ..." via ask_user
     → DialogProtocol.classify() → 'ready'
     → DLM.handleProtocolInput() → emit('ready')

TURN → answerPendingQuestion(message)
     → modelo processa e emite "REPLY: <resposta>" via ask_user
     → DialogProtocol.classify() → 'reply'
     → extractReply() → emit('reply', {reply})

STOP → modelo emite "STOPPED: ..." via ask_user
     → DLM.handleProtocolInput() → emit('stopped')
```

---

## 2. Mapeamento de Componentes

### 2.1 Arquivos e Responsabilidades

| Arquivo                      | Linhas | Responsabilidade                                                                       |
| ---------------------------- | ------ | -------------------------------------------------------------------------------------- |
| `always-alive.js`            | ~1355  | Agente singleton. Orquestra sessão, fila, dialog loop, reconexão, shutdown             |
| `dialog-loop-manager.js`     | ~550   | Mutex, watchdog, backpressure, protocol dispatch, pause/resume, prMetrics              |
| `dialog-turn-executor.js`    | ~370   | Turn execution: emitTurnStart, resolution listeners, dispatchToHost, restart-and-reply |
| `dialog-watchdog.js`         | ~200   | Stall detection com thresholds por tipo de task + pre-stall warning                    |
| `dialog-loop-wirer.js`       | ~80    | Forwarding de eventos DLM → AGENT EventEmitter                                         |
| `dialog-protocol.js`         | ~120   | Protocolo textual READY/REPLY/DONE/STOPPED — classify, extract, buildBootPrompt        |
| `session-snapshot.js`        | ~200   | Snapshot/restore do estado do agente para recovery                                     |
| `session-initializer.js`     | ~450   | initOrResumeSession, hook context injection, validation                                |
| `session-event-wirer.js`     | ~545   | Wiring de ~80+ eventos SDK → AGENT EventEmitter                                        |
| `state-io.js`                | ~200   | CRUD síncrono/async de `sdk-always-alive.json` com cache + mutex serial                |
| `reconnect-policy.js`        | ~100   | Backoff exponencial + jitter para reconexão                                            |
| `lib/session.js`             | ~300   | Abstração de createSession/resumeSession/listSessions/deleteSession                    |
| `hooks/session-lifecycle.js` | ~200   | Factory de onSessionStart/End/ErrorOccurred com DI                                     |

---

## 3. Análise de Funcionalidades SDK vs Implementação

### 3.1 Funcionalidades SDK Nativas

| Funcionalidade SDK                               | Status na Implementação | Detalhes                                                     |
| ------------------------------------------------ | ----------------------- | ------------------------------------------------------------ |
| `client.createSession(config)`                   | ✅ Implementado          | Via `lib/session.js → createSession()`                       |
| `client.resumeSession(id, config)`               | ✅ Implementado          | Via `lib/session.js → resumeSession()`                       |
| `client.listSessions(filter)`                    | ✅ Implementado          | Via `lib/session.js → listSessions()`                        |
| `client.deleteSession(id)`                       | ✅ Implementado          | Via `lib/session.js → deleteSession()`                       |
| `session.disconnect()`                           | ✅ Implementado          | Chamado em `stop()` e `lib/session.js → disconnectSession()` |
| `session.send({prompt})`                         | ⚠️ Parcial               | Usado indiretamente via fila de tasks                        |
| `session.sendAndWait()`                          | ❓ Não verificado        | Possivelmente usado em `executeTask`                         |
| `infiniteSessions.enabled`                       | ✅ Implementado          | Configurado em `initOrResumeSession`                         |
| `infiniteSessions.backgroundCompactionThreshold` | ✅ Implementado          | Dinâmico via `setBackgroundCompactionThreshold()`            |
| `session.on(eventName, cb)`                      | ✅ Implementado          | Via `wireSessionEvents()` — 80+ eventos                      |
| `session.on(cb)` (catch-all)                     | ✅ Implementado          | Via `_wireCatchAll()`                                        |
| `streaming: true`                                | ✅ Implementado          | Configurado em `buildSessionConfig()`                        |
| `mode: 'immediate'` (steering)                   | ✅ Implementado          | Via `steerMessage()`                                         |
| `systemMessage: {mode:'customize', content}`     | ✅ Implementado          | Injeção de hook context                                      |
| `workingDirectory`                               | ✅ Implementado          | Configurado em `initOrResumeSession`                         |
| `skillDirectories`                               | ✅ Implementado          | Configurado em `initOrResumeSession`                         |
| `customAgents`                                   | ✅ Implementado          | Via `buildCustomAgentsConfig()`                              |
| `excludedTools` / `availableTools`               | ✅ Implementado          | Via `getToolsConfig()`                                       |
| `onPermissionRequest`                            | ✅ Implementado          | Via `PermissionController` + audit wrapper                   |
| `onUserInputRequest`                             | ✅ Implementado          | Via `#handleUserInputRequest()`                              |
| `hooks.onSessionStart`                           | ✅ Implementado          | Via `createSessionHooks()` com additionalContext             |
| `hooks.onSessionEnd`                             | ✅ Implementado          | Via `createSessionHooks()`                                   |
| `hooks.onErrorOccurred`                          | ✅ Implementado          | Com fallback model via ModelSelector                         |
| `hooks.onPreToolUse`                             | ✅ Implementado          | Via `createHooks()`                                          |
| `hooks.onPostToolUse`                            | ✅ Implementado          | Via `createHooks()`                                          |
| `session.idle` (event)                           | ✅ Subscrito             | Via `event-collector.js`                                     |
| `session.task_complete` (event)                  | ✅ Subscrito             | Via `_wireSdkResponseEvents()`                               |
| `session.shutdown` (event)                       | ✅ Subscrito             | Via `_wireSdkResponseEvents()`                               |
| `session.usage_info` (event)                     | ✅ Subscrito             | Via `_wireTokenBudgetEvents()`                               |
| `assistant.usage` (event)                        | ✅ Subscrito             | Via `_wireUsageEvent()` — billing/PR tracking                |
| `session.compaction_start/complete`              | ✅ Subscrito             | Via `_wireCompactionEvents()`                                |
| `session.error` (event)                          | ✅ Subscrito             | Via `_wireSdkResponseEvents()`                               |
| `elicitation.requested` (event)                  | ✅ Subscrito             | Via `_wireSdkResponseEvents()`                               |
| `session.getMessages()`                          | ✅ Implementado          | Via `getSessionMessages()` com cache TTL                     |
| `session.rpc`                                    | ✅ Usado                 | Via `setSessionRpc(session.rpc)`                             |

### 3.2 Funcionalidades SDK Subutilizadas ou Ausentes

| Funcionalidade SDK                                                 | Status                         | Impacto                                                                                     |
| ------------------------------------------------------------------ | ------------------------------ | ------------------------------------------------------------------------------------------- |
| `session.disconnect()` sem `deleteSession()` para preservar estado | ⚠️ Parcial                      | `stop()` chama `disconnect()` mas não gerencia lifecycle de sessões persistidas no servidor |
| `client.listSessions()` para cleanup proativo                      | ⚠️ Não usado proativamente      | Sessões acumulam no servidor sem limpeza automática                                         |
| `bufferExhaustionThreshold`                                        | ⚠️ Não configurado              | Usa default do SDK — sem controle granular de exaustão                                      |
| `session.resume` (event)                                           | ✅ Subscrito no event-collector | Mas não gera ação no AGENT EventEmitter                                                     |
| `session.truncation` (event)                                       | ✅ No KNOWN_SDK_EVENTS          | Mas não propagado — perda de visibilidade de truncation                                     |
| `session.handoff` (event)                                          | ✅ No KNOWN_SDK_EVENTS          | Mas não há implementação de F41.3 Handoff API                                               |
| `session.snapshot_rewind` (event)                                  | ✅ No KNOWN_SDK_EVENTS          | Mas silenciado — sem reação                                                                 |
| `permission.requested/completed`                                   | ✅ Subscrito no event-collector | Mas não tem consumer AGENT para notificação HTTP                                            |
| Timeout de idle de 30 minutos                                      | ❌ Não tratado                  | SDK limpa sessão idle após 30min — agente não previne isso                                  |

---

## 4. Bugs Identificados

### BUG-SD-001 — Sessão SDK Expira em 30 Min de Idle (CRÍTICO) ✅ CORRIGIDO (F42.2)

**Severidade**: ALTA
**Arquivo**: `session-initializer.js` / `always-alive.js`

O SDK tem timeout de idle de 30 minutos para cleanup automático. O dialog loop mantém a sessão "viva" enquanto `ask_user` está pendente, mas quando o dialog loop **não está ativo** e o agente está em status `idle` (nenhuma task enfileirada), a sessão SDK pode expirar silenciosamente.

**Impacto**: Após 30 min sem atividade, `sendMessage()` falhará e só será detectado na tentativa de envio, forçando reconexão.

**Correção proposta**: Implementar heartbeat periódico ou keepalive ping para sessões idle (via `session.send()` com prompt no-op ou verificação de estado).

### BUG-SD-002 — `reconnect-policy.js` Recria Client Mas Reutiliza o Mesmo ✅ CORRIGIDO (F42.5)

**Severidade**: MÉDIA
**Arquivo**: `reconnect-policy.js:59`

Em `tryReconnect()`, o `client.stop()` é chamado antes de `initSession(client)`. Porém, o mesmo objeto `client` é reutilizado após `stop()`. O SDK pode não suportar reutilização de um client já parado — a documentação sugere que `stop()` é terminal.

**Impacto**: Possível falha silenciosa em reconexões onde o SDK internamente previne reutilização do client.

**Correção proposta**: Criar um novo `CopilotClient()` em cada tentativa de reconexão em vez de reutilizar o parado.

### BUG-SD-003 — prMetrics Não Persistidos Entre Restarts ✅ CORRIGIDO (F42.4)

**Severidade**: MÉDIA
**Arquivo**: `dialog-loop-manager.js`

`#prMetrics = { boots: 0, resumesWithPR: 0, resumesZeroPR: 0 }` é inicializado em memória e nunca restaurado do estado em disco. Após PM2 restart, os contadores resetam para zero, perdendo o histórico de consumo de PR.

**Impacto**: Dashboard mostra contadores incorretos após restart. O snapshot (F41.4) salva prMetrics no shutdown, mas não são restaurados no boot.

**Correção proposta**: No `start()`, restaurar `#prMetrics` do último snapshot ou do `sdk-always-alive.json`.

### BUG-SD-004 — `handleDialogLoopInput` Sempre Suspende via `handleInteractiveQuestion` ✅ CORRIGIDO (F44.3)

**Severidade**: BAIXA (design intencional, mas ineficiente)
**Arquivo**: `always-alive.js:1285`

Quando o dialog loop está ativo e o modelo emite `READY` ou `REPLY`, `handleDialogLoopInput()`:
1. Classifica e emite eventos via DLM
2. **Sempre** chama `handleInteractiveQuestion()` que muda status para `waiting_for_input` e persiste `pendingQuestion`

Isso causa uma transição de status desnecessária (`processing → waiting_for_input`) para mensagens de protocolo que serão respondidas imediatamente pelo `sendTurn()` via `answerPendingQuestion()`.

**Impacto**: Overhead de escrita em disco + status transitório visível no dashboard por frações de segundo.

**Correção proposta**: Para mensagens READY/REPLY do protocolo, pular a persistência de `pendingQuestion` (é efêmera).

### BUG-SD-005 — `stopDialogLoop()` Não Propaga `shutdownTimeoutMs` ✅ CORRIGIDO (F44.2)

**Severidade**: BAIXA
**Arquivo**: `always-alive.js:991`

O método `stopDialogLoop(opts)` delega para `this.#dialogLoop.stop(opts)`, porém a assinatura pública aceita `{ authorized?, reason? }` mas NÃO inclui `shutdownTimeoutMs`. O timeout de shutdown usa o default de 30s sem opção de customização via API pública.

**Correção proposta**: Adicionar `shutdownTimeoutMs?: number` à assinatura pública de `stopDialogLoop()`.

### BUG-SD-006 — `forceDeactivate()` Não Limpa Fila de Mutex ✅ CORRIGIDO (F42.3)

**Severidade**: MÉDIA
**Arquivo**: `dialog-loop-manager.js:465`

`forceDeactivate()` seta `#active = false` e para o watchdog, mas NÃO limpa `#turnMutex` ou `#turnQueueDepth`. Se havia turns enfileirados no mutex, eles continuarão executando (o `prev.then()` já foi encadeado) e emitirão eventos/respostas num DLM que já foi desativado.

**Impacto**: Leak de execuções fantasma após `forceDeactivate()` durante shutdown com fila de turns profunda.

**Correção proposta**: Reset `#turnMutex = Promise.resolve(); #turnQueueDepth = 0; #turnMutexGen++` em `forceDeactivate()`.

### BUG-SD-007 — Race Condition em `resume()` Estratégia B ✅ CORRIGIDO (F42.6)

**Severidade**: MÉDIA
**Arquivo**: `dialog-loop-manager.js:393-402`

Na Estratégia B do `resume()`:
```js
this.#active = false;
await writeStateAsync({ dialogLoopActive: false });
await this.start();
```
Entre `this.#active = false` e `this.start()`, outra chamada pode tentar `start()` sem encontrar `#active` como guard. O `start()` faz `if (this.#active) throw`, mas a janela é pequena.

Mais criticamente: se `writeStateAsync` falhar, `this.#active` já é `false` mas o disco diz `dialogLoopActive: true`.

**Correção proposta**: Usar flag atômico de `resuming` para prevenir interleaving.

---

## 5. Gaps Arquiteturais

### GAP-SD-01 — Sem Gerenciamento Proativo de Sessões Persistidas no Servidor ✅ RESOLVIDO (F43.1)

O SDK persiste sessões em `~/.copilot/session-state/{sessionId}/`. Não há:
- Limpeza periódica de sessões antigas
- Verificação de espaço em disco
- Listagem e purge de sessões órfãs

**Impacto**: Acumulação no disco do servidor de estados de sessões nunca mais usadas.

**Resolução**: `session-cleanup.js` implementa cleanup on-boot com `listSessions()` + `deleteSession()` para sessões > 24h.

### GAP-SD-02 — Session Locking para Acesso Concorrente

O SDK não implementa session locking nativo. Se dois processos tentarem usar a mesma sessão (cenário PM2 + terminal), haverá corrupção de estado.

**Impacto**: Risco em cenários de multi-processo.

### GAP-SD-03 — Sem Mecanismo de Session Rotation ✅ RESOLVIDO (F43.2)

Sessões muito longas (horas, dias) acumulam contexto. Mesmo com compaction, a qualidade degrada. Não há política de "criar nova sessão limpa após N horas/turnos mantendo referência à anterior".

**Impacto**: Degradação gradual de qualidade em sessões ultra-longas.

**Resolução**: `session-rotation.js` implementa `shouldRotateSession()` com política configurável (4h/200 turns/5 compactions/90% utilização).

### GAP-SD-04 — Dialog Loop Não Sobrevive a Restart de PC ✅ MITIGADO (F42.1)

Este é o gap mais crítico identificado pelo usuário. O fluxo atual após restart de PC:

```
PC restart → PM2 restart → AlwaysAliveAgent.start()
  → initOrResumeSession()
    → state-io.readState() → {sessionId, dialogLoopActive: true}
    → resumeOrCreate(client, sessionId, opts)
      → try: resumeSession() → SUCCESS (sessão SDK retomada)
  → status: 'idle'
  → ❌ Dialog loop NÃO é reiniciado automaticamente
  → Terminal LLM-B precisa dar /dialog start manualmente
  → O boot do dialog loop consome 1 PR
```

**Problema central**: Após restart, a sessão SDK é retomada (0 PR para resume), mas o dialog loop não é restaurado automaticamente. O terminal LLM-B precisa ser reiniciado e dar `/dialog start`, consumindo 1 PR.

### GAP-SD-05 — Snapshot/Restore Desconectado do Resume SDK

O `session-snapshot.js` salva estado do agente (model, sendCount, dialogLoopActive, prMetrics), mas o restore não integra com o `resumeSession()` do SDK. São dois sistemas paralelos:
- SDK resume: restaura conversation history + tool results
- Snapshot restore: restaura metadata do agente

Não há orquestração que combine ambos para um resume completo.

### GAP-SD-06 — Sem Tratamento de `session.truncation` ✅ RESOLVIDO (F43.3)

O evento `session.truncation` está no `KNOWN_SDK_EVENTS` mas é silenciado. Truncation de contexto pode degradar a qualidade sem aviso.

**Resolução**: Handler dedicado em `session-event-wirer.js` propaga evento no AGENT EventEmitter.

### GAP-SD-07 — `session.handoff` Sem Implementação (F41.3) ✅ RESOLVIDO (F45.1-F45.4)

O SDK emite `session.handoff` mas não há handler. Este é o gap de F41.3.

**Resolução**: `HandoffManager` + handler no wirer + rotas HTTP + comando `/handoff` no REPL.

### GAP-SD-08 — Sem Health Check de Sessão Pré-Boot ✅ RESOLVIDO (F44.1)

Antes de iniciar o dialog loop, não há verificação de que a sessão está saudável (connection test, token budget check). Se a sessão já está em 90% de token budget, o boot do dialog loop consumirá tokens e pode triggar compaction.

### GAP-SD-09 — Evento `session.resume` Não Integrado com Dialog Loop Auto-Start

O SDK emite `session.resume` quando retoma uma sessão. Este evento não é usado para triggar o auto-start do dialog loop.

---

## 6. Análise do Dialog Loop — Resiliência a Restart de PC

### 6.1 Cenário Atual: O Que Acontece Quando o PC Reinicia

```
T=0     PC desliga
T=0+    PM2 detecta crash → salva estado final
        AlwaysAliveAgent.stop() pode NÃO executar (kill -9)
        → F41.4 snapshot NÃO é salvo (depende de graceful shutdown)
        → sdk-always-alive.json pode ter dialogLoopActive: true (stale)

T=boot  PC liga, Docker/DevContainer inicia
T=boot  PM2 restart → AlwaysAliveAgent.start()
        → readState() → { sessionId: 'xxx', dialogLoopActive: true }
        → resumeOrCreate(client, 'xxx', opts)
        → IF sessão SDK válida: resume (0 PR) ← já funciona
        → IF sessão SDK expirada: create nova (1 PR)
        → status: 'idle'
        → ❌ Dialog loop NÃO inicia automaticamente
        → ❌ Watchdog NÃO inicia
        → ❌ Terminal LLM-B precisa: /dialog start (1 PR)
```

### 6.2 Análise de Consumo de PR Atual

| Cenário                              | PR Consumidos | Detalhes                                             |
| ------------------------------------ | :-----------: | ---------------------------------------------------- |
| Boot normal (nova sessão)            |     1 PR      | `createSession` não consome; `dialog boot` consome 1 |
| PM2 restart (sessão válida, < 24h)   |     1 PR      | `resumeSession` = 0 PR; `dialog boot` = 1 PR         |
| PM2 restart (sessão expirada, > 24h) |     1 PR      | `createSession` = 0 PR; `dialog boot` = 1 PR         |
| PC restart (sessão válida)           |     1 PR      | Mesmo que PM2 restart sem auto-dialog                |
| PC restart (sessão expirada)         |     1 PR      | `createSession` + `dialog boot` = 1 PR               |
| Dialog resume (ask_user preservado)  |     0 PR      | Estratégia A — zero cost                             |
| Dialog resume (ask_user perdido)     |     1 PR      | Estratégia B — reboot do dialog                      |

### 6.3 Estratégia Ideal: Zero-PR Dialog Resume Após Restart

O objetivo é eliminar o 1 PR consumed no dialog loop boot após restart. Análise das opções:

**Opção A: SDK `resumeSession()` preserva o `ask_user` pendente**

O SDK persiste conversation history, incluindo o último `ask_user` pendente. Quando `resumeSession()` é chamado, o modelo retoma de onde parou — se o último estado era um `ask_user` pendente, o SDK deveria preservá-lo.

**Hipótese**: Se o SDK reemite o `onUserInputRequest` após resume, o dialog loop pode retomar sem 1 PR adicional.

**Teste necessário**: Verificar se `resumeSession()` aciona `onUserInputRequest` com o `ask_user` preservado.

**Opção B: Auto-start do dialog loop após resume com detecção de contexto**

Após `resumeSession()`, verificar se:
1. `dialogLoopActive: true` no estado persistido
2. Sessão foi retomada com sucesso (`isResumed: true`)
3. Token budget permite (< 80%)

Se todas as condições forem atendidas, auto-start do dialog loop.

**Opção C: Keepalive heartbeat para prevenir expiração de sessão**

Enviar heartbeat periódico (ex: a cada 10 min) via `session.send()` com prompt no-op para prevenir o timeout de 30 min do SDK. Isso mantém a sessão viva durante periods de idle.

### 6.4 Estratégia Recomendada: Combinação B + C

1. **Keepalive** (Opção C): Manter sessão viva durante idle para evitar recriação
2. **Auto-Dialog-Boot** (Opção B): Após resume bem-sucedido, auto-iniciar dialog loop se estava ativo antes do restart
3. **Verificar Opção A**: Testar se SDK preserva `ask_user` após resume para potencial 0 PR

---

## 7. Situação Ideal com Upgrades

### 7.1 Arquitetura Alvo

```
┌─────────────────────────────────────────────────────────────────────┐
│                    ALWAYS-ALIVE AGENT v2.0                          │
│                                                                     │
│  ┌── SESSION LIFECYCLE MANAGER ─────────────────────────────────┐   │
│  │  ┌─ SessionKeepAlive ────────────────────────────────────┐   │   │
│  │  │  • Heartbeat periódico (10min) para prevenir timeout  │   │   │
│  │  │  • Monitoramento de `session.usage_info` contínuo     │   │   │
│  │  │  • Notificação de sessão expirada                     │   │   │
│  │  └───────────────────────────────────────────────────────┘   │   │
│  │                                                               │   │
│  │  ┌─ SessionRotation ─────────────────────────────────────┐   │   │
│  │  │  • Max session age (configurável, default: 8h)        │   │   │
│  │  │  • Max turns per session (configurável, default: 200) │   │   │
│  │  │  • Rotation: disconnect old → create new              │   │   │
│  │  │  • Continuity reference no new session system prompt  │   │   │
│  │  └───────────────────────────────────────────────────────┘   │   │
│  │                                                               │   │
│  │  ┌─ SessionCleanup ──────────────────────────────────────┐   │   │
│  │  │  • Periódico: listSessions() → purge expiradas        │   │   │
│  │  │  • On-boot: limpar sessões > 24h                       │   │   │
│  │  │  • Snapshot cleanup: pruneSnapshots() age-based        │   │   │
│  │  └───────────────────────────────────────────────────────┘   │   │
│  └───────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  ┌── DIALOG LOOP v2.0 ──────────────────────────────────────────┐   │
│  │  ┌─ AutoStart ───────────────────────────────────────────┐   │   │
│  │  │  • On resume: if dialogLoopActive → auto startDialog  │   │   │
│  │  │  • Health check pré-boot (token budget, session ok)   │   │   │
│  │  │  • Delay configurável antes de auto-start (5s)        │   │   │
│  │  └───────────────────────────────────────────────────────┘   │   │
│  │                                                               │   │
│  │  ┌─ PrMetrics Persistence ────────────────────────────────┐   │   │
│  │  │  • Salva prMetrics em state-io a cada boot/resume     │   │   │
│  │  │  • Restaura no constructor do DLM                      │   │   │
│  │  │  • Exposição via API: GET /status/pr-metrics           │   │   │
│  │  └───────────────────────────────────────────────────────┘   │   │
│  │                                                               │   │
│  │  ┌─ ForceDeactivate Fix ──────────────────────────────────┐   │   │
│  │  │  • Reset mutex + queue depth + incremento gen          │   │   │
│  │  │  • Previne execuções fantasma                          │   │   │
│  │  └───────────────────────────────────────────────────────┘   │   │
│  └───────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  ┌── HANDOFF API (F41.3) ───────────────────────────────────────┐   │
│  │  ┌─ HandoffManager ──────────────────────────────────────┐   │   │
│  │  │  • Handler de `session.handoff` event                  │   │   │
│  │  │  • Route: POST /handoff/accept, POST /handoff/reject  │   │   │
│  │  │  • Auto-accept policy (configurável)                   │   │   │
│  │  └───────────────────────────────────────────────────────┘   │   │
│  └───────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  ┌── RECONEXÃO v2.0 ────────────────────────────────────────────┐   │
│  │  • Novo CopilotClient() a cada tentativa (BUG-SD-002 fix)  │   │
│  │  • Exponential backoff com cap 30s (existente)              │   │
│  │  • Health check pós-reconexão                                │   │
│  │  • Auto-dialog-restart após reconexão bem-sucedida          │   │
│  └───────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  ┌── NOVOS EVENTOS SDK PROPAGADOS ──────────────────────────────┐   │
│  │  • session.truncation → emit('session.truncation_warning')  │   │
│  │  • session.handoff → HandoffManager                          │   │
│  │  • session.resume → auto-dialog-start trigger                │   │
│  │  • session.snapshot_rewind → emit + log                      │   │
│  └───────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
```

### 7.2 Upgrades Específicos

#### UPG-SD-01: Session Keepalive (Prevenir Timeout 30min)

Criar `SessionKeepAlive` que envia heartbeat periódico quando:
- Agente está `idle`
- Dialog loop NÃO está ativo (dialog loop já mantém a sessão viva via `ask_user`)
- Última atividade > 20 min

```js
class SessionKeepAlive {
    #timer = null;
    #session = null;
    #intervalMs = 10 * 60_000; // 10 min

    start(session) { /* setInterval → session.send({prompt: '[keepalive]'}) */ }
    stop() { /* clearInterval */ }
    ping() { /* reset timer */ }
}
```

#### UPG-SD-02: Auto Dialog Loop Start Após Resume

Em `AlwaysAliveAgent.start()`, após sessão retomada com sucesso:

```js
if (isResumed) {
    const state = readState();
    if (state?.dialogLoopActive && !state?.dialogPaused) {
        const snapshot = loadLatestSnapshot();
        const tokenBudgetOk = this.#contextState?.utilization < 0.8;
        if (tokenBudgetOk) {
            log('INFO', '[AlwaysAlive] Auto-starting dialog loop após resume...');
            setTimeout(() => this.startDialogLoop(), 5_000); // delay para estabilizar
        }
    }
}
```

#### UPG-SD-03: ForceDeactivate Fix (BUG-SD-006)

```js
forceDeactivate() {
    this.#active = false;
    this.#turnMutex = Promise.resolve();
    this.#turnQueueDepth = 0;
    this.#turnMutexGen++;
    this.#watchdog?.stop();
    this.#watchdog = null;
    this.emit('stopped', { reason: 'force_deactivate', authorized: false });
    this.emit('changed', { active: false, ts: Date.now(), reason: 'force_deactivate' });
}
```

#### UPG-SD-04: PrMetrics Persistence

Salvar prMetrics em `writeStateAsync` a cada boot/resume; restaurar no constructor:

```js
// No DLM constructor:
const saved = readState()?.prMetrics;
if (saved) this.#prMetrics = { ...saved };

// No DLM start() após boot bem-sucedido:
writeStateAsync({ prMetrics: this.#prMetrics });
```

#### UPG-SD-05: Reconnect com Novo Client (BUG-SD-002 Fix)

```js
// reconnect-policy.js — criar novo client a cada tentativa
const freshClient = new CopilotClient();
const { session, isResumed } = await initSession(freshClient);
// Atualizar referência no host
callbacks.updateClient(freshClient);
```

#### UPG-SD-06: Session Cleanup Proativo

Periódico (ex: a cada boot + diário):
```js
const sessions = await client.listSessions();
for (const s of sessions) {
    if (Date.now() - s.lastActivity > 24*60*60*1000) {
        await client.deleteSession(s.sessionId);
    }
}
```

#### UPG-SD-07: Propagação de Eventos Silenciados

Propagar `session.truncation`, `session.handoff`, `session.snapshot_rewind` no `session-event-wirer.js`.

#### UPG-SD-08: Health Check Pré-Boot do Dialog Loop

Antes de `startDialogLoop()`:
```js
// Verificar token budget
if (this.#contextState?.utilization > 0.85) {
    log('WARN', '[AlwaysAlive] Token budget alto — aguardando compaction antes do dialog boot');
    await once(this, 'session.compaction_complete', { timeout: 30_000 });
}
```

#### UPG-SD-09: Session Rotation Policy

```js
class SessionRotation {
    #maxAgeMs = 8 * 60 * 60_000;  // 8h
    #maxTurns = 200;

    shouldRotate(startedAt, turnCount) {
        return (Date.now() - startedAt > this.#maxAgeMs) ||
               (turnCount > this.#maxTurns);
    }

    async rotate(agent) {
        await agent.stop();
        clearState();
        await agent.start(); // Nova sessão limpa
    }
}
```

---

## 8. Roadmap Detalhado — Fases e Sub-fases

### Fase F42 — Session Resilience Foundation

> Prioridade: P0 — Impacto direto em consumo de PR e resiliência

#### F42.1 — Auto Dialog Loop Start Após Resume
- **Arquivo**: `always-alive.js`
- **O que**: Após `start()` com `isResumed: true`, verificar `dialogLoopActive` no estado e auto-iniciar
- **Condições**: `isResumed && dialogLoopActive && !dialogPaused && tokenBudget < 80%`
- **Delay**: 5s para estabilização
- **PR Cost**: 1 PR (boot do dialog) — inevitável, mas automático sem intervenção manual
- **Testes**: Unitário + integração com mock de session

#### F42.2 — Session Keepalive Heartbeat
- **Arquivo**: Novo `src/copilot/agent/session-keepalive.js`
- **O que**: Timer que envia heartbeat quando idle > 20min e dialog loop inativo
- **Intervalo**: 10min (configurável via AGENT_KEEPALIVE_MS)
- **Integra com**: `start()` (liga), `stop()` (desliga), `startDialogLoop()` (pausa — dialog mantém vivo)
- **Testes**: Unitário com fake timers

#### F42.3 — ForceDeactivate v2 (BUG-SD-006)
- **Arquivo**: `dialog-loop-manager.js:465`
- **O que**: Reset completo de mutex, queue depth e generation counter
- **Impacto**: Previne execuções fantasma após shutdown forçado
- **Testes**: Unitário com turns enfileirados + forceDeactivate

#### F42.4 — PrMetrics Persistence (BUG-SD-003)
- **Arquivo**: `dialog-loop-manager.js` + `always-alive.js`
- **O que**: Salvar prMetrics em `sdk-always-alive.json` a cada boot/resume; restaurar no construct
- **Testes**: Unitário — save/restore cycle

#### F42.5 — Reconnect com Novo Client (BUG-SD-002)
- **Arquivo**: `reconnect-policy.js` + `always-alive.js`
- **O que**: Criar novo `CopilotClient()` a cada tentativa de reconexão
- **Impacto**: Evita reutilização de client parado
- **Breaking**: `#tryReconnect` precisa atualizar `this.#client`
- **Testes**: Unitário com mock de CopilotClient

#### F42.6 — Resume Atomicity Fix (BUG-SD-007)
- **Arquivo**: `dialog-loop-manager.js:393`
- **O que**: Adicionar flag `#resuming` para prevenir interleaving entre `resume()` e `start()`
- **Testes**: Unitário com chamadas concorrentes

### Fase F43 — Session Lifecycle Management

> Prioridade: P1 — Governance e cleanup de sessões

#### F43.1 — Session Cleanup On-Boot
- **Arquivo**: `always-alive.js` (em `start()`) ou nova `session-cleanup.js`
- **O que**: `listSessions()` → deletar sessões > 24h no boot do agente
- **Quando**: Após `initSession()`, antes de `emit('ready')`
- **Testes**: Unitário com mock de listSessions/deleteSession

#### F43.2 — Session Rotation Policy
- **Arquivo**: Novo `src/copilot/agent/session-rotation.js`
- **O que**: Política de rotação baseada em idade (8h) ou turnos (200)
- **Trigger**: Avaliado no `session.usage_info` event
- **Ação**: Disconnect old → clearState → start() → dialog auto-start
- **Testes**: Unitário + integração

#### F43.3 — Propagação de `session.truncation`
- **Arquivo**: `session-event-wirer.js`
- **O que**: Handler dedicado para `session.truncation` — emitir warning no AGENT + log
- **Impacto**: Visibilidade de degradação de contexto
- **Testes**: Unitário

#### F43.4 — Propagação de `session.snapshot_rewind`
- **Arquivo**: `session-event-wirer.js`
- **O que**: Handler dedicado — emitir no AGENT EventEmitter + log com detalhes
- **Testes**: Unitário

### Fase F44 — Dialog Loop Hardening v2

> Prioridade: P1 — Robustez operacional

#### F44.1 — Health Check Pré-Boot
- **Arquivo**: `always-alive.js` ou `dialog-loop-manager.js`
- **O que**: Antes de `startDialogLoop()`, verificar token budget, connection health
- **Se budget > 85%**: Aguardar compaction ou emitir warning
- **Testes**: Unitário

#### F44.2 — `stopDialogLoop` com `shutdownTimeoutMs` (BUG-SD-005)
- **Arquivo**: `always-alive.js:991`
- **O que**: Expor `shutdownTimeoutMs` na assinatura pública de `stopDialogLoop()`
- **Testes**: Unitário

#### F44.3 — Dialog Protocol Efficiency (BUG-SD-004)
- **Arquivo**: `always-alive.js:1285`
- **O que**: Pular `writeStateAsync({ pendingQuestion })` para mensagens READY/REPLY do protocolo
- **Impacto**: Reduz I/O desnecessário no hot path do dialog loop
- **Testes**: Unitário

### Fase F45 — F41.3 Handoff API

> Prioridade: P2 — Feature nova baseada em evento SDK

#### F45.1 — Handler de `session.handoff` Event
- **Arquivo**: `session-event-wirer.js`
- **O que**: Subscrever `session.handoff`, emitir no AGENT EventEmitter
- **Dados**: `{ fromSessionId, toSessionId, reason, handoffData }`
- **Testes**: Unitário

#### F45.2 — HandoffManager
- **Arquivo**: Novo `src/copilot/agent/handoff-manager.js`
- **O que**: Gerencia handoff requests — accept, reject, auto-accept policy
- **API**: `accept(handoffId)`, `reject(handoffId, reason)`, `setPolicy('auto' | 'manual')`
- **Testes**: Unitário

#### F45.3 — Rotas HTTP de Handoff
- **Arquivo**: Rotas no servidor HTTP existente
- **O que**: `POST /handoff/accept`, `POST /handoff/reject`, `GET /handoff/pending`
- **Testes**: Integração HTTP

#### F45.4 — Terminal Commands de Handoff
- **Arquivo**: Novo command em `terminal/commands/handoff.js`
- **O que**: `/handoff list`, `/handoff accept <id>`, `/handoff reject <id> [reason]`
- **Testes**: Unitário

### Fase F46 — Observabilidade Avançada de Sessão

> Prioridade: P2 — Visibilidade e diagnóstico

#### F46.1 — Dashboard Widget de Session Lifecycle
- **O que**: Visualizar no dashboard: idade da sessão, turns, token usage, PR consumed, rotation schedule
- **Testes**: Unitário Vue component

#### F46.2 — Session Metrics Export
- **O que**: Endpoint `GET /metrics/session` com Prometheus-style metrics
- **Métricas**: session_age_ms, session_turns_total, pr_consumed_total, compaction_count, reconnect_count
- **Testes**: Integração HTTP

#### F46.3 — Auditoria de Eventos SDK Completa
- **O que**: Verificar todos os 83 tipos de eventos documentados no streaming-events.md; garantir que cada um tem tratamento (handler, forward ou suppress documentado)
- **Resultado**: Tabela exaustiva de cobertura

---

## Resumo de Prioridades

| Fase    | Items       | Prioridade | Foco                                |
| ------- | ----------- | :--------: | ----------------------------------- |
| **F42** | 6 sub-items |   **P0**   | Resiliência de sessão e dialog loop |
| **F43** | 4 sub-items |   **P1**   | Lifecycle management                |
| **F44** | 3 sub-items |   **P1**   | Dialog loop hardening               |
| **F45** | 4 sub-items |   **P2**   | Handoff API (F41.3)                 |
| **F46** | 3 sub-items |   **P2**   | Observabilidade avançada            |

**Total**: 20 sub-items em 5 fases.

---

## Apêndice A — Eventos SDK Documentados vs Implementação

| Evento SDK                  | Wirer  | EventCollector |   Agent Emit    | Notas                             |
| --------------------------- | :----: | :------------: | :-------------: | --------------------------------- |
| session.idle                |   ✗    |       ✓        |        ✗        | Apenas observabilidade            |
| session.error               |   ✓    |       ✓        |        ✓        | Propagado com tipo+mensagem       |
| session.compaction_start    |   ✓    |       ✓        |        ✓        | Full handler                      |
| session.compaction_complete |   ✓    |       ✓        |        ✓        | Full handler + checkpoint         |
| session.usage_info          |   ✓    |       ✓        |        ✓        | Token budget + context state      |
| session.shutdown            |   ✓    |       ✓        |        ✓        | Propagado                         |
| session.task_complete       |   ✓    |       ✓        |        ✓        | Propagado                         |
| session.title_changed       |   ✓    |       ✓        |        ✓        | Propagado                         |
| session.context_changed     |   ✓    |       ✓        |        ✓        | Propagado                         |
| session.mode_changed        |   ✓    |       ✓        |        ✓        | Log + propagado                   |
| session.truncation          |   ✓    |       ✗        |        ✓        | ✅ F43.3 — propagado             |
| session.handoff             |   ✓    |       ✓        |        ✓        | ✅ F45.1 — HandoffManager        |
| session.resume              |   ✗    |       ✓        |        ✗        | Apenas observabilidade            |
| session.snapshot_rewind     |   ✓    |       ✗        |        ✓        | ✅ F43.4 — propagado             |
| assistant.turn_start        |   ✓    |       ✓        |        ✓        | Propagado                         |
| assistant.turn_end          |   ✓    |       ✓        |        ✓        | Propagado                         |
| assistant.intent            |   ✓    |       ✓        |        ✓        | Propagado                         |
| assistant.reasoning         |   ✓    |       ✓        |        ✓        | Propagado (completo)              |
| assistant.reasoning_delta   |   ✓    |       ✓        |        ✓        | Task reasoning                    |
| assistant.message           |   ✗    |       ✓        |        ✗        | Apenas observabilidade            |
| assistant.message_delta     |   ✓    |       ✓        |        ✓        | Task/dialog delta routing         |
| assistant.usage             |   ✓    |       ✓        |        ✓        | Billing/PR tracking               |
| tool.execution_start        | ✗wirer |       ✓        | ✓ task-executor | Per-task handler                  |
| tool.execution_complete     | ✗wirer |       ✓        | ✓ task-executor | Per-task handler                  |
| tool.execution_progress     |   ✗    |       ✓        |        ✗        | Apenas observabilidade            |
| tool.user_requested         |   ✗    |       ✓        |        ✗        | Apenas observabilidade            |
| abort                       |   ✓    |       ✓        |        ✓        | Propagado                         |
| subagent.started            |   ✓    |       ✓        |        ✓        | Propagado                         |
| subagent.completed          |   ✓    |       ✓        |        ✓        | Propagado                         |
| subagent.failed             |   ✓    |       ✓        |        ✓        | Propagado                         |
| elicitation.requested       |   ✓    |       ✓        |        ✓        | Surfaced como elicitation.pending |
| system.notification         |   ✓    |       ✓        |        ✓        | Sub-typed routing                 |
| user_input.requested        |   ✗    |       ✓        |        ✗        | Handled by onUserInputRequest     |
| user_input.completed        |   ✗    |       ✓        |        ✗        | Apenas observabilidade            |
| permission.requested        |   ✗    |       ✓        |        ✗        | Handled by onPermissionRequest    |
| permission.completed        |   ✗    |       ✓        |        ✗        | Apenas observabilidade            |

---

## Apêndice B — Arquivos a Modificar por Fase

| Fase | Arquivos Novos                              | Arquivos Modificados                                               |
| ---- | ------------------------------------------- | ------------------------------------------------------------------ |
| F42  | `session-keepalive.js`                      | `always-alive.js`, `dialog-loop-manager.js`, `reconnect-policy.js` |
| F43  | `session-rotation.js`, `session-cleanup.js` | `always-alive.js`, `session-event-wirer.js`                        |
| F44  | —                                           | `always-alive.js`, `dialog-loop-manager.js`                        |
| F45  | `handoff-manager.js`, `commands/handoff.js` | `session-event-wirer.js`, routes HTTP                              |
| F46  | —                                           | Dashboard Vue, routes HTTP                                         |

---

## Apêndice C — Status de Implementação (atualizado 2026-04-06)

> Todas as 20 subfases foram implementadas e verificadas com sucesso.

| Subfase | Descrição                                 | Status | Commit   |
| ------- | ----------------------------------------- | :----: | -------- |
| F42.1   | Auto-start dialog loop após resume        |   ✅    | Pendente |
| F42.2   | Session Keepalive heartbeat               |   ✅    | Pendente |
| F42.3   | ForceDeactivate fix (BUG-SD-006)          |   ✅    | Pendente |
| F42.4   | PrMetrics persistence (BUG-SD-003)        |   ✅    | Pendente |
| F42.5   | Reconnect com client fresco (BUG-SD-002)  |   ✅    | Pendente |
| F42.6   | Resume atomicity fix (BUG-SD-007)         |   ✅    | Pendente |
| F43.1   | Session cleanup on-boot (GAP-SD-01)       |   ✅    | Pendente |
| F43.2   | Session rotation policy (GAP-SD-03)       |   ✅    | Pendente |
| F43.3   | Propagação session.truncation (GAP-SD-06) |   ✅    | Pendente |
| F43.4   | Propagação snapshot_rewind (GAP-SD-04)    |   ✅    | Pendente |
| F44.1   | Health check pré-boot dialog              |   ✅    | Pendente |
| F44.2   | shutdownTimeoutMs em stopDialogLoop       |   ✅    | Pendente |
| F44.3   | Dialog protocol efficiency (BUG-SD-004)   |   ✅    | Pendente |
| F45.1   | Handler session.handoff no wirer          |   ✅    | Pendente |
| F45.2   | HandoffManager                            |   ✅    | Pendente |
| F45.3   | Rotas HTTP para handoff                   |   ✅    | Pendente |
| F45.4   | Comando /handoff no REPL                  |   ✅    | Pendente |
| F46.1   | Métricas de sessão no dashboard           |   ✅    | Pendente |
| F46.2   | Exportação Prometheus de sessão           |   ✅    | Pendente |
| F46.3   | Auditoria completa de eventos SDK         |   ✅    | Pendente |

### Arquivos criados (4)

- `src/copilot/agent/session-keepalive.js` — F42.2
- `src/copilot/agent/session-cleanup.js` — F43.1
- `src/copilot/agent/session-rotation.js` — F43.2
- `src/copilot/agent/handoff-manager.js` — F45.2

### Testes criados (4)

- `tests/unit/copilot/test_session_keepalive.spec.js` — 8 testes
- `tests/unit/copilot/test_session_cleanup.spec.js` — 5 testes
- `tests/unit/copilot/test_session_rotation.spec.js` — 9 testes
- `tests/unit/copilot/test_handoff_manager.spec.js` — 10 testes

### Arquivos modificados (13)

- `src/copilot/agent/always-alive.js` — integrações F42-F46
- `src/copilot/agent/dialog-loop-manager.js` — F42.3, F42.4, F42.6
- `src/copilot/agent/reconnect-policy.js` — F42.5
- `src/copilot/agent/session-event-wirer.js` — F43.3, F43.4, F45.1
- `src/copilot/agent/session-initializer.js` — F43.2
- `src/copilot/agent/state-io.js` — F42.4
- `src/copilot/observability/metrics.js` — F46.1
- `src/copilot/terminal/handlers-agent.js` — F45.3
- `src/copilot/terminal/handlers-system.js` — F46.2
- `src/copilot/terminal/http-handlers.js` — F45.3
- `src/copilot/terminal/route-table.js` — F45.3
- `src/copilot/terminal/repl.js` — F45.4

### Verificação

- TypeScript: **0 erros** (`npx tsc -p tsconfig.node.json --noEmit`)
- ESLint: **0 erros** em todos os arquivos novos e modificados
- Testes unitários: **2216/2216 passam** (32 novos + 2184 pré-existentes), 658 suites, 0 falhas
