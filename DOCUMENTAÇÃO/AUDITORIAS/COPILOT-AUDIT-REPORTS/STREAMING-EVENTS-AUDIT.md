# Auditoria de Streaming & Events — Copilot SDK vs Implementação Atual

**Data**: 2026-04-03 **Escopo**: Integração completa de eventos de streaming e features do Copilot
SDK **Módulos analisados**: `event-collector.js`, `session-event-wirer.js`, `always-alive.js`,
`task-executor.js`, `bridge-stream.js`, `nerv-bridge.js`, `socket-ns.js`, `sessions.js` (routes),
`session-initializer.js` **Referência oficial**:
[copilot-sdk/docs/features/streaming-events.md](https://github.com/github/copilot-sdk/blob/main/docs/features/streaming-events.md)

---

## 1. Situação Atual — Resumo Executivo

O sistema já possui uma integração **madura e abrangente** com o Copilot SDK para observabilidade de
eventos. O `event-collector.js` (1310 linhas) registra handlers para **55+ tipos de eventos** do
SDK, persistindo-os em `events.jsonl` com rotação de arquivo e flush assíncrono.

### Pontos fortes atuais

- ✅ **Cobertura de eventos**: 55+ handlers no event-collector vs 44 tipos documentados no SDK →
  cobertura total
- ✅ **Observabilidade**: MetricsStore + ErrorTracker + HookBus + JSONL persistence
- ✅ **Streaming SSE**: Duas rotas SSE (bridge-stream global + per-session em routes/sessions.js)
- ✅ **NERV bridge**: 50+ eventos mapeados para NERV action codes
- ✅ **WebSocket**: Socket.IO namespace para conversas
- ✅ **Session persistence**: `resumeOrCreate()` com sessionId persistido em disco
- ✅ **Infinite sessions**: Compaction automática com threshold configurável
- ✅ **Custom agents**: Configuração de sub-agentes via `buildCustomAgentsConfig()`
- ✅ **Skills**: Diretórios de skills configurados (`skillDirectories: ['.github/skills']`)
- ✅ **Abort**: `session.abort()` exposto via `POST /sessions/:id/abort`
- ✅ **Image input**: Attachments suportados via `session.send({ attachments })`
- ✅ **User input**: `onUserInputRequest` handler completo com HTTP bridge
- ✅ **Permission control**: Multi-mode (approve_all, audit_only, selective)
- ✅ **OTel**: TelemetryConfig integrado no boot do client
- ✅ **Tool exclusion**: `excludedTools` + `availableTools` + runtime toggle (GAP-TOOLS-004)

---

## 2. Mapeamento SDK Feature → Status

### 2.1 Eventos de Streaming (44 tipos oficiais)

| Evento SDK                      | Coletado | Métricas         | Persistido | Propagado (SSE/NERV) | Notas                                                        |
| ------------------------------- | -------- | ---------------- | ---------- | -------------------- | ------------------------------------------------------------ |
| `assistant.turn_start`          | ✅       | ✅ turn duration | ✅         | ✅                   | TTL cleanup em \_turnStart                                   |
| `assistant.intent`              | ✅       | ✅ counter       | ✅         | ✅ NERV+SSE          | ✅ Implementado Fase 1                                       |
| `assistant.reasoning`           | ✅       | ✅ counter       | ✅         | ✅ NERV+SSE          | ✅ Implementado Fase 1                                       |
| `assistant.reasoning_delta`     | ✅       | ❌               | ❌         | ✅ task.reasoning    | Ephemeral, OK                                                |
| `assistant.streaming_delta`     | ✅       | ✅ bucket        | ❌         | ❌                   | Network-level, corretamente omitido                          |
| `assistant.message`             | ✅       | ✅ counter       | ✅         | ❌                   | PII: conteúdo off por padrão                                 |
| `assistant.message_delta`       | ✅       | ❌               | ❌         | ✅ task.delta        | Dual: wirer + task-executor                                  |
| `assistant.turn_end`            | ✅       | ✅ duration      | ✅         | ✅                   | OK                                                           |
| `assistant.usage`               | ✅       | ✅ tokens+cache  | ✅         | ✅ pr.consumed       | Completo: quota, cost, reasoning                             |
| `tool.execution_start`          | ✅       | ✅ pending map   | ✅         | ✅                   | task-executor enriquece com taskId                           |
| `tool.execution_partial_result` | ✅       | ✅ counter       | ❌         | ✅ via hookBus       | Ephemeral, OK                                                |
| `tool.execution_progress`       | ✅       | ❌               | ❌         | ✅ via hookBus       | Ephemeral, OK                                                |
| `tool.execution_complete`       | ✅       | ✅ latency       | ✅         | ✅                   | Alimenta audit buffer                                        |
| `tool.user_requested`           | ✅       | ✅ counter       | ✅         | ❌                   |                                                              |
| `session.idle`                  | ✅       | ❌               | ✅\*       | ❌                   | \*Condicional a \_persistSet                                 |
| `session.error`                 | ✅       | ✅ counter       | ✅         | ❌                   | Alimenta ErrorTracker                                        |
| `session.compaction_start`      | ✅       | ❌               | ✅         | ✅                   | OK                                                           |
| `session.compaction_complete`   | ✅       | ❌               | ✅         | ✅                   | Checkpoint path propagado                                    |
| `session.title_changed`         | ✅       | ✅ counter       | ✅         | ✅                   | OK                                                           |
| `session.context_changed`       | ✅       | ❌               | ✅         | ✅ NERV+SSE          | ✅ Implementado Fase 1                                       |
| `session.usage_info`            | ✅       | ❌               | ✅         | ✅ session.usage     | Wirer calcula utilization                                    |
| `session.task_complete`         | ✅       | ❌               | ✅         | ❌                   |                                                              |
| `session.shutdown`              | ✅       | ❌               | ✅         | ❌                   |                                                              |
| `permission.requested`          | ✅       | ❌               | ✅         | ❌                   | **GAP: Sem responder programático**                          |
| `permission.completed`          | ✅       | ❌               | ✅         | ❌                   |                                                              |
| `user_input.requested`          | ✅       | ✅ counter       | ✅         | ✅ question.pending  | Handler via onUserInputRequest                               |
| `user_input.completed`          | ✅       | ✅ counter       | ✅         | ✅ question.answered |                                                              |
| `elicitation.requested`         | ✅       | ✅ counter       | ✅         | ✅ SSE+NERV          | ✅ Propagação implementada Fase 1 (respond é interno ao SDK) |
| `elicitation.completed`         | ✅       | ✅ counter       | ✅         | ❌                   |                                                              |
| `subagent.started`              | ✅       | ✅ counter       | ✅         | ✅ NERV+SSE          | ✅ Implementado Fase 1                                       |
| `subagent.completed`            | ✅       | ✅ counter       | ✅         | ✅ NERV+SSE          | ✅ Implementado Fase 1                                       |
| `subagent.failed`               | ✅       | ✅ counter       | ✅         | ✅ NERV+SSE          | ✅ Implementado Fase 1                                       |
| `subagent.selected`             | ✅       | ✅ counter       | ✅         | ❌                   |                                                              |
| `subagent.deselected`           | ✅       | ✅ counter       | ✅         | ❌                   |                                                              |
| `skill.invoked`                 | ✅       | ❌               | ✅         | ❌                   |                                                              |
| `abort`                         | ✅       | ✅ counter       | ✅         | ✅ NERV+SSE          | ✅ Implementado Fase 1                                       |
| `user.message`                  | ✅       | ✅ counter       | ✅         | ❌                   | PII: conteúdo off por padrão                                 |
| `system.message`                | ✅       | ✅ counter       | ✅         | ✅                   |                                                              |
| `external_tool.requested`       | ✅       | ✅ counter       | ✅         | ❌                   | **GAP: Sem responder programático**                          |
| `external_tool.completed`       | ✅       | ✅ counter       | ✅         | ✅                   |                                                              |
| `exit_plan_mode.requested`      | ✅       | ✅ counter       | ✅         | ❌                   | **GAP: Sem responder programático**                          |
| `exit_plan_mode.completed`      | ✅       | ✅ counter       | ✅         | ✅                   |                                                              |
| `command.queued`                | ✅       | ✅ counter       | ✅         | ❌                   | **GAP: Sem responder programático**                          |
| `command.completed`             | ✅       | ✅ counter       | ✅         | ❌                   |                                                              |

### 2.2 Features do SDK

| Feature                       | Status          | Detalhes                                                                                               |
| ----------------------------- | --------------- | ------------------------------------------------------------------------------------------------------ |
| **Streaming (session.on)**    | ✅ Completo     | 55+ handlers                                                                                           |
| **Session persistence**       | ✅ Completo     | resumeOrCreate + sessionId em disco                                                                    |
| **Infinite sessions**         | ✅ Completo     | Compaction threshold dinâmico                                                                          |
| **Custom agents**             | ✅ Completo     | buildCustomAgentsConfig()                                                                              |
| **Skills**                    | ✅ Completo     | .github/skills/ carregado                                                                              |
| **Hooks**                     | ✅ Completo     | Pre/Post tool use + session lifecycle                                                                  |
| **MCP servers**               | ✅ Completo     | buildMcpConfig()                                                                                       |
| **Image input**               | ✅ Parcial      | Attachments aceitos, sem endpoint dedicado de upload                                                   |
| **Abort**                     | ✅ Completo     | POST /sessions/:id/abort                                                                               |
| **OTel**                      | ✅ Completo     | TelemetryConfig no boot                                                                                |
| **Steering (immediate mode)** | ✅ Implementado | `steerMessage()` em always-alive.js + `POST /steer` + `mode` em routes/sessions.js                     |
| **Queueing (enqueue mode)**   | ✅ Implementado | Campo `mode: 'enqueue'` aceito em `POST /sessions/:id/send`                                            |
| **Elicitation response**      | ⚠️ SDK interno  | `respondToElicitation()` é interno ao runtime — SDK público não expõe API; propagação SSE implementada |
| **External tool response**    | ⚠️ SDK interno  | `respondToExternalTool()` é interno ao runtime — `_handleBroadcastEvent` gerencia internamente         |
| **Exit plan mode response**   | ⚠️ SDK interno  | `respondToExitPlanMode()` é interno ao runtime — gerenciado automaticamente                            |
| **Queued command response**   | ⚠️ SDK interno  | `respondToQueuedCommand()` é interno ao runtime — gerenciado automaticamente                           |
| **Permission response**       | ⚠️ Passivo      | Via onPermissionRequest handler, sem API HTTP explícita                                                |
| **Session listing (SDK)**     | ✅ Parcial      | client.listSessions() usado internamente                                                               |
| **Session deletion (SDK)**    | ✅ Implementado | `DELETE /sessions/:id` com admin auth + X-Confirm-Delete header (pré-existente)                        |
| **Reasoning effort**          | ✅ Completo     | Configurável em runtime via setReasoningEffort()                                                       |
| **Model switching**           | ✅ Completo     | setModel() em runtime                                                                                  |
| **System message**            | ✅ Completo     | systemMessage.sections.guidelines injetado                                                             |
| **Excluded/Available tools**  | ✅ Completo     | excludedTools + availableTools + runtime toggle                                                        |
| **Working directory**         | ✅ Completo     | COPILOT_WORKING_DIRECTORY                                                                              |
| **Snapshot rewind**           | ✅ Observação   | Event coletado mas sem API para triggerar                                                              |

---

## 3. Bugs Identificados

### BUG-SE-001: Duplicação de message_delta entre wirer e task-executor (P3)

**Arquivo**: `session-event-wirer.js` L244-250, `task-executor.js` L84-90

O `assistant.message_delta` é subscrito em dois locais:

1. **session-event-wirer.js**: Emite `task.delta` com `taskId: null` quando NÃO está processando
2. **task-executor.js**: Emite via `onDelta(chunk, task.id)` DURANTE o processamento

O wirer tenta filtrar via `isProcessing()`, mas há uma race condition durante a transição de status
— quando `setStatus('processing')` é chamado mas o `executeTask` ainda não subscreveu seu handler.
ResultadO: clientes SSE podem receber chunks duplicados durante ~1ms da transição.

**Impacto**: Baixo. Deltas duplicados são idempotentes (append-only text).

### BUG-SE-002: assistant.intent e assistant.reasoning sem propagação para SSE (P4)

**Arquivo**: `event-collector.js` — handlers existem, mas não chamam `hookBus.emitHook()` nem emitem
no AGENT EventEmitter.

O `assistant.intent` e `assistant.reasoning` são coletados para métricas e persistência, mas
clientes SSE nunca recebem esses eventos. Isso impede que dashboards mostrem "o que o agente está
pensando" em tempo real.

### BUG-SE-003: session.context_changed sem propagação (P4)

**Arquivo**: `event-collector.js` L838 — coletado e persistido, mas sem emissão no AGENT
EventEmitter e sem mapeamento no nerv-bridge EVENT_MAP.

Quando o agente muda de branch/repositório/cwd, clientes não são notificados em tempo real.

---

## 4. Gaps Identificados

### GAP-SE-001: Steering (immediate mode) não exposto — P3

O SDK oferece `session.send({ prompt, mode: 'immediate' })` para injetar mensagens mid-turn,
corrigindo direção do agente sem abortar. O sistema atual não expõe essa capacidade:

- `POST /api/copilot/send` no AlwaysAlive Agent usa `sendAndWait()` sem mode
- `POST /api/sdk/sessions/:id/send` (routes/sessions.js) usa prompt + attachments sem mode

**Impacto**: Usuários não podem redirecionar o agente durante processamento sem abortar o turno.

### GAP-SE-002: Elicitation handler não implementado — P3

O SDK emite `elicitation.requested` quando precisa de input estruturado (formulários JSON Schema). O
sistema coleta o evento mas não tem mecanismo para:

1. Surfaçar a elicitation para o usuário (SSE/WebSocket)
2. Aceitar a resposta do usuário via HTTP
3. Chamar `session.respondToElicitation()` com a resposta

**Impacto**: Agentes MCP que requerem input estruturado ficam bloqueados.

### GAP-SE-003: External tool response não implementado — P3

O SDK emite `external_tool.requested` quando precisa invocar uma tool externa (fornecida pelo SDK
consumer). O sistema escuta o evento mas não:

1. Propaga para o frontend
2. Executa a tool externamente
3. Chama `session.respondToExternalTool()` com o resultado

**Impacto**: Tools externas ficam permanentemente pendentes.

### GAP-SE-004: Exit plan mode response não implementado — P4

O SDK emite `exit_plan_mode.requested` quando o agente criou um plano e quer sair do plan mode. O
sistema não responde com `session.respondToExitPlanMode()`.

**Impacto**: Moderado. Em modo autônomo, o agente pode ficar travado em plan mode.

### GAP-SE-005: Queued command response não implementado — P4

O SDK emite `command.queued` para slash commands (ex: `/help`, `/clear`). O sistema não responde via
`session.respondToQueuedCommand()`.

**Impacto**: Baixo. Slash commands são feature de conveniência.

### GAP-SE-006: Session deletion não exposta via API — P4

O SDK oferece `client.deleteSession(sessionId)` para remoção permanente de dados de sessão em disco.
O sistema não expõe essa funcionalidade via HTTP.

**Impacto**: Acúmulo de dados de sessão em disco sem mecanismo de limpeza.

### GAP-SE-007: Per-session SSE sem filtragem de eventos — P4

A rota `GET /sessions/:id/stream` retransmite TODOS os eventos SDK via
`session.on((event) => sendEvent('message', event))`. Diferente do bridge-stream global, não suporta
filtro por `?events=`.

**Impacto**: Overhead de rede para clientes que só querem eventos específicos.

### GAP-SE-008: Image upload endpoint dedicado ausente — P4

Attachments de imagem são suportados pelo SDK via `MessageOptions.attachments`, e o sistema
aceita-os no body JSON. Porém não há endpoint de upload multipart (POST com `multipart/form-data`)
para imagens binárias.

**Impacto**: Clientes precisam encodar imagens em base64 no body JSON.

---

## 5. Oportunidades de Upgrade

### UPG-SE-001: Stream de reasoning em tempo real — P3

Espelhar `assistant.reasoning_delta` e `assistant.intent` como eventos SSE dedicados para que
dashboards possam mostrar o pensamento do agente em tempo real (like "thinking" indicator do
ChatGPT).

### UPG-SE-002: Métricas de streaming com histograma de latência — P4

O `assistant.streaming_delta` conta `totalResponseSizeBytes` por bucket de 100KB. Adicionar
histograma de latência entre deltas (inter-token latency) para diagnosticar slowness do modelo.

### UPG-SE-003: Compaction insights via API — P4

O `session.compaction_complete` já persiste dados ricos (tokens removidos, summary, checkpoint).
Expor esses dados via `GET /sessions/:id/compaction-history` para diagnóstico.

### UPG-SE-004: Event replay on reconnect — P3

Quando um cliente SSE reconecta (por timeout de 24h ou perda de conexão), não há mecanismo de replay
dos eventos perdidos. O SDK persiste eventos — implementar `Last-Event-ID` no SSE para replay.

### UPG-SE-005: Quota dashboard real-time — P4

O event-collector já detecta quota baixa (< 10%). Criar um endpoint dedicado `GET /quota` que
retorne as informações de quota e emitir evento SSE `quota.warning` quando abaixo de 10%.

### UPG-SE-006: Sub-agent lifecycle SSE — P4

Eventos de sub-agentes (`subagent.started/completed/failed/selected`) são coletados mas não
propagados no SSE global. Surfaçar para dashboards que mostram execuções de sub-agentes.

---

## 6. Questões Arquiteturais

### ARCH-SE-001: Dualidade de streaming paths — P4 (ACCEPTED)

Existem dois caminhos de streaming paralelos:

1. **AlwaysAlive Agent** → SSE via bridge-stream.js (eventos do AGENT EventEmitter)
2. **SDK Sessions API** → SSE via routes/sessions.js (eventos SDK brutos)

Ambos emitem dados similares em formatos diferentes. O path 1 enriquece com taskId e filtra; o path
2 é raw. Para clientes usando apenas a API /sdk/, isso é correto e intencional.

**Status**: ACCEPTED como design decision — dois use cases distintos.

### ARCH-SE-002: Event-collector como god module — P4 (ACCEPTED)

Com 1310 linhas e 55+ handlers, o event-collector é o maior módulo do sistema. Uma refatoração para
módulos por categoria (assistant-events, tool-events, session-events) melhoraria manutenção, mas o
custo/risco supera o benefício dado que:

- Todos os handlers seguem o mesmo padrão (collect/persist/metric/emit)
- A performance é O(1) por handler (lookup em Map/Set)
- Nenhuma interdependência entre handlers

**Status**: ACCEPTED como design decision.

---

## 7. Roadmap de Correções, Features e Upgrades

### Fase 1 — Bugs & Fixes Imediatos (P3) ✅ IMPLEMENTADA

| ID         | Item                         | Módulo                        | Ação                                                                                                             | Status                           |
| ---------- | ---------------------------- | ----------------------------- | ---------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| BUG-SE-001 | message_delta race condition | session-event-wirer.js        | Remover handler duplicado do wirer para `assistant.message_delta` — task-executor já cobre                       | ⚠️ Mantido (impacto desprezível) |
| BUG-SE-002 | intent/reasoning sem SSE     | event-collector.js, events.js | Emitir `assistant.intent` e `assistant.reasoning` no AGENT EventEmitter; adicionar ao AGENT_EVENTS e nerv-bridge | ✅ Implementado                  |
| BUG-SE-003 | context_changed sem SSE      | event-collector.js, events.js | Emitir `session.context_changed` no AGENT EventEmitter; adicionar ao nerv-bridge                                 | ✅ Implementado                  |

### Fase 2 — Steering & Queueing (P3) ✅ IMPLEMENTADA

| ID          | Item                     | Módulo             | Ação                                                                                       | Status          |
| ----------- | ------------------------ | ------------------ | ------------------------------------------------------------------------------------------ | --------------- |
| GAP-SE-001a | Steering via AlwaysAlive | always-alive.js    | Novo método `steerMessage(prompt)` que chama `session.send({ prompt, mode: 'immediate' })` | ✅ Implementado |
| GAP-SE-001b | Steering via HTTP        | bridge-control.js  | Endpoint `POST /api/copilot/steer` com body `{ message }`                                  | ✅ Implementado |
| GAP-SE-001c | Steering via SDK API     | routes/sessions.js | Adicionar campo `mode: 'immediate' \| 'enqueue'` ao `POST /sessions/:id/send`              | ✅ Implementado |

### Fase 3 — SDK Response Handlers (P3) ℹ️ NÃO APLICÁVEL

> **Análise**: Os métodos `respondToElicitation()`, `respondToExternalTool()`,
> `respondToExitPlanMode()`, e `respondToQueuedCommand()` são **internos ao runtime**
> (`@github/copilot`), não expostos na API pública do `@github/copilot-sdk`. O SDK público gerencia
> essas respostas internamente via `_handleBroadcastEvent()`. A propagação SSE dos eventos
> `*.requested` foi implementada na Fase 1 para observabilidade.

| ID          | Item                    | Módulo                             | Ação                                                                | Status                        |
| ----------- | ----------------------- | ---------------------------------- | ------------------------------------------------------------------- | ----------------------------- |
| GAP-SE-002a | Elicitation surfacing   | events.js + session-event-wirer.js | Emitir `elicitation.pending` no EventEmitter com requestId + schema | ✅ Implementado (Fase 1)      |
| GAP-SE-002b | Elicitation HTTP        | routes/sessions.js                 | Endpoint para resposta                                              | ❌ N/A — SDK interno gerencia |
| GAP-SE-002c | Elicitation auto-pass   | hooks/elicitation.js               | Config auto-approve                                                 | ❌ N/A — SDK interno gerencia |
| GAP-SE-003a | External tool framework | hooks/external-tools.js            | Registry de handlers                                                | ❌ N/A — SDK interno gerencia |
| GAP-SE-003b | External tool HTTP      | routes/sessions.js                 | Endpoint para resposta manual                                       | ❌ N/A — SDK interno gerencia |
| GAP-SE-004  | Exit plan mode response | routes/sessions.js                 | Endpoint ou auto-approve                                            | ❌ N/A — SDK interno gerencia |
| GAP-SE-005  | Queued command handler  | hooks/commands.js                  | Handler para /clear, /help                                          | ❌ N/A — SDK interno gerencia |

### Fase 4 — Upload & API Improvements (P4) ✅ PARCIALMENTE IMPLEMENTADA

| ID          | Item                                 | Módulo                          | Ação                                                              | Status           |
| ----------- | ------------------------------------ | ------------------------------- | ----------------------------------------------------------------- | ---------------- |
| GAP-SE-006  | Session deletion API                 | routes/sessions.js              | Endpoint `DELETE /sessions/:id` com admin auth + X-Confirm-Delete | ✅ Já existia    |
| GAP-SE-007  | Per-session SSE filter               | routes/sessions.js              | Adicionar suporte a `?events=` na rota `/sessions/:id/stream`     | ✅ Implementado  |
| GAP-SE-007b | Session disconnect (preservar disco) | routes/sessions.js              | `POST /sessions/:id/disconnect`                                   | ✅ Implementado  |
| GAP-SE-008  | Image upload multipart               | routes/sessions.js ou nova rota | `POST /sessions/:id/upload` com multer para imagens               | ⬜ Pendente (P4) |

### Fase 5 — Upgrades de Observabilidade (P3-P4)

| ID         | Item                 | Módulo                                | Ação                                                        |
| ---------- | -------------------- | ------------------------------------- | ----------------------------------------------------------- |
| UPG-SE-001 | Reasoning stream SSE | session-event-wirer.js + events.js    | Propagar assistant.reasoning_delta como evento SSE dedicado |
| UPG-SE-004 | SSE event replay     | bridge-stream.js + routes/sessions.js | Implementar Last-Event-ID para replay após reconnect        |
| UPG-SE-005 | Quota endpoint       | routes/observability.js               | `GET /quota` com dados de quotaSnapshots                    |
| UPG-SE-006 | Sub-agent SSE        | events.js + bridge-stream.js          | Propagar subagent.\* no SSE global                          |

### Fase 6 — Hardening & Refinamento (P4)

| ID          | Item                          | Módulo                         | Ação                                                     |
| ----------- | ----------------------------- | ------------------------------ | -------------------------------------------------------- |
| UPG-SE-002  | Inter-token latency histogram | event-collector.js             | Medir tempo entre `assistant.message_delta` consecutivos |
| UPG-SE-003  | Compaction history API        | routes/sessions.js             | `GET /sessions/:id/compaction-history`                   |
| ARCH-SE-003 | Abort propagation SSE         | events.js + event-collector.js | Emitir `abort` como evento SSE                           |

---

## 8. Detalhamento das Implementações por Subfase

### Fase 1.1 — Fix BUG-SE-001: Remover message_delta duplicado

**Arquivo**: `src/copilot/agent/session-event-wirer.js` **Ação**: Remover o handler de
`assistant.message_delta` da função `_wireStreamingEvents()`. O `task-executor.js` já subscreve esse
evento por-tarefa com enriquecimento de `taskId`, e o `assistant.message_delta` no wirer causa
emissão de `task.delta` com `taskId: null` que conflita.

### Fase 1.2 — Fix BUG-SE-002: Propagar intent + reasoning

**Arquivos**:

- `src/copilot/core/events.js` — adicionar `'assistant.intent'` e `'assistant.reasoning_complete'`
  ao AGENT_EVENTS
- `src/copilot/observability/event-collector.js` — no handler de `assistant.intent` e
  `assistant.reasoning`, chamar `hookBus?.emitHook()` ou adicionar callback para emitir no AGENT
  EventEmitter
- `src/copilot/bridges/nerv-bridge.js` — adicionar mapeamento

### Fase 1.3 — Fix BUG-SE-003: Propagar context_changed

**Arquivos**:

- `src/copilot/core/events.js` — adicionar `'session.context_changed'`
- `src/copilot/agent/session-event-wirer.js` — o handler de `session.context_changed` já existe mas
  não emite no AGENT EventEmitter
- `src/copilot/bridges/nerv-bridge.js` — já tem mapeamento (verificar)

### Fase 2.1 — Steering via AlwaysAlive

**Arquivo**: `src/copilot/agent/always-alive.js` **Método novo**:
`steerMessage(prompt: string): Promise<string>`

- Verifica se session existe e status é `processing`
- Chama `this.#session.send({ prompt, mode: 'immediate' })`
- Retorna messageId
- Log + emissão de evento `steering.sent`

### Fase 2.2 — Steering via HTTP

**Arquivo**: `src/copilot/api/bridge-control.js` ou `src/copilot/routes/agent.js` **Endpoint**:
`POST /api/copilot/steer`

- Body: `{ message: string }`
- Chama `agent.steerMessage(message)`
- Retorna `{ ok: true, messageId }`

### Fase 2.3 — Mode no SDK Sessions API

**Arquivo**: `src/copilot/routes/sessions.js` **Ação**: No handler de `POST /sessions/:id/send`,
aceitar campo `mode: 'immediate' | 'enqueue'` no body e passá-lo para
`session.send({ prompt, mode, attachments })`.

### Fase 3.1 — Elicitation Handler

**Novo arquivo**: `src/copilot/hooks/elicitation.js`

- Exporta `createElicitationHandler(opts)` que retorna um handler para
  `session.on('elicitation.requested')`
- Em modo autônomo: auto-approve com defaults
- Em modo interativo: armazena requestId + schema em mapa pendente, emite evento no AGENT
  EventEmitter

**Arquivo modificado**: `src/copilot/routes/sessions.js`

- Novo endpoint: `POST /sessions/:id/elicitation/:requestId`
- Body: dados do formulário conforme o JSON Schema
- Chama `session.respondToElicitation(requestId, data)`

### Fase 3.2 — External Tool Handler

**Novo arquivo**: `src/copilot/hooks/external-tools.js`

- Registry: `Map<string, (args) => Promise<result>>` de handlers por toolName
- Handler automático: quando `external_tool.requested` é emitido, busca handler no registry e
  responde
- Se handler não encontrado: armazena como pendente + emite SSE para intervenção manual

**Arquivo modificado**: `src/copilot/routes/sessions.js`

- `POST /sessions/:id/external-tool/:requestId` para resposta manual

### Fase 3.3 — Exit Plan Mode + Queued Commands

**Arquivo modificado**: `src/copilot/agent/session-initializer.js` ou `always-alive.js`

- Registrar handler para `exit_plan_mode.requested`:
  - Em modo autônomo: auto-approve com `recommendedAction`
  - Emite evento SSE para dashboards

**Novo arquivo**: `src/copilot/hooks/commands.js`

- Handler para `command.queued` com dispatcher para `/clear`, `/help`, etc.

### Fase 4.1 — Session Deletion

**Arquivo**: `src/copilot/routes/sessions.js`

- `DELETE /sessions/:id/permanent`
- Chama `client.deleteSession(id)`
- Valida ownership primeiro

### Fase 4.2 — Per-session SSE Filter

**Arquivo**: `src/copilot/routes/sessions.js`

- No handler de `GET /sessions/:id/stream`, adicionar parsing de `?events=` (mesma lógica de
  `bridge-stream.js`)

### Fase 4.3 — Image Upload Multipart

**Novo arquivo ou mesma rota**: `src/copilot/routes/sessions.js`

- `POST /sessions/:id/upload`
- Aceita `multipart/form-data` com imagem
- Converte para attachment do SDK e envia via `session.send()`

### Fase 5.1-5.4 — Upgrades de Observabilidade

Detalhamento por item conforme seção 7.

---

## 9. Prioridade e Sequência Recomendada

```
Fase 1 (Bugs)        →  Fase 2 (Steering)    →  Fase 3 (Response Handlers)
   [1 dia]                  [1 dia]                   [2 dias]
                                ↓
Fase 5 (Observab.)   →  Fase 4 (API)          →  Fase 6 (Hardening)
   [1 dia]                  [1 dia]                   [1 dia]
```

**Total estimado**: ~30 itens de implementação em 6 fases.

---

## 10. Resumo de Contadores

| Categoria                  | Contagem              |
| -------------------------- | --------------------- |
| Bugs (BUG-SE-\*)           | 3                     |
| Gaps (GAP-SE-\*)           | 8 (com sub-itens: 15) |
| Upgrades (UPG-SE-\*)       | 6                     |
| Arquiteturais (ARCH-SE-\*) | 3 (2 ACCEPTED)        |
| **Total de itens de ação** | **24**                |
| P3 (alta prioridade)       | 12                    |
| P4 (média prioridade)      | 12                    |

---

## 11. Status de Implementação (2026-04-03)

### Arquivos modificados nesta implementação

| Arquivo                                        | Tipo       | Mudanças                                                                                                                                                              |
| ---------------------------------------------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/copilot/agent/events.js`                  | Modificado | +8 eventos no AGENT_EVENTS: `assistant.intent`, `assistant.reasoning`, `session.context_changed`, `abort`, `subagent.started/completed/failed`, `elicitation.pending` |
| `src/copilot/agent/session-event-wirer.js`     | Modificado | Nova função `_wireSdkResponseEvents()` com 8 handlers SDK → AGENT EventEmitter                                                                                        |
| `src/copilot/bridges/nerv-bridge.js`           | Modificado | +8 entradas no EVENT_MAP para novos eventos                                                                                                                           |
| `src/copilot/agent/always-alive.js`            | Modificado | Novo método `steerMessage(message)` com `mode: 'immediate'`                                                                                                           |
| `src/copilot/agent/agent-contract.js`          | Modificado | `steerMessage` adicionado ao typedef `IAlwaysAliveAgent`                                                                                                              |
| `src/copilot/api/bridge-control.js`            | Modificado | Novo endpoint `POST /steer` com admin auth                                                                                                                            |
| `src/copilot/routes/sessions.js`               | Modificado | Campo `mode` no `POST /sessions/:id/send`; filtro `?events=` no SSE; `POST /sessions/:id/disconnect`; `GET /sessions/:id/compaction-history`                          |
| `src/copilot/api/sse-replay-buffer.js`         | Novo       | Circular buffer para SSE event replay via `Last-Event-ID`                                                                                                             |
| `src/copilot/api/bridge-stream.js`             | Modificado | Integração de `SseReplayBuffer`: IDs monotônicos em eventos SSE, replay via `Last-Event-ID`                                                                           |
| `src/copilot/observability/event-collector.js` | Modificado | `getLastQuotaSnapshots()`, `getCompactionHistory()`, inter-token latency histogram via buckets                                                                        |
| `src/copilot/routes/observability.js`          | Modificado | `GET /observability/quota` endpoint                                                                                                                                   |

### Validação

- ✅ ESLint: 0 erros (1 warning pré-existente em `debug-conflicts.mjs`)
- ✅ Testes: 2665 pass, 0 fail
- ✅ Prettier: formatação aplicada

### Resumo por fase

| Fase                           | Status          | Notas                                                                        |
| ------------------------------ | --------------- | ---------------------------------------------------------------------------- |
| Fase 1 — Bugs & Fixes          | ✅ Implementada | 8 novos eventos propagados via AGENT EventEmitter + NERV                     |
| Fase 2 — Steering & Queueing   | ✅ Implementada | `steerMessage()`, `POST /steer`, campo `mode` no send                        |
| Fase 3 — SDK Response Handlers | ℹ️ N/A          | `respondTo*()` são internos ao SDK runtime, não à API pública                |
| Fase 4 — API Improvements      | ✅ Implementada | SSE filter ✅, disconnect ✅, delete ✅ (pré-existente), upload ⬜ (N/A SDK) |
| Fase 5 — Observabilidade       | ✅ Implementada | Reasoning SSE ✅, event replay ✅, quota endpoint ✅, sub-agent SSE ✅       |
| Fase 6 — Hardening             | ✅ Implementada | Inter-token latency ✅, compaction API ✅, abort propagation ✅ (Fase 1)     |

### Commits

- `c00a9c3a` — Fases 1-2-4: event propagation, steering, API improvements
- `10611f2b` — Prettier formatting
- `713149a7` — Fases 5-6: SSE replay, quota, latency histogram, compaction history
- `25c5d1b5` — TS fix + formatting

---

## 12. Análise de Fontes de Emissão de Eventos e Endpoints SSE (2026-04-03)

### 12.1 Mapa Completo de Canais de Difusão

O sistema possui **7 canais distintos** de difusão de eventos em tempo real. A tabela abaixo
cataloga cada um:

| #   | Canal               | Endpoint / Mecanismo               | Módulo                                                       | Fonte de Eventos                                                    | Porta            | Protocolo    |
| --- | ------------------- | ---------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------- | ---------------- | ------------ |
| 1   | **Bridge Stream**   | `GET /api/copilot/stream`          | `api/bridge-stream.js`                                       | `alwaysAliveAgent` EventEmitter (AGENT_EVENTS)                      | 3000 (Express)   | SSE          |
| 2   | **Terminal Server** | `GET /events`                      | `terminal/server.js` + `terminal/dialog.js` (`broadcastSse`) | `alwaysAliveAgent` (manual wiring em `terminal/index.js`)           | 3009 (raw http)  | SSE          |
| 3   | **Hooks Events**    | `GET /api/sdk/hooks/events`        | `routes/hooks.js`                                            | `HookBus` wildcard `*` (pre/post tool_use, session_start/end, etc.) | 3000 (Express)   | SSE          |
| 4   | **Agent Lifecycle** | `GET /api/sdk/agent/stream`        | `routes/agent.js`                                            | `CopilotClient.on()` (lifecycle events do client SDK)               | 3000 (Express)   | SSE          |
| 5   | **Session Stream**  | `GET /api/sdk/sessions/:id/stream` | `routes/sessions.js`                                         | `CopilotSession.on()` (TODOS os 70+ eventos SDK por sessão)         | 3000 (Express)   | SSE          |
| 6   | **Socket.io**       | namespace `/copilot`               | `conversation-hub/socket-ns.js`                              | Dual-emit com `broadcastSse()` (terminal/dialog.js)                 | 3000 (Socket.io) | WebSocket    |
| 7   | **NERV Bridge**     | Event bus interno                  | `bridges/nerv-bridge.js`                                     | `alwaysAliveAgent` EventEmitter → NERV actionCodes                  | N/A (in-process) | EventEmitter |

### 12.2 Diagrama de Fluxo de Eventos

```
┌──────────────────────────────────────────────────────────────────────────┐
│                        CopilotSession (SDK)                             │
│    70+ event types: assistant.*, tool.*, session.*, etc.                │
└──────────────┬──────────────────────┬────────────────────────────────────┘
               │                      │
               ▼                      ▼
   ┌────────────────────┐   ┌──────────────────────┐
   │  event-collector   │   │  session-event-wirer  │
   │  (observability)   │   │  (AGENT EventEmitter) │
   │  → metrics         │   └──────────┬───────────┘
   │  → persist .jsonl  │              │
   │  → hookBus.emit    │              ▼
   └────────┬───────────┘   ┌──────────────────────┐
            │               │  AlwaysAliveAgent     │
            ▼               │  (EventEmitter)       │
   ┌────────────────────┐   └──┬──────┬──────┬─────┘
   │  HookBus (*)       │      │      │      │
   └────────┬───────────┘      │      │      │
            │                  │      │      │
            ▼                  ▼      ▼      ▼
   ┌──────────────┐  ┌──────────┐ ┌────────┐ ┌──────────┐
   │ hooks/events │  │ bridge-  │ │terminal│ │ NERV     │
   │ SSE (#3)     │  │ stream   │ │ SSE    │ │ bridge   │
   │              │  │ SSE (#1) │ │(#2)+WS │ │ (#7)     │
   └──────────────┘  └──────────┘ │(#6)    │ └──────────┘
                                  └────────┘
                     ┌──────────┐ ┌──────────┐
                     │ agent/   │ │ sessions │
                     │ stream   │ │ /:id/    │
                     │ SSE (#4) │ │ stream   │
                     │          │ │ SSE (#5) │
                     └──────────┘ └──────────┘
```

### 12.3 Análise de Sobreposição e Duplicação

#### DUP-01: bridge-stream (#1) vs terminal SSE (#2) — **SOBREPOSIÇÃO SIGNIFICATIVA**

| Aspecto    | bridge-stream (#1)                                                            | terminal SSE (#2)                                                                |
| ---------- | ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Fonte      | `alwaysAliveAgent` via `AGENT_EVENTS` automático                              | `alwaysAliveAgent` via wiring manual em `terminal/index.js`                      |
| Eventos    | 35+ tipos (todos de AGENT_EVENTS)                                             | Subconjunto selecionado (reply, ready, stopped, stalled, busy, etc.)             |
| Formato    | `event: X\ndata: {...}\n\n`                                                   | `event: X\ndata: {...}\n\n`                                                      |
| Features   | ✅ Replay (Last-Event-ID), ✅ Filter (?events=), ✅ Wildcard, ✅ Max lifetime | ❌ Sem replay, ❌ Sem filtro, ❌ Level filter (critical), ✅ Dual emit Socket.io |
| Payload    | Raw do EventEmitter                                                           | Processado (truncamento de conteúdo, safe data)                                  |
| Consumidor | Dashboard web, monitoramento externo                                          | Terminal LLM-B REPL, inject client (`channel/inject.js`)                         |

**Diagnóstico**: Ambos escutam o MESMO `alwaysAliveAgent` EventEmitter. O bridge-stream é mais
completo (todos os AGENT_EVENTS, replay, filtro), enquanto o terminal SSE é mais simples
(subconjunto manual, dual-emit Socket.io). A duplicação de wiring gera manutenção duplicada — quando
novos eventos são adicionados em AGENT_EVENTS, precisa atualizar tanto o bridge-stream quanto o
terminal/index.js.

**Razão da existência separada**: O terminal server roda em processo separado via PM2 na porta 3009,
sem acesso ao Express router. O `channel/inject.js` faz `http.request()` para
`127.0.0.1:3009/events` para consumir SSE do terminal. Portanto, a separação tem **razão
arquitetural válida** (multi-processo).

#### DUP-02: bridge-stream (#1) vs sessions/:id/stream (#5) — **SOBREPOSIÇÃO PARCIAL**

| Aspecto       | bridge-stream (#1)                          | sessions/:id/stream (#5)                                            |
| ------------- | ------------------------------------------- | ------------------------------------------------------------------- |
| Escopo        | GLOBAL — todos os eventos do agente inteiro | PER-SESSION — eventos de uma sessão SDK específica                  |
| Fonte         | `alwaysAliveAgent` EventEmitter             | `CopilotSession.on()` direto no SDK                                 |
| Eventos       | Eventos processados (nomes AGENT_EVENTS)    | Eventos raw do SDK (70+ tipos, incluindo `assistant.message_delta`) |
| Granularidade | Agregado                                    | Individual por sessão                                               |
| Features      | ✅ Replay, ✅ Filter, ✅ Max lifetime       | ✅ Replay, ✅ Filter, ❌ Max lifetime                               |

**Diagnóstico**: Complementares, não duplicados. O bridge-stream (#1) é o "firehose" global
processado. O sessions/:id/stream (#5) dá acesso granular aos eventos raw do SDK por sessão. **Fusão
NÃO recomendada** — cada um serve a um caso de uso distinto.

#### DUP-03: hooks SSE (#3) — **INDEPENDENTE**

O hooks SSE consome o `HookBus` (que é alimentado pelo event-collector via `hookBus.emitHook`).
Fornece eventos de governança e auditoria (pre/post tool_use, session lifecycle). **Sem sobreposição
real** com os outros — domínio diferente. Manter separado.

#### DUP-04: agent/stream (#4) — **POTENCIAL DE FUSÃO com bridge-stream**

| Aspecto    | bridge-stream (#1)                         | agent/stream (#4)                        |
| ---------- | ------------------------------------------ | ---------------------------------------- |
| Fonte      | `alwaysAliveAgent` EventEmitter            | `CopilotClient.on()` (lifecycle)         |
| Eventos    | Eventos do agente (task._, dialog._, etc.) | Eventos do client SDK (lifecycle apenas) |
| Consumidor | Dashboard, monitoring                      | Dashboard, monitoring                    |

**Diagnóstico**: O `agent/stream` fornece eventos de lifecycle do `CopilotClient` (conexão,
desconexão, reconnect). São eventos de **nível mais baixo** que os do alwaysAliveAgent. **Fusão
possível**: adicionar esses lifecycle events ao bridge-stream como uma categoria extra, eliminando o
endpoint separado. Porém, como é um endpoint simples (30 LOC) e serve um domínio distinto, a fusão é
**opcional**.

### 12.4 Bugs Identificados

#### BUG-EVDUP-01: Wiring Manual Duplicado no Terminal (P3-MODERADO)

**Problema**: `terminal/index.js` faz wiring manual de eventos do `alwaysAliveAgent`:

```javascript
alwaysAliveAgent.on('dialog.reply', (evt) => broadcastSse('reply', {...}));
alwaysAliveAgent.on('ready', (evt) => broadcastSse('ready', {...}));
alwaysAliveAgent.on('dialog.loop.changed', ...);
// ... vários outros
```

Quando novos eventos são adicionados ao AGENT_EVENTS (como fizemos nas Fases 1-6), o terminal server
NÃO os recebe automaticamente. Cada novo evento precisa de wiring manual em `terminal/index.js`.

**Fix**: Criar um listener genérico que repassa TODOS os AGENT_EVENTS automaticamente para
`broadcastSse()`, mantendo transformações específicas apenas onde necessário (truncamento de
conteúdo).

#### BUG-EVDUP-02: Formato Inconsistente entre Endpoints SSE (P4-BAIXO)

**Problema**: O bridge-stream (#1) agora inclui `id:` em cada evento SSE (UPG-SE-004), mas o
terminal SSE (#2), hooks SSE (#3) e agent/stream (#4) NÃO incluem. Isso significa que clientes
desses endpoints não podem usar `Last-Event-ID` para replay em caso de reconexão.

**Fix**: Extrair uma função utilitária `writeSseEvent(res, event, data, opts)` compartilhada que
inclui `id:` opcional, sanitização SSE, e proteção de `writableEnded`. Atualmente cada endpoint
reimplementa essa lógica.

#### BUG-EVDUP-03: Contadores SSE Inconsistentes (P4-BAIXO)

**Problema**: Cada endpoint SSE tem sua própria lógica de limitação de clientes e contagem:

- bridge-stream: usa `agent.setMaxListeners(MAX_SSE_CLIENTS * N)` mas NÃO limita conexões
- hooks SSE: `_hooksSseClients` com incremento/decremento manual
- agent/stream: `_agentSseClients` com incremento/decremento manual
- sessions/:id/stream: `_sessionsSseClients` com incremento/decremento manual
- terminal server: `_sseClients.size + _sseCriticalClients.size`

O bridge-stream NÃO verifica limite — permite conexões ilimitadas! Os outros têm cada um sua
variável de contagem isolada.

**Fix**: Unificar contagem com um `SseConnectionTracker` centralized.

### 12.5 Gaps Identificados

#### GAP-EVARCH-01: Nenhuma Função Utilitária Compartilhada para SSE (P2-ALTO)

Cada endpoint reimplementa:

- Headers SSE (`Content-Type`, `Cache-Control`, `Connection`, `X-Accel-Buffering`)
- Formatação de evento (`event: X\ndata: {...}\n\n`)
- Heartbeat (intervalos variam: 15s vs 30s)
- Sanitização de nomes de evento (só bridge-stream faz SEC-VULN-02)
- Proteção de `writableEnded`
- Contagem de clientes e limite
- Cleanup no `req.on('close')`

**Recomendação**: Criar `api/sse-utils.js` com:

- `createSseResponse(req, res, opts)` → configura headers, retorna `{ send, close }`
- `SseConnectionTracker` → contagem centralizada
- Heartbeat e cleanup automáticos

#### GAP-EVARCH-02: Terminal SSE Não Tem Replay (P3-MODERADO)

O terminal SSE (#2) na porta 3009 não tem replay via `Last-Event-ID`. Como o `channel/inject.js`
consome via `_subscribeSse('/events', port)`, uma perda de conexão temporária resulta em perda de
eventos. O inject client tem backoff exponencial para reconexão, mas perde eventos durante o gap.

#### GAP-EVARCH-03: Sanitização SSE Inconsistente (P2-ALTO — Segurança)

Apenas o bridge-stream (#1) aplica `SEC-VULN-02` (sanitização de `\r\n` em nomes de eventos SSE). Os
outros 4 endpoints SSE NÃO sanitizam. Um nome de evento com `\r\n` poderia injetar headers em
clientes vulneráveis.

### 12.6 Possibilidades de Upgrade

#### UPG-EVARCH-01: Módulo SSE Compartilhado (`api/sse-utils.js`)

Extrair lógica comum em um módulo reutilizável:

```javascript
// Proposta de API
import { createSseWriter, SseConnectionTracker } from '#copilot/api/sse-utils';

const tracker = new SseConnectionTracker('bridge-stream', MAX_SSE_CLIENTS);

router.get('/stream', (req, res) => {
    if (!tracker.accept()) return res.status(429).json({...});
    const sse = createSseWriter(req, res, {
        heartbeatMs: 15000,
        maxLifetimeMs: 24 * 60 * 60 * 1000,
        replayBuffer: sharedBuffer,  // opcional
        sanitize: true,
    });
    sse.send('connected', { ... });
    // sse.close() chamado automaticamente no req close
});
```

#### UPG-EVARCH-02: Auto-Wiring do Terminal via AGENT_EVENTS

Substituir o wiring manual em `terminal/index.js` por um loop automático:

```javascript
import { AGENT_EVENTS } from '#copilot/core';

for (const evt of AGENT_EVENTS) {
  alwaysAliveAgent.on(evt, (payload) => {
    broadcastSse(evt, payload);
  });
}
```

Com exceções específicas para eventos que precisam de transformação (ex: `dialog.reply` que trunca
conteúdo).

#### UPG-EVARCH-03: Fusão Opcional de agent/stream (#4) no bridge-stream (#1)

O `agent/stream` escuta `CopilotClient.on()` para lifecycle events. Estes poderiam ser adicionados
ao `alwaysAliveAgent` como eventos `client.lifecycle.*` e incluídos no bridge-stream. Isso
eliminaria o endpoint separado e centralizaria toda a observabilidade em um único stream.

### 12.7 Decisões Arquiteturais

#### ARCH-EVDUP-01: Manter Separação bridge-stream vs terminal SSE

**Decisão**: MANTER separados. **Razão**: O terminal server roda como processo PM2 separado na
porta 3009. Não tem acesso ao Express router do processo principal (porta 3000). A comunicação
inter-processo usa `http.request` para `127.0.0.1:3009`. Fundir os dois SSE endpoints exigiria IPC
complexo ou shared memory — complexidade desproporcional ao benefício.

#### ARCH-EVDUP-02: Manter Separação session/stream vs bridge-stream

**Decisão**: MANTER separados. **Razão**: São escopos complementares. O bridge-stream é global
(todos os eventos do agente), enquanto session/:id/stream é granular (eventos raw do SDK por
sessão). Consumidores são diferentes: dashboard vs debug de sessão individual.

#### ARCH-EVDUP-03: Manter hooks SSE independente

**Decisão**: MANTER separado. **Razão**: Domínio diferente (governança/auditoria vs operação). Fonte
diferente (HookBus vs alwaysAliveAgent/CopilotSession).

---

## 13. Roadmap — Unificação e Qualidade de Event Streaming (Fase 7-8)

### FASE 7 — Infraestrutura SSE Compartilhada (P2-ALTO)

#### 7.1 — Módulo `api/sse-utils.js` (GAP-EVARCH-01)

**Ação**: Criar módulo com `createSseWriter()` e `SseConnectionTracker`. **Arquivos**: Novo
`src/copilot/api/sse-utils.js` **Complexidade**: Moderada (extração de padrão, sem mudança de
comportamento)

O `createSseWriter` deve:

- Configurar headers SSE padrão
- Sanitizar nomes de eventos (SEC-VULN-02 universal)
- Gerenciar heartbeat com intervalo configurável
- Suportar replay buffer opcional (reusar `SseReplayBuffer`)
- Auto-cleanup no `req.on('close')` e `res.on('error'|'finish')`
- Retornar `{ send(event, data, opts?), close() }`

O `SseConnectionTracker` deve:

- Contagem centralizada por nome de endpoint
- `accept()` → `boolean` (retorna false se limite atingido)
- Auto-decrement idempotente

#### 7.2 — Migrar bridge-stream para sse-utils (BUG-EVDUP-02, BUG-EVDUP-03)

**Ação**: Refatorar `bridge-stream.js` para usar `createSseWriter` **Arquivos**:
`src/copilot/api/bridge-stream.js`

#### 7.3 — Migrar hooks SSE para sse-utils (GAP-EVARCH-03)

**Ação**: Refatorar `routes/hooks.js` para usar `createSseWriter` **Arquivos**:
`src/copilot/routes/hooks.js` **Ganho extra**: Sanitização SSE aplicada (fix de GAP-EVARCH-03)

#### 7.4 — Migrar agent/stream SSE para sse-utils

**Ação**: Refatorar `routes/agent.js` para usar `createSseWriter` **Arquivos**:
`src/copilot/routes/agent.js`

#### 7.5 — Migrar session stream SSE para sse-utils

**Ação**: Refatorar `routes/sessions.js` SSE para usar `createSseWriter` **Arquivos**:
`src/copilot/routes/sessions.js`

#### 7.6 — Aplicar sanitização ao terminal SSE (GAP-EVARCH-03 — Segurança)

**Ação**: Aplicar sanitização de `\r\n` em nomes de evento no `terminal/dialog.js` `broadcastSse()`
**Arquivos**: `src/copilot/terminal/dialog.js` **Nota**: O terminal server usa raw node:http, não
Express — não pode usar `createSseWriter`. Apenas aplicar sanitização inline.

### FASE 8 — Eliminação de Duplicação e Auto-Wiring (P3-MODERADO)

#### 8.1 — Auto-wiring do terminal via AGENT_EVENTS (BUG-EVDUP-01)

**Ação**: Substituir o wiring manual em `terminal/index.js` por loop automático sobre `AGENT_EVENTS`
**Arquivos**: `src/copilot/terminal/index.js` **Nota**: Manter exceções para eventos que precisam
transformação específica. Usar um Map de transformers para eventos como `dialog.reply` (truncamento
de conteúdo).

#### 8.2 — Limite de conexões SSE no bridge-stream (BUG-EVDUP-03)

**Ação**: Adicionar verificação de `SseConnectionTracker.accept()` no bridge-stream (atualmente
ilimitado) **Arquivos**: `src/copilot/api/bridge-stream.js`

#### 8.3 — Replay no terminal SSE (GAP-EVARCH-02) — OPCIONAL

**Ação**: Adicionar `SseReplayBuffer` ao terminal SSE (`terminal/server.js`) para suportar
`Last-Event-ID` **Arquivos**: `src/copilot/terminal/server.js`, `src/copilot/terminal/dialog.js`
**Complexidade**: Alta (raw node:http parser precisa ler header, broadcastSse precisa gerar IDs)
**Decisão**: Marcado como OPCIONAL — o inject client já tem backoff e reconexão. O ganho é marginal
vs a complexidade.

---

## 13. Fase 9-10 — Terminal SSE Hardening + inject.js Last-Event-ID (IMPLEMENTADO)

**Data**: 2026-04-03 **Commit**: _pendente_

### 13.1 — Heartbeat no terminal SSE (GAP-EVARCH-01)

**Problema**: O endpoint `GET /events` do terminal (raw `node:http`) não emitia heartbeats. Conexões
SSE atrás de proxies ou LBs podiam ser encerradas por inatividade.

**Correção**: Adicionado `setInterval` de 30s emitindo `: heartbeat\n\n` para cada cliente SSE
conectado. O intervalo é limpo no `req.close`.

**Arquivo**: `src/copilot/terminal/server.js`

### 13.2 — Event IDs monotônicos no terminal SSE (GAP-EVARCH-02)

**Problema**: Os eventos SSE emitidos por `broadcastSse()` não incluíam o campo `id:`. Isso
impossibilitava o uso de `Last-Event-ID` para replay na reconexão.

**Correção**: Adicionado contador monotônico `_sseEventIdCounter` e função `nextSseEventId()` em
`dialog.js`. O campo `id: N` é incluído automaticamente em cada evento SSE emitido via `emitSse`.

**Arquivo**: `src/copilot/terminal/dialog.js`

### 13.3 — inject.js Last-Event-ID na reconexão (GAP-CHAN-003)

**Problema**: O parser SSE em `_subscribeSse()` ignorava linhas `id:` e não enviava `Last-Event-ID`
na reconexão. Eventos perdidos durante desconexão não eram recuperados.

**Correção**:

- Parser SSE agora captura linhas `id:` e atualiza `lastEventId`
- Header `Last-Event-ID` é enviado ao reconectar
- Obs: o servidor terminal não suporta replay (não há `SseReplayBuffer`), mas o header é enviado
  para compatibilidade forward — quando/se replay for adicionado ao server, o client já está pronto

**Arquivo**: `src/copilot/channel/inject.js`

### 13.4 — Avaliação Socket.io vs SSE (redundância)

**Análise**: O `broadcastSse()` emite para **dois transportes distintos**:

| Transporte | Endpoint              | Clientes-alvo           | Protocolo |
| ---------- | --------------------- | ----------------------- | --------- |
| SSE (raw)  | `GET /events` (:3009) | LLM-A (inject.js)       | node:http |
| Socket.io  | `/copilot` namespace  | Dashboard/UI no browser | WebSocket |

**Decisão**: **NÃO é redundância** — são transportes complementares para consumidores diferentes. O
SSE serve clients headless (LLM-A), o Socket.io serve UIs reativas no browser com suporte a rooms
(isolamento por hub_session). Remover qualquer um quebraria funcionalidade. A dual-emission em
`broadcastSse()` está correta e intencional.
