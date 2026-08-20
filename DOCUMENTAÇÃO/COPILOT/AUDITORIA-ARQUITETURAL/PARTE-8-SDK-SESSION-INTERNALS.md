# PARTE 8 — SDK Session Internals: Mecanismos de Recuperação, ask_user e Consumo de PR

**Data**: 2026-02-XX **Escopo**: Investigação profunda do `@github/copilot-sdk@0.2.0` — `client.js`,
`session.js`, `types.d.ts`, `session-events.d.ts` **Objetivo**: Documentar como o SDK lida
internamente com reconexão, retry, ask_user, consumo de Premium Requests (PR) e como nosso sistema
se alinha a esses mecanismos.

---

## 1. Arquitetura de Comunicação do SDK

### 1.1 Transporte (JSON-RPC 2.0)

O SDK usa `vscode-jsonrpc` sobre:

- **stdio** (padrão): pipes stdin/stdout para o CLI child process
- **TCP socket**: conexão via porta (modo `cliUrl` ou `--port`)

A conexão é gerenciada via `MessageConnection` da lib `vscode-jsonrpc/node.js`.

### 1.2 Protocol Version Negotiation

Na inicialização, o SDK faz `ping()` e verifica `protocolVersion` do servidor. Se fora do range
`MIN_PROTOCOL_VERSION..getSdkProtocolVersion()`, lança erro. A versão negociada é armazenada em
`this.negotiatedProtocolVersion`.

### 1.3 Connection State Machine

```
disconnected → connecting → connected
                    ↓ (falha)
                  error
```

A transição para `disconnected` acontece em:

- `connection.onClose()` — chamada quando a conexão fecha
- `connection.onError()` — chamada quando a conexão emite erro
- `stop()` / `forceStop()` — shutdown explícito

**Achado crítico**: O SDK **NÃO** implementa reconnect automático. Quando `state` muda para
`disconnected` ou `error`, o SDK simplesmente para. A reconexão é responsabilidade do consumer
(nosso `reconnect-policy.js`).

---

## 2. Mecanismo de Reconexão (Nosso vs SDK)

### 2.1 O Que o SDK NÃO Faz

1. **Zero auto-reconnect**: `autoRestart` é deprecated e ignorado (`autoRestart: false` no
   constructor)
2. **Zero retry de RPC**: chamadas `sendRequest()` falham diretamente com `ConnectionError` /
   `ResponseError`
3. **Zero heartbeat nativo**: não há keep-alive ou ping periódico no SDK

### 2.2 O Que NÓS Fazemos (reconnect-policy.js)

| Feature                  | Implementação                                  |
| ------------------------ | ---------------------------------------------- |
| Backoff exponencial      | `base * 2^(attempt-1) + jitter` com cap de 30s |
| Max tentativas           | 5 (default)                                    |
| Fresh client por attempt | F42.5: `createClient()` → `updateClient()`     |
| Stop do client antigo    | `client.stop()` antes de cada tentativa        |
| Resume do dialog         | `dialogLoop.notifyReconnect()` após sucesso    |
| Evento fatal             | `session.fatal` após esgotamento               |

### 2.3 Avaliação

**CORRETO**: nossa política está **bem alinhada** com o SDK. O SDK espera que o consumer faça
reconexão, e nós fazemos com backoff+jitter+fresh-client.

**MELHORIA POTENCIAL M-01**: Considerar `client.ping()` como health check antes de declarar sucesso
na reconexão — atualmente declaramos sucesso após `initSession()` resolver, mas o client poderia
estar em estado "connected" com pipe quebrado.

---

## 3. Mecanismo ask_user (Suspensão do Dialog Loop)

### 3.1 Fluxo SDK

```
Modelo invoca tool ask_user
  → CLI envia RPC "userInput.request" { sessionId, question, choices?, allowFreeform }
  → SDK chama registered onUserInputRequest handler
  → Handler retorna { answer, wasFreeform }
  → SDK retorna resultado via RPC
  → Modelo continua execução
```

**Ponto-chave**: A Promise do `onUserInputRequest` handler fica pendente até que o consumer
responda. O CLI fica **bloqueado nessa mensagem** — não processa mais nada até a resposta.

### 3.2 O Que NÓS Fazemos

```
SDK invoca onUserInputRequest
  → #handleUserInputRequest() no AlwaysAliveAgent
  → Se dialog loop ativo:
      → #handleDialogLoopInput(): classifica READY/REPLY/STOPPED via DLM
      → Suspende via Promise (pendingQuestion.resolve)
  → Se NÃO dialog loop:
      → #handleInteractiveQuestion(): set status='waiting_for_input'
      → Persiste pendingQuestion no state
      → Suspende via Promise até answerPendingQuestion() via HTTP
      → Emite 'question.pending'
```

### 3.3 Análise de PR-Zero nos Resumes

Quando um resume acontece:

1. **Estratégia A (zero-PR)**: Se `getPendingQuestion()` retorna algo → o SDK ask_user ainda está
   pendente → responder diretamente sem novo send
2. **Estratégia A async (zero-PR)**: Aguarda evento `question.pending` por 5s
3. **Estratégia B (1 PR)**: Reenvia boot prompt → consome 1 PR

**Achado**: Esta arquitetura é correta. O SDK mantém a Promise pendente do `onUserInputRequest`
mesmo durante um `session.resume` (a sessão é retomada no CLI, mas o handler local ainda segura a
Promise).

---

## 4. Consumo de Premium Requests — create vs resume

### 4.1 Fluxo no SDK

| Operação                 | RPC Enviado                | Consome PR?                 |
| ------------------------ | -------------------------- | --------------------------- |
| `createSession()`        | `session.create`           | Não (zero prompts enviados) |
| `resumeSession()`        | `session.resume`           | Não (apenas reconecta)      |
| `session.send()`         | `session.send`             | **Sim** (1 PR por send)     |
| `session.sendAndWait()`  | `session.send` + wait idle | **Sim** (1 PR)              |
| `session.abort()`        | `session.abort`            | Não                         |
| `session.disconnect()`   | `session.destroy`          | Não                         |
| `client.deleteSession()` | `session.delete`           | Não                         |
| `client.listSessions()`  | `session.list`             | Não                         |
| `client.ping()`          | `ping`                     | Não                         |

### 4.2 Implicações Para Nós

- **Reconexão pura** (stop→start→resume) = **0 PR** ✅
- **Resume + Estratégia A** (ask_user preservado) = **0 PR** ✅
- **Resume + Estratégia B** (reenviar boot prompt) = **1 PR** ⚠️
- **Fresh session** (createSession + boot prompt send) = **1 PR** ⚠️

### 4.3 Keepalive (F42.2)

Nosso `SessionKeepalive` faz `session.send({prompt:'[keepalive]'})` a cada 10min quando idle ≥
20min. Cada keepalive **consome 1 PR**.

**MELHORIA POTENCIAL M-02**: Usar `client.ping()` (0 PR) como heartbeat de conectividade, e reservar
`session.send()` apenas quando necessário para prevenir idle timeout real do CLI.

---

## 5. Hook `onErrorOccurred` — Error Recovery

### 5.1 Tipos de Erro e Estratégia (SDK)

```typescript
ErrorOccurredHookInput {
    error: string;
    errorContext: 'model_call' | 'tool_execution' | 'system' | 'user_input';
    recoverable: boolean;
}

ErrorOccurredHookOutput {
    errorHandling?: 'retry' | 'skip' | 'abort';
    retryCount?: number;
    userNotification?: string;
}
```

### 5.2 Nossa Implementação (hooks/factory.js)

| errorContext     | recoverable | Ação       |
| ---------------- | ----------- | ---------- |
| `model_call`     | true        | retry (3x) |
| `tool_execution` | true        | skip       |
| qualquer         | false       | abort      |

**Status**: Correto e alinhado com o SDK. O hook `onErrorOccurred` é o mecanismo **oficial** de
retry — o SDK **não** faz retry internamente sem este hook.

---

## 6. Infinite Sessions & Compaction

### 6.1 Mecanismo do SDK

```typescript
InfiniteSessionConfig {
    enabled?: boolean;                      // default: true
    backgroundCompactionThreshold?: number; // default: 0.80
    bufferExhaustionThreshold?: number;     // default: 0.95
}
```

**Fluxo**:

1. `session.usage_info` emitido periodicamente com token counts
2. Quando `currentTokens/tokenLimit ≥ backgroundCompactionThreshold`:
   - `session.compaction_start` emitido
   - CLI faz LLM call para resumir contexto anterior
   - `session.compaction_complete` com `summaryContent`, `checkpointNumber`, `checkpointPath`
3. Quando `contextUtilization ≥ bufferExhaustionThreshold`: compaction síncrona (bloqueia sends)

### 6.2 Nosso Tratamento

- `session-event-wirer.js` escuta `compaction_start` e `compaction_complete`
- Checkpoint path é propagado via callback
- Token budget warnings em > 70% (resumed) e > 80% (normal)
- `session-rotation.js` F43.2: rotação quando `contextUtilization ≥ 0.90` ou outros critérios

**Status**: Bem alinhado ✅

---

## 7. Eventos SDK Completos: O Que Escutamos vs O Que Existe

### 7.1 Todos os Eventos do SDK (session-events.d.ts)

| Evento                              | Escutamos?       | Handler                                     |
| ----------------------------------- | ---------------- | ------------------------------------------- |
| `session.start`                     | ✅ KNOWN         | event-collector                             |
| `session.resume`                    | ✅ KNOWN         | event-collector                             |
| `session.error`                     | ✅ WIRED         | session-event-wirer → `session.error`       |
| `session.idle`                      | ✅ KNOWN         | sendAndWait (internal)                      |
| `session.truncation`                | ✅ WIRED (F43.3) | session-event-wirer                         |
| `session.snapshot_rewind`           | ✅ WIRED (F43.4) | session-event-wirer                         |
| `session.shutdown`                  | ✅ WIRED         | session-event-wirer                         |
| `session.context_changed`           | ✅ WIRED         | session-event-wirer                         |
| `session.usage_info`                | ✅ WIRED         | session-event-wirer → `session.usage`       |
| `session.compaction_start`          | ✅ WIRED         | session-event-wirer                         |
| `session.compaction_complete`       | ✅ WIRED         | session-event-wirer                         |
| `session.task_complete`             | ✅ WIRED         | session-event-wirer                         |
| `session.mode_changed`              | ✅ WIRED         | session-event-wirer                         |
| `session.handoff`                   | ✅ WIRED (F45.1) | session-event-wirer                         |
| `session.title_changed`             | ✅ WIRED         | session-event-wirer                         |
| `session.tools_updated`             | ✅ KNOWN         | event-collector                             |
| `session.warning`                   | ✅ KNOWN         | event-collector                             |
| `session.background_tasks_changed`  | ✅ KNOWN         | event-collector                             |
| `session.extensions_loaded`         | ✅ KNOWN         | event-collector                             |
| `session.mcp_servers_loaded`        | ✅ KNOWN         | event-collector                             |
| `session.mcp_server_status_changed` | ✅ KNOWN         | event-collector                             |
| `session.skills_loaded`             | ✅ KNOWN         | event-collector                             |
| `session.plan_changed`              | ✅ KNOWN         | event-collector                             |
| `session.info`                      | ✅ KNOWN         | silenciado                                  |
| `session.workspace_file_changed`    | ✅ KNOWN         | silenciado                                  |
| `assistant.message`                 | ✅ KNOWN         | event-collector + sendAndWait               |
| `assistant.message_delta`           | ✅ WIRED         | session-event-wirer → streaming             |
| `assistant.reasoning_delta`         | ✅ WIRED         | session-event-wirer → streaming             |
| `assistant.reasoning`               | ✅ WIRED         | session-event-wirer                         |
| `assistant.intent`                  | ✅ WIRED         | session-event-wirer                         |
| `assistant.turn_start`              | ✅ WIRED         | session-event-wirer                         |
| `assistant.turn_end`                | ✅ WIRED         | session-event-wirer                         |
| `assistant.usage`                   | ✅ WIRED         | session-event-wirer → billing               |
| `abort`                             | ✅ WIRED         | session-event-wirer                         |
| `user.message`                      | ✅ KNOWN         | event-collector                             |
| `user_input.requested`              | ✅ KNOWN         | event-collector                             |
| `user_input.completed`              | ✅ KNOWN         | event-collector                             |
| `permission.requested`              | ✅ KNOWN         | session.js internal                         |
| `permission.completed`              | ✅ KNOWN         | event-collector                             |
| `external_tool.requested`           | ✅ KNOWN         | session.js internal                         |
| `external_tool.completed`           | ✅ KNOWN         | event-collector                             |
| `elicitation.requested`             | ✅ WIRED         | session-event-wirer → `elicitation.pending` |
| `elicitation.completed`             | ✅ KNOWN         | event-collector                             |
| `tool.execution_start`              | ✅ KNOWN         | task-executor                               |
| `tool.execution_complete`           | ✅ KNOWN         | task-executor                               |
| `tool.execution_progress`           | ✅ KNOWN         | event-collector                             |
| `tool.user_requested`               | ✅ KNOWN         | event-collector                             |
| `subagent.started`                  | ✅ WIRED         | session-event-wirer                         |
| `subagent.completed`                | ✅ WIRED         | session-event-wirer                         |
| `subagent.failed`                   | ✅ WIRED         | session-event-wirer                         |
| `subagent.selected`                 | ✅ KNOWN         | event-collector                             |
| `subagent.deselected`               | ✅ KNOWN         | event-collector                             |
| `system.notification`               | ✅ WIRED         | session-event-wirer                         |
| `skill.invoked`                     | ✅ KNOWN         | event-collector                             |
| `command.execute`                   | ✅ KNOWN         | event-collector                             |
| `hook.start`                        | ✅ KNOWN         | event-collector                             |
| `hook.end`                          | ✅ KNOWN         | event-collector                             |
| `mcp.oauth_required`                | ✅ KNOWN         | event-collector                             |
| `mcp.oauth_completed`               | ✅ KNOWN         | event-collector                             |

**Cobertura: 100%** — Todos os 60+ tipos de evento do SDK estão em `KNOWN_SDK_EVENTS` ou possuem
handler dedicado.

---

## 8. Achados e Melhorias Potenciais

### M-01: Health Check Pós-Reconexão

**Problema**: Após reconexão, declaramos sucesso quando `initSession()` resolve, mas o transport
pode estar em estado inconsistente.

**Solução**: Adicionar `client.ping()` como validação final antes de emitir `'ready'`.

**Impacto**: 0 PR, maior confiabilidade.

### M-02: Keepalive com ping() em vez de send()

**Problema**: Cada keepalive consome 1 PR via `session.send({prompt:'[keepalive]'})`.

**Solução**: Usar `client.ping()` (0 PR) para verificar conectividade. O keepalive send só seria
necessário se o CLI tiver idle timeout que exija atividade de sessão (não apenas conectividade).

**Impacto**: Elimina PRs desperdiçados em keepalives. Porém, se o CLI descarta sessões idle, ping()
não previne isso — precisa de investigação sobre o comportamento do CLI.

**Decisão**: Implementar abordagem híbrida — `ping()` como default, `send()` apenas se CLI realmente
dropar a sessão.

### M-03: Client Lifecycle Hooks

**Problema**: O SDK emite `client.on('session.created'|'session.deleted'|'session.updated')` via
lifecycle handlers, mas nós não os usamos.

**Solução**: Registrar lifecycle handlers no client para auditar criações/deleções de sessão
externas (ex.: outro consumer conectado ao mesmo CLI).

**Impacto**: Melhor observabilidade de sessões concorrentes.

### M-04: Session Abort como Mecanismo de Timeout

**Problema**: Não usamos `session.abort()` para cancelar operações longas.

**Solução**: Integrar `session.abort()` com o watchdog do dialog loop — quando o watchdog detecta
stall, poderia abortar a mensagem em vez de matar o dialog loop.

**Impacto**: Recuperação mais granular de stalls, sem perder o dialog loop inteiro.

### M-05: Session Log como Canal de Debug

**Problema**: Não usamos `session.log()` para injetar mensagens de debug no timeline da sessão.

**Solução**: Usar `session.log()` para registrar eventos significativos (reconexão, rotação,
keepalive) no timeline SDK, tornando-os visíveis em ferramentas de debug do SDK.

**Impacto**: Melhor debugging e auditoria.

### M-06: disableResume para Reconexões Silenciosas

**Problema**: Nosso resume sempre emite `session.resume` event no CLI.

**Solução**: Usar `disableResume: true` em reconexões (reconnect-policy) para evitar side-effects do
resume event (ex.: re-execução de onSessionStart), já que é uma reconexão técnica e não uma retomada
semântica.

**Impacto**: Reconexões mais limpas, sem triggers de lifecycle desnecessários.

---

## 9. Resumo Executivo

| Aspecto              | Status               | Nota                               |
| -------------------- | -------------------- | ---------------------------------- |
| Reconexão            | ✅ Correto           | Alinhado com SDK (consumer-driven) |
| ask_user/dialog loop | ✅ Correto           | Promise suspension pattern         |
| PR consumption       | ✅ Minimizado        | Zero-PR em resume/reconnect        |
| Error hooks          | ✅ Correto           | retry/skip/abort por contexto      |
| Event coverage       | ✅ 100%              | 60+ tipos cobertos                 |
| Compaction           | ✅ Correto           | Threshold + observabilidade        |
| Keepalive            | ⚠️ Melhoria M-02     | send() consome PR; ping() não      |
| Health check         | ⚠️ Melhoria M-01     | ping() após reconexão              |
| Lifecycle hooks      | ⚠️ Melhoria M-03     | client.on() não utilizado          |
| Abort                | ⚠️ Melhoria M-04     | session.abort() subutilizado       |
| Session log          | ℹ️ Nice-to-have M-05 | session.log() não utilizado        |
| disableResume        | ℹ️ Nice-to-have M-06 | Reconexões mais limpas             |

---

## Appendix A — RPCs do SDK (session-scoped)

```
session.create    → cria sessão (0 PR)
session.resume    → retoma sessão (0 PR)
session.send      → envia prompt (1 PR por send)
session.destroy   → disconnect local (0 PR)
session.delete    → remove de disco (0 PR)
session.abort     → cancela mensagem (0 PR)
session.getMessages → histórico (0 PR)
session.list      → listar sessões (0 PR)
session.getLastId → último ID (0 PR)
session.getForeground → TUI mode (0 PR)
session.setForeground → TUI mode (0 PR)
model.switchTo    → trocar modelo (0 PR)
agent.select      → selecionar agente (0 PR)
log               → log no timeline (0 PR)
ping              → health check (0 PR)
status.get        → versão/protocol (0 PR)
auth.getStatus    → auth info (0 PR)
models.list       → listar modelos (0 PR)
```

## Appendix B — Lifecycle Events do Client

```
session.created     → nova sessão criada
session.deleted     → sessão removida
session.updated     → sessão atualizada
session.foreground  → sessão virou foreground (TUI)
session.background  → sessão virou background (TUI)
```
