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

**FIM DA AUDITORIA** _Próxima revisão recomendada: após execução das Fases AN-AZ_
