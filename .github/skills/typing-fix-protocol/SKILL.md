---
name: typing-fix-protocol
description: Protocolo completo de scan, triagem e correção de erros TypeScript/JSDoc em repositório JS-first com @ts-check. Use ao executar o Full-Strict Roadmap lane por lane ou corrigir erros em arquivo específico. Contém comandos de triagem, cookbook por TS code, prioridade de cascata, estratégia de batch edit e casos especiais aprendidos em campo.
argument-hint: nome do lane ou arquivo-alvo (ex: scripts.analysis, src.logic)
---

# Skill: typing-fix-protocol

> **Protocolo operacional** para zerar erros TypeScript em repositório Node.js 24+ ESM com
> `// @ts-check` e JSDoc. Complementa `jsdoc-authoring` (cookbook) e `typing-node24-esm-tsserver`
> (arquitetura de lanes).
>
> **Regra absoluta**: `// @ts-nocheck` é proibido. Jamais use para suprimir erros.

---

## Quando usar esta skill

- Executar uma lane do Full-Strict Roadmap (ex: `src.inference_gateway`)
- Corrigir erros de tipagem em um arquivo específico
- Auditar o estado atual de erros em múltiplos lanes
- Decidir a ordem de fix dentro de um arquivo com muitos erros misturados

---

## Fase 1 — Scan e Triagem

### 1.1 — Medir o lane completo

```bash
# Total de erros no lane
npm run typecheck:strict:LANE 2>&1 | wc -l

# Top arquivos (do maior erro para o menor)
npm run typecheck:strict:LANE 2>&1 \
  | grep -oP '[^/\s]+\.(m?js|mts|ts)(?=\()' \
  | sort | uniq -c | sort -rn | head -15

# Distribuição de TS codes no lane
npm run typecheck:strict:LANE 2>&1 | grep -oP 'TS\d+' | sort | uniq -c | sort -rn
```

### 1.2 — Triagem de um arquivo

```bash
# Todos os erros do arquivo, ordenados por linha
npm run typecheck:strict:LANE 2>&1 \
  | grep "nome-do-arquivo" \
  | sed 's/.*nome-do-arquivo//' \
  | sort -t: -k1,1n | uniq

# Apenas contagem
npm run typecheck:strict:LANE 2>&1 | grep "nome-do-arquivo" | wc -l

# Apenas os TS codes únicos no arquivo
npm run typecheck:strict:LANE 2>&1 | grep "nome-do-arquivo" \
  | grep -oP 'TS\d+' | sort | uniq -c | sort -rn
```

### 1.3 — Verificação pós-fix

```bash
# Arquivo chegou a 0?
npm run typecheck:strict:LANE 2>&1 | grep "nome-do-arquivo" | wc -l
# esperado: 0

# Lane chegou a 0?
npm run typecheck:strict:LANE 2>&1 | tail -5

# Lanes sempre-verdes não regrediram?
for lane in src.logic agents scripts.ci scripts.setup tests.helpers scripts.build scripts.env src.validation tests.mocks scripts.analysis; do
  count=$(npm run typecheck:strict:$lane 2>&1 | grep -c "error TS" || true)
  echo "$lane: $count"
done
```

---

## Fase 2 — Leitura do Arquivo

**Regra**: sempre leia o arquivo antes de editar. Para arquivos com erros em linhas espalhadas, faça
**leituras paralelas** por blocos de 80–120 linhas ao redor de cada linha de erro.

### Estratégia de leitura eficiente

Dado um arquivo de 800 linhas com erros em: 47, 107, 152, 236, 311, 434, 492, 631, 687, 777, 944,
977

```
Batch 1 (paralelo): read_file(1-50) + read_file(95-170) + read_file(220-270)
Batch 2 (paralelo): read_file(290-360) + read_file(415-510) + read_file(615-700)
Batch 3 (paralelo): read_file(760-800) + read_file(930-1000)
```

### O que procurar ao ler

| TS Code | O que procurar no arquivo                                          |
| ------- | ------------------------------------------------------------------ |
| TS7006  | Assinatura de função/método (falta @param JSDoc)                   |
| TS7008  | `constructor() { this.x = [] }` sem anotação                       |
| TS7034  | `const arr = []` sem tipo                                          |
| TS7053  | `const obj = {}` seguido de `obj[key]`                             |
| TS18046 | `catch (err) { err.message }` — err é unknown                      |
| TS2339  | Acesso a propriedade em objeto sem typedef / objeto tipado como {} |
| TS2345  | `.push(x)` em array — indica never[] upstream                      |
| TS2488  | `@returns {object}` quando código faz `for...of`                   |
| TS8032  | Sub-@param sem @param pai declarado                                |
| typedef | `{{ tipo }` sem `}}` em @property de @typedef                      |

---

## Fase 3 — Cookbook de Correções por Código

### TS7006 — Parâmetro implicitamente `any`

```js
// Método/função:
/** @param {any} data @param {string} filePath */
function process(data, filePath) { ... }

// Callback inline em .map()/.filter()/.forEach():
items.map(/** @param {string} s */ s => s.trim())
items.filter(/** @param {any} v */ v => v.active)
Object.entries(obj).forEach(/** @param {string} _ @param {any} v */ (_, v) => use(v))
new Set(arr.map(/** @param {any} f */ f => path.basename(f)))
arr.sort((/** @type {any} */ a, /** @type {any} */ b) => a.value - b.value)
```

### TS7008 — Membro de classe implicitamente `any`

```js
// Antes: this.items = []   ← TS7008
// Depois:
/** @type {any[]} */
this.items = [];

/** @type {Record<string, any>} */
this.cache = {};

// Para objeto com múltiplos sub-arrays (elimina TS2345 em todos os .push()):
/** @type {{ unused: any[]; duplicates: any[]; enumCandidates: any[]; typeCandidates: any[] }} */
this.issues = { unused: [], duplicates: [], enumCandidates: [], typeCandidates: [] };
```

### TS7034 — Variável `never[]`

```js
// Antes: const results = []   ← TS7034 (strict infere never[])
// Depois:
/** @type {any[]} */
const results = [];

/** @type {string[]} */ // use tipo mais preciso quando conhecido
const files = [];
```

### TS7053 — Indexação de `{}`

```js
// Antes: const byFile = {}   ← obj[key] → TS7053
// Depois:
/** @type {Record<string, any[]>} */
const byFile = {};

/** @type {Record<string, number>} */
const types = {};

/** @type {Record<string, string>} */
const labels = {};
```

### TS18046 — `catch (err)` unknown

```js
// Padrão canônico:
} catch (err) {
    const _e = /** @type {any} */ (err);
    console.error(_e.message);
}

// Se o catch tem emoji no template string (ex: `⚠️ ${err.message}`),
// use Python para o replace — replace_string_in_file falha com encoding:
// python3 -c "
// import re, pathlib
// f = pathlib.Path('arquivo.mjs')
// txt = f.read_text(encoding='utf-8')
// txt = re.sub(r'catch \(err\)\s*\{([^}]*)\}',
//   lambda m: 'catch (err) {\n    const _e = /** @type {any} */ (err);' +
//             m.group(1).replace('err.message','_e.message').replace('err.stack','_e.stack') + '}',
//   txt)
// f.write_text(txt, encoding='utf-8')"
```

### TS2339 — Propriedade não existe

```js
// Opção 1: cast pontual (poucos campos extras não declarados no typedef)
const snippet = /** @type {any} */ ({
  prefix: opts.prefix,
  include: opts.include,
});

// Opção 2: anotar objeto root como any (muitas propriedades / objeto de dados grande)
/** @type {any} */
const analysisData = { files: [], issues: {}, dependencies: new Map() };

// Opção 3: adicionar a propriedade ao @typedef
/**
 * @typedef {object} Snippet
 * @property {string} prefix
 * @property {string[]} [include] ← adicionar propriedade faltante
 */
```

### TS2345 — Push em never[] (SEMPRE corrija o upstream)

```js
// ERRADO: tentar corrigir o ponto do push
results.push(/** @type {any} */ (item)); // ignorado para spread

// CORRETO: corrigir a declaração upstream
/** @type {any[]} */
const results = [];
results.push(item); // agora funciona
```

### TS2488 — Tipo não iterável

```js
// Antes:  /** @returns {object} */ function scan() { return []; }
// Depois: /** @returns {any[]} */  function scan() { return []; }
```

### TS2552 — `object.X` (maiúscula)

```js
// Bug real: object minúsculo não existe como global
object.fromEntries(entries); // → Object.fromEntries(entries)
object.keys(obj); // → Object.keys(obj)
object.assign({}, a, b); // → Object.assign({}, a, b)
```

### TS8032/TS8024 — JSDoc malformado

```js
// ANTES (TS8032: sub-param sem pai)
/**
 * @param {string} options.name   ← sem @param {object} options acima
 */

// DEPOIS
/**
 * @param {object} options
 * @param {string} options.name
 */

// ANTES (typedef com {{ ... } sem }})
* @property {{ imports?: string[]} candidate   ← bug: falta }}

// DEPOIS
* @property {{ imports?: string[], patterns?: string[], minHits?: number }} candidate
```

### `@param {object}` → a classe que recebe `analysisData`

```js
// Quando a classe encapsula um objeto `any` externo:
class ReportGenerator {
  /** @param {any} data */
  constructor(data) {
    this.data = data; // this.data = any → nenhum TS2339 nos métodos
  }
}
```

---

## Fase 4 — Ordem de Aplicação (Cascata)

Dentro de um arquivo, aplique na seguinte ordem para maximizar eliminação de cascata:

```
1. TS8032 / TS8024 / typedef malformado   → raiz de cascatas de TS2339
2. TS7008 (this.x = [])                   → elimina TS2345 em pushes de instância
3. TS7034 (const arr = [])                → elimina TS2345 em pushes/spreads
4. TS7053 (const obj = {})                → elimina TS7053 nos acessos
5. TS7006 (params sem tipo)               → elimina TS2339 em chamadas
6. TS18046 (catch err unknown)            → sem cascata
7. TS2345 / TS2339 residuais              → resolver pontualmente
```

---

## Fase 5 — Edição em Lote

### Regra: uma única chamada `multi_replace_string_in_file` por arquivo

Agrupe TODOS os patches de um arquivo numa única chamada. Motivos:

- Edições sequenciais falham se a primeira deslocou linhas
- Uma única chamada é 5–10× mais rápida
- O `oldString` é mais seguro em contexto não-modificado

### Contexto mínimo no oldString

Inclua 3–5 linhas exclusivas: 2–3 antes do alvo + a linha alvo + 1–2 depois. Garante match único.

### Para arquivos grandes: 3 rounds de leitura + 1 round de edição

```
Round 1 (paralelo): ler blocos A, B, C
Round 2 (paralelo): ler blocos D, E, F (baseado em erros com linhas maiores)
Round 3 (opcional): ler blocos caso ainda haja dúvidas
Round 4: multi_replace_string_in_file com todos os patches
```

---

## Fase 6 — Casos Especiais

### Emoji em catch blocks

`replace_string_in_file` falha silenciosamente quando o `oldString` contém emoji (encoding UTF-8
multi-byte). Use Python:

```bash
python3 -c "
import re, pathlib
f = pathlib.Path('scripts/analysis/arquivo.mjs')
txt = f.read_text(encoding='utf-8')
txt = txt.replace(
    '} catch (err) {\n            console.warn(\`   ⚠️  Erro: \${err.message}\`);',
    '} catch (err) {\n            const _e = /** @type {any} */ (err);\n            console.warn(\`   ⚠️  Erro: \${_e.message}\`);'
)
f.write_text(txt, encoding='utf-8')
print('done')
"
```

### `this.issues` com muitos sub-arrays — padrão DetectorClass

Objeto mais complexo que `any[]` simples. Use o typedef inline completo no construtor:

```js
/** @type {{
  unused: any[];
  duplicates: any[];
  magicValues: any[];
  redundantLet: any[];
  enumCandidates: any[];
  typeCandidates: any[];
}} */
this.issues = {
  unused: [],
  duplicates: [],
  magicValues: [],
  redundantLet: [],
  enumCandidates: [],
  typeCandidates: [],
};
```

Isso elimina todos os `this.issues.X.push(...)` como TS2345 em cascata.

### `.map(v => ({ name: v.name, file: v.file }))` com v implícito

```js
// V vem de iteração de any[] — mas TypeScript ainda pede tipo explícito:
vars.map(/** @param {any} v */ (v) => ({ name: v.name, file: v.file }));
```

### JSDoc de typedef com objeto inline complexo

```js
// Propriedade com objeto inline como tipo:
* @property {{ imports?: string[], patterns?: string[], sequences?: string[], minHits?: number, snippetName?: string }} candidate

// NÃO deixar como:
* @property {{ imports?: string[]} candidate    ← falta }}
```

---

## Referência Rápida — Comandos de Verificação

```bash
# Estado do lane
npm run typecheck:strict:LANE 2>&1 | tail -5

# Arquivo específico
npm run typecheck:strict:LANE 2>&1 | grep "arquivo.mjs"

# Quantidade de erros
npm run typecheck:strict:LANE 2>&1 | grep -c "error TS"

# TS codes mais frequentes
npm run typecheck:strict:LANE 2>&1 | grep -oP 'TS\d+' | sort | uniq -c | sort -rn

# Top arquivos
npm run typecheck:strict:LANE 2>&1 | grep -oP '[^/\s]+\.m?js(?=\()' | sort | uniq -c | sort -rn | head -10

# Verificação de regressão em lanes verdes
npm run typecheck:strict:src.logic 2>&1 | tail -2
npm run typecheck:strict:scripts.analysis 2>&1 | tail -2
npm run typecheck:strict:agents 2>&1 | tail -2
npm run typecheck:strict:scripts.ci 2>&1 | tail -2
```

---

## Skills Relacionadas

- [`jsdoc-authoring`](../jsdoc-authoring/SKILL.md) — cookbook completo de JSDoc, guardrails, quando
  usar typedef vs cast
- [`typing-node24-esm-tsserver`](../typing-node24-esm-tsserver/SKILL.md) — arquitetura de lanes,
  tsconfig strict por lane, configuração de tsserver
- [`lsp-ops`](../lsp-ops/SKILL.md) — navegação semântica via tsserver (go-to-definition,
  referências, diagnósticos)
- `DOCUMENTAÇÃO/TIPAGEM E JSDOC/ROADMAP.md` — estado atual do roadmap, lanes concluídas, próximas
  prioridades
