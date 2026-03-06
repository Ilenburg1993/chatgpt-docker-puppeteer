# Roadmap de Execução — Tipagem e JSDoc

> **Última revisão**: 4 de março de 2026 **Branch ativa**: `feat/typing-fullstrict-roadmap` **PR
> ativa**: <https://github.com/Ilenburg1993/chatgpt-docker-puppeteer/pull/99>
>
> Este é o documento operacional de execução. As regras normativas vivem em
> [`PADROES.md`](./PADROES.md) e em
> [`../REFERENCIA/TYPING_JSDOC_CANON.md`](../REFERENCIA/TYPING_JSDOC_CANON.md).
>
> **Regra absoluta**: `// @ts-nocheck` é proibido. Jamais use para suprimir erros.

---

## Estado geral — 5 de março de 2026 (Fase B: 8/11 concluídas)

| Indicador                     | Antes     | Agora         |
| ----------------------------- | --------- | ------------- |
| Arquivos com `// @ts-check`   | **670**   | **670**       |
| `@ts-nocheck` em código real  | **0** ✅   | **0** ✅       |
| Erros `typecheck:node` (base) | ~2.170    | **2.120**     |
| Erros `typecheck:strict:all`  | ~7.414    | **~3.900** ↓  |
| Lanes com 0 erros             | 11 de 30+ | **24 de 30+** |

**Fase 0 concluída**: 214 erros JSDoc estruturais (TS8032=177, TS8024=37) eliminados. **Fase A
concluída (6/6)**: `src.logic` ✅, `scripts.analysis` ✅, `src.inference_gateway` ✅,
`src.audit_agent` ✅, `src.dashboard-ui` ✅, `tests.manual` ✅.

**Fase B em andamento** (8/11 concluídas): `src.nerv` ✅, `scripts.health` ✅, `src.missions` ✅,
`src.shared` ✅, `src.orchestrator` ✅, `src.integration` ✅, `tools.workspace` ✅, `src.kernel` ✅.

> **Cascata**: as correções das Fases A e B geraram reduções massivas nos lanes restantes:
> `src.infra` 2.232→716 (−68%), `src.kernel` 1.530→**0** ✅ (−100%), `src.agent` 1.190→447,
> `tools.workspace` 1.013→**0** ✅.

**Próximo passo**: Fase B — `src.agent` (447) → `src.core` (464) → `scripts.audit` (928).
`scripts.root` ✅ e `src.kernel` ✅ zeradas.

**Dependência nova instalada**: `@types/better-sqlite3` (devDependencies) — resolve TS7016 em
`src/infra/db/sqlite.js`.

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

| Lane                    | Erros | Fase     | Status                   |
| ----------------------- | ----: | -------- | ------------------------ |
| `src.types`             |     0 | ✅ verde  | Manter                   |
| `agents`                |     0 | ✅ verde  | Manter                   |
| `scripts.ci`            |     0 | ✅ verde  | Manter                   |
| `scripts.setup`         |     0 | ✅ verde  | Manter                   |
| `tests.helpers`         |     0 | ✅ verde  | Manter                   |
| `scripts.build`         |     0 | ✅ verde  | Manter                   |
| `scripts.env`           |     0 | ✅ verde  | Manter                   |
| `src.validation`        |     0 | ✅ verde  | Manter                   |
| `tests.mocks`           |     0 | ✅ verde  | Manter                   |
| `src.logic`             |     0 | ✅ verde  | Manter                   |
| `scripts.analysis`      |     0 | ✅ verde  | Manter                   |
| `src.inference_gateway` |     0 | ✅ verde  | Manter                   |
| `src.dashboard-ui`      |     0 | ✅ verde  | Manter                   |
| `tests.manual`          |     0 | ✅ verde  | Manter                   |
| `src.audit_agent`       |     0 | ✅ verde  | Manter                   |
| `src.nerv`              |     0 | ✅ verde  | Manter                   |
| `scripts.health`        |     0 | ✅ verde  | Manter                   |
| `src.missions`          |     0 | ✅ verde  | Manter                   |
| `src.shared`            |     0 | ✅ verde  | Manter                   |
| `src.orchestrator`      |     0 | ✅ verde  | Manter                   |
| `src.integration`       |     0 | ✅ verde  | Manter                   |
| `tools.workspace`       |     0 | ✅ Done   | ↓ era 1.013              |
| `scripts.root`          |     0 | ✅ Done   | ↓ era 935, zerada Fase B |
| `src.kernel`            |     0 | ✅ Done   | ↓ era 1.530              |
| `src.agent`             |   447 | Fase B   | ↓ era 1.190              |
| `src.core`              |   464 | Fase B   | ↓ era 1.053              |
| `tests.legacy`          |   481 | Fase C   | ↓ era 1.403              |
| `src.infra`             |   716 | Fase C   | ↓ era 2.232              |
| `src.driver`            |   810 | Fase C   | ↓ era 1.558              |
| `scripts.audit`         |   928 | Fase B   | —                        |

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
- [ ] `src.agent`: **447** → 0 ← próximo (era 1.190)
- [ ] `src.core`: **464** → 0 ← (era 1.053)
- [ ] `scripts.audit`: 928 → 0

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

- [ ] `src.infra`: 716 → 0 (↓ era 2.232)
- [ ] `src.driver`: 810 → 0 (↓ era 1.558)
- [ ] `tests.legacy`: 481 → 0 (↓ era 1.403)

---

## Fase D — Convergência e ativação de flags

Após Fases A–C com `typecheck:strict:all` próximo de 0, ativar flags progressivamente em
`tsconfig.base.json`.

| Etapa | Flag                         |  Erros diretos | Padrão de correção                   |
| ----- | ---------------------------- | -------------: | ------------------------------------ |
| D.1   | `useUnknownInCatchVariables` |            602 | `const e = /** @type {any} */ (err)` |
| D.2   | `noImplicitAny`              |          1.675 | `@param` em todos os callbacks       |
| D.3   | `strictNullChecks`           |            245 | `?.`, `?? default`, null guards      |
| D.4   | `strict: true`               | (consolidação) | Todos os anteriores                  |

**Flags NÃO recomendadas**: `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`.

- [ ] `typecheck:node` → 0
- [ ] `useUnknownInCatchVariables: true` — sem regressão
- [ ] `noImplicitAny: true` — sem regressão
- [ ] `strictNullChecks: true` — sem regressão
- [ ] `strict: true` em tsconfig.base.json — `typecheck:strict:all` → 0

---

## Lanes sempre-verde (manter em 0)

- [x] `src.types`
- [x] `agents`
- [x] `scripts.ci`
- [x] `scripts.setup`
- [x] `tests.helpers`
- [x] `scripts.build`
- [x] `scripts.env`
- [x] `src.validation`
- [x] `tests.mocks`
- [x] `src.logic` — zerado em 4 mar 2026 ✅
- [x] `scripts.analysis` — zerado em 4 mar 2026 ✅

**Qualquer regressão nestas lanes bloqueia o merge.**

---

## Estimativa de esforço

| Fase   | Erros atuais | Sessões estimadas | Status      |
| ------ | -----------: | :---------------: | ----------- |
| Fase 0 |            0 |         —         | ✅ Concluída |
| Fase A |        1.134 |        2–3        | 2/6 feito   |
| Fase B |        7.331 |        6–8        | —           |
| Fase C |        6.723 |        5–6        | —           |
| Fase D |         res. |        2–3        | —           |

> **Nota sobre cascata**: corrigir um typedef em `src/infra/db/task_repo.js` pode eliminar dezenas
> de TS2339 em `src/agent/*.js` e `src/missions/*.js`. O número real de **linhas modificadas** é
> muito menor que o número de erros reportados.
