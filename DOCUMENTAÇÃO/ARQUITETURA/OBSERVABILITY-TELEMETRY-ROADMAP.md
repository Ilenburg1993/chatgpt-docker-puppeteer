# Observabilidade, Telemetria e Logging — Análise e Roadmap

**Status**: Canônico — Implementação ativa (Fases A-M concluídas; Fases N-T em andamento) **Última
atualização**: 2026-06-17 (pós-commit `ff71cc4e` — Fase A-M implementada) **Escopo**: `src/copilot/`
— isolamento total + sistema centralizado robusto

---

## 0. Estado Pós-Implementação (Fases A-M) — Situação Real em jun/2026

### 0.1 O que foi implementado e está funcionando

| Componente                     | Arquivo                                     | Status                                      |
| ------------------------------ | ------------------------------------------- | ------------------------------------------- |
| Logger isolado                 | `observability/logger.js`                   | ✅ operacional, ring buffer 1000 entries    |
| Alias `#copilot/observability` | `package.json` + `tsconfig.base.json`       | ✅ funcionando                              |
| Codemod 76 arquivos            | `src/copilot/**/*.js`                       | ✅ zero ocorrências de `#core/logger`       |
| Event-collector SDK            | `observability/event-collector.js`          | ✅ criado, parcialmente conectado           |
| OTEL config builder            | `observability/otel.js`                     | ✅ criado, wireing em always-alive.js       |
| Error tracker                  | `observability/error-tracker.js`            | ✅ criado, global handlers em entry.js      |
| Metrics store                  | `observability/metrics.js`                  | ✅ criado, **NÃO alimentado** (gap crítico) |
| Barrel export                  | `observability/index.js`                    | ✅ completo                                 |
| HTTP API 7 endpoints           | `routes/observability.js`                   | ✅ montado em sdk-api.js                    |
| Audit path migration           | `channel/audit.js` + `tool-audit-logger.js` | ✅ isolado em `src/copilot/logs/`           |
| Global error handlers          | `entry.js`                                  | ✅ uncaughtException + unhandledRejection   |

### 0.2 Gaps Críticos Identificados (pós-análise jun/2026)

Após investigação profunda de `events.js`, `lib/telemetry.js`, `dialog-loop-manager.js`,
`dialog-loop-wirer.js`, `task-executor.js`, `session-event-wirer.js` e `always-alive.js`, os
seguintes gaps foram identificados:

#### GAP-01 — `initEventCollector()` nunca chamado (CRÍTICO)

`defaultEventCollector` é exportado de `event-collector.js` mas seu singleton interno é criado sem
`metrics`, `errorTracker`, ou `hookBus`:

```js
// Estado atual (INCORRETO):
let _defaultCollector = createEventCollector({ persist: true }); // sem metrics, sem errorTracker!

// O que deveria acontecer:
initEventCollector({
  hookBus: defaultBus,
  metrics: defaultMetrics,
  errorTracker: defaultErrorTracker,
});
```

**Impacto**: `defaultMetrics.recordToolMetric()` e `defaultErrorTracker.trackError()` **nunca são
chamados** pelo event-collector. Os singletons existem mas estão desconectados.

#### GAP-02 — `event-collector.js` tem código morto de telemetry (CRÍTICO)

```js
// Código atual (morto/incorreto):
if (telemetry) {
  const { recordToolCall } =
    /** @type {typeof import('#copilot/lib/telemetry')} */ (telemetry) ?? {};
  if (!recordToolCall) {
    /* tenta acessar telemetry.toolCalls diretamente */
  }
}
```

`telemetry` é um `TelemetryStore` (objeto de dados), não um módulo. `recordToolCall` nunca existe
nele. O `if (!recordToolCall)` tenta um fallback direto no array — um hack frágil.

**Solução**: Refatorar `EventCollectorOptions` para aceitar `metrics` (MetricsStore) e
`errorTracker` (ErrorTracker) como tipos explícitos, em vez de um `TelemetryStore` opaco.

#### GAP-03 — Dois sistemas de telemetria paralelos sem conexão (ARQUITETURAL)

| Sistema          | Arquivo                    | Alimentado por                                          | Consumido por                                         |
| ---------------- | -------------------------- | ------------------------------------------------------- | ----------------------------------------------------- |
| `TelemetryStore` | `lib/telemetry.js`         | `task-executor.js`, `dialog-loop-manager.js` (indireto) | `introspection-tools.js`, `always-alive.js#telemetry` |
| `MetricsStore`   | `observability/metrics.js` | **ninguém** (GAP-01)                                    | `routes/observability.js` (endpoint)                  |

`always-alive.js` ainda usa `createTelemetry()` de `lib/telemetry.js`. O novo `defaultMetrics` nunca
recebe dados da sessão real. Os dois vivem em paralelo sem integração.

#### GAP-04 — Dialog loop sem observabilidade (ARQUITETURAL — mencionado pelo usuário)

`DialogLoopManager` emite eventos via `dialogLoop.emit()` → `wireDialogLoopEvents()` →
`AlwaysAliveAgent.emit()`. Mas nenhum listener do sistema de observabilidade ouve esses eventos.
Eventos de alto valor não observados:

| Evento agente         | Payload                              | Valor                        |
| --------------------- | ------------------------------------ | ---------------------------- |
| `dialog.turn_start`   | `{ sessionId, prompt, ts }`          | Início de turn → latência    |
| `dialog.turn_end`     | `{ sessionId, durationMs, success }` | Duração de turn              |
| `dialog.stalled`      | `{ stalledMs }`                      | Detecção de stalls do LLM    |
| `dialog.turn_timeout` | `{ phase, timeoutMs }`               | Timeouts de boot/turn        |
| `dialog.ready`        | `{}`                                 | Boot completo do dialog loop |
| `dialog.stopped`      | `{ reason, authorized }`             | Encerramento do dialog       |
| `session.fatal`       | `{ error, sessionId }`               | Falhas críticas de sessão    |

⚠️ **`dialog.turn_start` e `dialog.turn_end` não aparecem em `dialog-loop-wirer.js`** —
`DialogLoopManager` emite `turn_start`/`turn_end` mas o wirer NÃO os encaminha! São eventos
"perdidos" que nunca chegam ao agente.

#### GAP-05 — Task events sem observabilidade

`task-executor.js` emite `task.completed`, `task.error`, `task.started` via `emit()`. Esses eventos
chegam ao `AlwaysAliveAgent.emit()` mas nenhum módulo de observabilidade os captura para métricas.

#### GAP-06 — `event-collector.js` não alimenta `defaultErrorTracker`

No handler de `session.error`, apenas persiste em JSONL e loga. Não chama
`defaultErrorTracker.trackError()`. Erros de sessão SDK ficam fora do ring buffer de erros.

#### GAP-07 — Sem `audit-log.js` centralizado

A Fase F do roadmap propunha criar um `audit-log.js` único que consolidasse `channel/audit.js` e
`tool-audit-logger.js`. Apenas migramos os paths. Os dois módulos ainda escrevem de forma
independente em formatos diferentes — sem ring buffer em memória, sem API de leitura.

#### GAP-08 — SSE de eventos sem dados reais

`GET /observability/events/stream` usa `defaultBus` para SSE. Mas `defaultBus` é um `HookBus` que só
recebe eventos quando `emitHook()` é chamado — e o event-collector (que poderia chamar) está
desconectado (GAP-01). Na prática o SSE nunca emite nada de valor.

#### GAP-09 — Sem persistência de métricas

`defaultMetrics` e `defaultErrorTracker` são puramente em memória. Dados são perdidos a cada
restart. Sem snapshotting periódico em `metrics.jsonl` / `errors.jsonl`.

#### GAP-10 — `lib/telemetry.js#startSpan()` conflita com SDK OTEL

`lib/telemetry.js` tem `startSpan()` que tenta inicializar `@opentelemetry/sdk-trace-node`
diretamente, criando um `NodeTracerProvider` próprio. Isso pode conflitar com o OTEL injetado via
`CopilotClient({ telemetry: buildTelemetryConfig() })` que também usa OTEL internamente.

#### GAP-11 — `dialog-turn-executor.js` sem métricas de turn

`dialog-turn-executor.js` executa os turns reais do dialog loop mas não tem nenhum instrumento de
métricas. Latência real de turns (incluindo tempo de resposta do LLM) não é medida.

#### GAP-12 — Audit endpoint ausente na API HTTP

`routes/observability.js` não tem `GET /observability/audit` — proposto no roadmap original mas não
implementado.

### 0.3 Situação Ideal (objetivo das Fases N-T)

```
AlwaysAliveAgent.emit('dialog.turn_end', { durationMs: 340 })
        │
        ▼
AgentEventObserver.onAgentEvent()
        │                │
        ▼                ▼
defaultMetrics       defaultErrorTracker
.recordDialogTurn()  .trackError()  ←── session.error também
        │
        ▼
observability/metrics.js  ←── GET /observability/metrics
        │
        ▼ (periodicamente)
src/copilot/logs/metrics.jsonl (persistência)


defaultBus.emitHook('post_tool_use', ...)    ← event-collector ALIMENTADO
        │
        ▼
GET /observability/events/stream  ← SSE real de eventos
```

---

---

## 1. Diagnóstico: Situação Atual

### 1.1 Mapeamento do Problema Central — `#core/logger`

O módulo `src/copilot/` não possui logger próprio. **76 arquivos** importam
`import { log } from '#core/logger'` diretamente do workspace pai:

```
src/copilot/
  agent/           → 14 arquivos com #core/logger
  api/             →  3 arquivos
  bridges/         →  2 arquivos
  channel/         →  2 arquivos
  config/          →  2 arquivos
  conversation-hub →  5 arquivos
  db/              →  1 arquivo
  hooks/           →  9 arquivos (incluindo bus.js!)
  lib/             →  2 arquivos
  routes/          →  4 arquivos
  terminal/        →  5 arquivos
  tools/           → 18 arquivos
```

`src/core/logger.js` (workspace pai) escreve para:

| Arquivo de log  | Caminho absoluto                               |
| --------------- | ---------------------------------------------- |
| Log operacional | `ROOT/logs/agente_current.log` (5 MB, rotação) |
| Métricas        | `ROOT/logs/metrics.log` (5 MB, rotação)        |
| Auditoria       | `ROOT/logs/audit.log` (2 MB, rotação)          |

Onde `ROOT = path.resolve(import.meta.dirname, '../../')` = raiz do workspace.

**Impacto**: Todo log emitido por `src/copilot` fica mesclado com logs do agente principal do
workspace (drivers de browser, kernel, orchestrator, etc.). Impossível distinguir ou isolar.

### 1.2 I/O de Auditoria — Acoplamento Direto a `ROOT/logs/`

Dois módulos em `src/copilot` escrevem JSONL diretamente na pasta de logs do workspace pai:

**`src/copilot/channel/audit.js`** → `ROOT/logs/tool-audit.jsonl` Registra execução de tool calls
SDK (start/complete, duração, args, resultado).

**`src/copilot/agent/tool-audit-logger.js`** → `ROOT/logs/tool-audit.jsonl` Registra decisões de
permissão (approve/deny, high-risk, sessionId). (Ambos escrevem no mesmo arquivo como "registros
complementares" — design confuso.)

### 1.3 Telemetria — Apenas In-Memory, Sem Persistência

`src/copilot/lib/telemetry.js` implementa um buffer circular em memória (`TelemetryStore`):

- Rastreia: `toolCalls[]`, `sessions[]`, com `maxRecords = 500`
- **Sem persistência** — dados são perdidos ao reiniciar do processo
- **Sem exportação** — dados só acessíveis via `introspection-tools.js` (tool do agente)
- **Sem métricas agregadas** — sem percentis de latência, sem histogramas
- **Sem stream** — não há evento em tempo real para o dashboard

### 1.4 Eventos SDK — Riqueza Ignorada

O SDK emite **70+ tipos de eventos** via `session.on(eventType, handler)`, nenhum deles sendo
capturado sistematicamente para telemetria ou observabilidade. Eventos de alto valor ignorados:

| Evento                                   | Valor para telemetria             |
| ---------------------------------------- | --------------------------------- |
| `tool.execution_start`                   | Início de tool call + args        |
| `tool.execution_complete`                | Duração, sucesso/falha, resultado |
| `assistant.usage`                        | Tokens de entrada/saída por turn  |
| `session.usage_info`                     | Consumo acumulado de tokens       |
| `session.info`                           | Informações de contexto           |
| `permission.requested` / `.completed`    | Decisões de permissão             |
| `hook.start` / `hook.end`                | Latência de hooks                 |
| `session.error`                          | Erros com stack trace             |
| `session.truncation`                     | Compação de contexto              |
| `session.compaction_start` / `.complete` | Compação automática               |
| `assistant.turn_start` / `.turn_end`     | Duração de turns                  |
| `session.model_change`                   | Troca de modelo durante sessão    |

### 1.5 OpenTelemetry (OTEL) — Suportado pelo SDK, Não Integrado

O SDK suporta OpenTelemetry nativo via `CopilotClientOptions.telemetry`:

```js
const client = new CopilotClient({
  telemetry: {
    otlpEndpoint: 'http://localhost:4318', // OTLP HTTP
    filePath: '/path/to/traces.jsonl', // ou arquivo JSONL local
    exporterType: 'file', // 'otlp-http' | 'file'
    sourceName: 'copilot-sdk-agent',
    captureContent: false, // capturar conteúdo de mensagens
  },
});
```

Com essa configuração, o CLI interno do SDK emite **spans automáticos** para cada sessão, mensagem e
tool call — incluindo `traceparent`/`tracestate` W3C nos eventos de invocação de ferramenta.

**Estado atual**: zero integração. Nenhum span sendo capturado ou exportado.

### 1.6 Outros Imports do Workspace Pai em `src/copilot`

Além de `#core/logger` (76 ocorrências), existem mais 2 violações de isolamento:

| Arquivo                         | Import violador    | Impacto                        |
| ------------------------------- | ------------------ | ------------------------------ |
| `conversation-hub/socket-ns.js` | `#core/jwt_config` | JWT config do workspace pai    |
| `db/sqlite.js`                  | `#core/config`     | CONFIG global do workspace pai |

### 1.7 Captura de Erros — Incompleta

- `entry.js`: captura `SIGTERM`, `SIGINT`, `error` do agente, `session.fatal` do agente
- **Sem** handlers globais de `uncaughtException` / `unhandledRejection`
- `onErrorOccurred` hook: captura erros SDK, emite no HookBus — mas sem persistência
- Sem registro centralizado de erros com contexto (sessionId, tool, stack trace)

---

## 2. Proposta — Nova Arquitetura de Observabilidade

### 2.1 Princípio: `src/copilot/observability/` como Módulo Totalmente Isolado

```
src/copilot/observability/
├── index.js              — API pública + singleton store global
├── logger.js             — Logger interno isolado (sem dependência de #core/*)
├── event-collector.js    — Captura 70+ eventos SDK via session.on()
├── telemetry-store.js    — Store centralizado + persistência SQLite opcional
├── error-registry.js     — Registro centralizado de erros + handlers globais
├── audit-log.js          — I/O de auditoria JSONL isolado em src/copilot/logs/
├── otel.js               — Configuração OpenTelemetry para CopilotClient
└── metrics.js            — Métricas agregadas (counters, histogramas, latência)
```

**Import alias**: `#copilot/observability` → `./src/copilot/observability/index.js`

### 2.2 Destino dos Arquivos de Log

Todos os arquivos de log de `src/copilot` migram para um subdiretório isolado:

```
src/copilot/logs/          ← PASTA NOVA — completamente isolada do workspace pai
  agent.log                ← Operacional (substitui ROOT/logs/agente_current.log para copilot)
  audit.jsonl              ← Auditoria JSONL (substitui ROOT/logs/tool-audit.jsonl)
  audit.jsonl.1            ← Rotação
  events.jsonl             ← Eventos SDK capturados (NOVO)
  errors.jsonl             ← Erros com contexto (NOVO)
  metrics.jsonl            ← Snapshots de métricas (NOVO)
  otel-traces.jsonl        ← Traces OTEL (NOVO, quando configurado)
```

A pasta `src/copilot/logs/` é adicionada ao `.gitignore` (já existe `logs/` no root).

### 2.3 `observability/logger.js` — Logger Interno

Drop-in replacement para `{ log }` de `#core/logger`:

- **Mesma API**: `log(level, msg, taskId?)`, `log.debug/info/warn/error/fatal()`
- **Completamente isolado**: sem imports de `#core/*` ou `src/` externo
- **Destino**: escreve em `src/copilot/logs/agent.log` (não mais `ROOT/logs/agente_current.log`)
- **Rotação**: preserva lógica de rotação por tamanho
- **Tags**: prefixo `[copilot]` para distinguir nos logs do console
- **Metadata**: suporte opcional a `{ sessionId, module }` como contexto estruturado

### 2.4 `observability/event-collector.js` — Captura de Eventos SDK

Captura TODOS os eventos emitidos por uma sesssão SDK:

- Registrado via `session.on('*', handler)` (handler genérico)
- Emite eventos relevantes para o `TelemetryStore` e `ErrorRegistry`
- Persiste eventos de alto valor em `events.jsonl` (filtrável por tipo)
- Expõe stream SSE via `ObservabilityEventEmitter`

### 2.5 `observability/telemetry-store.js` — Store Centralizado

Evolução de `lib/telemetry.js` com:

- **Persistência opcional**: snapshots periódicos em `metrics.jsonl`
- **Métricas por sessão**: duração, tokens, tool calls, erros
- **Histogramas**: distribuição de latência de tool calls (P50, P90, P99)
- **Integração com event-collector**: alimentado pelos eventos SDK capturados
- **API de consulta ampliada**: filtros por sessionId, toolName, time range

### 2.6 `observability/error-registry.js` — Registro Centralizado de Erros

- Handlers globais: `uncaughtException`, `unhandledRejection` em `entry.js`
- Captura erros do hook `onErrorOccurred` com contexto completo
- Persiste em `errors.jsonl` com: timestamp, sessionId, errorContext, stack, recoverable
- Buffer ring: últimos N erros em memória para consulta rápida via API
- Emite eventos no HookBus para SSE

### 2.7 `observability/otel.js` — Integração OpenTelemetry

- Gera `TelemetryConfig` para `CopilotClient` baseado em variáveis de ambiente
- Padrão: exportação para `src/copilot/logs/otel-traces.jsonl`
- Configúravel: `COPILOT_OTEL_ENDPOINT`, `COPILOT_OTEL_EXPORTER_TYPE`
- `TraceContext propagation` via `onGetTraceContext` (para apps que já usam OTEL)

### 2.8 `observability/audit-log.js` — Auditoria I/O Isolada

Consolida lógica de I/O atualmente dispersa em `channel/audit.js` e `tool-audit-logger.js`:

- Único responsável por I/O em `src/copilot/logs/audit.jsonl`
- Mantém a API pública de ambos (sem breaking change)
- Suporte a filtros de leitura por sessionId, time range, toolName
- Ring buffer em memória dos últimos 100 registros para `/api/sdk/observability/audit`

### 2.9 `observability/metrics.js` — Métricas Agregadas

```
Métricas mantidas em memória (resets ao reiniciar processo):
  tool_calls_total{toolName, success}  ← counter
  tool_call_duration_ms{toolName}      ← histogram (P50, P90, P99)
  session_duration_ms{sessionId}       ← gauge
  tokens_total{direction}              ← counter (input/output)
  permission_decisions{decision}       ← counter (approved/denied)
  errors_total{errorContext}           ← counter
  hook_duration_ms{hookType}           ← histogram
```

Exportável em formato Prometheus-compatible (`/metrics` endpoint) se configurado.

### 2.10 API HTTP — `routes/observability.js`

```
GET  /api/sdk/observability/status      → resumo atual (uptime, contadores, estado)
GET  /api/sdk/observability/logs        → últimas N linhas de agent.log (paginado)
GET  /api/sdk/observability/metrics     → snapshot atual das métricas
GET  /api/sdk/observability/events      → SSE stream dos eventos SDK capturados
GET  /api/sdk/observability/audit       → últimas N entradas de audit.jsonl
GET  /api/sdk/observability/errors      → últimos N erros registrados
POST /api/sdk/observability/log-level   → ajustar log level dinamicamente
GET  /api/sdk/observability/prometheus  → métricas Prometheus (opcional)
```

---

## 3. Roadmap de Implementação

### Fase A — `observability/logger.js` (Logger Interno Isolado)

**Objetivo**: Drop-in replacement de `#core/logger` sem dependência do workspace pai.

**Sub-tarefas**:

- A.1 Criar `src/copilot/observability/logger.js` com a mesma assinatura de `#core/logger`
  - Mesmos exports: `log`, `log.debug/info/warn/error/fatal`, `audit`, `metric`
  - `LOG_DIR = new URL('../../logs/', import.meta.url)` — relativo à própria pasta
  - Criar `src/copilot/logs/` automaticamente na carga do módulo (como faz `#core/logger`)
  - Adicionar prefixo `[copilot]` nas linhas do console
  - Resposta a `COPILOT_LOG_LEVEL` env var (não `LOG_LEVEL` global)
- A.2 Adicionar `src/copilot/logs/` ao `.gitignore`
- A.3 Criar arquivo de índice `src/copilot/observability/index.js` (esqueleto inicial)

### Fase B — Alias `#copilot/observability` em `package.json`

**Objetivo**: Expor o módulo observability via alias limpo.

**Sub-tarefas**:

- B.1 Adicionar ao `package.json#imports`:
  ```json
  "#copilot/observability": "./src/copilot/observability/index.js",
  "#copilot/observability/logger": "./src/copilot/observability/logger.js"
  ```
- B.2 Adicionar `tsconfig` paths correspondentes

### Fase C — Migration Codemod: `#core/logger` → `#copilot/observability/logger`

**Objetivo**: Substituir os 76 imports sem alterar comportamento.

**Sub-tarefas**:

- C.1 Script de migration automatizado (sed/fd) para substituir imports
  ```bash
  fd -e js src/copilot | xargs sd "from '#core/logger'" "from '#copilot/observability/logger'"
  ```
- C.2 Verificar que nenhuma outra API de `#core/logger` estava sendo usada além de `{ log }`
- C.3 `npm run lint + typecheck` → verde

### Fase D — `observability/event-collector.js`

**Objetivo**: Capturar sistematicamente todos os eventos de uma sessão SDK.

**Sub-tarefas**:

- D.1 Criar `EventCollector` que recebe uma `CopilotSession` e registra `session.on('*', cb)` OU
  subscribe a múltiplos event types de alto valor
- D.2 Integrar com `TelemetryStore` (alimentar toolCalls, sessions via eventos)
- D.3 Integrar com `HookBus.emitHook()` para re-emissão de eventos SDK no bus
- D.4 Persistir eventos de highest-value em `events.jsonl` (assíncrono, com batching)
- D.5 Wiring em `always-alive.js`: `eventCollector.attach(session)` após `initOrResumeSession()`
- D.6 Verificar que `channel/audit.js` pode ser substituído por event-collector para
  `tool.execution_start` + `tool.execution_complete` (desacoplando do arquivo JSONL direto)

### Fase E — `observability/otel.js` + Integração OTEL no CopilotClient

**Objetivo**: Ativar tracing OTEL nativo do SDK para captura automática de spans.

**Sub-tarefas**:

- E.1 Criar `observability/otel.js` com função `buildTelemetryConfig()`
  - Padrão: `{ filePath: '.../src/copilot/logs/otel-traces.jsonl', exporterType: 'file' }`
  - Se `COPILOT_OTEL_ENDPOINT` definido: usar otlp-http
  - Se `COPILOT_OTEL_DISABLED=true`: retornar `undefined`
- E.2 Injetar `telemetry: buildTelemetryConfig()` no `CopilotClient` em `lib/sdk-client.js`
- E.3 Expor `onGetTraceContext` como opção configurável (para apps com OTEL próprio)
- E.4 Testar geração de traces em `otel-traces.jsonl`

### Fase F — `observability/audit-log.js` (Migração de I/O de Auditoria)

**Objetivo**: Consolidar e isolar todo I/O de auditoria em módulo único dentro de `src/copilot`.

**Sub-tarefas**:

- F.1 Criar `observability/audit-log.js` que recebe registros e escreve em
  `src/copilot/logs/audit.jsonl` (não mais `ROOT/logs/tool-audit.jsonl`)
  - Manter mesmo schema JSONL (backward compatible para leitura)
  - Ring buffer em memória dos últimos 200 registros
  - Rotação por tamanho (10 MB → `.1`)
- F.2 Adicionar alias `#copilot/observability/audit-log`
- F.3 Migrar `channel/audit.js` para usar `audit-log.js` para I/O
  - Manter API pública de `channel/audit.js` intacta (sem breaking)
- F.4 Migrar `tool-audit-logger.js` para usar `audit-log.js` para I/O
  - Manter API pública intacta
- F.5 Eliminar paths `ROOT/logs/` de ambos os módulos (isolamento completo)

### Fase G — `observability/error-registry.js`

**Objetivo**: Registro centralizado de erros com contexto, persistência e captura global.

**Sub-tarefas**:

- G.1 Criar `ErrorRegistry` com ring buffer (últimos 100 erros) e persistência `errors.jsonl`
- G.2 Schema de erro: `{ ts, sessionId, errorContext, message, stack?, recoverable, source }`
- G.3 Conectar ao `onErrorOccurred` hook: `errorRegistry.record(input, invocation)`
- G.4 Registrar `process.on('uncaughtException', ...)` e `process.on('unhandledRejection', ...)` em
  `entry.js` usando `errorRegistry`
- G.5 Emitir erros no `defaultBus` para SSE
- G.6 API de consulta: `getRecentErrors(n)`, `getErrorsBySession(sessionId)`

### Fase H — `observability/telemetry-store.js` (Store Centralizado com Persistência)

**Objetivo**: Evoluir `lib/telemetry.js` com persistência e métricas ricas.

**Sub-tarefas**:

- H.1 Criar `TelemetryCentralStore` que estende `TelemetryStore`:
  - Mantém API de `lib/telemetry.js` (backward compatible)
  - Adiciona: snapshots periódicos em `metrics.jsonl` (a cada 5 min ou a cada N events)
  - Adiciona: histogramas de latência (P50, P90, P99 de tool calls)
  - Adiciona: contadores de tokens (do evento `assistant.usage`)
  - Alimentado pelo `EventCollector` (D) em vez de chamar diretamente
- H.2 Singleton `defaultTelemetry` exportado por `observability/index.js`
- H.3 Atualizar `lib/telemetry.js` para ser re-export de `#copilot/observability/telemetry-store`
  (preservar backward compat com `always-alive.js` e `introspection-tools.js`)

### Fase I — `observability/metrics.js` + Prometheus Export

**Objetivo**: Métricas agregadas em formatos padrão.

**Sub-tarefas**:

- I.1 Criar `MetricsRegistry` com counters e histogramas
- I.2 Alimentar via `EventCollector` (tool calls, tokens, erros, permissões)
- I.3 Serialização em formato Prometheus text (`# TYPE ... counter`, `# HELP ...`)
- I.4 Expor via API HTTP `/observability/prometheus`

### Fase J — `routes/observability.js` (API HTTP completa)

**Objetivo**: Expor toda observabilidade via API HTTP REST + SSE.

**Sub-tarefas**:

- J.1 `GET /status` — uptime, storage, contadores básicos, estado do agente
- J.2 `GET /logs?n=100&level=WARN` — últimas N linhas de `agent.log` filtradas
- J.3 `GET /metrics` — snapshot atual de todas as métricas
- J.4 `GET /events` — SSE stream dos eventos SDK capturados (EventCollector → SSE)
  - Com filtros por tipo: `?types=tool.execution_start,assistant.usage`
- J.5 `GET /audit?sessionId=X&limit=50` — histórico de auditoria
- J.6 `GET /errors?limit=20` — erros recentes com contexto
- J.7 `POST /log-level` — ajuste dinâmico do nível de log
- J.8 `GET /prometheus` — Prometheus scrape endpoint (opcional)
- J.9 Wiring em `sdk-api.js`: `router.use('/', observabilityRouter)`

### Fase K — `observability/index.js` (API Pública Final)

**Objetivo**: Publicar API pública limpa e coerente.

**Sub-tarefas**:

- K.1 Exportar singletons: `defaultLogger`, `defaultTelemetry`, `defaultErrorRegistry`,
  `defaultEventCollector`, `defaultAuditLog`, `defaultMetrics`
- K.2 Exportar fábricas: `createLogger()`, `createTelemetry()` (para casos de uso isolado)
- K.3 Exportar tipos: `LogLevel`, `TelemetryStore`, `ErrorRecord`, `AuditRecord`
- K.4 Exportar helpers de inicialização: `initObservability(session, opts?)` — único ponto de
  configuração usado por `always-alive.js`
- K.5 Atualizar `always-alive.js` para usar `initObservability()` em `#initSession()`

### Fase L — Atualização de `lib/telemetry.js` e Compatibilidade

**Objetivo**: Preservar backward compat para consumidores existentes de `lib/telemetry.js`.

**Sub-tarefas**:

- L.1 Converter `lib/telemetry.js` em thin re-export de `#copilot/observability/telemetry-store`
- L.2 Converter `channel/audit.js` I/O em thin wrapper de `#copilot/observability/audit-log`
- L.3 Converter `tool-audit-logger.js` I/O em thin wrapper de `#copilot/observability/audit-log`
- L.4 Verificar que todos os consumidores de `getSummary()`, `recordToolCall()` etc. continuam
  funcionando

### Fase M — Testes, Lint, Typecheck, Commit ✅ CONCLUÍDA (commit `ff71cc4e`)

**Objetivo**: Validação completa antes de commit.

- M.1 ✅ `npm run test:unit` — 2054/2054 passando
- M.2 ✅ `npm run lint` — zero erros (1 warning pré-existente)
- M.3 ✅ `npm run typecheck:node` — zero erros
- M.4 ✅ `npm run format:check` — clean (após commit de prettier)
- M.5 ✅ Commit `cc00b1d3` (89 files, 2011 insertions) + `ff71cc4e` (prettier)
- M.6 ✅ Push para `origin/main`

---

## 4. Fases N-T — Segunda Rodada de Implementação (pós-análise jun/2026)

Corrige os 12 gaps identificados na análise da Seção 0.2.

### Fase N — Conectar `initEventCollector` aos singletons e corrigir event-collector

**Corrige**: GAP-01, GAP-02, GAP-06

**Objetivo**: `defaultEventCollector` deve alimentar `defaultMetrics` e `defaultErrorTracker`. O
código morto de telemetry legacy deve ser removido.

**Sub-tarefas**:

- N.1 Refatorar `EventCollectorOptions`:
  - Remover `telemetry: TelemetryStore | null` (era o campo errado — objeto de dados, não módulo)
  - Adicionar `metrics: MetricsStore | null`
  - Adicionar `errorTracker: ErrorTracker | null`
  - Adicionar `hookBus: HookBus | null` (já existia, mas não era passado)
- N.2 No handler `tool.execution_complete`:
  - `opts.metrics?.recordToolMetric(toolName, durationMs, success)` (substitui código morto)
  - `hookBus?.emitHook(...)` (já existe, manter)
- N.3 No handler `assistant.usage`:
  - `opts.metrics?.recordTokenUsage(model, inputTokens ?? 0, outputTokens ?? 0)`
- N.4 No handler `session.error`:
  - `opts.errorTracker?.trackError(new Error(message), { source: 'sdk:session.error', sessionId })`
- N.5 Em `always-alive.js`, antes de usar `defaultEventCollector`:
  - Chamar
    `initEventCollector({ hookBus: defaultBus, metrics: defaultMetrics, errorTracker: defaultErrorTracker })`
  - Importar `defaultBus` de `#copilot/hooks/bus` — já disponível via `attachBus`
  - Chamar no top-level do módulo (fora da class) ou no primeiro boot
- N.6 Exportar `HookBus` type de `#copilot/hooks/bus` para uso nos tipos de `EventCollectorOptions`
- N.7 Verifica: `npm run typecheck:node` zero erros + `npm run test:unit` verde

### Fase O — `dialog-loop-wirer.js`: adicionar turn_start / turn_end

**Corrige**: GAP-04 (parcial — eventos perdidos no wirer)

**Objetivo**: `dialog.turn_start` e `dialog.turn_end` precisam ser encaminhados pelo wirer.

**Sub-tarefas**:

- O.1 Verificar que `DialogLoopManager` emite `turn_start` e `turn_end` (verificado: apenas
  `changed`, `model.fallback` são encaminhados — `turn_start/end` faltam)
- O.2 Adicionar ao `wireDialogLoopEvents()`:
  ```js
  dialogLoop.on('turn_start', (evt) => emitFn('dialog.turn_start', evt));
  dialogLoop.on('turn_end', (evt) => emitFn('dialog.turn_end', evt));
  ```
- O.3 Verificar que `dialog.turn_start` e `dialog.turn_end` constam em `events.js` (AGENT_EVENTS) —
  se não estiverem, adicionar
- O.4 Validar que o wirer NÃO encaminha dois vezes (check de idempotência)

### Fase P — `observability/agent-observer.js` — Observador do AlwaysAliveAgent

**Corrige**: GAP-04 (completo), GAP-05

**Objetivo**: Módulo que se inscreve nos eventos do `AlwaysAliveAgent` (emissor nativo Node.js) e
alimenta `defaultMetrics` e `defaultErrorTracker`.

**Sub-tarefas**:

- P.1 Criar `src/copilot/observability/agent-observer.js`:
  ```
  AgentObserver.attach(agent)
    → agent.on('dialog.turn_start', handler)
    → agent.on('dialog.turn_end',   handler)
    → agent.on('dialog.stalled',    handler)
    → agent.on('dialog.turn_timeout', handler)
    → agent.on('dialog.ready',      handler)
    → agent.on('dialog.stopped',    handler)
    → agent.on('task.completed',    handler)
    → agent.on('task.error',        handler)
    → agent.on('session.fatal',     handler)
    → agent.on('agent.metrics',     handler)
  ```
- P.2 Nos handlers de `dialog.turn_start` / `dialog.turn_end`:
  - `defaultMetrics.recordDialogTurnMetric(durationMs, success)` (nova função a criar em metrics.js)
  - Persistir em `events.jsonl` se persist=true
- P.3 No handler de `dialog.stalled`:
  - `defaultMetrics.recordDialogStall(stalledMs)`
- P.4 No handler de `dialog.turn_timeout`:
  - `defaultMetrics.recordCounter('dialog.turn_timeout', 1)`
  - `defaultErrorTracker.trackError(new Error('dialog.turn_timeout'), { source: 'dialog', sessionId: ... })`
- P.5 No handler de `session.fatal`:
  - `defaultErrorTracker.trackError(err, { source: 'session.fatal', sessionId })`
- P.6 No handler de `task.error`:
  - `defaultErrorTracker.trackError(err, { source: 'task.error', taskId })`
- P.7 Exportar `AgentObserver`, `defaultAgentObserver` do `observability/index.js`
- P.8 Em `always-alive.js`, após `startDialogLoop()`, chamar `defaultAgentObserver.attach(this)`
- P.9 Retornar `detach()` para cleanup no `stop()` do agente

### Fase Q — Estender `metrics.js` com métricas de dialog loop

**Corrige**: GAP-04, GAP-11

**Objetivo**: `MetricsStore` precisa de tipos específicos para dialog loop, sessions e tasks.

**Sub-tarefas**:

- Q.1 Adicionar `DialogMetrics` ao typedef do `MetricsStore`:
  ```js
  /**
   * @typedef {object} DialogMetrics
   * @property {number} turnsTotal - Total de turns executados
   * @property {number} turnsSuccess - Turns completados com sucesso
   * @property {number} stallsTotal - Total de stalls detectados
   * @property {number} timeoutsTotal - Total de timeouts
   * @property {LatencyHistogram} turnLatency - Histograma de latência de turns
   * @property {number} avgStalledMs - Média de tempo stalled
   */
  ```
- Q.2 Adicionar métodos efetivos:
  - `recordDialogTurnMetric(durationMs, success)` — alimenta `dialogMetrics.turnLatency`
  - `recordDialogStall(stalledMs)` — incrementa stalls + média smoother
  - `recordCounter(name, delta)` — generic counter (para timeouts, etc.)
- Q.3 Incluir `dialog` na saída de `getAggregatedMetrics()`
- Q.4 Adicionar `TaskMetrics`: `tasksCompleted`, `tasksFailed`, `avgTaskDurationMs`
- Q.5 Adicionar `SessionMetrics.durationBySession: Map<string, number>` para rastrear duração de
  sessões individuais

### Fase R — `observability/audit-log.js` (Central JSONL I/O + Ring Buffer)

**Corrige**: GAP-07

**Objetivo**: Consolidar `channel/audit.js` e `tool-audit-logger.js` em módulo central com ring
buffer em memória e API de leitura.

**Sub-tarefas**:

- R.1 Criar `src/copilot/observability/audit-log.js`:
  - Unifica leituras de ambos os módulos em `src/copilot/logs/audit.jsonl`
  - Ring buffer em memória dos últimos 200 registros (para `/observability/audit`)
  - Schema canônico: `{ ts, type, sessionId, toolName?, args?, result?, durationMs?, decision? }`
  - Método `write(record)` — assíncrono, batching de escritas
  - Métodos de consulta: `getRecent(n)`, `getBySession(sessionId)`, `getByTool(toolName)`
  - Rotação por tamanho: 10 MB → `.1` (via lógica de rotação já em logger.js)
- R.2 Adicionar alias `#copilot/observability/audit-log` em `package.json` + tsconfig
- R.3 Migrar `channel/audit.js` para usar `auditLog.write()` internamente (mantém API pública)
- R.4 Migrar `tool-audit-logger.js` para usar `auditLog.write()` internamente (mantém API pública)
- R.5 Exportar `defaultAuditLog` de `observability/index.js`
- R.6 Validar que os dois arquivos JSONL distintos atuais (`audit.js` e `tool-audit-logger.js`) são
  unificados sem perda de informação

### Fase S — Persistência Periódica de Métricas e Erros

**Corrige**: GAP-09

**Objetivo**: `defaultMetrics` e `defaultErrorTracker` persistem snapshots periodicamente.

**Sub-tarefas**:

- S.1 Em `observability/metrics.js`:
  - Função `startPeriodicSnapshot(intervalMs?)` — inicia `setInterval` para gravar `metrics.jsonl`
  - Formato: `{ _snapshot: ISO, tools, tokens, dialog, tasks, sessions }`
  - Padrão: `COPILOT_METRICS_SNAPSHOT_INTERVAL` (default 300000ms = 5 min)
  - Função `stopPeriodicSnapshot()` para cleanup
- S.2 Em `observability/error-tracker.js`:
  - Função `enablePersistence(logDir)` — persiste cada novo erro em `errors.jsonl` via append
  - Diferente de snapshot: cada erro é gravado imediatamente ao ser rastreado
- S.3 Em `always-alive.js` (ou `entry.js`):
  - Chamar `defaultMetrics.startPeriodicSnapshot()` no boot
  - Chamar `defaultErrorTracker.enablePersistence(LOG_DIR)` no boot
  - No `stop()` do agente: `defaultMetrics.stopPeriodicSnapshot()`

### Fase T — API HTTP: endpoint `/observability/audit` + SSE melhorado

**Corrige**: GAP-08, GAP-12

**Objetivo**: SSE de eventos reais + endpoint de auditoria.

**Sub-tarefas**:

- T.1 Em `routes/observability.js`:
  - Adicionar `GET /observability/audit` → `defaultAuditLog.getRecent(limit)` com filtros
    `?session=X&tool=Y&limit=50`
  - Melhorar `GET /observability/events/stream`:
    - Além de `defaultBus` hook events, também emitir via `AgentObserver` events (usando um
      `EventEmitter` intermediário do observability)
    - Heartbeat a cada 30s para manter SSE vivo com `event: ping`
- T.2 Criar `ObservabilityEventEmitter` em `observability/index.js`:
  - `EventEmitter` interno ao qual `AgentObserver` e `event-collector` emitem
  - `routes/observability.js` usa esse emitter para o SSE (desacoplado de `defaultBus`)
- T.3 Adicionar ao `observability/index.js`: `export { defaultObservabilityEmitter }`

### Fase U — Unificação de `lib/telemetry.js` com novo sistema

**Corrige**: GAP-03, GAP-10

**Objetivo**: `TelemetryStore` e `MetricsStore` convivem de forma coerente sem duplicação.
`introspection-tools.js` continua funcionando via `get_telemetry` tool.

**Sub-tarefas**:

- U.1 Analisar se `always-alive.js#telemetry` (TelemetryStore) pode ser REMOVIDO e substituído por
  `defaultMetrics` (MetricsStore) — ou se precisam coexistir:
  - `introspection-tools.js` → usa `getTelemetry: () => this.#telemetry` → precisa continuar
  - `dialog-loop-manager.js` → recebe `telemetry` via `attach(host, telemetry)` → usa para?
  - Verificar se `dialog-loop-manager.js` realmente usa o `TelemetryStore` ou só armazena
- U.2 Se coexistência for necessária: criar ponte `telemetry-bridge.js` que mapeia
  `TelemetryStore.toolCalls` para callbacks no `defaultMetrics` ao mesmo tempo
- U.3 Se `dialog-loop-manager.js` usa `TelemetryStore` apenas como passagem: remover e usar
  `defaultMetrics` diretamente via import
- U.4 Desativar `lib/telemetry.js#startSpan()` quando SDK OTEL estiver ativo (GAP-10):
  - `if (isOtelEnabled()) return fn()` — skip OTEL duplicado

### Fase V — Validação e Testes

**Objetivo**: Garantir que todas as fases N-U passam nos quality gates.

**Sub-tarefas**:

- V.1 `npm run test:unit` — mínimo 2054 passando (adicionar testes para novos módulos)
- V.2 Testes novos:
  - `tests/unit/copilot/test_observability_agent_observer.spec.js`
  - `tests/unit/copilot/test_observability_metrics_dialog.spec.js`
  - `tests/unit/copilot/test_observability_audit_log.spec.js`
  - `tests/unit/copilot/test_observability_persistence.spec.js`
- V.3 `npm run lint` + `npm run typecheck:node` — zero erros
- V.4 `npm run format:check` — clean
- V.5 Commit: `feat(copilot/observability): fases N-U — dialog loop, audit-log, persistência`

---

## 4. Tabela de Dependências entre Fases

```
A (logger.js)
└─► B (aliases) ─► C (migration codemod dos 76 imports)
                   │
D (event-collector) ──────────────────────────────┐
                                                  │
E (otel.js) ─────────────────────────────────────┤
                                                  │
F (audit-log.js) ──── G (error-registry) ────────┤
                                                  │
H (telemetry-store) ── I (metrics) ──────────────┤
                                                  │
                      J (routes/observability) ◄──┘
                                                  │
                      K (index.js) ◄──────────────┘
                                                  │
                      L (backward compat) ◄───────┘
                                                  │
                      M (testes + commit) ◄────────┘
```

Fases A → B → C podem ser executadas em sequência sem bloqueio. Fases D, E, F, G, H, I são paralelas
entre si (serão executadas em ordem por simplicidade). Fase J depende de D, E, F, G, H, I. Fase K
depende de todas as anteriores.

---

## 5. Variáveis de Ambiente Novas

| Variável                            | Padrão              | Descrição                                                    |
| ----------------------------------- | ------------------- | ------------------------------------------------------------ |
| `COPILOT_LOG_LEVEL`                 | `INFO`              | Nível de log do módulo copilot (independente de `LOG_LEVEL`) |
| `COPILOT_LOG_DIR`                   | `src/copilot/logs/` | Diretório de logs do módulo copilot                          |
| `COPILOT_OTEL_ENDPOINT`             | `""`                | OTLP endpoint para tracing (se vazio, usa file exporter)     |
| `COPILOT_OTEL_EXPORTER_TYPE`        | `file`              | `file` ou `otlp-http`                                        |
| `COPILOT_OTEL_DISABLED`             | `false`             | Desabilitar OTEL completamente                               |
| `COPILOT_OTEL_CAPTURE_CONTENT`      | `false`             | Capturar conteúdo de mensagens nos spans                     |
| `COPILOT_AUDIT_MAX_BYTES`           | `10485760`          | Tamanho máximo do audit.jsonl antes de rotação               |
| `COPILOT_EVENTS_MAX_BYTES`          | `5242880`           | Tamanho máximo de events.jsonl                               |
| `COPILOT_METRICS_SNAPSHOT_INTERVAL` | `300000`            | Intervalo de snapshot de métricas (ms)                       |
| `COPILOT_ERROR_REGISTRY_MAX`        | `100`               | Máximo de erros no ring buffer                               |

---

## 6. Impacto em Outras Partes de `src/copilot`

### Sem Breaking Changes Necessários

- `lib/telemetry.js` → re-export → tudo continua funcionando
- `channel/audit.js` → thin wrapper → API pública inalterada
- `tool-audit-logger.js` → thin wrapper → API pública inalterada
- `introspection-tools.js` → usa `telemetry.js` via `setTelemetryStore()` → inalterado

### Mudanças Necessárias (mínimas)

- `agent/entry.js` → adicionar global error handlers (uncaughtException/unhandledRejection)
- `agent/always-alive.js` → chamar `initObservability(session)` após `initOrResumeSession()`
- `lib/sdk-client.js` → injetar `telemetry: buildTelemetryConfig()` no `CopilotClient`
- `src/copilot/logs/` → criar + adicionar ao `.gitignore`

---

## 7. Cenário Pós-Implementação

Após todas as fases, `src/copilot` terá:

1. **Zero dependência de `#core/logger`** — isolamento total do workspace pai
2. **Logger próprio** gravando em `src/copilot/logs/agent.log`
3. **OTEL nativo** capturando spans de todo CLI SDK em `otel-traces.jsonl`
4. **Captura de 70+ eventos SDK** via EventCollector
5. **Registro centralizado de erros** com persistência e handlers globais
6. **Auditoria JSONL** isolada em `src/copilot/logs/audit.jsonl`
7. **Métricas ricas** com histogramas de latência e contadores de tokens
8. **API HTTP completa** em `/api/sdk/observability/*` para dashboard e integração externa
9. **SSE streams** para eventos em tempo real (eventos SDK + erros + logs)
10. **Backward compatibility** total para todos os consumidores existentes
