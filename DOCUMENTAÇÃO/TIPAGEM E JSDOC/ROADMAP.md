# Roadmap de Execução — Tipagem e JSDoc

> **Última revisão**: 7 de março de 2026 **Branch ativa**: `feat/typing-fullstrict-roadmap` **PR
> ativa**: <https://github.com/Ilenburg1993/chatgpt-docker-puppeteer/pull/99>
>
> Este é o documento operacional de execução. As regras normativas vivem em
> [`PADROES.md`](./PADROES.md) e em
> [`../REFERENCIA/TYPING_JSDOC_CANON.md`](../REFERENCIA/TYPING_JSDOC_CANON.md).
>
> **Regra absoluta**: `// @ts-nocheck` é proibido. Jamais use para suprimir erros.

---

## Estado geral — 7 de março de 2026 🎉 FASES 0–D COMPLETAS

| Indicador                          | Início do roadmap | Agora (7 mar 2026)     |
| ---------------------------------- | ----------------- | ---------------------- |
| Arquivos com `// @ts-check`        | **670**           | **721** ✅ (+51 src/)   |
| `@ts-ignore` em código real        | desconhecido      | **0** ✅                |
| `@ts-nocheck` em código real       | **0** ✅           | **0** ✅                |
| Erros `typecheck:node` (base)      | ~2.170            | **0** ✅                |
| Erros `typecheck:tools`            | ~2                | **0** ✅                |
| Erros `typecheck:browser`          | ~285              | **0** ✅                |
| Erros `typecheck:tests`            | 15                | **0** ✅                |
| Erros `typecheck:isolated`         | N/A               | **0** ✅ (novo)         |
| Erros `typecheck:strict:all`       | ~7.414            | **0** ✅ 🎉              |
| Lanes strict com 0 erros           | 11 de 39          | **39 de 39** ✅         |
| `strict: true` em tsconfig.base    | não               | **sim** ✅              |
| `useUnknownInCatchVariables`       | não               | **sim** ✅              |
| `strictNullChecks`                 | não               | **sim** ✅              |
| `noImplicitAny` (via strict)       | não               | **sim** ✅              |
| `isolatedDeclarations` (src/types) | não               | **sim** ✅              |
| Schema tsserver-tool-contract      | v1.0.0            | **v1.1.0** ✅           |
| JSDoc cobertura exports            | ~70%              | **100%** (1115/1115) ✅ |
| Tags unsafe restantes (`@any`)     | ~404              | ~404 (manter monit.)   |

**Fases 0–D concluídas em 7 de março de 2026**: `strict: true` ativado globalmente em
`tsconfig.base.json`, todos os targets em 0, `isolatedDeclarations` ativo para `src/types/`.

**Correções complementares — sessão 7 mar 2026 (2ª parte)**:

- `src/server/api/controllers/*.js` — TS7030: explicit `return` em 6 controllers ✅
- `src/server/middleware/auth.js` — TS18048: optional chaining `req.user?.username` ✅
- `src/server/engine/app.js` + `schema_guard.js` — TS7030: explicit `return` before `next()` ✅
- `src/types/global.d.ts` — Express.Request augmented: `id: string`, `user?: Record<string, any>` ✅
- `src/types/core/augmentations.d.ts` — identity_manager: `initialize`, `robotId`, `instanceId` ✅
- `src/types/infra/augmentations.d.ts` — io: `ROOT`, `RESPONSE_DIR`; ConnectionOrchestrator: constructor+connect; BrowserPoolManager: `removePageFromPool(taskId, page?)` ✅
- `src/types/server/augmentations.d.ts` — `getIO()` retorna tipo com `fetchSockets()` ✅
- `tsconfig.tests.json` + 7 strict test lanes — incluem `src/types/**/*.d.ts` ✅
- `tests/fixtures/mcp/stdio-server.mjs` — TS2769: cast `@type {any}` em McpServer ✅
- `tests/manual/test_browser_pool.js` — `@type {any}` cast em BrowserPoolManager ✅
- `tests/manual/test_connection_orchestrator.js` — `@type {any}` cast em ConnectionOrchestrator ✅
- `tests/regression/test_wave14_hot_pool_monitor_taskid_rebind.spec.js` — `@type {any[]}` cast em `manager.pool` ✅

**Fases 0–C concluídas em 6 de março de 2026**: todas as 39 lanes strict zeradas.

**Fase D concluída em 7 de março de 2026**. Etapas completadas:

- D.0: `typecheck:tests` → 0 (fixados erros de union types e spread params) ✅
- D.1: `useUnknownInCatchVariables: true` ativado globalmente ✅
- D.2: `noImplicitAny` zerado (55 callbacks tipados + via `strict: true`) ✅
- D.3: `strictNullChecks: true` ativado globalmente ✅
- D.4: `strict: true` em `tsconfig.base.json` ativado — todos os targets: 0 ✅
- Extra: 51 arquivos `src/` receberam `// @ts-check`, `@ts-ignore` eliminados (→0) ✅
- Extra: `tsconfig.isolated-declarations.json` criado, `typecheck:isolated` → 0 ✅
- Extra: Schema `tsserver-tool-contract` atualizado para v1.1.0 ✅

> **Próximo objetivo (Fase E)**: migração `@import` + redução de `@any` + expansão de
> `isolatedDeclarations` para outros subdiretórios de `src/types/`.

---

## Distribuição de erros por tipo (baseline 4 mar 2026)

| Código TS   | Erros | Causa / flag                         |
| ----------- | ----: | ------------------------------------ |
| **TS2339**  | 3.448 | Propriedade não existe — sem typedef |
| **TS7006**  | 1.353 | Parâmetro implicitamente `any`       |
| **TS18046** |   602 | `catch(err)` — err é unknown         |
| **TS7005**  |   147 | Variável sem tipo                    |
| **TS7031**  |   101 | Binding element sem tipo             |
| **TS7034**  |    74 | Array element sem tipo               |
| **TS2345**  |   308 | Argumento incompatível (cascata)     |
| **TS2322**  |   257 | Atribuição incompatível (cascata)    |
| **TS18047** |   220 | Valor possivelmente null             |
| **TS18048** |    25 | Valor possivelmente undefined        |
| **TS8032**  |   177 | JSDoc mal-formado: sub-param sem pai |
| **TS8024**  |    37 | @param fora de ordem                 |
| **outros**  |  ~665 | TS2304, TS7053, TS2741, TS2571…      |

> TS2339 = **46% de todos os erros** — a maior alavanca é criar typedefs para objetos conhecidos.

---

## Baseline por lane strict

| Lane                    | Erros | Fase    | Status               |
| ----------------------- | ----: | ------- | -------------------- |
| `src.types`             |     0 | ✅ verde | Manter               |
| `agents`                |     0 | ✅ verde | Manter               |
| `scripts.ci`            |     0 | ✅ verde | Manter               |
| `scripts.setup`         |     0 | ✅ verde | Manter               |
| `tests.helpers`         |     0 | ✅ verde | Manter               |
| `scripts.build`         |     0 | ✅ verde | Manter               |
| `scripts.env`           |     0 | ✅ verde | Manter               |
| `src.validation`        |     0 | ✅ verde | Manter               |
| `tests.mocks`           |     0 | ✅ verde | Manter               |
| `src.logic`             |     0 | ✅ Done  | ↓ era 2              |
| `scripts.analysis`      |     0 | ✅ Done  | ↓ era 181            |
| `src.inference_gateway` |     0 | ✅ Done  | ↓ era 191            |
| `src.dashboard-ui`      |     0 | ✅ Done  | ↓ era 285            |
| `tests.manual`          |     0 | ✅ Done  | ↓ era 300            |
| `src.audit_agent`       |     0 | ✅ Done  | ↓ era 358            |
| `src.nerv`              |     0 | ✅ Done  | ↓ era 439            |
| `scripts.health`        |     0 | ✅ Done  | ↓ era 441            |
| `src.missions`          |     0 | ✅ Done  | ↓ era 608            |
| `src.shared`            |     0 | ✅ Done  | ↓ era 746            |
| `src.orchestrator`      |     0 | ✅ Done  | ↓ era 773            |
| `src.integration`       |     0 | ✅ Done  | ↓ era 924            |
| `scripts.audit`         |     0 | ✅ Done  | ↓ era 928            |
| `scripts.root`          |     0 | ✅ Done  | ↓ era 935            |
| `tools.workspace`       |     0 | ✅ Done  | ↓ era 1.013          |
| `src.core`              |     0 | ✅ Done  | ↓ era 1.053          |
| `src.agent`             |     0 | ✅ Done  | ↓ era 1.190          |
| `src.kernel`            |     0 | ✅ Done  | ↓ era 1.530          |
| `src.infra`             |     0 | ✅ Done  | ↓ era 2.232          |
| `src.driver`            |     0 | ✅ Done  | ↓ era 1.558 (Fase C) |
| `tests.legacy`          |     0 | ✅ Done  | ↓ era 1.403 (Fase C) |

---

## Fase 0 — JSDoc estrutural (214 erros, sem flag strict) ✅ CONCLUÍDA

Eliminação completa de TS8032 (177) e TS8024 (37) por:

- Remoção de sub-params redundantes quando o `@param` pai usa typedef nomeado
- Inserção de `@param {object}` intermediários faltantes (incluindo multi-nível)

**Gate atingido**: `npm run typecheck:node 2>&1 | grep -c "TS8032\|TS8024"` → **0** ✅

- [x] TS8032: 177 → 0
- [x] TS8024: 37 → 0

---

## Fase A — Lanes pequenas (≤ 400 erros cada)

Objectivo: zerar 6 lanes com correções JSDoc reais.

| Lane                    | Erros | Prioridade | Foco principal                                           | Status |
| ----------------------- | ----: | :--------: | -------------------------------------------------------- | ------ |
| `src.logic`             |     2 |     1      | Corrigir 2 erros diretos                                 | ✅ 0    |
| `scripts.analysis`      |   181 |     2      | Typedefs para nós de AST, variáveis de análise           | ✅ 0    |
| `src.inference_gateway` |   191 |     3      | OllamaResponse, PolicyConfig, ProfileRecord, \*\_repo.js | ✅ 0    |
| `src.dashboard-ui`      |   285 |     4      | State de stores Pinia, ref()/computed() composables      | ✅ 0    |
| `tests.manual`          |   300 |     5      | `/** @type {any} */` em asserções onde tipo irrelevante  | ✅ 0    |
| `src.audit_agent`       |   358 |     6      | AuditJob, AuditFinding, AuditPatch, JobRun typedefs      | ✅ 0    |

**Gate por lane**: `npm run typecheck:strict:<LANE>` → 0 erros

- [x] `src.logic`: 2 → 0 ✅
- [x] `scripts.analysis`: 181 → 0 ✅
- [x] `src.inference_gateway`: 191 → 0 ✅ (+ `@types/better-sqlite3` instalado)
- [x] `src.dashboard-ui`: 285 → 0 ✅
- [x] `tests.manual`: 300 → 0 ✅
- [x] `src.audit_agent`: 358 → 0 ✅

---

## Fase B — Lanes médias (440–1.200 erros cada)

Objectivo: zerar 11 lanes. Após Fase A, cascatas de TS2339 já terão reduzido.

| Lane               | Erros | Prioridade | Tipos-chave a criar                                  |
| ------------------ | ----: | :--------: | ---------------------------------------------------- |
| `src.nerv`         |   439 |     1      | NervEvent, NervPayload, EventEnvelope, EmissionOpts  |
| `scripts.health`   |   441 |     2      | HealthResult, CheckReport, HealthContext             |
| `src.missions`     |   608 |     3      | MissionRecord, StepResult, MissionContext            |
| `src.shared`       |   746 |     4      | SharedEvent, SharedPayload, UtilityResult            |
| `src.orchestrator` |   773 |     5      | OrchestrationPlan, StepConfig, ExecutionState        |
| `src.integration`  |   924 |     6      | IntegrationRequest, IntegrationResult                |
| `scripts.audit`    |   928 |     7      | AuditRun, AuditTask, AuditSchedule                   |
| `scripts.root`     |   935 |     8      | Variados nos scripts raiz                            |
| `tools.workspace`  | 1.013 |     9      | ToolEnvelope, WorkspaceRecord                        |
| `src.core`         | 1.053 |     10     | ConfigShape, RuntimeContext, BootState               |
| `src.agent`        | 1.190 |     11     | TaskAttempt, MissionState, AgentContext, WorkerState |

- [x] `src.nerv`: 439 → 0 ✅
- [x] `scripts.health`: 441 → 0 ✅
- [x] `src.missions`: 608 → 0 ✅
- [x] `src.shared`: 746 → 0 ✅
- [x] `src.orchestrator`: 773 → 0 ✅
- [x] `src.integration`: 924 → 0 ✅
- [x] `tools.workspace`: **8** → 0 ✅ (era 1.013!)
- [x] `scripts.root`: **357** → 0 ✅ (era 935! instalado @types/ws)
- [x] `src.kernel`: **359** → 0 ✅ (era 1.530, promovido de Fase C)
- [x] `src.agent`: **447** → 0 ✅
- [x] `src.core`: **464** → 0 ✅
- [x] `scripts.audit`: 928 → 0 ✅

---

## Fase C — Lanes grandes (> 1.300 erros)

**`src.infra` deve ser corrigido primeiro** — seus tipos cascateiam para src.agent, src.missions,
src.kernel.

| Lane           | Erros atual | Erros original | Estratégia                                                |
| -------------- | ----------: | -------------: | --------------------------------------------------------- |
| `src.infra`    |         716 |          2.232 | Typedefs SQLite, BrowserPool, QueueEntry                  |
| `src.driver`   |         810 |          1.558 | Augmentar Page, Browser, ElementHandle do Puppeteer       |
| `tests.legacy` |         481 |          1.403 | @ts-ignore pontual com justificativa (legado não-migrado) |

> `src.kernel` foi promovido para Fase B (359 erros — abaixo dos limiares originais de Fase C).

**Prioridade dentro de src.infra**:

1. `src/infra/db/*.js` — tipos de retorno de queries SQLite
2. `src/infra/browser_pool/*.js` — tipos de Puppeteer
3. `src/infra/queue/*.js` — TaskRecord, QueueEntry
4. `src/infra/storage/*.js`, `locks/*.js`, `fs/*.js`

- [x] `src.infra`: 716 → 0 ✅ (↓ era 2.232)
- [x] `src.driver`: 431 → 0 ✅ (↓ era 1.558)
- [x] `tests.legacy`: 289 → 0 ✅ (↓ era 1.403)

**Fase C concluída em 6 de março de 2026.** Correções finais desta sessão:

- `scripts/security/npm-audit-gate.mjs`: TS7053 — cast `/** @type {any} */` aplicado antes da
  indexação (não após)
- `tests/manual/kernel/helpers.js`: 7 exports faltantes (TS2305) — reescrito com stubs corretos e
  tipos
- `tsconfig.tools.json`: `scripts/dist/**` adicionado ao exclude (TS2307 em artefatos gerados)

---

## Fase D — Convergência e ativação de flags

**PRÉ-CONDIÇÃO ATINGIDA** (6 mar 2026): `typecheck:strict:all` → 0 ✅ — Fase D pode iniciar.

Ativar flags progressivamente em `tsconfig.base.json`:

| Etapa | Flag                         | Erros estimados | Padrão de correção                   | Status |
| ----- | ---------------------------- | --------------: | ------------------------------------ | ------ |
| D.0   | `typecheck:tests` → 0        |              15 | Fix union types + spread params      | ✅      |
| D.1   | `useUnknownInCatchVariables` |             602 | `const e = /** @type {any} */ (err)` | ✅      |
| D.2   | `noImplicitAny`              |           1.675 | `@param` em todos os callbacks       | ✅      |
| D.3   | `strictNullChecks`           |             245 | `?.`, `?? default`, null guards      | ✅      |
| D.4   | `strict: true`               |  (consolidação) | Todos os anteriores                  | ✅      |

**Flags NÃO recomendadas**: `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`.

**Prioridade D.0** — 15 erros não-strict em `typecheck:tests`:

- `tests/e2e/test_ariadne_thread.spec.js`: TS2339 em `.prototype` sobre union
  `typeof Class | typeof module`
- `tests/regression/test_wave14_driver_adapter_timeout_cleanup.spec.js`: TS2556 spread em parâmetro
  não-rest
- `tests/unit/core/test_config.spec.js`: TS2339 `.reload`/`.all`/`.isInitialized` em union type

- [x] `typecheck:strict:all` → 0 ✅ (Fases 0–C concluídas em 6/3/2026)
- [x] `typecheck:tests` → 0 ✅ (D.0 — resolvido em 7/3/2026)
- [x] `useUnknownInCatchVariables: true` — sem regressão ✅ (D.1 — 7/3/2026)
- [x] `noImplicitAny: true` — sem regressão ✅ (D.2 — 55 callbacks tipados — 7/3/2026)
- [x] `strictNullChecks: true` — sem regressão ✅ (D.3 — 7/3/2026)
- [x] `strict: true` em tsconfig.base.json ✅ (D.4 — 7/3/2026)

---

## Lanes sempre-verde (manter em 0) — TODAS AS 39 LANES

**Todas as 39 lanes strict são agora sempre-verde.** Qualquer regressão em qualquer lane bloqueia o
merge.

- [x] `src.types` — verde desde início
- [x] `agents` — verde desde início
- [x] `scripts.ci` — verde desde início
- [x] `scripts.setup` — verde desde início
- [x] `tests.helpers` — verde desde início
- [x] `scripts.build` — verde desde início
- [x] `scripts.env` — verde desde início
- [x] `src.validation` — verde desde início
- [x] `tests.mocks` — verde desde início
- [x] `src.logic` — zerado Fase A ✅
- [x] `scripts.analysis` — zerado Fase A ✅
- [x] `src.inference_gateway` — zerado Fase A ✅
- [x] `src.dashboard-ui` — zerado Fase A ✅
- [x] `tests.manual` — zerado Fase A ✅
- [x] `src.audit_agent` — zerado Fase A ✅
- [x] `src.nerv` — zerado Fase B ✅
- [x] `scripts.health` — zerado Fase B ✅
- [x] `src.missions` — zerado Fase B ✅
- [x] `src.shared` — zerado Fase B ✅
- [x] `src.orchestrator` — zerado Fase B ✅
- [x] `src.integration` — zerado Fase B ✅
- [x] `scripts.audit` — zerado Fase B ✅
- [x] `scripts.root` — zerado Fase B ✅ (↓ era 935)
- [x] `tools.workspace` — zerado Fase B ✅ (↓ era 1.013)
- [x] `src.core` — zerado Fase B ✅ (↓ era 1.053)
- [x] `src.agent` — zerado Fase B ✅ (↓ era 1.190)
- [x] `src.kernel` — zerado Fase B ✅ (↓ era 1.530)
- [x] `src.infra` — zerado Fase C ✅ (↓ era 2.232)
- [x] `src.driver` — zerado Fase C ✅ (↓ era 1.558) — sessão 6/3/2026
- [x] `tests.legacy` — zerado Fase C ✅ (↓ era 1.403) — sessão 6/3/2026

**Gate de CI**: `npm run typecheck:strict` → deve retornar exit 0 em toda PR.

---

## Histórico de esforço

| Fase   | Erros eliminados | Lanes zeradas | Status            |
| ------ | ---------------: | :-----------: | ----------------- |
| Fase 0 |              214 |       —       | ✅ Concluída       |
| Fase A |            1.134 |       6       | ✅ Concluída       |
| Fase B |            7.331 |      12       | ✅ Concluída       |
| Fase C |            6.723 |       3       | ✅ Concluída (6/3) |
| Fase D |       ~2.537 est |       —       | ✅ Concluída (7/3) |

> **Nota sobre cascata**: corrigir um typedef em `src/infra/db/task_repo.js` pode eliminar dezenas
> de TS2339 em `src/agent/*.js` e `src/missions/*.js`. O número real de **linhas modificadas** é
> muito menor que o número de erros reportados.

**Total eliminado**: ~15.402 erros TypeScript (Fases 0–C) em 39 lanes. **Fase D concluída em
7/3/2026**: `strict: true` ativado globalmente, todos os targets em 0. **Next action**: Fase E —
migração `@import` + redução de `@any`. Ver [`AUDITORIA-2026-03-07.md`](./AUDITORIA-2026-03-07.md)
para métricas completas da Fase D.
