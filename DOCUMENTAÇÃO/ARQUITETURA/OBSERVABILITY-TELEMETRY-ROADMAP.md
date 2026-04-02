# Observabilidade, Telemetria e Logging — Análise e Roadmap

**Status**: Canônico — Problema prioritário de isolamento arquitetural **Última atualização**:
2026-06-XX **Escopo**: `src/copilot/` — isolamento total + sistema centralizado robusto

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

### Fase M — Testes, Lint, Typecheck, Commit

**Objetivo**: Validação completa antes de commit.

**Sub-tarefas**:

- M.1 `npm run test:unit` — todos os 2054+ testes passando
- M.2 `npm run lint` — zero erros
- M.3 `npm run typecheck:node` — zero erros
- M.4 `npm run format:check` — clean
- M.5 Criar/atualizar testes para os novos módulos de observability:
  - `tests/unit/copilot/test_observability_logger.spec.js`
  - `tests/unit/copilot/test_observability_telemetry.spec.js`
  - `tests/unit/copilot/test_observability_error_registry.spec.js`
- M.6 Commit: `feat(observability): módulo isolado de observabilidade + migração #core/logger`

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
