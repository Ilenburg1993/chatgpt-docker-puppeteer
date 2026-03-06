# Typing Full-Strict Roadmap — Redirecionamento

> **Este documento foi consolidado.** O roadmap ativo agora vive em:
>
> **[`../TIPAGEM E JSDOC/ROADMAP.md`](../TIPAGEM%20E%20JSDOC/ROADMAP.md)**
>
> Todos os dados de baseline, checklist de fases e estimativas estão lá. O hub completo está em
> `DOCUMENTAÇÃO/TIPAGEM E JSDOC/`.

> **Status de governança**: Este documento é atualizado a cada sessão de trabalho. Todo tick ✅
> exige que o código correspondente esteja commitado. Nenhuma métrica é marcada verde sem evidência
> verificável.

---

## O que foi feito até aqui

Sessões anteriores aplicaram `// @ts-nocheck` em ~127 arquivos para produzir "verde falso" nas lanes
strict. Isso foi **revertido** nesta sessão: todos os arquivos agora têm `// @ts-check` ativo e
nenhum tem `// @ts-nocheck` (exceto `scripts/dist/` gerado e `.backup`).

O baseline real medido após a restauração está a seguir.

---

## Baseline real — 4 de março de 2026

### Estado geral

| Indicador                           | Valor         | Nota                                           |
| ----------------------------------- | ------------- | ---------------------------------------------- |
| Arquivos JS/MJS com `@ts-check`     | **640 / 640** | 100 % ✅ restaurado nesta sessão                |
| `functions_missing_param_tags`      | **0**         | ✅ formal — qualidade dos tipos é problema real |
| `functions_missing_options_typedef` | **0**         | ✅ formal                                       |
| `unsafe_generic_tags_total`         | **0**         | ✅ formal                                       |
| `typecheck:node` (sem strict)       | **2.170**     | Erros mesmo sem flags strict                   |
| `typecheck:strict:all`              | **7.414**     | Com flags strict nas lanes                     |

### Baseline por lane strict

| Lane                    | Erros | Fase    |
| ----------------------- | ----: | ------- | ------- |
| `src.types`             |     0 | ✅ verde |
| `agents`                |     0 | ✅ verde |
| `scripts.ci`            |     0 | ✅ verde |
| `scripts.setup`         |     0 | ✅ verde |
| `tests.helpers`         |     0 | ✅ verde |
| `scripts.build`         |     0 | ✅ verde |
| `scripts.env`           |     0 | ✅ verde |
| `src.validation`        |     0 | ✅ verde |
| `tests.mocks`           |     0 | ✅ verde |
| `src.logic`             |     2 | Fase A  |
| `scripts.analysis`      |   181 | Fase A  |
| `src.inference_gateway` |   191 | Fase A  |
| `src.dashboard-ui`      |   285 | Fase A  |
| `tests.manual`          |   300 | Fase A  |
| `src.audit_agent`       |   358 | Fase A  |
| `src.nerv`              |   439 | Fase B  | ✅ verde |
| `scripts.health`        |   441 | Fase B  | ✅ verde |
| `src.missions`          |   608 | Fase B  | ✅ verde |
| `src.shared`            |   746 | Fase B  |
| `src.orchestrator`      |   773 | Fase B  | ✅ verde |
| `src.integration`       |   924 | Fase B  |
| `scripts.audit`         |   928 | Fase B  |
| `scripts.root`          |   935 | Fase B  |
| `tools.workspace`       | 1.013 | Fase B  |
| `src.core`              | 1.053 | Fase B  |
| `src.agent`             | 1.190 | Fase B  |
| `tests.legacy`          | 1.403 | Fase C  |
| `src.kernel`            |     0 | ✅ Done  |
| `src.driver`            | 1.558 | Fase C  |
| `src.infra`             | 2.232 | Fase C  |

---

## Análise dos erros — distribuição e causas

### Distribuição global (strict:all = 7.414 erros)

| Código TS   |   Qtd | O que significa                         | Flag / causa                 |
| ----------- | ----: | --------------------------------------- | ---------------------------- |
| **TS2339**  | 3.448 | Propriedade não existe no tipo          | Nenhuma — presente sempre    |
| **TS7006**  | 1.353 | Parâmetro sem tipo (implicitly `any`)   | `noImplicitAny`              |
| **TS18046** |   602 | `catch(e)` — e é `unknown`              | `useUnknownInCatchVariables` |
| **TS7005**  |   147 | Variável sem tipo inferível             | `noImplicitAny`              |
| **TS7031**  |   101 | Binding element sem tipo                | `noImplicitAny`              |
| **TS7034**  |    74 | Elemento de array sem tipo              | `noImplicitAny`              |
| **TS2345**  |   308 | Argumento de tipo incompatível          | Cascata de TS2339            |
| **TS2322**  |   257 | Atribuição de tipo incompatível         | Cascata de TS2339            |
| **TS18047** |   220 | Valor possivelmente `null`              | `strictNullChecks`           |
| **TS18048** |    25 | Valor possivelmente `undefined`         | `strictNullChecks`           |
| **TS8032**  |   177 | JSDoc malformado (param destrutturado)  | Estrutural — não flag        |
| **TS8024**  |    37 | JSDoc @param fora de ordem              | Estrutural — não flag        |
| **outros**  |  ~665 | TS2304, TS2353, TS7053, TS2741, TS2571… | Variados                     |

### Insight central: TS2339 é o problema raiz (46% dos erros)

**3.448 dos 7.414 erros** são TS2339. Este erro dispara em **qualquer modo** — inclusive sem
`strict`. Significa que objetos não têm shape tipado e acessamos propriedades não declaradas neles.
Causas:

1. **Payloads NERV** — emitidos como `{}`, recebidos sem typedef
2. **JSON.parse()** sem anotação de tipo
3. **Parâmetros `{Object}`, `{any}`, `{*}`** — tipos vagos que o formal `param=0` não detecta
4. **Resultados de DB** sem typedef de retorno
5. **Config objects** sem shape declarado

Fixar TS2339 via typedefs é a maior alavanca: resolve ~3.448 erros sem depender de nenhuma flag
strict adicional.

---

## Análise de viabilidade das flags TypeScript

Esta é a análise de quais flags são aplicáveis ao **projeto inteiro** (JS-first, Node.js 24+, ESM).

### Flags viáveis — do mais simples ao mais complexo

| Flag                         | Erros diretos | Padrão de correção                                  | Dificuldade |
| ---------------------------- | ------------: | --------------------------------------------------- | ----------- |
| `useUnknownInCatchVariables` |           602 | `const e = /** @type {any} */ (err);` — sistemático | **Baixa**   |
| `noImplicitReturns`          |           ~30 | Adicionar `return` explícito onde falta             | **Baixa**   |
| `strictFunctionTypes`        |           ~50 | Corrigir assinaturas de callbacks incompatíveis     | **Baixa**   |
| `noImplicitAny`              |         1.675 | @param em callbacks e variáveis — sistemático       | **Média**   |
| `strictNullChecks`           |           245 | `?.`, `?? default`, guards `if (x === null)`        | **Média**   |

Após corrigir TS2339 (via typedefs — trabalho de qualidade JSDoc), as contagens acima diminuem
porque muitos TS2345/TS2322 actualmente contados como "cascata" desaparecem.

### Sequência recomendada de ativação de flags na base

```
1. [base atual]              → strict: false, checkJs: true  (baseline)
2. useUnknownInCatchVariables → 602 erros → pattern fix sistemático
3. noImplicitAny              → ~1.675 erros → @param sistemático
4. strictNullChecks           → ~245 erros → null guards
5. strict: true               → todos os anteriores + strictFunctionTypes etc.
```

### Flags NÃO recomendadas para este projeto agora

| Flag                         | Motivo                                                           |
| ---------------------------- | ---------------------------------------------------------------- |
| `noUncheckedIndexedAccess`   | Inflaria erros em todo array/object access — refatoração massiva |
| `exactOptionalPropertyTypes` | Incompatível com padrões de options-object atuais                |

---

## Plano de execução — 4 fases progressivas + preparação

### Fase 0 — Preparação: JSDoc estrutural (214 erros sem flag)

**Objetivo**: corrigir TS8032 e TS8024 que são erros de estrutura JSDoc, não de flags.

#### Padrão TS8032 — parâmetro desestruturado sem @param pai

```js
// ANTES (gera TS8032):
/**
 * @param {string} params.taskId    ← erro: sem @param {object} params primeiro
 * @param {string} params.status
 */
function foo(params) { ... }

// DEPOIS (correto):
/**
 * @param {object} params
 * @param {string} params.taskId
 * @param {string} params.status
 */
function foo(params) { ... }
```

**Tarefas**:

- [ ] Listar todos: `npm run typecheck:node 2>&1 | grep "TS8032"` → 177 ocorrências
- [ ] Corrigir adicionando `@param {object} params` antes dos sub-params em cada arquivo
- [ ] Corrigir TS8024 (37 ocorrências) — reordenar @param errado

**Gate**: `typecheck:node | grep -c "TS8032"` → 0

---

### Fase A — Lanes pequenas (≤ 400 erros cada)

**Objetivo**: zerar 6 lanes com correções JSDoc reais.

| Lane                    | Erros | Prioridade |
| ----------------------- | ----: | :--------: |
| `src.logic`             |     2 |     1      |
| `scripts.analysis`      |   181 |     2      |
| `src.inference_gateway` |   191 |     3      |
| `src.dashboard-ui`      |   285 |     4      |
| `tests.manual`          |   300 |     5      |
| `src.audit_agent`       |   358 |     6      |

#### Estratégia técnica por tipo de erro

**TS2339** — propriedade não existe:

```js
// Fix 1: typedef local para shape conhecido
/**
 * @typedef {object} TaskPayload
 * @property {string} id
 * @property {'pending'|'running'|'done'|'error'} status
 */
/** @returns {Promise<TaskPayload|null>} */
async function getTask(id) { ... }

// Fix 2: cast para acesso dinâmico legítimo
const val = (/** @type {Record<string, unknown>} */ (obj))[key];
```

**TS18046** — catch unknown:

```js
try { ... } catch (err) {
    const e = /** @type {any} */ (err);
    log.error(e.message);
}
```

**TS7006** — parâmetro sem tipo:

```js
// Em callbacks:
items.forEach(/** @param {TaskRecord} item */ item => item.name);
```

#### Checklist Fase A

- [ ] `src.logic`: 2 → 0 (gate: `npm run typecheck:strict:src.logic`)
- [ ] `scripts.analysis`: 181 → 0
- [ ] `src.inference_gateway`: 191 → 0
  - Typedefs: OllamaResponse, PolicyConfig, ProfileRecord, InferenceRequest
  - Tipos de retorno em todos os `*_repo.js`
- [ ] `src.dashboard-ui`: 285 → 0
  - Tipar state de stores Pinia explicitamente
  - Tipar `ref()` e `computed()` em composables
- [ ] `tests.manual`: 300 → 0
  - `/** @type {any} */` em asserções onde tipo exato não importa
- [ ] `src.audit_agent`: 358 → 0
  - Typedefs: AuditJob, AuditFinding, AuditPatch, JobRun

---

### Fase B — Lanes médias (500–1.300 erros cada)

**Objetivo**: zerar 11 lanes. Após Fase A, cascatas de TS2339 já terão reduzido.

| Lane               | Erros | Prioridade |
| ------------------ | ----: | :--------: |
| `src.nerv`         |   439 |     1      |
| `scripts.health`   |   441 |     2      |
| `src.missions`     |   608 |     3      |
| `src.shared`       |   746 |     4      |
| `src.orchestrator` |   773 |     5      |
| `src.integration`  |   924 |     6      |
| `scripts.audit`    |   928 |     7      |
| `scripts.root`     |   935 |     8      |
| `tools.workspace`  | 1.013 |     9      |
| `src.core`         | 1.053 |     10     |
| `src.agent`        | 1.190 |     11     |

#### Foco especial

**src.nerv** — payloads de eventos são o problema central:

- Criar `src/types/nerv/events.d.ts` com todos os payloads de evento
- Usar `/** @typedef {import('#types/nerv/events').NervPayload} NervPayload */` nos emissores

**src.core** — objetos de configuração:

- Typedef para o shape completo de `ConfigShape`, `RuntimeContext`

**src.agent** — workers com callbacks:

- Maior concentração de TS7006 (callbacks de fila, watchdogs)
- Typedef: TaskAttempt, MissionState, AgentContext

#### Checklist Fase B

- [x] `src.nerv`: 439 → 0
- [x] `scripts.health`: 441 → 0
- [x] `src.missions`: 608 → 0
- [ ] `src.shared`: 746 → 0
- [x] `src.orchestrator`: 773 → 0
- [ ] `src.integration`: 924 → 0
- [ ] `scripts.audit`: 928 → 0
- [ ] `scripts.root`: 935 → 0
- [ ] `tools.workspace`: 1.013 → 0
- [ ] `src.core`: 1.053 → 0
- [ ] `src.agent`: 1.190 → 0

---

### Fase C — Lanes grandes (> 1.300 erros cada)

**Objetivo**: zerar 4 lanes maiores. src.infra é a FUNDAÇÃO — seus tipos cascateiam para todo o
projeto.

| Lane           | Erros | Estratégia especial                                   |
| -------------- | ----: | ----------------------------------------------------- |
| `tests.legacy` | 1.403 | @ts-ignore linha por linha com justificativa (legado) |
| `src.kernel`   | 1.530 | Loop de execução — typedefs de estado e contexto      |
| `src.driver`   | 1.558 | Puppeteer — augmentar tipos de Page, Browser, Element |
| `src.infra`    | 2.232 | **Corrigir primeiro** — fundação do projeto           |

**Prioridade interna de src.infra** (do mais impactante ao menos):

1. `src/infra/db/*.js` — tipos de retorno de queries SQLite
2. `src/infra/browser_pool/*.js` — tipos de Puppeteer
3. `src/infra/queue/*.js` — TaskRecord, QueueEntry
4. `src/infra/storage/*.js` — tipos de armazenamento
5. `src/infra/locks/*.js`, `src/infra/fs/*.js` — mais simples

**Para tests.legacy** — regra de qualidade:

```js
// PERMITIDO: @ts-ignore com justificativa
// @ts-ignore // legacy: API removida na v2, código não migrado
const result = oldApi.call();

// PROIBIDO: @ts-nocheck em qualquer arquivo (sem exceção)
```

#### Checklist Fase C

- [ ] `src.infra`: 2.232 → 0 (**fazer primeiro**)
- [x] `src.kernel`: ~~1.530~~ → **0** ✅
- [ ] `src.driver`: 1.558 → 0
- [ ] `tests.legacy`: 1.403 → 0

---

### Fase D — Convergência da base e ativação progressiva de flags

**Objetivo**: após Fases A–C, medir superfícies regulares e ativar flags na base.

#### D.1 — Re-medição após Fases A–C

```bash
npm run typecheck:node    # deve estar próximo de 0
npm run typecheck:tools   # deve estar próximo de 0
npm run typecheck:tests   # deve estar próximo de 0
```

#### D.2 — Ativação progressiva de flags em tsconfig.base.json

**Etapa 1**: `useUnknownInCatchVariables: true`

- 602 erros → padrão sistemático: `const e = /** @type {any} */ (err);`
- Gate: `typecheck:strict:all` sem regressão

**Etapa 2**: `noImplicitAny: true`

- ~1.675 erros → @param em todos os callbacks
- Gate: `typecheck:strict:all` sem regressão

**Etapa 3**: `strictNullChecks: true`

- ~245 erros diretos → null guards, optional chaining
- Gate: `typecheck:strict:all` sem regressão

**Etapa 4**: `strict: true` completo

- Congela todos os flags acima + strictFunctionTypes + noImplicitReturns
- Gate: `typecheck:strict:all` → 0 | `typecheck:node` → 0 | `check:base-strict` → OK

---

## Regras de qualidade — o que é proibido e permitido

| Proibido                                       | Permitido                                                |
| ---------------------------------------------- | -------------------------------------------------------- |
| `// @ts-nocheck` em qualquer arquivo           | `/** @type {any} */ (expr)` — cast explícito justificado |
| `// @ts-ignore` sem comentário na mesma linha  | `/** @type {Record<string, unknown>} */` — dinâmico real |
| `{any}`, `{Object}`, `{*}` em tipos conhecidos | `// @ts-ignore // legacy: justificativa clara`           |
| Marcar lane verde sem realmente corrigir       | `@template T` para APIs genuinamente genéricas           |
| Silenciar em vez de corrigir                   | `/** @import { Tipo } from '#types/...' */` para reusar  |

---

## Checklist de progresso consolidado

### Fase 0 — JSDoc estrutural (sem flag)

- [ ] TS8032: 177 → 0
- [ ] TS8024: 37 → 0

### 9 lanes já verdes — manter ✅

- [x] `src.types`, `agents`, `scripts.ci`, `scripts.setup`, `tests.helpers`
- [x] `scripts.build`, `scripts.env`, `src.validation`, `tests.mocks`

### Fase A — Lanes pequenas (6 lanes)

- [ ] `src.logic`: 2 → 0
- [ ] `scripts.analysis`: 181 → 0
- [ ] `src.inference_gateway`: 191 → 0
- [ ] `src.dashboard-ui`: 285 → 0
- [ ] `tests.manual`: 300 → 0
- [ ] `src.audit_agent`: 358 → 0

### Fase B — Lanes médias (11 lanes)

- [x] `src.nerv`: 439 → 0
- [x] `scripts.health`: 441 → 0
- [x] `src.missions`: 608 → 0
- [ ] `src.shared`: 746 → 0
- [x] `src.orchestrator`: 773 → 0
- [ ] `src.integration`: 924 → 0
- [ ] `scripts.audit`: 928 → 0
- [ ] `scripts.root`: 935 → 0
- [ ] `tools.workspace`: 1.013 → 0
- [ ] `src.core`: 1.053 → 0
- [ ] `src.agent`: 1.190 → 0

### Fase C — Lanes grandes (4 lanes)

- [ ] `src.infra`: 2.232 → 0
- [ ] `tests.legacy`: 1.403 → 0
- [x] `src.kernel`: ~~1.530~~ → **0** ✅
- [ ] `src.driver`: 1.558 → 0

### Fase D — Base strict + superfícies regulares

- [ ] `typecheck:node` → 0
- [ ] `typecheck:tools` → 0
- [ ] `typecheck:tests` → 0
- [ ] `useUnknownInCatchVariables: true` em tsconfig.base.json — sem regressão
- [ ] `noImplicitAny: true` em tsconfig.base.json — sem regressão
- [ ] `strictNullChecks: true` em tsconfig.base.json — sem regressão
- [ ] `strict: true` em tsconfig.base.json — sem regressão
- [ ] `typecheck:strict:all` → 0

---

## Estimativa de esforço

| Fase   | Erros diretos | Padrão dominante          | Sessões estimadas |
| ------ | ------------: | ------------------------- | :---------------: |
| Fase 0 |           214 | JSDoc estrutural          |         1         |
| Fase A |         1.317 | TS2339 + TS18046          |        2–3        |
| Fase B |         7.331 | TS2339 + TS7006 + TS18046 |        6–8        |
| Fase C |         6.723 | TS2339 massiço            |        5–6        |
| Fase D |          res. | Flags progressivas        |        2–3        |

> **Nota importante sobre cascata**: corrigir um typedef numa camada base (ex:
> `src/infra/db/task_repo.js`) pode eliminar dezenas de TS2339 em `src/agent/*.js` e
> `src/missions/*.js`. O número real de **linhas modificadas** é muito menor que o número de erros
> reportados.

---

## Referências

- TypeScript `strict` mode: <https://www.typescriptlang.org/tsconfig/strict.html>
- JSDoc com TypeScript: <https://www.typescriptlang.org/docs/handbook/jsdoc-supported-types.html>
- `@param` para objetos desestruturados: <https://jsdoc.app/tags-param#parameters-with-properties>
- Skill JSDoc: `.github/skills/jsdoc-authoring/SKILL.md`
- Skill Typing: `.github/skills/typing-node24-esm-tsserver/SKILL.md`
