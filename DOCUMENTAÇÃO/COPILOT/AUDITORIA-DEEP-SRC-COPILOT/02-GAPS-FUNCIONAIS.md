# 02 — GAPS FUNCIONAIS

> **Auditoria Profunda `src/copilot/`** | Data: 2026-06-11 | HEAD: `55a4b071`

---

## SUMÁRIO

| Categoria        | Quantidade |
| ---------------- | ---------- |
| Validation/Input | 18         |
| Error Handling   | 14         |
| Observability    | 12         |
| API/Protocol     | 10         |
| State Management | 8          |
| Documentation    | 6          |
| **Total**        | **68**     |

---

## G1 — GAPS DE VALIDAÇÃO / INPUT

### G1-01 — POST `/agent/inject` sem Zod schema validation
**Arquivo**: `server/routes/agent.js:45`
**Impacto**: Payload de inject (mensagem para o agente) não é validado. Strings vazias, payloads gigantes, ou tipos incorretos passam sem check.
**Fix**: Adicionar `validate({ body: injectSchema })`.

### G1-02 — POST `/agent/pipeline` sem schema validation
**Arquivo**: `server/routes/agent.js:48`
**Fix**: Schema para pipeline commands.

### G1-03 — POST `/agent/dialog/pause` sem body validation
**Arquivo**: `server/routes/agent.js:51`

### G1-04 — POST `/agent/dialog/resume` sem body validation
**Arquivo**: `server/routes/agent.js:52`

### G1-05 — POST `/agent/dialog/answer-question` sem body validation
**Arquivo**: `server/routes/agent.js:55`
**Impacto**: Answer sem validação permite strings vazias ou payloads malformados.

### G1-06 — POST `/agent/dialog/steer` sem body validation
**Arquivo**: `server/routes/agent.js:59`

### G1-07 — POST `/memory` sem body validation
**Arquivo**: `server/routes/memory.js:41`
**Impacto**: Memory store aceita qualquer payload.

### G1-08 — DELETE `/memory/:id` sem params validation
**Arquivo**: `server/routes/memory.js:44`

### G1-09 — PUT `/config/infinite-session` sem body validation
**Arquivo**: `server/routes/config.js:44`

### G1-10 — PUT `/config/skills` sem body validation
**Arquivo**: `server/routes/config.js:45`

### G1-11 — PUT `/config/tools` sem body validation
**Arquivo**: `server/routes/config.js:46`

### G1-12 — POST `/config/tools/custom` sem body validation
**Arquivo**: `server/routes/config.js:49`

### G1-13 — DELETE `/config/tools/custom/:name` sem params validation
**Arquivo**: `server/routes/config.js:52`

### G1-14 — POST `/observability/system/reset` sem corpo esperado mas sem validação
**Arquivo**: `server/routes/observability.js:66`

### G1-15 — POST `/sessions/:sessionId/send` sem body validation
**Arquivo**: `server/routes/sessions.js:80`
**Impacto**: Mensagens ao agente sem validação de formato/tamanho.

### G1-16 — DELETE `/sessions/:sessionId` sem params format validation
**Arquivo**: `server/routes/sessions.js:101`

### G1-17 — DELETE `/webhooks/:id` sem params format validation
**Arquivo**: `server/routes/webhooks.js:74`

### G1-18 — Nenhum endpoint possui max body size limit explícito
**Impacto**: Sem `express.json({ limit: '1mb' })` explícito, default é 100KB mas não documentado/testado.

---

## G2 — GAPS DE ERROR HANDLING

### G2-01 — Nenhum error handler middleware global registrado
**Evidência**: `grep 'app.use.*err' → 0 resultados`
**Impacto**: Erros não capturados retornam stack trace completo para o cliente (information disclosure).
**Fix**: Adicionar `app.use((err, req, res, next) => ...)` no final da chain.

### G2-02 — `bridgeHandler()` swallows errors silenciosamente
**Arquivo**: `server/handler-bridge.js`
**Impacto**: Se o terminal handler throw, o bridge pode não propagar corretamente para o Express error handler.

### G2-03 — Socket.IO namespace sem error middleware
**Impacto**: Erros em event handlers do Socket.IO não são capturados — potencial crash do handler.

### G2-04 — `processQueue` sem circuit breaker
**Arquivo**: `agent/queue-processor.js`
**Impacto**: Se cada task falhar, a queue continua processando infinitamente sem backoff.

### G2-05 — `tryReconnect` sem max failures global
**Arquivo**: `agent/lifecycle/agent-lifecycle.js`
**Impacto**: maxAttempts é per-call. Sem counter global, reconexões podem ser infinitas via retry loops.

### G2-06 — Sem unhandledRejection handler no processo
**Impacto**: Promise rejections não capturadas podem silenciosamente matar a aplicação em Node 24+.

### G2-07 — Sem graceful shutdown handler para SIGTERM/SIGINT
**Impacto**: `process.exit()` em 8 locais sem cleanup orchestration.

### G2-08 — `turn-executor.js:116,180` — Nested promise.resolve/reject pattern
**Impacto**: Se o callback dentro de `new Promise` throw antes de chamar resolve/reject, a promise fica pending forever.

### G2-09 — `backpressure.js` mutex sem deadlock detection
**Impacto**: Se o holder da mutex never resolves, toda operação subsequente stalls.

### G2-10 — `quota-monitor.js` sem staleness TTL
**Impacto**: Quota info pode ficar stale por horas sem warning.

### G2-11 — `error-alerting.js` sem self-healing
**Impacto**: Se o alert check itself errors, sem recovery mechanism.

### G2-12 — `store.js` SQLite errors não propagados para callers
**Impacto**: Store operations fail silently.

### G2-13 — Hooks pipeline sem timeout per-hook
**Impacto**: Um hook lento bloqueia toda a pipeline.

### G2-14 — WebSocket reconnect sem jitter
**Impacto**: Thundering herd problem se múltiplos clients tentam reconnect simultaneamente.

---

## G3 — GAPS DE OBSERVABILIDADE

### G3-01 — Nenhuma métrica de latência de request HTTP
**Fix**: Middleware histogram para request duration.

### G3-02 — Nenhuma métrica de filas (queue depth, wait time)
**Fix**: Expor `queueSize`, `avgWaitMs` via métricas.

### G3-03 — Sem health check de subsistema individual
**Status**: Apenas GET `/health` global existe (Onda 5.9 adicionou `/health/modules` mas cobertura incompleta).

### G3-04 — Sem métricas de event bus (events/sec, event lag)
**Fix**: Instrumentar EventBus.emit() com counter e histogram.

### G3-05 — Sem alerting de memory usage
**Fix**: Monitorar `process.memoryUsage().heapUsed` periodicamente.

### G3-06 — Sem log rotation configurada em logger.js
**Impacto**: Logs crescem sem bound em sessões longas.

### G3-07 — Sem tracing distribuído (apenas spans locais)
**Impacto**: Impossível correlacionar requests entre inject → agent → dialog → response.

### G3-08 — Sem métricas de tools (duration, success/failure per tool)
**Status**: `tool_stats` collector existe mas não expõe histograms.

### G3-09 — Sem dashboard endpoint para métricas aggregadas
**Fix**: Endpoint `/metrics` ou Prometheus exposition.

### G3-10 — Sem profiling de event loop lag
**Fix**: `perf_hooks.monitorEventLoopDelay()` — disponível desde Node 12.

### G3-11 — Sem audit trail de config changes
**Fix**: Logar antes/depois de cada config mutation.

### G3-12 — Sem métricas de snapshot operations (frequência, tamanho, duração)
**Fix**: Contadores em snapshot.js.

---

## G4 — GAPS DE API/PROTOCOLO

### G4-01 — Sem versionamento de API
**Impacto**: Breaking changes não podem ser introduzidas gradualmente.
**Fix**: Prefixo `/v1/` nas rotas.

### G4-02 — Sem OpenAPI schema validation runtime
**Status**: `openapi.json` existe (92 paths, Onda 5.3) mas não é usado para validação runtime.

### G4-03 — Sem rate limiting em rotas de leitura
**Impacto**: GET `/status`, `/health`, `/metrics` sem limite.

### G4-04 — Sem pagination em endpoints de lista
**Impacto**: `/sessions`, `/webhooks`, `/memory` retornam tudo sem limit/offset.

### G4-05 — Sem ETag/Cache-Control para GET endpoints
**Fix**: Adicionar ETag em status snapshot, session list.

### G4-06 — Sem request ID propagation
**Fix**: Middleware `X-Request-Id` para correlação de logs.

### G4-07 — Sem idempotency keys em POST endpoints
**Fix**: Header `Idempotency-Key` para operações create.

### G4-08 — Sem HTTPS enforcement
**Impacto**: Operação em loopback mitiga mas não elimina risco.

### G4-09 — SSE reconnection sem last-event-id
**Impacto**: Clients que reconectam perdem eventos intermediários.

### G4-10 — WebSocket protocol sem versioning
**Impacto**: Sem negotiation de versão entre client/server.

---

## G5 — GAPS DE STATE MANAGEMENT

### G5-01 — State file sem lock (race entre processos)
**Impacto**: Se PM2 rodar múltiplos processos, state.json corrompe.

### G5-02 — State cache sem invalidação cross-process
**Impacto**: Process A escreve, Process B usa cache stale.

### G5-03 — Snapshot pruning sem trigger automático
**Impacto**: Snapshots acumulam sem limpeza.

### G5-04 — Session history sem trim automático
**Impacto**: Sessions com milhares de messages crescem sem bound.

### G5-05 — Todo/task store sem expiration automática
**Impacto**: Tasks antigas acumulam no SQLite.

### G5-06 — Config store sem schema validation on write
**Impacto**: Config inválida aceita, falha no próximo boot.

### G5-07 — Hub conversation store sem checksum/integrity
**Impacto**: Corrupção silenciosa detectada apenas na leitura.

### G5-08 — Memory store sem dedup
**Impacto**: Memórias duplicadas acumulam.

---

## G6 — GAPS DE DOCUMENTAÇÃO INTERNA

### G6-01 — `config/env.js` — 27+ exports sem JSDoc (`@param`, `@returns`, `@type`)
### G6-02 — 169 exports sem JSDoc em todo o codebase
### G6-03 — Sem ADRs (Architecture Decision Records)
### G6-04 — Sem runbook operacional
### G6-05 — Sem changelog de config changes
### G6-06 — Sem mapa de events (quem emite, quem escuta cada tipo)

---

*68 gaps identificados. Próximo: 03-SEGURANCA.md*
