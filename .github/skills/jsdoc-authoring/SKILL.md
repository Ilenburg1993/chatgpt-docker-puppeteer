---
name: jsdoc-authoring
description:
  JSDoc authoring skill for this repository. Use for robust JS-first contracts in Node 24 + ESM,
  with @ts-check, explicit @param/@returns, options typedefs, and no weak public tags.
license: MIT
---

# Skill — JSDoc Authoring

## Overview

Use this skill when the task is to author or harden JSDoc in `.js/.mjs/.cjs` without migrating the
runtime wholesale to `.ts`.

The normative repository canon lives in:

- [`../../../DOCUMENTAÇÃO/TIPAGEM E JSDOC/PADROES.md`](../../../DOCUMENTAÇÃO/TIPAGEM%20E%20JSDOC/PADROES.md):
  padrões práticos de JSDoc
- [`../../../DOCUMENTAÇÃO/TIPAGEM E JSDOC/README.md`](../../../DOCUMENTAÇÃO/TIPAGEM%20E%20JSDOC/README.md):
  hub operacional
- [`../../../DOCUMENTAÇÃO/REFERENCIA/TYPING_JSDOC_CANON.md`](../../../DOCUMENTAÇÃO/REFERENCIA/TYPING_JSDOC_CANON.md):
  canon normativo de governança

This phase assumes:

- Node.js 24
- ESM / `NodeNext`
- `allowJs + checkJs`
- JSDoc as the public contract layer

## When To Use

- Missing or weak public JSDoc
- Exported functions missing `@param` or `@returns`
- Options objects documented as raw `object` / `Object`
- Need to introduce `@import`, `@template`, or `@satisfies`
- Need stronger IntelliSense without changing runtime semantics

## When Not To Use

- The task is only conceptual and no file changes are needed
- The problem is a full strict-type failure better handled by `typing-node24-esm-tsserver`

## Inputs / Preconditions

- Read the target module first
- Inventory exports before editing
- Prefer official TypeScript-supported JSDoc, not generic JSDoc patterns that TS ignores

## Workflow

1. Add or preserve `// @ts-check` at the top when the file is in scope.
2. Document every exported function with complete `@param` and `@returns`.
3. For options objects, create a named `@typedef {object}` and use it in the `@param`.
4. Prefer `Record<string, unknown>`, unions, and local typedefs over `any`.
5. Use `@import` or inline `import('./file').Type` when the type already exists elsewhere.
6. Use `@template` only when the API is truly generic.
7. Use `@satisfies` for object literals that must match a shared type without widening.

## Protocolo Prático: Zerando Erros por Arquivo

**Regra absoluta**: `// @ts-nocheck` é proibido. Nunca use para suprimir erros.

### Passo 1 — Triagem completa ANTES de editar

Nunca edite um arquivo sem antes mapear **todos** os erros agrupados por TS code. Edições cegas
causam regressões e erros em cascata.

```bash
# Erros do arquivo ordenados por linha
npm run typecheck:strict:LANE 2>&1 \
  | grep "nome-do-arquivo" \
  | sed 's/.*nome-do-arquivo//' \
  | sort -t: -k1,1n | uniq

# Contagem por código TS (prioridade de fix)
npm run typecheck:strict:LANE 2>&1 | grep -oP 'TS\d+' | sort | uniq -c | sort -rn

# Top arquivos com mais erros no lane
npm run typecheck:strict:LANE 2>&1 \
  | grep -oP '(?<=\/)[\w._-]+\.m?[jt]s' | sort | uniq -c | sort -rn | head -15
```

### Passo 2 — Ler o arquivo inteiro (seções relevantes)

**Sempre leia o arquivo antes de editar.** Para arquivos grandes (> 400 linhas), faça leituras
paralelas das seções com erros + 20 linhas de contexto ao redor de cada linha listada. Leia
obrigatoriamente:

- Cabeçalho e imports (aliases, tipos importados)
- Todos os `class ... { constructor() {...} }` com erros
- Funções/métodos com TS7006 (parâmetros sem tipo)
- Declarações `const arr = []` (possivelmente `never[]`)
- Declarações `const obj = {}` (possivelmente TS7053)
- Todos os `catch (err)` blocks com TS18046
- Typedefs (`@typedef`) com propriedades que cascateiam TS2339

### Passo 3 — Classificar erros por tipo e prioridade de fix

| Prioridade  | Código  | Causa                          | Fix canônico                                        |
| ----------- | ------- | ------------------------------ | --------------------------------------------------- |
| 1 (raiz)    | TS8032  | Sub-@param sem pai             | Remover ou adicionar @param pai                     |
| 1 (raiz)    | TS8024  | @param fora de ordem           | Reordenar @param / @typedef                         |
| 1 (raiz)    | typedef | `{{ tipo }` sem `}}`           | Corrigir `{{...}}` no typedef                       |
| 2           | TS7008  | Membro de classe any           | `/** @type {any[]} */` antes de `this.x = []`       |
| 2           | TS7034  | `never[]` em variável          | `/** @type {any[]} */` antes de `const arr = []`    |
| 2           | TS7053  | Indexação de `{}`              | `/** @type {Record<string,any>} */` antes do objeto |
| 3           | TS7006  | Param implícito any            | Adicionar `@param` ao JSDoc do método               |
| 3           | TS18046 | `catch err` é unknown          | `const _e = /** @type {any} */ (err);` no catch     |
| 4 (cascata) | TS2345  | Push em never[] (cascata)      | Corrija o **array upstream** (TS7034/TS7008)        |
| 4 (cascata) | TS2339  | Propriedade inexistente        | Fix typedef upstream ou cast objeto para `any`      |
| 4 (cascata) | TS2488  | @returns {object} não iterável | Mudar `{object}` → `{any[]}` no JSDoc               |
| bugfix      | TS2552  | `object.fromEntries`           | Bug real: `object` → `Object` (maiúsculo)           |

### Passo 4 — Aplicar TODAS as correções do arquivo em uma única chamada

Use **sempre** `multi_replace_string_in_file` com todos os patches agrupados. Nunca faça
`replace_string_in_file` sequencial para o mesmo arquivo — é lento e falha se linhas deslocam.

### Passo 5 — Verificar zero erros no arquivo

```bash
npm run typecheck:strict:LANE 2>&1 | grep "nome-do-arquivo" | wc -l
# deve retornar 0
```

### Passo 6 — Verificar lanes sempre-verdes

```bash
# Após cada arquivo, checar que as lanes verdes não regrediram
npm run typecheck:strict:src.logic 2>&1 | tail -3
npm run typecheck:strict:agents 2>&1 | tail -3
npm run typecheck:strict:scripts.ci 2>&1 | tail -3
```

---

## Cookbook de Códigos de Erro TypeScript

### TS7006 — Parâmetro implicitamente `any`

```js
// ANTES (erro) — função/método sem @param
function process(data) { ... }          // TS7006
arr.map(n => n.trim())                  // TS7006

// DEPOIS
/** @param {any} data */
function process(data) { ... }

arr.map(/** @param {string} n */ n => n.trim())
arr.forEach(/** @param {any} v */ v => action(v))
arr.filter(/** @param {any} v */ v => v.active)
Object.entries(obj).forEach(
    /** @param {string} _ @param {any} v */ (_, v) => use(v)
)
// Para sort com dois params:
items.sort((/** @type {any} */ a, /** @type {any} */ b) => a - b)
```

**Padrão callback inline**: `/** @param {Tipo} nome */ nome => expr` Esta sintaxe é suportada pelo
TypeScript dentro de `.map()`, `.filter()`, `.forEach()`.

### TS7008 — Membro de classe implicitamente `any`

```js
// ANTES (erro) — this.x = [] ou this.x = {} em constructor sem anotação
class Foo {
  constructor() {
    this.items = []; // TS7008
    this.cache = {}; // TS7008
  }
}

// DEPOIS
class Foo {
  constructor() {
    /** @type {any[]} */
    this.items = [];
    /** @type {Record<string, any>} */
    this.cache = {};
  }
}
```

**Atalho para objetos grandes**: quando uma classe acumula dados em muitos sub-arrays/objetos (ex:
`this.issues = { unused: [], duplicates: [], enumCandidates: [], ... }`), anotar o objeto inteiro
com sua forma completa elimina cascata de `never[]` (`TS2345`) em todos os `.push()` da classe:

```js
/** @type {{ unused: any[]; duplicates: any[]; magicValues: any[]; enumCandidates: any[]; typeCandidates: any[] }} */
this.issues = {
  unused: [],
  duplicates: [],
  magicValues: [],
  enumCandidates: [],
  typeCandidates: [],
};
```

### TS7034 — Variável `never[]`

```js
// ANTES (strict infere never[] para arrays sem elementos na declaração)
const results = []; // TS7034
const deps = []; // TS7034

// DEPOIS
/** @type {any[]} */
const results = [];

/** @type {string[]} */ // use tipo mais preciso quando conhecido
const deps = [];
```

### TS7053 — Indexação de objeto `{}`

```js
// ANTES
const byFile = {}; // obj[key] → Element implicitly has type 'any'
const types = {}; // mesmo problema

// DEPOIS
/** @type {Record<string, any[]>} */
const byFile = {};

/** @type {Record<string, number>} */
const types = {};

/** @type {Record<string, string>} */
const icons = {};
```

### TS18046 — `catch (err)` — err é `unknown`

```js
// ANTES
} catch (err) {
    console.error(err.message);    // TS18046: Object is of type 'unknown'
}

// DEPOIS (padrão canônico)
} catch (err) {
    const _e = /** @type {any} */ (err);
    console.error(_e.message);
}
```

⚠️ **Atenção**: Se o catch block contém emoji no template string (ex: `⚠️ Erro: ${err.message}`), o
`replace_string_in_file` pode falhar com encoding. Use um script Python:

```python
import re, pathlib
f = pathlib.Path('arquivo.mjs')
txt = f.read_text(encoding='utf-8')
txt = re.sub(
    r'\} catch \(err\) \{([\s\S]*?)\}',
    lambda m: '} catch (err) {\n    const _e = /** @type {any} */ (err);' +
              m.group(1).replace('err.message', '_e.message').replace('err.stack', '_e.stack') + '}',
    txt
)
f.write_text(txt, encoding='utf-8')
```

### TS2339 — Propriedade não existe no tipo

```js
// Opção 1: cast do objeto (para objetos com poucas propriedades extras)
const snippet = /** @type {any} */ ({
  prefix: opts.prefix,
  include: opts.include, // propriedade extra que o tipo não tem
});

// Opção 2: anotar o objeto root como any (para objetos grandes com muitas propriedades)
/** @type {any} */
const analysisData = {
  files: [],
  issues: { unused: [], duplicates: [] },
};
// Agora analysisData.qualquerCoisa é acessível sem TS2339
```

**Não confundir** com typedef incompleto: se apenas alguns @property faltam no typedef, adicione-os
ao `@typedef` em vez de usar `any`. Prefira types reais quando a forma é conhecida.

### TS2345 — Argumento incompatível (SEMPRE corrija o upstream)

```js
// ERRADO: tentar corrigir o ponto do push
results.push(/** @type {any} */ (item)); // não funciona para spread
allVars.push(...result.variables); // ainda falha se allVars é never[]

// CORRETO: corrigir a declaração do array
/** @type {any[]} */
const allVars = [];
allVars.push(...result.variables); // agora funciona
```

### TS2488 — Tipo não iterável (`@returns {object}`)

```js
// ANTES (código faz for...of e o JSDoc diz object)
/** @returns {object} */
function scanFile() {
  return [];
}
// erro: Type 'object' is not iterable

// DEPOIS
/** @returns {any[]} */
function scanFile() {
  return [];
}
```

### TS2552 — Nome não encontrado (case sensitivity = bug real)

```js
// ANTES (bug: object minúsculo não existe como global)
object.fromEntries(entries); // TS2552

// DEPOIS (fix real)
Object.fromEntries(entries);
```

### Typedef JSDoc malformado com `{{ ... }` sem `}}`

```js
// ANTES (cascata de TS2339 — propriedades do objeto inline não reconhecidas)
/**
 * @typedef {object} Options
 * @property {{ name?: string} config   ← falta o }} final
 */

// DEPOIS
/**
 * @typedef {object} Options
 * @property {{ name?: string }} config
 */

// Para typedef com objeto complexo como propriedade:
* @property {{ imports?: string[], patterns?: string[], sequences?: string[], minHits?: number }} candidate
```

---

## Ordem de Cascata: Corrija Causas, não Sintomas

**Regra fundamental**: TS2345, TS2322, TS2339 são sintomas de causas primárias (TS7034, TS7053,
TS7008, TS8032). Corrija sempre os primários — os de cascata desaparecem automaticamente.

**Ordem canônica dentro de um arquivo**:

1. JSDoc malformados (TS8032, TS8024) → 0
2. Typedefs malformados (`{{ tipo }` sem `}}`) → 0
3. Membros de constructor (TS7008) → 0 → elimina TS2345 em pushes
4. Arrays `never[]` (TS7034) → 0 → elimina TS2345 em spreads e pushes
5. Objetos `{}` sem type (TS7053) → 0
6. Parâmetros de métodos/funções (TS7006) → 0
7. Catch blocks (TS18046) → 0
8. TS2339 e TS2345 residuais → 0

---

## Estratégia de Edição em Lote

### Uma única chamada `multi_replace_string_in_file` por arquivo

Agrupe **todos** os patches de um arquivo numa única chamada. Vantagens:

- Edições sequenciais individuais falham se a primeira deslocou linhas
- Uma única chamada é 5–10× mais rápida
- Correspondência (`oldString`) é mais segura em contexto fresco

### Para arquivos grandes (> 500 linhas): leituras paralelas

```
read_file(1-100)    + read_file(180-240)   [paralela]
read_file(430-480)  + read_file(760-820)   [paralela]
```

Depois aplique todos os patches de uma vez.

### Inclua 3–5 linhas de contexto no oldString

```js
// Contexto suficiente para correspondência única:
    /**
     * @param {string} config   ← alvo
     */
    constructor(config) {       ← contexto abaixo
        this.config = config;
```

---

## Casos Especiais

### Callback em `.map()` / `.filter()` / `.forEach()`

TypeScript strict mode às vezes não infere o tipo do callback mesmo quando o array é `string[]`. Use
a anotação inline:

```js
names.map(/** @param {string} n */ (n) => n.trim());
items.filter(/** @param {any} v */ (v) => v.active);
entries.map(/** @param {any} v */ (v) => ({ name: v.name, file: v.file }));
new Set(arr.map(/** @param {any} f */ (f) => path.basename(f)));
```

### Objetos grandes com muitas propriedades

Quando um objeto acumula 10+ propriedades (`analysisData`, `state`, `config`), anotar o **objeto
inteiro** como `/** @type {any} */` elimina dezenas de TS7008/TS2339/TS7053 com uma linha:

```js
/** @type {any} */
const analysisData = {
  files: [],
  issues: { unused: [], duplicates: [] },
  enumCandidates: new Map(),
};
```

### Classe que recebe `analysisData` ou objeto `any`

Quando uma classe encapsula dados provenientes de um objeto `any`, tipar o param do construtor como
`/** @param {any} data */` faz `this.data` ser `any`, eliminando todos os TS2339 nos métodos:

```js
class ReportGenerator {
  /** @param {any} data */
  constructor(data) {
    this.data = data; // this.data é any: sem TS2339 nos métodos
  }
}
```

### Membro `this.issues` com múltiplos sub-arrays

Type annotation completa no construtor elimina cascata de `never[]` em todos os `.push()`:

```js
/**
 * @type {{
 *   unused: any[];
 *   duplicates: any[];
 *   magicValues: any[];
 *   redundantLet: any[];
 *   enumCandidates: any[];
 *   typeCandidates: any[];
 * }}
 */
this.issues = {
  unused: [],
  duplicates: [],
  magicValues: [],
  redundantLet: [],
  enumCandidates: [],
  typeCandidates: [],
};
```

### @returns {object} → iteração `for...of`

Se o código faz `for (const x of fn())` e o JSDoc tem `@returns {object}`, mude para
`@returns {any[]}`. TypeScript não considera `object` iterável.

---

## Guardrails

- Do not use `Object`, `Array`, or `Function` in a public contract when a real shape is knowable.
- Do not add `@throws` unless the code path genuinely throws or propagates.
- Do not use generated placeholder comments as the canonical result.
- Do not change runtime behavior just to simplify the docs.

## Validation / Done Criteria

Metas numéricas do programa full-strict (todas devem ser `= 0` simultaneamente):

| Métrica                           | Alvo |
| --------------------------------- | ---- |
| `functions_missing_param_tags`    | 0    |
| `functions_missing_returns`       | 0    |
| `unsafe_generic_tags_total`       | 0    |
| `public_any_tags_total`           | 0    |
| `options_objects_without_typedef` | 0    |

Critérios qualitativos (aplica em toda PR):

- Cada exportação pública tem `@returns` documentado.
- Parâmetros públicos estão totalmente tagueados com `@param {type}`.
- Objetos de opções usam `@typedef {object}` nomeado, nunca `Object` genérico.
- JSDoc público evita tags genéricas fracas (`any`, `object`, `Function`) salvo contrato dinâmico
  intencional e documentado.

## Related Skills

- [`../typescript-typing/SKILL.md`](../typescript-typing/SKILL.md)
- [`../typing-node24-esm-tsserver/SKILL.md`](../typing-node24-esm-tsserver/SKILL.md)
- [`../schema-contract-governance/SKILL.md`](../schema-contract-governance/SKILL.md)
- [`../../../DOCUMENTAÇÃO/REFERENCIA/TYPING_INDEX.md`](../../../DOCUMENTAÇÃO/REFERENCIA/TYPING_INDEX.md)
