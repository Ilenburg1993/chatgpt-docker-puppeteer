# Padrões — JSDoc e Tipagem TypeScript

> **Status**: Normativo — todo código novo ou editado deve seguir estas regras. **Última revisão**:
> 4 de março de 2026 **Aplica-se a**: `.js`, `.mjs` em `src/`, `scripts/`, `tests/`, `tools/`

---

## 1. Princípios fundamentais

Este repositório é **JS-first**: não migraremos o runtime para `.ts`. A tipagem se dá por:

1. `// @ts-check` em todo arquivo — o TypeScript lê e verifica via JSDoc.
2. **JSDoc como contrato público** — toda função exportada tem `@param` e `@returns`.
3. **`src/types/*.d.ts`** — tipos compartilhados entre múltiplos módulos.
4. **`schemas/typing/*.schema.json`** — para artefatos JSON (CI, relatórios, tooling).

---

## 2. Regras obrigatórias

### 2.1 `@ts-check` em todos os arquivos

Todo arquivo `.js` ou `.mjs` deve ter na primeira linha (ou logo após shebang):

```js
// @ts-check
```

**Proibido**: `// @ts-nocheck` — sem exceção alguma.

### 2.2 Funções públicas sempre tipadas

Toda função exportada (pública) deve ter JSDoc completo:

```js
// @ts-check

/**
 * Processa uma tarefa da fila.
 * @param {TaskRecord} task - A tarefa a processar.
 * @param {ProcessOptions} [options] - Opções opcionais.
 * @returns {Promise<TaskResult>} Resultado do processamento.
 * @throws {ValidationError} Se a tarefa for inválida.
 */
export async function processTask(task, options) {
  // ...
}
```

### 2.3 Parâmetros de opções usam `@typedef`

Nunca use `{object}` genérico para parâmetros de opções conhecidos:

```js
// ❌ ERRADO
/** @param {object} options */

// ✅ CORRETO — usar typedef nomeado
/**
 * @typedef {object} ProcessOptions
 * @property {number} [timeout=5000] - Timeout em ms.
 * @property {boolean} [retry=false] - Tentar novamente em falha.
 */
```

### 2.4 Parâmetros desestruturados precisam de `@param` pai

Para parâmetros desestruturados, o parent `@param` é obrigatório (regra TS8032):

```js
// ❌ ERRADO — gera TS8032
/**
 * @param {string} opts.taskId
 * @param {string} opts.status
 */
function foo({ taskId, status }) {}

// ✅ CORRETO
/**
 * @param {object} opts
 * @param {string} opts.taskId
 * @param {string} opts.status
 */
function foo({ taskId, status }) {}
```

---

## 3. Tags proibidas em contratos públicos

| Tag / padrão                              | Por quê é proibido                                               |
| ----------------------------------------- | ---------------------------------------------------------------- |
| `{any}` em `@param` / `@returns` públicos | Silencia o typechecker completamente                             |
| `{Object}`, `{object}` sem shape          | Não descreve o real contrato do parâmetro                        |
| `{Array}`, `{Function}`                   | Usar `{T[]}` e `{(arg: T) => R}` ou typedefs                     |
| `{*}` (jsdoc genérico)                    | TypeScript não entende — usar `{unknown}` ou typedef             |
| `Promise<any>`                            | Usar `Promise<T>` com T real ou `Promise<void>`                  |
| `// @ts-nocheck`                          | **Proibido absolutamente** — remove toda verificação do arquivo  |
| `// @ts-ignore` sem justificativa         | Proibido — use `@ts-expect-error` com commentário na mesma linha |

---

## 4. Padrões de correção por tipo de erro TS

### TS2339 — Propriedade não existe no tipo

Causa: objeto sem shape tipado. Corrija com typedef:

```js
// @ts-check

/**
 * @typedef {object} TaskRecord
 * @property {string} id
 * @property {'pending'|'running'|'done'|'error'} status
 * @property {number} createdAt
 */

/** @returns {Promise<TaskRecord|null>} */
async function getTask(id) {
  const row = await db.get('SELECT * FROM tasks WHERE id = ?', id);
  return row ?? null;
}
```

Para acesso dinâmico legítimo a chaves desconhecidas:

```js
// Cast explícito — documentar por quê é dinâmico
const val = /** @type {Record<string, unknown>} */ (obj)[key];
```

### TS18046 — `catch(err)` com `err` unknown

Com flag `useUnknownInCatchVariables` (ou ao receber `unknown`):

```js
try {
  await doSomething();
} catch (err) {
  const e = /** @type {any} */ (err); // catch: qualquer erro tem .message
  logger.error('falha:', e.message);
}
```

### TS7006 — Parâmetro implicitamente `any`

Em callbacks de array, eventos, etc.:

```js
// ❌ Sem tipo — TS7006
items.forEach(item => item.name);

// ✅ Com @param inline
items.forEach(/** @param {TaskRecord} item */ item => item.name);

// Ou com typedef prévio + tipagem da variável
/** @type {TaskRecord[]} */
const items = getItems();
items.forEach(item => item.name); // item inferido como TaskRecord
```

### TS8032 — Sub-param JSDoc sem parent

```js
// ❌ ERRADO
/** @param {string} opts.id */

// ✅ CORRETO
/**
 * @param {object} opts
 * @param {string} opts.id
 */
```

### TS8024 — @param fora de ordem

@param de sub-propriedades deve ser imediatamente após o @param pai:

```js
/**
 * @param {object} opts
 * @param {string} opts.id     ← deve vir logo após opts
 * @param {boolean} opts.force ← e outro sub-param
 * @returns {void}
 */
```

### TS18047/TS18048 — Valor possivelmente null/undefined

```js
// Se pode ser null, use optional chaining ou guarda:
const name = user?.profile?.name ?? 'anônimo';

// Ou guarda explícita:
if (result === null) {
  return;
}
// a partir daqui result é não-null
```

---

## 5. Tipos compartilhados (`src/types/`)

Promova um typedef para `src/types/*.d.ts` **apenas** quando:

- É reutilizado por múltiplos módulos independentes, **ou**
- Modela um contrato externo estável (Puppeteer, Express, etc.), **ou**
- O declaration emit precisa dele para evitar surface vaga

Se nenhuma das condições for verdadeira, mantenha o typedef local no arquivo que o usa.

### Import de tipos compartilhados

```js
// @ts-check
/** @import { TaskRecord } from '#types/tasks.js' */

// Ou sintaxe inline:
/** @type {import('#types/tasks').TaskRecord} */
const task = await getTask(id);
```

---

## 6. Generics reais

Use `@template` apenas quando a API é genuinamente genérica:

```js
/**
 * Filtra itens por predicado.
 * @template T
 * @param {T[]} items
 * @param {(item: T) => boolean} predicate
 * @returns {T[]}
 */
export function filter(items, predicate) {
  return items.filter(predicate);
}
```

---

## 7. Satisfação de tipo sem widening

Use `@satisfies` para checar literais de objeto sem perder o tipo específico:

```js
// @ts-check
/** @typedef {import('./types').Config} Config */

const config = /** @satisfies {Config} */ ({
  timeout: 5000,
  retries: 3,
});
// config ainda tem tipo literal {timeout: number, retries: number}
// mas foi verificado contra Config em tempo de edição
```

---

## 8. O que é permitido vs. proibido — sumário

| Proibido                          | Permitido / preferido                                                |
| --------------------------------- | -------------------------------------------------------------------- |
| `// @ts-nocheck`                  | `// @ts-check` em todo arquivo                                       |
| `// @ts-ignore` sem justificativa | `// @ts-expect-error // motivo` dentro de allowlist                  |
| `{any}` em APIs públicas          | `{unknown}` com narrowing, ou typedef real                           |
| `{Object}`, `{object}` sem shape  | `@typedef {object} NomeExplícito @property ...`                      |
| `{Array}`, `{Function}` genéricos | `{T[]}`, `{(x: T) => R}` com tipos reais                             |
| Sub-param JSDoc sem @param pai    | `@param {object} opts` seguido de `@param {T} opts.field`            |
| Funções públicas sem `@returns`   | `@returns {T}` ou `@returns {void}` em toda exportação               |
| Marcar lane verde sem corrigir    | Corrigir erros reais e confirmar com `npm run typecheck:strict:LANE` |
| Silenciar em vez de corrigir      | Criar typedef, adicionar @param, adicionar guard null                |

---

## 9. Ordem de consulta ao resolver dúvidas

1. Este arquivo (`PADROES.md`) — padrão imediato de codificação.
2. `CONFIGURACOES-TSCONFIG.md` — para entender qual tsconfig ou lane corresponde ao erro.
3. [`../REFERENCIA/TYPING_JSDOC_CANON.md`](../REFERENCIA/TYPING_JSDOC_CANON.md) — para regras de
   governança e change control.
4. Skills: `.github/skills/jsdoc-authoring/SKILL.md` e
   `.github/skills/typing-node24-esm-tsserver/SKILL.md`.
5. TypeScript JSDoc oficial:
   <https://www.typescriptlang.org/docs/handbook/jsdoc-supported-types.html>
