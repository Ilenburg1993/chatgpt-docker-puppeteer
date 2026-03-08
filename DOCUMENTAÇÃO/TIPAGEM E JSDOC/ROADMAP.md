# Roadmap de Execução — Tipagem e JSDoc

> **Última revisão**: 8 de março de 2026 **Branch ativa**: `feat/typing-fullstrict-roadmap` **PR
> ativa**: <https://github.com/Ilenburg1993/chatgpt-docker-puppeteer/pull/99>
>
> Este é o documento operacional de execução. As regras normativas vivem em
> [`PADROES.md`](./PADROES.md) e em
> [`../REFERENCIA/TYPING_JSDOC_CANON.md`](../REFERENCIA/TYPING_JSDOC_CANON.md).
>
> **Regra absoluta**: `// @ts-nocheck` é proibido. Jamais use para suprimir erros.

---

## Estado geral — 8 de março de 2026 🎉 FASES 0–D + G.4 + G.5 + H.1 + H.2 COMPLETAS

| Indicador                          | Início do roadmap | Agora (8 mar 2026)                 |
| ---------------------------------- | ----------------- | ---------------------------------- |
| Arquivos com `// @ts-check`        | **670**           | **721** ✅ (+51 src/)               |
| `@ts-ignore` em código real        | desconhecido      | **0** ✅                            |
| `@ts-nocheck` em código real       | **0** ✅           | **0** ✅                            |
| Erros `typecheck:node` (base)      | ~2.170            | **0** ✅                            |
| Erros `typecheck:tools`            | ~2                | **0** ✅                            |
| Erros `typecheck:browser`          | ~285              | **0** ✅                            |
| Erros `typecheck:tests`            | 15                | **0** ✅                            |
| Erros `typecheck:isolated`         | N/A               | **0** ✅ (novo)                     |
| Erros `typecheck:strict:all`       | ~7.414            | **0** ✅ 🎉                          |
| Erros `typecheck:repo`             | N/A               | **0** ✅                            |
| Lanes strict com 0 erros           | 11 de 39          | **39 de 39** ✅                     |
| `strict: true` em tsconfig.base    | não               | **sim** ✅                           |
| `useUnknownInCatchVariables`       | não               | **sim** ✅                           |
| `strictNullChecks`                 | não               | **sim** ✅                           |
| `noImplicitAny` (via strict)       | não               | **sim** ✅                           |
| `exactOptionalPropertyTypes`       | não               | **sim** ✅ (G.2)                     |
| `noUncheckedIndexedAccess`         | não               | **sim** ✅ (G.1)                     |
| `allowUnreachableCode: false`      | não               | **sim** ✅ (G.4)                     |
| `allowUnusedLabels: false`         | não               | **sim** ✅ (G.5)                     |
| `isolatedDeclarations` (src/types) | não               | **sim** ✅                           |
| `isolatedDeclarations` (constants) | não               | **sim** ✅ (H.2)                     |
| Node `--strip-types` (H.1)        | não               | **sim** ✅ (src/core/constants .ts)   |
| Schema tsserver-tool-contract      | v1.0.0            | **v1.1.0** ✅                        |
| JSDoc cobertura exports            | ~70%              | **100%** (1115/1115) ✅              |
| Tags unsafe restantes (`@any`)     | ~404              | ~511 (manter monit.)               |
| Magic strings (NERV) no código    | desconhecido      | **0 HIGH, 0 MEDIUM** ✅ (Fase I — 3 LOW residuais justificados)                    |
| Enums NERV cobertos                | 3                 | **7** ✅ após Fase I               |
| Constantes project-wide catalogadas | não               | **sim** ✅ (Fase I)                  |

**Fases 0–D concluídas em 7 de março de 2026**: `strict: true` ativado globalmente em
`tsconfig.base.json`, todos os targets em 0, `isolatedDeclarations` ativo para `src/types/`.

**Sessão 8 de março de 2026 — G.4 + G.5 + correções de bugs**:

- G.4 (`allowUnreachableCode: false`) ativado — 0 erros ✅
- G.5 (`allowUnusedLabels: false`) ativado — 0 erros ✅
- `apache-arrow@18.1.0` instalado (peer dep do `@lancedb/lancedb`) ✅
- `@types/babel__traverse` instalado ✅
- `src/server/api/controllers/dashboard_tasks.js` — TS1003: `@param` sem nome → corrigido ✅
- `tools/rag/lib/chunking/chunk_js_ast.mjs` — TS2578: `@ts-expect-error` unused → removido ✅
- `scripts/audit/lib/exec.mjs` — TS1110: `@type` incompleto (×2) → corrigido ✅
- `tests/regression/test_p3+p4_p5_fixes.spec.js` — TS7027: código morto → removido ✅
- `tests/unit/rag/test_ollama_embeddings_provider.spec.js` — bug `const receivedInputLength` → corrigido ✅
- `typecheck:repo` → 0 erros | `test:unit` → pass ✅

**Correções complementares — sessão 7 mar 2026 (2ª parte)**:

- `src/server/api/controllers/*.js` — TS7030: explicit `return` em 6 controllers ✅
- `src/server/middleware/auth.js` — TS18048: optional chaining `req.user?.username` ✅
- `src/server/engine/app.js` + `schema_guard.js` — TS7030: explicit `return` before `next()` ✅
- `src/types/global.d.ts` — Express.Request augmented: `id: string`, `user?: Record<string, any>` ✅
- `src/types/core/augmentations.d.ts` — identity_manager: `initialize`, `robotId`, `instanceId` ✅
- `src/types/infra/augmentations.d.ts` — io: `ROOT`, `RESPONSE_DIR`; ConnectionOrchestrator:
  constructor+connect; BrowserPoolManager: `removePageFromPool(taskId, page?)` ✅
- `src/types/server/augmentations.d.ts` — `getIO()` retorna tipo com `fetchSockets()` ✅
- `tsconfig.tests.json` + 7 strict test lanes — incluem `src/types/**/*.d.ts` ✅
- `tests/fixtures/mcp/stdio-server.mjs` — TS2769: cast `@type {any}` em McpServer ✅
- `tests/manual/test_browser_pool.js` — `@type {any}` cast em BrowserPoolManager ✅
- `tests/manual/test_connection_orchestrator.js` — `@type {any}` cast em ConnectionOrchestrator ✅
- `tests/regression/test_wave14_hot_pool_monitor_taskid_rebind.spec.js` — `@type {any[]}` cast em
  `manager.pool` ✅

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

> **Próximo objetivo (Fase E)**: migração `@import`, redução de `@type{any}`, expansão de
> `isolatedDeclarations`, e adição de typedefs para 52 funções com options-param sem typedef.

---

## Fase E — Próximos objetivos (pós 7 mar 2026)

### E.0 — Correções rápidas (alta prioridade, baixo risco)

- [x] Remover `// @ts-nocheck` e converter para `// @ts-check` nos 4 arquivos de tests/:
  - `tests/nightly/audit/test_contract_chaos.spec.js` ✅
  - `tests/scripts/corrigir_imports.js` ✅
  - `tests/support/setup.js` ✅
  - `tests/support/teardown.js` ✅
- [x] Adicionar `tests/supertest.d.ts` à lane strict `tests.integration` ✅
- [x] Migrar 14 `@typedef {import(...)}` legados para sintaxe `@import` (TS 5.5+) ✅
  - `src/core/validators/prerequisite_validator.js`
  - `src/driver/guards/DriverReadinessGuard.js`
  - `src/audit_agent/runtime.js` (redundante — removido)
  - 7 coletores em `scripts/audit/collectors/*.mjs`
  - 3 contratos em `scripts/audit/contracts/*.mjs`
  - `scripts/audit/triage_llm.mjs`
- [ ] Verificar e migrar 14 arquivos `tests/legacy/node/*.js` para `// @ts-check` (análogo ao acima)

### E.1 — Adicionar typedefs para options params (52 funções pendentes)

Funções com `@param {object} options` sem `@typedef` — adicionar typedef nomeado:

| Arquivo                                        | Funções pendentes |
| ---------------------------------------------- | ----------------: |
| `src/server/domain/mission_control_service.js` |                 8 |
| `src/infra/db/task_repo.js`                    |                 6 |
| Outros 21 arquivos                             |                38 |

**Critério de conclusão**: `functions_missing_options_typedef: 0`

### E.2 — Redução de unsafe tags JSDoc (511 ocorrências)

Substituir tags imprecisas por tipos reais:

- `@type {any}` → tipos específicos ou `@type {unknown}` + asserção pontual
- `@param {Object}` → `@param {Record<string, unknown>}` ou typedef
- `@param {Function}` → assinatura explícita `@param {(arg: T) => R}`
- `@returns {Promise<any>}` → `@returns {Promise<T>}` com T real

**Critério de conclusão**: `unsafe_generic_tags_total: 0`

### E.3 — Redução de `@type{any}` em src/ (~3.276 ocorrências)

Arquivos com mais ocorrências (prioridade):

| Arquivo                               | Ocorrências |
| ------------------------------------- | ----------: |
| `src/main.js`                         |         122 |
| `src/shared/sadi/analyzer.js`         |          83 |
| `src/server/api/controllers/tasks.js` |          78 |
| `src/infra/io.js`                     |          31 |
| Demais ~280 arquivos                  |      ~2.962 |

**Estratégia**: substituir em blocos por módulo, do menor para o maior. Manter
`typecheck:strict:all = 0` a cada commit.

### E.4 — Expansão de `isolatedDeclarations`

Expandir `tsconfig.isolated-declarations.json` para além de `src/types/`:

- `src/core/` — APIs públicas estáveis
- `src/nerv/` — interface de eventos
- `src/kernel/` — API de execução

**Critério**: `typecheck:isolated` continua em 0 após cada expansão.

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
7/3/2026**: `strict: true` ativado globalmente, todos os targets em 0. **Next action**: Fase E →
Fase F → Fase G. Ver [`AUDITORIA-2026-03-07.md`](./AUDITORIA-2026-03-07.md) para métricas completas
da Fase D.

---

## Fase F — Declaration Emit e análise de `noEmit: false`

> **Planejado em**: 7 de março de 2026. **Status**: em execução (F.1 concluído).

### Análise: o que significa `noEmit: false` neste repositório?

Este repositório é **JS-first**: o Node.js executa os arquivos `.js` diretamente — não há
transpilação de `.ts` → `.js`. O TypeScript atua exclusivamente como **verificador de tipos via
JSDoc** + tsserver.

#### Opção F.A — `noEmit: false` global sem `emitDeclarationOnly` ❌ NÃO RECOMENDADO

```json
// tsconfig.base.json
{ "compilerOptions": { "noEmit": false, "outDir": "./dist" } }
```

**O que acontece**: TypeScript compilaria todos os 283 arquivos `.js` de `src/` para `dist/`. Com
`verbatimModuleSyntax: true` + `allowJs: true`, o resultado seria essencialmente uma _cópia_ dos
arquivos originais (salvo remoção de `import type` e `@import` comments — já que TS os strip).

**Consequências**:

- `dist/` passaria a ser a build artefact — o runtime precisaria mudar de `src/` para `dist/`.
- `package.json` main precisaria apontar para `dist/src/main.js`.
- Toda a infraestrutura (PM2, Docker, scripts) precisaria ser atualizada.
- Ganho prático: zero (Node.js 24 já roda JS nativo; a "compilação" não muda o código).
- **Custo**: migração arquitetural completa. **Não recomendado** para este projeto.

#### Opção F.B — `emitDeclarationOnly: true` em `tsconfig.base.json` ❌ INVIÁVEL

```json
// tsconfig.base.json
{ "compilerOptions": { "noEmit": false, "emitDeclarationOnly": true, "declaration": true } }
```

**Problema**: as 41 lanes strict têm `noEmit: true` explícito — isso sobrescreveria a base.
Conflito: a base emitiria `.d.ts`, mas os filhos cancelariam a emissão. Possível, mas geraria
comportamento imprevisível entre configs. Além disso, `tsconfig.base.json` inclui todo o projeto —
emitir `.d.ts` para _tudo_ (incluindo scripts, tests, tools) não é o objetivo.

#### Opção F.C — Novo `tsconfig.declarations-full.json` ✅ RECOMENDADO

Criar um config dedicado que emite `.d.ts` para **todo `src/`**:

```json
{
  "extends": "./tsconfig.node.json",
  "compilerOptions": {
    "noEmit": false,
    "declaration": true,
    "emitDeclarationOnly": true,
    "declarationMap": true,
    "outDir": "./tmp/types-all"
  },
  "include": ["src/**/*.js", "src/types/**/*.d.ts"],
  "exclude": ["src/dashboard-ui/**"]
}
```

**O que emite**: um arquivo `.d.ts` para cada `.js` em `src/` → em `tmp/types-all/`.

**Vantagens**:

- Node.js runtime **não é afetado** — continua usando `src/` diretamente.
- Ferramentas externas (bundlers, consumers, LSP remoto) podem consumir os tipos.
- Isola a emissão em `tmp/` — não polui o source.
- `declarationMap: true` → `.d.ts.map` para navegação "go to definition" em consumers.

**Pré-condição importante**: para emitir `.d.ts` de um arquivo `.js`, TypeScript requer que os tipos
de **retorno de funções exportadas** sejam inferíveis sem contexto externo. Arquivos com retornos
complexos (`Promise<inferred>`) podem gerar erros de declaração.

### Checklist Fase F

- [x] F.1 — Criar `tsconfig.declarations-full.json` (Opção F.C) ✅
- [x] F.2 — Adicionar script `typecheck:declarations:full` no `package.json` ✅
- [x] F.3 — Executar e atingir 0 erros em `typecheck:declarations:full` ✅
- [x] F.4 — Adicionar `declarations-full` ao CI (gate de regressão) ✅ (8 mar 2026)
- [x] F.5 — Expandir `tsconfig.isolated-declarations.json` para `src/core/constants/` ✅ (8 mar 2026, H.2)
    (⚠️ **Parcial**: apenas arquivos `.ts` suportados — `src/core/constants/` migrado em H.1)

**Gate F.3**: `npm run typecheck:declarations:full` → 0 erros.

---

## Fase G — Flags adicionais de strictness

> **Planejado em**: 7 de março de 2026. **Erros medidos** com `typecheck:node` atual como baseline.

Flags que **não entraram no `strict: true`** padrão do TypeScript, mas que adicionam verificações
relevantes. Diferente das Fases 0–D, estas podem ser ativadas pontualmente por `.d.ts` tipo override
ou lane por lane.

| Etapa | Flag                                 |     Erros medidos | Padrão de correção                                                | Status |
| ----- | ------------------------------------ | ----------------: | ----------------------------------------------------------------- | ------ |
| G.1   | `noUncheckedIndexedAccess`           |                45 | `arr[i]!` ou guard `if (v !== undefined)`                         | ✅      |
| G.2   | `exactOptionalPropertyTypes`         |                31 | Adicionar `\| undefined` nos tipos de destino ou usar `Partial<>` | ✅      |
| G.3   | `noPropertyAccessFromIndexSignature` | **1784** ⚠️ (≠ ≈0) | Trocar `.prop` por `["prop"]` em `Record<K,V>` (TS4111)           | [ ]    |
| G.4   | `allowUnreachableCode: false`        |                 0 | Remover código morto após `return`/`throw`                        | ✅      |
| G.5   | `allowUnusedLabels: false`           |                 0 | Remover labels JS não-utilizados                                  | ✅      |

### G.1 — `noUncheckedIndexedAccess` (45 erros) ✅ CONCLUÍDA

> **Status**: ativada em `tsconfig.base.json`. 0 erros em todos os 40+ lanes strict. Commit:
> `3a7867e4`.

**O que faz**: acesso a array/objeto por índice (`arr[0]`, `obj[key]`) retorna `T | undefined` em
vez de `T`. Força verificação de limite de array.

**Padrão de erro**: `TS2322: Type 'string | undefined' is not assignable to type 'string'`

**Estratégia de correção**:

1. Asserção não-nula: `arr[0]!` (onde garantido por lógica de negócio)
2. Guard explícito: `const v = arr[i]; if (v === undefined) return;`
3. Coalescência: `arr[0] ?? defaultValue`

**Critério de ativação**: após concluir E.2 (redução de unsafe tags). Ativar em
`tsconfig.base.json`.

### G.2 — `exactOptionalPropertyTypes` (31 erros) ✅ CONCLUÍDA

> **Status**: ativada em `tsconfig.base.json`. 0 erros em todos os lanes strict. Commit: `3a7867e4`.

**O que faz**: `{ a?: string }` significa apenas `{a: string}` ou `{}` — nunca `{a: undefined}`. Sem
essa flag, TypeScript aceita `{a: undefined}` como satisfazendo `{a?: string}`.

**Padrão de erro**: `TS2379: Argument not assignable ... with exactOptionalPropertyTypes: true`

**Estratégia de correção**:

1. Nos typedefs JSDoc: `@property {string | undefined} [prop]` para propriedades que podem ser
   `undefined` explicitamente
2. Nas chamadas: remover propriedades `undefined` do literal antes de passar:
   `Object.fromEntries(...filter)`
3. Usar `Partial<T>` quando aplicável

**Critério de ativação**: independente — pode ativar agora (apenas 31 erros).

### G.4 — `allowUnreachableCode: false` ✅ CONCLUÍDA (8 mar 2026)

> **Status**: ativada em `tsconfig.base.json`. 0 erros em todos os targets. Commit: `be7a603a`.

**O que faz**: emite TS7027 para código que nunca pode ser executado (após `return`, `throw`,
`break` ou `continue`).

**Correções aplicadas**: removido `console.log('')` inalcançável em
`tests/regression/test_p3_fixes.spec.js` e `test_p4_p5_fixes.spec.js`.

---

### G.5 — `allowUnusedLabels: false` ✅ CONCLUÍDA (8 mar 2026)

> **Status**: ativada em `tsconfig.base.json`. 0 erros em todos os targets. Commit: `be7a603a`.

**O que faz**: emite TS7028 para labels JavaScript declaradas mas não usadas por `break`/`continue`.

**Correções aplicadas**: nenhuma (0 erros já antes da ativação — base de código limpa).

---

### G.3 — `noPropertyAccessFromIndexSignature` ⚠️ 1784 ERROS — PLANEJAMENTO PENDENTE

> **Status**: NÃO ativada. Medição confirmada em 8 mar 2026: **1784 erros TS4111**.
> Estimativa original (≈0) estava incorreta — a estimativa não levou o volume de `Record<K,V>` em conta.

**O que faz**: força uso de `obj["key"]` em vez de `obj.key` quando o tipo do objeto usa index
signature (`Record<string, T>`, `{ [k: string]: T }`).

**Padrão de erro**: `TS4111: Property 'X' comes from an index signature, so it must be accessed with ['X']`

**Análise do volume**:
- 1784 erros distribuídos por toda a codebase
- Principalmente em: `src/kernel/`, `src/infra/`, `src/driver/`, `src/agent/`, `src/missions/`
- Padrão recorrente: `config.timeout`, `task.status`, `options.retry` — todos vindos de typedefs
  JSDoc com index signature implícita

**Estratégias possíveis**:

1. **Refazer typedefs**: converter `@typedef {{ [k: string]: any }}` em interfaces concretas com
   propriedades nomeadas (prefered — elimina a fonte, não o sintoma)
2. **Patch por lane**: ativar por `tsconfig.strict.src.kernel.json` etc. e corrigir lane por lane
3. **Skip temporário**: manter `noPropertyAccessFromIndexSignature: false` (default) até H.1 que
   migrará arquivos para `.ts` com interfaces explícitas

**Recomendação**: abordar como sub-roadmap separado após H.1 (migração `.ts`), pois a correção
ideal é ter interfaces TypeScript reais em vez de typedefs `Record<string, any>`.

---

### Ordem recomendada de execução (atualizado 8 mar 2026)

```
G.1 ✅ → G.2 ✅ → G.4 ✅ → G.5 ✅ → H.1 ✅ → H.2 ✅ → G.3 (com interfaces .ts)
```

G.3 foi reclassificado para execução após H.1 (migração seletiva `.js` → `.ts`), pois a correção
definitiva exige interfaces TypeScript explícitas nos tipos de dados do domínio.

---

## Fase H — Evolução arquitetural (longo prazo)

> **Planejado**: horizonte de 2–3 sprints após conclusão das Fases E–G.
> **Estado atual** (8 mar 2026): H.1 ✅ e H.2 ✅ concluídas. `src/core/constants/` migrado para `.ts`. G.3 desbloqueado.

### H.1 — Migração seletiva de `.js` → `.ts`

> **Status**: ✅ **CONCLUÍDA** (8 mar 2026, commit `184c9a70`). `src/core/constants/` migrado (5 arquivos, ~650 LOC).
> Node.js 24 `--strip-types` adicionado a 8 scripts npm e ao `ecosystem.config.cjs`.
> `tsconfig.base.json`: `allowImportingTsExtensions: true` ativado.
> `package.json#imports`: aliases `#core/constants/*` apontam para `.ts`.

Candidatos prioritários (APIs públicas estáveis, sem dependências circulares):

- `src/types/**` — já são `.d.ts`, candidatos a `.ts` gerado
- `src/core/constants/**` — constantes puras, tipagem trivial (~630 LOC)
- `src/validation/**` — schemas Zod já têm inferência nativa TS (~420 LOC)
- `src/shared/health-check.js` + `src/shared/inference-gateway-client.js` — já emitem `.d.ts`

**Critério**: módulo tem 0 dependências circulares (`npm run analyze:deps`) e exports com tipos
explícitos 100%.

**Passo a passo para H.1**:
1. Verificar `npm run analyze:deps` para confirmar ausência de circulares nos candidatos
2. Renomear arquivo: `git mv src/core/constants/index.js src/core/constants/index.ts`
3. Remover `// @ts-check` (desnecessário em `.ts`)
4. Converter JSDoc types para TS nativo onde conveniente
5. Atualizar todos os imports no repo: `rg -l "constants/index"` → ajustar extensões se necessário
6. Verificar `npm run typecheck:node` → 0 erros
7. Repetir para próximo candidato

### H.2 — `isolatedDeclarations` para todo `src/`

> **Status**: ✅ **CONCLUÍDA PARCIALMENTE** (8 mar 2026, commit `aa9b4c64`). `src/core/constants/` coberto.
> Próximos candidatos (H.2.b): `src/types/**`, `src/validation/**`, `src/shared/**` quando migrados para `.ts`.

Expansão incremental de `tsconfig.isolated-declarations.json`:

1. Adicionar `src/core/**` (APIs estáveis, retornos explícitos)
2. Adicionar `src/nerv/**` (interface de eventos)
3. Adicionar `src/shared/**` (utilitários públicos)
4. Avaliar `src/infra/**` (mais complexo, retornos SQLite)

**Pré-condição**: `isolatedDeclarations` requer que toda função exportada tenha tipo de retorno
explícito em JSDoc (`@returns {T}` sem inferência). Verificar cobertura antes de ativar.

**Nota**: `isolatedDeclarations: true` é incompatível com `allowJs: true`. Por isso apenas arquivos
`.ts`/`.d.ts` podem ser incluídos em `tsconfig.isolated-declarations.json`. Atualmente só cobre
`src/types/**/*.d.ts`.

### H.3 — `composite: true` + Project References

Ativar `composite: true` em configs filhos + usar `references` no tsconfig raiz para build
incremental por subsistema:

```json
// tsconfig.json (raiz)
{
  "references": [{ "path": "./tsconfig.node.json" }, { "path": "./tsconfig.declarations.json" }]
}
```

**Benefício**: `tsc --build` faz build incremental por projeto — rebuild parcial quando apenas
`src/kernel/` muda.

**Pré-condição**: `emitDeclarationOnly: true` deve estar estável em todas as configs participantes.

---

## Fase I — Catalogação e governança de constantes do projeto

> **Estado**: ✅ **CONCLUÍDA** (8 mar 2026). Novos enums criados, 21 magic strings
> eliminadas, scripts de auditoria aprimorados e catálogo de constantes criado.

### Motivação

- `scan_magic_strings.js` detectou **21 magic strings** com severidade HIGH/MEDIUM:
  ações do orchestrator (`RETRY`, `NEXT_STEP`, `DONE`), comandos de controle HTTP
  (`PAUSE`, `RESUME`, `UNBLOCK`, etc.) e `QUEUE_DISPATCH_FAILED` ausente no `ActionCode`.
- `validate-nerv-constants.js` só validava `ActionCode` — ignorava `MessageType`,
  `ActorRole`, `ChannelState`, `TechnicalCode`, `OrchestrationAction`, `TaskControlCommand`.
- Não existia catálogo project-wide das constantes: quais existem, onde são usadas, quais não têm uso.

### I.1 — Novos enums em `src/shared/nerv/constants.js` ✅

Adicionados dois novos enums ao vocabulário protocolar:

| Enum                  | Valores                                                                        |
| --------------------- | ------------------------------------------------------------------------------ |
| `OrchestrationAction` | `RETRY`, `NEXT_STEP`, `DONE` — decisões internas do orchestrator loop          |
| `TaskControlCommand`  | `PAUSE`, `RESUME`, `UNBLOCK`, `RETRY`, `CANCEL`, `PATCH`, `APPROVE`, `REJECT`, `SET_STAGE`, `SET_TARGET`, `SET_PRIORITY`, `SET_EXECUTE_AFTER`, `SET_DEPENDENCIES`, `REASSIGN_MISSION` |

`ActionCode` também recebeu `QUEUE_DISPATCH_FAILED`.

### I.2 — Eliminação de magic strings ✅

| Arquivo                                              | Antes                  | Depois                    |
| ---------------------------------------------------- | ---------------------- | ------------------------- |
| `src/kernel/nerv_bridge/kernel_nerv_bridge.js`       | `case 'RETRY':` etc.   | `OrchestrationAction.*`   |
| `src/server/domain/task_control_service.js`          | 12 `case 'STRING':`    | `TaskControlCommand.*`    |
| `src/agent/queue_worker.js`                          | `'QUEUE_DISPATCH_FAILED'` | `ActionCode.QUEUE_DISPATCH_FAILED` |

Magic strings residuais LOW (`target: 'driver'`): mantidas com comentário — são lowercase de `ActorRole.DRIVER` por requisito de protocolo (campo de roteamento case-sensitive lowercase).

### I.3 — Scripts de auditoria aprimorados ✅

- **`scripts/analysis/scan_magic_strings.js`**: adicionados padrões para `STATUS_VALUES`
  (`'pending'`, `'running'`, `'failed'`), `CONNECTION_MODES` (`'hybrid'`, `'local'`),
  e os novos `OrchestrationAction`/`TaskControlCommand`.
- **`scripts/validate-nerv-constants.js`**: expandido para validar todos os 7 enums;
  usa `rg` em vez de `grep`; suporta `--enum=NAME` e `--all`.

### I.4 — Catálogo de constantes project-wide ✅

Novo script `scripts/analysis/catalog-constants.mjs`:
- Varre `src/core/constants/*.ts`, `src/shared/nerv/constants.js`, `src/shared/ipc/constants.js`
- Para cada constante: conta usos no código, lista arquivos que importam
- Identifica constantes com 0 uso (candidatas a remoção)
- Flags: `--json`, `--unused-only`, `--module=NAME`
- Script npm: `npm run analyze:constants`

### Checklist Fase I

- [x] I.1 — Novos enums: `OrchestrationAction`, `TaskControlCommand`, `QUEUE_DISPATCH_FAILED` ✅
- [x] I.2 — Magic strings corrigidas nos 3 arquivos (21 HIGH/MEDIUM → 3 LOW residuais justificados) ✅
- [x] I.3 — `scan_magic_strings.js` expandido com padrões de status/conexão/ação ✅
- [x] I.4 — `validate-nerv-constants.js` valida todos os 7 enums ✅
- [x] I.5 — `catalog-constants.mjs` criado; script `analyze:constants` no package.json ✅
- [x] I.6 — `npm run lint` + `npm run typecheck:node` + `npm run test:unit` → 0 falhas ✅
