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
|     3 | F139-F150 | Error Handling Standardization ✅        | catch blocks, error flow, logging       |
|     4 | F151-F158 | Timer & Lifecycle Management            | setInterval cleanup, timer registry     | ✅ |
|     5 | F159-F170 | Conversation-Hub: Testes + Decomposição | 0→100% test coverage, god module split  |
|     6 | F171-F180 | Bridges: Testes + Retry Migration       | 0→100% test coverage, centralizar retry |
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

## Faixa 3 — Error Handling Standardization (F139-F150)

> **Objetivo**: Auditar e corrigir os 176 catch points (142 `catch {}` + 25 `catch(e){}` + 9 `.catch(() => {})`),
> padronizar error flow, integrar com hierarquia de erros tipados e telemetria.

### Auditoria pré-execução (atualizada 2026-03-15)

| Diretório           | `catch {}` (comment) | `catch {}` (code) | `catch(e)` | `.catch(()=>{})` | **Total** |
| ------------------- | -------------------- | ----------------- | ---------- | ---------------- | --------- |
| bridges             | 0                    | 28                | —          | —                | 28        |
| tools               | 8                    | 19                | —          | —                | 27        |
| agent               | 10                   | 12                | —          | 6                | 28        |
| terminal            | 6                    | 14                | —          | 1                | 21        |
| audit               | 4                    | 6                 | —          | —                | 10        |
| observability       | 4                    | 4                 | —          | —                | 8         |
| conversation-hub    | 4                    | 3                 | —          | 2                | 9         |
| channel             | 3                    | 3                 | —          | —                | 6         |
| config              | 4                    | 1                 | —          | —                | 5         |
| sdk                 | 3                    | 1                 | —          | —                | 4         |
| api                 | 1                    | 1                 | —          | —                | 2         |
| core                | 0                    | 2                 | —          | —                | 2         |
| db                  | 1                    | 0                 | —          | —                | 1         |
| *c/ param (global)* | *5*                  | *20*              | *25*       | —                | —         |
| **TOTAL**           | **48**               | **94**            | **25**     | **9**            | **176**   |

**Achados críticos da auditoria:**
1. **Hierarquia de erros ociosa**: 51 `throw new <CopilotSubclass>`, 0 `instanceof CopilotError|SessionError|...` — hierarquia nunca discriminada em catches
2. **48 catches comment-only**: silenciam erros com `// best-effort` sem nenhum log ou métrica
3. **ErrorTracker isolado**: usado apenas em `observability/observers/` e `event-collector` — bridges/tools/agent não alimentam o tracker
4. **tool-stats.recordToolCall** existe mas só é chamado via `wrapWithStats` — tools não wrappadas não registram métricas de erro
5. **Log levels**: 40× `log('ERROR')` vs 142 catches silenciosos — grande gap de visibilidade
6. **9 `.catch(() => {})` void patterns**: erros de promise perdidos sem nenhum rastro

### F139: Criar `core/error-handlers.js` utility ✅
- **F139.1**: ✅ `logSwallowed(err, context)` — `log('DEBUG')` + `defaultErrorTracker.trackError()` sem rethrow
- **F139.2**: ✅ `wrapAsync(fn, context)` — wrapper que captura, loga via `logSwallowed` e retorna undefined/fallback
- **F139.3**: ✅ `isFatalError(err)` — classifica erros: `SessionError` com `SESSION_FATAL` = fatal; `CircuitOpenError` = fatal; genérico `Error` com `code === 'ERR_SOCKET_CLOSED'` = fatal; demais = recoverable
- **F139.4**: ✅ `isTransientError(err)` — identifica erros retriáveis: `BridgeError`, `ECONNREFUSED`, `ETIMEDOUT`, `502/503`
- **F139.5**: ✅ 19 testes unitários em `test_core_error_handlers.spec.js` — all passing

### F140: Corrigir catch blocks em `observability/` (8 catches) ✅
- **F140.1**: ✅ 4 catches comment-only → `logSwallowed(err, '<módulo>.<operação>')` — metrics.js (1), event-collector.js (3)
- **F140.2**: ✅ 4 catches com código → verificados, já logam adequadamente
- **Resultado**: 8 catch blocks padronizados

### F141: Corrigir catch blocks em `tools/` (27 catches) ✅
- **F141.1**: ✅ catches comment-only → `logSwallowed` — web-tools.js (1), session-tools.js (2), todo/store.js (1)
- **F141.2**: ✅ catches com código → verificados, logam adequadamente
- **F141.3**: ✅ error messages padronizadas com contexto (tool name + operação)
- **Resultado**: catches padronizados; 4 em `tools/file/` mantidos intencionalmente (control flow)

### F142: Corrigir catch blocks em `terminal/` (20 catches + 1 void) ✅
- **F142.1**: ✅ catches comment-only → `logSwallowed` — alias-store.js (1), index.js (3), file-context.js (1)
- **F142.2**: ✅ catches com código → verificados, logam adequadamente
- **F142.3**: ✅ void `.catch(() => {})` → `.catch(err => logSwallowed(err, 'terminal.<ctx>'))` — repl.js (2)
- **F142.4**: ✅ erros em REPL reportados adequadamente
- **Resultado**: 21 catch points padronizados

### F143: Corrigir catch blocks em `agent/` (22 catches + 6 void) ✅
- **F143.1**: ✅ catches comment-only → `logSwallowed` — always-alive.js (1), hook-context.js (1), snapshot.js (5), state-io.js (4)
- **F143.2**: ✅ catches com código → verificados; propagação para session.fatal OK
- **F143.3**: ✅ 6 void `.catch(() => {})` → `logSwallowed` — boot-wiring.js (1), backpressure.js (1), loop-manager.js (1), agent-lifecycle.js (1), entry.js (2)
- **F143.4**: ✅ `isFatalError` integrado em reconnect-policy.js (via F149)
- **Resultado**: 28 catch points padronizados

### F144: Corrigir catch blocks em `bridges/` (28 catches) ✅ (auditoria)
- **F144.1**: ✅ 0 catches comment-only — todos têm código (retornam fallbacks: `[]`, `null`, `false`, `''`)
- **F144.2**: ✅ Auditado: MCP bridge já tem retry com backoff, span recording e metrics; git/gh bridges têm fallbacks adequados
- **F144.3**: ⚠️ Parcial — MCP bridge usa string comparison (`e.code === 'ECONNRESET'`) em vez de `isTransientError()`. Funcional, mas acoplado. Upgrade potencial para Faixa futura.
- **Resultado**: 28 catch blocks auditados; nenhuma alteração necessária (todos com código adequado)

### F145: Corrigir catch blocks em `channel/` (6 catches) ✅
- **F145.1**: ✅ 3 catches comment-only → `logSwallowed` — sse-client.js (1), client.js (2)
- **F145.2**: ✅ 3 catches com código → verificados, logam adequadamente
- **Resultado**: 6 catch blocks padronizados

### F146: Corrigir catch blocks em `conversation-hub/` (7 catches + 2 void) ✅
- **F146.1**: ✅ catches comment-only → `logSwallowed` — store.js (1), hub.js (2), socket-ns.js (1)
- **F146.2**: ✅ catches com código → verificados
- **F146.3**: ✅ 2 void `.catch(() => {})` → `logSwallowed` — orchestrator.js (2)
- **Resultado**: 9 catch points padronizados

### F147: Corrigir catch blocks em `config/`, `sdk/`, `audit/`, `api/`, `core/`, `db/` (24 catches) ✅
- **F147.1**: ✅ `config/` — pinned-files.js (6 logSwallowed)
- **F147.2**: ✅ `sdk/` — tools-state.js (1), client.js (1), custom-tools.js (1)
- **F147.3**: ✅ `audit/` — jsonl-writer.js (1), pipeline.js (3)
- **F147.4**: ✅ `api/` — observability.js (1)
- **F147.5**: ✅ `core/` — ambos com código, verificados
- **F147.6**: ✅ `db/` — sqlite.js (1)
- **Resultado**: 24 catch blocks padronizados

### F148: Corrigir catches `catch(e)` com parâmetro não utilizado (25 catches) ✅
- **F148.1**: ✅ Auditado: 21 `catch(e)` restantes — todos com parâmetro UTILIZADO no corpo (via JSDoc cast ou multi-line)
- **F148.2**: ✅ 6 `catch(_)` em logger.js/hooks usam convenção underscore = intencionalmente ignorado
- **F148.3**: ✅ Nenhum param não utilizado encontrado → nenhuma ação necessária
- **Resultado**: 25 catch(e) blocks auditados — todos corretos

### F149: Integrar `instanceof` de erros tipados em catches críticos ✅
- **F149.1**: ✅ reconnect-policy.js: `isFatalError(reconnectError)` → break imediato do retry loop
- **F149.2**: ⚠️ Não aplicado em always-alive.js — catches são para operações não-críticas (session.abort, session.log, setModel)
- **F149.3**: ⚠️ Não aplicado em loop-manager.js — catches são para state-write operations que já usam logSwallowed
- **F149.4**: ✅ session-crud.js: não tem catches genéricos em paths de retry que se beneficiariam
- **Resultado**: 1 catch crítico com discriminação (reconnect-policy.js — o mais impactante). Demais arquivos mencionados não têm catches genéricos em paths de retry.

### F150: Validação de Faixa 3 ✅
- **F150.1**: ✅ `npm run lint` — zero errors
- **F150.2**: ✅ `npm run test:unit` — 2446 passed, 53 skipped, 0 failed
- **F150.3**: ✅ catches comment-only restantes = 4 (intencionais: tools/file/ control flow)
- **F150.4**: ✅ `.catch(() => {})` void patterns = 0
- **F150.5**: ✅ Commit: `cea8999e` —t: `cea8999e` — `fix(reliability): Faixa 3 (F139-F150) — error handling standardization`

### Deep Review Faixa 3 (pós-commit)

#### Auditoria quantitativa final (328 catches totais em src/copilot/)
| Categoria    | Contagem | Nota                                                                                  |
| ------------ | -------- | ------------------------------------------------------------------------------------- |
| logSwallowed | 46       | Substituídos via F140-F147                                                            |
| log_error    | 19       | Adequados — usam `log('ERROR', ...)` antes de rethrow/return                          |
| log_warn     | 65       | Adequados — catches com ação + log de warning                                         |
| rethrow      | 8        | Corretos — `catch` que re-lança ou transforma                                         |
| code_only    | 175      | Catches com lógica executada (fallback, cleanup, retry)                               |
| comment_only | 4        | Intencionais: `tools/file/shared.js:116`, `write-tools.js:119,203,249` (control flow) |
| empty        | 0        | Eliminados                                                                            |

#### Leitura de documentação oficial do SDK (`@github/copilot-sdk` v0.2.1)

**Achados relevantes:**

1. **`onErrorOccurred` hook** — SDK fornece `input: { error: string, errorContext: string, recoverable: boolean }` e espera `{ errorHandling: 'retry' | 'skip' | 'abort' }`. Nossa implementação em `hooks/error-handler.js` está **100% alinhada** com a API.

2. **`client.stop()` → `Promise<Error[]>`** — SDK retorna lista de erros de cleanup. Nossa integração em `sdk/client.js:161` e `agent-lifecycle.js:271` **já trata corretamente** (log WARN + retorna array).

3. **Telemetria OTEL** — SDK suporta `telemetry.otlpEndpoint` nativamente. Nossa configuração via `OTEL_EXPORTER_OTLP_ENDPOINT` no env está coerente.

4. **Tipos de erro** — SDK **não exporta** error classes tipadas. Todos os erros são `Error` genéricos com mensagem string. Nossa hierarquia `CopilotError → SessionError, BridgeError, etc.` é uma **extensão de domínio correta** que adiciona categorização ausente no SDK.

5. **`session.error` event** — Emite `{ errorType: string, message: string }`. Nosso `session-handlers.js` já alimenta `errorTracker.trackError()` corretamente.

6. **Eventos não cobertos** — O SDK documenta `session.compaction_start`, `session.compaction_complete`. Já cobertos nos coletores.

#### Gaps identificados e correções implementadas

| Gap | Descrição                                                                                   | Correção                                                                           |
| --- | ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| G1  | `tool.execution_complete` com `!success` não alimentava `errorTracker`                      | Adicionado `errorTracker.trackError()` em `collectors/tool-handlers.js`            |
| G2  | `createCircuitBreakerHandler` não distinguia erros fatais/transientes por conteúdo string   | Adicionados `fatalPatterns` e `transientPatterns` ao circuit-breaker               |
| G3  | `onErrorOccurred` no preset production não notificava ErrorTracker a cada erro (só no trip) | Adicionado `onError` callback para tracking de todo erro SDK                       |
| G4  | `wrapAsync` exportado mas sem uso em produção                                               | Documentado — disponível como utilitário para uso futuro (nenhuma ação necessária) |

#### Status final Faixa 3: ✅ COMPLETA + DEEP REVIEW APLICADA

---

## Faixa 4 — Timer & Lifecycle Management (F151-F158)

> **Objetivo**: Registrar todos os timers recorrentes no `timer-registry.js` (já existente, mas com 0
> usages em produção), corrigir leaks identificados e garantir cleanup no shutdown.

### Auditoria Profunda — Resultados (realizada antes da execução)

**Infraestrutura existente:**
- `core/timer-registry.js` — registry com `registerTimer()`, `cancel()`, `cancelAll()`, shutdown handler (priority 5)
- `core/shutdown.js` — shutdown manager com handlers priorizados + timeout 5s por handler
- Testes existentes: `test_core_timer_registry.spec.js` (7 testes), `test_core_shutdown.spec.js`

**Mapeamento de setInterval (10 módulos, 12 chamadas):**

| Módulo                            | Timer                     | Cleanup Existente                                   | No Registry? | Status                                                      |
| --------------------------------- | ------------------------- | --------------------------------------------------- | ------------ | ----------------------------------------------------------- |
| `agent/dialog/watchdog.js`        | stall detection (class)   | ✅ `stop()` → `clearInterval`                        | ❌            | Classe com lifecycle próprio — OK como está                 |
| `agent/session/keepalive.js`      | session heartbeat (class) | ✅ `stop()` → `clearInterval`                        | ❌            | Classe com lifecycle próprio — OK como está                 |
| `agent/session/boot-wiring.js`    | metrics emit              | ⚠️ Handle retornado; cleared em `agent-lifecycle.js` | ❌            | **Migrar para registry**                                    |
| `observability/metrics.js`        | snapshot to disk          | ✅ `stopPeriodicSnapshot()` → `clearInterval`        | ❌            | Chamado em `agent-lifecycle.js` — migrar para registry      |
| `observability/error-alerting.js` | alerter check             | ✅ `destroy()` → `clearInterval`                     | ❌            | Chamado em `agent-event-observer.js` — migrar para registry |
| `conversation-hub/store.js`       | checkpoint (class)        | ✅ `close()` → `clearInterval`                       | ❌            | Classe com lifecycle próprio — OK como está                 |
| `tools/todo/store.js`             | `startTodoCleanupJob`     | ⚠️ **Handle retornado mas DESCARTADO**               | ❌            | **LEAK CONFIRMADO** — migrar para registry                  |
| `terminal/index.js`               | polling pendingQuestion   | ✅ Auto-cleanup (clearInterval + setTimeout backup)  | ❌            | One-shot com cleanup — OK como está                         |
| `terminal/index.js`               | `_reflectionTimer`        | ✅ Shutdown handler registrado                       | ❌            | **Migrar para registry** (simplificar shutdown handler)     |
| `terminal/server.js`              | SSE heartbeat             | ✅ `req.on('close')` → `clearInterval`               | ❌            | Per-connection, cleaned on close — OK como está             |
| `api/sse/utils.js`                | SSE heartbeat             | ✅ `cleanup()` via req/res events                    | ❌            | Per-connection, cleaned on events — OK como está            |

**Mapeamento de setTimeout relevantes (não-Promise.race):**

| Módulo                          | Timer                             | Cleanup                                    | Status                                               |
| ------------------------------- | --------------------------------- | ------------------------------------------ | ---------------------------------------------------- |
| `hooks/composer.js`             | handler timeout em `Promise.race` | ❌ Timer não cancelado quando handler vence | **LEAK MENOR** — auto-expira, mas boa prática limpar |
| `agent/dialog/turn-executor.js` | turn timeout (3 instâncias)       | ✅ `clearTimeout` em all paths              | OK                                                   |
| `agent/dialog/loop-manager.js`  | shutdown force timeout            | ✅ `clearTimeout` no finally                | OK                                                   |
| `bridges/mcp-tool-bridge.js`    | auto-reconnect backoff            | ✅ Cancel function retornada e chamada      | OK                                                   |
| `channel/sse-client.js`         | reconnect delay                   | ✅ `clearTimeout` em destroy                | OK                                                   |
| `core/abort-utils.js`           | `withTimeout`                     | ✅ `clearTimeout` em finally                | OK                                                   |
| `config/pinned-files.js`        | debounce                          | ✅ `clearTimeout` em reschedule             | OK                                                   |
| `sdk/event-helpers.js`          | listener timeout (2 instâncias)   | ✅ `clearTimeout` em resolve path           | OK                                                   |

**Módulos com cleanup adequado que NÃO precisam de migração:**
- Classes com `start()`/`stop()`: `DialogWatchdog`, `SessionKeepalive`, `ConversationStore`
- Per-connection timers (SSE): `terminal/server.js`, `api/sse/utils.js`
- One-shot com auto-cleanup: `terminal/index.js` polling

### F151: Auditar todos os timers existentes ✅ (auditoria acima)
- **F151.1**: ✅ 12 `setInterval` em 10 módulos, ~30 `setTimeout` relevantes mapeados
- **F151.2**: ✅ Classificação: 3 classes com lifecycle, 2 per-connection, 5 module-level recorrentes
- **F151.3**: ✅ 1 leak confirmado (`todoCleanupJob`), 1 leak menor (`hooks/composer.js`), 0 no registry
- **F151.4**: ✅ Prioridade: todoCleanupJob (leak) > boot-wiring metrics > reflectionTimer > metrics snapshot > error-alerting

### F152: Corrigir leak — `startTodoCleanupJob` em `terminal/index.js` ✅
- **F152.1**: ✅ Em `terminal/index.js`: `const todoCleanupTimer = startTodoCleanupJob()` + `registerTimer('terminal.todoCleanup', 'interval', todoCleanupTimer)`
- **F152.2**: ⚠️ Shutdown handler manual mantido (para log explícito) — registry cancelAll cobre como backup
- **F152.3**: ✅ Validado via test suite (264 passed)

### F153: Migrar `_reflectionTimer` para timer-registry ✅
- **F153.1**: ✅ Em `terminal/index.js`: `registerTimer('terminal.reflection', 'interval', _reflectionTimer)` no `startReflectionLoop`
- **F153.2**: ⚠️ Shutdown handler manual mantido (para log + nullify referência local) — registry cancelAll cobre como backup
- **F153.3**: ✅ `_reflectionTimer` continua como referência local para restart condicional

### F154: Migrar `metricsTimer` em `boot-wiring.js` para timer-registry ✅
- **F154.1**: ✅ Em `boot-wiring.js`: `registerTimer('agent.metricsEmit', 'interval', metricsTimer)` após criar o timer
- **F154.2**: ✅ `agent-lifecycle.js` continua fazendo `clearInterval(ctx.metricsTimer)` — dupla proteção (local + registry)
- **F154.3**: ✅ `metricsTimer` mantido em ctx para backward compat

### F155: Migrar `_snapshotTimer` em `metrics.js` para timer-registry ✅
- **F155.1**: ✅ Em `metrics.js` `startPeriodicSnapshot`: `registerTimer('metrics.snapshot', 'interval', _snapshotTimer)`
- **F155.2**: ✅ Em `stopPeriodicSnapshot`: `cancelTimer('metrics.snapshot')` adicionado junto ao clearInterval manual
- **F155.3**: ✅ Dupla proteção: clearInterval local + cancel no registry

### F156: Migrar `_interval` em `error-alerting.js` para timer-registry ✅
- **F156.1**: ✅ Em `createErrorAlerter`: `registerTimer('observability.errorAlerting', 'interval', _interval)`
- **F156.2**: ✅ Em `destroy()`: `cancelTimer('observability.errorAlerting')` adicionado junto ao clearInterval manual
- **F156.3**: ✅ `destroy()` mantida como API pública

### F157: Corrigir leak menor — `hooks/composer.js` Promise.race timeout ✅
- **F157.1**: ✅ Em `raceWithTimeout`: timer armazenado em variável, `clearTimeout(timer)` via `.finally()` quando handler vence
- **F157.2**: ✅ Padrão: `Promise.resolve(handler(...)).finally(() => clearTimeout(timer))`
- **F157.3**: ✅ Validado via test suite

### F158: Validação de Faixa 4 ✅
- **F158.1**: ✅ `npm run lint` — zero errors
- **F158.2**: ✅ `npm run test:unit` — 2446 passed, 53 skipped, 0 failed (264 files)
- **F158.3**: ✅ `registerTimer` usages = 5 em produção (vs 0 antes)
- **F158.4**: ✅ setInterval sem cleanup = 0
- **F158.5**: Commit: `fix(lifecycle): Faixa 4 (F151-F158) — timer & lifecycle management`

---

## Faixa 5 — Conversation-Hub: Testes + Decomposição (F159-F170) ✅

> **Objetivo**: Levar conversation-hub de 0 testes para cobertura adequada
> e decompor os 4 god modules.
>
> **Resultado**: 6 novos arquivos de teste, 73 novos testes. Decomposição já feita em sessões anteriores.
> Auditoria identificou que F159/F160/F162 já estavam feitos e F164/F166/F167 são N/A.
> Suite completa: 2522 passed, 0 failed.

### F157: Testes para `store-helpers.js` + `store-queries.js` + `store-memories.js` ✅
- **F157.1** ✅: `tests/unit/copilot/conversation-hub/test_store_helpers.spec.js` — 27 testes
- **F157.2** ✅: sanitizeFtsQuery (4), initTurnsFts (2), migrateFts5Tokenizer (1)
- **F157.3** ✅: readTurns (4), searchTurns (4), getTurn (2), countTurns (2)
- **F157.4** ✅: storeMemory (1), recallMemories (5), deleteMemory (2)

### F158: Testes para `store-sync.js` + `call-strategies.js` ✅
- **F158.1** ✅: `test_store_sync.spec.js` — 7 testes (CRUD, dedup, sequential turns, user_read, no-id)
- **F158.2** ✅: `test_call_strategies.spec.js` — 9 testes (dialogLoop, structured, simpleChat)

### F159: Testes para `store.js` (561L) — JÁ FEITO ✅
- Já existiam 26 testes em `test_conversation_store.spec.js` cobrindo CRUD, migrations, edge cases.
- **Ação**: nenhuma adicional necessária.

### F160: Decompor `store.js` — JÁ FEITO ✅
- `store-helpers.js`, `store-queries.js`, `store-memories.js`, `store-sync.js` já extraídos em sessões anteriores.
- **Ação**: nenhuma adicional necessária.

### F161: Testes para `orchestrator.js` (572L) ✅
- **F161.1** ✅: `test_orchestrator.spec.js` — 16 testes
- **F161.2** ✅: Lifecycle (2), session management (4), sendToLlmB (5 — string/structured/dialog/error/stopped)
- **F161.3** ✅: User messages (2: inject+event, poll+mark-read)
- **F161.4** ✅: notifyTerminalTurn (1), history (1)

### F162: Decompor `orchestrator.js` — JÁ PARCIALMENTE FEITO ✅
- `call-strategies.js` já extraído. Restante do orchestrator é classe coesa (EventEmitter + mutex + session management).
- **Ação**: decomposição adicional teria ROI negativo.

### F163: Testes para `socket-ns.js` (478L) ✅
- **F163.1** ✅: `test_socket_ns.spec.js` — 5 testes com mock Socket.IO
- **F163.2** ✅: mount/re-mount idempotência, namespace /copilot path
- **F163.3** ✅: unmount disconnectSockets + cleanup
- **F163.4** ✅: broadcastToSession e broadcastGlobal (no-op quando não montado)

### F164: Decompor `socket-ns.js` — SKIPPED ⚠️
- **Motivo**: alto risco de regressão, baixo ROI. O módulo já usa funções internas bem separadas
  (`_setupAuthMiddleware`, `_setupConnectionHandlers`, `_handleJoinSession`, etc.).
- **Ação**: nenhuma — manter coeso.

### F165: Testes para `hub.js` (283L) ✅
- **F165.1** ✅: `test_hub.spec.js` — 9 testes (standalone, sem mock Socket.IO)
- **F165.2** ✅: Lifecycle (5: init, idempotent, orchestrator-before-init, stop, close)
- **F165.3** ✅: Facade methods (3: createSession, pollUserMessages, store getter)
- **F165.4** ✅: close com sessões ativas

### F166: Migrar retry em orchestrator → N/A ⚠️
- **Motivo**: grep não encontrou padrões manuais de retry no orchestrator. Retry é delegado ao bridge/agent.
- **Ação**: nenhuma necessária.

### F167: Migrar timeout em orchestrator → N/A ⚠️
- **Motivo**: timeout é passado via opts para bridge/agent. Nenhum Promise.race manual no orchestrator.
- **Ação**: nenhuma necessária.

### F168: Validação de Faixa 5 ✅
- **F168.1** ✅: ESLint clean, 2522 tests passed, 0 failed
- **F168.2** ✅: conversation-hub: 2 → 8 test files, 37 → 110 testes (+73 novos)
- **F168.3** ✅: God modules: store.js já decomposto, orchestrator parcialmente, socket-ns mantido coeso (justificado)
- **F168.4** ✅: Commit feito

---

## Faixa 6 — Bridges: Testes + Retry Migration (F169-F178) ✅

> **Objetivo**: Levar bridges de 0 testes para cobertura adequada
> e centralizar retry/timeout.
>
> **Resultado**: 3 novos arquivos de teste, 43 novos testes. Auditoria identificou que F170/F175
> já tinham cobertura substancial, e F171/F172/F174/F176/F177.3 são N/A ou deferred.
> Suite completa: 2565 passed, 0 failed.

### F169: Testes para `mcp-tool-schema.js` (137L) ✅
- **F169.1** ✅: `tests/unit/copilot/bridges/test_mcp_tool_schema.spec.js` — 19 testes
- **F169.2** ✅: Escalares (6: string, number, integer, boolean, unknown, null)
- **F169.3** ✅: Enum (2), Object (3: required, no-properties, nested recursive)
- **F169.4** ✅: Array (2: typed items, no items), allOf/oneOf/anyOf (4), optional (2)

### F170: Testes para `mcp-tool-bridge.js` (432L) — JÁ FEITO ✅
- 11 testes pré-existentes em `test_mcp_tool_bridge.spec.js` (offline, graceful degradation, tool shape)
- **Ação**: nenhuma adicional necessária.

### F171: Migrar retry/circuit-breaker em `mcp-tool-bridge.js` — DEFERRED ⚠️
- **Motivo**: retry inline (3 tentativas + backoff) e circuit breaker manual funcionam corretamente
  e têm testes. Migração para core/retry.js + core/circuit-breaker.js seria refactor alto-risco
  com baixo ROI — o bridge pode evoluir independentemente.
- **Ação**: deferido para revisão futura se duplicação causar bugs.

### F172: Decompor `mcp-tool-bridge.js` — JÁ PARCIALMENTE FEITO ✅
- `mcp-tool-schema.js` já extraído (137L). Restante do bridge (432L) é coeso.
- **Ação**: nenhuma adicional.

### F173: Testes para `git-bridge.js` (428L) ✅
- **F173.1** ✅: `tests/unit/copilot/bridges/test_git_bridge.spec.js` — 8 testes
- **F173.2** ✅: formatStatus (2: vazio, entradas), formatLog (2: normal, oneline), formatBranch (1)
- **F173.3** ✅: gitStatus, gitLog, gitBranch — async com git real (3 testes)

### F174: Decompor `git-bridge.js` — SKIPPED ⚠️
- **Motivo**: 428L, mas cada função é self-contained. Decomposição não reduziria complexidade.
- **Ação**: nenhuma.

### F175: Testes para `nerv-bridge.js` (385L) — JÁ FEITO ✅
- 26 testes em `test_nerv_bridge.spec.js` + 13 em `test_nerv_bridge_integration.spec.js` = 39 testes
- **Ação**: nenhuma adicional necessária.

### F176: Adicionar retry e timeout em `nerv-bridge.js` — N/A ⚠️
- **Motivo**: nerv-bridge não tem padrões de retry/timeout manuais. Comunicação é event-based.
- **Ação**: nenhuma necessária.

### F177: Testes para `gh/` submodule ✅
- **F177.1** ✅: `tests/unit/copilot/bridges/test_gh_shared.spec.js` — 16 testes
- **F177.2** ✅: fmtDate (5: vazio, min, horas, dias, antigo), runIcon (6 status variants)
- **F177.3** ✅: slicePage (3: primeira, última, além-do-range), calcFetchLimit (2: normal, cap)
- **F177.4** N/A: Nenhum retry manual encontrado em ci.js (apenas polling interval)

### F178: Validação de Faixa 6 ✅
- **F178.1** ✅: ESLint clean, 2565 tests passed, 0 failed
- **F178.2** ✅: bridges: +3 novos test files, +43 testes (total: 50+ tests pré-existentes + 43 novos)
- **F178.3** ⚠️: Retry em mcp-tool-bridge mantido inline (deferred)
- **F178.4** ✅: Commit feito

---

## Faixa 7 — Terminal Hardening + Decomposição (F179-F192)

> **Objetivo**: Hardening do segundo maior subsistema (7.618L, 49 files),
> decompor 5 god modules, melhorar cobertura de testes.

### F179: Decompor `terminal/index.js` (494L) — ⏭️ N/A
- **Análise**: 0 exports. Bootstrap orchestrator puro — carrega aliases, cria server, session, listeners.
  Decompor em scheduler.js + lifecycle.js criaria módulos artificiais sem API reutilizável.
- **Decisão**: Manter como está. API estreita, sequência de inicialização coesa.

### F180: Decompor `terminal/dialog/engine.js` (459L) — ⏭️ N/A
- **Análise**: 4 exports (sendTurn, ensureDialogLoop, drainPendingNotifications, getTurnQueueDepth).
  State machine fortemente acoplada; separar state/transitions fragmentaria lógica coesiva.
- **Decisão**: Manter como está.

### F181: Decompor `terminal/server.js` (452L) — ⏭️ N/A
- **Análise**: 1 export (createInjectServer). `route-table.js` já foi extraído (279L com 38 rotas
  declarativas). Middleware é inline mas contextual ao HTTP pipeline.
- **Decisão**: Decomposição principal já realizada (route-table). Manter server.js como está.

### F182: Decompor `terminal/repl.js` (437L) — ⏭️ N/A
- **Análise**: 2 exports (startRepl + re-export setupAgentListeners de repl-listeners.js).
  `repl-listeners.js` já foi extraído. Completions são pequenas e inline.
- **Decisão**: Decomposição principal já realizada (repl-listeners). Manter repl.js como está.

### F183: Testes para `terminal/file-context.js` (382L) — ✅ 19 testes
- **F183.1** ✅: detectLang — 8 testes (extensões mapeadas + desconhecida + sem extensão)
- **F183.2** ✅: extractAtReferences — 5 testes (@path, @"citado", múltiplos, email reject, vazio)
- **F183.3** ✅: embedContextBlock — 1 teste (prepend markdown)
- **F183.4** ✅: embedMultiple — 3 testes (múltiplos, MAX_EMBED_BYTES truncation, lista vazia)
- **F183.5** ✅: readFileContext + cache — 2 testes (leitura real, cache hit)

### F184: Testes para `terminal/alias-store.js` (248L) — ✅ 16 testes
- **F184.1** ✅: resolve — 6 testes (builtin, cadeia, args, loop detection, desconhecido)
- **F184.2** ✅: setAlias — 4 testes (custom, sobrescrever builtin, auto-prefix, rejeitar loop)
- **F184.3** ✅: removeAlias — 2 testes (existente, inexistente)
- **F184.4** ✅: resetAliases — 1 teste
- **F184.5** ✅: formatAliases — 3 testes (string, tags builtin/custom)

### F185: Testes para `terminal/state.js` (277L) — ✅ 16 testes
- **F185.1** ✅: getters/setters — 3 testes (hubSessionId, busy, planMode round-trip)
- **F185.2** ✅: stateEmitter — 6 testes (hubSessionId:changed, no-op, busy:changed,
  showThinking:changed, showUsage:changed, showStreaming:changed)
- **F185.3** ✅: attachment queue — 5 testes (add/get, cópia defensiva, dedup, clear, overflow)
- **F185.4** ✅: inject history — 2 testes (round-trip, respeita param n)

### F186: Testes para `terminal/route-table.js` (279L) — ✅ 16 testes
- **F186.1** ✅: matchRoute — 10 testes (health, metrics, inject, SSE, inexistente, método errado,
  regex paths: sessions/:id/turns, handoff/:id/accept, memory/:id, custom/:name)
- **F186.2** ✅: params extraction — 4 testes (sessionId, handoffId, name decode, query limit)
- **F186.3** ✅: ROUTE_TABLE integrity — 2 testes (method/path/handler, sem duplicatas)

### F187: Decompor `handlers/system-metrics.js` (387L) — ⏭️ Deferido
- **Análise**: Cada handler é uma função auto-contida exportada individualmente.
  system-metrics.js já é uma coleção flat, não um god module.
- **Decisão**: Deferido — sem refactoring necessário.

### F188: Decompor `commands/gh.js` (382L) — ⏭️ Deferido
- **Análise**: Dispatcher de comandos GitHub. Funções internas são auto-contidas.
- **Decisão**: Deferido — sem ROI de decomposição.

### F189-F191: Testes para handlers e commands — ⏭️ Deferidos
- **Análise**: handlers/agent.js, handlers/system-config.js e commands/session.js
  requerem mocks pesados de HTTP req/res e estado global do terminal.
  ROI baixo vs. testes funcionais já existentes no integration suite.
- **Decisão**: Deferidos para fase futura (se integração revelar gaps).

### F192: Validação de Faixa 7 — ✅
- **F192.1** ✅: `npm run lint` — 0 erros (1 warning pre-existente), 2632 tests passed, 0 failed
- **F192.2** ✅: terminal: 3 → **7 test files** (4 novos), **67 novos testes**
- **F192.3** ✅ (ajustado): God modules mantidos — análise demonstrou API estreitas e decomposição
  principal (route-table, repl-listeners) já realizada
- **F192.4** ✅: Commit: `feat(terminal): Faixa 7 (F179-F192) — 67 testes terminal`

---

## Faixa 8 — Tools Decomposição + Testes (F193-F206) ✅ CONCLUÍDA

> **Objetivo**: Decompor 3 god modules em tools/, adicionar testes críticos.
> **Status**: ✅ CONCLUÍDA — Commit `667608da` (2026-04-09)
> **Resultado**: +108 testes novos (5 arquivos), F193-195 decomposição avaliada e descartada.

### Auditoria de Decomposição (F193-F195)

**Decisão**: Decomposição descartada com justificativa técnica.

Os 3 "god modules" (`crud-tools.js` 459L, `store.js` 422L, `introspection-tools.js` 409L) são
coleções planas de tool definitions SDK — cada tool é self-contained com handler próprio.
Decompor geraria arquivos de 50-90L sem redução real de complexidade, apenas aumento de indireção.
Mesma lógica aplicada em F187/F188/F189-F191 na Faixa 7.

- **F193**: ✅ SKIP — `crud-tools.js` é coleção plana de 6 tools SDK (cada ≤80L), não god module
- **F194**: ✅ SKIP — `store.js` agrupa schemas + persistence + helpers internos coesos
- **F195**: ✅ SKIP — `introspection-tools.js` não separa em system/workspace/debug (6 tools interligadas)

### Testes Criados (5 arquivos, 108 testes)

### F197: `test_web_tools.spec.js` — 18 testes ✅
- Exports (3): webTools array, includes web_fetch, includes web_search
- web_fetch (10): valid URL, invalid URL, SSRF 127.0.0.1, SSRF 10.x, non-text content-type,
  AbortError timeout, network ECONNREFUSED, redirect to private IP, truncation, no body
- web_search (5): DDG JSON API results, fallback HTML scraping, SSRF filter, timeout, non-OK status

### F199: `test_hub_tools.spec.js` — 24 testes ✅
- Exports (2): hubTools array com 5 tools, nomes corretos
- hub_create_session (5): sucesso, metadata, hub indisponível, hub não pronto, erro interno
- hub_send_message (6): sucesso, structured context/intent, truncation 32K, timeout clamp 300s,
  hub indisponível, erro sendToLlmB
- hub_poll_user_messages (3): mensagens pendentes, sem mensagens, hub indisponível
- hub_read_history (5): turns + total, limit/offset, after polling, truncation 500c, hub indisponível
- hub_list_sessions (3): lista sessões, filtro por status/limit, hub indisponível

### F203: `test_session_rpc_tools.spec.js` — 15 testes ✅
- Exports (2): sessionRpcTools array com 8 tools, nomes corretos
- RPC indisponível (1): todas as 8 tools retornam erro quando RPC é null
- session_mode_get (1), session_mode_set (2), session_plan_read (1), session_plan_update (1),
  session_plan_delete (1), session_agent_list (1), session_agent_select (2: selecionar + deselect),
  session_compact (1)
- wrapRpc error handling (2): erro RPC, timeout 5s

### F204: `test_git_tools.spec.js` — 27 testes ✅
- Exports (2): gitTools array com 9 tools, nomes corretos
- git_status (2): combined output, error handling
- git_diff (4): completo, staged, path específico, truncation 200 linhas
- git_commit (4): all=true, paths, nenhum staged → erro, commit falha
- git_changed_files (1), git_push (3): origin padrão, setUpstream, sanitize remote
- git_create_branch (5): com checkout, sem checkout, base, nome inválido, base inválida
- git_log (3): default, n customizado, oneline=false
- git_current_branch (1), git_is_dirty (2): dirty/clean

### `test_introspection_tools.spec.js` — 24 testes ✅
- Exports (2): introspectionTools com 6 tools, nomes corretos
- registerForIntrospection (1): registra tools para list_tools
- isToolDisabled/getDisabledTools (2): default false, array vazio
- list_tools (4): lista todas, search filter, category filter, exclui disabled
- get_agent_info (1): nodeVersion, model, toolsRegistered, toolNames, env
- get_telemetry (3): summary completo, filter por toolName, toolName inexistente
- report_intent (2): intent + confirmação, risk default=low
- toggle_tool (4): desabilitar, habilitar, proteger introspection, tool inexistente
- get_tool_health (5): todas tools, tool específico, tool inexistente, sort por error_rate, limit

### Itens já cobertos por testes pré-existentes

- **F196** (`file/read-tools.js`): ✅ Coberto por `test_file_tools.spec.js` (41 testes)
  - read_file_content, list_directory, search_in_files, diff_files
  - Path traversal protection, .env blocking, symlink protection
- **F198** (`shell/index.js`): ✅ Coberto por `test_shell_tools.spec.js` (31 testes)
  - Command execution, sandbox enforcement, timeout
- **F200** (`hook-tools.js`): ✅ Coberto por `test_hook_tools.spec.js` (17 testes)
  - Hook runner management
- **F201** (`todo/query-tools.js`): ✅ Coberto por `test_todo_tools.spec.js` (71 testes)
  - Query tools, database setup, filter, search
- **F202** (`file/write-tools.js`): ✅ Coberto por `test_file_tools.spec.js` (41 testes)
  - write_file_content, create_file, delete_file, copy_file, move_file, patch_file
- **F205** (`todo/bulk-tools.js`): ✅ Coberto por `test_todo_tools.spec.js` (71 testes)
  - todo_bulk_update, múltiplos IDs, validação

### F206: Validação de Faixa 8 ✅
- **F206.1**: ✅ `npm run lint` — 0 errors (1 warning pré-existente), `npx vitest run` — 2817 passed
- **F206.2**: ✅ tools: 6 → 11 test files, +108 testes novos
- **F206.3**: ✅ God modules: avaliados → não são god modules (coleções planas), SKIP justificado
- **F206.4**: ✅ Commit: `667608da` — `feat(tools): Faixa 8 — 108 testes para 5 módulos tools sem cobertura`

---

## Faixa 9 — Observability: Testes + Cleanup (F207-F216) ✅ CONCLUÍDA

> **Objetivo**: Corrigir catch blocks em observability/,
> testar collectors e observers, resetar metrics.
>
> **Status**: ✅ 102 testes novos em 5 arquivos. Todos passando. Lint limpo.
> Suite completa: 2919 passed, 53 skipped, 0 failed.

### F207: Testes para `observability/otel.js` ✅
- `tests/unit/copilot/observability/test_otel.spec.js` — **11 testes**
- buildTelemetryConfig: disabled→undefined, default→file, endpoint→otlp-http, explicitExporterType, sourceName+captureContent
- isOtelEnabled: true/false
- startSpan: graceful fallback sem OTEL, propagação de erros
- startSpanImmediate: retorna null sem tracer
- DEFAULT_OTEL_FILE: path validation

### F208: Testes para `observability/metrics.js` (425L) ✅
- `tests/unit/copilot/observability/test_metrics.spec.js` — **24 testes**
- recordToolCall: sucesso, erro, acumulação, histograma de latência
- recordUsage: acumulação por modelo, separação multi-modelo
- Session counters: start/end/error/rotation/keepalive/cleanup/handoff (7 campos)
- Dialog: turns, stalls, stallSumMs, timeouts, histograma
- Tasks: completed, failed, histograma
- Streaming/Questions: chunks, question latency
- Counters genéricos: increment com delta, default delta=1
- Gauges: valor+timestamp, sobrescrita de valor
- getSummary: estrutura completa, imutabilidade (cópia rasa)
- reset: zera todos contadores/histogramas/gauges/counters
- defaultMetrics: singleton com interface completa

### F209: Metric reset em `metrics.js` ✅ JÁ IMPLEMENTADO
- `reset()` já existe e funciona (testado em F208)
- `startPeriodicSnapshot()`/`stopPeriodicSnapshot()` integrados com timer-registry
- `resetCounters()` separado não necessário — `reset()` cobre o caso completo
- **Justificativa**: reset granular adicionaria complexidade sem benefício — o padrão `reset()` + snapshot periódico é idiomático

### F210: Testes para `event-collector.js` (391L) — Cobertura via F212+F214
- event-collector.js é uma factory que delega para collectors/ e observers/
- Os handlers individuais (session, dialog, tool) são testados via F212 e F214
- Funções exportadas (getLastQuotaSnapshots, getCompactionHistory) são testadas indiretamente via session-handlers

### F211: Bounded buffer em `event-collector.js` ✅ JÁ IMPLEMENTADO
- `MAX_EVENTS_BYTES` com rotação (`rename → .1`) quando tamanho excede o limite
- `MAX_COMPACTION_ENTRIES = 50` com `list.shift()` — ring buffer pattern
- `_writeQueue.splice(0)` para batch flush — bounded por design
- **Justificativa**: buffer já implementado no código fonte original; `maxEvents` baseado em count seria redundante com o limite baseado em bytes (`COPILOT_EVENTS_MAX_BYTES`)

### F212: Testes para `observers/dialog-task-handlers.js` (424L) ✅
- `tests/unit/copilot/observability/test_dialog_task_handlers.spec.js` — **28 testes**
- dialog.turn_start/turn_end: duração correta, reply vazio = falha, fallback turnId="current", lastTurnDurationMs/lastTurnSuccess accessors
- dialog.stalled: stalledMs, default 0
- dialog.turn_timeout: phase+counter, errorTracker, phase="unknown" fallback
- dialog.loop.changed: activated/deactivated, gauge
- Simple events: ready, paused, resumed, reply, stopped (com reason)
- task.completed: duração+counter, default durationMs=0
- task.error: falha+errorTracker+sessionError
- task.queued/started: counters
- task.delta: streaming deltas+bytes
- task.reasoning: reasoning chunks+bytes
- tool.execution_start/complete: callId tracking, durationMs, toolName
- tool.execution_progress: counter
- pr.fallback_model/consumed: counters
- session.usage: counter+modelStatsTracker
- resetChunkTs: accessor funcional

### F213: Decomposição dialog-task-handlers.js ⏭️ SKIP
- **Justificativa**: Mesmo padrão da Faixa 8 — coleção flat de handlers de eventos via `on(agent, event, safe(fn))`.
  Cada handler é atômico e independente; coesão temática forte (todos são observers do AgentEventObserver).
  Decomposição por categoria (turn/tool/session) fragmentaria sem benefício real, dado que cada handler é <20 linhas.
  424L é aceitável para um arquivo de handlers puros sem lógica de estado compartilhada complexa.

### F214: Testes para `collectors/session-handlers.js` (391L) ✅
- `tests/unit/copilot/observability/test_session_handlers.spec.js` — **27 testes**
- Retorna array de 20+ unsubscribers
- session.error: errorTracker+metrics+persist
- session.start: recordSessionStart+ model counter+persist (sdkSessionId, copilotVersion, selectedModel, context.branch)
- session.resume: resumed counter, already_in_use flag
- session.compaction: start+complete persistência
- session.context_changed: branch/repository/cwd
- session.handoff: handoff counter + sourceType counter
- session.skills_loaded: skills_loaded counter, enabled count
- session.extensions_loaded: persist com running count
- session.mcp_server_status_changed: connected/failed counters
- session.title_changed: counter + persist título
- session.workspace_file_changed: operation counter
- session.info: counter + persist
- Batch persistence: 9 event types testados via .each
- cleanup: todos unsubscribers funcionam sem erro

### F215: Testes para `tool-stats.js` + `agent-event-observer.js` ✅
- `tests/unit/copilot/observability/test_tool_stats.spec.js` — **18 testes**
- recordToolCall: sucesso, erro, default success=true, acumulação
- getToolStats: snapshot vazio, avgLatencyMs, errorRate, lastCallIso
- getStatsByCategory: agrupamento por prefixo, "other" fallback, avgLatencyMs, erros, sorting
- wrapWithStats: sucesso, rejeição (propaga erro), handler não-função, preserva propriedades
- _resetToolStats: limpa estado
- `agent-event-observer.js`: **já coberto por test_agent_event_observer.spec.js pré-existente** (7 testes: task.completed, task.error, task.queued, task.started, counters, ErrorTracker propagação)

### F216: Validação de Faixa 9 ✅
- `npx eslint tests/unit/copilot/observability/` — 0 erros
- Suite completa: **2919 passed**, 53 skipped, 0 failed
- Novos testes: **+102** (era 2817 na Faixa 8)
- Arquivos de teste novos: 5 (`test_metrics`, `test_otel`, `test_tool_stats`, `test_dialog_task_handlers`, `test_session_handlers`)
- Commit: `feat(observability): Faixa 9 (F207-F216) — 102 tests for observability modules`

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
