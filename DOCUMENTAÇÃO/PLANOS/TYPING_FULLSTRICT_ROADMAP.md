# Roadmap — JSDoc Completo + Full Strict em 100% do Repositório

## Contexto e baseline

### Estado real medido na auditoria (3 mar 2026)

| Dimensão                  | Estado atual                                               |
| ------------------------- | ---------------------------------------------------------- |
| `@ts-check` (sem legacy)  | 611 / 626 = **97,6 %** — 15 arquivos ativos faltando       |
| `@ts-check` (legacy)      | 0 / 14 — todos em quarentena sem check                     |
| JSDoc presença            | 1.106 / 1.106 = **100 %** ✅                                |
| `@param` completo         | 543 / 677 = **80,2 %** — **134 faltando**                  |
| `options typedef`         | 506 / 677 = **74,7 %** — **171 faltando**                  |
| `unsafe_generic_tags`     | **586 tags** (`any`, `Object`, `Array`, `Promise<any>`)    |
| Lanes strict operacionais | 8 lanes cobrindo ~**20 arquivos** de produção (simbólico)  |
| Dashboard type checking   | **zero** — sem `tsconfig.json`, sem `vue-tsc`              |
| `tsconfig.tests.json`     | cobre **7 de 200+** arquivos de teste                      |
| `tsconfig.tools.json`     | lista explícita de **14 arquivos** (não glob)              |
| `tsconfig.base.json`      | `strict: false` — base inteira permissiva                  |
| Maior backlog individual  | `src/infra` (73 param + 58 typedef + 187 unsafe = **318**) |
| Módulos zero-gap          | `src/audit_agent`, `src/inference_gateway`, `src/shared`   |

### Backlog JSDoc por módulo

| Módulo             | missing_param | missing_typedef | unsafe_generic | Total   |
| ------------------ | ------------- | --------------- | -------------- | ------- |
| `src/infra`        | **73**        | **58**          | **187**        | **318** |
| `scripts/audit`    | 0             | **30**          | **91**         | 121     |
| `src/server`       | **28**        | **20**          | 38             | 86      |
| `src/core`         | 3             | 10              | **69**         | 82      |
| `src/agent`        | 6             | 12              | 37             | 55      |
| `src/nerv`         | 1             | **23**          | 22             | 46      |
| `src/integration`  | 2             | 7               | 20             | 29      |
| `src/dashboard-ui` | 8             | 6               | 10             | 24      |
| `tests/helpers`    | 6             | 1               | 5              | 12      |
| `src/driver`       | 0             | 0               | 18             | 18      |
| `src/kernel`       | 0             | 1               | 7              | 8       |
| `src/logic`        | 1             | 1               | 7              | 9       |
| **Total**          | **134**       | **171**         | **586**        | **891** |

### Decisões incorporadas

- **`tests/legacy/`**: entra em cobertura total com `@ts-check`; erros irrecuperáveis suprimidos com
  `// @ts-ignore` + comentário justificativo — nunca silenciados sem explicação.
- **Flags strict extras** (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`): não entram
  agora — avaliados apenas na Fase 5, após o backlog principal fechar.
- **Execução**: fase a fase, com critério de saída verificável antes de avançar.

### Meta final simultânea

1. `@ts-check` = 100 % em todos os `.js/.mjs/.cjs` elegíveis + `vue-tsc` cobre todos os `.vue`
2. `functions_missing_param_tags = 0`, `functions_missing_options_typedef = 0`,
   `unsafe_generic_tags_total = 0`, `public_any_tags_total = 0`
3. `tsconfig.base.json` com `strict: true` e todos os typechecks passando com strict real herdado

---

## Fase 0 — Instrumentação do gap real

**Objetivo**: tornar impossível "achar que está 100 %" sem estar.

### Tarefas

- [ ] Expandir `scripts/analysis/typing_hardening_audit.mjs`:
  - [ ] Emitir `strict_uncovered_files_total` + `strict_uncovered_files[]`
  - [ ] Emitir `js_files_missing_ts_check_total` + `js_files_missing_ts_check[]`
  - [ ] Atualizar `AREA_THRESHOLDS.overall` de `90` → `100`
- [ ] Expandir `scripts/analysis/jsdoc_coverage_engine.mjs` e
      `scripts/analysis/jsdoc_coverage_cli.mjs`:
  - [ ] Adicionar `public_any_tags_total` e `public_unknown_tags_total` explicitamente no topo do
        relatório
  - [ ] Implementar flag `--gaps` que lista símbolos bloqueadores por lote (saída executável)
  - [ ] Bump de schema para `3.1.0`
- [ ] Atualizar `schemas/typing/jsdoc-coverage-report.schema.json` com os novos campos
      (`public_any_tags_total`, `public_unknown_tags_total`, `strict_uncovered_files_total`)
- [ ] Adicionar scripts no `package.json`:
  - [ ] `analyze:typing:gaps` →
        `node scripts/analysis/typing_hardening_audit.mjs --format console     --show-gaps`
  - [ ] `jsdoc:coverage:gaps` →
        `node scripts/analysis/jsdoc_coverage_cli.mjs --scope full --format     console --gaps`
- [ ] Classificar os 14 arquivos de `tests/legacy/` como gap explícito na auditoria (não ignorados,
      não fora de escopo)

### Critério de saída da Fase 0

- [ ] `analyze:typing:gaps` lista exatamente os 29 arquivos sem check (15 ativos + 14 legacy)
- [ ] `jsdoc:coverage:gaps` lista todos os 891 issues abertos
- [ ] Schema validado na versão `3.1.0`

---

## Fase 1 — Cobertura total de superfície

**Objetivo**: todo arquivo elegível entra em algum verificador; nenhum código rastreado fica fora do
radar.

### Tarefas — `@ts-check`

- [ ] Adicionar `// @ts-check` nos **15 arquivos ativos** sem cobertura:
  - [ ] `scripts/analysis/analyze-code-graph.js`
  - [ ] `scripts/analysis/audit-tmp-scripts.js`
  - [ ] `scripts/health/test-health-logic.js`
  - [ ] `scripts/ops/rotate-profiles.js`
  - [ ] `scripts/validate_config.js`
  - [ ] `tests/e2e/test_ariadne_thread.spec.js`
  - [ ] `tests/e2e/test_boot_sequence.spec.js`
  - [ ] `tests/e2e/test_integration_complete.spec.js`
  - [ ] `tests/integration/rag/test_multi_llm_integration.spec.js`
  - [ ] `tests/manual/test_chrome_proxy_integration.js`
  - [ ] `tests/unit/agent/test_artifacts_attempts.spec.js`
  - [ ] `tests/unit/agent/test_ssot_consolidation.spec.js`
  - [ ] `tests/unit/agent/test_ssot_orchestration_worker.spec.js`
  - [ ] `tests/unit/nerv/test_envelope.spec.js`
  - [ ] `tests/unit/server/test_api_workflow_results_breaking.spec.js`
- [ ] Adicionar `// @ts-check` nos **14 arquivos de `tests/legacy/`**; suprimir erros irrecuperáveis
      com `// @ts-ignore` + comentário justificando (proibido suprimir sem contexto)

### Tarefas — tsconfigs

- [ ] **`tsconfig.tools.json`**: substituir lista de 14 arquivos explícitos por
      `include: ["scripts/**/*"]` com `exclude` padronizado para `dist/`, `coverage/`, `tmp/`,
      `node_modules/`
- [ ] **`tsconfig.tests.json`**: substituir lista de 7 arquivos por `include: ["tests/**/*"]` com
      exclude adequado
- [ ] **`tsconfig.node.json`**: remover os 7 arquivos de scripts que sobrepõem com
      `tsconfig.tools.json` — cobrir apenas `src/**/*` + `*.config.*` + `.puppeteerrc.cjs`

### Tarefas — Dashboard Vue

- [ ] Instalar no workspace `src/dashboard-ui`:
  ```
  npm install -D vue-tsc @vue/tsconfig --workspace src/dashboard-ui
  ```
- [ ] Criar `src/dashboard-ui/tsconfig.json`:
  - `extends: "@vue/tsconfig/tsconfig.dom.json"`
  - `compilerOptions.strict: true`, `verbatimModuleSyntax: true`, `allowImportingTsExtensions: true`
  - `include: ["src/**/*.ts", "src/**/*.d.ts", "src/**/*.tsx", "src/**/*.vue", "src/**/*.js"]`
- [ ] Adicionar `typecheck:dashboard` no `package.json` raiz:
  ```
  npm --workspace src/dashboard-ui exec -- vue-tsc --noEmit -p src/dashboard-ui/tsconfig.json
  ```
- [ ] Expandir `typecheck:repo` para incluir `typecheck:dashboard`
- [ ] Tipar configs do dashboard:
  - [ ] `src/dashboard-ui/vite.config.js`: `@ts-check` + `import { defineConfig } from 'vite'`
  - [ ] `src/dashboard-ui/tailwind.config.js`: `/** @type {import('tailwindcss').Config} */`
  - [ ] `src/dashboard-ui/postcss.config.js`: `/** @type {Record<string, object>} */`

### Critério de saída da Fase 1

- [ ] `@ts-check` = 100 % em todos os `.js/.mjs/.cjs` elegíveis
- [ ] `typecheck:dashboard` executa `vue-tsc --noEmit` sem pânico de config ausente
- [ ] `typecheck:repo` (expandido) passa por todas as superfícies
- [ ] `strict_uncovered_files_total = 0` (todo arquivo ativo em algum config)

---

## Fase 2 — Fechamento do backlog JSDoc por pasta

**Objetivo**: zerar os três indicadores de qualidade em cada pasta antes de avançar para a próxima.

### Regras de execução (skill `jsdoc-authoring`)

- Nenhum `Object`, `Array`, `Function`, `Promise<any>` em tag pública quando o shape é conhecível
- Typedef local para options object com 1 uso; promoção para `src/types/**` somente quando
  compartilhado em 2+ módulos distintos
- Usar `@import` quando o tipo já existe em outro arquivo
- `@template` apenas quando a API é genuinamente genérica
- `@satisfies` para object literals que devem satisfazer um tipo compartilhado sem widening
- Nunca alterar comportamento de runtime para simplificar a documentação

### Ordem obrigatória (maior backlog primeiro)

#### 1. `src/infra` — 318 issues

- [ ] Missing `@param` (73 funções): documentar todos os parâmetros com tipo explícito
- [ ] Missing `options typedef` (58 funções): criar `@typedef {object} NomeDaOpcaoOptions` local ou
      importar de `src/types/infra/augmentations.d.ts`
- [ ] `unsafe_generic` (187 tags): substituir `Object`/`Array` por `Record<string, unknown>`, unions
      ou interfaces locais
- [ ] Critério de saída: `missing_param = 0 && missing_typedef = 0 && unsafe_generic = 0` em
      `src/infra`

#### 2. `scripts/audit` — 121 issues

- [ ] Missing `options typedef` (30 funções): payloads de auditoria que usam `Object` genérico no
      `runner.mjs` e ferramentas de publish
- [ ] `unsafe_generic` (91 tags): typedefs para payloads do audit agent
- [ ] Critério de saída: `missing_typedef = 0 && unsafe_generic = 0` em `scripts/audit`

#### 3. `src/server` — 86 issues

- [ ] Missing `@param` (28 funções): rotas e middlewares Express com params não tipados
- [ ] Missing `options typedef` (20 funções): options de Socket.io e configurações de servidor
- [ ] `unsafe_generic` (38 tags)
- [ ] Critério de saída: três indicadores em zero em `src/server`

#### 4. `src/nerv` — 46 issues

- [ ] Missing `options typedef` (23 funções): payloads de eventos NERV usando `Object` genérico →
      criar typedefs de evento em `src/types/nerv/augmentations.d.ts`
- [ ] `unsafe_generic` (22 tags)
- [ ] Critério de saída: três indicadores em zero em `src/nerv`

#### 5. `src/agent` — 55 issues

- [ ] Missing `@param` (6 funções)
- [ ] Missing `options typedef` (12 funções): workers com callbacks e payloads genéricos
- [ ] `unsafe_generic` (37 tags)
- [ ] Critério de saída: três indicadores em zero em `src/agent`

#### 6. `src/core` — 82 issues

- [ ] Missing `@param` (3 funções)
- [ ] Missing `options typedef` (10 funções)
- [ ] `unsafe_generic` (69 tags): atenção — 158 exports, maioria constantes; verificar se
      `unsafe_generic` vêm de enums/constantes com tipo fraco
- [ ] Critério de saída: três indicadores em zero em `src/core`

#### 7. `src/integration` — 29 issues

- [ ] Missing `@param` (2 funções)
- [ ] Missing `options typedef` (7 funções)
- [ ] `unsafe_generic` (20 tags)
- [ ] Critério de saída: três indicadores em zero em `src/integration`

#### 8. `src/dashboard-ui` — 24 issues

- [ ] Missing `@param` (8 funções): componentes Vue com props não tipadas
- [ ] Missing `options typedef` (6 funções): stores Pinia com estado genérico
- [ ] `unsafe_generic` (10 tags)
- [ ] Critério de saída: três indicadores em zero em `src/dashboard-ui`

#### 9. Backlog menor

- [ ] `tests/helpers` (6 param + 1 typedef + 5 unsafe)
- [ ] `scripts/analysis` — scripts de auditoria com tags genéricas
- [ ] `scripts/env`, `scripts/ops`
- [ ] Restos pontuais: `src/driver` (18 unsafe), `src/kernel` (8), `src/logic` (9)

### Critério de saída da Fase 2 (via `jsdoc:coverage:json`)

- [ ] `functions_missing_param_tags = 0`
- [ ] `functions_missing_options_typedef = 0`
- [ ] `unsafe_generic_tags_total = 0`

---

## Fase 3 — Substituição das lanes simbólicas por lanes reais

**Objetivo**: trocar os 8 arquivos-âncora simbólicos por lanes cobrindo subtrees completos.

### Estrutura das novas lanes

Todas as lanes herdam da config de família correspondente com:

```json
{
  "compilerOptions": {
    "strict": true,
    "noImplicitAny": true,
    "noImplicitReturns": true,
    "useUnknownInCatchVariables": true,
    "composite": true
  }
}
```

#### Lanes `src/**` — herdam de `tsconfig.node.json`

- [ ] `tsconfig.strict.src.agent.json` → `include: ["src/agent/**/*"]`
- [ ] `tsconfig.strict.src.audit_agent.json` → `include: ["src/audit_agent/**/*"]`
- [ ] `tsconfig.strict.src.core.json` → `include: ["src/core/**/*"]` _(substitui âncora)_
- [ ] `tsconfig.strict.src.driver.json` → `include: ["src/driver/**/*"]`
- [ ] `tsconfig.strict.src.inference_gateway.json` → `include: ["src/inference_gateway/**/*"]`
- [ ] `tsconfig.strict.src.infra.json` → `include: ["src/infra/**/*"]` _(substitui âncora)_
- [ ] `tsconfig.strict.src.integration.json` → `include: ["src/integration/**/*"]` _(substitui
      âncora)_
- [ ] `tsconfig.strict.src.kernel.json` → `include: ["src/kernel/**/*"]`
- [ ] `tsconfig.strict.src.logic.json` → `include: ["src/logic/**/*"]`
- [ ] `tsconfig.strict.src.missions.json` → `include: ["src/missions/**/*"]`
- [ ] `tsconfig.strict.src.nerv.json` → `include: ["src/nerv/**/*"]`
- [ ] `tsconfig.strict.src.orchestrator.json` → `include: ["src/orchestrator/**/*"]`
- [ ] `tsconfig.strict.src.server.json` → `include: ["src/server/**/*"]` _(substitui âncora)_
- [ ] `tsconfig.strict.src.shared.json` → `include: ["src/shared/**/*"]`
- [ ] `tsconfig.strict.src.types.json` → `include: ["src/types/**/*"]`
- [ ] `tsconfig.strict.src.validation.json` → `include: ["src/validation/**/*"]`
- [ ] `tsconfig.strict.src.root.json` → `files: ["src/main.js", ...]` para arquivos avulsos em
      `src/`

#### Lanes `scripts/**` — herdam de `tsconfig.tools.json`

- [ ] `tsconfig.strict.scripts.analysis.json`
- [ ] `tsconfig.strict.scripts.audit.json`
- [ ] `tsconfig.strict.scripts.ci.json`
- [ ] `tsconfig.strict.scripts.build.json`
- [ ] `tsconfig.strict.scripts.env.json`
- [ ] `tsconfig.strict.scripts.health.json`
- [ ] `tsconfig.strict.scripts.ops.json`
- [ ] `tsconfig.strict.scripts.setup.json`
- [ ] `tsconfig.strict.scripts.legacy.json`
- [ ] `tsconfig.strict.scripts.root.json`

#### Lanes `tests/**` — herdam de `tsconfig.tests.json`

- [ ] `tsconfig.strict.tests.unit.json`
- [ ] `tsconfig.strict.tests.integration.json`
- [ ] `tsconfig.strict.tests.regression.json`
- [ ] `tsconfig.strict.tests.e2e.json`
- [ ] `tsconfig.strict.tests.helpers.json`
- [ ] `tsconfig.strict.tests.fixtures.json`
- [ ] `tsconfig.strict.tests.mocks.json`
- [ ] `tsconfig.strict.tests.manual.json`
- [ ] `tsconfig.strict.tests.legacy.json`

#### Configs de raiz

- [ ] `tsconfig.strict.configs.json` → configs de raiz (`*.config.*`, `.puppeteerrc.cjs`) + configs
      do dashboard

#### Solution file e scripts

- [ ] Atualizar `tsconfig.strict.json` para referenciar todas as novas lanes
- [ ] Remover âncoras antigas assim que a lane real da mesma família estiver verde
- [ ] Atualizar scripts `typecheck:strict:*` no `package.json` — um por lane nova
- [ ] Atualizar `typecheck:strict:all` como cadeia completa de todas as lanes

### Critério de saída da Fase 3

- [ ] `tsconfig.strict.json` referencia somente lanes com subtree real
- [ ] `strict_uncovered_files_total = 0` (todo arquivo ativo em alguma lane)
- [ ] Nenhuma lane com um único arquivo-âncora simbólico

---

## Fase 4 — Remediação strict por domínio

**Objetivo**: corrigir erros de `tsc -p tsconfig.strict.src.<dominio>.json` em cada lane até zero.

### Estratégia técnica (skill `typing-node24-esm-tsserver`)

- Substituir `any` por: unions, `Record<string, unknown>`, typedefs locais, tipos importados, guards
  explícitos
- Manter `unknown` apenas em bordas inseguras com narrowing no mesmo módulo
- Promover para `src/types/**` somente quando o tipo for compartilhado em 2+ módulos distintos
- Usar `@import` quando o tipo já existe em outro arquivo
- SFCs Vue: migrar para `<script setup lang="ts">` onde `vue-tsc` exigir
- **Proibido**: enfraquecer lanes strict para esconder erros; usar `@ts-ignore` sem comentário

### Ordem de execução (mesma da Fase 2)

- [ ] `src/infra`
- [ ] `src/server`
- [ ] `src/agent` + `src/core`
- [ ] `src/nerv`
- [ ] `src/integration`
- [ ] `scripts/audit`
- [ ] `scripts` restantes
- [ ] `tests`
- [ ] `dashboard-ui`
- [ ] `legacy`

### Critério de saída da Fase 4

- [ ] Cada lane strict passa isoladamente: `tsc -p tsconfig.strict.src.<dominio>.json` sem erros
- [ ] `typecheck:strict:all` passa como agregador completo

---

## Fase 5 — Convergência da base para strict verdadeiro

**Objetivo**: eliminar a dualidade "base permissiva + strict paralelo".

### Tarefas

- [ ] Adicionar ao `tsconfig.base.json`:
  ```json
  {
    "compilerOptions": {
      "strict": true,
      "noImplicitAny": true,
      "noImplicitReturns": true,
      "useUnknownInCatchVariables": true
    }
  }
  ```
- [ ] Remover overrides redundantes nos configs derivados (as lanes que já explicitavam essas flags
      podem simplificar)
- [ ] Verificar (e corrigir) que `typecheck:node`, `typecheck:tools`, `typecheck:tests`,
      `typecheck:browser` passam com strict herdado da base
- [ ] **Avaliar agora** adicionar `noUncheckedIndexedAccess` e `exactOptionalPropertyTypes` — com o
      backlog zerado, o risco de regressão é mínimo
- [ ] Atualizar `DOCUMENTAÇÃO/REFERENCIA/TYPING_JSDOC_CANON.md` refletindo que a base agora é
      estrita

### Critério de saída da Fase 5

- [ ] `tsconfig.base.json` com `strict: true`
- [ ] `typecheck:node`, `typecheck:tools`, `typecheck:tests`, `typecheck:browser` todos verdes com
      strict por herança
- [ ] Nenhum config de uso regular depende de `strict: false`

---

## Fase 6 — Declaration emit completo da superfície pública

**Objetivo**: a API pública de `src/**` emite declarações usáveis e precisas sem `any` evitável.

### Tarefas

- [ ] Expandir `tsconfig.declarations.json` dos 2 arquivos atuais para toda a superfície pública
      Node-side relevante:
  - [ ] Adicionar `src/shared/**`
  - [ ] Adicionar `src/inference_gateway/**`
  - [ ] Adicionar `src/audit_agent/**`
  - [ ] Adicionar `src/server/api/**`
  - [ ] Adicionar `src/integration/lsp/**`
  - [ ] Adicionar demais módulos com API consumível externamente
  - [ ] Manter `exclude: ["src/dashboard-ui/**"]`
- [ ] Corrigir tipos inferidos fracos nos `.d.ts` gerados em `tmp/types-public/`:
  - [ ] `any` em retorno → tipo real via JSDoc
  - [ ] Shapes vagos em parâmetros → typedef local ou promoção para `src/types/**`

### Critério de saída da Fase 6

- [ ] `typecheck:declarations` verde
- [ ] `.d.ts` emitido em `tmp/types-public/` sem `any` evitável em APIs públicas

---

## Fase 7 — CI final bloqueante de 100 %

**Objetivo**: congelar o estado final como contrato permanente de merge.

### Expansão do workflow `jsdoc-typing.yml` — de 10 para 12 checks

| #   | Check                       | Comando                                                    |
| --- | --------------------------- | ---------------------------------------------------------- |
| 1   | `typecheck-repo`            | `npm run typecheck:repo` (já inclui dashboard)             |
| 2   | `typecheck-strict-all`      | `npm run typecheck:strict:all` (lanes reais)               |
| 3   | `typecheck-declarations`    | `npm run typecheck:declarations`                           |
| 4   | `typecheck-dashboard`       | `npm run typecheck:dashboard`                              |
| 5   | `jsdoc-coverage`            | `jsdoc:coverage:json -- --validate-schema`                 |
| 6   | `jsdoc-coverage-gaps`       | `jsdoc:coverage:json -- --gaps --fail-on-any-gap`          |
| 7   | `check-schemas`             | `npm run check:schemas:typing`                             |
| 8   | `analyze-typing`            | `npm run analyze:typing:json`                              |
| 9   | `analyze-tsserver-contract` | `npm run analyze:tsserver-contract`                        |
| 10  | `check-skills`              | `npm run check:skills:strict`                              |
| 11  | `check-ts-expect-error`     | script que conta `@ts-expect-error` e falha se > allowlist |
| 12  | `check-base-strict`         | script que verifica `strict: true` em `tsconfig.base.json` |

### Tarefas

- [ ] Atualizar `.github/workflows/jsdoc-typing.yml` com os 2 checks novos (11 e 12)
- [ ] Criar `scripts/ci/check-ts-expect-error.mjs` — conta instâncias de `@ts-expect-error` fora de
      allowlist formal; falha se `count > 0` (ou > threshold da allowlist)
- [ ] Criar `scripts/ci/check-base-strict.mjs` — verifica que `tsconfig.base.json` tem
      `strict:     true`; falha se ausente ou `false`
- [ ] Adicionar `issues: write` + `pull-requests: write` ao job se PR comments forem adicionados
      (padrão já estabelecido nos outros workflows)
- [ ] Atualizar `DOCUMENTAÇÃO/REFERENCIA/TYPING_AUTOMATION_INDEX.md` com os novos gates e scripts

### Critério de saída da Fase 7

- [ ] Todo PR que degradar qualquer das 12 métricas falha na CI
- [ ] `@ts-expect-error = 0` em estado limpo do repositório
- [ ] Gates permanentes e automatizados sem intervenção manual

---

## Verificação de encerramento do programa

O programa está encerrado quando as **três condições** forem simultaneamente verdadeiras e todos os
gates de CI estiverem verdes:

- [ ] **Condição 1 — Cobertura**: `@ts-check` = 100 % em todos os `.js/.mjs/.cjs` elegíveis _e_
      `vue-tsc` cobre todos os `.vue` do dashboard sem erros
- [ ] **Condição 2 — Qualidade JSDoc**: `functions_missing_param_tags = 0`,
      `functions_missing_options_typedef = 0`, `unsafe_generic_tags_total = 0`,
      `public_any_tags_total = 0`
- [ ] **Condição 3 — Strict real**: `tsconfig.base.json` com `strict: true` _e_ todos os typechecks
      (`typecheck:node`, `typecheck:tools`, `typecheck:tests`, `typecheck:browser`,
      `typecheck:dashboard`, `typecheck:strict:all`, `typecheck:declarations`) passando com strict
      por herança da base

---

## Referências técnicas

- TypeScript `strict`: <https://www.typescriptlang.org/tsconfig/strict.html>
- TypeScript `allowJs`: <https://www.typescriptlang.org/tsconfig/allowJs.html>
- TypeScript `checkJs`: <https://www.typescriptlang.org/tsconfig/checkJs.html>
- TypeScript `composite`: <https://www.typescriptlang.org/tsconfig/composite.html>
- TSConfig Reference: <https://www.typescriptlang.org/tsconfig/>
- Vue + TypeScript: <https://vuejs.org/guide/typescript/overview.html>
- Vite config typing: <https://vite.dev/config/>
- Documentação canônica local: `DOCUMENTAÇÃO/REFERENCIA/TYPING_JSDOC_CANON.md`
- Skill JSDoc: `.github/skills/jsdoc-authoring/SKILL.md`
- Skill Typing: `.github/skills/typing-node24-esm-tsserver/SKILL.md`
- Plano anterior (Fase 2): `DOCUMENTAÇÃO/PLANOS/TYPING_PHASE2_HARDENING_PLAN.md`
