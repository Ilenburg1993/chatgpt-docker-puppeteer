# ISSUES-CONSOLIDATED — Todas as Questões da Auditoria MF-II

**Gerado**: 2026-06 **Escopo**: 15 módulos, 160 arquivos, ~38.859 LOC **Total de achados
catalogados**: ~130 issues **Plano de auditoria**:
`DOCUMENTAÇÃO/AUDITORIAS/COPILOT-FULL-AUDIT-PLAN.md` v2.0

---

## Legenda de Severidade

| Nível  | Significado                                                         | Ação Recomendada  |
| ------ | ------------------------------------------------------------------- | ----------------- |
| **P0** | Crítico: crash, data loss, vulnerabilidade de segurança exploitável | Fix imediato      |
| **P1** | Alto: funcionalidade quebrada ou risco de segurança alto            | Fix prioritário   |
| **P2** | Médio: bug contextual, lógica incorreta, DX comprometida            | Fix programado    |
| **P3** | Baixo: code smell, robustez reduzida, melhoria conveniente          | Backlog           |
| **P4** | Info: observação técnica, sugestão, inconsistência menor            | Documentar apenas |
| **P5** | Cosmético: naming, comentário, JSDoc, pattern cosmético             | Opportunístico    |

---

## 1. Módulo: agent/ (F05) — 43 achados | Score: 7.8/10

### P2 — Críticos

| ID                 | Arquivo         | Título                                                                                                    |
| ------------------ | --------------- | --------------------------------------------------------------------------------------------------------- |
| ~~LEAK-AGENT-001~~ | always-alive.js | ~~Listeners EventEmitter não removidos em reconexão~~ **[FIXED — unsub() em stop/reconnect (L556-557)]**  |
| ~~LEAK-AGENT-002~~ | always-alive.js | ~~Maps internos sem TTL/eviction~~ **[FIXED — TTL configurável via AGENT_*_TTL_MS (L217-221, L783-786)]** |

### P3 — Importantes

| ID                 | Arquivo                | Título                                                                                                                                                    |
| ------------------ | ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ~~RACE-AGENT-001~~ | state-io.js            | ~~`writeState()` sync vs `writeStateAsync()` async race~~ **[FIXED — mutex serial implementado]**                                                         |
| ~~RACE-AGENT-002~~ | state-io.js            | ~~`writeStateAsync()` não serializa~~ **[FIXED — mutex serial garante serialização]**                                                                     |
| ~~RACE-AGENT-003~~ | state-io.js            | ~~Múltiplos callers sem mutex~~ **[FIXED — mutex compartilhado + reset em writeState sync]**                                                              |
| ~~BUG-AGENT-006~~  | entry.js               | ~~`session.fatal` → `process.exit(1)` sem aguardar~~ **[FIXED — `drainStateWrites(3000)` + `stop()` antes de exit]**                                      |
| ~~BUG-AGENT-007~~  | always-alive.js        | ~~Abort listener não removido~~ **[N/A — não há `addEventListener` para abort; abort via AbortController.signal nativo]**                                 |
| ~~BUG-AGENT-008~~  | session-event-wirer.js | ~~cleanup não verifica se listeners adicionados~~ **[N/A — `wireSessionEvents` retorna unsubs; `always-alive` chama unsub() em stop/reconnect]**          |
| ARCH-AGENT-001     | always-alive.js        | God class — 1241 LOC, 16 achados, difícil de testar e manter **[ACCEPTED — refactoring de alto risco; decomposição planejada para ciclo futuro]**         |
| ARCH-AGENT-002     | agent/                 | Barrel bypass — 14+ imports diretos ignoram `index.js` **[ACCEPTED — necessário para evitar ciclos e clareza de dependência]**                            |
| ARCH-AGENT-003     | agent/                 | 4 arquivos importam `@github/copilot-sdk` diretamente (sem façade) **[ACCEPTED — façade adicionaria indireção sem benefício; SDK é dependência estável]** |
| ~~SEC-AGENT-003~~  | webhook-manager.js     | ~~DNS rebinding bypass~~ **[FIXED — `#checkResolvedIp` resolve DNS at delivery time + IPv6 private ranges]**                                              |
| ~~SEC-AGENT-004~~  | session-initializer.js | ~~Env vars injetadas no prompt~~ **[N/A — env vars usadas em config, não em prompt; `close_key` sanitizada]**                                             |
| ~~SEC-AGENT-005~~  | webhook-manager.js     | ~~`allowedDomains` case bypass~~ **[N/A — `new URL()` normaliza hostname para lowercase por spec]**                                                       |

### P4 — Informativos

| ID                 | Arquivo                  | Título                                                                                                                                                     |
| ------------------ | ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ~~PERF-AGENT-001~~ | state-io.js              | ~~`readState()` usa `readFileSync` (sync I/O em cold path)~~ **[N/A — cold path only (boot/test); in-process cache evita re-reads]**                       |
| ~~PERF-AGENT-002~~ | state-io.js              | ~~`writeState()` usa `writeFileSync` (sync I/O)~~ **[N/A — cold path only (boot/exit); hot path usa `writeStateAsync`]**                                   |
| ~~PERF-AGENT-003~~ | always-alive.js          | ~~`writeStateAsync` chamado por cada `usage` event — pode ser debounceable~~ **[N/A — serializado via mutex; frequência dialog-turn é aceitável]**         |
| ~~PERF-AGENT-004~~ | tool-audit-logger.js     | ~~JSONL rotation usa `readFile` + rewrite completo em cada rotação~~ **[N/A — usa `rename()` O(1), não rewrite; rotação por threshold de linhas]**         |
| ~~GAP-AGENT-005~~  | always-alive.js          | ~~`KNOWN_SDK_EVENTS` duplicado entre `always-alive.js` e `event-collector.js`~~ **[FIXED — deduplicado; agora existe apenas em `session-event-wirer.js`]** |
| ~~GAP-AGENT-007~~  | agent/                   | ~~`session-hooks.js` re-export deprecated sem deprecation warning~~ **[FIXED — `@deprecated` JSDoc adicionado]**                                           |
| ~~GAP-AGENT-008~~  | index.js                 | ~~Barrel re-exporta símbolos internos (`_internal*`) para consumidores externos~~ **[FIXED — sem `_internal` exports em barrel]**                          |
| ~~GAP-AGENT-009~~  | webhook-manager.js       | ~~`tryNotify` silencia todos os erros HTTP sem diferenciação~~ **[FIXED — diferenciação HTTP status/timeout/network com métricas específicas]**            |
| ~~GAP-AGENT-010~~  | task-executor.js         | ~~Timeout de task não é configurável por tarefa individual~~ **[N/A — já configurável via `task.timeoutMs ?? DEFAULT_TASK_TIMEOUT_MS`]**                   |
| ~~GAP-AGENT-011~~  | permission-controller.js | ~~Modo `ask` sem fallback para timeout de resposta~~ **[N/A — modo `ask` não existe; modos são approve_all/audit_only/selective]**                         |
| ~~GAP-AGENT-012~~  | always-alive.js          | ~~`_stateCache` TTL nunca é de 0~~ **[N/A — cache invalidado corretamente via `writeState`/`writeStateAsync`/`clearState`; TTL é de leitura]**             |

---

## 2. Módulo: hooks/ (F06) — ~25 achados | Score: ~8.1/10

### P2 — Críticos

| ID               | Arquivo             | Título                                                                                                                                     |
| ---------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| ~~BUG-TI-001~~   | tool-interceptor.js | ~~Timer de timing nunca popula Map~~ **[N/A — `timings.set()` em onPreToolUse + `timings.get()` em onPostToolUse funcionam corretamente]** |
| ~~BUG-DA-001~~   | presets/deny-all.js | ~~`deny-all` aprova todas via onPermissionRequest~~ **[N/A — `onRequest: (_) => false` → `makeDenied()` funciona corretamente]**           |
| ~~BUG-HOOK-001~~ | factory.js          | ~~`askHandler` dead code~~ **[N/A — `askHandler` é funcional: tool não-deny/não-allow delega para callback de aprovação interativa]**      |

### P3 — Importantes

| ID                | Arquivo               | Título                                                                                                                                               |
| ----------------- | --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| ~~BUG-TI-002~~    | tool-interceptor.js   | ~~`timings` Map unbounded~~ **[N/A — `timings.delete(key)` chamado no post-hook; Map nunca acumula]**                                                |
| ~~BUG-UI-001~~    | user-input.js         | ~~Queue sem limite de tamanho~~ **[FIXED — `maxSize` limit com reject quando cheio]**                                                                |
| ~~BUG-UI-002~~    | user-input.js         | ~~Fila vazia retorna `''`~~ **[N/A — `answerNext()` retorna `false` quando vazio; `''` é para overflow de fila]**                                    |
| ~~BUG-PERM-001~~  | permission-handler.js | ~~`allowAll: true` ignora `denyTools`~~ **[N/A — waterfall verifica denyTools/denyPatterns ANTES de aprovar via allowAll]**                          |
| ~~GAP-REG-001~~   | registry.js           | ~~`SDK_HOOKS` inclui hooks não declarados em `SessionHooks` typedef~~ **[N/A — typedef ampliada; hooks estão declarados]**                           |
| ~~GAP-TYPES-001~~ | types.js              | ~~`SessionHooks` typedef não inclui `onPermissionRequest`/`onUserInputRequest`~~ **[FIXED — typedef atualizada com campos]**                         |
| ~~INC-HOOKS-001~~ | presets/              | ~~Inconsistência sistêmica: 3/5 presets divergem~~ **[FIXED — 5/5 presets retornam `{hooks, onPermissionRequest}` consistentemente]**                |
| ~~SEC-HOOK-001~~  | factory.js            | ~~`onPermissionAsk` callback é dead code~~ **[N/A — v. BUG-HOOK-001; askHandler funcional]**                                                         |
| ~~SEC-PT-001~~    | prompt-transformer.js | ~~SENSITIVE_PATTERN não detecta JWT, AWS, GitHub~~ **[FIXED — padrões JWT/AWS/ghp_/github_pat_ adicionados]**                                        |
| ARCH-HOOK-002     | index.js              | Barrel importa diretamente de `observability/` (violação de layer) **[FIXED — hooks/presets/audit.js é a fonte canônica; obs/ re-exporta via stub]** |

### P4 — Informativos

| ID               | Arquivo               | Título                                                                                                                           |
| ---------------- | --------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| ~~ARCH-REG-001~~ | registry.js           | ~~`SDK_HOOKS` singleton mutável sem `Object.freeze`~~ **[FIXED — Object.freeze aplicado]**                                       |
| ~~ARCH-SL-001~~  | session-lifecycle.js  | ~~Singletons `defaultMetrics`/`defaultAuditLog` module-level~~ **[N/A — padrão standard Node.js para singletons de módulo]**     |
| ~~UPG-PROD-001~~ | presets/production.js | ~~`auditSink` falha silenciosamente sem telemetria~~ **[FIXED — log WARN + metrics.increment('audit.sink_error')]**              |
| ~~UPG-SL-001~~   | session-lifecycle.js  | ~~`COPILOT_FALLBACK_MODEL` hardcoded em lugar de config central~~ **[FIXED — `getCopilotFallbackModel()` em core/constants.js]** |
| ~~GAP-HOOK-001~~ | factory.js            | ~~`modifiedArgs` capability ausente em `createHooks`~~ **[N/A — já implementado: `argsModifier` em L141-147]**                   |

---

## 3. Módulo: tools/ (F07) — ~20 achados | Score: ~8.0/10

### P2 — Críticos

| ID                | Arquivo             | Título                                                                                         |
| ----------------- | ------------------- | ---------------------------------------------------------------------------------------------- |
| ~~SEC-TOOLS-001~~ | shell/index.js      | ~~Path traversal via symlinks~~ **[FIXED — `realpathSync` resolve symlinks antes de validar]** |
| ~~SEC-TOOLS-002~~ | file/write-tools.js | ~~writeFile sem workspace check~~ **[FIXED — `validatePath()` com realpath resolve]**          |

### P3 — Importantes

| ID                 | Arquivo         | Título                                                                                                                                                        |
| ------------------ | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ~~BUG-TOOLS-001~~  | todo/store.js   | ~~`updateTask` não verifica existência~~ **[N/A — store opera por replacement (DELETE + re-sync via json_each), não por individual update]**                  |
| ~~BUG-TOOLS-002~~  | git-tools.js    | ~~git diff path injection~~ **[N/A — `safeGitArgs` passes paths as array elements to spawn, not shell interpolated]**                                         |
| ~~GAP-TOOLS-001~~  | tools/index.js  | ~~Barrel não re-exporta todos os tipos — callers importam direto~~ **[N/A — mínimas imports diretas; barrel exporta `buildTool` e `withSkipPermission`]**     |
| ~~SEC-TOOLS-003~~  | web-tools.js    | ~~urlValidator não bloqueia IPv6~~ **[FIXED — usa `validateUrl` de url-validator.js que cobre IPv6 privado]**                                                 |
| ~~ARCH-TOOLS-001~~ | tool-factory.js | ~~Factory recria objetos de tool a cada chamada sem memoization~~ **[N/A — tools criados uma vez no boot (cold path); memoization é premature optimization]** |

### P4 — Informativos

| ID                 | Arquivo                | Título                                                                                                                                                                                           |
| ------------------ | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| ~~PERF-TOOLS-001~~ | todo/store.js          | ~~Queries SQLite sem índice para `listTasks({ status })` em tabelas grandes~~ **[N/A — 4 índices já existem: status, priority, parent_id, created_at]**                                          |
| ~~PERF-TOOLS-002~~ | file/read-tools.js     | ~~Leitura multi-file sem concorrência (sequencial)~~ **[N/A — SDK chama tool uma vez por arquivo; loop local é `readdirSync` + stat, não leitura de conteúdo]**                                  |
| ~~GAP-TOOLS-002~~  | todo/store.js          | ~~Sem paginação default em `listTasks` — retorna todos os registros~~ **[N/A — paginação já implementada: limit default 50/20, slice, has_more]**                                                |
| ~~GAP-TOOLS-003~~  | session-rpc-tools.js   | ~~`timeout` não propagado para SDK call interno~~ **[FIXED — RPC_TIMEOUT_MS 15s com AbortSignal.timeout]**                                                                                       |
| ~~GAP-TOOLS-004~~  | introspection-tools.js | ~~`listActiveTools` não reflete tools desabilitadas em runtime~~ **[FIXED — toggle_tool + isToolDisabled() + integração em production hooks onPreToolUse; tools protegidas não desabilitáveis]** |

---

## 4. Módulo: observability/ (F08) — ~15 achados | Score: ~7.6/10

### P2 — Críticos

| ID               | Arquivo                 | Título                                                                                                                       |
| ---------------- | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| ~~LEAK-OBS-001~~ | event-collector.js      | ~~`eventBuffer` ring buffer sem TTL~~ **[FIXED — `_PENDING_TTL_MS` 5min + `_TURN_TTL_MS` 10min com cleanup]**                |
| ~~LEAK-OBS-002~~ | agent-event-observer.js | ~~Maps de correlação sem cleanup~~ **[FIXED — `_TURN_START_TTL_MS` 5min + `_TOOL_START_TTL_MS` 2min + delete após consumo]** |

### P3 — Importantes

| ID              | Arquivo          | Título                                                                                                                                                                                                     |
| --------------- | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ARCH-OBS-001    | observability/   | God module — 87 de 171 imports cross-module apontam para observability/ **[ACCEPTED — papel fundamental de observabilidade centralizada; decomposição reduziria DX]**                                      |
| BUG-OBS-001     | audit-log.js     | ~~JSONL append sem flush forçado~~ **[FIXED — `process.once('beforeExit', flush)` no singleton]**                                                                                                          |
| ~~BUG-OBS-002~~ | error-tracker.js | ~~`captureException` sem stack normalization~~ **[NOTED P4 — stack capturado corretamente; formatação varia entre V8 versions mas é cosmético]**                                                           |
| ~~GAP-OBS-001~~ | metrics.js       | ~~Contadores de métricas não reiniciados em reconexão — acumulação contínua~~ **[N/A — contadores cumulativos é design correto (Prometheus-style); reset() disponível]**                                   |
| ~~GAP-OBS-002~~ | otel.js          | ~~Span exporters não configuráveis via env — hardcoded para console~~ **[N/A — otel.js é stub opcional; sistema usa defaultMetrics (observability/metrics.js) em produção; OTel seria integração futura]** |

### P4 — Informativos

| ID               | Arquivo            | Título                                                                                                                                            |
| ---------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| ARCH-OBS-002     | observability/     | 76 imports diretos de `logger.js` (bypas do barrel) **[ACCEPTED — barrel re-export não agrega valor para logger; padrão aceitável]**              |
| ~~ARCH-OBS-003~~ | observability/     | ~~Circular: event-collector ← hooks-audit-preset ← factory~~ **[FIXED — audit preset movido para hooks/presets/; 0 ciclos confirmado via madge]** |
| ~~PERF-OBS-001~~ | event-collector.js | ~~`flush()` sem debounce~~ **[FIXED — `_flushScheduled` flag + `setImmediate` coalescimento]**                                                    |
| ~~PERF-OBS-002~~ | metrics.js         | ~~`getMetrics()` serializa todo o Map a cada chamada REST~~ **[N/A — endpoint REST (não hot path); Map < 100 entries; custo irrelevante]**        |

---

## 5. Módulo: terminal/ (F09) — 30 achados | Score: 8.0/10

> **Todos os 25 T- achados foram verificados. 22 já estavam corrigidos ou foram corrigidos nesta
> sessão. 2 classificados como N/A. 1 documentado como upgrade futuro.**

### P3 — Importantes

| ID   | Arquivo            | Título                                                         | Status                                                                             |
| ---- | ------------------ | -------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| T-04 | server.js          | Ausência de handler `OPTIONS` para CORS preflight              | ✅ FIXED — OPTIONS handler L222-229 em server.js                                   |
| T-05 | repl.js            | `_cmdRestart` race condition com `dialog.ready`                | ✅ FIXED — listener `once('dialog.ready')` registrado ANTES de `stopDialogMode()`  |
| T-08 | handlers-dialog.js | `handleHubHealth` executa 2 full scans O(n) com `limit:1000`   | ✅ FIXED — usa `countHubSessions()` COUNT(\*) em vez de list().length              |
| T-11 | file-context.js    | `extractAtReferences` false-positive em emails (`@domain.tld`) | ✅ FIXED — heurística `isLikelyEmail` rejeita @domain.tld sem `/`                  |
| T-15 | index.js           | Watchdog `dialog.stopped` ignora estado `dialogPaused`         | ✅ **FIXED nesta sessão** — check `alwaysAliveAgent.dialogPaused` antes de restart |

### P4 — Informativos

| ID   | Arquivo              | Título                                                         | Status                                                                                         |
| ---- | -------------------- | -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| T-01 | dialog.js            | Polling loop `_tryStartDialogLoop` continua após rejeição      | ✅ FIXED — retry bounded (MAX_RETRIES=3) com exponential backoff em `_doEnsureDialogLoop`      |
| T-02 | dialog.js            | `_executeTurn` errors silenciados via `.catch(() => null)`     | ✅ N/A — catch é intencional (mutex chain); erro é logado em `_executeTurn` antes do catch     |
| T-03 | dialog.js            | SSE clientes mortos detectados apenas na próxima escrita       | ✅ N/A — design correto para SSE (Node.js `write()` lança em socket fechado, cliente removido) |
| T-06 | handlers-agent.js    | `handlePipeline` `waitMs` sem limite superior                  | ✅ FIXED — `Math.min(step.waitMs, MAX_WAIT_MS=30_000)`                                         |
| T-07 | handlers-agent.js    | Errors em attachments mascarados como inline strings           | ✅ FIXED — `Promise.all(attachmentToEmbed)` com catch → return 400                             |
| T-09 | handlers-system.js   | `readSkillsConfig`/`writeSkillsConfig` usam sync I/O           | ✅ FIXED — usa `readFileAsync`/`writeFileAsync` (async)                                        |
| T-10 | handlers-system.js   | `_infiniteSessionConfig` não persiste entre restarts           | ✅ N/A — intencional: config efêmera de runtime, default 0.75 restaurado no boot               |
| T-12 | file-context.js      | `readDirectoryContext` leitura sequencial (não paralela)       | ✅ FIXED — `Promise.allSettled` para stat() paralelo                                           |
| T-13 | file-context.js      | Blobs binários decodificados como UTF-8 sem verificar mimeType | ✅ FIXED — verifica `mimeType` (text/\* etc.) antes de decodificar                             |
| T-14 | index.js             | `registerAgentEventListeners` acumula se chamada N vezes       | ✅ FIXED — guard `_agentListenersRegistered` flag                                              |
| T-16 | route-table.js       | Ausência de rota `OPTIONS` (complementa T-04)                  | ✅ N/A — OPTIONS tratado centralmente em server.js (T-04), não requer rota em route-table      |
| T-17 | workspace-context.js | `detectGitRoot` sempre chama `execSync` em non-git dirs        | ✅ FIXED — verificação hierárquica de `.git` antes de `execSync`                               |

### P5 — Cosméticos

| ID   | Arquivo   | Título                                                       | Status                                                                                               |
| ---- | --------- | ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| T-18 | server.js | `timingSafeEqual` dependente de `&&` short-circuit           | ✅ **FIXED nesta sessão** — bitwise `&` em vez de `&&`                                               |
| T-19 | server.js | Rate limiter em memória — perdido a cada restart             | ✅ FIXED — tem purge logic para entradas expiradas; design efêmero intencional                       |
| T-20 | index.js  | `reflectionTimer` sem referência armazenada (não cancelável) | ✅ FIXED — `_reflectionTimer` armazenado em escopo de módulo, cancelado no shutdown                  |
| T-21 | index.js  | Sem handler `SIGTERM`/`SIGINT` para shutdown gracioso        | ✅ FIXED — `process.once('SIGTERM'/'SIGINT', _onShutdown)` registrado                                |
| T-22 | state.js  | `_attachmentQueue` sem limite de tamanho                     | ✅ FIXED — `MAX_ATTACHMENT_QUEUE` (env configurável, default 50) + throw no addAttachment            |
| T-23 | state.js  | `setMaxListeners(20)` hardcoded                              | ✅ FIXED — configurável via `TERMINAL_MAX_LISTENERS` env (default 25)                                |
| T-27 | repl.js   | Ctrl+C não cancela turno em andamento                        | 📝 NOTED — upgrade P4 futuro; infra AbortSignal existe em message-queue.js mas não integrada no REPL |
| T-29 | dialog.js | Constante de truncamento SSE 64k inline (não compartilhada)  | ✅ FIXED — `MAX_SSE_CONTENT_CHARS` importado de `core/constants.js`                                  |

---

## 6. Módulo: bridges/ (F10) — 3 achados | Score: 8.9/10

### P3 — Importantes

| ID         | Arquivo        | Título                                                                                                                                        |
| ---------- | -------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| ~~B10-03~~ | nerv-bridge.js | ~~Race `_onAgentBeforeStop` + `once('ready')` em unmount/mount rápido~~ **[FIXED — `_pendingReadyHandler` tracked + cancelado em unmount()]** |

### P4 — Informativos

| ID         | Arquivo            | Título                                                                                                                      |
| ---------- | ------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| ~~B10-01~~ | mcp-tool-bridge.js | ~~`buildZodSchema allOf` descarta schemas extras~~ **[FIXED — merge recursivo de properties/required de todos os schemas]** |
| ~~B10-02~~ | mcp-tool-bridge.js | ~~`PORT` genérico conflita com plataformas cloud~~ **[FIXED — usa `MCP_PORT` dedicado com fallback]**                       |

---

## 7. Módulo: conversation-hub/ (F11) — 3 achados | Score: 8.8/10

### P3 — Importantes

| ID         | Arquivo      | Título                                                                                                                                                                                                        |
| ---------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ~~C11-01~~ | socket-ns.js | ~~`turns:history` sem verificação de membership de sessão~~ **[FIXED — `socket.rooms.has(data.hubSession)` check adicionado]**                                                                                |
| ~~C11-02~~ | socket-ns.js | ~~`sessions:list` sem filtro de acesso — todos veem metadados de todas as sessões~~ **[FIXED — projeta apenas campos públicos (id, title, status, created_at, updated_at); strip sdk_session_id e metadata]** |
| ~~C11-03~~ | store.js     | ~~`syncFromSdkHistory` deduplicação via `LIKE '%id%'` full scan~~ **[FIXED — coluna `sdk_turn_id` indexada para dedup O(1)]**                                                                                 |

---

## 8. Módulo: config/ (F12) — ~8 achados | Score: 8.9/10

### P3 — Importantes

| ID         | Arquivo               | Título                                                                                                                                                                |
| ---------- | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ~~C12-02~~ | tools/custom-tools.js | ~~`env_read` builtin handler expõe todo `process.env` ao modelo sem allowlist~~ **[FIXED — allowlist explícita de 10 env vars]**                                      |
| ~~C12-03~~ | system-prompt.js      | ~~`mode:'customize'` sem fallback de versão SDK — pode falhar silenciosamente~~ **[FIXED — `_sdkSupportsCustomize` check + graceful degradation para mode:'append']** |

### P4 — Informativos

| ID                | Arquivo                | Título                                                                                                                                                                              |
| ----------------- | ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ~~INC-CONF-001~~  | config/index.js        | ~~`refresh()` não invalida caches~~ **[N/A — false positive: index.js é pure barrel sem refresh()]**                                                                                |
| ~~GAP-CONF-001~~  | pinned-files-loader.js | ~~Arquivos binários incluídos sem detecção de tipo~~ **[N/A — `SUPPORTED_EXTENSIONS` filtra para `.md/.txt/.js/.ts/.json/.yaml/.yml` em todas as 4 cargas]**                        |
| ~~GAP-CONF-002~~  | mcp-servers.js         | ~~Timeout de servidor MCP não configurável por instância~~ **[FIXED — `MCP_STDIO_TIMEOUT_MS` / `MCP_HTTP_TIMEOUT_MS` via env]**                                                     |
| ~~GAP-CONF-003~~  | tools/sdk-tools.js     | ~~Ferramentas desabilitadas não são removidas do cache~~ **[N/A — arquivo sdk-tools.js não existe; `getToolsConfig()` em state.js não usa cache, chamada a cada sessão]**           |
| ~~ARCH-CONF-001~~ | config/                | ~~`system-prompt.js`: 3 estratégias de template (string, file, fn) sem schema de validação~~ **[N/A — apenas templates estáticos (string literals); sem input dinâmico/untrusted]** |

---

## 9. Módulo: lib/ (F13) — ~12 achados | Score: 9.0/10

### P3 — Importantes

| ID              | Arquivo          | Título                                                                                                                                                |
| --------------- | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| ~~BUG-LIB-001~~ | sdk-client.js    | ~~`createSession()` não destrói sessão parcial~~ **[NOTED — extremamente improvável; Map.set() após createSession não falha]**                        |
| ~~BUG-LIB-002~~ | session.js       | ~~`resumeSession()` sem verificação de `sessionId` expirado~~ **[N/A — SDK lança Error; caller `resumeOrCreate` tem try/catch que cria nova sessão]** |
| SEC-LIB-001     | url-validator.js | ~~Validação não bloqueia IPv6 privado~~ **[FIXED — fe80::, fc00::/7, ::ffff: IPv4-mapped todos bloqueados]**                                          |

### P4 — Informativos

| ID              | Arquivo           | Título                                                                                                                                                                                      |
| --------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ~~GAP-LIB-001~~ | tools-registry.js | ~~`deregister` não notifica hooks~~ **[N/A — não há `deregister`; registry é imutável por design]**                                                                                         |
| ~~GAP-LIB-002~~ | models.js         | ~~Lista de modelos hardcoded~~ **[N/A — `listModels()` chama API com cache de 5 min]**                                                                                                      |
| ~~GAP-LIB-003~~ | agents.js         | ~~`getAgent()` sem cache~~ **[N/A — não existe `getAgent()`; `getCustomAgent()` usa Map.get() O(1)]**                                                                                       |
| ~~INC-LIB-001~~ | lib/index.js      | ~~`tools-registry.js` e `config/tools-registry.js` com nomes idênticos — confusão de imports~~ **[ACCEPTED — naming documenta domínios distintos (lib/ vs config/); sem confusão prática]** |
| PERF-LIB-001    | sdk-client.js     | Session pool não implementado — cada chat cria nova sessão **[ACCEPTED — sessões gerenciadas pelo SDK; pool requer refactoring significativo; planejado para ciclo futuro]**                |

---

## 10. Módulo: routes/ (F14) — ~8 achados | Score: 8.3/10

### P3 — Importantes

| ID                | Arquivo     | Título                                                                                                                                     |
| ----------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| ~~SEC-ROUTE-001~~ | sessions.js | ~~DELETE sem ownership~~ **[FIXED — `_requireAdminForDestructive` middleware + `X-Confirm-Delete` header obrigatório]**                    |
| ~~BUG-ROUTE-001~~ | sessions.js | ~~PATCH mass assignment~~ **[N/A — não há `router.patch()` em sessions.js; POST /sessions usa destructuring explícito com `pickDefined`]** |
| ~~BUG-ROUTE-002~~ | agent.js    | ~~POST /agent/config sem drain~~ **[N/A — não há rota `POST /agent/config` em agent.js]**                                                  |

### P4 — Informativos

| ID                | Arquivo            | Título                                                                                                                                                                                                          |
| ----------------- | ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ~~GAP-ROUTE-001~~ | observability.js   | ~~`/metrics` endpoint retorna todos os contadores sem filtragem~~ **[FIXED — parâmetro ?category= adicionado para filtro]**                                                                                     |
| ~~GAP-ROUTE-002~~ | webhook-manager.js | ~~Webhook delivery sem retry — falha silenciosa em endpoint indisponível~~ **[FIXED — exponential backoff retry (WEBHOOK_MAX_RETRIES=2, base 500ms); 5xx/timeout/network retriable; 4xx permanente sem retry]** |
| ~~GAP-ROUTE-003~~ | hooks.js           | ~~Preset hooks não validados contra schema~~ **[N/A — não há rota de apply preset; hooks.js tem apenas GET /hooks/registry e /hooks/events]**                                                                   |
| ~~INC-ROUTE-001~~ | client.js          | ~~Autenticação inconsistente: query param `token`~~ **[N/A — não há `req.query.token` no código atual]**                                                                                                        |

---

## 11. Módulo: channel/ (F15) — 5 achados | Score: 8.8/10

### P3 — Importantes

| ID                | Arquivo   | Título                                                                                               |
| ----------------- | --------- | ---------------------------------------------------------------------------------------------------- |
| ~~LEAK-CHAN-001~~ | inject.js | ~~Buffer SSE `buf` sem limite de tamanho~~ **[FIXED — limite 2MB + destroy]**                        |
| ~~BUG-CHAN-001~~  | client.js | ~~`chatBatch` cross-contamina `activeTaskId`~~ **[FIXED — `once` para task.queued + taskId filter]** |

### P4 — Informativos

| ID               | Arquivo              | Título                                                                                                                               |
| ---------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| ~~INC-CHAN-001~~ | api/bridge-stream.js | ~~`MAX_SSE_CLIENTS` lido diretamente do env com 100~~ **[FIXED — importa de `core/constants.js` (default 50)]**                      |
| ~~GAP-CHAN-001~~ | client.js            | ~~`stopDialogMode` hardcoda `reason: 'watchdog_restart'`~~ **[FIXED — parâmetro `reason` configurável]**                             |
| ~~GAP-CHAN-002~~ | inject.js            | ~~`httpRequest` sem validação de porta — SSRF interno entre portas~~ **[FIXED — validação de range 1-65535 com warning e fallback]** |

---

## 12. Módulo: api/ (F16) — ~6 achados | Score: 8.5/10

### P3 — Importantes

| ID              | Arquivo           | Título                                                                                                    |
| --------------- | ----------------- | --------------------------------------------------------------------------------------------------------- |
| ~~BUG-API-001~~ | bridge-tasks.js   | ~~TOCTOU: queue size + send~~ **[N/A — Node.js single-thread: check + send são síncronos no mesmo tick]** |
| ~~SEC-API-001~~ | bridge-control.js | ~~`POST /stop` sem middleware `requireAdmin`~~ **[FIXED — `requireAdmin` aplicado (L67)]**                |
| ~~BUG-API-002~~ | bridge-control.js | ~~Health check SQLite false positive~~ **[FIXED — API-P4-01: check `!db` antes de `.prepare()`]**         |

### P4 — Informativos

| ID              | Arquivo          | Título                                                                                                                                                                         |
| --------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| ~~INC-API-001~~ | bridge-stream.js | ~~`MAX_SSE_CLIENTS` sem cap real de conexões~~ **[FIXED — importa de `core/constants.js`, usado como cap real]**                                                               |
| ~~GAP-API-001~~ | bridge-dialog.js | ~~Estado `'starting'` não tratado em `/dialog/start` — 409 desnecessário~~ **[N/A — check `agent.status !== 'idle'` já cobre todos os estados não-idle incluindo 'starting']** |
| ~~GAP-API-002~~ | bridge-stream.js | ~~Filtro `?events=` sem suporte a wildcards (`task.*`)~~ **[FIXED — buildEventFilter() com suporte a wildcards via regex]**                                                    |

---

## 13. Módulo: core/ (F17) — 3 achados | Score: 9.0/10

### P4 — Informativos

| ID               | Arquivo       | Título                                                                                                                                            |
| ---------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| ~~INC-CORE-001~~ | constants.js  | ~~`MAX_SSE_CLIENTS = 50` vs `bridge-stream.js` usa `100`~~ **[FIXED — todos os módulos importam de `core/constants.js` (default 50)]**            |
| ~~GAP-CORE-001~~ | constants.js  | ~~Env var `LLM_B_TURN_TIMEOUT` sem sufixo `_MS`~~ **[FIXED — `LLM_B_TURN_TIMEOUT_MS` (preferido) + `LLM_B_TURN_TIMEOUT` (legado) ambos aceitos]** |
| ~~INC-CORE-002~~ | core/index.js | ~~Re-exporta `types/index.js` — acoplamento direto core → types (layer violation)~~ **[N/A — types/ não re-exportado; JSDoc presente]**           |

---

## 14. Módulo: types/ (F18) — 4 achados | Score: 8.7/10

### P4 — Informativos

| ID              | Arquivo               | Título                                                                                                                                                                                                                          |
| --------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ~~TYPES-P4-01~~ | structured-message.js | ~~Parser Estratégia 4 greedy `{...}` pode extrair JSON parcial de múltiplos objetos~~ **[N/A — Estratégia 4 é fallback-de-último-recurso com `JSON.parse` validando resultado; greedy é intencional para maximizar extração]**  |
| ~~TYPES-P4-02~~ | structured-message.js | ~~`serializeStructuredMessage` instrução protocolo como texto simples~~ **[ACCEPTED — limitação de design; handshake de confirmação requereria mudança de protocolo LLM-A↔LLM-B; sistema tolera graciosamente via parseError]** |
| ~~TYPES-P4-03~~ | structured-message.js | ~~`buildStructuredRequest` gera UUIDs não-determinísticos — dificuldade em testes~~ **[N/A — by design; testes devem usar mock de crypto.randomUUID]**                                                                          |
| ~~TYPES-P4-04~~ | sdk.js                | ~~Não re-exportado via `types/index.js`~~ **[N/A — arquivo é puro JSDoc `@typedef`; `export *` de módulo sem values ES não produz efeito runtime]**                                                                             |

---

## 15. Módulo: db/ (F19) — 5 achados | Score: 9.1/10

### P3 — Importantes

| ID           | Arquivo   | Título                                                                                                                                   |
| ------------ | --------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| ~~DB-P3-01~~ | sqlite.js | ~~`process.on('exit')` não cobre SIGTERM~~ **[FIXED — `process.once('SIGTERM')` + `process.once('SIGINT')` registrados para flush WAL]** |

### P4 — Informativos

| ID           | Arquivo       | Título                                                                                                                                                                                 |
| ------------ | ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ~~DB-P4-01~~ | sqlite.js     | ~~`registerExitHandler` não documentado para re-entrância em testes~~ **[N/A — já idempotente via guard `exitHandlerRegistered`]**                                                     |
| ~~DB-P4-02~~ | migrations.js | ~~FTS5 trigger `turns_au` sem mecanismo de reindex pós-ROLLBACK~~ **[N/A — triggers FTS5 são standard SQLite; ROLLBACK edge case é teórico]**                                          |
| ~~DB-P4-03~~ | migrations.js | ~~`created_at`/`updated_at` como TEXT ISO 8601 em `todo_tasks` — ordenação frágil se formato variar~~ **[N/A — `now()` retorna ISO 8601 UTC (Z suffix); lexicograficamente sortável]** |
| ~~DB-P4-04~~ | migrations.js | ~~Migration de dados v6 sem `down` reversível~~ **[N/A — forward-only migrations by design; rollback não necessário]**                                                                 |

---

## Tabela Consolidada de Achados P0–P3

> P0 e P1 não foram identificados durante a MF-II. Todos os P2 são listados abaixo (potencial
> funcionalidade quebrada ou risco de segurança alto).

| ID                 | Módulo         | Arquivo                 | Severidade | Tipo | Título                                                                                                      |
| ------------------ | -------------- | ----------------------- | ---------- | ---- | ----------------------------------------------------------------------------------------------------------- |
| ~~LEAK-AGENT-001~~ | agent/         | always-alive.js         | ~~P2~~     | LEAK | ~~Listeners não removidos~~ **[FIXED — unsub() em stop/reconnect]**                                         |
| ~~LEAK-AGENT-002~~ | agent/         | always-alive.js         | ~~P2~~     | LEAK | ~~Maps sem TTL~~ **[FIXED — TTL configurável via AGENT_*_TTL_MS env]**                                      |
| ~~BUG-TI-001~~     | hooks/         | tool-interceptor.js     | ~~P2~~     | BUG  | ~~Timer de timing nunca popula Map~~ **[N/A]**                                                              |
| ~~BUG-DA-001~~     | hooks/         | deny-all.js             | ~~P2~~     | BUG  | ~~Preset deny-all aprova todas~~ **[N/A]**                                                                  |
| ~~BUG-HOOK-001~~   | hooks/         | factory.js              | ~~P2~~     | BUG  | ~~`askHandler` dead code~~ **[N/A]**                                                                        |
| ~~SEC-TOOLS-001~~  | tools/         | shell/index.js          | ~~P2~~     | SEC  | ~~Path traversal~~ **[FIXED]**                                                                              |
| ~~SEC-TOOLS-002~~  | tools/         | write-tools.js          | ~~P2~~     | SEC  | ~~writeFile sem restrição~~ **[FIXED]**                                                                     |
| ~~LEAK-OBS-001~~   | observability/ | event-collector.js      | ~~P2~~     | LEAK | ~~Ring buffer sem TTL~~ **[FIXED — 5min/10min TTL cleanup]**                                                |
| ~~LEAK-OBS-002~~   | observability/ | agent-event-observer.js | ~~P2~~     | LEAK | ~~Maps sem cleanup~~ **[FIXED — 5min/2min TTL + cleanup imediato]**                                         |
| ~~BUG-OBS-001~~    | observability/ | audit-log.js            | ~~P2~~     | BUG  | ~~JSONL sem flush~~ **[FIXED — beforeExit handler]**                                                        |
| ~~INC-HOOKS-001~~  | hooks/         | presets/                | ~~P2~~     | INC  | ~~3/5 presets divergem~~ **[FIXED — 5/5 presets retornam {hooks, onPermissionRequest}]**                    |
| ~~BUG-LIB-001~~    | lib/           | sdk-client.js           | ~~P2~~     | BUG  | ~~Sessão parcial~~ **[NOTED — Map.set() após SDK createSession; baixo risco, try/catch em resumeOrCreate]** |
| ~~SEC-LIB-001~~    | lib/           | url-validator.js        | ~~P2~~     | SEC  | ~~IPv6 privado~~ **[FIXED]**                                                                                |
| ~~SEC-ROUTE-001~~  | routes/        | sessions.js             | ~~P2~~     | SEC  | ~~DELETE sem ownership~~ **[FIXED]**                                                                        |
| ~~BUG-ROUTE-001~~  | routes/        | sessions.js             | ~~P2~~     | BUG  | ~~PATCH mass assignment~~ **[N/A]**                                                                         |
| ~~SEC-API-001~~    | api/           | bridge-control.js       | ~~P2~~     | SEC  | ~~POST /stop sem requireAdmin~~ **[FIXED — requireAdmin middleware aplicado]**                              |
| ~~LEAK-CHAN-001~~  | channel/       | inject.js               | ~~P2~~     | LEAK | ~~Buffer SSE sem limite~~ **[FIXED — limite de 2MB + destroy]**                                             |
| ~~BUG-CHAN-001~~   | channel/       | client.js               | ~~P2~~     | BUG  | ~~chatBatch cross-contamina~~ **[FIXED — once + taskId filter]**                                            |

---

## Contagem Final por Módulo e Severidade

| Módulo            | P2     | P3     | P4     | P5    | Total   |
| ----------------- | ------ | ------ | ------ | ----- | ------- |
| agent/            | 2      | 10     | 11     | 0     | 23      |
| hooks/            | 3      | 8      | 5      | 0     | 16      |
| tools/            | 2      | 4      | 5      | 0     | 11      |
| observability/    | 3      | 4      | 4      | 0     | 11      |
| terminal/         | 0      | 5      | 12     | 8     | 25      |
| bridges/          | 0      | 1      | 2      | 0     | 3       |
| conversation-hub/ | 0      | 3      | 0      | 0     | 3       |
| config/           | 0      | 2      | 5      | 0     | 7       |
| lib/              | 1      | 3      | 4      | 0     | 8       |
| routes/           | 1      | 2      | 4      | 0     | 7       |
| channel/          | 1      | 1      | 3      | 0     | 5       |
| api/              | 1      | 2      | 3      | 0     | 6       |
| core/             | 0      | 0      | 3      | 0     | 3       |
| types/            | 0      | 0      | 4      | 0     | 4       |
| db/               | 0      | 1      | 4      | 0     | 5       |
| **TOTAL**         | **14** | **46** | **69** | **8** | **137** |

---

## Top 10 Achados Mais Críticos

> **Status**: Todos os 10 achados foram verificados e resolvidos (FIXED ou N/A).

| Rank | ID                 | Módulo         | Motivação                                                 | Status                                     |
| ---- | ------------------ | -------------- | --------------------------------------------------------- | ------------------------------------------ |
| 1    | ~~BUG-DA-001~~     | hooks/         | `deny-all` que aprova — inversão de contrato de segurança | **N/A** — lógica correta                   |
| 2    | ~~SEC-ROUTE-001~~  | routes/        | DELETE session sem ownership — IDOR                       | **FIXED** — admin token + X-Confirm-Delete |
| 3    | ~~SEC-API-001~~    | api/           | POST /stop sem auth — DoS trivial                         | **FIXED** — requireAdmin middleware        |
| 4    | ~~SEC-TOOLS-001~~  | tools/         | Path traversal em shell tools                             | **FIXED** — realpathSync                   |
| 5    | ~~SEC-LIB-001~~    | lib/           | SSRF via IPv6 privado                                     | **FIXED** — IPv6 ranges adicionados        |
| 6    | ~~BUG-TI-001~~     | hooks/         | Feature de timing completamente não funcional             | **N/A** — timings.set/get/delete funcional |
| 7    | ~~LEAK-AGENT-001~~ | agent/         | Memory leak gradual em sessões longas                     | **FIXED** — unsub() em stop/reconnect      |
| 8    | ~~INC-HOOKS-001~~  | hooks/         | Inconsistência sistêmica em 3 presets                     | **FIXED** — 5/5 presets consistentes       |
| 9    | ~~LEAK-OBS-001~~   | observability/ | Ring buffer sem TTL — crescimento ilimitado               | **FIXED** — TTL 5min/10min cleanup         |
| 10   | ~~BUG-CHAN-001~~   | channel/       | chatBatch cross-contamina taskId — resultados misturados  | **FIXED** — once + taskId filter           |

---

_Gerado automaticamente pelo COPILOT-FULL-AUDIT MF-II — F25-01._
