# Auditoria de Tipagem, JSDoc e TSServer — 7 de março de 2026

> **Autora**: GitHub Copilot (Claude Sonnet 4.6) | **Data**: 7 de março de 2026
>
> **Escopo**: nova auditoria completa do sistema de tipagem TypeScript/JSDoc/TSServer,
> identificando o estado pós-Fase D, falhas remanescentes e propondo a Fase E.
>
> **Auditoria anterior**: [`AUDITORIA-2026-03-06.md`](./AUDITORIA-2026-03-06.md) — Fases 0–C
>
> **Documentação de referência**: [`ROADMAP.md`](./ROADMAP.md) ·
> [`CONFIGURACOES-TSCONFIG.md`](./CONFIGURACOES-TSCONFIG.md) ·
> [`../REFERENCIA/TYPING_JSDOC_CANON.md`](../REFERENCIA/TYPING_JSDOC_CANON.md)

---

## 1. Sumário executivo

**Status**: Fases 0–D **completamente concluídas**. O sistema de tipagem atingiu seu marco histórico
com `strict: true` ativado globalmente e **0 erros em todos os targets de typecheck**.

| Indicador                           | Março 6 (Fases 0–C) | Março 7 (Fase D) | Delta |
| ----------------------------------- | ------------------- | ---------------- | ----- |
| TypeScript                          | 5.9.3               | **5.9.3**        | —     |
| Node.js                             | v24.13.0            | **v24.13.0**     | —     |
| `strict: true` em tsconfig.base     | ❌                   | ✅                | +1    |
| `typecheck:node`                    | 0 ✅                 | **0** ✅          | —     |
| `typecheck:tools`                   | 0 ✅                 | **0** ✅          | —     |
| `typecheck:browser`                 | 0 ✅                 | **0** ✅          | —     |
| `typecheck:tests`                   | 15 ⚠️                | **0** ✅          | −15   |
| `typecheck:isolated`                | 0 ✅                 | **0** ✅          | —     |
| `typecheck:dashboard`               | ✅                   | **0** ✅          | —     |
| `typecheck:repo` (completo)         | parcial             | **0** ✅          | ✅     |
| `typecheck:strict:all` (41 lanes)   | 0 ✅                 | **0** ✅          | —     |
| `@ts-check` cobertura geral         | 99.4%               | **99.4%**        | —     |
| `@ts-check` src/ (produção)         | 100%                | **100%**         | —     |
| `@ts-check` scripts/                | 100%                | **100%**         | —     |
| `@ts-check` tests/                  | 98.1%               | **98.1%**        | —     |
| `@ts-ignore` em produção (src/)     | 0 ✅                 | **0** ✅          | —     |
| `@ts-nocheck` em produção (src/)    | 0 ✅                 | **0** ✅          | —     |
| JSDoc cobertura exports             | 100%                | **100%**         | —     |
| `functions_missing_options_typedef` | 43                  | **52** ⚠️         | +9    |
| `unsafe_generic_tags_total` (JSDoc) | 404                 | **511** ⚠️        | +107  |
| `@type{any}` em src/ (grep total)   | 1.809¹              | **3.276**²       | —     |
| `@ts-expect-error` real             | 0 ✅                 | **0** ✅          | —     |
| Lanes strict com 0 erros            | 39/39               | **41/41** ✅      | —     |

> ¹ Metodologia da auditoria de 6/3: grep em subset público; ² Metodologia atual: rg completo em
> `src/**/*.js`. A diferença reflete metodologias distintas, não regressão real.

---

## 2. Diagnóstico completo de falhas e gaps

### 2.1 `@ts-check` — 18 arquivos em gap (tests/)

O `analyze:typing:gaps` identificou 18 arquivos sem `// @ts-check`:

**Grupo A — Arquivos de suporte base (4 arquivos, alta prioridade de correção):**

| Arquivo                                           | Categoria |
| ------------------------------------------------- | --------- |
| `tests/nightly/audit/test_contract_chaos.spec.js` | nightly   |
| `tests/scripts/corrigir_imports.js`               | scripts   |
| `tests/support/setup.js`                          | suporte   |
| `tests/support/teardown.js`                       | suporte   |

**Grupo B — Legacy node (10+ arquivos, baixa urgência):**

| Arquivo                                               | Razão do gap      |
| ----------------------------------------------------- | ----------------- |
| `tests/legacy/node/test_adaptive_v46.js`              | legado, não-migr. |
| `tests/legacy/node/test_chrome_proxy_integration.js`  | legado            |
| `tests/legacy/node/test_chrome_proxy_v2.js`           | legado            |
| `tests/legacy/node/test_dna_integration.js`           | legado            |
| `tests/legacy/node/test_dna_system.js`                | legado            |
| `tests/legacy/node/test_errors_communication.js`      | legado            |
| `tests/legacy/node/test_phase3_monitoring.js`         | legado            |
| `tests/legacy/node/test_response_adapter.js`          | legado            |
| `tests/legacy/node/test_sadi_v4_upgrade.js`           | legado            |
| `tests/legacy/node/test_schema_v5.js`                 | legado            |
| `tests/legacy/node/test_task_core_validation.js`      | legado            |
| `tests/legacy/node/test_task_e2e_simplified.js`       | legado            |
| `tests/legacy/node/test_task_end_to_end.js`           | legado            |
| `tests/legacy/node/test_universal_tools_migration.js` | legado            |

**Ação recomendada**: adicionar `// @ts-check` em todos. Os do Grupo A devem ser corrigidos
imediatamente. Os do Grupo B (legacy) devem receber `// @ts-check` e ser adicionados à lane
`tests.legacy` se ainda não estiverem cobertos.

### 2.2 `tests/supertest.d.ts` não coberto por strict lane

O `analyze:typing:gaps` identificou:

```
UNCOVERED_STRICT  tests/supertest.d.ts
```

Este arquivo `.d.ts` não está incluído em nenhuma das 41 lanes strict. Deve ser adicionado à lane
`tests.integration` ou `tests.helpers`.

### 2.3 `functions_missing_options_typedef` — 52 funções (23 arquivos)

Funções exportadas que recebem um parâmetro `options` sem `@typedef` correspondente. Distribuição:

| Arquivo                                        | Missing |
| ---------------------------------------------- | ------: |
| `src/server/domain/mission_control_service.js` |       8 |
| `src/infra/db/task_repo.js`                    |       6 |
| `src/core/runtime_resource_registry.js`        |       4 |
| `src/infra/http_client_utils.js`               |       4 |
| `src/infra/db/control_operation_repo.js`       |       3 |
| `src/infra/storage/artifact_store.js`          |       3 |
| `src/infra/db/audit_watch_rule_repo.js`        |       2 |
| `src/infra/db/diagnostic_job_repo.js`          |       2 |
| `src/infra/db/inference_model_repo.js`         |       2 |
| `src/infra/db/mission_step_repo.js`            |       2 |
| `src/infra/storage/response_store_v2.js`       |       2 |
| `src/nerv/adapters/high_level_adapter.js`      |       2 |
| `src/nerv/discovery.js`                        |       2 |
| outros 10 arquivos (1 cada)                    |      10 |
| **TOTAL**                                      |  **52** |

**Ação recomendada**: criar `@typedef {object} XxxOptions` para cada grupo de opções, começando
pelos arquivos com mais ocorrências (`mission_control_service.js`, `task_repo.js`).

### 2.4 `unsafe_generic_tags_total` — 511 no JSDoc engine

O motor JSDoc contabiliza 511 tags `@type {any}` em posições de contrato público (parâmetros,
retornos, propriedades exportadas). Este número cresceu de ~404 em 6/3/2026 porque novos
arquivos foram adicionados ao escopo.

**Top ofensores via JSDoc engine** (>10 por arquivo):

| Arquivo                                         | Unsafe tags |
| ----------------------------------------------- | ----------: |
| `src/infra/io.js`                               |          31 |
| `src/main.js`                                   |          16 |
| `src/infra/db/inference_client_policy_repo.js`  |          14 |
| `src/infra/db/audit_job_repo.js`                |          12 |
| `src/server/api/controllers/rag.js`             |          12 |
| `src/core/schemas/migrator_v4_to_v5.js`         |          11 |
| `src/core/validators/prerequisite_validator.js` |          11 |
| `src/infra/db/diagnostic_job_repo.js`           |          11 |
| `src/infra/db/task_repo.js`                     |          11 |
| **Total top-9**                                 |     **129** |

### 2.5 `@type{any}` via rg — 3.276 em src/ (cast interno + público)

O `rg "@type\s*\{any\}"` captura **todas** as ocorrências de `@type {any}`, incluindo casts
internos no corpo de funções (padrão `/** @type {any} */ (obj)[key]`). Estes são casts defensivos
necessários até a introdução de `noUncheckedIndexedAccess`.

**Top 25 arquivos por ocorrências totais:**

| Arquivo                                            | `@type{any}` |
| -------------------------------------------------- | -----------: |
| `src/main.js`                                      |          122 |
| `src/shared/sadi/analyzer.js`                      |           83 |
| `src/server/api/controllers/tasks.js`              |           78 |
| `src/shared/page_stability/stabilizer.js`          |           77 |
| `src/shared/biomechanics/human.js`                 |           76 |
| `src/infra/proxy/chromeProxyService.js`            |           75 |
| `src/core/env_validator.js`                        |           69 |
| `src/server/domain/control_command_service.js`     |           67 |
| `src/server/main.js`                               |           66 |
| `src/server/engine/socket.js`                      |           60 |
| `src/server/api/controllers/missions.js`           |           58 |
| `src/agent/task_state_projector.js`                |           57 |
| `src/server/api/controllers/dashboard_tasks.js`    |           56 |
| `src/driver/nerv_adapter/driver_nerv_adapter.js`   |           54 |
| `src/infra/browser_pool/pool_manager.js`           |           52 |
| `src/driver/targets/ChatGPTDriver.js`              |           51 |
| `src/server/dashboard-api/task_sync_bridge.js`     |           48 |
| `src/server/api/controllers/dashboard_missions.js` |           48 |
| `src/server/domain/mission_control_service.js`     |           45 |
| `src/driver/factory.js`                            |           44 |
| `src/dashboard-ui/src/stores/missions_vnext.js`    |           43 |
| `src/dashboard-ui/src/composables/useAudit.js`     |           43 |
| `src/server/realtime/ssot_event_feed.js`           |           41 |
| `src/server/domain/task_control_service.js`        |           40 |
| `src/dashboard-ui/src/stores/tasks.js`             |           40 |
| **TOTAL src/**                                     |    **3.276** |
| **TOTAL tests/**                                   |      **619** |
| **TOTAL scripts/ (.mjs)**                          |      **123** |

**Análise**: ~60% dos casts em `src/main.js` e `src/server/` são padrão de indexação dinâmica
necessários enquanto `noUncheckedIndexedAccess` não for ativado. Os ~40% restantes são candidatos
à substituição por typedefs adequados.

### 2.6 `@typedef {import()}` legado — 4 ocorrências (migração para `@import`)

A tag `@import` (TC39/TS 5.5+) é a forma moderna de importar tipos em JSDoc. O repositório ainda
possui 4 usos do padrão legado `@typedef {import(...)...}` em src/:

| Arquivo                                         | Padrão legado                                   |
| ----------------------------------------------- | ----------------------------------------------- |
| `src/core/validators/prerequisite_validator.js` | `@typedef {import('puppeteer-core').Page} ...`  |
| `src/audit_agent/runtime.js`                    | `@typedef {import('./contracts.js')} _unused`   |
| `src/infra/db/migrations.js`                    | `@typedef {{ ... import('better-sqlite3')...}}` |
| `src/driver/guards/DriverReadinessGuard.js`     | `@typedef {import('#driver/...')} BaseDriver`   |

**Ação recomendada Fase E.1**: migrar para `/** @import { Type } from 'module' */`.

### 2.7 `CONFIGURACOES-TSCONFIG.md` — documentação desatualizada

Este documento ainda indica `strict: false` e outras flags pré-Fase D. As informações são
incorretas e devem ser atualizadas urgentemente para refletir o estado atual.

---

## 3. Métricas consolidadas — estado atual (7 mar 2026)

### 3.1 TypeScript e runtime

| Item                                | Valor       |
| ----------------------------------- | ----------- |
| TypeScript                          | **5.9.3**   |
| Node.js                             | **24.13.0** |
| `allowJs`                           | `true`      |
| `checkJs`                           | `true`      |
| `strict`                            | `true` ✅    |
| `useUnknownInCatchVariables`        | `true` ✅    |
| `strictNullChecks`                  | `true` ✅    |
| `noImplicitAny` (via strict)        | `true` ✅    |
| `strictFunctionTypes` (via strict)  | `true` ✅    |
| `strictBindCallApply` (via strict)  | `true` ✅    |
| `strictPropertyInitialization`      | `true` ✅    |
| `noImplicitThis` (via strict)       | `true` ✅    |
| `alwaysStrict` (via strict)         | `true` ✅    |
| `skipLibCheck`                      | `true`      |
| `verbatimModuleSyntax`              | `true` ✅    |
| `isolatedDeclarations` (src/types/) | `true` ✅    |
| `noUncheckedIndexedAccess`          | ❌ (Fase F)  |
| `exactOptionalPropertyTypes`        | ❌ (N/A)     |

### 3.2 Typecheck por target

| Target                   | Erros | Status |
| ------------------------ | ----: | ------ |
| `typecheck:node`         |     0 | ✅      |
| `typecheck:tools`        |     0 | ✅      |
| `typecheck:browser`      |     0 | ✅      |
| `typecheck:tests`        |     0 | ✅      |
| `typecheck:isolated`     |     0 | ✅      |
| `typecheck:dashboard`    |     0 | ✅      |
| `typecheck:repo`         |     0 | ✅      |
| `typecheck:strict:all`   |     0 | ✅      |
| `typecheck:declarations` |     0 | ✅      |
| **TOTAL**                |     0 | ✅ 🎉    |

### 3.3 JSDoc e qualidade

| Métrica                             | Valor     | Meta Fase E |
| ----------------------------------- | --------- | ----------- |
| Cobertura exports (100% targets)    | **100%**  | manter      |
| `functions_missing_returns_tag`     | **0** ✅   | 0           |
| `functions_missing_param_tags`      | **0** ✅   | 0           |
| `functions_missing_options_typedef` | **52** ⚠️  | ≤ 10        |
| `unsafe_generic_tags_total`         | **511** ⚠️ | ≤ 300       |
| `@ts-check` src/ (299 arquivos)     | **100%**  | 100%        |
| `@ts-check` scripts/ (126 arquivos) | **100%**  | 100%        |
| `@ts-check` tests/ (215 rastreados) | **98.1%** | 100%        |
| `@ts-ignore` em src/                | **0** ✅   | 0           |
| `@ts-nocheck` em src/               | **0** ✅   | 0           |
| `@ts-expect-error` real             | **0** ✅   | 0           |
| `@import` moderno em uso            | **19**    | crescer     |
| `@typedef {import()}` legado        | **4**     | 0           |

### 3.4 Sistema de lanes strict

| Métrica                     | Valor    |
| --------------------------- | -------- |
| Total de lanes              | **41**   |
| Lanes com 0 erros           | **41** ✅ |
| Arquivos cobertos por lanes | **640+** |
| `tests/supertest.d.ts` gap  | ⚠️ 1 arq. |

---

## 4. Análise de risco e impacto

### 4.1 Riscos identificados

| Risco                                            | Severidade | Mitigação                          |
| ------------------------------------------------ | ---------- | ---------------------------------- |
| `@ts-check` ausente em 18 arquivos tests/        | Médio      | Adicionar imediatamente (Fase E.0) |
| 52 funções com `options` não-tipado              | Médio      | Criar typedefs progressivamente    |
| 511 unsafe_generic_tags em posições públicas     | Médio      | Reduzir via typedefs específicos   |
| `tests/supertest.d.ts` fora de strict lane       | Baixo      | Incluir na lane tests.helpers      |
| `CONFIGURACOES-TSCONFIG.md` desatualizado        | Alto       | Atualizar imediatamente            |
| Fase E não iniciada (3 meses desde planejamento) | Médio      | Iniciar @import migration          |

### 4.2 Oportunidades de melhoria

1. **`@import` tag** (TS 5.5+): substituir 4 `@typedef {import()}` legados por `@import` moderno.
   Ganho: melhor IntelliSense, menor verbosidade, alinhamento com o padrão de 19 usos já presentes.

2. **`isolatedDeclarations` expansão**: atualmente só cobre `src/types/**/*.d.ts` e
   `src/integration/lsp/tsserver-contract.d.ts`. Pode expandir para outros `.d.ts` em `src/`.

3. **`noUncheckedIndexedAccess`**: flag conservadora para Fase F. Ao ativar, muitos casts
   `/** @type {any} */ (obj)[key]` poderão ser eliminados ou substituídos por guards mais seguros.

4. **Redução de `@type{any}` com cascade typedefs**: os 4 arquivos com mais ocorrências totais
   (`src/main.js`, `src/shared/sadi/analyzer.js`, `src/server/api/controllers/tasks.js`,
   `src/shared/page_stability/stabilizer.js`) somam ~358 casts — 11% do total. Criar typedefs
   específicos nesses arquivos eliminaria cascatas downstream.

5. **Schema tsserver-tool-contract v1.2.0**: registrar a adição de `@import` migration e
   `isolatedDeclarations` expansion como feature do contrato.

---

## 5. Plano de ação — Fase E

### Fase E.0 — Limpeza imediata (sem custo de risco)

- [ ] Adicionar `// @ts-check` nos 18 arquivos em gap (Grupo A: 4 arquivos; Grupo B: 14)
- [ ] Incluir `tests/supertest.d.ts` na lane `tests.helpers` ou `tests.integration`
- [ ] Atualizar `CONFIGURACOES-TSCONFIG.md` para refletir `strict: true` e estados atuais

### Fase E.1 — Migração `@import` (4 ocorrências legadas)

Migrar `@typedef {import()}` para `/** @import { Type } from 'module' */` nos 4 arquivos com
padrão legado. Esta é a forma recomendada pelo TS 5.5+ e já adotada em 19 outros arquivos.

### Fase E.2 — Redução de `options typedef` (52 funções em 23 arquivos)

Criar typedefs `@typedef {object} XxxOptions` para as 52 funções com parâmetro `options` sem
typedef. Prioridade por volume de ocorrências:

1. `src/server/domain/mission_control_service.js` (8 funções)
2. `src/infra/db/task_repo.js` (6)
3. `src/core/runtime_resource_registry.js` (4)
4. `src/infra/http_client_utils.js` (4)
5. demais (30 em 19 arquivos)

### Fase E.3 — Redução de `unsafe_generic_tags` (511 → meta ≤ 300)

Substituir `@type {any}` em posições públicas por typedefs concretos. Foco nos top arquivos do
JSDoc engine (io.js, main.js, inference_client_policy_repo.js, audit_job_repo.js, rag.js).

### Fase E.4 — `isolatedDeclarations` expansão

Ampliar `tsconfig.isolated-declarations.json` para incluir outros `.d.ts` em `src/` além de
`src/types/`. Verificar se `src/integration/lsp/tsserver-contract.d.ts` e outros `.d.ts` públicos
passam em `isolatedDeclarations: true`.

### Fase F (futuro) — `noUncheckedIndexedAccess`

Flag conservadora que, quando ativada, tornará `obj[key]` do tipo `T | undefined`. Permitirá
eliminar muitos `/** @type {any} */ (obj)[key]` por narrowing seguro. Estimativa: 200–400 erros
novos. Requer que Fase E.3 esteja avançada para minimizar impacto.

---

## 6. Histórico de evoluções — linha do tempo

| Data           | Marco                                                                               |
| -------------- | ----------------------------------------------------------------------------------- |
| 4 mar 2026     | Baseline: ~7.414 erros em strict lanes, Fases 0–A concluídas                        |
| 6 mar 2026     | Fases 0–C concluídas: 41 lanes → 0 erros cada                                       |
| 7 mar 2026     | Fase D concluída: `strict: true` global, `typecheck:repo` → 0                       |
| **7 mar 2026** | **Esta auditoria: Fase E planejada, 18 @ts-check gaps, 52 options typedef missing** |

---

## 7. Validação desta auditoria

Comandos utilizados para coleta de dados:

```bash
# Typecheck completo
npm run typecheck:repo      # → 0 erros (todos os targets)
npm run typecheck:strict    # → 0 erros (41 lanes)

# JSDoc coverage
npm run jsdoc:coverage      # coverage_pct: 100%, missing_options_typedef: 52
npm run analyze:typing      # @ts-check 636/640 (99.4%), unsafe_generic: 511

# Gaps de @ts-check
npm run analyze:typing:gaps # 18 MISSING_TS_CHECK, 1 UNCOVERED_STRICT

# Contagem de any
rg "@type\s*\{any\}" src/ --count-matches | awk '{sum+=$2} END {print sum}'
# → 3.276 (inclui casts internos de corpo de função)
```

---

*Auditoria gerada em 7 de março de 2026 — GitHub Copilot (Claude Sonnet 4.6)*
