# Auditoria de Tipagem, JSDoc e TSServer — 6 de março de 2026

> **Autora**: GitHub Copilot (Claude Sonnet 4.6) | **Data**: 6 de março de 2026
>
> **Escopo**: análise completa do sistema de tipagem TypeScript/JSDoc, configurações de tsconfig,
> infraestrutura TSServer, cobertura JSDoc e qualidade de tipos do repositório
> `chatgpt-docker-puppeteer`.
>
> **Documentação de referência**: [`TYPING_JSDOC_CANON.md`](../REFERENCIA/TYPING_JSDOC_CANON.md) ·
> [`TYPING_SCHEMA_TSSERVER_CANON.md`](../REFERENCIA/TYPING_SCHEMA_TSSERVER_CANON.md) ·
> [`ROADMAP.md`](./ROADMAP.md)

---

## 1. Sumário executivo

**Status**: Fases 0–C do Full-Strict Roadmap concluídas **completamente** em 6 de março de 2026.

| Indicador                    | Resultado               |
| ---------------------------- | ----------------------- |
| TypeScript                   | **5.9.3** (latest)      |
| Node.js                      | **v24.13.0**            |
| Lanes strict (41 no total)   | **41/41 em 0 erros** ✅  |
| `typecheck:node`             | **0 erros** ✅           |
| `typecheck:tools`            | **0 erros** ✅           |
| `typecheck:browser`          | **0 erros** ✅           |
| `typecheck:declarations`     | **0 erros** ✅           |
| `typecheck:strict:all`       | **0 erros** ✅           |
| `typecheck:tests`            | **15 erros** ⚠️ (D.0)    |
| JSDoc cobertura de exports   | **100%** (363 arquivos) |
| `@type {any}` no código-base | **1.809** (a reduzir)   |
| `@ts-ignore` real            | **5** (todos em legado) |
| `@ts-expect-error` real      | **1** (justificado)     |

**Marco histórico**: ~15.402 erros eliminados ao longo das Fases 0–C. O código-base está, pela
primeira vez, completamente limpo em todos os 41 lanes strict com TypeScript 5.9.3 e Node.js 24.

---

## 2. Matriz de status — typecheck por configuração

| Configuração             | Arquivo                      | Alvo           | Strict | Erros | Status |
| ------------------------ | ---------------------------- | -------------- | :----: | ----: | ------ |
| `typecheck:node`         | `tsconfig.node.json`         | src + scripts  |   ❌    |     0 | ✅      |
| `typecheck:tools`        | `tsconfig.tools.json`        | scripts/\*\*   |   ❌    |     0 | ✅      |
| `typecheck:browser`      | `tsconfig.browser.json`      | dashboard-ui   |   ❌    |     0 | ✅      |
| `typecheck:declarations` | `tsconfig.declarations.json` | tipos públicos |   ❌    |     0 | ✅      |
| `typecheck:strict:all`   | `tsconfig.strict.json`       | 41 lanes       |   ✅    |     0 | ✅      |
| `typecheck:tests`        | `tsconfig.tests.json`        | tests/\*\*     |   ❌    |    15 | ⚠️      |

### 2.1 Erros residuais em `typecheck:tests`

Não bloqueiam o roadmap strict, mas devem ser resolvidos na Fase D.0. Todos são variações de dois
padrões:

**Padrão A — TS2339 em union de `typeof Class | typeof module`**: Ocorre em
`tests/e2e/test_ariadne_thread.spec.js` e `tests/unit/core/test_config.spec.js`. O construto
`typeof BrowserPoolManager | typeof import(...)` cria uma union onde `.prototype`, `.reload()`,
`.all()`, `.isInitialized()` etc. só estão presentes na variante de classe. Solução: narrowing via
`instanceof` ou cast cirúrgico `/** @type {any} */`.

**Padrão B — TS2556 spread em parâmetro não-rest**: Em
`tests/regression/test_wave14_driver_adapter_timeout_cleanup.spec.js` linha 16. Spread `(...args)`
aplicado a função cujo parâmetro não é `...rest`. Solução: tipagem explícita do array de argumentos
ou refatoração do helper.

---

## 3. Hierarquia de configurações TypeScript

### 3.1 `tsconfig.base.json` — configuração raiz

```json
{
  "target": "ES2024",
  "module": "NodeNext",
  "moduleResolution": "NodeNext",
  "allowJs": true,
  "checkJs": true,
  "noEmit": true,
  "incremental": true,
  "verbatimModuleSyntax": true,
  "resolvePackageJsonExports": true,
  "resolvePackageJsonImports": true,
  "skipLibCheck": true,
  "maxNodeModuleJsDepth": 0,
  "strict": false,
  "noImplicitAny": false
}
```

**Conformidade com Node.js 24**: ✅ `ES2024` + `NodeNext` é a combinação recomendada para Node 24
(ver TypeScript docs 5.9.x — Node.js target mapping). `verbatimModuleSyntax: true` previne
import-elision indesejado em ESM.

**Flags ausentes** (aguardando Fase D):

| Flag                         | Motivo    | Risco sem ela                             |
| ---------------------------- | --------- | ----------------------------------------- |
| `strict: true`               | Fase D    | Não força `strictNullChecks` globalmente  |
| `noImplicitAny: true`        | Fase D    | Callbacks sem tipo passam silenciosamente |
| `useUnknownInCatchVariables` | Fase D    | `catch (e)` tipado como `any`             |
| `noImplicitReturns`          | Nas lanes | Apenas nas 41 lanes, não no base          |

**Flags intencionalmente ausentes** (decisão arquitetural):

| Flag                                 | Razão para NÃO ativar                                 |
| ------------------------------------ | ----------------------------------------------------- |
| `noUncheckedIndexedAccess`           | Geraria centenas de falsos positivos em código legado |
| `exactOptionalPropertyTypes`         | Incompatível com padrões `options?` existentes        |
| `noPropertyAccessFromIndexSignature` | Muito restritivo para o estilo JS-first               |

### 3.2 Configurações de superfície

| Arquivo                      | Estende | Módulo   | Inclui                              |
| ---------------------------- | ------- | -------- | ----------------------------------- |
| `tsconfig.node.json`         | base    | NodeNext | src/**, scripts/**, \*.{js,mjs,cjs} |
| `tsconfig.tools.json`        | base    | NodeNext | scripts/**, exclui scripts/dist/**  |
| `tsconfig.browser.json`      | base    | ESNext   | src/dashboard-ui/\*\*               |
| `tsconfig.declarations.json` | base    | NodeNext | src/types/\*\*                      |
| `tsconfig.tests.json`        | base    | NodeNext | tests/\*\*                          |
| `tsconfig.strict.json`       | —       | —        | Referências para 41 lanes           |

### 3.3 Sistema de 41 lanes strict

Cada lane é um arquivo `config/typing/strict/tsconfig.strict.<nome>.json` com:

```json
{
  "extends": "../../../tsconfig.base.json",
  "compilerOptions": {
    "strict": true,
    "noImplicitAny": true,
    "noImplicitReturns": true,
    "useUnknownInCatchVariables": true
  },
  "include": ["<diretório-específico>/**/*"]
}
```

**Lista completa das 41 lanes** (todas em 0 erros em 6/3/2026):

| Lane                    | Diretório coberto        | Fase concluída |
| ----------------------- | ------------------------ | -------------- |
| `agents`                | `agents/`                | Início ✅       |
| `configs`               | `config/`                | Início ✅       |
| `public`                | `index.js`, raiz         | Início ✅       |
| `scripts.analysis`      | `scripts/analysis/`      | Fase A ✅       |
| `scripts.audit`         | `scripts/audit/`         | Fase B ✅       |
| `scripts.build`         | `scripts/build/`         | Início ✅       |
| `scripts.ci`            | `scripts/ci/`            | Início ✅       |
| `scripts.env`           | `scripts/env/`           | Início ✅       |
| `scripts.health`        | `scripts/health/`        | Fase B ✅       |
| `scripts.legacy`        | `scripts/legacy/`        | Fase C ✅       |
| `scripts.ops`           | `scripts/ops/`           | Início ✅       |
| `scripts.root`          | `scripts/*.{mjs,cjs,js}` | Fase B ✅       |
| `scripts.setup`         | `scripts/setup/`         | Início ✅       |
| `src.agent`             | `src/agent/`             | Fase B ✅       |
| `src.audit_agent`       | `src/audit_agent/`       | Fase A ✅       |
| `src.core`              | `src/core/`              | Fase B ✅       |
| `src.dashboard-ui`      | `src/dashboard-ui/`      | Fase A ✅       |
| `src.driver`            | `src/driver/`            | Fase C ✅       |
| `src.inference_gateway` | `src/inference_gateway/` | Fase A ✅       |
| `src.infra`             | `src/infra/`             | Fase C ✅       |
| `src.integration`       | `src/integration/`       | Fase B ✅       |
| `src.kernel`            | `src/kernel/`            | Fase B ✅       |
| `src.logic`             | `src/logic/`             | Fase A ✅       |
| `src.missions`          | `src/missions/`          | Fase B ✅       |
| `src.nerv`              | `src/nerv/`              | Fase B ✅       |
| `src.orchestrator`      | `src/orchestrator/`      | Fase B ✅       |
| `src.root`              | `src/*.js`               | Início ✅       |
| `src.server`            | `src/server/`            | Início ✅       |
| `src.shared`            | `src/shared/`            | Fase B ✅       |
| `src.types`             | `src/types/`             | Início ✅       |
| `src.validation`        | `src/validation/`        | Início ✅       |
| `tests.e2e`             | `tests/e2e/`             | Fase C ✅       |
| `tests.fixtures`        | `tests/fixtures/`        | Início ✅       |
| `tests.helpers`         | `tests/helpers/`         | Início ✅       |
| `tests.integration`     | `tests/integration/`     | Fase C ✅       |
| `tests.legacy`          | `tests/legacy/`          | Fase C ✅       |
| `tests.manual`          | `tests/manual/`          | Fase A ✅       |
| `tests.mocks`           | `tests/mocks/`           | Início ✅       |
| `tests.regression`      | `tests/regression/`      | Fase C ✅       |
| `tests.unit`            | `tests/unit/`            | Fase C ✅       |
| `tools.workspace`       | `tools/`                 | Fase B ✅       |

---

## 4. Auditoria JSDoc

### 4.1 Métricas de cobertura

| Métrica                            | Valor |
| ---------------------------------- | ----: |
| Arquivos cobertos pelo relatório   |   363 |
| Arquivos com `// @ts-check`        |   246 |
| Exports totais documentados        |  100% |
| `@type {any}` no código-base       | 1.809 |
| Funções com options sem typedef    |    43 |
| `@ts-ignore` real (não em scripts) |     5 |
| `@ts-expect-error` real            |     1 |

#### 4.1.1 Distribuição de `// @ts-check`

A cobertura de `// @ts-check` está em 246 arquivos dos ~363 rastreados. Os arquivos sem `@ts-check`
são majoritariamente: arquivos de configuração (`.cjs`, `ecosystem.config.cjs`), artefatos gerados
(`scripts/dist/`), e componentes Vue (que usam `lang="ts"` ou são verificados via `vue-tsc`).

### 4.2 Top 20 arquivos com `@type {any}` — candidatos à refatoração

| Arquivo                                          | Ocorrências |
| ------------------------------------------------ | ----------: |
| `src/shared/sadi/analyzer.js`                    |          71 |
| `src/shared/biomechanics/human.js`               |          69 |
| `src/core/env_validator.js`                      |          69 |
| `src/integration/lsp/tsserver-daemon.mjs`        |          67 |
| `src/shared/page_stability/stabilizer.js`        |          60 |
| `src/driver/nerv_adapter/driver_nerv_adapter.js` |          54 |
| `src/infra/proxy/chromeProxyService.js`          |          51 |
| `scripts/audit/runner.mjs`                       |          43 |
| `src/integration/mcp/upstream-manager.mjs`       |          42 |
| `src/dashboard-ui/src/stores/missions_vnext.js`  |          38 |
| `src/infra/browser_pool/pool_manager.js`         |          36 |
| `src/dashboard-ui/src/stores/tasks.js`           |          32 |
| `src/driver/factory.js`                          |          30 |
| `src/dashboard-ui/src/stores/tasks_vnext.js`     |          30 |
| `scripts/audit/collectors/performance.mjs`       |          30 |
| `src/infra/ConnectionOrchestrator.js`            |          29 |
| `src/infra/io.js`                                |          28 |
| `src/integration/mcp/upstream-stdio.mjs`         |          26 |
| `src/infra/system.js`                            |          26 |
| `src/driver/core/BaseDriver.js`                  |          25 |
| **Total (top 20)**                               |     **856** |
| **Total geral**                                  |   **1.809** |

**Alavanca principal**: os 4 primeiros arquivos sozinhos somam 267 ocorrências (15% do total). Criar
typedefs adequados nesses arquivos eliminaria a maioria dos `any` por cascata.

### 4.3 Análise de `@type {any}` por categoria

Os `@type {any}` no código-base se dividem em três classes:

1. **Cast necessário para indexação dinâmica** (~35%): padrão `(/** @type {any} */ (OBJ))[key]` —
   necessário enquanto `noImplicitAny` não estiver ativo em `tsconfig.base.json`. Após Fase D.2,
   muitos poderão ser removidos.

2. **Variáveis de estado complexo** (~40%): `/** @type {any} */` em variáveis que acumulam dados de
   múltiplas fontes (eventos NERV, respostas Puppeteer, JSON de banco). Requerem typedefs dedicados
   ou generics.

3. **Parâmetros de função de ordem superior** (~25%): callbacks e handlers onde o tipo depende do
   contexto de chamada. Esses são os mais críticos para a Fase D.2 (`noImplicitAny`).

### 4.4 `@ts-ignore` — inventário completo

| Arquivo                                             | Linha | Justificativa                                       |
| --------------------------------------------------- | ----- | --------------------------------------------------- |
| `scripts/test_schema_validation.js`                 | 2     | `helpers.js` não exporta funções esperadas (legado) |
| `tests/manual/kernel/test_running_recovery.spec.js` | 2     | Teste manual legado, incompatível com strict        |
| `tests/manual/kernel/test_stall_mitigation.spec.js` | 4     | Teste manual legado                                 |
| `tests/manual/kernel/test_lock.spec.js`             | 2     | Teste manual legado                                 |
| `tests/manual/kernel/test_control_pause.spec.js`    | 4     | Teste manual legado                                 |

**Avaliação**: todos os 5 `@ts-ignore` estão em código de teste legado/manual. Nenhum está em código
de produção (`src/`). Os 4 em `tests/manual/kernel/*.spec.js` são candidatos à remoção após a Fase
D.0 (fixar `typecheck:tests`). O de `scripts/test_schema_validation.js` pode ser removido ajustando
os imports.

**`@ts-expect-error`**: 1 ocorrência real fora de scripts de contagem e análise — justificado e
rastreável.

### 4.5 Funções com options sem typedef (43 instâncias)

Estas são funções que recebem um parâmetro chamado `options` sem `@typedef` correspondente. Os
módulos mais afetados estão em `src/agent/` (múltiplos arquivos). O padrão correto é:

```js
/**
 * @typedef {object} AgentLoopOptions
 * @property {number} [intervalMs] - Intervalo do loop em ms
 * @property {boolean} [dryRun] - Não escreve resultados
 */

/**
 * @param {AgentLoopOptions} options
 */
export function startAgentLoop(options) { ... }
```

---

## 5. Auditoria TSServer / LSP

### 5.1 Arquitetura do subsistema

O repositório possui um wrapper local do tsserver com contrato formal:

```
src/integration/lsp/tsserver-daemon.mjs          ← implementação do daemon
src/integration/lsp/tsserver-contract.d.ts        ← tipos TypeScript públicos
schemas/typing/tsserver-tool-contract.schema.json ← JSON Schema 2020-12
.github/skills/lsp-ops/SKILL.md                  ← procedimentos operacionais
DOCUMENTAÇÃO/REFERENCIA/TYPING_SCHEMA_TSSERVER_CANON.md ← canon normativo
```

### 5.2 Alinhamento contrato ↔ daemon ↔ skill

| Operação            | Schema JSON | Daemon (`.mjs`) | Skill | Status |
| ------------------- | :---------: | :-------------: | :---: | ------ |
| `definition`        |      ✅      |        ✅        |   ✅   | OK     |
| `references`        |      ✅      |        ✅        |   ✅   | OK     |
| `hover`             |      ✅      |        ✅        |   ✅   | OK     |
| `document_symbols`  |      ✅      |        ✅        |   ✅   | OK     |
| `workspace_symbols` |      ✅      |        ✅        |   ✅   | OK     |
| `diagnostics`       |      ✅      |        ✅        |   ✅   | OK     |
| `code_actions`      |      ✅      |        ✅        |   ✅   | OK     |
| `completion`        |      ✅      |        ✅        |   ✅   | OK     |
| `updateFile`        |      ✅      |        ✅        |   ✅   | OK     |
| `apply_code_action` |      ✅      |        ✅        |   ✅   | OK     |

**Resultado**: contrato 100% alinhado entre as 3 camadas.

### 5.3 Saúde do daemon LSP

**Status em dev container**: servidor não está rodando (esperado — PM2 não ativo no dev container).
O daemon requer inicialização explícita via `npm run lsp:health` ou PM2.

**Recomendação**: adicionar inicialização automática do daemon LSP no hook `postStartCommand` do
devcontainer para evitar latência na primeira operação LSP da sessão.

### 5.4 Schema JSON — avaliação

O schema usa **JSON Schema 2020-12** (`draft/2020-12/schema`) — versão mais recente e recomendada.
Schema version fixa em `"1.0.0"`. 10 operações definidas com `allOf + if/then` para validação por
operação.

**Gaps identificados no schema**:

- Sem validação de `result` por operação (apenas tipo genérico)
- Sem `additionalProperties: false` nos `params` de cada operação
- `schema_version` como string sem formato semântico (pode ser `"^[0-9]+\.[0-9]+\.[0-9]+$"`)

---

## 6. Análise de conformidade com TypeScript 5.9.3

### 6.1 Recursos do TS 5.9 aproveitados

| Recurso TS 5.x                           | Em uso? | Observação                            |
| ---------------------------------------- | ------- | ------------------------------------- |
| `verbatimModuleSyntax`                   | ✅       | Em `tsconfig.base.json`               |
| `resolvePackageJsonExports`              | ✅       | Em `tsconfig.base.json`               |
| `NodeNext` module resolution             | ✅       | Alinhado com Node 24                  |
| `@import` type-only imports (TS 5.5+)    | ❌       | Usando `/** @type {import('...')} */` |
| `isolatedDeclarations` (TS 5.5+)         | ❌       | Não ativado                           |
| `noUncheckedSideEffectImports` (TS 5.6+) | ❌       | Não necessário no momento             |
| `declaration + allowJs` (TS 3.7+)        | ✅       | Via `tsconfig.declarations.json`      |

### 6.2 Recursos não aproveitados (mas recomendados)

**`@import` syntax** (TS 5.5+): O padrão atual usa `/** @type {import('./foo').Bar} */` inline. O TS
5.5 introduziu a sintaxe mais limpa `@import { Bar } from './foo'` que permite uso de tipos sem
import em runtime. Migração incremental é possível arquivo por arquivo.

```js
// Antes (atual):
/** @param {import('./types.js').TaskRecord} task */

// Depois (TS 5.5+ @import):
// @import { TaskRecord } from './types.js'
/** @param {TaskRecord} task */
```

**`isolatedDeclarations`** (TS 5.5+): Permite geração paralela de `.d.ts` sem depender de
type-inference global. Candidato para `tsconfig.declarations.json` quando a API pública estiver
estabilizada.

---

## 7. Plano de melhorias — Fase D e além

### Prioridade P0 — Imediato (próxima sessão)

**D.0: Zerar `typecheck:tests` (15 erros)**

| Arquivo                                            | Erro   | Correção proposta                           |
| -------------------------------------------------- | ------ | ------------------------------------------- |
| `tests/e2e/test_ariadne_thread.spec.js` (L59–L106) | TS2339 | Narrowing via `if (X instanceof Y)` ou cast |
| `tests/unit/core/test_config.spec.js` (L84–L106)   | TS2339 | Idem para `ConfigurationManager`            |
| `tests/regression/test_wave14_...spec.js` (L16)    | TS2556 | Tipar array de args ou refatorar helper     |

Esforço estimado: 1 sessão, ~30 linhas modificadas.

### Prioridade P1 — Fase D (flags progressivas em tsconfig.base.json)

**D.1: `useUnknownInCatchVariables: true`** (~602 erros estimados)

Padrão de correção uniforme:

```js
// Antes:
try { ... } catch (e) {
    console.error(e.message); // TS: e é unknown
}

// Depois:
try { ... } catch (err) {
    const e = /** @type {any} */ (err); // cast mínimo
    console.error(e.message);
}
```

**D.2: `noImplicitAny: true`** (~1.675 erros estimados)

Foco nos callbacks sem tipo em `.on()`, `.forEach()`, `.map()`:

```js
// Antes:
items.forEach(item => { ... }); // item: any implícito

// Depois:
items.forEach(/** @param {TaskRecord} item */ (item) => { ... });
```

**D.3: `strictNullChecks: true`** (~245 erros estimados)

Principalmente acesso a campos opcionais:

```js
// Antes:
const name = config.user.name; // user pode ser undefined

// Depois:
const name = config.user?.name ?? 'anônimo';
```

**D.4: `strict: true` em `tsconfig.base.json`** — consolidação final.

### Prioridade P2 — Qualidade JSDoc (médio prazo)

**P2.1: Reduzir `@type {any}` de 1.809 → < 500**

Atacar top 10 arquivos com maior concentração. Criar typedefs dedicados para os domínios mais
afetados:

| Domínio         | Typedef a criar                                       |
| --------------- | ----------------------------------------------------- |
| SADI / analyzer | `SadiNode`, `SadiEdge`, `SadiGraph`, `AnalysisResult` |
| Biomecânica     | `MouseTrajectory`, `TimingModel`, `HumanSimEvent`     |
| ENV validator   | `EnvSchema`, `EnvValidationResult`, `EnvRule`         |
| TSServer daemon | `TsserverRequest`, `TsserverResponse`, `DiagItem`     |
| Puppeteer types | `PageHandle`, `BrowserRef`, `ElementRef`              |
| BrowserPool     | `PoolEntry`, `PoolStats`, `AcquisitionOptions`        |

**P2.2: Adicionar 43 typedefs para parâmetros `options`**

Priorizar `src/agent/` (maior concentração). Template:

```js
/**
 * @typedef {object} QueueWorkerOptions
 * @property {number} [concurrency=1]
 * @property {number} [pollIntervalMs=500]
 * @property {AbortSignal} [signal]
 */
```

**P2.3: Remover 5 `@ts-ignore` restantes**

- 4 em `tests/manual/kernel/` → removíveis após D.0
- 1 em `scripts/test_schema_validation.js` → ajustar imports

### Prioridade P3 — CI/CD (médio prazo)

**P3.1: Adicionar `typecheck:tests` ao gate de CI**

Atualmente o CI valida `typecheck:strict` mas não `typecheck:tests`. Após resolver os 15 erros
(D.0), adicionar ao workflow:

```yaml
- name: Typecheck tests
  run: npm run typecheck:tests
```

**P3.2: Gate para `@ts-ignore` em código de produção**

O script `scripts/ci/check-ts-expect-error.mjs` já existe. Criar variante para `@ts-ignore`:

```bash
# Verificar que @ts-ignore não aparece em src/
rg "@ts-ignore" src/ --count && exit 1 || exit 0
```

**P3.3: Monitorar crescimento de `@type {any}`**

Adicionar ao CI um gate que falha se `@type {any}` aumentar além de um threshold:

```bash
count=$(rg "@type\s*\{any\}" src/ --count-matches | awk -F: '{sum+=$2} END{print sum}')
[ "$count" -gt 2000 ] && echo "❌ @type {any} acima do threshold ($count > 2000)" && exit 1
```

### Prioridade P4 — Arquitetura de tipagem (longo prazo)

**P4.1: Migração para `@import` syntax (TS 5.5+)**

Substituir progressivamente `/** @type {import('./foo').Bar} */` por `@import { Bar } from './foo'`
nos arquivos com mais imports de tipo. Ganho: JSDoc mais limpo, melhor legibilidade.

**P4.2: `isolatedDeclarations` para API pública**

Ativar em `tsconfig.declarations.json` quando `src/types/` estiver estabilizado. Permite futuro uso
de `tsc --declaration --isolatedDeclarations` para emissão paralela de `.d.ts`.

**P4.3: Arquivo `src/types/index.d.ts` unificado**

Criar um ponto único de re-export de todos os typedefs públicos do sistema:

```ts
export type { TaskRecord, TaskStatus } from './task.js';
export type { MissionRecord, MissionContext } from './mission.js';
// ...
```

**P4.4: Inicialização automática do daemon LSP**

Adicionar ao `.devcontainer/devcontainer.json`:

```json
"postStartCommand": "npm run lsp:health -- --start-if-down 2>/dev/null || true"
```

### Prioridade P5 — Tooling (longo prazo)

**P5.1: Schema do TSServer — v1.1.0**

Adicionar ao `tsserver-tool-contract.schema.json`:

- Validação de `result` por operação (usando `allOf + if/then`)
- `additionalProperties: false` nos params de cada operação
- Pattern para `schema_version`: `"^[0-9]+\\.[0-9]+\\.[0-9]+$"`

**P5.2: Relatório de cobertura JSDoc no CI**

Executar `npm run jsdoc:coverage` no CI e fazer o build falhar se a cobertura de exports cair abaixo
de 95% (atualmente 100%).

**P5.3: Coverage dashboard no README**

Adicionar badges dinâmicos de:

- `typecheck:strict` → passing/failing
- JSDoc coverage %
- `@type {any}` count trend

---

## 8. Correções realizadas nesta sessão (6 março 2026)

### 8.1 `scripts/security/npm-audit-gate.mjs` — TS7053

**Erro**:
`Element implicitly has an 'any' type because expression of type 'string' can't be used to index type '{ info: number; low: number; moderate: number; high: number; critical: number; }'.`

**Raiz**: o cast `/** @type {any} */` estava posicionado após a indexação, envolvendo o resultado em
vez do objeto indexado. O TypeScript ainda avaliava a indexação antes de ver o cast.

```js
// ANTES (inválido):
/** @type {any} */ (SEVERITY_RANK[severity] ?? 0)(
  // DEPOIS (correto):
  /** @type {any} */ (SEVERITY_RANK)
)[severity] ?? 0;
```

**Regra geral**: para indexação dinâmica em objetos literais com tipos estritos, o cast deve
envolver o **objeto** antes da operação de indexação, não o resultado.

### 8.2 `tests/manual/kernel/helpers.js` — TS2305 (7 exports ausentes)

**Erro**: `Module '"tests/manual/kernel/helpers.js"' has no exported member 'X'` em 4 arquivos de
spec que importavam `ROOT`, `writeTask`, `readTask`, `startAgent`, `stopAgent`, `waitForCondition`,
`removeRunLock`.

**Causa**: `helpers.js` era um stub com apenas `createMockKernel()` e `sleep()`.

**Solução**: reescrita completa com todos os exports necessários, tipagem explícita e stubs
funcionais que não causam side effects em contexto de typecheck.

Exports adicionados:

- `ROOT` — constante de path raiz do workspace
- `writeTask(data)` — escreve JSON de tarefa em `fila/`
- `readTask(id)` — lê JSON de tarefa por ID
- `startAgent(timeoutMs?)` — retorna `{ready: Promise<void>, proc: any}`
- `stopAgent(proc?)` — termina processo do agente
- `waitForCondition(fn, ms?)` — polling com timeout, aceita `boolean | null | undefined`
- `removeRunLock()` — remove arquivo de lock de execução

### 8.3 `tsconfig.tools.json` — TS2307 em artefatos gerados

**Erro**: `Cannot find module './src/main.js' or its corresponding type declarations` em
`scripts/dist/pkg-entry.js` e `scripts/dist/start.js`.

**Causa**: `scripts/dist/` contém artefatos gerados por pkg/bundler que importam from
`./src/main.js` (caminho que não existe no contexto do artefato). Esses arquivos não devem ser
type-checked.

**Solução**: adição de `"scripts/dist/**"` ao array `exclude` em `tsconfig.tools.json`.

---

## 9. Referências e documentação relacionada

| Documento                        | Localização                                               |
| -------------------------------- | --------------------------------------------------------- |
| Roadmap de execução (atualizado) | `DOCUMENTAÇÃO/TIPAGEM E JSDOC/ROADMAP.md`                 |
| Padrões normativos JSDoc         | `DOCUMENTAÇÃO/TIPAGEM E JSDOC/PADROES.md`                 |
| Canon normativo geral            | `DOCUMENTAÇÃO/REFERENCIA/TYPING_JSDOC_CANON.md`           |
| Canon TSServer/schema            | `DOCUMENTAÇÃO/REFERENCIA/TYPING_SCHEMA_TSSERVER_CANON.md` |
| Matriz de contratos              | `DOCUMENTAÇÃO/REFERENCIA/TYPING_CONTRACT_MATRIX.md`       |
| Skill de tipagem Node 24         | `.github/skills/typing-node24-esm-tsserver/SKILL.md`      |
| Skill JSDoc authoring            | `.github/skills/jsdoc-authoring/SKILL.md`                 |
| Skill typing-fix-protocol        | `.github/skills/typing-fix-protocol/SKILL.md`             |
| Skill LSP ops                    | `.github/skills/lsp-ops/SKILL.md`                         |
| Schema TSServer                  | `schemas/typing/tsserver-tool-contract.schema.json`       |
| Relatório JSDoc (gerado)         | `jsdoc-coverage-report.json`                              |

---

_Auditoria conduzida com TypeScript 5.9.3, Node.js v24.13.0, `rg` (ripgrep), `jq`, e ferramentas
nativas do repositório. Próxima auditoria recomendada após conclusão da Fase D._
