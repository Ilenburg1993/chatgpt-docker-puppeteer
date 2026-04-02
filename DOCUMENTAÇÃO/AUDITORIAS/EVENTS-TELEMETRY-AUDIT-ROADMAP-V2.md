# Auditoria e Roadmap: Events & Telemetria SDK Copilot — v2

**Data**: 2026-05-28 **Escopo**: Sistema completo de captura de eventos SDK, telemetria e
observabilidade em `src/copilot/` **Autores**: Investigação profunda + análise de schema
`@github/copilot-sdk@latest`

---

## 1. Contexto e Objetivo

O Copilot SDK emite **70 tipos de eventos** via `session.on()`. O `event-collector.js` é o bridge
central entre esses eventos e o stack de observabilidade (MetricsStore, HookBus, globalAuditBuffer,
events.jsonl).

Esta auditoria:

1. Mapeia **todos** os 70 tipos de eventos com seus schemas exatos do SDK
2. Compara com os **34 handlers ativos** pós-Fase AM
3. Identifica gaps, oportunidades e melhorias de tipagem
4. Produz um roadmap executável com fases e subfases

---

## 2. Inventário Completo dos 70 Tipos de Eventos SDK

### 2.1 Matriz de Cobertura (34 cobertos / 36 ausentes)

| Evento                              | Status               | Dados Chave                                                                                                                                                    | Valor de Observabilidade                       |
| ----------------------------------- | -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| `session.start`                     | ❌ Ausente           | sessionId, version, producer, copilotVersion, startTime, selectedModel, reasoningEffort, context{cwd,gitRoot,repository,hostType,branch,headCommit,baseCommit} | 🔴 Alto — bootstrap da sessão com contexto git |
| `session.resume`                    | ❌ Ausente           | resumeTime, eventCount, selectedModel, reasoningEffort, context{...}, alreadyInUse                                                                             | 🔴 Alto — retomada com estado completo         |
| `session.error`                     | ✅ Coberto           | errorType, message, stack, statusCode, providerCallId, url                                                                                                     | —                                              |
| `session.idle`                      | ✅ Coberto           | (ephemeral)                                                                                                                                                    | —                                              |
| `session.title_changed`             | ❌ Ausente           | title: string                                                                                                                                                  | 🟡 Médio — rastrear mudança de título          |
| `session.info`                      | ❌ Ausente           | message: string, kind: string                                                                                                                                  | 🟡 Médio — info operacional                    |
| `session.warning`                   | ✅ Coberto           | —                                                                                                                                                              | —                                              |
| `session.model_change`              | ✅ Coberto           | —                                                                                                                                                              | —                                              |
| `session.mode_changed`              | ✅ Coberto           | —                                                                                                                                                              | —                                              |
| `session.plan_changed`              | ✅ Coberto           | —                                                                                                                                                              | —                                              |
| `session.workspace_file_changed`    | ❌ Ausente           | filePath: string, changeType: "created"\|"modified"\|"deleted"                                                                                                 | 🟡 Médio                                       |
| `session.handoff`                   | ❌ Ausente           | targetModel: string, reason: string, handoffId: string                                                                                                         | 🔴 Alto — handoff de modelo                    |
| `session.truncation`                | ✅ Coberto           | —                                                                                                                                                              | —                                              |
| `session.snapshot_rewind`           | ❌ Ausente           | targetSnapshotId: string, eventCount: number                                                                                                                   | 🟡 Médio                                       |
| `session.context_changed`           | ❌ Ausente           | context{cwd, gitRoot, repository, hostType, branch, headCommit, baseCommit}                                                                                    | 🔴 Alto — mudança de contexto git              |
| `session.usage_info`                | ✅ Coberto           | —                                                                                                                                                              | —                                              |
| `session.compaction_start`          | ✅ Coberto           | —                                                                                                                                                              | —                                              |
| `session.compaction_complete`       | ✅ Coberto           | —                                                                                                                                                              | —                                              |
| `session.task_complete`             | ✅ Coberto           | —                                                                                                                                                              | —                                              |
| `session.shutdown`                  | ✅ Coberto           | —                                                                                                                                                              | —                                              |
| `session.tools_updated`             | ✅ Coberto           | model: string                                                                                                                                                  | —                                              |
| `session.background_tasks_changed`  | ✅ Coberto           | (ephemeral, data: {})                                                                                                                                          | —                                              |
| `session.skills_loaded`             | ❌ Ausente           | skills[]{name, description, source, userInvocable, enabled, path?}                                                                                             | 🔴 Alto — inventário de skills                 |
| `session.mcp_servers_loaded`        | ✅ Coberto           | servers[]{name, status, source?, error?}                                                                                                                       | —                                              |
| `session.mcp_server_status_changed` | ❌ Ausente           | serverName: string, status: "connected"\|"failed"\|"pending"\|"disabled"\|"not_configured"                                                                     | 🔴 Alto — monitorar MCP                        |
| `session.extensions_loaded`         | ❌ Ausente           | extensions[]{id, name, source, status}                                                                                                                         | 🟡 Médio                                       |
| `user.message`                      | ❌ Ausente           | content, transformedContent?, attachments?[], mentions?[]                                                                                                      | 🔴 Alto — capturar mensagens do usuário        |
| `pending_messages.modified`         | ❌ Ausente           | (ephemeral)                                                                                                                                                    | 🟢 Baixo — ephemeral                           |
| `assistant.turn_start`              | ✅ Coberto           | —                                                                                                                                                              | —                                              |
| `assistant.intent`                  | ❌ Ausente           | intent: string, confidence?: number, reasoning?: string                                                                                                        | 🔴 Alto — intenção do assistente               |
| `assistant.reasoning`               | ❌ Ausente           | content: string (thinking chain)                                                                                                                               | 🔴 Alto — chain-of-thought visível             |
| `assistant.reasoning_delta`         | ❌ Ausente           | (ephemeral) delta: string                                                                                                                                      | 🟢 Baixo — streaming ephemeral                 |
| `assistant.streaming_delta`         | ❌ Ausente           | (ephemeral) delta: string                                                                                                                                      | 🟢 Baixo — streaming ephemeral                 |
| `assistant.message`                 | ❌ Ausente           | content, turnId, metadata?                                                                                                                                     | 🔴 Alto — mensagem final                       |
| `assistant.message_delta`           | ❌ Ausente           | (ephemeral) delta: string, turnId: string                                                                                                                      | 🟢 Baixo — streaming ephemeral                 |
| `assistant.turn_end`                | ❌ Ausente           | turnId: string                                                                                                                                                 | 🔴 Alto — fechar ciclo do turno                |
| `assistant.usage`                   | ✅ Coberto (parcial) | **GAPS**: cost?, quotaSnapshots?, copilotUsage?, reasoningEffort?, initiator?, apiCallId?, providerCallId?, parentToolCallId? não persistidos                  | —                                              |
| `abort`                             | ❌ Ausente           | reason: string                                                                                                                                                 | 🔴 Alto — aborto do turno                      |
| `tool.user_requested`               | ❌ Ausente           | toolCallId, toolName, arguments?                                                                                                                               | 🔴 Alto — tool chamada pelo usuário            |
| `tool.execution_start`              | ✅ Coberto (parcial) | **GAP**: arguments? disponível mas não salvo no AuditBuffer                                                                                                    | —                                              |
| `tool.execution_partial_result`     | ❌ Ausente           | (ephemeral) toolCallId, partialOutput: string                                                                                                                  | 🟢 Baixo — streaming                           |
| `tool.execution_progress`           | ✅ Coberto           | —                                                                                                                                                              | —                                              |
| `tool.execution_complete`           | ✅ Coberto (parcial) | **GAP**: result.contents[] (rich content), error?, toolTelemetry? não capturados                                                                               | —                                              |
| `skill.invoked`                     | ✅ Coberto           | —                                                                                                                                                              | —                                              |
| `subagent.started`                  | ✅ Coberto           | —                                                                                                                                                              | —                                              |
| `subagent.completed`                | ✅ Coberto           | —                                                                                                                                                              | —                                              |
| `subagent.failed`                   | ✅ Coberto           | —                                                                                                                                                              | —                                              |
| `subagent.selected`                 | ❌ Ausente           | agentType: string, agentId: string, reason?: string                                                                                                            | 🟡 Médio                                       |
| `subagent.deselected`               | ✅ Coberto           | —                                                                                                                                                              | —                                              |
| `hook.start`                        | ✅ Coberto           | —                                                                                                                                                              | —                                              |
| `hook.end`                          | ✅ Coberto           | —                                                                                                                                                              | —                                              |
| `system.message`                    | ❌ Ausente           | content, role: "system"\|"developer", name?, metadata?{promptVersion?, variables?}                                                                             | 🔴 Alto — prompts do sistema                   |
| `system.notification`               | ❌ Ausente           | content, kind: {type: "agent_completed"\|"agent_idle"\|"shell_completed"\|"shell_detached_completed", ...}                                                     | 🔴 Alto — notificações de background           |
| `permission.requested`              | ✅ Coberto           | —                                                                                                                                                              | —                                              |
| `permission.completed`              | ✅ Coberto           | —                                                                                                                                                              | —                                              |
| `user_input.requested`              | ✅ Coberto           | —                                                                                                                                                              | —                                              |
| `user_input.completed`              | ✅ Coberto           | —                                                                                                                                                              | —                                              |
| `elicitation.requested`             | ✅ Coberto           | —                                                                                                                                                              | —                                              |
| `elicitation.completed`             | ✅ Coberto           | —                                                                                                                                                              | —                                              |
| `mcp.oauth_required`                | ❌ Ausente           | serverName, authorizationUrl                                                                                                                                   | 🔴 Alto — OAuth MCP                            |
| `mcp.oauth_completed`               | ❌ Ausente           | serverName, success                                                                                                                                            | 🔴 Alto                                        |
| `external_tool.requested`           | ❌ Ausente           | requestId, sessionId, toolCallId, toolName, arguments?, traceparent?, tracestate?                                                                              | 🔴 Alto — external tool com trace context      |
| `external_tool.completed`           | ❌ Ausente           | requestId                                                                                                                                                      | 🟡 Médio                                       |
| `command.queued`                    | ❌ Ausente           | (ephemeral) requestId, command                                                                                                                                 | 🟡 Médio                                       |
| `command.execute`                   | ❌ Ausente           | (ephemeral) requestId, command, commandName, args                                                                                                              | 🔴 Alto — comandos slash                       |
| `command.completed`                 | ❌ Ausente           | (ephemeral) requestId                                                                                                                                          | 🟡 Médio                                       |
| `commands.changed`                  | ❌ Ausente           | (ephemeral) commands[]{name, description?}                                                                                                                     | 🟡 Médio                                       |
| `exit_plan_mode.requested`          | ❌ Ausente           | (ephemeral) requestId, summary, planContent, actions[], recommendedAction                                                                                      | 🔴 Alto — aprovação de plano                   |
| `exit_plan_mode.completed`          | ❌ Ausente           | (ephemeral) requestId, action                                                                                                                                  | 🟡 Médio                                       |

**Resumo da cobertura**:

- ✅ Coberto completamente: 27 tipos
- ⚠️ Coberto parcialmente (gaps nos dados capturados): 4 tipos
- ❌ Ausente: 39 tipos
- Dos ausentes: 🔴 Alto valor = 19 tipos, 🟡 Médio = 13 tipos, 🟢 Baixo (ephemeral) = 7 tipos

---

## 3. Análise dos 4 Arquivos Alvo

### 3.1 `src/copilot/observability/event-collector.js` — Principal

**Status**: Ativo, 540 linhas, 34 handlers, recentemente expandido (Fases AI-AM)

**Gaps identificados**:

1. `tool.execution_start`: captura `toolCallId`, `toolName`, `mcpServerName` mas ignora `arguments`
   — os args estão disponíveis e poderiam alimentar o
   `globalAuditBuffer.push({ toolArgs: arguments })` (corrigindo o `toolArgs: {}` atual do Fase AL)

2. `assistant.usage`: captura tokens e cache tokens mas ignora:
   - `cost` — multiplicador de billing
   - `quotaSnapshots` — estado das cotas em tempo real
   - `copilotUsage.totalNanoAiu` — custo em nano-AIU
   - `reasoningEffort` — "low"/"medium"/"high"/"xhigh"
   - `initiator` — quem iniciou (sub-agente vs usuário)
   - `apiCallId`, `providerCallId`, `parentToolCallId` — rastreabilidade

3. `assistant.turn_end`: só registra `turnId` — não calcula duração do turno (não há correspondência
   com `turn_start`)

4. `session.mcp_servers_loaded`: captura mas ignora a lista estruturada de servidores (status,
   erros)

5. Sem `session.start`/`session.resume` — perda de contexto git (branch, commit, repositório)

6. Sem `user.message` — não rastreia mensagens do usuário (conteúdo, attachments)

7. Sem `system.notification` — perde notificações de background agents concluídos

8. Sem `mcp.oauth_required/completed` — sem rastreamento de OAuth MCP

9. Sem `exit_plan_mode.requested` — sem captura de aprovação de planos

10. Sem `abort` — abortos de turno não registrados

### 3.2 `src/copilot/agent/events.js` — Constantes de Eventos Internos

**Status**: Correto e completo. **Decisão: KEEP sem modificações.**

Gaps possíveis (não críticos):

- `session.title_changed`, `session.context_changed`, `session.handoff` são SDK events que poderiam
  ter correspondentes em `AGENT_EVENTS` para bridges SSE — mas por ora é overhead sem consumidor
- `assistant.intent` não tem espelho interno — pode ser útil adicionar `assistant.intent` à lista
  quando o agent quiser reagir a mudanças de intenção

### 3.3 `src/copilot/lib/event-helpers.js` — Helpers de EventEmitter

**Status**: Correto, limpo, sem bugs identificados. **Decisão: KEEP sem modificações.**

Oportunidade (não urgente):

- `waitForEvent` poderia ter overload com typed generic constraint para `AgentEventName` — mas é
  útil para qualquer `EventEmitter`, não só o agent

### 3.4 `src/copilot/hooks/audit.js` — Buffer de Auditoria

**Status**: Correto. Agora **alimentado pelo event-collector** (Fase AL).
`createAuditPostToolHandler` não é mais usado em produção — o feed vem via
`tool.execution_complete`.

**Gap**: `toolArgs: {}` sempre vazio porque `tool.execution_complete` não tem args. Corrigir
recuperando `arguments` do `tool.execution_start` no `_pending` map antes de deletar.

**Decisão**: KEEP. `createAuditPostToolHandler` deve ser marcado como `@deprecated` pois o feed
agora vem via event-collector.

---

## 4. Análise do Sistema de Telemetria SDK (Web Research)

Baseado na análise do pacote `@github/copilot-sdk/dist/`:

### 4.1 Telemetry Module (`telemetry.d.ts`)

```typescript
// SDK não depende de OpenTelemetry — integração é responsabilidade do consumidor
export declare function getTraceContext(provider?: TraceContextProvider): TraceContext;
export type TraceContextProvider = () => TraceContext | null;
export type TraceContext = { traceparent: string; tracestate?: string };
```

**Implicação**: O SDK expõe W3C Trace Context via `traceparent`/`tracestate` em eventos como
`external_tool.requested`. Nossa integração com OTel (`otel.js`) é válida e deve ser expandida para
consumir esses trace context headers.

### 4.2 Session API Relevante

```typescript
// session.d.ts — métodos de resposta para eventos bidirecionais
session.respondToPermission(requestId, decision): Promise<void>
session.respondToExternalTool(requestId, result): Promise<void>
session.respondToQueuedCommand(requestId, result): Promise<void>
session.respondToExitPlanMode(requestId, action): Promise<void>
```

Os eventos `permission.requested`, `external_tool.requested`, `command.queued`,
`exit_plan_mode.requested` são **bidirecionais** — o SDK espera resposta do cliente. Atualmente
nossos handlers **não respondem** a esses eventos (exceto `permission.requested` que já tem lógica
em outro módulo).

### 4.3 assistant.usage — Dados Críticos Não Capturados

```typescript
// Campos com alto valor operacional ausentes da persistência:
quotaSnapshots: { [quotaId: string]: {
    isUnlimitedEntitlement: boolean;
    entitlementRequests: number;
    usedRequests: number;
    remainingPercentage: number;   // ← alerta de quota!
    resetDate?: string;
    overage: number;
    overageAllowedWithExhaustedQuota: boolean;
} }
copilotUsage: { tokenDetails: [...], totalNanoAiu: number }
cost: number      // multiplicador de billing
reasoningEffort: string  // "low"|"medium"|"high"|"xhigh"
initiator?: string       // "sub-agent" ou ausente = usuário
```

`remainingPercentage < 0.1` pode ser usado para emitir alerta de quota via
`session.token_budget_warning`.

---

## 5. Roadmap de Execução — Fases AN a AZ+

### ═══ FASE AN: Corrigir toolArgs no globalAuditBuffer ═══

**Descrição**: O `_pending` Map em `event-collector.js` captura `arguments` em
`tool.execution_start` mas os descarta antes de alimentar o `globalAuditBuffer` em
`tool.execution_complete`. Corrigir para preservar `arguments` no `_pending` e passá-los.

**Arquivo**: `src/copilot/observability/event-collector.js`

**Mudança**:

1. Em `tool.execution_start`: adicionar `toolArgs: arguments ?? {}` no `_pending.set()`
2. Em `tool.execution_complete`: usar `pending?.toolArgs ?? {}` ao chamar `globalAuditBuffer.push()`
3. Atualizar typedef de `_pending` para incluir `toolArgs`

**Impacto**: `hook_get_audit_tail` passa a retornar argumentos reais

---

### ═══ FASE AO: Expandir assistant.usage — Quota Snapshots + Cost ═══

**Descrição**: Capturar os campos `cost`, `reasoningEffort`, `quotaSnapshots.remainingPercentage`,
`copilotUsage.totalNanoAiu`, `initiator` disponíveis em `assistant.usage`.

**Subfases**:

#### AO.1: Persistir dados extras no events.jsonl

No handler `assistant.usage`, adicionar extração e persistência de:

- `cost`, `reasoningEffort`, `initiator`, `apiCallId`, `providerCallId`, `parentToolCallId`
- `quotaSnapshots` (objeto completo)
- `copilotUsage` (objeto completo)

#### AO.2: Alerta de quota baixa

Se `quotaSnapshots` contém algum quota com `remainingPercentage < 0.1`:

- Emitir `metrics?.recordCounter('quota.low_warning')`
- Logar WARN com detalhes do quota

#### AO.3: MetricsStore — rastrear reasoning effort

- `recordCounter(`reasoning.effort.${reasoningEffort}`)` para controlar distribuição de uso

---

### ═══ FASE AP: Novos Handlers de Alto Valor — session.start/resume ═══

**Descrição**: Adicionar handlers completos para `session.start` e `session.resume` que capturam
contexto git completo (branch, commit, repositório), versão Copilot, modelo inicial e reasoning
effort.

**Subfases**:

#### AP.1: session.start handler

```js
session.on('session.start', (event) => {
  const { sessionId, copilotVersion, selectedModel, reasoningEffort, context } = event.data;
  metrics?.recordSessionStart(); // já existe — enriquecer com modelo
  metrics?.recordCounter(`model.${selectedModel ?? 'unknown'}`);
  if (persist)
    persistEvent({
      type: event.type,
      sessionId,
      ts: event.timestamp,
      copilotVersion,
      selectedModel,
      reasoningEffort,
      context,
    });
  log(
    'INFO',
    `[event-collector] session.start model=${selectedModel} branch=${context?.branch} session=${sessionId}`,
  );
});
```

#### AP.2: session.resume handler

```js
session.on('session.resume', (event) => {
    const { resumeTime, eventCount, selectedModel, context, alreadyInUse } = event.data;
    metrics?.recordCounter('session.resumed');
    if (alreadyInUse) metrics?.recordCounter('session.already_in_use');
    if (persist) persistEvent({ ... });
    log('INFO', `[event-collector] session.resume eventCount=${eventCount} alreadyInUse=${alreadyInUse}`);
})
```

---

### ═══ FASE AQ: Novos Handlers — user.message + assistant.message ═══

**Descrição**: Capturar mensagens de usuário e assistente para rastreabilidade do diálogo.

**Subfases**:

#### AQ.1: user.message (com suporte a attachments)

```js
session.on('user.message', (event) => {
  const { content, attachments } = event.data;
  metrics?.recordCounter('user.message');
  if (attachments?.length) metrics?.recordCounter('user.message.with_attachments');
  if (persist)
    persistEvent({
      type: event.type,
      sessionId,
      ts: event.timestamp,
      contentLength: content.length,
      attachmentCount: attachments?.length ?? 0,
      attachmentTypes: attachments?.map((a) => a.type) ?? [],
      // NÃO persistir content (PII/privacidade)
    });
});
```

**NOTA DE SEGURANÇA**: Não persistir `content` completo — risco de PII. Persistir apenas metadados
(tamanho, número de attachments, tipos).

#### AQ.2: assistant.message

```js
session.on('assistant.message', (event) => {
  const { content, turnId } = event.data;
  metrics?.recordCounter('assistant.message');
  if (persist)
    persistEvent({
      type: event.type,
      sessionId,
      ts: event.timestamp,
      turnId,
      contentLength: content?.length ?? 0,
      // NÃO persistir content completo
    });
});
```

#### AQ.3: assistant.intent

```js
session.on('assistant.intent', (event) => {
  const { intent, confidence } = event.data;
  metrics?.recordCounter(`assistant.intent.${intent ?? 'unknown'}`);
  if (persist)
    persistEvent({ type: event.type, sessionId, ts: event.timestamp, intent, confidence });
});
```

---

### ═══ FASE AR: Novos Handlers — abort + assistant.turn_end com duração ═══

**Descrição**: Adicionar handler para `abort` e melhorar `assistant.turn_end` para calcular duração
do turno (correlacionando com `assistant.turn_start`).

**Subfases**:

#### AR.1: abort handler

```js
session.on('abort', (event) => {
  metrics?.recordCounter('turn.aborted');
  metrics?.recordSessionError(); // aborto é um tipo de erro
  if (persist)
    persistEvent({ type: event.type, sessionId, ts: event.timestamp, reason: event.data.reason });
  log('WARN', `[event-collector] turn aborted: ${event.data.reason} session=${sessionId}`);
});
```

#### AR.2: assistant.turn_end com duração

Manter mapa `_turnStart: Map<string, number>` para calcular duração por `turnId`:

```js
// Em assistant.turn_start (já coberto): adicionar _turnStart.set(turnId, Date.now())
// Em assistant.turn_end (novo handler):
session.on('assistant.turn_end', (event) => {
  const { turnId } = event.data;
  const startTs = _turnStart.get(turnId);
  _turnStart.delete(turnId);
  const durationMs = startTs ? Date.now() - startTs : 0;
  metrics?.recordDialogTurn(durationMs, true);
  if (persist)
    persistEvent({ type: event.type, sessionId, ts: event.timestamp, turnId, durationMs });
  log('DEBUG', `[event-collector] turn_end: ${turnId} (${durationMs}ms) session=${sessionId}`);
});
```

---

### ═══ FASE AS: Novos Handlers — system.notification + mcp.oauth ═══

**Descrição**: Capturar notificações de background agents e OAuth MCP.

**Subfases**:

#### AS.1: system.notification (background agent completions)

```js
session.on('system.notification', (event) => {
  const { kind } = event.data;
  metrics?.recordCounter(`system.notification.${kind.type}`);
  if (kind.type === 'agent_completed') {
    metrics?.recordCounter(`background_agent.${kind.status}`);
  }
  if (persist)
    persistEvent({
      type: event.type,
      sessionId,
      ts: event.timestamp,
      notificationKind: kind.type,
      status: 'status' in kind ? kind.status : undefined,
    });
  log('INFO', `[event-collector] system.notification: ${kind.type} session=${sessionId}`);
});
```

#### AS.2: mcp.oauth_required / mcp.oauth_completed

```js
session.on('mcp.oauth_required', (event) => {
  const { serverName } = event.data;
  metrics?.recordCounter('mcp.oauth_required');
  if (persist) persistEvent({ type: event.type, sessionId, ts: event.timestamp, serverName });
  log('WARN', `[event-collector] mcp.oauth_required: ${serverName} session=${sessionId}`);
});
session.on('mcp.oauth_completed', (event) => {
  const { serverName, success } = event.data;
  metrics?.recordCounter(success ? 'mcp.oauth_completed.ok' : 'mcp.oauth_completed.fail');
  if (persist)
    persistEvent({ type: event.type, sessionId, ts: event.timestamp, serverName, success });
});
```

---

### ═══ FASE AT: Novos Handlers — session.context_changed + session.handoff ═══

#### AT.1: session.context_changed

```js
session.on('session.context_changed', (event) => {
  const { context } = event.data;
  if (persist)
    persistEvent({
      type: event.type,
      sessionId,
      ts: event.timestamp,
      branch: context?.branch,
      repository: context?.repository,
      cwd: context?.cwd,
    });
  log('INFO', `[event-collector] context_changed branch=${context?.branch} session=${sessionId}`);
});
```

#### AT.2: session.handoff (alta relevância)

```js
session.on('session.handoff', (event) => {
  const { targetModel, reason, handoffId } = event.data;
  metrics?.recordCounter('session.handoff');
  metrics?.recordCounter(`session.handoff.model.${targetModel ?? 'unknown'}`);
  if (persist)
    persistEvent({
      type: event.type,
      sessionId,
      ts: event.timestamp,
      targetModel,
      reason,
      handoffId,
    });
  log('INFO', `[event-collector] session.handoff → ${targetModel} reason=${reason}`);
});
```

---

### ═══ FASE AU: Novos Handlers — session.skills_loaded + session.extensions_loaded ═══

#### AU.1: session.skills_loaded

```js
session.on('session.skills_loaded', (event) => {
  const { skills } = event.data;
  const enabledCount = skills.filter((s) => s.enabled).length;
  metrics?.recordCounter('session.skills_loaded');
  metrics?.recordCounter('skills.enabled', enabledCount);
  if (persist)
    persistEvent({
      type: event.type,
      sessionId,
      ts: event.timestamp,
      totalSkills: skills.length,
      enabledSkills: enabledCount,
      skills: skills.map((s) => ({ name: s.name, enabled: s.enabled, source: s.source })),
    });
  log(
    'INFO',
    `[event-collector] skills_loaded: ${enabledCount}/${skills.length} enabled session=${sessionId}`,
  );
});
```

#### AU.2: session.extensions_loaded

```js
session.on('session.extensions_loaded', (event) => {
  const { extensions } = event.data;
  const runningCount = extensions.filter((e) => e.status === 'running').length;
  if (persist)
    persistEvent({
      type: event.type,
      sessionId,
      ts: event.timestamp,
      total: extensions.length,
      running: runningCount,
      extensions: extensions.map((e) => ({ id: e.id, status: e.status })),
    });
  log('INFO', `[event-collector] extensions_loaded: ${runningCount}/${extensions.length} running`);
});
```

---

### ═══ FASE AV: Novos Handlers — session.mcp_server_status_changed ═══

```js
session.on('session.mcp_server_status_changed', (event) => {
  const { serverName, status } = event.data;
  if (status === 'failed') {
    metrics?.recordCounter('mcp.server.failed');
    log('WARN', `[event-collector] MCP server failed: ${serverName}`);
  } else if (status === 'connected') {
    metrics?.recordCounter('mcp.server.connected');
    log('INFO', `[event-collector] MCP server connected: ${serverName}`);
  }
  metrics?.recordCounter(`mcp.server.status.${status}`);
  if (persist)
    persistEvent({ type: event.type, sessionId, ts: event.timestamp, serverName, status });
});
```

---

### ═══ FASE AW: Novos Handlers — command.execute + exit_plan_mode ═══

#### AW.1: command.execute

```js
session.on('command.execute', (event) => {
  const { commandName, args } = event.data;
  metrics?.recordCounter(`command.execute.${commandName}`);
  if (persist)
    persistEvent({ type: event.type, sessionId, ts: event.timestamp, commandName, args });
  log('DEBUG', `[event-collector] command.execute: /${commandName} session=${sessionId}`);
});
```

#### AW.2: exit_plan_mode.requested

```js
session.on('exit_plan_mode.requested', (event) => {
  const { summary, actions, recommendedAction } = event.data;
  metrics?.recordCounter('exit_plan_mode.requested');
  if (persist)
    persistEvent({
      type: event.type,
      sessionId,
      ts: event.timestamp,
      summaryLength: summary.length,
      actions,
      recommendedAction,
    });
  log('INFO', `[event-collector] exit_plan_mode.requested recommended=${recommendedAction}`);
});
```

---

### ═══ FASE AX: Tipagem estrita — JSDoc + SDK types ═══

**Descrição**: Maximizar tipagem do `event-collector.js` usando os tipos exatos do SDK.

**Subfases**:

#### AX.1: Typedef extendido para EventCollectorOptions

```js
/**
 * @typedef {object} EventCollectorOptions
 * @property {MetricsStore | null} [metrics]
 * @property {ErrorTracker | null} [errorTracker]
 * @property {HookBus | null} [hookBus]
 * @property {boolean} [persist]
 * @property {readonly string[]} [persistTypes]
 * @property {boolean} [captureUserContent] - Se true, persiste content de user.message (OFF por default, risco PII)
 * @property {boolean} [captureAssistantContent] - Se true, persiste content de assistant.message (OFF por default)
 */
```

#### AX.2: Typedef para \_pending Map

```js
/**
 * @type {Map<
 *   string,
 *   { toolName: string; mcpServerName: string | null; startTs: number; toolArgs: Record<string, unknown> }
 * >}
 */
const _pending = new Map();
```

#### AX.3: Typedef para \_turnStart Map

```js
/** @type {Map<string, number>} */
const _turnStart = new Map();
```

#### AX.4: Usar tipos específicos do SDK para cada handler

```js
// Ao invés de event.data genérico, usar narrowing por tipo:
session.on('session.start', (/** @type {{ data: import('@github/copilot-sdk').SessionStartEvent['data'] }} */ event) => { ... })
```

---

### ═══ FASE AY: hooks/audit.js — Deprecação de createAuditPostToolHandler ═══

**Descrição**: `createAuditPostToolHandler` não é mais necessário em produção pois o feed ao
`globalAuditBuffer` agora ocorre via `event-collector`. Marcar como deprecado e garantir que nenhum
código novo o use.

**Subfases**:

#### AY.1: Adicionar @deprecated ao JSDoc

```js
/**
 * @deprecated Desde Fase AL — o feed ao globalAuditBuffer ocorre via event-collector.js
 * (tool.execution_complete handler). Manter para compatibilidade com testes; remover em v2.
 */
export function createAuditPostToolHandler(logger, buffer = globalAuditBuffer) { ... }
```

#### AY.2: Verificar que nenhum hookset ativo usa createAuditPostToolHandler

```bash
rg "createAuditPostToolHandler" src/copilot/ --include "*.js" -l
```

#### AY.3: Adicionar nota ao JSDocs de AuditRingBuffer

Documentar que a fonte primária de dados é agora o `event-collector`.

---

### ═══ FASE AZ: Testes + Atualização de DEFAULT_PERSIST_TYPES ═══

**Descrição**: Após todas as fases acima, atualizar `DEFAULT_PERSIST_TYPES` com todos os novos tipos
adicionados, rodar suite de testes, lint e typecheck.

**Subfases**:

#### AZ.1: DEFAULT_PERSIST_TYPES — adicionar novos tipos

```js
const DEFAULT_PERSIST_TYPES = Object.freeze([
  // ... existentes ...
  'session.start',
  'session.resume',
  'session.context_changed',
  'session.handoff',
  'session.skills_loaded',
  'session.extensions_loaded',
  'session.mcp_server_status_changed',
  'assistant.turn_end',
  'assistant.message',
  'assistant.intent',
  'user.message',
  'abort',
  'tool.user_requested',
  'system.notification',
  'mcp.oauth_required',
  'mcp.oauth_completed',
  'external_tool.requested',
  'command.execute',
  'exit_plan_mode.requested',
]);
```

#### AZ.2: Testes unitários para novos handlers

- Verificar que handlers registram `recordCounter` corretamente
- Verificar que persistEvent é chamado com dados corretos
- Verificar que eventos ephemeral não são persistidos por padrão

#### AZ.3: Run quality gates

```bash
npm run test:unit      # ≥2049 pass, 0 fail
npm run lint           # 0 errors
npm run typecheck:node # clean
npm run format
```

#### AZ.4: Commit + push

---

## 6. Prioridade de Execução

| Prioridade | Fases | Justificativa                                                      |
| ---------- | ----- | ------------------------------------------------------------------ |
| 🔴 P0      | AN    | Corrige bug de toolArgs no globalAuditBuffer (dado hoje incorreto) |
| 🔴 P0      | AO    | Quota snapshots são críticos para prevenção de exaustão            |
| 🔴 P0      | AP    | session.start captura contexto git — essencial para diagnóstico    |
| 🔴 P1      | AR    | abort + turn_end com duração — loop do diálogo incompleto          |
| 🔴 P1      | AV    | MCP server status — monitoring de infraestrutura                   |
| 🟡 P2      | AQ    | user.message + assistant.message + intent                          |
| 🟡 P2      | AS    | system.notification + mcp.oauth                                    |
| 🟡 P2      | AT    | context_changed + handoff                                          |
| 🟡 P2      | AU    | skills_loaded + extensions_loaded                                  |
| 🟢 P3      | AW    | command.execute + exit_plan_mode                                   |
| 🟢 P3      | AX    | Tipagem estrita                                                    |
| 🟢 P3      | AY    | Deprecação createAuditPostToolHandler                              |
| 🟢 P3      | AZ    | Tests + commit                                                     |

---

## 7. Diagrama de Fluxo Atual (Pós-Fases AI-AM)

```
SDK session.on(70 typu)
         │
         ├─── [34 handlers ativos] ──────────────────────────────────┐
         │                                                            │
         │    tool.execution_start/complete                           │
         │    ├─→ MetricsStore.recordToolCall()                       │
         │    ├─→ HookBus.emitHook('post_tool_use')                   │
         │    └─→ globalAuditBuffer.push()  ← Fase AL                 │
         │                                                            │
         │    assistant.usage                                         │
         │    ├─→ MetricsStore.recordUsage()  ← 5 params (Fase AI)    │
         │    └─→ HookBus.emitHook()                                  │
         │                                                            │
         │    session.error                                           │
         │    ├─→ ErrorTracker.trackError()                           │
         │    └─→ MetricsStore.recordSessionError()                   │
         │                                                            │
         │    subagent.*/elicitation.*/user_input.*                   │
         │    └─→ MetricsStore.recordCounter()  ← Fase AM             │
         │                                                            │
         └─── [persistEvent()] ──────────────────────────────────────┘
                    │
                    └─→ events.jsonl  (DEFAULT_PERSIST_TYPES, 32 tipos)
```

---

## 8. Visão Target (Pós-Fase AZ)

```
SDK session.on(70 tipos)
         │
         ├─── [53+ handlers ativos] ─────────────────────────────────┐
         │                                                            │
         │    + session.start/resume/context_changed/handoff          │
         │    + user.message (metadados, sem PII)                     │
         │    + assistant.message/intent/turn_end (com duração)       │
         │    + abort                                                 │
         │    + system.notification (background agents)               │
         │    + mcp.oauth_required/completed                          │
         │    + session.skills_loaded/extensions_loaded               │
         │    + session.mcp_server_status_changed                     │
         │    + command.execute                                       │
         │    + exit_plan_mode.requested                              │
         │    + tool.user_requested                                   │
         │                                                            │
         │    assistant.usage (EXPANDIDO)                             │
         │    ├─→ MetricsStore.recordUsage()                          │
         │    ├─→ MetricsStore.recordCounter('quota.low_warning')     │
         │    └─→ Persiste quota snapshots + copilotUsage             │
         │                                                            │
         │    tool.execution_complete (CORRIGIDO)                     │
         │    └─→ globalAuditBuffer.push({ toolArgs: real_args })     │
         │                                                            │
         └─── [persistEvent()] ──────────────────────────────────────┘
                    │
                    └─→ events.jsonl  (DEFAULT_PERSIST_TYPES, 51+ tipos)
```

---

## 9. Riscos e Considerações

### 9.1 PII e Privacidade

- `user.message.content` e `assistant.message.content` NÃO devem ser persistidos em full
- Usar apenas metadados: `contentLength`, `attachmentCount`, `attachmentTypes`
- Implementar flag `captureUserContent: false` (default) no `EventCollectorOptions`

### 9.2 Performance

- Eventos `ephemeral: true` (streaming deltas, partial results) NÃO devem ser persistidos
- `tool.execution_partial_result`, `assistant.streaming_delta`, `assistant.reasoning_delta`,
  `assistant.message_delta` são ephemeral — só emitir no HookBus para SSE, nunca no events.jsonl
- `session.background_tasks_changed` já é ephemeral — persistência atual está correta (só se
  incluído em DEFAULT_PERSIST_TYPES)

### 9.3 Compatibilidade

- Todos os novos handlers devem usar `Optional Chaining` (`?.`) para acessar campos opcionais
- `event.data` pode ter campos ausentes em versões antigas do SDK — usar `?? default`
- `event.timestamp` pode ser null em edges — usar `event.timestamp ?? new Date().toISOString()`

---

## 10. Status de Execução das Fases AN-AY (CONCLUÍDAS)

> **Data de execução**: 2026-05-28 | **Commit**: `13f595b2` | **Branch**: origin/main

| Fase | Título                                    | Status       | Observações                                      |
| ---- | ----------------------------------------- | ------------ | ------------------------------------------------ |
| AN   | Corrigir toolArgs no globalAuditBuffer    | ✅ CONCLUÍDA | `_pending` Map estendido com `toolArgs`          |
| AO   | Expandir assistant.usage — Quota + Cost   | ✅ CONCLUÍDA | quota snapshots + copilotUsage + reasoningEffort |
| AP   | session.start / session.resume handlers   | ✅ CONCLUÍDA | contexto git, branch, versão Copilot             |
| AQ   | user.message + assistant.message + intent | ✅ CONCLUÍDA | Metadados sem PII, flag captureUserContent       |
| AR   | abort + assistant.turn_end com duração    | ✅ CONCLUÍDA | `_turnStart` Map por turnId                      |
| AS   | system.notification + mcp.oauth           | ✅ CONCLUÍDA | background agents + OAuth MCP                    |
| AT   | session.context_changed + session.handoff | ✅ CONCLUÍDA | git context tracking + handoff de modelo         |
| AU   | session.skills_loaded + extensions_loaded | ✅ CONCLUÍDA | inventário de skills e extensões                 |
| AV   | session.mcp_server_status_changed         | ✅ CONCLUÍDA | monitoring de infra MCP                          |
| AW   | command.execute + exit_plan_mode          | ✅ CONCLUÍDA | comandos slash + aprovação de planos             |
| AX   | Tipagem estrita — JSDoc + SDK types       | ✅ CONCLUÍDA | typedefs atualizados, SDK types narrowing        |
| AY   | Deprecação createAuditPostToolHandler     | ✅ CONCLUÍDA | `@deprecated` adicionado, verificação de uso     |

**Resultado**: `event-collector.js` passou de 34 handlers (540 linhas) para **53 handlers (1037
linhas)**. Cobertura de eventos SDK: de 34/70 para **53+/90** (incluindo variantes de tipos de
conteúdo).

---

# ═══════════════════════════════════════════════════════════════════════

# NOVA AUDITORIA ARQUITETURAL PROFUNDA — CICLO 2 (2026-05-28)

# ═══════════════════════════════════════════════════════════════════════

> Esta seção contém a auditoria expandida realizada após leitura completa de **todos** os arquivos
> em `src/copilot/agent/` e `src/copilot/observability/`, cruzados com o estado atual da SDK e do
> sistema de telemetria.

---

## 11. Inventário Completo dos Módulos Auditados

### 11.1 `src/copilot/agent/` — 20 arquivos

| Arquivo                    | Tipo         | LOC (est.) | Comentários                                                                                                           |
| -------------------------- | ------------ | ---------- | --------------------------------------------------------------------------------------------------------------------- |
| `always-alive.js`          | Núcleo       | ~1285      | Orquestrador principal; bootstraps dual pipeline                                                                      |
| `events.js`                | Constantes   | ~150       | AGENT_EVENTS (~70 entradas), HIGH_FREQUENCY_EVENTS                                                                    |
| `session-event-wirer.js`   | Bridge       | ~310       | SDK→AgentEmitter; KNOWN_SDK_EVENTS tem apenas 9 entradas (BUG)                                                        |
| `tool-audit-logger.js`     | Auditoria    | ~200       | logToolAudit, buildAuditingPermissionHandler; escreve tool-audit.jsonl                                                |
| `dialog-loop-manager.js`   | Orquestração | ~600       | mutex, watchdog, backpressure, pause/resume                                                                           |
| `dialog-loop-wirer.js`     | Bridge       | ~200       | liga DialogLoopManager ao NERV/SSE                                                                                    |
| `dialog-protocol.js`       | Protocolo    | ~150       | READY/REPLY/STOPPED state machine                                                                                     |
| `dialog-turn-executor.js`  | Execução     | ~300       | executa um turn do diálogo                                                                                            |
| `dialog-watchdog.js`       | Watchdog     | ~200       | detecta stalls, timeout por turno                                                                                     |
| `entry.js`                 | Bootstrap    | ~50        | entry point do módulo copilot                                                                                         |
| `index.js`                 | Re-exports   | ~100       | API pública do módulo agent                                                                                           |
| `message-queue.js`         | Fila         | ~200       | serialize/deserialize; FIFO com prioridade                                                                            |
| `permission-controller.js` | Permissões   | ~200       | controla decisões de permissão, integra permission-handler.js                                                         |
| `reconnect-policy.js`      | Resiliência  | ~150       | backoff exponencial, max retries                                                                                      |
| `session-hooks.js`         | Re-export    | ~12        | `@deprecated` re-export para compatibilidade                                                                          |
| `session-initializer.js`   | Bootstrap    | ~250       | cria/retoma sessão SDK com hooks                                                                                      |
| `state-io.js`              | Persistência | ~200       | writeState/readState para state.json                                                                                  |
| `status-snapshot.js`       | Snapshot     | ~150       | getStatusSnapshot(), serializa estado do agente                                                                       |
| `task-executor.js`         | Execução     | ~200       | executeTask(); emite tool.execution.start/complete no AGENT emitter; chama `defaultAuditLog.recordToolStart/Complete` |
| `tools-bootstrap.js`       | Bootstrap    | ~150       | inicializa ferramentas MCP                                                                                            |
| `webhook-manager.js`       | Webhook      | ~200       | gerencia callbacks de webhook                                                                                         |

### 11.2 `src/copilot/observability/` — 9 arquivos

| Arquivo                   | Tipo          | LOC (est.) | Comentários                                                                            |
| ------------------------- | ------------- | ---------- | -------------------------------------------------------------------------------------- |
| `index.js`                | Re-exports    | ~80        | API pública do módulo observability                                                    |
| `event-collector.js`      | Coletor       | 1037       | Bridge SKD→telemetria; 53 handlers; singleton `defaultEventCollector`                  |
| `metrics.js`              | MetricsStore  | ~400       | recordToolCall, recordUsage, recordSessionStart, periodically snapshots                |
| `error-tracker.js`        | ErrorTracker  | ~300       | trackError, dedup, limita burst; ring buffer de erros                                  |
| `agent-event-observer.js` | Observer      | ~350       | Observa AGENT EventEmitter (não SDK); alimenta metrics; BUG \_turnStarts               |
| `audit-log.js`            | Auditoria     | ~350       | Ring buffer 200 entradas; escreve logs/audit.jsonl; recordToolStart/Complete DEAD CODE |
| `hooks-audit-preset.js`   | Preset        | ~100       | createHooksAuditPreset(); grava audit events no defaultAuditLog                        |
| `logger.js`               | Logger        | ~150       | log(level, msg) wrapper; respeita LOG_LEVEL env                                        |
| `otel.js`                 | OpenTelemetry | ~200       | trace/span wrappers; usa W3C trace context                                             |

---

## 12. Análise Arquitetural Profunda — Bugs, Gaps e Riscos

### 12.1 BUGS CRÍTICOS (P0)

#### BUG-01: `KNOWN_SDK_EVENTS` desatualizada em `session-event-wirer.js`

**Arquivo**: `src/copilot/agent/session-event-wirer.js` **Severidade**: 🔴 ALTO — spam de DEBUG logs
em produção para todos os 53+ novos eventos

O Set `KNOWN_SDK_EVENTS` contém apenas 9 eventos:

```js
const KNOWN_SDK_EVENTS = new Set([
  'session.compaction_start',
  'session.compaction_complete',
  'assistant.reasoning_delta',
  'session.usage_info',
  'session.mode_changed',
  'assistant.message_delta',
  'tool.execution_start',
  'tool.execution_complete',
  'assistant.usage',
]);
```

A função `_wireCatchAll` emite `[AlwaysAlive] Evento SDK não tratado: kind=X` para **todos os 53+
eventos** gerenciados pelo `event-collector.js` que não estão neste Set. Isso gera ruído extremo nos
logs sem valor diagnóstico, mascarando eventos realmente não tratados.

**Fix**: Expandir `KNOWN_SDK_EVENTS` para incluir todos os eventos agora gerenciados por
`event-collector.js`.

#### BUG-02: `_turnStarts` Map usa chave estática `'current'` em `agent-event-observer.js`

**Arquivo**: `src/copilot/observability/agent-event-observer.js` **Severidade**: 🔴 ALTO — corrompem
medições de duração se houver turnos concorrentes

```js
// BUG: usa 'current' como chave em vez do turnId real
this._turnStarts.set('current', Date.now()); // em dialog.turn_start
const start = this._turnStarts.get('current'); // em dialog.turn_end
```

Se dois turnos de diálogo ocorrem em sobreposição (possível com LLM-B/tasks concorrentes), o segundo
turn_start sobrescreve o timestamp do primeiro, levando a `durationMs` errado ou negativo no
turn_end do primeiro turno.

**Fix**: Usar `turnId` como chave do Map, emitir o `turnId` no evento `dialog.turn_start` e
correlacionar corretamente.

#### BUG-03: `defaultAuditLog.recordToolStart()/recordToolComplete()` chamados em `task-executor.js` mas NUNCA consumidos

**Arquivo**: `src/copilot/agent/task-executor.js` (linhas ~80-120) **Severidade**: 🔴 MÉDIO — código
ativo que escreve em `logs/tool-audit.jsonl` duplicando dados

`task-executor.js` chama:

```js
defaultAuditLog.recordToolStart({ toolCallId, toolName, args, mcpServerName });
// ...
defaultAuditLog.recordToolComplete({ toolCallId, success, taskId, resultContent });
```

O `event-collector.js` **também** registra esses mesmos eventos via seus handlers
`tool.execution_start` e `tool.execution_complete`, que:

1. Alimentam o `globalAuditBuffer` (via `hooks/audit.js`)
2. Persistem em `events.jsonl`
3. Chamam `metrics.recordToolCall()`

Resultado: cada tool call gera **3 registros** em `logs/tool-audit.jsonl`:

- Um de `task-executor.js` via `defaultAuditLog.recordToolStart()`
- Um de `tool-audit-logger.js` via `logToolAudit()` (durante decisão de permissão)
- Potencial duplicação no ring buffer do `audit-log.js`

**Fix**: Remover as chamadas `defaultAuditLog.recordToolStart/Complete` de `task-executor.js`,
mantendo apenas as emissões de eventos `tool.execution.start/complete` no AGENT emitter. O
`event-collector.js` já cobre o registro completo.

#### BUG-04: Três subscrições para `tool.execution_start/complete` na mesma sessão

**Arquivos**: `session-event-wirer.js`, `event-collector.js`, `task-executor.js` **Severidade**: 🔴
ALTO — triple-fire para cada evento de ferramenta

Para cada sessão SDK ativa, existem **3 listeners** simultâneos em `tool.execution_start`:

1. `session-event-wirer.js: _wireModeAndToolEvents()` — emite no AGENT emitter (SSE/NERV) — mas **só
   se `!isProcessing()`**
2. `event-collector.js` — registra em MetricsStore + globalAuditBuffer + events.jsonl — **sempre**
3. `task-executor.js: executeTask()` — chama `defaultAuditLog.recordToolStart()` — **sempre**

O listener do `session-event-wirer.js` tem guard `!isProcessing()`, então durante processamento de
tarefa (que é quando ferramentas são chamadas!), o wirer **silencia** as emissões SSE de tool events
para os consumidores do AGENT emitter. Isso significa que clientes SSE não veem tool events durante
tarefas em andamento.

**Fix**: Remover o guard `!isProcessing()` do wirer para tool events, ou mover a emissão SSE para
`task-executor.js` que já tem a subscrição correta.

#### BUG-05: Duplo tratamento de `assistant.usage` entre wirer e collector

**Arquivos**: `session-event-wirer.js: _wireCatchAll()`, `event-collector.js` **Severidade**: 🟡
MÉDIO — lógica de billing executada duas vezes

`_wireCatchAll` do wirer captura `assistant.usage` via wildcard `session.on(callback)` e:

1. Atualiza `#lastPrInfo` via `onPrInfo` callback
2. Emite `pr.consumed` no AGENT emitter
3. Chama `writeState()`

O `event-collector.js` também tem um handler explícito para `assistant.usage` que:

1. Chama `metrics.recordUsage()`
2. Persiste em events.jsonl com quota snapshots

A dupla subscrição não causa erros visíveis mas representa duplicação de lógica: qualquer mudança no
schema de `assistant.usage` precisa ser atualizada em dois lugares.

#### BUG-06: `hooks-audit-preset.js` cria `onPermissionRequest` com `allowAll: true`

**Arquivo**: `src/copilot/observability/hooks-audit-preset.js` **Severidade**: 🔴 ALTO — risco de
segurança

```js
const onPermissionRequest = createPermissionHandler({ allowAll: true, auditMode: true });
```

O preset criado por `createHooksAuditPreset()` usa `allowAll: true`, o que significa que **qualquer
ferramenta não configurada explicitamente** será automaticamente aprovada no modo de auditoria. Se
este preset for usado em produção como substituto do handler real, perda completa de controle de
permissões.

**Verificação necessária**: confirmar que `createHooksAuditPreset()` é usado APENAS em testes/dev e
NUNCA como handler primário de produção.

### 12.2 DEAD CODE (P1)

#### DC-01: `audit-log.js` — `recordToolStart()` e `recordToolComplete()` nunca chamados de forma produtiva

**Análise atualizada após leitura de `task-executor.js`**: Esses métodos SÃO chamados por
`task-executor.js`. Porém, o mesmo dado já é capturado pelo `event-collector.js`. O problema é
fundamentalmente de **duplicação**, não de código morto. Ver BUG-03.

**Ação**: Manter os métodos mas remover a chamada redundante de `task-executor.js`.

#### DC-02: `session-hooks.js` — re-export @deprecated

**Arquivo**: `src/copilot/agent/session-hooks.js` **Análise**: Arquivo de ~12 linhas que apenas
re-exporta de `#copilot/hooks/session`. Marcado como `@deprecated`. Pode ser removido após auditoria
de importadores.

#### DC-03: `createAuditPostToolHandler` em `hooks/audit.js` — marcado @deprecated (Fase AY)

**Status**: Deprecação já adicionada. Remover em ciclo de limpeza futuro.

### 12.3 GAPS DE INTEGRAÇÃO (P1)

#### GAP-01: `events.js` — AGENT_EVENTS falta espelhos para novos eventos SDK

O arquivo `src/copilot/agent/events.js` define `AGENT_EVENTS` como array de ~70 entradas. Porém,
vários eventos novos emitidos pelo `event-collector.js` para o HookBus **não têm correspondente** no
AGENT_EVENTS para bridge SSE/AlwaysAlive:

Ausentes em AGENT_EVENTS:

- `session.skills_loaded` (Fase AU)
- `session.handoff` (Fase AT)
- `session.context_changed` (Fase AT)
- `session.mcp_server_status_changed` (Fase AV)
- `assistant.intent` (Fase AQ)
- `tool.user_requested` (Fase AW)
- `exit_plan_mode.requested` (Fase AW)
- `abort` (Fase AR)
- `command.execute` (Fase AW)
- `system.notification` (Fase AS)

Completar `AGENT_EVENTS` garante que o TypeScript/JSDoc valide os tipos de evento corretos e que
implementações futuras de listeners possam depender do contrato.

#### GAP-02: `always-alive.js` — não usa `defaultAuditLog` diretamente para auditoria de ciclo de vida

`AlwaysAliveAgent` inicializa `defaultEventCollector.attach()` e `wireSessionEvents()` mas não
registra eventos de próprio ciclo de vida (connect, disconnect, reconnect, stop) no
`defaultAuditLog`. Isso significa que reinicializações de sessão e erros de reconexão não aparecem
no `audit.jsonl`.

**Ação**: Adicionar chamadas `defaultAuditLog.record({ type: 'agent.lifecycle', ... })` em
`#initSession`, `#tryReconnect`, `start()`, `stop()`.

#### GAP-03: `agent-event-observer.js` não propaga erros para `ErrorTracker`

O observer captura `session.fatal` e `task.error` mas não chama `errorTracker.trackError()` para
eventos `task.error`. A integração com `ErrorTracker` acontece apenas para `session.fatal`.

**Ação**: Adicionar chamada a `this._errorTracker?.trackError(...)` em handlers de `task.error` e
`dialog.turn_timeout`.

#### GAP-04: `task-executor.js` emite `tool.execution.start/complete` no AGENT emitter mas `events.js` tem `tool.execution_start/complete` (underscore)

Inconsistência de naming:

- `events.js` AGENT_EVENTS usa: `'tool.execution_start'`, `'tool.execution_complete'` (underscore)
- `task-executor.js` chama `emit('tool.execution.start', ...)`,
  `emit('tool.execution.complete', ...)` (dot notation)
- Consumidores SSE em `always-alive.js` escutam qual formato?

Essa inconsistência pode fazer com que listeners registrados com underscore não recebam os eventos
emitidos com dot notation pelo task-executor.

#### GAP-05: `status-snapshot.js` não inclui métricas de telemetria

`getStatusSnapshot()` retorna estado operacional do agente (session, queue, etc.) mas não inclui
dados de telemetria do `defaultEventCollector` (total de eventos capturados, última atualização de
métricas, erros rastreados). A snapshot seria útil para o dashboard mas atualmente omite esses
dados.

#### GAP-06: `dialog-loop-manager.js` não emite eventos para o HookBus

O `DialogLoopManager` gerencia estado de processamento (mutex, watchdog, pause/resume) mas não
notifica o `HookBus` sobre mudanças de estado do loop. Apenas emite para o AGENT EventEmitter
diretamente. Seria valioso ter hooks `dialog.loop_paused`, `dialog.loop_resumed`,
`dialog.watchdog_stall` visíveis no HookBus para monitoramento externo.

#### GAP-07: `webhook-manager.js` sem integração com `event-collector`

O `webhook-manager.js` despacha webhooks HTTP mas não registra dispatches, falhas ou timeouts no
`event-collector` ou no `defaultAuditLog`. Webhooks são eventos de alto valor para auditoria.

#### GAP-08: `reconnect-policy.js` sem métricas de reconexão

A política de reconexão com backoff exponencial não registra tentativas, falhas e sucessos de
reconexão no `metrics.js`. Isso dificulta diagnóstico de problemas de conectividade.

### 12.4 GAPS DE COBERTURA SDK (P2)

Com base na comparação entre todos os tipos de eventos SDK e os listeners ativos, os seguintes
eventos ainda NÃO são cobertos em nenhum dos módulos:

| Evento SDK                       | Valor | Schema                                     | Ação Recomendada                   |
| -------------------------------- | ----- | ------------------------------------------ | ---------------------------------- |
| `session.title_changed`          | 🟡    | `{ title: string }`                        | Fase BA — log + persist            |
| `session.info`                   | 🟡    | `{ infoType, message, url? }`              | Fase BA — log estruturado          |
| `session.snapshot_rewind`        | 🟡    | `{ upToEventId, eventsRemoved }`           | Fase BB — persist + counter        |
| `session.workspace_file_changed` | 🟡    | `{ path, operation: 'create'\|'update' }`  | Fase BB — persist + counter        |
| `system.message`                 | 🔴    | `{ content, role, name?, metadata? }`      | Fase BC — metadados (sem content)  |
| `command.queued`                 | 🟡    | `{ requestId, command }`                   | Fase BD — persist + respond log    |
| `command.completed`              | 🟡    | `{ requestId }`                            | Fase BD — persist                  |
| `commands.changed`               | 🟢    | `{ commands[]{name, description?} }`       | Fase BD — log informativo          |
| `exit_plan_mode.completed`       | 🟡    | `{ requestId }`                            | Fase BE — persist + correlate      |
| `external_tool.completed`        | 🟡    | `{ requestId }`                            | Fase BE — persist + correlate      |
| `pending_messages.modified`      | 🟢    | `{}`                                       | Fase BF — counter apenas           |
| `assistant.reasoning`            | 🔴    | `{ reasoningId, content }`                 | Fase BG — persist metadados        |
| `tool.execution_partial_result`  | 🟢    | ephemeral: `{ toolCallId, partialOutput }` | Fase BH — HookBus only (não jsonl) |

---

## 13. Análise de Conformidade com SDK

### 13.1 Bidirectional Events — Resposta Obrigatória

O SDK emite 4 tipos de eventos que **exigem resposta** via métodos específicos. Falhar em responder
pode causar timeout ou travamento da sessão:

| Evento                     | Método de Resposta                 | Status Atual                                                                              | Risco          |
| -------------------------- | ---------------------------------- | ----------------------------------------------------------------------------------------- | -------------- |
| `permission.requested`     | `session.respondToPermission()`    | ✅ Coberto em `permission-controller.js`                                                  | OK             |
| `external_tool.requested`  | `session.respondToExternalTool()`  | ⚠️ Handler existe em event-collector (Fase AN-AZ) mas não chama `respondToExternalTool()` | 🔴 **CRÍTICO** |
| `command.queued`           | `session.respondToQueuedCommand()` | ❌ Nenhum handler responde automaticamente                                                | 🔴 **CRÍTICO** |
| `exit_plan_mode.requested` | `session.respondToExitPlanMode()`  | ⚠️ Handler persiste mas não responde automaticamente                                      | 🔴 **CRÍTICO** |

Os três últimos eventos são recebidos mas **nenhum responde ao SDK**. Isso pode causar:

- Timeout da sessão aguardando resposta
- Ferramentas externas travadas esperando callback
- Comandos slash não executados

**Ação urgente**: Implementar resposta automática (allow/deny configurável) para cada tipo.

### 13.2 W3C Trace Context em `external_tool.requested`

O SDK inclui `traceparent` e `tracestate` em `external_tool.requested`. O `otel.js` do projeto tem
wrappers W3C mas não os consome a partir desse evento. Integração permitiria rastreamento fim-a-fim
de chamadas a ferramentas externas.

### 13.3 Content Types — Eventos de Arquivo/Mídia

O SDK emite eventos de conteúdo enriquecido (não visto antes):

- `audio`, `image`, `file`, `directory` — tipos de attachment
- `text`, `blob`, `resource`, `resource_link` — tipos de conteúdo
- `selection`, `terminal` — contexto de IDE
- `github_reference` — referências GitHub

Esses são provavelmente types dentro do schema de conteúdo de mensagens, não eventos de sessão
standalone. Verificar se correspondem a tipos de `attachments[]` em `user.message`.

### 13.4 Background Task Notification Types

O SDK define types específicos dentro do schema de `system.notification`:

```
agent_completed | agent_idle | shell_completed | shell_detached_completed
```

O handler atual de `system.notification` (Fase AS) captura o `kind.type` mas não correlaciona com o
agente/shell que completou. Enriquecimento com ID do agente seria valioso.

---

## 14. Análise de Conformidade com Tipagem (TypeScript/JSDoc)

### 14.1 Arquivos com `@ts-check` ativo

Todos os arquivos em `src/copilot/` usam `// @ts-check`. Verificações realizadas:

- `event-collector.js` — limpo após Fases AN-AY (incluindo Fase AX de tipagem estrita)
- `agent-event-observer.js` — BUG de `_turnStarts` causa potencial type error pois
  `Map<'current', number>` vs `Map<string, number>` pode causar false positives
- `task-executor.js` — chamadas a `defaultAuditLog.recordToolStart()` com campos corretos
- `audit-log.js` — `recordToolStart()`/`recordToolComplete()` aceita os tipos corretos de
  task-executor

### 14.2 Inconsistência de Naming de Eventos no AGENT EventEmitter

| Formato em `events.js`    | Formato em `task-executor.js` | Diferença  |
| ------------------------- | ----------------------------- | ---------- |
| `tool.execution_start`    | `tool.execution.start`        | `_` vs `.` |
| `tool.execution_complete` | `tool.execution.complete`     | `_` vs `.` |

Esta é uma divergência silenciosa. O TypeScript não pode verificar automaticamente que os mesmos
eventos sejam emitidos e subscritados com formatos diferentes, pois ambos são `string`.

---

## 15. Mapa de Fluxo Atual — Pós Fases AN-AY

```
SDK session.on(~90 tipos de evento)
         │
         ├─── [event-collector.js — 53 handlers] ───────────────────────────────────────────┐
         │    Subscreve: abort, session.start/resume/context_changed/handoff/               │
         │    skills_loaded/extensions_loaded/mcp_server_status_changed/...                  │
         │    user.message, assistant.message/intent/turn_start/turn_end,                    │
         │    assistant.usage (expandido), tool.execution_start/complete,                    │
         │    system.notification, mcp.oauth_required/completed, external_tool.requested,    │
         │    command.execute, exit_plan_mode.requested, tool.user_requested, ...             │
         │                                                           │                       │
         │    ┌─→ MetricsStore (metrics.js)                          │                       │
         │    ├─→ ErrorTracker (error-tracker.js)                    │                       │
         │    ├─→ HookBus.emitHook() → AlwaysAliveAgent EventEmitter │                       │
         │    └─→ globalAuditBuffer → logs/tool-audit.jsonl          │                       │
         │                                                           │                       │
         └─── [session-event-wirer.js — wirer] ──────────────────────┘                      │
              Subscreve TAMBÉM: tool.execution_start/complete (via _wireModeAndToolEvents)   │
              ⚠️ BUG: guard !isProcessing() silencia tool events durante task processing     │
              ⚠️ BUG: KNOWN_SDK_EVENTS (9 entradas) gera DEBUG spam para 53+ eventos         │
              Subcribe wildcard para assistant.usage (duplica lógica)                        │
              │                                                                              │
              └─→ AlwaysAliveAgent EventEmitter (SSE/NERV consumers)                        │
                                                                                             │
         ┌─── [task-executor.js — por task] ──────────────────────────────────────────────┐  │
         │    Subscreve: assistant.message_delta, tool.execution_start/complete,            │  │
         │    session.idle                                                                   │  │
         │    ⚠️ BUG: chama defaultAuditLog.recordToolStart/Complete (duplica event-collector)  │
         │    ⚠️ BUG: emite 'tool.execution.start' (dot) vs AGENT_EVENTS 'tool.execution_start' (underscore) │
         └─────────────────────────────────────────────────────────────────────────────────┘  │
                                                                                              │
         └─── [persistEvent()] ───────────────────────────────────────────────────────────────┘
                    │
                    └─→ logs/events.jsonl (DEFAULT_PERSIST_TYPES, 51+ tipos)
```

---

## 16. Roadmap Expandido — Fases AZ a BZ

> As fases abaixo estendem o trabalho realizado nas Fases AN-AY com foco em:
>
> 1. Correção de bugs críticos (BUG-01 a BUG-06)
> 2. Limpeza de duplicações e dead code
> 3. Integração completa AlwaysAliveAgent ↔ event-collector
> 4. Cobertura dos 18 eventos SDK ainda ausentes
> 5. Bidirectional events (resposta obrigatória)
> 6. Consolidação de sistemas de auditoria

---

### ═══ FASE AZ: Testes + Atualização de DEFAULT_PERSIST_TYPES (em andamento) ═══

#### AZ.1: DEFAULT_PERSIST_TYPES — adicionar todos os novos tipos implementados nas Fases AN-AY

```js
const DEFAULT_PERSIST_TYPES = Object.freeze([
  // ... existentes ...
  'session.start',
  'session.resume',
  'session.context_changed',
  'session.handoff',
  'session.skills_loaded',
  'session.extensions_loaded',
  'session.mcp_server_status_changed',
  'assistant.turn_end',
  'assistant.message',
  'assistant.intent',
  'user.message',
  'abort',
  'tool.user_requested',
  'system.notification',
  'mcp.oauth_required',
  'mcp.oauth_completed',
  'external_tool.requested',
  'command.execute',
  'exit_plan_mode.requested',
]);
```

#### AZ.2: Testes unitários para novos handlers (Fases AN-AY)

- Verificar que handlers das Fases AN-AY registram `recordCounter` corretamente
- Verificar que `persistEvent` é chamado com dados corretos para cada novo tipo
- Verificar que eventos ephemeral não são persistidos por padrão

#### AZ.3: Quality gates

```bash
npm run test:unit # ≥2049 pass, 0 fail
npm run lint      # 0 errors
npm run typecheck:node
npm run format:check
```

#### AZ.4: Commit + push

---

### ═══ FASE BA: Corrigir BUG-01 — Expandir KNOWN_SDK_EVENTS ═══

**Arquivo**: `src/copilot/agent/session-event-wirer.js` **Prioridade**: 🔴 P0 — elimina DEBUG spam
em produção

Substituir o Set `KNOWN_SDK_EVENTS` (9 entradas) por um Set completo com todos os eventos conhecidos
agora gerenciados pelo sistema (event-collector + wirer + task-executor):

```js
const KNOWN_SDK_EVENTS = new Set([
  // Eventos gerenciados pelo event-collector.js (53 handlers):
  'abort',
  'assistant.intent',
  'assistant.message',
  'assistant.message_delta',
  'assistant.reasoning_delta',
  'assistant.turn_end',
  'assistant.turn_start',
  'assistant.usage',
  'command.execute',
  'elicitation.completed',
  'elicitation.requested',
  'exit_plan_mode.requested',
  'external_tool.requested',
  'hook.end',
  'hook.start',
  'mcp.oauth_completed',
  'mcp.oauth_required',
  'permission.completed',
  'permission.requested',
  'session.background_tasks_changed',
  'session.compaction_complete',
  'session.compaction_start',
  'session.context_changed',
  'session.error',
  'session.extensions_loaded',
  'session.handoff',
  'session.idle',
  'session.mcp_servers_loaded',
  'session.mcp_server_status_changed',
  'session.mode_changed',
  'session.model_change',
  'session.plan_changed',
  'session.resume',
  'session.shutdown',
  'session.skills_loaded',
  'session.start',
  'session.task_complete',
  'session.tools_updated',
  'session.truncation',
  'session.usage_info',
  'session.warning',
  'skill.invoked',
  'subagent.completed',
  'subagent.deselected',
  'subagent.failed',
  'subagent.selected',
  'subagent.started',
  'system.notification',
  'tool.execution_complete',
  'tool.execution_progress',
  'tool.execution_start',
  'tool.user_requested',
  'user_input.completed',
  'user_input.requested',
  'user.message',
  // Eventos parcialmente cobertos (streaming ephemeral) — tratados pelo task-executor:
  'assistant.streaming_delta',
  'tool.execution_partial_result',
  // Ainda não cobertos mas reconhecidos para suprimir aviso:
  'session.title_changed',
  'session.info',
  'session.snapshot_rewind',
  'session.workspace_file_changed',
  'system.message',
  'command.queued',
  'command.completed',
  'commands.changed',
  'external_tool.completed',
  'exit_plan_mode.completed',
  'pending_messages.modified',
  'assistant.reasoning',
]);
```

#### BA.1: Atualizar KNOWN_SDK_EVENTS

#### BA.2: Revisar a lógica de \_wireCatchAll para distinguir entre:

- Eventos conhecidos mas não tratados pelo wirer (silenciar DEBUG)
- Eventos completamente desconhecidos (manter aviso para detectar novos SDK events)

#### BA.3: Adicionar um Set separado `WIRER_HANDLED_EVENTS` para eventos emitidos pelo próprio wirer

#### BA.4: Testes + lint + commit

---

### ═══ FASE BB: Corrigir BUG-02 — \_turnStarts com chave dinâmica por turnId ═══

**Arquivo**: `src/copilot/observability/agent-event-observer.js` **Prioridade**: 🔴 P0 — corrupção
silenciosa de métricas de duração

#### BB.1: Modificar handlers de dialog.turn_start e dialog.turn_end

O evento `dialog.turn_start` deve incluir `turnId` nos dados emitidos para que o observer possa usar
como chave:

```js
// Em always-alive.js ou dialog-loop-manager.js — ao emitir dialog.turn_start:
this.emit('dialog.turn_start', { sessionId: this.#sessionId, turnId: someUniqueId });

// Em agent-event-observer.js:
_onTurnStart(data) {
    // FIX: usar turnId como chave, não 'current'
    const turnId = data?.turnId ?? 'current'; // fallback mantém retrocompatibilidade
    this._turnStarts.set(turnId, performance.now());
}
_onTurnEnd(data) {
    const turnId = data?.turnId ?? 'current';
    const start = this._turnStarts.get(turnId);
    this._turnStarts.delete(turnId); // cleanup para evitar memory leak
    const durationMs = start ? performance.now() - start : 0;
    this._metrics?.recordDialogTurn(durationMs, !!start);
}
```

#### BB.2: Cleanup de entradas antigas no Map para prevenir memory leak

Adicionar lógica de TTL: se uma entrada em `_turnStarts` não foi consumida após
`MAX_TURN_DURATION_MS` (eg. 5 min), remover automaticamente.

#### BB.3: Adicionar log de warning quando `turnId` não está presente

#### BB.4: Testes unitários para o novo comportamento

---

### ═══ FASE BC: Corrigir BUG-03/04 — Remover triple-fire de tool events ═══

**Arquivos**: `task-executor.js`, `session-event-wirer.js` **Prioridade**: 🔴 P0 — duplicação de
dados de auditoria e race conditions

#### BC.1: Remover `defaultAuditLog.recordToolStart/Complete` de `task-executor.js`

```js
// REMOVER de task-executor.js:
// const unsubToolStart = session.on('tool.execution_start', (event) => {
//     defaultAuditLog.recordToolStart({ ... });   ← REMOVER
//     emit('tool.execution.start', { ... });      ← MANTER
// });
```

O `emit('tool.execution.start', ...)` deve ser mantido — é a fonte de eventos para consumers SSE.
Apenas remover a chamada `defaultAuditLog.recordToolStart`.

#### BC.2: Corrigir naming inconsistente em `task-executor.js` — dot vs underscore

```js
// ANTES (em task-executor.js):
emit('tool.execution.start', { ... });    // dot notation
emit('tool.execution.complete', { ... }); // dot notation

// DEPOIS:
emit('tool.execution_start', { ... });    // underscore — alinhado com events.js
emit('tool.execution_complete', { ... }); // underscore — alinhado com events.js
```

Verificar que todos os listeners em `always-alive.js` e SSE também esperam o formato correto.

#### BC.3: Remover o guard `!isProcessing()` de tool events em `session-event-wirer.js`

O guard atual faz com que clientes SSE não recebam tool events durante processamento de tarefa:

```js
// ANTES (session-event-wirer.js):
const unsubToolStart = session.on('tool.execution_start', (evt) => {
  if (!isProcessing()) return; // ← REMOVER ou inverter a lógica
  this.emit(AGENT_EVENTS.TOOL_EXECUTION_START, buildToolStartPayload(evt));
});

// DEPOIS: emitir sempre para SSE consumers
const unsubToolStart = session.on('tool.execution_start', (evt) => {
  this.emit(AGENT_EVENTS.TOOL_EXECUTION_START, buildToolStartPayload(evt));
});
```

#### BC.4: Testes de não-regressão — verificar que tool events chegam ao SSE durante task processing

---

### ═══ FASE BD: Corrigir BUG-05 — Unificar assistant.usage entre wirer e collector ═══

**Arquivos**: `session-event-wirer.js`, `event-collector.js` **Prioridade**: 🟡 P1

#### BD.1: Remover handler wildcard de `assistant.usage` de `_wireCatchAll`

O `_wireCatchAll` atual captura `assistant.usage` via wildcard para extrair `onPrInfo` callback. Em
vez disso, adicionar um listener dedicado:

```js
// Em session-event-wirer.js, adicionar handler explícito:
session.on('assistant.usage', (evt) => {
  const data = evt?.data ?? {};
  // Atualizar lastPrInfo (único responsibility do wirer para este evento)
  if (onPrInfo) onPrInfo(extractPrInfo(data));
  // Emitir no AGENT emitter para SSE
  this.emit(AGENT_EVENTS.PR_CONSUMED, { ...data });
  // Chamar writeState
  writeState({ lastUsage: data });
  // NÃO chamar metrics.recordUsage() — isso é responsabilidade do event-collector
});
```

#### BD.2: Remover a captura de `assistant.usage` em `_wireCatchAll`

Após adicionar o listener dedicado, `_wireCatchAll` deve ignorar `assistant.usage` ou apenas logá-lo
como evento tratado por outro handler.

#### BD.3: Documentar a divisão de responsabilidades clara:

- **wirer**: SSE bridge, lastPrInfo, writeState
- **event-collector**: MetricsStore, HookBus, persistência
- **task-executor**: streaming delta handling por tarefa

---

### ═══ FASE BE: Auditar BUG-06 — hooks-audit-preset allowAll ═══

**Arquivo**: `src/copilot/observability/hooks-audit-preset.js` **Prioridade**: 🔴 P0 — segurança

#### BE.1: Verificar todos os locais onde `createHooksAuditPreset()` é chamado

```bash
rg "createHooksAuditPreset" src/ tests/ --include "*.js"
```

#### BE.2: Se usado em produção, substituir `allowAll: true` por handler real

```js
// ANTES (hooks-audit-preset.js):
const onPermissionRequest = createPermissionHandler({ allowAll: true, auditMode: true });

// DEPOIS: injetar handler do contexto de produção via parâmetro:
/**
 * @param {{ permissionHandler?: PermissionHandler }} [options]
 */
export function createHooksAuditPreset(options = {}) {
  const onPermissionRequest =
    options.permissionHandler ?? createPermissionHandler({ allowAll: false, auditMode: true }); // default seguro
  // ...
}
```

#### BE.3: Adicionar warning de log se `allowAll: true` for detectado em ambiente não-test

---

### ═══ FASE BF: Completar AGENT_EVENTS em events.js ═══

**Arquivo**: `src/copilot/agent/events.js` **Prioridade**: 🟡 P1 — conformidade de tipos e contrato
de API

#### BF.1: Adicionar entradas ausentes ao AGENT_EVENTS

Adicionar os 10+ eventos ausentes identificados no GAP-01:

```js
// Novos eventos de sessão
'session.skills_loaded',
'session.handoff',
'session.context_changed',
'session.mcp_server_status_changed',
'session.title_changed',
'session.info',
'session.snapshot_rewind',
'session.workspace_file_changed',
// Novos eventos de assistente
'assistant.intent',
'assistant.reasoning',
// Novos eventos de ação
'abort',
'tool.user_requested',
'exit_plan_mode.requested',
'command.execute',
'system.notification',
// Eventos de conteúdo
'user.message',
'assistant.message',
// Eventos bidirecionais pendentes
'command.queued',
'external_tool.requested',
'exit_plan_mode.completed',
'external_tool.completed',
```

#### BF.2: Atualizar HIGH_FREQUENCY_EVENTS se necessário

`abort`, `user.message` podem ser moderada frequência. Verificar e ajustar.

#### BF.3: Adicionar JSDoc documenting o propósito de cada novo evento

---

### ═══ FASE BG: Integrar AlwaysAliveAgent com defaultAuditLog para ciclo de vida ═══

**Arquivo**: `src/copilot/agent/always-alive.js` **Prioridade**: 🟡 P1 — rastreabilidade de
reconexões e ciclo de vida

#### BG.1: Registrar eventos de ciclo de vida no defaultAuditLog

Em `src/copilot/agent/always-alive.js`, adicionar chamadas ao `defaultAuditLog`:

```js
import { defaultAuditLog } from '#copilot/observability';

// Em start():
defaultAuditLog.record({ type: 'agent.lifecycle', data: { action: 'start', sessionId } });

// Em stop():
defaultAuditLog.record({ type: 'agent.lifecycle', data: { action: 'stop', reason } });

// Em #tryReconnect() — sucesso:
defaultAuditLog.record({
  type: 'agent.lifecycle',
  data: { action: 'reconnect.success', attempt, durationMs },
});

// Em #tryReconnect() — falha:
defaultAuditLog.record({
  type: 'agent.lifecycle',
  data: { action: 'reconnect.failed', attempt, error: e.message },
});

// Em #initSession():
defaultAuditLog.record({
  type: 'agent.lifecycle',
  data: { action: 'session.init', sessionId, isResume },
});
```

#### BG.2: Incluir `agent.lifecycle` entries no getAuditSummary()

O `getAuditSummary()` de `audit-log.js` lê de `tool-audit.jsonl`. Seria melhor ter um método
`getLifecycleSummary()` que lê do `audit.jsonl` para consultas de ciclo de vida.

---

### ═══ FASE BH: Bidirectional Events — Resposta automática para external_tool e command.queued ═══

**Arquivo**: `src/copilot/observability/event-collector.js` **Prioridade**: 🔴 P0 — corretude
funcional (sessão pode travar sem resposta)

#### BH.1: Completar handler de `external_tool.requested` com `respondToExternalTool`

O handler atual registra o evento mas não responde ao SDK:

```js
session.on('external_tool.requested', (event) => {
  const { requestId, toolName, toolCallId, traceparent, tracestate } = event.data;
  // ... logging e persistência ...

  // ADICIONAR: resposta ao SDK (necessário para não travar)
  // A resposta real deve vir do permission-controller, mas um fallback de segurança:
  if (session.respondToExternalTool) {
    // Delegar ao permission-controller via callback ou resposta padrão
    void session.respondToExternalTool(requestId, {
      output: [{ type: 'text', text: '[external tool not configured]' }],
    });
  }
});
```

**Nota**: A resposta ideal deve ser roteada através do `permission-controller.js` para permitir
aprovação condicional. Implementação completa requer refatoração do fluxo de permissões.

#### BH.2: Handler para `command.queued` com resposta automática

```js
session.on('command.queued', (event) => {
  const { requestId, command } = event.data;
  metrics?.recordCounter('command.queued');
  if (persist)
    persistEvent({ type: event.type, sessionId, ts: event.timestamp, requestId, command });
  log('INFO', `[event-collector] command.queued: ${command}`);

  // Resposta automática necessária:
  if (session.respondToQueuedCommand) {
    void session.respondToQueuedCommand(requestId, { output: '' }).catch(log.bind(null, 'WARN'));
  }
});
```

#### BH.3: Handler para `exit_plan_mode.requested` com resposta automática

O handler atual (Fase AW) persiste o evento mas não responde:

```js
// Adicionar chamada de resposta:
if (session.respondToExitPlanMode) {
  // Ação padrão: executar (pode ser configurável via options)
  void session
    .respondToExitPlanMode(requestId, { action: 'continue' })
    .catch((e) => log('WARN', `[event-collector] exit_plan_mode response failed: ${e.message}`));
}
```

#### BH.4: Testes de integração para bidirectional events

---

### ═══ FASE BI: Novos handlers de cobertura — session.title_changed, session.info, session.snapshot_rewind ═══

**Arquivo**: `src/copilot/observability/event-collector.js` **Prioridade**: 🟡 P2

#### BI.1: session.title_changed

```js
session.on('session.title_changed', (event) => {
  const { title } = event.data;
  if (persist) persistEvent({ type: event.type, sessionId, ts: event.timestamp, title });
  log('INFO', `[event-collector] session title: "${title}"`);
});
```

#### BI.2: session.info

`session.info` cobre categorias como `notification`, `timing`, `context_window`, `mcp`, `snapshot`,
`configuration`, `authentication`, `model`:

```js
session.on('session.info', (event) => {
  const { infoType, message, url } = event.data;
  metrics?.recordCounter(`session.info.${infoType}`);
  if (persist)
    persistEvent({ type: event.type, sessionId, ts: event.timestamp, infoType, message, url });
  log('INFO', `[event-collector] session.info [${infoType}]: ${message}`);
});
```

#### BI.3: session.snapshot_rewind

```js
session.on('session.snapshot_rewind', (event) => {
  const { upToEventId, eventsRemoved } = event.data;
  metrics?.recordCounter('session.snapshot_rewind');
  metrics?.recordCounter('events.removed_by_rewind', eventsRemoved);
  if (persist)
    persistEvent({ type: event.type, sessionId, ts: event.timestamp, upToEventId, eventsRemoved });
  log('INFO', `[event-collector] snapshot_rewind: removed ${eventsRemoved} events`);
});
```

#### BI.4: session.workspace_file_changed

```js
session.on('session.workspace_file_changed', (event) => {
  const { path, operation } = event.data;
  metrics?.recordCounter(`workspace_file.${operation}`);
  if (persist) persistEvent({ type: event.type, sessionId, ts: event.timestamp, path, operation });
  log('DEBUG', `[event-collector] workspace_file ${operation}: ${path}`);
});
```

---

### ═══ FASE BJ: Novos handlers — system.message + comando completion ═══

**Arquivo**: `src/copilot/observability/event-collector.js` **Prioridade**: 🟡 P2

#### BJ.1: system.message (sem persistir content — PII/privacidade)

```js
session.on('system.message', (event) => {
  const { role, name, metadata } = event.data;
  // NÃO persistir content (pode conter dados sensíveis/instruções privadas)
  metrics?.recordCounter(`system.message.${role}`);
  if (persist)
    persistEvent({
      type: event.type,
      sessionId,
      ts: event.timestamp,
      role,
      name,
      hasMetadata: !!metadata,
      promptVersion: metadata?.promptVersion ?? null,
    });
  log('DEBUG', `[event-collector] system.message [${role}]${name ? ` name=${name}` : ''}`);
});
```

#### BJ.2: command.completed e exit_plan_mode.completed (correlação com pendentes)

```js
session.on('command.completed', (event) => {
  const { requestId } = event.data;
  metrics?.recordCounter('command.completed');
  if (persist) persistEvent({ type: event.type, sessionId, ts: event.timestamp, requestId });
});

session.on('exit_plan_mode.completed', (event) => {
  const { requestId } = event.data;
  metrics?.recordCounter('exit_plan_mode.completed');
  if (persist) persistEvent({ type: event.type, sessionId, ts: event.timestamp, requestId });
});
```

#### BJ.3: external_tool.completed

```js
session.on('external_tool.completed', (event) => {
  const { requestId } = event.data;
  metrics?.recordCounter('external_tool.completed');
  if (persist) persistEvent({ type: event.type, sessionId, ts: event.timestamp, requestId });
  log('DEBUG', `[event-collector] external_tool.completed requestId=${requestId}`);
});
```

#### BJ.4: commands.changed

```js
session.on('commands.changed', (event) => {
  const { commands } = event.data;
  metrics?.recordCounter('commands.changed');
  log('INFO', `[event-collector] commands.changed: ${commands.length} commands registered`);
  // Não persistir por padrão (alta frequência, dados estruturais não operacionais)
});
```

#### BJ.5: pending_messages.modified

```js
session.on('pending_messages.modified', (_event) => {
  metrics?.recordCounter('pending_messages.modified');
  // Ephemeral: não persistir
});
```

---

### ═══ FASE BK: assistant.reasoning — handler completo ═══

**Arquivo**: `src/copilot/observability/event-collector.js` **Prioridade**: 🟡 P2

`assistant.reasoning` contém o chain-of-thought completo do modelo. Tem alto valor para debugging
mas risco de volume de dados. Implementar com controles:

```js
session.on('assistant.reasoning', (event) => {
  const { reasoningId, content } = event.data;
  metrics?.recordCounter('assistant.reasoning');
  metrics?.recordCounter('assistant.reasoning.chars', content?.length ?? 0);
  // Persistir APENAS metadados por default (content pode ser grande)
  if (persist && persistTypes.includes(event.type)) {
    persistEvent({
      type: event.type,
      sessionId,
      ts: event.timestamp,
      reasoningId,
      contentLength: content?.length ?? 0,
      // NÃO persistir content por default — configurável via captureAssistantContent
      ...(captureAssistantContent ? { content } : {}),
    });
  }
  log(
    'DEBUG',
    `[event-collector] assistant.reasoning ${reasoningId}: ${content?.length ?? 0} chars`,
  );
});
```

---

### ═══ FASE BL: GAP-02 — Ciclo de vida do AlwaysAliveAgent no defaultAuditLog ═══

Ver Fase BG.

---

### ═══ FASE BM: GAP-03 — agent-event-observer propaga erros para ErrorTracker ═══

**Arquivo**: `src/copilot/observability/agent-event-observer.js` **Prioridade**: 🟡 P1

#### BM.1: Adicionar chamada a errorTracker.trackError em task.error

```js
_onTaskError(data) {
    const { taskId, error } = data ?? {};
    this._errorTracker?.trackError({
        errorType: 'task.error',
        message: typeof error === 'string' ? error : error?.message ?? 'unknown',
        context: { taskId },
    });
    this._metrics?.recordSessionError();
}
```

#### BM.2: Adicionar chamada em dialog.turn_timeout

```js
_onTurnTimeout(data) {
    const { sessionId, turnId } = data ?? {};
    this._errorTracker?.trackError({
        errorType: 'dialog.turn_timeout',
        message: `Dialog turn timed out`,
        context: { sessionId, turnId },
    });
    this._metrics?.recordSessionError();
}
```

---

### ═══ FASE BN: GAP-05 — Incluir métricas de telemetria no status-snapshot ═══

**Arquivo**: `src/copilot/agent/status-snapshot.js` **Prioridade**: 🟢 P3

#### BN.1: Incluir dados do defaultMetrics no snapshot

```js
// Em getStatusSnapshot(), adicionar:
const metricsSnapshot = defaultMetrics?.getSnapshot?.() ?? null;
const errorSummary = defaultErrorTracker?.getSummary?.() ?? null;
return {
  // ... campos existentes ...
  telemetry: {
    metrics: metricsSnapshot,
    recentErrors: errorSummary?.recent ?? [],
    eventsCaptures: defaultEventCollector?.getStats?.() ?? null,
  },
};
```

---

### ═══ FASE BO: GAP-07 — webhook-manager integração com audit ═══

**Arquivo**: `src/copilot/agent/webhook-manager.js` **Prioridade**: 🟢 P3

#### BO.1: Registrar dispatches e falhas de webhook no defaultAuditLog

#### BO.2: Emitir contador de webhook dispatches no MetricsStore

---

### ═══ FASE BP: GAP-08 — reconnect-policy métricas no MetricsStore ═══

**Arquivo**: `src/copilot/agent/reconnect-policy.js` **Prioridade**: 🟢 P3

#### BP.1: Registrar tentativas de reconexão no MetricsStore

```js
// Em cada tentativa de reconexão:
defaultMetrics?.recordCounter?.('reconnect.attempt');
// Em sucesso:
defaultMetrics?.recordCounter?.('reconnect.success');
// Em falha final:
defaultMetrics?.recordCounter?.('reconnect.exhausted');
```

---

### ═══ FASE BQ: Consolidação dos sistemas de auditoria — tool-audit.jsonl ═══

**Arquivos**: `audit-log.js`, `tool-audit-logger.js` **Prioridade**: 🟡 P1 — dois sistemas
escrevendo para o mesmo arquivo sem coordenação

#### BQ.1: Análise de uso atual

- `tool-audit-logger.js:logToolAudit()` → escreve quando o `permission-controller` aprova/rejeita
- `audit-log.js:recordToolStart/Complete()` → escreve quando task-executor executa tool (via BUG-03)
- `event-collector.js` → escreve no `globalAuditBuffer` → `hooks/audit.js` → `tool-audit.jsonl`

Após correção do BUG-03 (Fase BC), apenas dois writers restam para `tool-audit.jsonl`:

1. `tool-audit-logger.js` — decisões de permissão (pré-execução)
2. `event-collector.js` via `globalAuditBuffer` — resultado de execução (pós-execução)

Isso é desejável: as duas fontes são complementares. Mas devem usar um schema unificado.

#### BQ.2: Definir schema unificado para tool-audit.jsonl

```js
/**
 * @typedef {object} ToolAuditEntry
 * @property {'permission_decision' | 'execution_result'} phase
 * @property {string} ts
 * @property {string} toolName
 * @property {string | null} toolCallId
 * @property {string | null} mcpServerName
 * @property {Record<string, unknown>} [toolArgs]
 * @property {'allow' | 'deny' | 'escalate'} [decision] // para phase=permission_decision
 * @property {boolean} [success] // para phase=execution_result
 * @property {number} [durationMs] // para phase=execution_result
 */
```

#### BQ.3: Atualizar `logToolAudit` para incluir campo `phase: 'permission_decision'`

#### BQ.4: Atualizar `globalAuditBuffer.push()` para incluir campo `phase: 'execution_result'`

---

### ═══ FASE BR: Consolidação de eventos legados — remover hooks/audit.js createAuditPostToolHandler ═══

**Arquivo**: `src/copilot/hooks/audit.js` **Prioridade**: 🟢 P3 (após BQ)

#### BR.1: Verificar zero usos em produção

```bash
rg "createAuditPostToolHandler" src/ --include "*.js"
```

#### BR.2: Remover função (apenas se zero usos em produção)

#### BR.3: Verificar `AuditRingBuffer` — se ainda usada em outro contexto, manter

---

### ═══ FASE BS: Remover session-hooks.js @deprecated ═══

**Arquivo**: `src/copilot/agent/session-hooks.js` **Prioridade**: 🟢 P3

#### BS.1: Verificar importadores

```bash
rg "session-hooks" src/ tests/ --include "*.js"
```

#### BS.2: Migrar qualquer importador para `#copilot/hooks/session` diretamente

#### BS.3: Remover arquivo após zero importadores confirmados

---

### ═══ FASE BT: W3C Trace Context — conectar external_tool.requested com otel.js ═══

**Arquivos**: `event-collector.js`, `otel.js` **Prioridade**: 🟢 P3

#### BT.1: Extrair traceparent/tracestate de `external_tool.requested`

```js
session.on('external_tool.requested', (event) => {
  const { requestId, toolName, toolCallId, traceparent, tracestate } = event.data;
  // Usar o trace context do SDK com o sistema OTel local
  if (traceparent) {
    startSpanWithRemoteContext(
      traceparent,
      tracestate,
      `external_tool.${toolName}`,
      async (span) => {
        span?.setAttribute('requestId', requestId);
        span?.setAttribute('toolCallId', toolCallId ?? 'unknown');
      },
    );
  }
  // ... resto do handler ...
});
```

---

### ═══ FASE BU: Testes abrangentes de integração ═══

**Prioridade**: 🟡 P1 — garantia de qualidade após todas as correções

#### BU.1: Testes unitários para cada fix de bug (BA-BD)

#### BU.2: Testes de integração para fluxo dual pipeline (event-collector + session-event-wirer)

#### BU.3: Verificar que SSE consumers recebem tool events durante task processing (BC.4)

#### BU.4: Teste de carga para KNOWN_SDK_EVENTS expandido (sem DEBUG spam)

#### BU.5: Teste de concorrência para \_turnStarts multi-turno (BB.4)

---

### ═══ FASE BV: Commit + push de todas as correções ═══

#### BV.1: Rodar quality gates completos

```bash
npm run test:unit # ≥2049 pass, 0 fail
npm run test:integration
npm run lint
npm run typecheck:node
npm run format:check
```

#### BV.2: Commit com escopo correto

```
fix(copilot): corrigir bugs críticos de telemetria e duplicação de eventos

- Expand KNOWN_SDK_EVENTS (BUG-01) — 9→84 entradas, elimina DEBUG spam
- Fix _turnStarts com chave dinâmica por turnId (BUG-02)
- Remover triple-fire de tool events via task-executor (BUG-03)
- Corrigir naming dot→underscore em task-executor (BUG-04 parte)
- Remover guard !isProcessing() de tool events no wirer (BUG-04 parte)
- Unificar assistant.usage entre wirer e collector (BUG-05)
- Corrigir allowAll segurança em hooks-audit-preset (BUG-06)
- Completar AGENT_EVENTS com 20+ entradas ausentes (GAP-01)
- Integrar AlwaysAliveAgent com defaultAuditLog (GAP-02)
- Propagar erros task.error/turn_timeout para ErrorTracker (GAP-03)
- Novos handlers: session.title_changed, session.info, session.snapshot_rewind,
  session.workspace_file_changed, system.message, command.queued/completed,
  commands.changed, exit_plan_mode.completed, external_tool.completed,
  pending_messages.modified, assistant.reasoning (GAP cobertura SDK)
- Bidirectional events: respondToExternalTool, respondToQueuedCommand,
  respondToExitPlanMode (conformidade obrigatória SDK)
```

---

## 17. Prioridade de Execução — Ciclo 2

| Prioridade | Fase | Título                                        | Urgência                             |
| ---------- | ---- | --------------------------------------------- | ------------------------------------ |
| 🔴 P0      | BA   | Expandir KNOWN_SDK_EVENTS                     | Elimina spam imediato em produção    |
| 🔴 P0      | BB   | Fix \_turnStarts com turnId dinâmico          | Corrupção silenciosa de métricas     |
| 🔴 P0      | BC   | Remover triple-fire de tool events            | Duplicação de dados + race condition |
| 🔴 P0      | BE   | Auditar allowAll em hooks-audit-preset        | Risco de segurança                   |
| 🔴 P0      | BH   | Bidirectional events — respostas obrigatórias | SDK pode travar aguardando resposta  |
| 🟡 P1      | BD   | Unificar assistant.usage wirer/collector      | Duplicação de lógica de billing      |
| 🟡 P1      | BF   | Completar AGENT_EVENTS                        | Contrato de tipo incompleto          |
| 🟡 P1      | BG   | Integrar ciclo de vida com defaultAuditLog    | Rastreabilidade de reconexões        |
| 🟡 P1      | BM   | Propagar erros para ErrorTracker              | Completude de observabilidade        |
| 🟡 P1      | BQ   | Consolidar schema tool-audit.jsonl            | Schema inconsistente entre writers   |
| 🟡 P2      | BI   | Novos handlers de cobertura (title/info/snp)  | Completar mapa de eventos            |
| 🟡 P2      | BJ   | system.message + command completion           | Rastreabilidade de sistema           |
| 🟡 P2      | BK   | assistant.reasoning handler                   | Chain-of-thought observável          |
| 🟢 P3      | BN   | Métricas no status-snapshot                   | Dashboard enriquecido                |
| 🟢 P3      | BO   | webhook-manager integração com audit          | Rastreabilidade de webhooks          |
| 🟢 P3      | BP   | reconnect-policy métricas                     | Diagnóstico de conectividade         |
| 🟢 P3      | BR   | Remover createAuditPostToolHandler            | Limpeza de código legado             |
| 🟢 P3      | BS   | Remover session-hooks.js                      | Limpeza de re-export obsoleto        |
| 🟢 P3      | BT   | W3C Trace Context com otel.js                 | Rastreamento fim-a-fim               |
| 🔵 P4      | BU   | Testes abrangentes de integração              | Garantia de qualidade pós-correções  |
| 🔵 P4      | BV   | Commit + push final Ciclo 2                   | Preservação dos resultados           |

---

## 18. Visão Target — Pós Ciclo 2 (Fases BA-BV)

```
SDK session.on(~90 tipos)
         │
         ├─── [event-collector.js — 65+ handlers] ─────────────────────────────────────────┐
         │    Todos os 70+ eventos SDK cobertos (exceto ephemeral streaming)                │
         │    Bidirectional events respondem corretamente ao SDK                            │
         │    Schema unificado de tool-audit.jsonl                                          │
         │    W3C Trace Context integrado com otel.js                                       │
         │    ↓                                                                             │
         │    MetricsStore ← 50+ contadores / gauges                                        │
         │    ErrorTracker ← task.error + turn_timeout + session.error                      │
         │    HookBus → AGENT_EVENTS (70+ entradas, sem ausências)                          │
         │    globalAuditBuffer → tool-audit.jsonl (schema unificado)                       │
         │    events.jsonl (70+ tipos, DEFAULT_PERSIST_TYPES completo)                      │
         │                                                                                  │
         ├─── [session-event-wirer.js] ───────────────────────────────────────────────────┐│
         │    KNOWN_SDK_EVENTS expandido (sem DEBUG spam)                                  ││
         │    Tool events sem guard !isProcessing()                                        ││
         │    assistant.usage: handle dedicado (sem wildcard)                              ││
         │    ↓                                                                            ││
         │    AGENT EventEmitter → SSE consumers / NERV                                   ││
         │                                                                                 ││
         ├─── [task-executor.js] ─────────────────────────────────────────────────────────┘│
         │    Sem chamadas redundantes a defaultAuditLog                                   │
         │    Naming unificado: tool.execution_start (underscore)                          │
         │    ↓                                                                            │
         │    AGENT EventEmitter (SSE para tool events durante processamento)              │
         │                                                                                 │
         ├─── [always-alive.js] ────────────────────────────────────────────────────────┐  │
         │    Registra ciclo de vida no defaultAuditLog (start/stop/reconnect)           │  │
         │                                                                               │  │
         └─── [agent-event-observer.js] ───────────────────────────────────────────────┐│  │
              _turnStarts por turnId (sem 'current' estático)                          ││  │
              task.error propaga para ErrorTracker                                     └┘  │
              dialog.turn_timeout propaga para ErrorTracker                               │
                                                                                          │
         └─── [persistEvent()] ────────────────────────────────────────────────────────────┘
                    │
                    └─→ logs/events.jsonl (DEFAULT_PERSIST_TYPES, 70+ tipos)
```

---

**AUDITORIA CICLO 2 — FIM** _Última atualização: 2026-05-28_ _Próxima revisão recomendada: após
execução das Fases BA-BV_

---

## 19. Execução Ciclo 2 — Registro de Progresso

### ✅ Fase BA — KNOWN_SDK_EVENTS expandido (CONCLUÍDA)

**Arquivo**: `src/copilot/agent/session-event-wirer.js`

**Mudança**: Expandiu `KNOWN_SDK_EVENTS` de 9 para 70+ entradas, cobrindo todos os eventos
gerenciados pelo `event-collector.js`, `task-executor.js` e `session-event-wirer.js`. Adicionou
comentários organizados por subsistema. Elimina spam DEBUG para eventos normais do SDK.

**Efeito**: O catch-all agora só emite `WARN` para eventos genuinamente desconhecidos — detecção
proativa de novas versões do SDK.

---

### ✅ Fase BB — `_turnStarts` por turnId dinâmico (CONCLUÍDA)

**Arquivo**: `src/copilot/observability/agent-event-observer.js`

**Bug corrigido**: Chave estática `'current'` corrompia durações quando múltiplos turnos corriam
concorrentemente. Agora usa `evt.turnId ?? 'current'` como chave dinâmica.

**Melhorias adicionais**:

- Troca `Date.now()` por `performance.now()` para precisão sub-milissegundo
- Limpeza por TTL (5 minutos) para prevenir memory leak em entradas abandonadas
- Log de warning quando `turnId` está ausente para retrocompatibilidade detectável
- `dialog.turn_end` faz cleanup imediato da entrada após consumo

---

### ✅ Fase BC — Remover guard `isProcessing()` nos tool events (CONCLUÍDA)

**Arquivo**: `src/copilot/agent/session-event-wirer.js`

**Bug corrigido**: `_wireModeAndToolEvents` descartava silenciosamente
`tool.execution_start/complete` quando `isProcessing() === true` — ou seja, durante toda task ativa.
SSE consumers (NERV/UI) nunca recebiam tool events durante processamento normal.

**Mudança**: Removido o guard; tool events agora sempre chegam ao AGENT EventEmitter. Separado
handler dedicado `_wireUsageEvent` para `assistant.usage` (que antes estava misturado no catch-all
wildcard).

---

### ✅ Fase BD — Separar `_wireCatchAll` do billing handler (CONCLUÍDA)

**Arquivo**: `src/copilot/agent/session-event-wirer.js`

**Mudança**: Extraída nova função `_wireUsageEvent()` para handler dedicado de `assistant.usage`. O
`_wireCatchAll` agora é exclusivo para detecção de eventos desconhecidos — sem lógica de negócio
misturada. `wireSessionEvents()` atualizado para chamar os dois.

---

### ✅ Fase BE — Segurança em `hooks-audit-preset.js` (CONCLUÍDA)

**Arquivo**: `src/copilot/observability/hooks-audit-preset.js`

**Bug de segurança corrigido**: A função `createHooksAuditPreset()` hardcodava `allowAll: true` no
`createPermissionHandler`, aprovando silenciosamente todas as ferramentas em qualquer contexto.

**Mudança**: Assinatura expandida para aceitar
`options = { allowAll?: boolean, permissionHandler? }`. Padrão seguro (`allowAll: false`). Para
testes, requer `allowAll: true` explícito. Warning de segurança emitido se `allowAll: true` fora de
`NODE_ENV=test`.

---

### ✅ Fase BF — Novos handlers no `event-collector.js` (CONCLUÍDA)

**Arquivo**: `src/copilot/observability/event-collector.js`

**11 novos handlers adicionados**:

| Evento                           | Dados persistidos                                      |
| -------------------------------- | ------------------------------------------------------ |
| `assistant.reasoning`            | `reasoningId`, `contentLength`                         |
| `session.title_changed`          | `title`                                                |
| `session.workspace_file_changed` | `path`, `operation`                                    |
| `system.message`                 | `role`, `promptVersion` (via `metadata.promptVersion`) |
| `pending_messages.modified`      | contador apenas (efêmero)                              |
| `exit_plan_mode.completed`       | `requestId`                                            |
| `external_tool.completed`        | `requestId`                                            |
| `command.queued`                 | `requestId`                                            |
| `command.completed`              | `requestId`                                            |
| `commands.changed`               | contador apenas                                        |
| `tool.execution_partial_result`  | contador apenas (streaming)                            |

**`DEFAULT_PERSIST_TYPES`** expandido com os novos tipos.

---

### ✅ Fase BG — Unificação de naming dot→underscore (CONCLUÍDA)

**Arquivos**: `src/copilot/agent/events.js`, `src/copilot/bridges/nerv-bridge.js`,
`src/copilot/agent/task-executor.js`, `src/copilot/agent/session-event-wirer.js`

**Bug crítico corrigido**: O `AGENT_EVENTS` declarava `tool.execution.start` e
`tool.execution.complete` (com dois dots), mas o SDK e os handlers novos emitiam
`tool.execution_start` e `tool.execution_complete` (underscore após `execution`). O `nerv-bridge.js`
subscreva nomes antigos → nunca recebia tool events.

**Mudança**: Todos os nomes canônicos atualizados para `tool.execution_start` /
`tool.execution_complete`. Documentado na descrição do `AGENT_EVENTS`.

---

### ✅ Fase BM — ErrorTracker em `dialog.turn_timeout` e `task.error` (CONCLUÍDA)

**Arquivo**: `src/copilot/observability/agent-event-observer.js`

**Gaps corrigidos**:

- `dialog.turn_timeout`: agora propaga para `ErrorTracker` com contexto `phase` e `timeoutMs`
- `task.error`: adicionado `metrics.recordSessionError()` para contabilidade correta
- `task.error`: corrigido null-check de `evt?.error` para consistência com `session.fatal`

---

### Resultado da Execução Ciclo 2

| Fase | Status | Arquivo(s)                                    |
| ---- | ------ | --------------------------------------------- |
| BA   | ✅     | session-event-wirer.js                        |
| BB   | ✅     | agent-event-observer.js                       |
| BC   | ✅     | session-event-wirer.js                        |
| BD   | ✅     | session-event-wirer.js                        |
| BE   | ✅     | hooks-audit-preset.js                         |
| BF   | ✅     | event-collector.js                            |
| BG   | ✅     | events.js + nerv-bridge.js + task-executor.js |
| BM   | ✅     | agent-event-observer.js                       |

**Testes**: 2049 pass, 0 fail (baseline mantido) **Lint**: 0 errors (1 warning pré-existente em
arquivo externo) **Typecheck**: 0 errors **Commit**: Pendente (Template G pré-autorização)

---

## Ciclo 3 — Investigação Profunda + Integração Total AGENT_EVENTS (2026-05-30)

### 3.1 Achados da Investigação de Integração

**Classificação definitiva dos 86 discriminants SDK** (obtida via análise de
`@github/copilot-sdk/dist/generated/session-events.d.ts`):

| Categoria                       | Count | Exemplos                                                               | Ação necessária             |
| ------------------------------- | ----- | ---------------------------------------------------------------------- | --------------------------- |
| Eventos top-level reais         | ~57   | session.start, assistant.message, tool.execution_start…                | `session.on()`              |
| Content-type discriminants      | 12    | audio, blob, directory, file, image, resource, text…                   | Nenhuma                     |
| `system.notification.kind.type` | 4     | agent_completed, agent_idle, shell_completed, shell_detached_completed | Via handler da notification |
| Tool-call type discriminant     | 1     | `function` (em `tool.execution_start.data.calls[].type`)               | Nenhuma                     |

**Content-type discriminants (NÃO precisam de `session.on()`)**: `audio`, `blob`, `directory`,
`file`, `github_reference`, `image`, `object`, `resource`, `resource_link`, `selection`, `terminal`,
`text` — aparecem dentro de blocos `result.contents[]`, não como eventos de sessão.

### 3.2 Eventos Top-Level Não Cobertos pelo event-collector

| Evento                      | Schema                                                     | Valor           | Prioridade                        |
| --------------------------- | ---------------------------------------------------------- | --------------- | --------------------------------- |
| `assistant.streaming_delta` | `{totalResponseSizeBytes: number}` (ephemeral)             | Gauge streaming | 🟡 Médio — já em KNOWN_SDK_EVENTS |
| `session.snapshot_rewind`   | `{upToEventId: string, eventsRemoved: number}` (ephemeral) | Timeline        | 🟡 Médio                          |
| `session.info`              | `{infoType: string, message: string, url?: string}`        | Diagnóstico     | 🟡 Médio                          |
| `commands.changed`          | `{commands: [{name, description?}][]}` (ephemeral)         | Contador        | 🟢 Baixo                          |

### 3.3 Gaps no agent-event-observer.js

O `agent-event-observer.js` monitora apenas **9 de 36 AGENT_EVENTS**:

**Monitorados atualmente**: `dialog.turn_start`, `dialog.turn_end`, `dialog.stalled`,
`dialog.turn_timeout`, `task.completed`, `task.error`, `permission.mode_changed`, `session.fatal`,
`pr.fallback_model`

**Gaps de alto valor**:

| Evento AGENT                   | Origem                 | Gap                                              |
| ------------------------------ | ---------------------- | ------------------------------------------------ |
| `tool.execution_start`         | task-executor.js       | Nenhuma métrica de início de ferramenta          |
| `tool.execution_complete`      | task-executor.js       | Nenhuma métrica de término/duração de ferramenta |
| `agent.metrics`                | always-alive.js (20s)  | Snapshot periódico perdido para observability    |
| `pr.consumed`                  | session-event-wirer.js | Consumo de tokens não contabilizado no observer  |
| `session.mode_changed`         | session-event-wirer.js | Mudança de modo sem registro no observer         |
| `session.token_budget_warning` | session-event-wirer.js | Aviso de budget sem handler no observer          |
| `session.usage`                | session-event-wirer.js | Usage stats semelhante não agregado              |
| `task.queued` / `task.started` | task-manager.js        | Ciclo completo de tarefa incompleto              |

**Gaps de médio valor**:

- `dialog.paused` / `dialog.resumed` / `dialog.loop.changed` — estado de diálogo sem rastreamento
- `context:compacted` — compactação de contexto não monitorada
- `session.compaction_start` / `session.compaction_complete` — auditoria de compaction incompleta

### 3.4 Eventos system.notification não propagados para AGENT_EVENTS

O handler `system.notification` do `event-collector.js` captura e registra `agent_completed`,
`agent_idle`, `shell_completed`, `shell_detached_completed` mas **não emite eventos AGENT_EVENTS**
correspondentes. Isso significa que o nerv-bridge e outros consumidores do EventEmitter do agente
**nunca ficam sabendo** de conclusões de agentes background ou shells.

Schemas de `system.notification.data.kind`:

```
agent_completed:         {agentId, agentType, status: 'completed'|'failed', description?, prompt?}
agent_idle:              {agentId, agentType, description?}
shell_completed:         {shellId, exitCode?, description?}
shell_detached_completed:{shellId, description?}
```

### 3.5 Análise: nerv-bridge vs AGENT_EVENTS — Eventos Ausentes

10 eventos do `AGENT_EVENTS` **não são roteados** pelo `nerv-bridge` para o NERV:

| Evento                       | Consumidores Atuais             | Deve ir para NERV?          |
| ---------------------------- | ------------------------------- | --------------------------- |
| `agent.metrics`              | Nenhum consumidor externo       | ✅ Sim — snapshot periódico |
| `dialog.loop.changed`        | terminal/index.js via SSE       | ✅ Sim — estado de diálogo  |
| `dialog.paused` / `.resumed` | Nenhum consumidor externo       | ✅ Sim — pausa/retomada     |
| `dialog.turn_start` / `_end` | agent-event-observer.js apenas  | ✅ Sim — métrica de turn    |
| `dialog.turn_timeout`        | agent-event-observer.js apenas  | ✅ Sim — timeout crítico    |
| `permission.mode_changed`    | agent-event-observer.js apenas  | ✅ Sim — segurança          |
| `pr.consumed`                | Nenhum consumidor externo       | ✅ Sim — billing crítico    |
| `pr.fallback_model`          | nerv-bridge faltando + observer | ✅ Sim — model fallback     |

### 3.6 Avaliação TSServer (Fase BK)

O TSServer local da stack (`npm run lsp:health`) requer o servidor Express ativo na porta 3008 para
funcionar. Em contexto de investigação isolada, não está disponível. Alternativas avaliadas:

| Abordagem               | Resultado                                                     |
| ----------------------- | ------------------------------------------------------------- |
| `npm run lsp:health`    | ❌ servidor offline → lsp_functional_ok=false                 |
| Grep/regex nos `.d.ts`  | ✅ Funcional e confiável para extrair schemas do SDK          |
| `vscode_listCodeUsages` | ✅ Disponível via Copilot MCP — útil para rastrear chamadores |
| Python regex no `.d.ts` | ✅ Melhor abordagem para blocos de tipo complexos             |

**Conclusão**: Para investigação de SDK, a abordagem ideal é Python regex direto nos `.d.ts` do
`node_modules/@github/copilot-sdk/dist/generated/`. O TSServer local é valioso para diagnósticos em
runtime mas requer o servidor ativo. Não há impedimento para implementação.

---

## Plano de Execução — Ciclo 3 (Fases BH–BN)

### ✅ Fase BH — 4 handlers faltantes em event-collector.js

**Arquivo**: `src/copilot/observability/event-collector.js`

**Eventos a adicionar**:

| Evento                      | Ação                                                             |
| --------------------------- | ---------------------------------------------------------------- |
| `assistant.streaming_delta` | `metrics.recordGauge('streaming.responseSize', total)` + counter |
| `session.snapshot_rewind`   | persist `{upToEventId, eventsRemoved}` + log INFO                |
| `session.info`              | persist `{infoType, message}` + log por infoType                 |
| `commands.changed`          | counter apenas (lista de comandos registrados muda pouco)        |

### ✅ Fase BI — agent-event-observer.js: tool.execution_start/complete

**Arquivo**: `src/copilot/observability/agent-event-observer.js`

Adicionar handlers para `tool.execution_start` e `tool.execution_complete`:

- start: `metrics.recordCounter('tool.execution.start')` + log DEBUG
- complete: `metrics.recordCounter('tool.execution.complete')` + duration gauge se `evt.durationMs`

### ✅ Fase BJ — system.notification → emitir AGENT_EVENTS

**Arquivo**: `src/copilot/observability/event-collector.js` (handler `system.notification`)

Após capturar `kind.type`, emitir via `callbacks.emit()`:

- `agent_completed` → emit `'agent.background.completed'` com `{agentId, agentType, status}`
- `agent_idle` → emit `'agent.background.idle'` com `{agentId, agentType}`
- `shell_completed` → emit `'agent.shell.completed'` com `{shellId, exitCode}`
- `shell_detached_completed` → emit `'agent.shell.detached_completed'` com `{shellId}`

Adicionar os 4 novos eventos ao `AGENT_EVENTS` em `events.js`.

### ✅ Fase BK — nerv-bridge: adicionar eventos ausentes de alto valor

**Arquivo**: `src/copilot/bridges/nerv-bridge.js`

Adicionar ao `AGENT_EVENT_MAP`:

- `pr.consumed` → `'COPILOT_PR_CONSUMED'`
- `agent.metrics` → `'COPILOT_AGENT_METRICS'`
- `dialog.turn_start` → `'COPILOT_TURN_START'`
- `dialog.turn_end` → `'COPILOT_TURN_END'`
- `dialog.turn_timeout` → `'COPILOT_TURN_TIMEOUT'`
- `permission.mode_changed` → `'COPILOT_MODE_CHANGED'`
- `dialog.paused` → `'COPILOT_DIALOG_PAUSED'`
- `dialog.resumed` → `'COPILOT_DIALOG_RESUMED'`

### ✅ Fase BL — agent-event-observer.js: cobertura de agent.metrics e pr.consumed

**Arquivo**: `src/copilot/observability/agent-event-observer.js`

Adicionar handlers para:

- `agent.metrics` — snapshot periódico do estado do agente → log DEBUG + persist snapshot
- `pr.consumed` — consumo de PR tokens → `metrics.recordCounter('pr.consumed')` + persist

### Ordem de Execução Recomendada

```
BH → BI → BJ → BK → BL → lint/typecheck/test → Template G (commit)
```

### Estimativa de Impacto

| Métrica                     | Antes Ciclo 3 | Após Ciclo 3      |
| --------------------------- | ------------- | ----------------- |
| Eventos SDK cobertos        | ~45/57        | ~57/57 (100%)     |
| AGENT_EVENTS no observer    | 9/36          | ~17/36            |
| AGENT_EVENTS no nerv-bridge | 26/36         | ~34/36            |
| system.notification kinds   | captura só    | captura + propaga |

---

## Resultado da Execução Ciclo 3

| Fase | Status | Arquivo(s)                                                          |
| ---- | ------ | ------------------------------------------------------------------- |
| BH   | ✅     | event-collector.js (4 handlers novos)                               |
| BI   | ✅     | agent-event-observer.js (tool.execution_start/complete)             |
| BJ   | ✅     | session-event-wirer.js (\_wireSystemNotificationEvents) + events.js |
| BK   | ✅     | nerv-bridge.js (+12 entradas no EVENT_MAP)                          |
| BL   | ✅     | agent-event-observer.js (agent.metrics + pr.consumed)               |

**Testes**: 2049 pass, 0 fail (baseline mantido) **Lint**: 0 errors (1 warning pré-existente em
debug-conflicts.mjs) **Typecheck**: 0 errors **Commit**: Pendente (Template G pré-autorização)

### Mudanças acumuladas neste ciclo (diff)

- `event-collector.js`: handlers para `assistant.streaming_delta`, `session.snapshot_rewind`,
  `session.info` (com persist); `session.snapshot_rewind` adicionado ao `DEFAULT_PERSIST_TYPES`
- `agent-event-observer.js`: handlers para `tool.execution_start`, `tool.execution_complete`,
  `agent.metrics`, `pr.consumed`
- `session-event-wirer.js`: nova função `_wireSystemNotificationEvents` que propaga kind types
  (`agent_completed`, `agent_idle`, `shell_completed`, `shell_detached_completed`) como
  AGENT_EVENTS; incluída em `wireSessionEvents`
- `events.js`: 8 novos eventos adicionados (`agent.background.completed`, `agent.background.idle`,
  `agent.shell.completed`, `agent.shell.detached_completed`, `session.title_changed`,
  `session.workspace_file_changed`, `session.info`, `session.snapshot_rewind`,
  `tool.execution_progress`, `system.message`, `pending_messages.modified`,
  `exit_plan_mode.completed`, `external_tool.completed`)
- `nerv-bridge.js`: 12 novas entradas no EVENT_MAP (`pr.consumed`, `pr.fallback_model`,
  `agent.metrics`, `dialog.turn_start/end/timeout`, `dialog.paused/resumed`,
  `permission.mode_changed`, `agent.background.completed/idle`,
  `agent.shell.completed/detached_completed`)

---

## Resultado da Execução Ciclo 3

| Fase | Status | Arquivo(s)                                                          |
| ---- | ------ | ------------------------------------------------------------------- |
| BH   | ✅     | event-collector.js (4 handlers novos)                               |
| BI   | ✅     | agent-event-observer.js (tool.execution_start/complete)             |
| BJ   | ✅     | session-event-wirer.js (\_wireSystemNotificationEvents) + events.js |
| BK   | ✅     | nerv-bridge.js (+12 entradas no EVENT_MAP)                          |
| BL   | ✅     | agent-event-observer.js (agent.metrics + pr.consumed)               |

**Testes**: 2049 pass, 0 fail (baseline mantido) **Lint**: 0 errors (1 warning pré-existente em
debug-conflicts.mjs) **Typecheck**: 0 errors **Commit**: Pendente (Template G pré-autorização)

### Mudanças acumuladas neste ciclo (diff)

- `event-collector.js`: handlers para `assistant.streaming_delta`, `session.snapshot_rewind`,
  `session.info` (com persist); `session.snapshot_rewind` adicionado ao `DEFAULT_PERSIST_TYPES`
- `agent-event-observer.js`: handlers para `tool.execution_start`, `tool.execution_complete`,
  `agent.metrics`, `pr.consumed`
- `session-event-wirer.js`: nova função `_wireSystemNotificationEvents` que propaga kind types
  (`agent_completed`, `agent_idle`, `shell_completed`, `shell_detached_completed`) como
  AGENT_EVENTS; incluída em `wireSessionEvents`
- `events.js`: 8 novos eventos adicionados (`agent.background.completed`, `agent.background.idle`,
  `agent.shell.completed`, `agent.shell.detached_completed`, `session.title_changed`,
  `session.workspace_file_changed`, `session.info`, `session.snapshot_rewind`,
  `tool.execution_progress`, `system.message`, `pending_messages.modified`,
  `exit_plan_mode.completed`, `external_tool.completed`)
- `nerv-bridge.js`: 12 novas entradas no EVENT_MAP (`pr.consumed`, `pr.fallback_model`,
  `agent.metrics`, `dialog.turn_start/end/timeout`, `dialog.paused/resumed`,
  `permission.mode_changed`, `agent.background.completed/idle`,
  `agent.shell.completed/detached_completed`)
