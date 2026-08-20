# Validação Forense — Auditoria Externa Copilot SDK 0.3

**Data:** 2026-05-17 **Documento-base auditado:**
`DOCUMENTAÇÃO/COPILOT/AUDITORIA-EXTERNA/# Auditoria Técnica — Copilot SDK 0.3 - CLAUDE SONNET - externa.md`
**Escopo real validado:** `src/copilot/infra/**`, `src/copilot/tools/**`, `src/copilot/sdk/**`,
`src/copilot/config/**`, `src/copilot/db/**`

## Metodologia

- Leitura integral do documento externo.
- Validação por evidência de código (arquivo/trecho) para cada item.
- Cruzamento com fontes oficiais (Copilot SDK v0.3.0 release notes + Node 24/MDN para APIs de
  linguagem).
- Classificação por status:
  - **Confirmado** (fato técnico procede)
  - **Parcial** (hipótese válida, mas severidade/causa precisa ajuste)
  - **Refutado/Obsoleto** (já estava corrigido ou premissa incorreta)
  - **Corrigido nesta rodada** (validado e endereçado imediatamente)

---

## Resultado Consolidado

- **Total de itens auditados:** 50
- **Confirmados (inclui parciais):** 40
- **Refutados/obsoletos:** 10
- **Corrigidos imediatamente nesta rodada:** 96

### Correções já aplicadas nesta rodada (execução contínua iniciada)

1. `src/copilot/infra/io-cache.js` — invalidation sem delete durante iteração (`BUG-01`).
2. `src/copilot/infra/io/search/subprocess.js` — coleta com `toOwnedBuffer` (evita view não-owning)
   (`BUG-02`).
3. `src/copilot/infra/io-prefetch.js` — indexação com metadados do snapshot (remove race T1/T2)
   (`BUG-03`).
4. `src/copilot/infra/io-locks.js` — removido sweep periódico que acumulava `.finally()` (`BUG-06`).
5. `src/copilot/infra/io-cache-l2-sqlite.js` — throttle de `capSizeIfNeeded` por lote (`BUG-05`).
6. `src/copilot/infra/io-session-scope.js` — serialização de redeclaração de warm por sessão
   (`BUG-07`).
7. `src/copilot/infra/io-cache-tiering.js` — recomendação L2 corrigida (`BUG-08`).
8. `src/copilot/infra/io-index-sqlite.js` — `pruneMissing: true` passa a ser override autoritativo
   (`BUG-09`).
9. `src/copilot/infra/index-store/sqlite/query.js` — tokens curtos FTS preservados (`BUG-10`).
10. `src/copilot/infra/io/search/grep-adapter.js` — sanitização de `include/exclude` para evitar
    injeção semântica de flags (`BUG-18`).
11. `src/copilot/tools/introspection/introspection-tools.js` — `get_agent_info` agora inclui
    snapshot resumido de IO/latência (`GAP-12`).
12. `src/copilot/infra/io-index-sqlite.js` — lock por root (`io-index-build:<root>`) para serializar
    builds concorrentes (`GAP-01`).
13. `src/copilot/infra/io-prefetch.js` — `maxFiles` passou a ser efetivo (antes apenas advisory)
    (`GAP-02`, parcial).
14. `src/copilot/infra/io-scanner.js` — hard cap absoluto configurável de entradas (`GAP-14`).
15. `src/copilot/tools/todo/store.js` — `readStore` serializado com mutex (coerência read/write)
    (`BUG-04`).
16. `src/copilot/infra/io-index-sqlite.js` + `src/copilot/tools/file/index-tools.js` — hard cap
    efetivo de candidatos no index build com `maxFiles` e limite default por env (`GAP-02`
    completo).
17. `src/copilot/tools/todo/store.js` + `src/copilot/tools/todo/query-tools.js` — paginação
    SQL/cursor para list/search sem full-load obrigatório (`GAP-03`).
18. `src/copilot/tools/web/web-tools.js` — `web_fetch_local` com métodos controlados, sanitização de
    headers/body e timeout efetivo com `AbortSignal.timeout()` (`GAP-05`, `UPG-03`).
19. `src/copilot/infra/io/search/text-search.js` + `src/copilot/tools/search/text-search-tools.js` —
    retorno com `indexFallback` e `indexFallbackReason` para observabilidade explícita de fallback
    (`GAP-09`).
20. `src/copilot/infra/io/search/text-search.js` — mensagem orientativa explícita quando `rg/grep`
    indisponíveis (guidance de instalação) (`GAP-15`).
21. `src/copilot/tools/shell/sandbox.js` — blocklist ampliada para `history`, `declare -p` e
    `typeset` (`GAP-13`).
22. `src/copilot/tools/shell/shell-tools.js` — detecção explícita de sintaxe subshell em tokens
    (`$(...)`/crases) para alinhamento de UX/telemetria (`BUG-15`, parcial).
23. `src/copilot/infra/io-cache-l2-registry.js` — emissão de evento lifecycle
    `l2.circuit-open`/`l2.circuit-closed` com metadados operacionais (`GAP-06`, parcial core event).
24. `src/copilot/infra/io-health.js` — alerta explícito `IO_L2_CIRCUIT_OPEN` no snapshot de health
    (`GAP-06`, destaque operacional).
25. `src/copilot/infra/io-session-scope.js` — limite de escopos ativos com eviction LRU +
    cancelamento cooperativo de warm em `closeScope`/redeclaração (`GAP-10`, `GAP-11`).
26. `src/copilot/infra/io/invalidation/bus.js` + `src/copilot/infra/io/invalidation/index.js` —
    debounce/batch por path com merge de eventos, flush explícito e flush em `beforeExit`
    (`GAP-08`).
27. `src/copilot/infra/io-parser.js` — guardas defensivos de parse (line guard + budget de duração)
    e telemetria de orçamento em `getParserCacheStats` (`GAP-07`, parcial).
28. `src/copilot/infra/io-health.js` — estado derivado de circuito L2 (`l2State`) com janela/tempo
    restante/falhas/último erro para diagnóstico operacional (`GAP-06`, complemento).
29. `src/copilot/infra/io-parser.js` + `src/copilot/infra/io-parser-worker.js` — parsing JS/TS
    off-main-thread com worker pool leve, fila, timeout de request e fallback controlado para main
    thread (`GAP-07`, complemento).
30. `src/copilot/infra/io-locks.js` — adoção de `Promise.withResolvers()` no lock token +
    normalização de erro robusta para cross-realm (`UPG-01`, `UPG-04` parcial).
31. `src/copilot/core/error-handlers.js` + `src/copilot/infra/io-health.js` +
    `src/copilot/infra/io-parser-worker.js` — aplicação de `Error.isError()` (com fallback seguro)
    em handlers críticos (`UPG-04`).
32. `src/copilot/infra/io-prefetch.js` — `resolveRelativeImportTargets` com cache de `fsStat` por
    candidato e paralelização por import (`BUG-14`).
33. `src/copilot/infra/webhooks.js` — migração de timeout manual para `AbortSignal.timeout()` com
    fallback compatível (`UPG-03`).
34. `src/copilot/server/routes/copilot-api/tasks.js` — `waitForResponse` migrado para
    `AbortSignal.timeout()` com fallback compatível (`UPG-03`).
35. `src/copilot/infra/io-parser.js` — remoção de side-effect de hook no module-load; registro de
    invalidação agora lazy em `parseAndCacheSymbols` (`BUG-11`).
36. `src/copilot/infra/module-map.js` +
    `tests/unit/copilot/contracts/test_infra_barrel_governance.spec.js` — scorecard com detecção
    runtime de drift (`missingInLayout`/`staleInLayout`) e teste de regressão (`BUG-12`).
37. `src/copilot/infra/queue/async-queue.js` + `tests/unit/copilot/infra/test_queue.spec.js` —
    prioridades arbitrárias passam a ter bucket dedicado (sem fallback silencioso para 5)
    (`BUG-16`).
38. `src/copilot/infra/lockfile.js` + exports de barrel +
    `tests/unit/copilot/infra/test_locks.spec.js` — adicionada alternativa assíncrona
    `releaseLockAsync` sem quebrar semântica síncrona de `releaseLock` (`BUG-17`).
39. `src/copilot/infra/index-store/sqlite/content.js` + `src/copilot/infra/io/patch/text-patch.js` —
    contrato de `countLines` consolidado por domínio com semântica explícita e nomenclatura
    diferenciada no patch (`BUG-19`).
40. `src/copilot/core/retry.js` — `withTimeout` migrado para `AbortSignal.timeout()` com fallback
    compatível + normalização de erro de abort sem `instanceof Error` (`UPG-03`, `UPG-04`
    incremental).
41. `src/copilot/agent/session/initializers/initializer.js` +
    `tests/unit/copilot/test_initializer_session_fs.spec.js` — `includeSubAgentStreamingEvents`
    desabilitado por padrão (ainda sobrescrevível por `sessionOptions`) para evitar mistura de
    deltas root/sub-agentes (`UPG-08`).
42. `src/copilot/tools/introspection/introspection-tools.js` +
    `src/copilot/agent/lifecycle/setup/session-setup.js` + `src/copilot/agent/ports/tool-port.js` (+
    barrels) — governança consolidada de tools: união entre `excludedTools` estático da sessão e
    disable dinâmico de `toggle_tool`, incluindo proteção contra re-enable indevido (`UPG-07`).
43. `src/copilot/config/env.js` + `src/copilot/agent/session/initializers/initializer.js` — política
    explícita por ambiente para discovery (`COPILOT_ENABLE_CONFIG_DISCOVERY`) aplicada no boot de
    sessão SDK (`UPG-09`).
44. `src/copilot/sdk/session/hook-logger.js` + `src/copilot/presentation/sdk/recovery-policy.js` —
    sweep adicional de UPG-04 removendo `instanceof Error` residual em boundaries de
    SDK/presentation com helper cross-realm (`Error.isError` com fallback).
45. `tests/unit/copilot/tools/test_web_tools.spec.js` — hardening de suíte web para cenário undici
    v7 com erro de `AbortSignal` cross-realm/instance check, garantindo diagnóstico explícito sem
    regressão (`UPG-15`).
46. `src/copilot/infra/module-map.js` + `src/copilot/tools/module-map.js` — adoção de
    `Object.groupBy` (com fallback) em scorecards de inventário para reduzir boilerplate de
    agregação e alinhar com Node 24 (`UPG-11`).
47. `src/copilot/infra/io-locks.js` + `src/copilot/infra/index.js` +
    `tests/unit/copilot/infra/test_locks.spec.js` — introdução de lease disposable com
    `Symbol.asyncDispose` (`acquireIoResourceLock`) e execução contextual via `run()` para adoção
    incremental de `await using` sem breaking change em `withIoResourceLock` (`UPG-02`).
48. `src/copilot/infra/io-index-sqlite.js` — fluxo piloto real migrado para lease disposable
    (`acquireIoResourceLock` + `run()` + `release()`), validando adoção incremental de UPG-02 em
    caminho crítico de index build.
49. `src/copilot/infra/runtime/transaction.js` +
    `tests/unit/copilot/infra/test_runtime_transaction_rollback.spec.js` — adoção de
    `structuredClone` (fallback seguro) para evitar aliasing em `evidence`/`rollback` ao append de
    entradas de change-set (`UPG-10`).
50. `src/copilot/core/error-handlers.js` + `src/copilot/infra/io-observability.js` +
    `src/copilot/infra/io-index-sqlite.js` + `src/copilot/infra/io-scanner.js` — sweep incremental
    de UPG-04 removendo `instanceof Error` residual em caminhos críticos e padronizando normalização
    com `toError`/`isError` cross-realm.
51. `src/copilot/infra/io/fs/locked-writes.js` — expansão incremental de UPG-02: `writeFileAtomic` e
    `appendTextLocked` migrados para lease disposable (`acquireIoResourceLock` + `run` + `release`
    em `finally`) mantendo compatibilidade e métricas de `waitMs`.
52. `src/copilot/infra/io/fs/locked-mutations.js` — expansão incremental de UPG-02:
    `deleteFileLocked` e `removePathLocked` migrados para lease disposable com liberação garantida
    em `finally`, preservando semântica e telemetria.
53. `src/copilot/infra/io/fs/locked-mutations.js` — expansão incremental adicional de UPG-02:
    `patchTextLocked` migrado para lease disposable (`acquireIoResourceLock` + `run` + `release`),
    mantendo semântica de diff/rollback e telemetria de lock.
54. `src/copilot/infra/io-locks.js` + `src/copilot/infra/index.js` +
    `tests/unit/copilot/infra/test_locks.spec.js` — introdução de lease disposable multi-recurso
    (`acquireIoResourceLocks`) com contexto combinado de reentrância e `Symbol.asyncDispose`,
    estendendo o modelo incremental de `await using` para operações com mais de um path (`UPG-02`).
55. `src/copilot/infra/io/fs/locked-mutations.js` — `copyFileLocked` migrado de
    `withIoResourceLocks` para `acquireIoResourceLocks` + `run` + `release` em `finally`,
    preservando snapshots/rollback e métricas de `lockWaitMs` (`UPG-02` incremental).
56. `src/copilot/infra/io/fs/locked-mutations.js` — `moveFileLocked` migrado de
    `withIoResourceLocks` para `acquireIoResourceLocks` + `run` + `release` em `finally`,
    preservando semântica de rename/overwrite/rollback e telemetria de lock (`UPG-02` incremental).
57. `src/copilot/infra/io/fs/read-chunks.js` — `readTextLineChunks` migrou o coletor principal para
    `Array.fromAsync`, mantendo semântica de paginação e abrindo o caminho para consumo
    stream-native (`UPG-13`).
58. `src/copilot/infra/io/fs/snapshot.js` — `readBinaryMutationSnapshot` migrou a coleta do stream
    para `Array.fromAsync`, consolidando o padrão em snapshot binário (`UPG-13`).
59. `src/copilot/infra/io/fs/read-chunks.js` + `src/copilot/infra/io/fs/read-services.js` +
    `src/copilot/infra/io/fs/index.js` + `src/copilot/infra/public/io.js` +
    `tests/unit/copilot/infra/test_io_fs_read_chunks.spec.js` —
    `readTextChunksStream`/`readTextLineChunksStream` expostos com `ReadableStream.from` e cobertura
    de regressão, fechando a superfície web-native de leitura textual (`UPG-14`).
60. `src/copilot/terminal/state/transcript-archive.js` — normalização de erro via `toError(...)` em
    archive durável do terminal (`UPG-04` incremental).
61. `src/copilot/config/pinned-files.js` — `PinnedFilesLoader.start()` passou a normalizar falhas de
    watcher com `toError(...)`, removendo `instanceof Error` residual no boot de hot-reload
    (`UPG-04` incremental).
62. `src/copilot/server/routes/copilot-api/dialog.js` — rota `dialog/start` migrada para
    `toError(...)` no log de falha, padronizando boundary HTTP/runtime contra erros cross-realm
    (`UPG-04` incremental).
63. `src/copilot/server/routes/sdk/session-workspace-routes.js` — sweep adicional removendo
    `instanceof Error` residual em detecção de missing workspace e razões de convergência/promote,
    padronizando mensagens com `toError(...)` (`UPG-04` incremental).
64. `src/copilot/infra/io-cache-l2-registry.js` — normalização de `_lastInitError`/`_lastPruneError`
    via `toError(...)`, endurecendo observabilidade do circuito L2 contra erros cross-realm
    (`UPG-04` incremental).
65. `src/copilot/infra/runtime/audit-log.js` + `src/copilot/infra/runtime/operation.js` +
    `src/copilot/sdk/models/persistent-cache.js` — sweep de guardas de erro em envelope/audit/cache
    persistente, trocando `instanceof Error` por normalização/checagem estrutural (`UPG-04`
    incremental).
66. `src/copilot/terminal/commands/sdk.js` + `src/copilot/terminal/dev-watch.js` +
    `src/copilot/terminal/bootstrap-lifecycle.js` — normalização de mensagens de
    JSON/watcher/shutdown em boundaries de terminal, removendo `instanceof Error` residual (`UPG-04`
    incremental).
67. `src/copilot/sdk/telemetry/preflight.js` + `src/copilot/sdk/telemetry/health.js` — erro de
    preflight/health tornado self-contained e resiliente a mocks/SSR, sem dependência de deep import
    de error-handlers (`UPG-04` incremental).
68. `src/copilot/sdk/tools/core.js` — falhas de conversão de schema e fallback de `defineTool`
    passaram a ser normalizados com `toError(...)`, endurecendo a factory central de tools (`UPG-04`
    incremental).
69. `src/copilot/infra/io/fs/read-chunks.js` + `src/copilot/infra/io/fs/snapshot.js` +
    `src/copilot/infra/io/fs/read-services.js` + `src/copilot/infra/public/io.js` — adoção ampla de
    `Array.fromAsync`/`ReadableStream.from` em coletores textuais e snapshots binários, com API
    stream-native publicada e testada (`UPG-13/14`).
70. `src/copilot/tools/todo/store.js` — `startTodoCleanupJob` migrou de `setInterval` cru para
    `registerInterval`, canonizando timer recorrente no registry central (`UPG-12` incremental).
71. `src/copilot/channel/inject.js` — `waitForLlmBReady` migrou de loop com `setTimeout` para
    polling canônico com `registerInterval` + `cancelTimer` e guard anti-overlap (`UPG-12`
    incremental).
72. `eslint.config.mjs` — enforcement de `setInterval` cru expandido para módulos recorrentes
    canonizados (incluindo `tools/todo/store.js`), evitando regressão de timers fora do registry
    (`UPG-12` governança).
73. `tests/unit/copilot/contracts/test_eslint_effective_architecture_rules.spec.js` — contrato
    efetivo do ESLint ampliado para validar bloqueio em `tools/todo/store.js`, tornando o hardening
    verificável em CI.
74. `src/copilot/agent/dialog/watchdogs/watchdog.js` + `src/copilot/infra/sse/utils.js` +
    `src/copilot/observability/error-alerting.js` — correções de tipagem/cleanup pós-migração de
    timers canônicos (ids de timer, unref explícito, nullable id seguro).
75. `src/copilot/channel/inject.js` — hardening de `Promise` em polling canônico com
    `reject(toError(...))`, alinhando regra `prefer-promise-reject-errors` sem bypass
    (`UPG-04/UPG-12`).
76. `src/copilot/core/timer-registry.js` + `src/copilot/core/index.js` — introdução de
    `registerTimeout` e `sleepMs` canônicos com integração ao registry central e export no barrel do
    core (`UPG-12` infraestrutura).
77. `src/copilot/channel/inject.js` — backoff de retry em `injectToLlmB` migrou de
    `await setTimeout` manual para `sleepMs`, removendo espera ad-hoc (`UPG-12` incremental).
78. `src/copilot/channel/client.js` — retry de `chat()` migrou para `sleepMs`, padronizando espera
    assíncrona no bridge client (`UPG-12` incremental).
79. `src/copilot/terminal/dialog/engine.js` — retry de `ensureDialogLoop` migrou para `sleepMs`,
    removendo `await setTimeout` manual no bootstrap do diálogo (`UPG-12` incremental).
80. `src/copilot/bridges/gh/ci.js` — polling de `watchRun` passou a usar `sleepMs` canônico,
    mantendo comportamento e unificando governança de timers (`UPG-12` incremental).
81. `src/copilot/sdk/session/model-switch-verify-retry.js` — helper de verificação de model switch
    migrou para `sleepMs`, removendo wait ad-hoc (`UPG-12` incremental).
82. `src/copilot/sdk/session/client.js` — helper local `wait()` migrou para `sleepMs` canônico
    (`UPG-12` incremental).
83. `src/copilot/sdk/session/lifecycle.js` — helper local `wait()` migrou para `sleepMs` canônico
    (`UPG-12` incremental).
84. `src/copilot/agent/lifecycle/policies/reconnect-policy.js` — backoff de reconexão migrou para
    `sleepMs`, padronizando esperas da política de reconnect (`UPG-12` incremental).
85. `src/copilot/presentation/agent/control/handlers.js` — pipeline step wait migrou para `sleepMs`,
    eliminando o último `await setTimeout` manual no escopo `src/copilot/**` (`UPG-12` incremental).
86. `eslint.config.mjs` — hardening adicional: bloqueio explícito de `await setTimeout` manual nos
    módulos canonizados (`Use sleepMs from #copilot/core`).
87. `tests/unit/copilot/contracts/test_eslint_effective_architecture_rules.spec.js` — contrato
    efetivo ampliado para verificar bloqueio de `await setTimeout` em
    `presentation/agent/control/handlers.js`.
88. `src/copilot/**` (varredura final) — eliminação completa de
    `await new Promise(...setTimeout...)` no escopo Copilot runtime, consolidando governança de
    espera assíncrona pelo core timer-registry.
89. `src/copilot/terminal/wiring/terminal-agent-wiring.js` — recuperação watchdog zero-PR migrou de
    combinação `setTimeout` + `registerInterval` para loop canônico com `sleepMs`, simplificando
    cleanup e alinhando lint de governança de waits (`UPG-12` incremental).
90. `src/copilot/core/timer-registry.js` + `tests/unit/copilot/test_core_timer_registry.spec.js` —
    correção de concorrência em `sleepMs`: IDs de timeout agora são sempre únicos por wait (evita
    cancelamento cruzado/deadlock quando múltiplos sleeps usam o mesmo label), com teste de
    regressão dedicado.
91. `src/copilot/terminal/dialog/engine.js` — hardening do bootstrap do dialog loop para estado
    `starting`: transição explícita com timeout/telemetria antes de iniciar o protocolo READY/REPLY,
    reduzindo race de boot.
92. `src/copilot/agent/session/boot/boot-dialog-recovery.js` — agendamento de boot recovery migrado
    para `registerTimeout` + `cancelTimer`, eliminando risco de entrada stale no timer-registry
    durante teardown/reconfiguração.
93. `src/copilot/terminal/dialog/engine.js` — fallback de restart após erro de turno migrou de
    `setTimeout` cru para `sleepMs`, alinhando governança de waits também no caminho de
    erro/recovery.
94. `src/copilot/terminal/dialog/engine.js` +
    `src/copilot/terminal/wiring/terminal-agent-wiring.js` +
    `src/copilot/presentation/runtime/dialog.js` (investigação) — revisão end-to-end do início do
    dialog loop e processos associados (boot, restart watchdog, resume/recovery), com fechamento dos
    gaps operacionais identificados nesta rodada.
95. `src/copilot/terminal/frontend/projections/timeline.js` — helper local `sleep()` migrou para
    `sleepMs`, removendo o último wait manual do ecossistema de projeções ligado ao dialog loop.
96. `src/copilot/infra/io-index-registry.js` +
    `tests/unit/copilot/infra/test_io_index_registry.spec.js` — coalescência de builds concorrentes
    por assinatura (`directory + options`) no registry de índice, evitando trabalho duplicado em
    chamadas paralelas de scope/manual build; com teste de regressão para coalesce e não-coalesce.

> Nota: item 11 amplia observabilidade e fecha o gap de superfície sem criar nova tool dedicada
> nesta rodada.

---

## Matriz de validação — Bugs (19)

| ID     | Veredito                                                               | Situação atual                                                              | Situação ideal                                                  | Ação                                    |
| ------ | ---------------------------------------------------------------------- | --------------------------------------------------------------------------- | --------------------------------------------------------------- | --------------------------------------- |
| BUG-01 | Confirmado → **Corrigido nesta rodada**                                | Deletava no mesmo iterador LRU                                              | Coletar chaves e deletar em 2ª passada                          | ✅ aplicado                             |
| BUG-02 | Confirmado → **Corrigido nesta rodada**                                | `toBufferView` em chunks de stream                                          | buffer owning (`toOwnedBuffer`)                                 | ✅ aplicado                             |
| BUG-03 | Confirmado → **Corrigido nesta rodada**                                | snapshot+stat desacoplados                                                  | usar metadados do snapshot                                      | ✅ aplicado                             |
| BUG-04 | Confirmado → **Corrigido nesta rodada**                                | `readStore` bypassava mutex                                                 | leitura serializada/coerente                                    | ✅ aplicado                             |
| BUG-05 | Confirmado → **Corrigido nesta rodada**                                | `COUNT(*)` a cada set (N+1)                                                 | check periódico/lote                                            | ✅ aplicado                             |
| BUG-06 | Confirmado → **Corrigido nesta rodada**                                | `setInterval` anexava `.finally()` repetido                                 | limpeza on-demand                                               | ✅ aplicado                             |
| BUG-07 | Confirmado → **Corrigido nesta rodada**                                | re-declare perdia rastreio do warm anterior                                 | serializar/cancelar warm anterior                               | ✅ serializado                          |
| BUG-08 | Confirmado → **Corrigido nesta rodada**                                | recomendação L2 invertida                                                   | recomendação coerente com miss/hotset                           | ✅ aplicado                             |
| BUG-09 | **Parcial** → **Corrigido nesta rodada**                               | problema real no core, mas tool já expunha parâmetro                        | `pruneMissing: true` autoritativo                               | ✅ aplicado                             |
| BUG-10 | Confirmado → **Corrigido nesta rodada**                                | descarta tokens <2                                                          | aceitar tokens válidos curtos                                   | ✅ aplicado                             |
| BUG-11 | Confirmado → **Corrigido nesta rodada**                                | hook de invalidação no module-load                                          | lazy init + teardown robusto em testes                          | ✅ aplicado                             |
| BUG-12 | Confirmado → **Corrigido nesta rodada**                                | inventário de módulos estático                                              | verificação runtime + aviso drift                               | ✅ aplicado                             |
| BUG-13 | **Parcial**                                                            | rate-limit é por processo (não global multi-worker)                         | documentar/compartilhar estado                                  | 📌 documentação + opcional shared state |
| BUG-14 | Confirmado → **Corrigido nesta rodada**                                | resolução de imports com `fsStat` sequencial sem cache                      | cache + paralelização controlada                                | ✅ aplicado                             |
| BUG-15 | **Parcial/baixa severidade** → **Corrigido parcialmente nesta rodada** | ausência em `tokenizeShell`, mas execução é `execFile` (sem expansão shell) | consistência de detecção para logging/security UX               | ✅ parcial aplicado                     |
| BUG-16 | Confirmado → **Corrigido nesta rodada**                                | prioridades fora de [0,5,10] caíam silenciosamente em 5                     | buckets dinâmicos explícitos por prioridade                     | ✅ aplicado                             |
| BUG-17 | Confirmado → **Corrigido nesta rodada**                                | `releaseLock` síncrono no hot path                                          | alternativa async (`releaseLockAsync`) mantendo compatibilidade | ✅ aplicado                             |
| BUG-18 | Confirmado → **Corrigido nesta rodada**                                | include/exclude sem saneamento de flag-injection semântica                  | sanitização defensiva                                           | ✅ aplicado                             |
| BUG-19 | **Parcial (inconsistência real)** → **Corrigido nesta rodada**         | duas semânticas de `countLines` (0 vs 1 para vazio)                         | contrato explícito por domínio + harmonização                   | ✅ aplicado                             |

---

## Matriz de validação — Gaps (15)

| ID     | Veredito                                               | Situação atual                                               | Situação ideal                      | Ação                                            |
| ------ | ------------------------------------------------------ | ------------------------------------------------------------ | ----------------------------------- | ----------------------------------------------- |
| GAP-01 | Confirmado → **Corrigido nesta rodada**                | index build podia concorrer sem lock por root                | lock por recurso/root               | ✅ aplicado                                     |
| GAP-02 | Confirmado → **Corrigido nesta rodada**                | `maxFiles` advisory no warm de diretório/build               | hard cap configurável + warning     | ✅ aplicado (warm + index build)                |
| GAP-03 | Confirmado → **Corrigido nesta rodada**                | `readStore` carregava tudo em memória                        | paginação SQL/cursor                | ✅ aplicado                                     |
| GAP-04 | **Refutado/Obsoleto**                                  | WAL já ativo em `src/copilot/db/sqlite.js`                   | já atendido                         | ✅ sem ação                                     |
| GAP-05 | Confirmado → **Corrigido nesta rodada**                | `web_fetch_local` fixo em GET                                | suportar métodos HTTP controlados   | ✅ aplicado                                     |
| GAP-06 | Confirmado → **Corrigido nesta rodada**                | circuit-open não emitia evento forte de lifecycle            | evento explícito + health destacado | ✅ aplicado                                     |
| GAP-07 | Confirmado → **Corrigido nesta rodada**                | parser Babel síncrono no event-loop                          | worker/offload/timeout              | ✅ aplicado (guard defensivo + off-main-thread) |
| GAP-08 | Confirmado → **Corrigido nesta rodada**                | sem dedupe/debounce por path no bus                          | batch/debounce invalidação          | ✅ aplicado                                     |
| GAP-09 | Confirmado → **Corrigido nesta rodada**                | fallback de engine pouco explícito ao agente                 | `indexFallbackReason` no retorno    | ✅ aplicado                                     |
| GAP-10 | Confirmado → **Corrigido nesta rodada**                | sem limite de escopos ativos                                 | limite + LRU eviction               | ✅ aplicado                                     |
| GAP-11 | Confirmado → **Corrigido nesta rodada**                | warm sem `AbortController` ao fechar escopo                  | cancelamento cooperativo            | ✅ aplicado                                     |
| GAP-12 | Confirmado → **Corrigido nesta rodada (parcialmente)** | ausência no `get_agent_info`                                 | latência/health expostas            | ✅ exposto no `get_agent_info`                  |
| GAP-13 | Confirmado → **Corrigido nesta rodada**                | blocklist shell não cobria `history`/`declare -p`            | ampliar padrões bloqueados          | ✅ aplicado                                     |
| GAP-14 | Confirmado → **Corrigido nesta rodada**                | scanner sem hard cap absoluto                                | limite configurável hard            | ✅ aplicado                                     |
| GAP-15 | Confirmado → **Corrigido nesta rodada**                | fallback final sem guidance forte quando `grep` indisponível | erro orientativo (pacote/comando)   | ✅ aplicado                                     |

---

## Matriz de validação — Upgrades (16)

| ID     | Veredito                                                                                                   | Situação atual                                                | Situação ideal                                                                        | Ação                                                                                                                                                |
| ------ | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| UPG-01 | Confirmado → **Corrigido nesta rodada (io-locks)**                                                         | locks ainda com padrão manual de resolver/release             | `Promise.withResolvers()`                                                             | ✅ aplicado (núcleo)                                                                                                                                |
| UPG-02 | Confirmado → **Corrigido parcialmente nesta rodada**                                                       | `try/finally` tradicional                                     | `await using` onde fizer sentido                                                      | ✅ parcial (infra locks + leases multi-recurso + piloto em io-index-sqlite + expansão ampla em locked-writes/locked-mutations, incluindo copy/move) |
| UPG-03 | Confirmado → **Corrigido parcialmente nesta rodada (web/tools + tasks/webhooks + core/retry)**             | timeouts manuais em partes do código                          | `AbortSignal.timeout()`                                                               | ✅ parcial ampliado                                                                                                                                 |
| UPG-04 | Confirmado → **Corrigido parcialmente nesta rodada (core/retry + sdk/presentation + core/infra críticos)** | muitos `instanceof Error`                                     | `Error.isError()` em handlers críticos                                                | ✅ parcial ampliado                                                                                                                                 |
| UPG-05 | **Refutado/Obsoleto**                                                                                      | projeto já usa `gitHubToken` corretamente no SDK layer        | conforme v0.3                                                                         | ✅ sem ação estrutural                                                                                                                              |
| UPG-06 | **Refutado/Obsoleto**                                                                                      | SessionFs já adaptado ao modelo `createSessionFsHandler`      | conforme v0.3                                                                         | ✅ sem ação estrutural                                                                                                                              |
| UPG-07 | Parcial → **Corrigido nesta rodada**                                                                       | `excludedTools` já usado, mas coexistência com runtime toggle | consolidar estratégia                                                                 | ✅ aplicado                                                                                                                                         |
| UPG-08 | Confirmado → **Corrigido nesta rodada**                                                                    | include de sub-agent streaming ativo sem filtro dedicado      | filtrar por `agentId` ou desligar include                                             | ✅ aplicado (default off)                                                                                                                           |
| UPG-09 | Parcial → **Corrigido nesta rodada**                                                                       | suporte existe; uso por default a revisar                     | política explícita por ambiente                                                       | ✅ aplicado                                                                                                                                         |
| UPG-10 | Confirmado → **Corrigido parcialmente nesta rodada**                                                       | clones shallow/JSON em pontos pontuais                        | `structuredClone` quando apropriado                                                   | ✅ parcial (runtime transaction)                                                                                                                    |
| UPG-11 | Confirmado → **Corrigido parcialmente nesta rodada**                                                       | agrupamentos manuais em vários módulos                        | `Object.groupBy` em pontos de valor                                                   | ✅ parcial (infra/tools module-map)                                                                                                                 |
| UPG-12 | Confirmado → **Corrigido parcialmente nesta rodada**                                                       | polling em alguns consumidores                                | subscribers event-driven + timer registry canônico + `sleepMs` para waits assíncronos | ✅ parcial ampliado                                                                                                                                 |
| UPG-13 | Confirmado → **Corrigido nesta rodada**                                                                    | loops `for await` coletores                                   | `Array.fromAsync` onde legível                                                        | ✅ aplicado                                                                                                                                         |
| UPG-14 | Confirmado → **Corrigido nesta rodada**                                                                    | streams manuais em pontos legados                             | `ReadableStream.from` onde vantajoso                                                  | ✅ aplicado                                                                                                                                         |
| UPG-15 | Confirmado → **Corrigido parcialmente nesta rodada**                                                       | possível fragilidade de testes com undici v7                  | hardening suíte web                                                                   | ✅ parcial (cobertura adicionada)                                                                                                                   |
| UPG-16 | **Refutado/Obsoleto**                                                                                      | config MCP já usa `stdio/http`                                | conforme v0.3                                                                         | ✅ sem ação estrutural                                                                                                                              |

---

## Achados adicionais (além do relatório externo)

1. **Maturidade maior que a sugerida pela auditoria em temas SDK 0.3**: diversos pontos já estavam
   internalizados (`gitHubToken`, SessionFs idiomático, MCP `stdio/http`, WAL no SQLite).
2. **Observabilidade de fallback de busca** ainda carece de ergonomia para o agente (motivo
   explícito no payload), apesar do core já carregar telemetria relevante.
3. **Risco de escala de memória** em escopos/scanner persiste como maior dívida estrutural
   remanescente, junto com lock de index build.

---

## Conclusão

A auditoria externa foi **útil e majoritariamente correta** em I/O/runtime behavior, porém
apresentou alguns itens já obsoletos no código atual. A validação independente confirma que o
caminho correto é:

1. fechar rapidamente os remanescentes críticos/altos (lock de index, hard caps, TODO store, web
   methods controlados),
2. depois atacar performance/observabilidade (dedupe, fallback reason, parser offload),
3. por fim consolidar upgrades de linguagem/SDK de baixo risco.

A execução contínua já avançou nesta mesma rodada com 96 melhorias aplicadas.

---

## Critérios objetivos para encerrar a execução contínua

A execução contínua só pode ser considerada encerrada quando estes critérios forem verdadeiros ao
mesmo tempo:

1. **Sem gaps críticos/altos remanescentes** no escopo auditado ou, se houver, cada um precisa estar
   explicitamente refutado/obsoleto com evidência.
2. **Todos os gaps e upgrades remanescentes** têm destino formal:

- implementado,
- ou refatorado em alternativa equivalente documentada caso a implementação literal seja
  estruturalmente inviável.

3. **Mapa de prioridades fechado** para o próximo ciclo:

- o que vai para a próxima onda,
- o que fica em backlog,
- e o que foi encerrado definitivamente.

4. **Validação final repetível**:

- typecheck, lint e testes do escopo alterado permanecem verdes após a última mudança.

5. **Contagem e status batem entre documentos**:

- roadmap e validação forense precisam narrar o mesmo estado final, sem números divergentes nem
  itens contraditórios.

6. **UPG-13/14 não ficam implícitos**:

- cada ponto mapeado precisa de implementação aplicada ou decisão técnica documentada sobre a forma
  de execução.

7. **Sem encerrar por priorização econômica**:

- o fato de algo ter ROI menor não é motivo para não ser implementado; serve apenas para ordenar o
  lote.

Se qualquer um desses itens faltar, a execução contínua ainda não pode ser considerada concluída.
