# Telemetria Legada → Observabilidade Nova — Análise e Roadmap de Migração

**Status**: Canônico — Terceira Rodada de Telemetria (pós-commit `ca75d92b`) **Última atualização**:
2026-06-17 **Escopo**: Migração completa dos 4 arquivos legados de telemetria/audit para
`src/copilot/observability/` **Produto final**: deletar `lib/telemetry.js`, `channel/audit.js`,
`hooks/presets/audit.js`; avaliar `agent/status-snapshot.js`

---

## 1. Inventário dos Arquivos Legados

### 1.1 `src/copilot/lib/telemetry.js`

**Propósito original**: Store de telemetria in-memory para rastrear tool calls e sessões SDK.

**Exportações públicas**:

| Função                                        | Assinatura                                           | Propósito                             |
| --------------------------------------------- | ---------------------------------------------------- | ------------------------------------- |
| `createTelemetry(opts?)`                      | `() → TelemetryStore`                                | Factory do store de telemetria        |
| `recordToolCall(store, toolName, data)`       | `(TelemetryStore, string, {...}) → void`             | Registra uma tool call com durationMs |
| `recordSessionStart(store, sessionId, opts?)` | `(TelemetryStore, string, {...}) → void`             | Registra início de sessão             |
| `recordSessionEnd(store, sessionId, opts?)`   | `(TelemetryStore, string, {...}) → boolean`          | Marca sessão como encerrada/error     |
| `getTotalCalls(store)`                        | `(TelemetryStore) → number`                          | Contador total de calls               |
| `getSuccessCount(store)`                      | `(TelemetryStore) → number`                          | Calls com sucesso                     |
| `getErrorCount(store)`                        | `(TelemetryStore) → number`                          | Calls com erro                        |
| `getAverageDuration(store)`                   | `(TelemetryStore) → number`                          | Média de duração em ms                |
| `getCallsByTool(store, toolName)`             | `(TelemetryStore, string) → ToolCallRecord[]`        | Calls de tool específica              |
| `getCallsBySession(store, sessionId)`         | `(TelemetryStore, string) → ToolCallRecord[]`        | Calls de sessão específica            |
| `getRecentCalls(store, n?, opts?)`            | `(TelemetryStore, number, {...}) → ToolCallRecord[]` | Últimas N calls                       |
| `getErrorCalls(store, opts?)`                 | `(TelemetryStore, {...}) → ToolCallRecord[]`         | Apenas calls com erro                 |
| `getSummary(store)`                           | `(TelemetryStore) → {...}`                           | Sumário agregado com p95ByTool        |
| `clearTelemetry(store)`                       | `(TelemetryStore) → void`                            | Limpa o store (para testes)           |
| `startSpan(name, attrs, fn)`                  | `(string, SpanAttrs, () → Promise<T>) → Promise<T>`  | Executa função dentro de span OTEL    |

**Problemas identificados**:

- **GAP-03**: Sistema paralelo ao `MetricsStore` — dados fragmentados entre dois sistemas
- **GAP-10**: `startSpan()` cria `NodeTracerProvider` próprio via `@opentelemetry/sdk-trace-node` —
  pode conflitar com OTEL do SDK
- `TelemetryStore` é um objeto mutable passado por referência entre `AlwaysAliveAgent`,
  `DialogLoopManager`, `DialogTurnExecutor`, `ToolsBootstrap` e `IntrospectionTools` — acoplamento
  excessivo
- Sem persistência — dados perdidos a cada restart
- Sem integração com o novo `MetricsStore`

**Consumidores diretos**:

| Arquivo                         | Uso                                                                                   |
| ------------------------------- | ------------------------------------------------------------------------------------- |
| `lib/index.js`                  | Re-exporta todas as funções via barrel                                                |
| `agent/always-alive.js`         | `createTelemetry()` → `#telemetry`; `get telemetry()` accessor; `startSpan()` no boot |
| `agent/dialog-loop-manager.js`  | Recebe `telemetry` via `attach(host, telemetry)`, passa para executor                 |
| `agent/dialog-turn-executor.js` | `recordToolCall(telemetry, 'dialog.turn', ...)`, `startSpan()`                        |
| `agent/tools-bootstrap.js`      | Recebe `telemetry`, chama `setTelemetryStore(telemetry)` de introspection-tools       |
| `tools/introspection-tools.js`  | `_telemetryStore = store`, `getSummary(store)` na tool `get_telemetry`                |
| `hooks/session-lifecycle.js`    | `recordSessionStart/End(getTelemetry(), sessionId)`                                   |
| `hooks/types.js`                | Typedef `getTelemetry(): TelemetryStore` no `SessionLifecycleContext`                 |
| `routes/agent.js`               | GET /agent/telemetry via `getSummary(telemetry)`, POST /clear via `clearTelemetry`    |

**Nota sobre `startSpan`**: Esta função é genuinamente útil para instrumentar código manual. Deve
ser MOVIDA (não deletada) para `observability/otel.js` onde é complementar ao
`buildTelemetryConfig()`.

---

### 1.2 `src/copilot/channel/audit.js`

**Propósito original**: Auditoria JSONL de tool calls com correlação start/complete.

**Exportações públicas**:

| Função                                                            | Propósito                                     |
| ----------------------------------------------------------------- | --------------------------------------------- |
| `auditToolStart({ toolCallId, toolName, args?, mcpServerName? })` | Registra início de tool call (em `_pending`)  |
| `auditToolComplete({ toolCallId, success, sessionId?, ... })`     | Correlaciona com start, escreve JSONL         |
| `getAuditSummary(sessionId, limit?)`                              | Lê arquivo JSONL e retorna entradas filtradas |

**Mecanismo interno**:

- `_pending: Map<string, {...}>` — correlação toolCallId → dados de início
- `_writeQueue: string[]` — buffer de escritas assíncronas via `setImmediate`
- `scheduleFlush()` — I/O assíncrono em batch
- Arquivo: `src/copilot/logs/tool-audit.jsonl` com rotação por 10MB

**Schema JSONL**:

```json
{
  "ts": "ISO",
  "sessionId": "...",
  "taskId": "...",
  "toolCallId": "...",
  "toolName": "...",
  "mcpServerName": "...",
  "argsSummary": "...",
  "resultSummary": "...",
  "durationMs": 123,
  "success": true
}
```

**Consumidores diretos**:

| Arquivo                  | Uso                                                            |
| ------------------------ | -------------------------------------------------------------- |
| `channel/index.js`       | Re-exporta as 3 funções                                        |
| `agent/task-executor.js` | `auditToolStart/Complete` via `import from '#copilot/channel'` |

**Relação com `audit-log.js` novo**:

- O `audit-log.js` (já implementado nas Fases N-T) tem ring buffer em memória mas NÃO tem:
  - Correlação start/complete com `_pending` Map
  - Escrita em JSONL com batch I/O
  - `getAuditSummary` que lê do arquivo

**Decisão**: O `audit-log.js` deve ser ESTENDIDO com funcionalidade completa de `channel/audit.js` e
o `channel/audit.js` deletado. `task-executor.js` passa a importar de
`#copilot/observability/audit-log`.

---

### 1.3 `src/copilot/hooks/presets/audit.js`

**Propósito original**: Preset de hooks que mantém um audit trail in-memory de todos os eventos de
hook.

**Exportações públicas**:

| Função                | Propósito                                                                          |
| --------------------- | ---------------------------------------------------------------------------------- |
| `createAuditPreset()` | Factory que retorna `{hooks, onPermissionRequest, getAuditTrail, clearAuditTrail}` |

**Mecanismo interno**:

- `trail: AuditEntry[]` — ring buffer próprio em memória (até 5000 entries com LRU trim)
- `AuditEntry: { ts, hookName, sessionId?, summary? }`
- Registra todos os 6 hook events: `onPreToolUse`, `onPostToolUse`, `onUserPromptSubmitted`,
  `onSessionStart`, `onSessionEnd`, `onErrorOccurred`
- Já usa `#copilot/observability/logger` (bom — sem dependência legada de logger)

**Problema**:

- Trail em memória separado do ring buffer de `defaultAuditLog` — dados fragmentados
- Não persiste no JSONL de auditoria
- `createPermissionHandler({ allowAll: true, auditMode: true })` — modo de permissão do preset

**Decisão**: Criar `observability/hooks-audit-preset.js` que usa `defaultAuditLog.record()`
internamente em vez de manter trail separado. Mantém a mesma API pública. Deletar
`hooks/presets/audit.js`.

---

### 1.4 `src/copilot/agent/status-snapshot.js`

**Propósito**: Função pura para construir o snapshot de status do `AlwaysAliveAgent`.

**Exportações públicas**:

- `buildStatusSnapshot(params: SnapshotParams): AgentStatusSnapshot`

**Análise**: Este arquivo é **FUNÇÃO PURA DE INFRAESTRUTURA DO AGENTE**, não telemetria. Não tem
dependências de logger, telemetria ou observabilidade. Não conflita com o novo sistema.

**Consumidores**:

- `agent/always-alive.js` — chama `buildStatusSnapshot()` para construir o snapshot de `getStatus()`
- `agent/index.js` — re-exporta `buildStatusSnapshot`
- `tools/introspection-tools.js` — não usa `buildStatusSnapshot` (só usa `_telemetryStore`)

**Decisão: NÃO MIGRAR. NÃO DELETAR.** `status-snapshot.js` é infrastructure do agente, não
telemetria legada. Permanece em `agent/` onde está. Este arquivo foi investigado e considerado como
fora do escopo de migração de telemetria.

---

## 2. Análise de Impacto na Arquitetura

### 2.1 Acoplamento atual (problema a resolver)

```
AlwaysAliveAgent
  │-- this.#telemetry = createTelemetry()   [lib/telemetry.js]
  │-- startSpan()                            [lib/telemetry.js]
  │
  ├─► DialogLoopManager.attach(host, this.#telemetry)
  │         │
  │         └─► DialogTurnExecutor (telemetry via ctx)
  │                   │-- recordToolCall(telemetry, 'dialog.turn', ...)
  │                   │-- startSpan()
  │
  ├─► bootstrapTools(registry, this.#telemetry, mcpTools)
  │         │
  │         └─► setTelemetryStore(telemetry)
  │                   └─► IntrospectionTools._telemetryStore
  │                             └─► getSummary(store) → get_telemetry tool
  │
  ├─► hooks context: { getTelemetry: () => this.#telemetry }
  │         │
  │         └─► session-lifecycle.js
  │                   │-- recordSessionStart(getTelemetry(), sessionId)
  │                   └─► recordSessionEnd(getTelemetry(), sessionId)
  │
  └─► get telemetry() → routes/agent.js
            ├── GET /agent/telemetry (getSummary)
            └── POST /agent/telemetry/clear (clearTelemetry)
```

### 2.2 Arquitetura alvo (pós-migração)

```
AlwaysAliveAgent
  │-- (sem campo #telemetry)
  │-- import { startSpan } from '#copilot/observability/otel.js'
  │
  ├─► DialogLoopManager.attach(host)    [sem telemetry]
  │         │
  │         └─► DialogTurnExecutor
  │                   │-- (sem recordToolCall direto — já coberto por agentEventObserver)
  │                   │-- startSpan() de '#copilot/observability/otel.js'
  │
  ├─► bootstrapTools(registry, mcpTools)  [sem telemetry]
  │         │
  │         └─► IntrospectionTools
  │                   └─► get_telemetry → defaultMetrics.getSummary()
  │
  ├─► hooks context: (sem getTelemetry)
  │         │
  │         └─► session-lifecycle.js
  │                   │-- defaultMetrics.recordSessionStart()
  │                   └─► defaultMetrics.recordSessionEnd()
  │
  └─► routes/agent.js
            ├── GET /agent/telemetry → defaultMetrics.getSummary()
            └── POST /agent/telemetry/clear → defaultMetrics.reset()


TaskExecutor
  └─► auditToolStart/Complete → defaultAuditLog (de '#copilot/observability/audit-log')


HookBus / SessionHooks
  └─► createHooksAuditPreset() → usa defaultAuditLog internamente
```

---

## 3. Mapa de Migração API-por-API

### 3.1 lib/telemetry.js → observability/

| API legada                                 | Destino novo                                               | Notas                                                                    |
| ------------------------------------------ | ---------------------------------------------------------- | ------------------------------------------------------------------------ |
| `createTelemetry()`                        | **REMOVIDA** — sem substituto direto                       | Componentes internos usam `defaultMetrics` (singleton global)            |
| `recordToolCall(store, name, data)`        | `defaultMetrics.recordToolCall(name, durationMs, success)` | Já existe em `metrics.js`                                                |
| `recordSessionStart(store, sessionId)`     | `defaultMetrics.recordSessionStart()`                      | Já existe em `metrics.js` (sem sessionId — apenas counter)               |
| `recordSessionEnd(store, sessionId, opts)` | `defaultMetrics.recordSessionEnd()`                        | Já existe em `metrics.js`                                                |
| `getSummary(store)`                        | `defaultMetrics.getSummary()`                              | Já existe em `metrics.js` — formato ligeiramente diferente, más completo |
| `clearTelemetry(store)`                    | `defaultMetrics.reset()`                                   | Já existe em `metrics.js`                                                |
| `getTotalCalls(store)`                     | `defaultMetrics.getSummary().tools.totalCalls`             | Via getSummary()                                                         |
| `getSuccessCount(store)`                   | `defaultMetrics.getSummary().tools.successCalls`           | Via getSummary()                                                         |
| `getErrorCount(store)`                     | `defaultMetrics.getSummary().tools.errorCalls`             | Via getSummary()                                                         |
| `getCallsByTool(store, toolName)`          | **SEM substituto de array bruto** — ver nota abaixo        | Dados agregados: `getSummary().tools.byTool[toolName]`                   |
| `getCallsBySession(store, sessionId)`      | **SEM substituto de array bruto**                          | Não necessário para nenhum consumidor real                               |
| `getRecentCalls(store, n)`                 | `defaultAuditLog.getEntries(n, 'tool_use')` (ring buffer)  | audit-log mantém as N entradas mais recentes                             |
| `getErrorCalls(store)`                     | `defaultErrorTracker.getErrors()` (ring buffer)            | errors → error-tracker, não metrics                                      |
| `startSpan(name, attrs, fn)`               | **MOVIDA para `observability/otel.js`**                    | Mesmo código, mesmo comportamento, novo local                            |
| `TelemetryStore` (typedef)                 | **REMOVIDO** — sem substituto de tipo público              | Interno; consumidores externos usam `MetricsStore` via `defaultMetrics`  |

**Nota sobre array bruto**: O `TelemetryStore` armazenava arrays brutos de `ToolCallRecord[]`. O
`MetricsStore` é agregado — não mantém arrays brutos. Esta é uma mudança intencional: dados brutos
não são necessários para nenhum caso de uso crítico atual. A ferramenta `get_telemetry` do agente
passa a retornar estatísticas agregadas em vez de arrays de records.

### 3.2 channel/audit.js → observability/audit-log.js

| API legada                          | Destino novo (audit-log.js)                                | Notas                     |
| ----------------------------------- | ---------------------------------------------------------- | ------------------------- |
| `auditToolStart(entry)`             | `defaultAuditLog.recordToolStart(entry)` (NOVA)            | Adicionar ao audit-log.js |
| `auditToolComplete(entry)`          | `defaultAuditLog.recordToolComplete(entry)` (NOVA)         | Adicionar ao audit-log.js |
| `getAuditSummary(sessionId, limit)` | `defaultAuditLog.getAuditSummary(sessionId, limit)` (NOVA) | Adicionar ao audit-log.js |

**Mudanças internas no audit-log.js**:

- Adicionar `_pending: Map<string, {...}>` para correlação start/complete
- Adicionar `_writeQueue: string[]` + `scheduleFlush()` para JSONL I/O assíncrono
- Unificar JSONL path: usa `src/copilot/logs/tool-audit.jsonl` (mesmo que channel/audit.js)
- O ring buffer em memória JÁ EXISTE — `recordToolComplete` também alimenta o ring buffer

### 3.3 hooks/presets/audit.js → observability/hooks-audit-preset.js

| API legada            | Destino novo                                 | Notas                                    |
| --------------------- | -------------------------------------------- | ---------------------------------------- |
| `createAuditPreset()` | `createHooksAuditPreset()` (NOVO arquivo)    | API compatível; trail → defaultAuditLog  |
| `getAuditTrail()`     | `defaultAuditLog.getEntries()` (via closure) | Ring buffer global em vez de trail local |
| `clearAuditTrail()`   | `defaultAuditLog.clear()` (via closure)      | Limpa o ring buffer global               |

---

## 4. Roadmap de Implementação — Fases U-AA

### Fase U — Mover `startSpan` para `observability/otel.js` + adicionar sessionId a metrics

**Objetivo**: Eliminar `startSpan` de `lib/telemetry.js` e disponibilizá-la no local correto.

**Complexidade**: Baixa — mudança de local, sem mudança de comportamento.

**Sub-tarefas**:

- U.1 Copiar código de `startSpan()` (+ typedefs `SpanAttrs`, `OtelSpan`, `OtelTracer`) para
  `observability/otel.js` — mantendo comportamento idêntico de graceful degradation
- U.2 Exportar `startSpan` de `observability/otel.js`
- U.3 Exportar `startSpan` de `observability/index.js` (barrel)
- U.4 Verificar que `recordSessionStart()` e `recordSessionEnd()` em `metrics.js` são suficientes
  para a migração de `session-lifecycle.js` (sem sessionId no parâmetro — apenas counter)
- U.5 Executar `npm run typecheck:node` — zero erros

### Fase V — Estender `audit-log.js` com funcionalidade completa de `channel/audit.js`

**Objetivo**: `defaultAuditLog` assume toda a responsabilidade de `channel/audit.js`.

**Complexidade**: Média — adicionar I/O, correlação e novo path JSONL.

**Sub-tarefas**:

- V.1 Adicionar `_pending: Map<string, {...}>` ao estado interno de `audit-log.js`
- V.2 Adicionar `recordToolStart(entry)`:
  - Armazena em `_pending` (mesmo schema de `channel/audit.js`)
- V.3 Adicionar `recordToolComplete(entry)`:
  - Correlaciona com `_pending`, calcula `durationMs`
  - Alimenta o ring buffer em memória via `record()`
  - Escreve JSONL via `scheduleFlush()` (batch I/O assíncrono com setImmediate)
- V.4 Adicionar `_writeQueue: string[]` + `scheduleFlush()` (JSONL I/O com rotação)
  - Path: `src/copilot/logs/tool-audit.jsonl` (consistente com channel/audit.js)
  - Rotação: 10 MB → `.1` (idêntico ao channel/audit.js)
- V.5 Adicionar `getAuditSummary(sessionId?, limit?)`:
  - Lê arquivo JSONL + filtra + retorna array
- V.6 Adicionar `recordToolStart` e `recordToolComplete` ao typedef `AuditLog`
- V.7 Exportar `recordToolStart`, `recordToolComplete`, `getAuditSummary` de
  `observability/index.js`
- V.8 Executar `npm run typecheck:node` — zero erros

### Fase W — Criar `observability/hooks-audit-preset.js`

**Objetivo**: Substituto direto de `hooks/presets/audit.js` usando `defaultAuditLog`.

**Complexidade**: Baixa — mesmo lógica, nova localização + usa audit-log.

**Sub-tarefas**:

- W.1 Criar `src/copilot/observability/hooks-audit-preset.js`:
  - `createHooksAuditPreset()` retorna
    `{hooks, onPermissionRequest, getAuditTrail, clearAuditTrail}`
  - Hooks registram via `defaultAuditLog.record()` em vez de trail local
  - `getAuditTrail()` → `defaultAuditLog.getEntries()`
  - `clearAuditTrail()` → `defaultAuditLog.clear()`
  - Mantém `createPermissionHandler({ allowAll: true, auditMode: true })`
  - Já usa `#copilot/observability/logger` (sem mudança)
- W.2 Exportar `createHooksAuditPreset` de `observability/index.js`
- W.3 Atualizar `hooks/index.js`:
  - Substituir `export { createAuditPreset } from './presets/audit.js'`
  - Por
    `export { createHooksAuditPreset as createAuditPreset } from '#copilot/observability/hooks-audit-preset'`
  - (alias de retrocompatibilidade para não quebrar nada)
- W.4 Executar `npm run typecheck:node` — zero erros

### Fase X — Desacoplar `TelemetryStore` dos componentes internos do agente

**Objetivo**: Remover todas as referências a `TelemetryStore` e `createTelemetry` dos componentes do
agente. Este é o trabalho principal e mais complexo desta rodada.

**Complexidade**: Alta — múltiplos arquivos interligados.

#### X.1 — `agent/always-alive.js`

- Remover import de `createTelemetry` e `startSpan` de `#copilot/lib/index`
- Adicionar import de `startSpan` de `#copilot/observability/otel` (novo local)
- Remover campo `#telemetry` e sua recriação em `start()`
- Remover accessor `get telemetry()` (público)
- Remover `getTelemetry: () => this.#telemetry` do contexto de hooks (`this.#createHooksCtx()`)
- Remover passagem de `this.#telemetry` em `this.#dialogLoop.attach(host, this.#telemetry)` →
  `this.#dialogLoop.attach(host)`
- Remover `this.#telemetry` do `bootstrapTools(registry, this.#telemetry, mcpTools)` →
  `bootstrapTools(registry, mcpTools)`

#### X.2 — `agent/dialog-loop-manager.js`

- Remover typedef import de `TelemetryStore`
- Remover campo `#telemetry = null`
- Remover parâmetro `telemetry` de `attach(host, telemetry)` → `attach(host)`
- Remover `this.#telemetry = telemetry`
- Remover `telemetry: this.#telemetry` do contexto passado para `executeTurnImpl()`

#### X.3 — `agent/dialog-turn-executor.js`

- Remover import de `recordToolCall` e `startSpan` de `#copilot/lib/index`
- Adicionar import de `startSpan` de `#copilot/observability/otel`
- Remover `telemetry` do typedef de opções de `buildTurnResolutionListeners`
- Remover `recordToolCall(telemetry, 'dialog.turn', ...)` do handler `turn_end`:
  - **O agentEventObserver já captura `dialog.turn_end` via `AlwaysAliveAgent.emit()`**
  - Remover completamente (dados já chegam via outro caminho)
- Remover `telemetry` do typedef de ctx de `executeTurnImpl`
- Remover verificação `if (!host || !telemetry)` → `if (!host)`
- Atualizar `startSpan()` para usar o import do novo local

#### X.4 — `agent/tools-bootstrap.js`

- Remover typedef import de `TelemetryStore`
- Remover parâmetro `telemetry: TelemetryStore` de `bootstrapTools(registry, telemetry, mcpTools)` →
  `bootstrapTools(registry, mcpTools)`
- Remover chamada `setTelemetryStore(telemetry)`
- Remover import de `setTelemetryStore` de `introspection-tools.js`

#### X.5 — `tools/introspection-tools.js`

- Remover `_telemetryStore`, `setTelemetryStore()` (export público)
- Adicionar import de `defaultMetrics` de `#copilot/observability`
- Atualizar `get_agent_info` tool: `hasTelemetry: true` (sempre true via defaultMetrics)
- Reescrever `get_telemetry` handler:
  - Usar `defaultMetrics.getSummary()` em vez de acesso ao store
  - Usar `defaultAuditLog.getEntries(recent, 'tool_use')` para calls recentes
  - Manter mesma estrutura de resposta mas com dados do novo sistema

#### X.6 — `hooks/session-lifecycle.js`

- Remover import de `recordSessionStart, recordSessionEnd` de `#copilot/lib/index`
- Adicionar import de `defaultMetrics` de `#copilot/observability`
- Substituir `recordSessionStart(getTelemetry(), sessionId)` → `defaultMetrics.recordSessionStart()`
- Substituir `recordSessionEnd(getTelemetry(), sessionId)` → `defaultMetrics.recordSessionEnd()`
- O contexto `ctx.getTelemetry()` já não é mais chamado — mas o campo permanece no typedef por ora
  (será removido no Fase X.7)

#### X.7 — `hooks/types.js`

- Remover `getTelemetry: () => import('#copilot/lib/telemetry').TelemetryStore` do typedef
  `SessionLifecycleContext`
- Importação de `TelemetryStore` deixa de existir neste arquivo

#### X.8 — `routes/agent.js`

- Remover import de `clearTelemetry, getSummary` de `../lib/telemetry.js`
- Adicionar import de `defaultMetrics` de `#copilot/observability`
- Substituir `alwaysAliveAgent.telemetry` por `defaultMetrics`
- Substituir `getSummary(telemetry)` por `defaultMetrics.getSummary()`
- Substituir `clearTelemetry(telemetry)` por `defaultMetrics.reset()`
- Remover `if (!telemetry)` checks — `defaultMetrics` é sempre disponível

#### X.9 — `agent/task-executor.js` (migração de channel/audit.js)

- Substituir import de `{ auditToolStart, auditToolComplete }` de `#copilot/channel` → import de
  `defaultAuditLog` de `#copilot/observability`
- Substituir `auditToolStart({...})` → `defaultAuditLog.recordToolStart({...})`
- Substituir `auditToolComplete({...})` → `defaultAuditLog.recordToolComplete({...})`

### Fase Y — Deletar arquivos legados e limpar barrels

**Objetivo**: Remover permanentemente os arquivos legados e suas referências dos barrels.

**Sub-tarefas**:

- Y.1 Deletar `src/copilot/lib/telemetry.js`
- Y.2 Deletar `src/copilot/channel/audit.js`
- Y.3 Deletar `src/copilot/hooks/presets/audit.js`
- Y.4 Limpar `src/copilot/lib/index.js`:
  - Remover bloco de exports de `#copilot/lib/telemetry` (clearTelemetry, createTelemetry, ...)
- Y.5 Limpar `src/copilot/channel/index.js`:
  - Remover linha `export { auditToolComplete, auditToolStart, getAuditSummary } from './audit.js'`
- Y.6 Limpar `src/copilot/hooks/index.js`:
  - Verificar se `createAuditPreset` ainda é exportado e de qual fonte
  - (Já foi atualizado na Fase W.3 para re-exportar de `observability/hooks-audit-preset`)

### Fase Z — Atualizar testes

**Objetivo**: Garantir que os testes reflitam a nova arquitetura.

**Sub-tarefas**:

- Z.1 `tests/unit/copilot/test_lib_telemetry.spec.js`:
  - Este arquivo testa funções de `lib/telemetry.js` que serão deletadas
  - Converter para testar funcionalidades equivalentes em `observability/metrics.js`:
    - `createTelemetry` → não testado (removido)
    - `recordSessionStart/End` → `defaultMetrics.recordSessionStart/End()`
    - `getSummary` → `defaultMetrics.getSummary()`
    - `clearTelemetry` → `defaultMetrics.reset()`
  - Renomear arquivo para `test_observability_metrics_compat.spec.js` ou adaptar
- Z.2 `tests/unit/copilot/test_hooks_module.spec.js`:
  - Verificar se usa `TelemetryStore` e `createAuditPreset`
  - Atualizar refs conforme necessário
- Z.3 `tests/unit/copilot/test_tool_audit_logger.spec.js`:
  - Verificar se usa `channel/audit.js` — atualizar para `audit-log.js`
- Z.4 `tests/unit/copilot/test_status_snapshot.spec.js`:
  - NÃO ALTERAR — `buildStatusSnapshot` permanece em `agent/status-snapshot.js`
- Z.5 Verificar se há mais testes quebrando após as mudanças:
  - `npm run test:unit` — identificar e corrigir falhas

### Fase AA — Validação Final e Commit

**Objetivo**: Todos os quality gates verdes antes do commit final.

**Sub-tarefas**:

- AA.1 `npm run test:unit` — mínimo 2054 passando
- AA.2 `npm run lint` — zero erros
- AA.3 `npm run typecheck:node` — zero erros
- AA.4 `npm run format:check` — clean (ou aplicar `npx prettier --write`)
- AA.5 Verificar que nenhum import de `#copilot/lib/telemetry` resta no codebase
- AA.6 Verificar que nenhum import de `#copilot/channel/audit.js` resta no codebase
- AA.7 Verificar que nenhum import de `hooks/presets/audit.js` resta no codebase
- AA.8 Commit com mensagem apropriada + push

---

## 5. Tabela de Dependências entre Fases

```
U (startSpan → otel.js)
  └─► independente — pode ser feita primeira

V (audit-log.js estendido)
  └─► independente — pode ser feita em paralelo com U

W (hooks-audit-preset.js)
  └─► depende de V (usa defaultAuditLog)

X (desacoplar TelemetryStore)
  └─► X.1 → X.2 → X.3 → X.4 → X.5 → X.6 → X.7 → X.8 → X.9
  └─► deve ser feita após U (para startSpan novo import path)
  └─► deve ser feita após V (para audit-log.js com recordToolStart/Complete)

Y (deletar arquivos legados)
  └─► depende de X (todos consumidores migrados)
  └─► depende de W (hooks-audit-preset.js criado)

Z (atualizar testes)
  └─► depende de Y (arquivos deletados)

AA (validação final)
  └─► depende de Z
```

---

## 6. Riscos e Mitigações

| Risco                                               | Mitigação                                                                        |
| --------------------------------------------------- | -------------------------------------------------------------------------------- |
| `routes/agent.js` GET /agent/telemetry muda formato | `defaultMetrics.getSummary()` retorna superset — campos novos, mesmos essenciais |
| `get_telemetry` tool retorna formato diferente      | Adaptar estrutura de resposta para ser compatível (totalCalls, topTools, etc.)   |
| `startSpan` no otel.js conflita com SDK OTEL        | Graceful degradation idêntica — `@opentelemetry/sdk-trace-node` é opcional       |
| Testes quebram após remoção de TelemetryStore       | Fase Z detecta e corrige antes do commit final                                   |
| `dialog-turn-executor.js` checa `if (!telemetry)`   | Após Fase X.3, check vira `if (!host)` — comportamento equivalente               |
| `channel/audit.js` tinha JSONL em path diferente    | `audit-log.js` usa mesmo path `src/copilot/logs/tool-audit.jsonl` — sem perda    |

---

## 7. Estado Final do Sistema (pós-migração)

### Arquivos deletados:

- ~~`src/copilot/lib/telemetry.js`~~
- ~~`src/copilot/channel/audit.js`~~
- ~~`src/copilot/hooks/presets/audit.js`~~

### Arquivos novos criados:

- `src/copilot/observability/hooks-audit-preset.js` — substituto de `hooks/presets/audit.js`

### Arquivos estendidos (além das Fases N-T):

- `src/copilot/observability/otel.js` — `startSpan()` adicionado
- `src/copilot/observability/audit-log.js` — `recordToolStart/Complete/getAuditSummary` + JSONL I/O
- `src/copilot/observability/index.js` — novos exports

### Arquivos simplificados:

- `src/copilot/agent/always-alive.js` — -3 imports, -1 campo privado, -1 accessor, simpler attach()
- `src/copilot/agent/dialog-loop-manager.js` — -1 campo privado, -1 parâmetro em attach()
- `src/copilot/agent/dialog-turn-executor.js` — -2 imports, simpler ctx, -1 recordToolCall call
- `src/copilot/agent/tools-bootstrap.js` — -1 parâmetro, -1 setTelemetryStore call
- `src/copilot/tools/introspection-tools.js` — -1 campo módulo, -1 export, `get_telemetry`
  modernizado
- `src/copilot/hooks/session-lifecycle.js` — usa `defaultMetrics` diretamente
- `src/copilot/hooks/types.js` — remove `getTelemetry` do typedef
- `src/copilot/routes/agent.js` — usa `defaultMetrics` (simpler, sem null checks)
- `src/copilot/lib/index.js` — remove ~15 re-exports de telemetria legada
- `src/copilot/channel/index.js` — remove 3 re-exports de audit legado
- `src/copilot/hooks/index.js` — `createAuditPreset` agora re-exporta de `observability/`

### Arquivos NÃO modificados:

- `src/copilot/agent/status-snapshot.js` — permanece sem mudanças
- `src/copilot/agent/tool-audit-logger.js` — permanece sem mudanças (usa log próprio + defaultBus)

---

## 8. Verificação de Completude Pós-Migração

Após a migração, executar:

```bash
# Verificar: zero imports legados
rg "lib/telemetry" src/copilot/ -t js
rg "channel/audit" src/copilot/ -t js
rg "hooks/presets/audit" src/copilot/ -t js
rg "createTelemetry|recordToolCall.*telemetry|TelemetryStore" src/copilot/ -t js

# Quality gates
npm run test:unit
npm run lint
npm run typecheck:node
npm run format:check
```

Resultado esperado: zero ocorrências nos greps, zero erros nos quality gates.
