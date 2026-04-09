# PARTE-16E — Roadmap de Execução: Hardening Total do Copilot

**Data**: 2026-04-08
**Baseline**: commit `bfe96b57`
**Pré-requisitos**: PARTE-16A/B/C/D lidos e validados
**Escopo**: Todo `src/copilot/` (260 arquivos, 45.750 linhas)
**Convenção de fases**: F121-F250 (continuação da numeração PARTE-14E)

---

## Sumário de Faixas

| Faixa | Fases     | Título                                  | Foco Principal                          |
| ----: | --------- | --------------------------------------- | --------------------------------------- |
|     1 | F121-F130 | Foundation Hardening                    | core/ expansion, FS async, shutdown     |
|     2 | F131-F138 | Security Hardening                      | execSync, auth, SSRF, origin            |
|     3 | F139-F148 | Error Handling Standardization          | catch blocks, error flow, logging       |
|     4 | F149-F156 | Timer & Lifecycle Management            | setInterval cleanup, timer registry     |
|     5 | F157-F168 | Conversation-Hub: Testes + Decomposição | 0→100% test coverage, god module split  |
|     6 | F169-F178 | Bridges: Testes + Retry Migration       | 0→100% test coverage, centralizar retry |
|     7 | F179-F192 | Terminal Hardening + Decomposição       | 5 god modules, server security, tests   |
|     8 | F193-F206 | Tools Decomposição + Testes             | 3 god modules, security, +10 testes     |
|     9 | F207-F216 | Observability: Testes + Cleanup         | catch blocks, metrics reset, OTEL tests |
|    10 | F217-F228 | God Module Decomposição Tier-2          | 450-600L files decomposition            |
|    11 | F229-F238 | God Module Decomposição Tier-3          | 400-450L files decomposition            |
|    12 | F239-F244 | Performance Hardening                   | FS async final, memory management       |
|    13 | F245-F248 | API Consistency + Padronização Final    | Error responses, logging, patterns      |
|    14 | F249-F250 | Coverage Targets + CI + Relatório Final | Thresholds, CI gates, PARTE-17B report  |

**Total: 14 faixas, 130 fases (F121-F250)**

---

## Faixa 1 — Foundation Hardening (F121-F130) ✅ CONCLUÍDA

> **Objetivo**: Expandir o layer `core/` com utilitários centralizados que serão
> usados por todas as faixas subsequentes.
>
> **Commit**: `b16b1ec5` + fixup — 261 suites, 2381 tests, 0 failures.
> **Métricas**: FS sync 84→73 (-11), process.on 16→13 (-3), +39 tests novos.

### F121: Criar `core/safe-json.js` ✅
- **F121.1**: ✅ `safeJsonParse` já existia — mantido e testado
- **F121.2**: ✅ `safeJsonStringify(obj, indent?)` implementado — nunca throws, retorna `'{}'`
- **F121.3**: ✅ JSDoc completo com `@param`, `@returns`, `@throws`
- **F121.4**: ✅ 17 testes unitários (circular refs, null, undefined, array, string, empty)
- **Resultado**: ✅ 17 testes, integrado em state-io e alias-store

### F122: Criar `core/timer-registry.js` ✅
- **F122.1**: ✅ Singleton via module-level Map (registerTimer, cancel, cancelAll, activeCount)
- **F122.2**: ✅ `registerTimer(id, type, handle)` e `cancelAll()` implementados
- **F122.3**: ✅ `registerShutdownHandler('timers.cancelAll', ..., 5)` via lazy init
- **F122.4**: ✅ `_resetForTesting()` limpa Map e reseta flag de shutdown
- **F122.5**: ✅ 9 testes unitários (register timeout/interval, cancel, cancelAll, same-id replace)
- **Resultado**: ✅ Barrel export em core/index.js com aliases (cancelTimer, cancelAllTimers, activeTimerCount)

### F123: Criar `core/circuit-breaker.js` ✅
- **F123.1**: ✅ `CircuitBreaker(name, opts)` com private fields (#state, #failCount, etc.)
- **F123.2**: ✅ Options: failThreshold(5), resetTimeoutMs(30000), halfOpenMax(2)
- **F123.3**: ✅ `execute(fn)` throws `CircuitOpenError` (extends CopilotError, code CIRCUIT_OPEN)
- **F123.4**: ✅ `getState()`, `reset()` implementados
- **F123.5**: ✅ 11 testes unitários (states, transitions, threshold, timeout, halfOpenMax, reset)
- **Resultado**: ✅ Barrel export em core/index.js

### F124: Migrar `snapshot.js` para FS async ✅
- **F124.1**: ⚪ Sync versions mantidas como @deprecated (callers sync em tests)
- **F124.2**: ⚪ Async versions (saveSnapshotAsync etc.) já existiam desde F69
- **F124.3**: ✅ `existsSync` removido de async paths → `access` com try/catch
- **F124.4**: ⚪ `mkdirSync` → `mkdir` já feito nas versões async
- **F124.5**: ⚪ Callers async já usam await
- **F124.6**: ⚪ Testes existentes cobrem snapshot CRUD
- **Resultado**: ✅ Async paths 100% sem sync FS (import de `access` adicionado)

### F125: Migrar `write-tools.js` para FS async ✅
- **F125.1**: ✅ writeFileSync → atomicWrite (write temp + rename) em 3 handlers
- **F125.2**: ✅ readFileSync → readFile
- **F125.3**: ✅ existsSync → access com try/catch em 5 locais
- **F125.4**: ✅ Atomic write pattern: `atomicWrite(path, content, encoding)` — temp file + rename
- **F125.5**: ✅ Todos os handlers já eram async
- **Resultado**: ✅ 0 FS sync calls em write-tools.js, atomic writes protegem contra corrupção

### F126: Migrar `state-io.js` para FS async ✅
- **F126.1**: ✅ Identificado: readState/writeState sync são @deprecated, readStateAsync/writeStateAsync são async
- **F126.2**: ✅ Versões async já existiam desde F69/F91
- **F126.3**: ✅ Sync mantidas com `@deprecated` para callers síncronos
- **F126.4**: ✅ `safeJsonParse` integrado em `readState()` via import de `core/safe-json.js`
- **F126.5**: ⚪ Testes existentes cobrem state-io
- **Resultado**: ✅ safeJsonParse integrado, async versions 100% sem sync

### F127: Migrar `file-context.js` para FS async ✅
- **F127.1-F127.5**: ✅ Já 100% async — 0 sync calls encontradas
- **Resultado**: ✅ Nenhuma migração necessária

### F128: Migrar `alias-store.js` para FS async ✅
- **F128.1**: ⚪ readFileSync em loadAliases mantido (sync @deprecated, usar loadAliasesAsync)
- **F128.2**: ✅ writeFileSync em saveCustomAliases → fire-and-forget via _saveCustomAliasesAsync
- **F128.3**: ✅ `safeJsonParse` integrado em `loadAliases()` via import
- **F128.4**: ⚪ Testes existentes em alias-store
- **Resultado**: ✅ -1 writeFileSync eliminado, safeJsonParse integrado

### F129: Integrar shutdown em módulos restantes ✅
- **F129.1**: ✅ `terminal/index.js` → registerShutdownHandler('terminal.injectServer', close, 20)
- **F129.2**: ⚪ `channel/inject.js` — sem cleanup explícito necessário (HTTP client only)
- **F129.3**: ⚪ `socket-ns.js` — sem cleanup (not a standalone server)
- **F129.4**: ⚪ `conversation-hub/hub.js` — in-memory, sem cleanup de conexão
- **F129.5**: ⚪ `always-alive.js` — sem process.on manual (usa entry.js)
- **F129.6**: ✅ `audit/pipeline.js` — process.once('beforeExit') → registerShutdownHandler('audit.flush', ..., 90)
- **F129.7**: ⚪ Testes de ordering cobertos por test_core_shutdown.spec.js existente
- **Resultado**: ✅ -2 process.on/once, +2 registerShutdownHandler, reflection timer via shutdown

### F130: Validação de Faixa 1 ✅
- **F130.1**: ✅ `npm run lint` — zero errors
- **F130.2**: ⚪ Prettier warnings pré-existentes em docs (fora do escopo)
- **F130.3**: ✅ 261 suites, 2381 tests, 0 failures (+39 novos)
- **F130.4**: ⚪ FS sync: 73 (meta <40 requer migração de módulos adicionais em faixas futuras)
- **F130.5**: ⚪ process.on: 13 (meta ≤5 requer migração de entry.js e error-tracker em faixas futuras)
- **F130.6**: ✅ Commit: `b16b1ec5` — feat(hardening): Faixa 1 (F121-F130)

---

## Faixa 2 — Security Hardening (F131-F138) ✅ CONCLUÍDA

> **Objetivo**: Eliminar todos os SEC issues de severidade média identificados
> na PARTE-16B.
>
> **Métricas**: 263 suites, 2424 tests, 0 failures (+43 novos testes).

### F131: Migrar `session-tools.js` de execSync para execFileSync ✅
- **F131.1**: ✅ `execSync('git rev-parse --abbrev-ref HEAD')` → `execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'])`
- **F131.2**: ✅ `execSync('git rev-parse --show-toplevel')` → `execFileSync('git', ['rev-parse', '--show-toplevel'])`
- **F131.3**: ✅ `execSync('git rev-parse --short HEAD')` → `execFileSync('git', ['rev-parse', '--short', 'HEAD'])`
- **F131.4**: ✅ `timeout: 5000` mantido em todas as chamadas
- **F131.5**: ✅ 2 testes: git info sem injection + verificação que execSync não é importado
- **Resultado**: ✅ SEC-01 eliminado — shell metacaracteres não são mais interpretados

### F132: Hardening de auth em `socket-ns.js` ✅
- **F132.1**: ✅ Schema Zod `HandshakeAuthSchema` (token: string 10-8192 chars)
- **F132.2**: ✅ Middleware JWT já existia — agora com validação Zod antes do verify
- **F132.3**: ✅ Rate limiting por socket ID + IP já existia (inject rate limiter)
- **F132.4**: ✅ Log de IP em tentativas de auth inválidas
- **F132.5**: ⚪ Testes manuais (require Socket.IO server mock — complexo)
- **Resultado**: ✅ SEC-02, SEC-06 — token malformado rejeitado antes de JWT verify

### F133: Origin validation em `terminal/server.js` ✅
- **F133.1**: ⚪ CORS wildcard mantido — server bind em 127.0.0.1 (loopback only, seguro)
- **F133.2**: ⚪ Sem WebSocket upgrade handler (HTTP puro, sem upgrade)
- **F133.3**: ⚪ N/A — sem origins externos (loopback)
- **F133.4**: ✅ Stack traces sanitizados: produção loga apenas mensagem, 500 retorna generic message
- **F133.5**: ⚪ Testes de origin N/A (loopback only justifica wildcard CORS)
- **Resultado**: ✅ SEC-03 — stack trace sanitizado, CORS justificado por binding

### F134: Symlink protection em `file/read-tools.js` ✅ (pré-existente)
- **F134.1**: ✅ `fs.promises.realpath()` já implementado em `shared.js` (SEC-04 / BUG-H06 / F3.4)
- **F134.2**: ✅ Rejeição de paths fora do workspace após realpath
- **F134.3**: ✅ Log implícito via `validatePath()` return `{ ok: false, reason }`
- **F134.4**: ⚪ Testes existentes em test_shell_tools.spec.js (cwd traversal) + test_shell_sandbox.spec.js
- **Resultado**: ✅ SEC-04, SEC-08 — já implementado desde F3.4

### F135: Timeout ceiling em `web-tools.js` ✅ (pré-existente)
- **F135.1**: ✅ AbortController com timeout de 10s (max 30s via parâmetro)
- **F135.2**: ⚪ Usa AbortController nativo (não withTimeout — equivalente)
- **F135.3**: ✅ validateUrl rejeita schemes não-http (file://, ftp://)
- **F135.4**: ✅ validateUrl bloqueia 127.x, 10.x, 172.16-31.x, 192.168.x, 169.254.x, ::1, fd, fe80
- **F135.5**: ⚪ Testes existentes em url-validator.spec.js
- **Resultado**: ✅ SEC-05, SEC-09 — SSRF protection completa

### F136: Sanitizar error responses em `api/` ✅
- **F136.1**: ✅ `sanitizeErrorMessage()` em middleware.js — produção retorna generic, dev strip paths
- **F136.2**: ⚪ Status codes já eram 500 via `withErrorHandler` (padronizado)
- **F136.3**: ✅ Paths `/workspaces/` e `/home/` removidos de mensagens em dev
- **F136.4**: ✅ 1 teste: módulo exporta withErrorHandler
- **Resultado**: ✅ SEC-10, SEC-11 — mensagens de erro sanitizadas

### F137: Audit de `shell/sandbox.js` regex ✅
- **F137.1**: ✅ Revisão completa: 25 BLOCKED_COMMAND_PATTERNS auditados
- **F137.2**: ✅ 40 testes de edge cases (hasShellMetaOutsideQuotes, checkCommandBlocklist, validateCwd)
- **F137.3**: ✅ Deny-list verificada contra OWASP: rm -rf, sudo, eval, curl|bash, wget|sh, dd, chmod 777, etc.
- **F137.4**: ✅ Documentado via JSDoc e test descriptions
- **Resultado**: ✅ SEC-06 — sandbox regex hardened com cobertura de testes

### F138: Validação de Faixa 2 ✅
- **F138.1**: ✅ `npm run lint` — zero errors
- **F138.2**: ✅ 263 suites, 2424 tests, 0 failures
- **F138.3**: ✅ Zero SEC issues médias restantes (SEC-01..SEC-11 eliminados/validados)
- **F138.4**: ⚪ SECURITY.md existente (sem alterações necessárias)
- **F138.5**: ✅ Commit: `fix(security): Faixa 2 (F131-F138) — security hardening`

---

## Faixa 3 — Error Handling Standardization (F139-F148)

> **Objetivo**: Auditar e corrigir os ~133 catch blocks, padronizar error flow.

### F139: Criar `core/error-handlers.js` utility
- **F139.1**: `logSwallowed(err, context)` — log warn + métricas sem rethrow
- **F139.2**: `wrapAsync(fn)` — wrapper que captura e loga erros não-críticos
- **F139.3**: `isFatalError(err)` — classifica erros em fatal vs recoverable
- **F139.4**: Testes unitários

### F140: Corrigir catch blocks em `observability/`
- **F140.1**: `otel.js` — 4 catch {} → adicionar `logSwallowed(err, 'otel.init')`
- **F140.2**: `event-collector.js` — 3 catch {} → adicionar `logSwallowed`
- **F140.3**: `metrics.js` — catch {} → `logSwallowed(err, 'metrics.export')`
- **F140.4**: `agent-event-observer.js` — verificar e padronizar
- **F140.5**: `tool-stats.js` — adicionar metric counter para erros silenciados
- **Resultado**: ~10 catch blocks corrigidos

### F141: Corrigir catch blocks em `tools/`
- **F141.1**: Auditar 25 catch blocks em tools/
- **F141.2**: Substituir catch silenciosos por `logSwallowed` onde seguro
- **F141.3**: Adicionar rethrow onde o erro deveria propagar
- **F141.4**: Padronizar error messages com contexto (tool name, args summary)
- **Resultado**: ~25 catch blocks corrigidos

### F142: Corrigir catch blocks em `terminal/`
- **F142.1**: Auditar 22 catch blocks em terminal/
- **F142.2**: Substituir catch {} por `logSwallowed` em handlers
- **F142.3**: Garantir que erros em comandos REPL são reportados ao usuário
- **F142.4**: Padronizar error messages em server/WebSocket handlers
- **Resultado**: ~22 catch blocks corrigidos

### F143: Corrigir catch blocks em `agent/`
- **F143.1**: Auditar 18 catch blocks em agent/
- **F143.2**: Verificar que erros fatais propagam para session.fatal
- **F143.3**: Verificar que erros transientes são retriados (via withRetry)
- **F143.4**: Padronizar logging de erros com session context
- **Resultado**: ~18 catch blocks corrigidos

### F144: Corrigir catch blocks em `bridges/`
- **F144.1**: Auditar 15 catch blocks em bridges/
- **F144.2**: `mcp-tool-bridge.js` — padronizar com logSwallowed + metric
- **F144.3**: `nerv-bridge.js` — adicionar retry + log para erros de conexão
- **F144.4**: `git-bridge.js` — log com contexto (git command, args)
- **Resultado**: ~15 catch blocks corrigidos

### F145: Corrigir catch blocks em `channel/`
- **F145.1**: Auditar 10 catch blocks em channel/
- **F145.2**: `client.js` — erros de SSE devem propagar para retry logic
- **F145.3**: `inject.js` — erros de injeção devem ser logados com contexto
- **Resultado**: ~10 catch blocks corrigidos

### F146: Corrigir `.catch(() => {})` void patterns
- **F146.1**: Identificar 9 ocorrências de `.catch(() => {})` ou `.catch(() => void 0)`
- **F146.2**: Substituir por `.catch(err => logSwallowed(err, 'context'))`
- **F146.3**: Verificar se algum deveria ter retry ao invés de swallow
- **Resultado**: 9 void catches eliminados

### F147: Corrigir catch blocks em `hooks/`, `sdk/`, `config/`
- **F147.1**: Auditar catch blocks restantes (~15)
- **F147.2**: Aplicar mesmo padrão: logSwallowed onde safe, rethrow onde não
- **F147.3**: Cleanup final — verificar zero catch {} vazios restantes
- **Resultado**: Últimos ~15 catch blocks corrigidos

### F148: Validação de Faixa 3
- **F148.1**: `npm run lint` — zero errors
- **F148.2**: `npm run test:unit` — all pass
- **F148.3**: Grep: `catch.*{` sem log/throw/emit deveria retornar < 20
- **F148.4**: Commit: `fix(reliability): Faixa 3 (F139-F148) — error handling standardization`

---

## Faixa 4 — Timer & Lifecycle Management (F149-F156)

> **Objetivo**: Registrar todos os timers no sistema de shutdown + cleanup.

### F149: Auditar todos os timers existentes
- **F149.1**: Grep completo de setTimeout/setInterval em src/copilot
- **F149.2**: Classificar cada timer: bootstrap-only, runtime-recurring, one-shot
- **F149.3**: Identificar quais já tem cleanup e quais não
- **F149.4**: Gerar lista de migração priorizada

### F150: Integrar timers em `always-alive.js` com timer-registry
- **F150.1**: Heartbeat setInterval → `TimerRegistry.register('heartbeat', ...)`
- **F150.2**: Reconnect setTimeout → `TimerRegistry.register('reconnect', ...)`
- **F150.3**: Verificar que cancelAll() é chamado no shutdown
- **F150.4**: Testes: timer registration, cancel on shutdown

### F151: Integrar timers em `terminal/index.js`
- **F151.1**: Cleanup setInterval → `TimerRegistry.register('terminal.cleanup', ...)`
- **F151.2**: Qualquer outro timer recorrente → registry
- **F151.3**: Testes

### F152: Integrar timers em `socket-ns.js`
- **F152.1**: Heartbeat interval → `TimerRegistry.register('socket.heartbeat', ...)`
- **F152.2**: Testes

### F153: Integrar timers em `terminal/server.js`
- **F153.1**: HTTP keep-alive / server close timers → registry
- **F153.2**: Testes

### F154: Integrar timers em `loop-manager.js`
- **F154.1**: Turn timeout → `TimerRegistry.register('turn.timeout', ...)` com clearTimeout no finally
- **F154.2**: Testes

### F155: Auditar e integrar timers restantes
- **F155.1**: Varrer todos os timers restantes (~10-15 em files menores)
- **F155.2**: Migrar para registry ou documentar como safe-to-leak com `// TIMER: one-shot-safe`
- **F155.3**: Documentar decisões

### F156: Validação de Faixa 4
- **F156.1**: `npm run lint` — zero errors
- **F156.2**: `npm run test:unit` — all pass
- **F156.3**: Verificar: timers sem cleanup ≤ 3
- **F156.4**: Commit: `fix(lifecycle): Faixa 4 (F149-F156) — timer & lifecycle management`

---

## Faixa 5 — Conversation-Hub: Testes + Decomposição (F157-F168)

> **Objetivo**: Levar conversation-hub de 0 testes para cobertura adequada
> e decompor os 4 god modules.

### F157: Testes para `store-helpers.js` + `store-queries.js` + `store-memories.js`
- **F157.1**: Criar `tests/unit/copilot/conversation-hub/store-helpers.spec.js`
- **F157.2**: Testar funções de formatação e transformação
- **F157.3**: Testar queries de busca e filtragem
- **F157.4**: Testar memory storage/retrieval
- **F157.5**: ~8-10 testes

### F158: Testes para `store-sync.js` + `call-strategies.js`
- **F158.1**: Criar spec para store-sync (sincronização de estado)
- **F158.2**: Criar spec para call-strategies (seleção de modelo)
- **F158.3**: ~6-8 testes

### F159: Testes para `store.js` (561L)
- **F159.1**: Mock de SQLite (better-sqlite3 ou in-memory)
- **F159.2**: Testar CRUD operations
- **F159.3**: Testar migrations
- **F159.4**: Testar edge cases (concurrent writes, missing tables)
- **F159.5**: ~10-12 testes

### F160: Decompor `store.js` — extrair migrations
- **F160.1**: Criar `store-migrations.js` com schema + migrations
- **F160.2**: Criar `store-lifecycle.js` com init/close/cleanup
- **F160.3**: Manter `store.js` como facade com exports públicos
- **F160.4**: Atualizar imports em callers
- **F160.5**: Verificar testes passam

### F161: Testes para `orchestrator.js` (572L)
- **F161.1**: Mock de model clients
- **F161.2**: Testar model selection logic
- **F161.3**: Testar retry behavior
- **F161.4**: Testar fallback logic (model A falha → model B)
- **F161.5**: Testar timeout handling
- **F161.6**: ~10-12 testes

### F162: Decompor `orchestrator.js` — extrair model-selector
- **F162.1**: Criar `model-selector.js` — lógica de seleção de modelo
- **F162.2**: Criar `call-executor.js` — execução de chamadas
- **F162.3**: Criar `result-merger.js` — merge de resultados multi-modelo
- **F162.4**: Manter `orchestrator.js` como coordinator <300L
- **F162.5**: Verificar testes passam

### F163: Testes para `socket-ns.js` (467L)
- **F163.1**: Mock de Socket.IO
- **F163.2**: Testar auth validation
- **F163.3**: Testar event emission/listening
- **F163.4**: Testar broadcast patterns
- **F163.5**: ~8 testes

### F164: Decompor `socket-ns.js`
- **F164.1**: Criar `socket-auth.js` — middleware de autenticação
- **F164.2**: Criar `socket-events.js` — event handlers individuais
- **F164.3**: Manter `socket-ns.js` como setup/namespace definition <250L
- **F164.4**: Verificar testes passam

### F165: Testes para `hub.js` (282L)
- **F165.1**: Mock de store + orchestrator
- **F165.2**: Testar session management
- **F165.3**: Testar message routing
- **F165.4**: ~6 testes

### F166: Migrar retry em orchestrator para `core/retry.js`
- **F166.1**: Identificar padrão de retry manual
- **F166.2**: Substituir por `withRetry` com `shouldRetry` custom
- **F166.3**: Preservar model-specific retry logic (diferente por provider)
- **F166.4**: Testes de confirming same behavior

### F167: Migrar timeout em orchestrator para `core/abort-utils.js`
- **F167.1**: Substituir AbortController manual por `withTimeout`
- **F167.2**: Preservar per-model timeout configuration
- **F167.3**: Testes

### F168: Validação de Faixa 5
- **F168.1**: `npm run lint` + `npm run test:unit` — all pass
- **F168.2**: conversation-hub: 0 → ≥6 test files, ≥40 testes
- **F168.3**: God modules: 4 → ≤1 arquivo >400L
- **F168.4**: Commit: `feat(conversation-hub): Faixa 5 (F157-F168) — tests + decomposition`

---

## Faixa 6 — Bridges: Testes + Retry Migration (F169-F178)

> **Objetivo**: Levar bridges de 0 testes para cobertura adequada
> e centralizar retry/timeout.

### F169: Testes para `mcp-tool-schema.js` (137L)
- **F169.1**: Testar conversão de schema
- **F169.2**: Edge cases: schema vazio, tipos complexos
- **F169.3**: ~5 testes

### F170: Testes para `mcp-tool-bridge.js` (432L)
- **F170.1**: Mock de HTTP transport
- **F170.2**: Testar circuit breaker behavior
- **F170.3**: Testar retry behavior
- **F170.4**: Testar tool registration/discovery
- **F170.5**: ~10 testes

### F171: Migrar retry/circuit-breaker em `mcp-tool-bridge.js`
- **F171.1**: Substituir retry manual por `withRetry` com `shouldRetry` para 5xx
- **F171.2**: Substituir circuit breaker manual por `core/circuit-breaker.js`
- **F171.3**: Substituir Promise.race timeout por `withTimeout`
- **F171.4**: Verificar testes passam

### F172: Decompor `mcp-tool-bridge.js`
- **F172.1**: Extrair `mcp-serializer.js` — serialização/deserialização JSON-RPC
- **F172.2**: Manter `mcp-tool-bridge.js` como orquestrador <300L
- **F172.3**: Atualizar imports + testes

### F173: Testes para `git-bridge.js` (428L)
- **F173.1**: Mock de `execFile`
- **F173.2**: Testar cada git command wrapper
- **F173.3**: Testar error handling (non-zero exit code)
- **F173.4**: Testar timeout behavior
- **F173.5**: ~10 testes

### F174: Decompor `git-bridge.js`
- **F174.1**: Criar `git-commands.js` — individual command wrappers
- **F174.2**: Criar `git-parser.js` — output parsing
- **F174.3**: Manter `git-bridge.js` como facade <200L
- **F174.4**: Verificar testes passam

### F175: Testes para `nerv-bridge.js` (385L)
- **F175.1**: Mock de HTTP client
- **F175.2**: Testar connect/disconnect lifecycle
- **F175.3**: Testar event forwarding
- **F175.4**: ~6 testes

### F176: Adicionar retry e timeout em `nerv-bridge.js`
- **F176.1**: Adicionar `withRetry` em HTTP requests
- **F176.2**: Adicionar `withTimeout` com timeout configurável
- **F176.3**: Testes de retry/timeout behavior

### F177: Testes para `gh/` submodule
- **F177.1**: Mock de GitHub API
- **F177.2**: Testar issues, PRs, CI wrappers
- **F177.3**: Migrar retry manual em `gh/ci.js` para `withRetry`
- **F177.4**: ~8 testes

### F178: Validação de Faixa 6
- **F178.1**: `npm run lint` + `npm run test:unit` — all pass
- **F178.2**: bridges: 0 → ≥4 test files, ≥30 testes
- **F178.3**: Zero retry duplicado em bridges
- **F178.4**: Commit: `feat(bridges): Faixa 6 (F169-F178) — tests + retry migration`

---

## Faixa 7 — Terminal Hardening + Decomposição (F179-F192)

> **Objetivo**: Hardening do segundo maior subsistema (7.618L, 49 files),
> decompor 5 god modules, melhorar cobertura de testes.

### F179: Decompor `terminal/index.js` (472L)
- **F179.1**: Extrair `terminal/scheduler.js` — cleanup scheduling, cron-like tasks
- **F179.2**: Extrair `terminal/lifecycle.js` — init, shutdown, restart
- **F179.3**: Manter `terminal/index.js` como entry point <200L
- **F179.4**: Testes para scheduler e lifecycle

### F180: Decompor `terminal/dialog/engine.js` (459L)
- **F180.1**: Extrair `engine-state.js` — state management da dialog engine
- **F180.2**: Extrair `engine-transitions.js` — transition logic
- **F180.3**: Manter `engine.js` como coordinator <200L
- **F180.4**: Testes para transitions

### F181: Decompor `terminal/server.js` (447L)
- **F181.1**: Extrair `middleware-chain.js` — express middleware stack
- **F181.2**: Extrair `ws-handler.js` — WebSocket event handlers
- **F181.3**: Extrair `routes-mount.js` — route registration
- **F181.4**: Manter `server.js` como bootstrap <200L
- **F181.5**: Testes para middleware e rotas

### F182: Decompor `terminal/repl.js` (436L)
- **F182.1**: Extrair `repl-parser.js` — command parsing logic
- **F182.2**: Extrair `repl-completions.js` — auto-complete logic
- **F182.3**: Manter `repl.js` como REPL loop <200L
- **F182.4**: Testes para parser e completions

### F183: Testes para `terminal/file-context.js` (381L)
- **F183.1**: Mock de filesystem
- **F183.2**: Testar workspace scanning
- **F183.3**: Testar file classification
- **F183.4**: ~6 testes

### F184: Testes para `terminal/alias-store.js` (245L)
- **F184.1**: Testar CRUD de aliases
- **F184.2**: Testar persistência
- **F184.3**: ~5 testes

### F185: Testes para `terminal/state.js` (277L)
- **F185.1**: Testar state management
- **F185.2**: Testar serialization/deserialization
- **F185.3**: ~5 testes

### F186: Testes para `terminal/route-table.js` (279L)
- **F186.1**: Testar route registration
- **F186.2**: Testar route matching
- **F186.3**: ~5 testes

### F187: Decompor `handlers/system-metrics.js` (387L)
- **F187.1**: Criar handlers individuais: cpu, memory, disk, process
- **F187.2**: Manter `system-metrics.js` como facade <200L
- **F187.3**: Testes para cada handler

### F188: Decompor `commands/gh.js` (382L)
- **F188.1**: Split por domain: issues-cmd, prs-cmd, ci-cmd
- **F188.2**: Manter `gh.js` como command dispatcher <150L
- **F188.3**: Testes

### F189: Testes para `handlers/agent.js` (332L)
- **F189.1**: Mock de agent session
- **F189.2**: Testar cada handler
- **F189.3**: ~6 testes

### F190: Testes para `handlers/system-config.js` (326L)
- **F190.1**: Testar config display handlers
- **F190.2**: ~4 testes

### F191: Testes para `commands/session.js` (298L)
- **F191.1**: Testar session commands
- **F191.2**: ~5 testes

### F192: Validação de Faixa 7
- **F192.1**: `npm run lint` + `npm run test:unit` — all pass
- **F192.2**: terminal: 3 → ≥8 test files
- **F192.3**: God modules: 5 → ≤1 arquivo >400L em terminal/
- **F192.4**: Commit: `refactor(terminal): Faixa 7 (F179-F192) — hardening + decomposition`

---

## Faixa 8 — Tools Decomposição + Testes (F193-F206)

> **Objetivo**: Decompor 3 god modules em tools/, adicionar testes críticos.

### F193: Decompor `todo/crud-tools.js` (459L)
- **F193.1**: Criar `todo/create-tool.js` — create + create-batch
- **F193.2**: Criar `todo/update-tool.js` — update + move
- **F193.3**: Criar `todo/delete-tool.js` — delete + archive
- **F193.4**: Criar `todo/read-tool.js` — read + list
- **F193.5**: Manter `crud-tools.js` como barrel export <50L
- **F193.6**: Testes unitários por tool (~10 testes)

### F194: Decompor `todo/store.js` (421L)
- **F194.1**: Extrair `todo/store-migrations.js` — schema + migrations
- **F194.2**: Extrair `todo/store-queries-advanced.js` — queries complexas
- **F194.3**: Manter `store.js` como core CRUD + init <250L
- **F194.4**: Testes unitários (~8 testes)

### F195: Decompor `introspection-tools.js` (409L)
- **F195.1**: Criar `tools/system-introspection.js` — system info tools
- **F195.2**: Criar `tools/workspace-introspection.js` — workspace analysis tools
- **F195.3**: Criar `tools/debug-introspection.js` — debug/diagnostic tools
- **F195.4**: Manter `introspection-tools.js` como barrel <50L
- **F195.5**: Testes (~6 testes)

### F196: Testes para `file/read-tools.js` (398L)
- **F196.1**: Mock de filesystem
- **F196.2**: Testar read-file tool
- **F196.3**: Testar search-file tool
- **F196.4**: Testar path validation (symlink protection do F134)
- **F196.5**: ~8 testes

### F197: Testes para `web-tools.js` (397L)
- **F197.1**: Mock de fetch
- **F197.2**: Testar URL validation
- **F197.3**: Testar timeout behavior (do F135)
- **F197.4**: Testar SSRF protection
- **F197.5**: ~6 testes

### F198: Testes para `shell/index.js` (359L)
- **F198.1**: Mock de execFile
- **F198.2**: Testar command execution
- **F198.3**: Testar sandbox enforcement
- **F198.4**: ~6 testes

### F199: Testes para `hub-tools.js` (344L)
- **F199.1**: Mock de conversation hub
- **F199.2**: Testar tool wrappers
- **F199.3**: ~5 testes

### F200: Testes para `hook-tools.js` (329L)
- **F200.1**: Mock de hook runner
- **F200.2**: Testar hook management tools
- **F200.3**: ~5 testes

### F201: Testes para `todo/query-tools.js` (323L)
- **F201.1**: Setup de test database
- **F201.2**: Testar query tools
- **F201.3**: ~6 testes

### F202: Testes para `file/write-tools.js` (305L)
- **F202.1**: Mock de filesystem (tmpdir)
- **F202.2**: Testar write, append, delete operations
- **F202.3**: Testar atomic write (do F125)
- **F202.4**: ~6 testes

### F203: Testes para `session-rpc-tools.js` (297L)
- **F203.1**: Mock de session
- **F203.2**: Testar RPC wrappers
- **F203.3**: ~5 testes

### F204: Testes para `git/index.js` (272L)
- **F204.1**: Mock de execFile
- **F204.2**: Testar git tool wrappers
- **F204.3**: ~5 testes

### F205: Testes para `todo/bulk-tools.js` (267L)
- **F205.1**: Setup de test database
- **F205.2**: Testar bulk operations
- **F205.3**: ~4 testes

### F206: Validação de Faixa 8
- **F206.1**: `npm run lint` + `npm run test:unit` — all pass
- **F206.2**: tools: 6 → ≥15 test files, +60 testes
- **F206.3**: God modules: 3 → 0 em tools/
- **F206.4**: Commit: `refactor(tools): Faixa 8 (F193-F206) — decomposition + tests`

---

## Faixa 9 — Observability: Testes + Cleanup (F207-F216)

> **Objetivo**: Corrigir catch blocks em observability/,
> testar collectors e observers, resetar metrics.

### F207: Testes para `observability/otel.js`
- **F207.1**: Mock de OpenTelemetry SDK
- **F207.2**: Testar init com OTEL disponível vs ausente
- **F207.3**: Testar span creation
- **F207.4**: ~5 testes

### F208: Testes para `observability/metrics.js` (419L)
- **F208.1**: Testar counter increment/reset
- **F208.2**: Testar metric export
- **F208.3**: Testar memory bounds (metric reset após threshold)
- **F208.4**: ~6 testes

### F209: Implementar metric reset em `metrics.js`
- **F209.1**: Adicionar `resetCounters()` — limpa contadores antigos
- **F209.2**: Integrar com timer: auto-reset a cada 1h (via timer-registry)
- **F209.3**: Preservar totais acumulados em summary metric separada
- **F209.4**: Testes

### F210: Testes para `event-collector.js` (386L)
- **F210.1**: Testar event collection
- **F210.2**: Testar bounded buffer (max events)
- **F210.3**: ~5 testes

### F211: Implementar bounded buffer em `event-collector.js`
- **F211.1**: Adicionar `maxEvents` option (default: 10000)
- **F211.2**: Evict oldest events quando buffer cheio (ring buffer pattern)
- **F211.3**: Log metric quando evictions ocorrem
- **F211.4**: Testes

### F212: Testes para `observers/dialog-task-handlers.js` (424L)
- **F212.1**: Mock de event bus
- **F212.2**: Testar cada handler individualmente
- **F212.3**: ~8 testes

### F213: Decompor `observers/dialog-task-handlers.js` (424L)
- **F213.1**: Split por categoria de evento: turn, tool, session
- **F213.2**: Manter facade <150L
- **F213.3**: Atualizar testes

### F214: Testes para `collectors/session-handlers.js` (391L)
- **F214.1**: Mock de session events
- **F214.2**: Testar cada collector
- **F214.3**: ~6 testes

### F215: Testes para `tool-stats.js`, `agent-event-observer.js`
- **F215.1**: ~4 testes cada = ~8 testes totais

### F216: Validação de Faixa 9
- **F216.1**: `npm run lint` + `npm run test:unit` — all pass
- **F216.2**: observability: 1 → ≥6 test files, +35 testes
- **F216.3**: Catch blocks vazios em observability: ≤2
- **F216.4**: Commit: `feat(observability): Faixa 9 (F207-F216) — tests + cleanup`

---

## Faixa 10 — God Module Decomposição Tier-2 (F217-F228)

> **Objetivo**: Decompor os god modules de 450-600L que não foram
> endereçados nas faixas anteriores.

### F217: Decompor `always-alive.js` (619L)
- **F217.1**: Extrair `health-checker.js` — lógica de health/heartbeat
- **F217.2**: Extrair `reconnect-policy.js` — política de reconexão
- **F217.3**: Extrair `state-sync.js` — sincronização de state com bridges
- **F217.4**: Manter `always-alive.js` como facade <350L
- **F217.5**: Atualizar testes existentes

### F218: Decompor `loop-manager.js` (597L)
- **F218.1**: Extrair `prompt-builder.js` — construção de prompts
- **F218.2**: Extrair `turn-reducer.js` — redução/merge de turn results
- **F218.3**: Extrair `tool-dispatcher.js` — despacho de tool calls
- **F218.4**: Manter `loop-manager.js` como loop core <300L
- **F218.5**: Atualizar testes existentes

### F219: Decompor `channel/client.js` (556L)
- **F219.1**: Extrair `client-health.js` — health check logic
- **F219.2**: Extrair `client-batch.js` — batch request handling
- **F219.3**: Extrair `client-error.js` — error recovery patterns
- **F219.4**: Manter `client.js` como core HTTP <300L
- **F219.5**: Testes para novos módulos

### F220: Decompor `audit/pipeline.js` (530L)
- **F220.1**: Extrair `phase-runner.js` — execução de fases
- **F220.2**: Extrair `report-formatter.js` — formatação de relatórios
- **F220.3**: Manter `pipeline.js` como orchestrator <250L
- **F220.4**: Testes

### F221: Decompor `sdk/client.js` (413L)
- **F221.1**: Extrair `sdk-streaming.js` — SSE streaming logic
- **F221.2**: Extrair `sdk-model-ops.js` — model operations
- **F221.3**: Manter `client.js` como session/auth <250L
- **F221.4**: Testes

### F222: Testes para `channel/sse-client.js` (141L)
- **F222.1**: Mock de SSE connection
- **F222.2**: ~4 testes

### F223: Testes para `channel/client-dialog.js` (114L)
- **F223.1**: ~3 testes

### F224: Testes para `channel/inject.js` (451L) pós-decomposição de F219
- **F224.1**: Testar injeção de scripts
- **F224.2**: ~5 testes

### F225: Decompor `channel/inject.js` (451L)
- **F225.1**: Extrair `inject-state.js` — state management
- **F225.2**: Extrair `inject-lifecycle.js` — init/cleanup
- **F225.3**: Manter `inject.js` <250L
- **F225.4**: Testes

### F226: Testes para `hooks/factory.js` (402L)
- **F226.1**: Testar hook criação, merge, validação
- **F226.2**: ~6 testes

### F227: Decompor `hooks/factory.js` (402L)
- **F227.1**: Extrair `hook-validators.js` — validação de hook config
- **F227.2**: Extrair `hook-merger.js` — merge de preset + custom hooks
- **F227.3**: Manter `factory.js` como factory pattern <200L
- **F227.4**: Testes

### F228: Validação de Faixa 10
- **F228.1**: `npm run lint` + `npm run test:unit` — all pass
- **F228.2**: Arquivos >450L: ≤5
- **F228.3**: Commit: `refactor(decomposition): Faixa 10 (F217-F228) — tier-2 god modules`

---

## Faixa 11 — God Module Decomposição Tier-3 (F229-F238)

> **Objetivo**: Decompor os god modules de 400-450L restantes.

### F229: Decompor `observability/metrics.js` (419L) — se ainda >350L após F209
- **F229.1**: Extrair `metric-collectors.js` — collection logic
- **F229.2**: Extrair `metric-exporters.js` — export/display logic
- **F229.3**: Manter `metrics.js` como facade <200L

### F230: Decompor `file/read-tools.js` (398L) — se não feito em F195
- **F230.1**: Criar `read-file-tool.js`, `search-file-tool.js`, `glob-tool.js`
- **F230.2**: Manter barrel export

### F231: Decompor `tools/web-tools.js` (397L)
- **F231.1**: Criar `web-fetch-tool.js`, `web-scrape-tool.js`
- **F231.2**: Manter barrel export

### F232: Testes adicionais para `shell/sandbox.js` (221L)
- **F232.1**: Testes para edge cases de regex
- **F232.2**: Testes de comando injection patterns
- **F232.3**: ~6 testes

### F233: Testes para `session-rpc-tools.js` (297L) — se não feito em F203
- **F233.1**: ~5 testes

### F234: Testes para `commands/context.js` (170L)
- **F234.1**: ~3 testes

### F235: Testes para `hooks/presets/` (múltiplos arquivos)
- **F235.1**: Testar cada preset de hook
- **F235.2**: ~6 testes

### F236: Testes para `api/` endpoints restantes
- **F236.1**: Testar cada rota REST
- **F236.2**: ~5 testes

### F237: Testes para `sdk/` restantes
- **F237.1**: Testar SDK client operations
- **F237.2**: ~4 testes

### F238: Validação de Faixa 11
- **F238.1**: `npm run lint` + `npm run test:unit` — all pass
- **F238.2**: Arquivos >400L: ≤10
- **F238.3**: Commit: `refactor(cleanup): Faixa 11 (F229-F238) — tier-3 god modules`

---

## Faixa 12 — Performance Hardening (F239-F244)

> **Objetivo**: Finalizar migração FS async, gerenciar memory bounds.

### F239: FS Async — cleanup final
- **F239.1**: Grep `readFileSync|writeFileSync|existsSync` em src/copilot
- **F239.2**: Categorizar: runtime vs init vs shutdown
- **F239.3**: Migrar todos os runtime para async
- **F239.4**: Marcar init/shutdown com `// FS-SYNC: init-time-safe` ou `// FS-SYNC: shutdown-safe`
- **F239.5**: Alvo: ≤10 FS sync calls restantes

### F240: Memory bounds para arrays/maps unbounded
- **F240.1**: `event-collector.js` — ring buffer com maxEvents (confirmar F211)
- **F240.2**: `metrics.js` — reset periódico (confirmar F209)
- **F240.3**: Logger buffer — flush com maxSize
- **F240.4**: Tool history arrays — max entries com eviction
- **F240.5**: Testes de bounded behavior

### F241: Otimizar `file-context.js` workspace scan
- **F241.1**: Implementar cache com TTL (evitar re-scan a cada workspace change)
- **F241.2**: Background scan (não bloqueia operação principal)
- **F241.3**: Incremental scan (watch changes ao invés de full rescan)
- **F241.4**: Testes

### F242: SQLite query optimization
- **F242.1**: Verificar índices nas tabelas de conversação (conversation-hub/store)
- **F242.2**: Verificar índices nas tabelas de todos (todo/store)
- **F242.3**: Adicionar `CREATE INDEX IF NOT EXISTS` para queries frequentes
- **F242.4**: Benchmark antes/depois

### F243: Profiling check
- **F243.1**: Rodar com `--prof` e analisar hot spots
- **F243.2**: Verificar que nenhum FS sync está no hot path
- **F243.3**: Documentar resultados

### F244: Validação de Faixa 12
- **F244.1**: `npm run lint` + `npm run test:unit` — all pass
- **F244.2**: FS sync calls ≤ 10
- **F244.3**: Memory-bounded structures confirmadas
- **F244.4**: Commit: `perf(hardening): Faixa 12 (F239-F244) — performance hardening`

---

## Faixa 13 — API Consistency + Padronização Final (F245-F248)

> **Objetivo**: Padronizar error responses, logging, e patterns.

### F245: Padronizar error responses API
- **F245.1**: Implementar error-sanitizer middleware (confirmar F136)
- **F245.2**: Padronizar formato: `{ error: string, code: string, status: number }`
- **F245.3**: Map CopilotError subclasses → HTTP status codes
- **F245.4**: Testes de integration para cada error type

### F246: Padronizar logging metadata
- **F246.1**: Criar logger context factory: `createLogContext(module, operation)`
- **F246.2**: Garantir que todos os logs incluem `{ module, operation, ...extra }`
- **F246.3**: Auditar top-20 log sites para consistência

### F247: Padronizar JSON.parse patterns
- **F247.1**: Migrar 10+ try/JSON.parse/catch para `safeJsonParse` (do F121)
- **F247.2**: Verificar zero JSON.parse sem safety wrapper em runtime paths

### F248: Validação de Faixa 13
- **F248.1**: `npm run lint` + `npm run test:unit` — all pass
- **F248.2**: Commit: `refactor(consistency): Faixa 13 (F245-F248) — API + pattern standardization`

---

## Faixa 14 — Coverage Targets + CI + Relatório Final (F249-F250)

> **Objetivo**: Aumentar thresholds de CI, validar métricas, gerar relatório final.

### F249: Aumentar coverage thresholds
- **F249.1**: `vitest.config.js` — lines: 30% → 45%
- **F249.2**: `vitest.config.js` — branches: 20% → 30%
- **F249.3**: `vitest.config.js` — functions: 30% → 40%
- **F249.4**: Rodar `npm run test:unit -- --coverage` e verificar que passa
- **F249.5**: Se não passa: identificar gaps e adicionar testes focados

### F250: Relatório Final PARTE-17B
- **F250.1**: Coletar métricas finais:
  - Total de arquivos, linhas
  - Arquivos >400L (alvo ≤8)
  - FS sync calls (alvo ≤10)
  - Catch blocks vazios (alvo ≤20)
  - Testes totais (alvo ≥3000)
  - Coverage (alvo ≥45/30/40)
  - SEC issues (alvo 0)
  - process.on dispersos (alvo ≤3)
  - Timers sem cleanup (alvo ≤3)
- **F250.2**: Gerar comparativo before/after (PARTE-15B baseline vs PARTE-17B)
- **F250.3**: Gerar `PARTE-17B-RELATORIO-COMPARATIVO.md`
- **F250.4**: Commit final: `docs(audit): PARTE-17B — relatório final pós-F250`

---

## Apêndice: Métricas Alvo por Faixa

| Faixa | FS Sync | Catch {} | Testes | God Mod | SEC Med |
| ----: | ------: | -------: | -----: | ------: | ------: |
|     0 |      84 |     ~133 |  2.342 |      22 |       4 |
|     1 |     <40 |     ~133 | 2.360+ |      22 |       4 |
|     2 |     <40 |     ~133 | 2.380+ |      22 |       0 |
|     3 |     <40 |      <20 | 2.385+ |      22 |       0 |
|     4 |     <40 |      <20 | 2.400+ |      22 |       0 |
|     5 |     <40 |      <20 | 2.440+ |      18 |       0 |
|     6 |     <40 |      <20 | 2.470+ |      15 |       0 |
|     7 |     <35 |      <20 | 2.520+ |      10 |       0 |
|     8 |     <35 |      <20 | 2.580+ |       7 |       0 |
|     9 |     <30 |      <15 | 2.615+ |       6 |       0 |
|    10 |     <25 |      <15 | 2.650+ |       3 |       0 |
|    11 |     <20 |      <10 | 2.680+ |       1 |       0 |
|    12 |     <10 |      <10 | 2.700+ |       1 |       0 |
|    13 |     <10 |      <10 | 2.720+ |       1 |       0 |
|    14 |     <10 |      <10 | 3.000+ |      ≤8 |       0 |

---

## Apêndice: Dependências entre Faixas

```
Faixa 1 (Foundation) ──→ Faixa 2 (Security) ──→ Faixa 3 (Error Handling)
                    │                                       │
                    └──→ Faixa 4 (Timers) ──────────────────┤
                                                            │
                    ┌───────────────────────────────────────┘
                    │
                    ├──→ Faixa 5 (conv-hub)  ──┐
                    ├──→ Faixa 6 (bridges)   ──┤──→ Faixa 10 (Tier-2)
                    ├──→ Faixa 7 (terminal)  ──┤        │
                    ├──→ Faixa 8 (tools)     ──┤        ├──→ Faixa 11 (Tier-3)
                    └──→ Faixa 9 (observ.)   ──┘        │
                                                        ├──→ Faixa 12 (Perf)
                                                        │
                                                        ├──→ Faixa 13 (API)
                                                        │
                                                        └──→ Faixa 14 (Coverage)
```

**Nota**: Faixas 5-9 podem ser executadas em qualquer ordem entre si, mas todas dependem de
Faixas 1-4 estarem completas. Faixas 10-14 são sequenciais.
