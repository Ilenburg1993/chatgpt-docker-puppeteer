# Análise do Pipeline de Eventos de Tools — Terminal LLM-B

**Data**: 2026-05-09
**Última atualização**: 2026-05-09 (Fases F1.x e F2.x concluídas)
**Última atualização**: 2026-05-09 (F3 completo + bugs críticos de toolCallId + registry de tools nativas)
**Escopo**: `src/copilot/terminal/events/`, `src/copilot/terminal/wiring/`, `src/copilot/terminal/dialog/`, `src/copilot/terminal/state/`, `src/copilot/event-handlers/`
**Status**: ✅ Fases 1, 2 e 3 implementadas — F3.3/F3.4 (backward-compat e deprecação) pendentes

---

## Status de Implementação

| Fix  | Arquivo                          | Status       | Descrição curta                                                   |
| ---- | -------------------------------- | ------------ | ----------------------------------------------------------------- |
| F1.1 | `terminal-agent-wiring.js`       | ✅ Concluído  | Streaming delta: wiring emite SSE, não mais activity              |
| F1.2 | `io-activity-events.js`          | ✅ Concluído  | Dedup window 60ms por `(operation, target)`                       |
| F1.3 | `turn-display.js`                | ✅ Já correto | Source `dialog` consistente; nenhuma mudança necessária           |
| F1.4 | `agent-runtime-events.js`        | ✅ Já correto | `clearInterval` presente no cleanup retornado                     |
| F2.1 | `state/tool-call-registry.js`    | ✅ Concluído  | Novo arquivo: `createToolCallRegistry()` session-scoped           |
| F2.2 | `sdk-session-events.js`          | ✅ Concluído  | Aceita `registry` opcional; fallback para Maps globais            |
| F2.3 | `agent-runtime-events.js`        | ✅ Concluído  | Aceita `registry`; supressão por toolCallId via registry          |
| Wire | `event-adapters.js`              | ✅ Concluído  | Cria registry, injeta em ambos os setup functions                 |
| F3.1 | (novo) `tool.lifecycle` SSE      | ✅ Completo   | Schema unificado para clientes SSE                                |
| F3.2 | `io.operation` como supplemental | ✅ Completo   | Correlacionar io.operation com toolCallId via registry            |
| Bug1 | `interaction-events.js`          | ✅ Corrigido  | toolCallId não era extraído de external_tool.requested/completed  |
| Bug2 | `sdk-session-events.js`          | ✅ Corrigido  | toolCallId sintético (ext:requestId) → toolCallId real do SDK     |
| Bug3 | `tool-lifecycle-event.js`        | ✅ Corrigido  | Builders ExternalRequested/Completed sem campo toolCallId         |
| Bug4 | `agent-runtime-events.js`        | ✅ Corrigido  | registry.register/complete para tools nativas (io_op correlation) |
| Rem1 | `sdk-session-events.js`          | ✅ Removido   | Maps globais + 5 funções exportadas legadas de fallback removidos |
| Rem2 | `agent-runtime-events.js`        | ✅ Removido   | Import + ternários de fallback legados removidos; usa _reg direto |

---

## 1. Visão Geral

O sistema de eventos do terminal LLM-B evoluiu organicamente e acumulou **caminhos paralelos e redundantes** para representar o mesmo ciclo de vida de uma tool. O resultado prático são:

- Nomes opacos ou genéricos no log (`external_tool`, `tool`, `?s`)
- Eventos duplicados no SSE para uma única operação
- Estado de supressão frágil compartilhado entre módulos
- Turn trace superpovoado com entradas redundantes
- Atividade "Transmitindo resposta" disparada por duas fontes diferentes

---

## 2. Mapeamento da Arquitetura Atual

### 2.1 Caminhos Paralelos para Ciclo de Vida de Tools

Para **uma única execução de tool nativa** (ex: `read_file_content`), o sistema atual dispara:

```
SDK emite: tool.start
  └─ agent-runtime-events.js / onToolStart
       ├─ activeTools.set(toolCallId, ...)           # mapa in-process
       ├─ recordTerminalTurnToolActivity(started)     # turn-trace-state
       ├─ recordTerminalActivity('tool', ...)         # activity-state
       ├─ println() / writeInlineStatus()             # stdout
       └─ broadcastSse('tool.start', ...)             # SSE cliente

Simultaneamente: copilot.io.operation channel (×3)
  └─ io-activity-events.js / handleIoOperation
       ├─ recordTerminalTurnFileActivity(...)         # turn-trace-state (DUPLICADO)
       ├─ recordTerminalActivity('tool', 'I/O ...')  # activity-state
       ├─ println()                                   # stdout
       └─ broadcastSse('io.operation', ...)           # SSE cliente (×3)

SDK emite: tool.complete
  └─ agent-runtime-events.js / onToolComplete
       ├─ activeTools.delete(toolCallId)
       ├─ completeTerminalTurnToolCall(...)            # turn-trace-state
       ├─ recordToolCall(observability)
       ├─ recordTerminalActivity('tool', ...)
       ├─ println()
       └─ broadcastSse('tool.complete', ...)
```

**Total para 1 tool**: 1 SSE `tool.start` + 3 SSE `io.operation` + 1 SSE `tool.complete` = **5 eventos SSE**

---

Para **uma tool externa** (ex: browser/MCP via SDK), o sistema atual dispara:

```
SDK emite: external_tool.requested
  └─ sdk-session-events.js / onExternalToolRequested
       ├─ markExternalToolInFlight(toolName)          # estado módulo global
       ├─ rememberExternalToolRequestName(requestId)  # mapa módulo global
       ├─ recordTerminalTurnToolActivity(requested)   # turn-trace-state
       ├─ recordTerminalActivity('tool', ...)
       └─ broadcastSse('external_tool.requested', ...)

SDK emite: tool.start (com o MESMO toolCallId)
  └─ agent-runtime-events.js / onToolStart
       └─ isExternalToolInFlight(name) === true → SUPRIMIDO

SDK emite: external_tool.completed
  └─ sdk-session-events.js / onExternalToolCompleted
       ├─ resolveExternalToolRequestName(requestId)   # resolução de nome
       ├─ unmarkExternalToolInFlight(toolName)
       ├─ markExternalToolRecentlyCompleted(toolName) # cache TTL
       ├─ recordTerminalTurnToolActivity(completed)
       ├─ recordTerminalActivity(...)
       └─ broadcastSse('external_tool.completed', ...)

SDK emite: tool.complete (com o mesmo toolCallId)
  └─ agent-runtime-events.js / onToolComplete
       └─ wasExternalToolRecentlyCompleted() === true → SUPRIMIDO
```

**Problema**: a supressão cross-módulo via `externalToolsInFlight` e `externalToolsRecentlyCompleted` é **estado global de módulo**. Se a sessão for reciclada sem `onSessionShutdown`, o estado vaza para a próxima sessão.

---

### 2.2 Dual Streaming Delta Path

```
dialog loop emite: EMITTER_ASSISTANT_STREAMING_DELTA
  └─ terminal-agent-wiring.js
       └─ recordTerminalActivity('streaming', 'Transmitindo resposta', {
            detail: `${kb} KB recebidos`, source: 'sdk'
          })
           ↑ fonte: wiring (sdk)

dialog loop emite: chunk via callback
  └─ turn-display.js / createDeltaCallback
       ├─ broadcastSse('delta', { chunk })
       └─ recordTerminalActivity('streaming', 'Transmitindo resposta', {
            detail: `${model} · ${effort}`, source: 'dialog'
          })
           ↑ fonte: dialog
```

**Resultado**: `activity.changed` SSE emite "Transmitindo resposta" com **dois `source` diferentes** (`sdk` e `dialog`). O check `sameSemanticPayload` não suprime porque `source` difere. Causa entradas de histórico duplicadas.

---

### 2.3 Quatro Caminhos para Turn Trace

O `turn-trace-state.js` recebe chamadas de **4 origens diferentes**:

| Origem                    | Evento                              | Método chamado                   |
| ------------------------- | ----------------------------------- | -------------------------------- |
| `sdk-session-events.js`   | `external_tool.requested/completed` | `recordTerminalTurnToolActivity` |
| `agent-runtime-events.js` | `tool.start/complete`               | `recordTerminalTurnToolActivity` |
| `io-activity-events.js`   | `copilot.io.operation`              | `recordTerminalTurnFileActivity` |
| `sdk-session-events.js`   | `session.workspace_file_changed`    | `recordTerminalTurnFileActivity` |

Para uma leitura simples (`read_file_content`), o turn trace registra:
- 1 tool entry (tool.start)
- 3 file entries (io.operation × 3 — multicamada de cache)

O resumo no turn end (`renderTurnTraceSummary`) exibe ambas as categorias, gerando aparência de mais operações do que realmente aconteceram.

---

### 2.4 IO Operation Triple-Firing

O `copilot.io.operation` diagnostics_channel dispara 3× por leitura de arquivo. Causa provável: a engine de I/O tem múltiplas camadas (in-memory cache, workspace FS, disk), cada uma publicando no channel. O terminal registra as 3 como operações independentes, resultando em:
- 3 entradas no histórico de I/O
- 3 entradas no turn-trace files
- 3 SSE `io.operation` no cliente

---

### 2.5 Naming Inconsistency (SSE)

Eventos SSE emitidos atualmente para ciclo de vida de tools:

| Evento SSE                | Origem                 | Quando                   |
| ------------------------- | ---------------------- | ------------------------ |
| `tool.start`              | `agent-runtime-events` | Tool nativa inicia       |
| `tool.progress`           | `agent-runtime-events` | Progresso de tool nativa |
| `tool.partial_result`     | `agent-runtime-events` | Output parcial           |
| `tool.complete`           | `agent-runtime-events` | Tool nativa conclui      |
| `external_tool.requested` | `sdk-session-events`   | Tool externa solicitada  |
| `external_tool.completed` | `sdk-session-events`   | Tool externa conclui     |
| `io.operation`            | `io-activity-events`   | I/O real executado       |
| `tool.user_requested`     | `sdk-session-events`   | Tool aguarda usuário     |

O cliente SSE precisa tratar **3 famílias de eventos** para seguir o ciclo de uma tool. Não há contrato unificado.

---

### 2.6 Estado Global de Módulo (Vazamento Cross-Sessão)

`sdk-session-events.js` declara estado **no escopo do módulo** (fora de qualquer função):

```js
const externalToolsInFlight = new Map();       // global
const externalToolRequestNames = new Map();     // global
const externalToolsRecentlyCompleted = new Map(); // global
```

Se o runtime reciclar a sessão sem disparar `session.shutdown`, esses Maps persistem com entradas órfãs. Na próxima sessão, `isExternalToolInFlight()` pode retornar `true` para uma tool que não está mais em execução, suprimindo incorretamente eventos.

---

### 2.7 `activeTools` Map Session-Scoped vs Estado Global

`agent-runtime-events.js` mantém `activeTools` dentro do closure de `setupTerminalAgentRuntimeEventListeners` (correto — session-scoped). Mas o `toolHeartbeatTimer` (`setInterval`) criado dentro desse closure nunca é limpo se `cleanup()` retornado não for chamado. Vazamento de timer em hot-reload/test.

---

## 3. Situação Ideal — Pipeline Canônico

### 3.1 Princípio

> **Uma única fonte de verdade por fase do ciclo de vida de uma tool.**
> Todos os caminhos convergem para um `ToolCallRegistry` session-scoped que é a autoridade de nome, estado e metadados.

### 3.2 Arquitetura Proposta

```
┌─────────────────────────────────────────────────────────────────────┐
│                        SDK Events (upstream)                         │
│  tool.start · tool.progress · tool.complete                          │
│  external_tool.requested · external_tool.completed                   │
│  copilot.io.operation (diagnostics_channel)                         │
└───────────────────┬────────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────────────────────────────┐
│                   ToolCallRegistry (NEW)                             │
│                   session-scoped, injetado via DI                   │
│                                                                      │
│  - register(toolCallId, name, kind, args) → ToolCallEntry            │
│  - progress(toolCallId, %) → void                                    │
│  - complete(toolCallId, success, durationMs) → ToolCallEntry         │
│  - resolveByRequestId(requestId) → ToolCallEntry | null             │
│  - isInFlight(toolCallId | name) → boolean                          │
│  - wasRecentlyCompleted(toolCallId) → boolean                       │
│  - clear() (em session.shutdown)                                    │
└───────────────────┬────────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────────────────────────────┐
│               ToolActivityBridge (REFATORADO)                        │
│  Único módulo que lê ToolCallRegistry e decide:                      │
│  - O que mostrar no terminal (stdout)                                │
│  - O que emitir como activity-state                                  │
│  - O que broadcastSse                                               │
│  - O que registrar no turn-trace                                    │
│                                                                      │
│  Regra: uma operação → um bloco activity → um bloco SSE             │
└─────────────────────────────────────────────────────────────────────┘
```

### 3.3 Unificação de Eventos SSE

Schema unificado proposto:

```
tool.lifecycle  ─ todos os eventos de tool
  type: 'start' | 'progress' | 'complete' | 'external_start' | 'external_complete'
  toolCallId: string
  toolName: string  ← sempre o nome real (nunca "external_tool" ou "tool")
  operation: 'read' | 'write' | 'edit' | 'delete' | 'list' | 'run' | 'unknown'
  kind: 'native' | 'external' | 'mcp'
  fileTargets: string[]
  urlTargets: string[]
  searchTerms: string[]
  lineRange: { start, end } | null
  patchFiles: string[]
  progress?: number
  success?: boolean
  durationMs?: number
  source: 'sdk' | 'external' | 'io'
```

O cliente SSE ouve UM evento e tem informação completa.

### 3.4 Streaming Delta — Fonte Única

`terminal-agent-wiring.js` deve **parar** de chamar `recordTerminalActivity` para streaming. O único responsável por registrar atividade de streaming é `turn-display.js`. O wiring continua emitindo o SSE de progresso de bytes, mas sem duplicar a entrada de atividade.

### 3.5 IO Operation Deduplication

O `io-activity-events.js` deve ter um dedupe window de ~50ms por `(operation, target)` para absorver o triple-firing das camadas de cache. Entradas com mesma operação e alvo dentro da janela são mergeadas em uma única entrada com o maior `bytesRead` e o menor `durationMs`.

### 3.6 Turn Trace — Uma Entrada por Tool Call

O turn trace deve registrar cada `toolCallId` uma única vez. A última atualização com mais metadados vence. IO operations são correlacionadas ao `toolCallId` ativo quando disponível, em vez de criarem entradas de arquivo independentes.

---

## 4. Roadmap de Implementação

### Fase 1 — Quick Wins (Sem Mudança de API)

**[F1.1] Fix: Streaming Delta Dual-Path**
- Arquivo: `terminal-agent-wiring.js`
- Ação: remover `recordTerminalActivity` do handler `EMITTER_ASSISTANT_STREAMING_DELTA`
- `turn-display.js` já é o dono correto desse registro
- Impacto: elimina duplicação de "Transmitindo resposta" no histórico

**[F1.2] Fix: IO Operation Dedup Window**
- Arquivo: `io-activity-events.js`
- Ação: adicionar Map `_recentIoKeys → timestamp` com janela de 50ms
- Chave: `${operation}::${target}`
- Entradas dentro da janela: ignorar ou mergear ao invés de registrar
- Impacto: elimina triple-firing por leitura de arquivo

**[F1.3] Fix: Normalizar source em Streaming Activity**
- Arquivo: `turn-display.js`
- Ação: usar `source: 'dialog'` consistente (já é o caso, confirmar)
- O handler de wiring NUNCA deve emitir source `sdk` para streaming
- Impacto: `sameSemanticPayload` funciona corretamente

**[F1.4] Fix: Cleanup do toolHeartbeatTimer**
- Arquivo: `agent-runtime-events.js`
- Ação: a função `cleanup` retornada deve chamar `clearInterval(toolHeartbeatTimer)`
- Impacto: evita timer leak em hot-reload/tests

---

### Fase 2 — Consolidação de Estado (Médio Prazo)

**[F2.1] Create: ToolCallRegistry**
- Arquivo: `src/copilot/terminal/state/tool-call-registry.js` (novo)
- Session-scoped (instanciado em `setupTerminalSdkSessionEventListeners`)
- Substitui `externalToolsInFlight`, `externalToolRequestNames`, `externalToolsRecentlyCompleted` e `activeTools`
- Expõe interface limpa por toolCallId e por requestId
- Tem `clear()` explícito para ser chamado em `session.shutdown`

**[F2.2] Refactor: sdk-session-events.js**
- Substituir Maps globais por `ToolCallRegistry` injetado
- `onExternalToolRequested` → `registry.register(toolCallId, name, 'external')`
- `onExternalToolCompleted` → `registry.complete(toolCallId, success)`
- Não expõe mais `isExternalToolInFlight` / `wasExternalToolRecentlyCompleted` como API pública

**[F2.3] Refactor: agent-runtime-events.js**
- Receber `ToolCallRegistry` via parâmetro em `setupTerminalAgentRuntimeEventListeners`
- `onToolStart`: verificar `registry.isInFlight(toolCallId)` para supressão (por toolCallId, não por nome)
- `onToolComplete`: verificar `registry.wasRecentlyCompleted(toolCallId)`
- Remover import de `isExternalToolInFlight` / `wasExternalToolRecentlyCompleted` do sdk-session-events

---

### Fase 3 — Schema Unificado SSE (Longo Prazo)

**[F3.1] Create: Evento `tool.lifecycle` unificado**
- Todos os `tool.start/progress/complete` + `external_tool.requested/completed` → `tool.lifecycle`
- Campo `type` identifica a fase; campo `kind` identifica native/external/mcp
- Compatibilidade backward: manter eventos legados por no mínimo 2 versões (emitir ambos)
- Dashboard UI deve migrar para consumir `tool.lifecycle`

**[F3.2] Refactor: io.operation como supplemental**
- Após F2.1: correlacionar `io.operation` com `toolCallId` ativo via `ToolCallRegistry`
- Emitir `tool.lifecycle` com `type: 'io_op'` em vez de `io.operation` separado
- Manter `io.operation` como canal de debug (controlado por feature flag)

---

## 5. Resumo das Inconsistências por Severidade

| #   | Problema                                               | Severidade | Fase | Status                                             |
| --- | ------------------------------------------------------ | ---------- | ---- | -------------------------------------------------- |
| 1   | Streaming delta registrado duas vezes no activity      | **Alta**   | F1.1 | ✅ Resolvido                                        |
| 2   | IO operation dispara 3× por leitura                    | **Alta**   | F1.2 | ✅ Resolvido                                        |
| 3   | `externalToolsInFlight` estado global de módulo        | **Alta**   | F2.1 | ✅ Resolvido                                        |
| 4   | `toolHeartbeatTimer` nunca cancelado                   | **Média**  | F1.4 | ✅ Já estava ok                                     |
| 5   | Turn trace com entradas redundantes (tool + IO)        | **Média**  | F2.1 | ✅ Parcial (dedup de IO reduz entradas redundantes) |
| 6   | Três famílias de evento SSE para ciclo de tool         | **Média**  | F3.1 | ✅ Completo                                         |
| 7   | Supressão por nome (global) em vez de por toolCallId   | **Média**  | F2.2 | ✅ Resolvido                                        |
| 8   | `tool.complete` emite `toolName: name` (pré-resolução) | **Baixa**  | F2.3 | ✅ Resolvido                                        |
| 9   | Display "external_tool (uuid)" quando nome real existe | **Baixa**  | F1.2 | ✅ Resolvido                                        |

---

## 6. Próximos Passos — Fase 3 (Pendente)

As Fases 1 e 2 foram implementadas. O estado atual:

- **`src/copilot/terminal/state/tool-call-registry.js`** — novo arquivo com `createToolCallRegistry()`: register, progress, complete, resolveByRequestId, isInFlight, isNameInFlight, wasRecentlyCompleted, clear
- **`event-adapters.js`** — cria o registry e injeta via DI em `setupTerminalAgentRuntimeEventListeners` e `setupTerminalSdkSessionEventListeners`
- **Fallback backward-compat**: quando `registry` não é passado, os Setup functions continuam usando os Maps globais (compatibilidade com testes existentes)

Para Fase 3 (quando priorizado):

1. **[F3.1]** Criar evento `tool.lifecycle` unificado em `broadcastSse` — substituir as 3 famílias (`tool.*`, `external_tool.*`, `io.operation`) com schema canônico
2. **[F3.2]** Correlacionar `io.operation` com `toolCallId` ativo via `registry.getAllInFlight()` — emitir como `tool.lifecycle { type: 'io_op' }` em vez de evento separado
3. ~~Adicionar testes de unidade para `ToolCallRegistry` e para a dedup window de IO~~ ✅ Concluído

Fase 2 pode ser implementada em sequência sem quebra de contrato externo.

## 7. Fase 3 — Schema Unificado SSE `tool.lifecycle`

### [F3.1] Schema Canônico

Novo arquivo: `src/copilot/terminal/events/tool-lifecycle-event.js`

Tipo discriminante: `type: 'start' | 'progress' | 'partial_result' | 'complete' | 'external_requested' | 'external_completed' | 'user_requested' | 'io_op'`

**Campos principais do `ToolLifecycleEvent`:**

| Campo                  | Tipo                                    | Descrição                                              |
| ---------------------- | --------------------------------------- | ------------------------------------------------------ |
| `type`                 | `ToolLifecycleType`                     | Discriminante do evento (start, complete, io_op, etc.) |
| `source`               | `'sdk' \| 'external' \| 'io' \| 'user'` | Origem do evento                                       |
| `timestamp`            | `number`                                | Timestamp do evento em ms                              |
| `toolCallId`           | `string \| null`                        | ID da chamada (SDK only)                               |
| `toolName`             | `string`                                | Nome normalizado da tool                               |
| `rawToolName`          | `string \| null`                        | Nome original antes de normalização                    |
| `operation`            | `string \| null`                        | read, write, edit, delete, scan, etc.                  |
| `success`              | `boolean \| null`                       | Sucesso/falha da operação                              |
| `durationMs`           | `number \| null`                        | Tempo em milissegundos                                 |
| `progress`             | `number \| null`                        | 0-100 (para type='progress')                           |
| `progressMessage`      | `string \| null`                        | Mensagem de progresso customizada                      |
| `partialOutput`        | `string \| null`                        | Saída parcial (streaming, type='partial_result')       |
| `fileTargets`          | `string[]`                              | Todos os arquivos afetados                             |
| `lineRange`            | `{start: number; end: number} \| null`  | Range de linhas (read, write, etc.)                    |
| `ioEngine`             | `string \| null`                        | Motor de I/O (workspace-fs, etc.) — type='io_op' only  |
| `ioBytesRead`          | `number \| null`                        | Bytes lidos — type='io_op' only                        |
| `ioBytesWritten`       | `number \| null`                        | Bytes escritos — type='io_op' only                     |
| `correlatedToolCallId` | `string \| null`                        | ID da tool responsável (F3.2 correlation)              |
| `correlatedToolName`   | `string \| null`                        | Nome da tool responsável (F3.2 correlation)            |

### [F3.2] Correlação io_op → toolCallId

Quando uma operação de I/O dispara (type='io_op'), o pipeline:

1. Consulta `registry.getAllInFlight()` para tools ativas
2. Heurística: se única tool em voo, correlaciona; se múltiplas, choose mais recente ou 'unknown'
3. Popula `correlatedToolCallId` e `correlatedToolName` no evento
4. Emite `tool.lifecycle` com correlação preenchida

Benefício: clientes podem seguir o timeline completo de uma tool incluindo suas operações I/O, sem depender de matching heurístico de targets.

### Builders disponíveis

**Factory functions em `tool-lifecycle-event.js`:**

- `buildToolLifecycleStart(fields)` — from `tool.start`
- `buildToolLifecycleProgress(fields)` — from `tool.progress`
- `buildToolLifecyclePartialResult(fields)` — from `tool.partial_result`
- `buildToolLifecycleComplete(fields)` — from `tool.complete`
- `buildToolLifecycleExternalRequested(fields)` — from `external_tool.requested`
- `buildToolLifecycleExternalCompleted(fields)` — from `external_tool.completed`
- `buildToolLifecycleUserRequested(fields)` — from `tool.user_requested`
- `buildToolLifecycleIoOp(ioEntry, correlation?)` — from `io.operation`

Cada builder normaliza campos e applica defaults.

### Roadmap Fase 3 (próximas etapas)

- **F3.1 (schema)**: ✅ `tool-lifecycle-event.js` criado
- **F3.1 (wiring)**: ✅ `active-tool-call-registry.js` (DI compartilhado)
- **F3.1 (agent-runtime)**: ✅ Dual-emit `tool.lifecycle` em `agent-runtime-events.js`
- **F3.1 (sdk-session)**: ✅ Dual-emit `tool.lifecycle` em `sdk-session-events.js`
- **F3.2 (io-activity)**: ✅ Correlação I/O com tools em voo em `io-activity-events.js`
- **F3.3 (backward-compat)**: Deixar eventos legados ligados durante transição
- **F3.4 (deprecation)**: Documentar transição; deprecated após 2-3 ciclos

### Bugs Críticos Corrigidos (pós-F3)

**Bug 1 — toolCallId não propagado em external tools** (`interaction-events.js`):
- O campo `toolCallId` do SDK não era extraído do payload de `external_tool.requested/completed`.
- Resultado: sdk-session-events.js nunca recebia o toolCallId real; usava ID sintético `ext:${requestId}`.
- Fix: `interaction-events.js` agora extrai e propaga `data['toolCallId']` em ambos os eventos.

**Bug 2 — ID sintético no registry de external tools** (`sdk-session-events.js`):
- `registry.register()` usava `ext:${requestId}` como chave, não o toolCallId real do SDK.
- Resultado: correlação io_op → toolCallId era impossível; lookups por toolCallId falhavam.
- Fix: `onExternalToolRequested` extrai `evt?.toolCallId` e usa como primary key do registry.

**Bug 3 — Builders de tool.lifecycle sem toolCallId para externals** (`tool-lifecycle-event.js`):
- `buildToolLifecycleExternalRequested/Completed` não tinham parâmetro `toolCallId`.
- Fix: campo `toolCallId?: string | null` adicionado nos builders e propagado para o evento SSE.

**Bug 4 — Tools nativas não rastreadas no ToolCallRegistry** (`agent-runtime-events.js`):
- `onToolStart` não chamava `registry.register()` para tools nativas.
- Resultado: `getAllInFlight()` retornava apenas externals; correlação io_op → native tool era impossible.
- Fix: `onToolStart` agora chama `registry.register(toolCallId, name, 'native')`.
  `onToolComplete` chama `registry.complete(toolCallId, success)` após guard (apenas para nativas).

**Bug 5 — Fallback legado de Maps globais removido** (arquitetura):
- `sdk-session-events.js` exportava 5 funções de fallback (`isExternalToolInFlight`, `markExternalToolInFlight`, `unmarkExternalToolInFlight`, `markExternalToolRecentlyCompleted`, `wasExternalToolRecentlyCompleted`) + 3 Maps globais de módulo.
- `agent-runtime-events.js` importava `isExternalToolInFlight`, `wasExternalToolRecentlyCompleted` para fallback nos ternários de supressão.
- Fix: Ambas as funções de setup agora criam um `createToolCallRegistry()` interno quando registry não é injetado. Todos os Maps globais e funções exportadas legadas foram removidos.

---

## 8. Taxonomia de Tools — Conceitos Canônicos

Esta seção clarifica os conceitos de tipos de tools no sistema.

### 8.1 Native Tools (`kind: 'native'`)

**O que são**: Tools executadas **diretamente pelo runtime do SDK**. O SDK chama o handler registrado internamente e emite eventos `tool.execution_start` / `tool.execution_complete`.

**Quem são**:
- Tools criadas com `createTool()` / `defineTool()` registradas na sessão via `session.registerTools()`
- Nossas tools customizadas (ex: ferramentas de missão, tools de controle)
- **MCP tools**: O `mcp-tool-bridge.js` transforma tools MCP em tools nativas via `createTool()`. Chegam como nativas no runtime — NÃO como `external_tool.*`

**Fluxo de eventos**:
```
SDK emite tool.execution_start
  └─ agent-runtime-events.js / onToolStart
       ├─ _reg.register(toolCallId, name, 'native')
       ├─ broadcastSse('tool.start', ...)
       └─ broadcastSse('tool.lifecycle', buildToolLifecycleStart(...))

SDK emite tool.execution_complete
  └─ agent-runtime-events.js / onToolComplete
       ├─ _reg.complete(toolCallId, success)   [se kind='native']
       ├─ broadcastSse('tool.complete', ...)
       └─ broadcastSse('tool.lifecycle', buildToolLifecycleComplete(...))
```

### 8.2 External Tools (`kind: 'external'`)

**O que são**: Tools cujo handler de execução está **fora do nosso sistema** — fornecidas por um consumidor externo do SDK. O SDK emite `external_tool.requested` e **aguarda** que chamemos `session.respondToExternalTool()`.

**Quem são**:
- Tools definidas pelo agente externo que usa nosso SDK como runtime
- Identificadas pelos campos: `toolCallId` (obrigatório), `requestId` (obrigatório), `toolName`, `arguments`

**Fluxo de eventos**:
```
SDK emite external_tool.requested
  └─ interaction-events.js: extrai toolCallId, requestId, toolName → emit('external_tool.requested', {...})
     └─ sdk-session-events.js / onExternalToolRequested
          ├─ _reg.register(toolCallId, toolName, 'external', { requestId })
          ├─ broadcastSse('external_tool.requested', ...)
          └─ broadcastSse('tool.lifecycle', buildToolLifecycleExternalRequested(...))

[Consumidor externo executa a tool e chama session.respondToExternalTool()]

SDK emite external_tool.completed
  └─ interaction-events.js: extrai toolCallId → emit('external_tool.completed', {...})
     └─ sdk-session-events.js / onExternalToolCompleted
          ├─ _reg.complete(toolCallId, success)
          ├─ broadcastSse('external_tool.completed', ...)
          └─ broadcastSse('tool.lifecycle', buildToolLifecycleExternalCompleted(...))

SDK (runtime) emite tool.execution_start [opcionalmente, pode ocorrer também]
  └─ agent-runtime-events.js / onToolStart
       ├─ _reg.isNameInFlight(name) → true → SUPRIMIDO (já anunciado acima)
       └─ retorna sem broadcastSse
```

### 8.3 MCP Tools

**O que são**: Tools registradas via protocolo Model Context Protocol em processos separados (via `/api/mcp`).

**Como chegam**: O `mcp-tool-bridge.js` consulta o MCP Tool Registry e cria tools nativas via `createTool()` para cada tool MCP. Portanto, chegam ao runtime como **native tools** — não há tipo `kind: 'mcp'` em uso ativo.

**kind no registry**: Sempre `'native'` — o prefix `mcp_` no nome pode ser usado para identificação, mas não há campo separado.

### 8.4 Tool User Requested (`tool.user_requested`)

**O que é**: Evento emitido quando uma tool (geralmente nativa) necessita de **input do usuário** para continuar. Não é um tipo separado de tool, mas uma fase do ciclo de vida.

**Fluxo**: `agent.on('tool.user_requested')` → `onToolUserRequested` → `broadcastSse('tool.user_requested')` + `broadcastSse('tool.lifecycle', buildToolLifecycleUserRequested(...))`.

### 8.5 ToolCallRegistry — Papel Central

O `ToolCallRegistry` (session-scoped, injetado via `event-adapters.js`) é o **único estado de rastreamento** de tools em voo:

| Campo         | Tipo                              | Propósito                             |
| ------------- | --------------------------------- | ------------------------------------- |
| `toolCallId`  | `string`                          | ID primário (SDK real para externals) |
| `toolName`    | `string`                          | Nome normalizado                      |
| `kind`        | `'native' \| 'external' \| 'mcp'` | Tipo de tool                          |
| `requestId`   | `string \| null`                  | requestId para lookup de externals    |
| `completedAt` | `number \| null`                  | Timestamp de completion (para TTL)    |
| `success`     | `boolean \| null`                 | Resultado da execução                 |

**Métodos principais**:
- `register(toolCallId, toolName, kind, opts?)` — registra tool em voo
- `complete(toolCallId, success)` — marca como completada, move para recentlyCompleted
- `getEntry(toolCallId)` — lookup por ID
- `resolveByRequestId(requestId)` — lookup de external por requestId
- `isInFlight(toolCallId)` / `isNameInFlight(toolName)` — check de estado
- `getAllInFlight()` — todas as tools em voo (usada para correlação io_op)
- `wasRecentlyCompleted(toolCallId, requestId?)` / `wasNameRecentlyCompleted(toolName, requestId?)` — dedup guard
- `clear()` — cleanup no shutdown
**Testes criados (cobertura de regressão):**

| Arquivo de teste                                                       | Escopo                                                                                      |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `tests/unit/copilot/test_terminal_tool_call_registry.spec.js`          | `createToolCallRegistry()` — register, complete, dedup, TTL, clear                          |
| `tests/unit/copilot/test_terminal_io_activity_dedup.spec.js`           | `handleIoOperation` / `isDuplicateIoOperation` — triple-firing suppression                  |
| `tests/unit/copilot/test_terminal_sdk_session_events_registry.spec.js` | Integração registry com sdk-session-events (requested/completed/shutdown + backward compat) |
