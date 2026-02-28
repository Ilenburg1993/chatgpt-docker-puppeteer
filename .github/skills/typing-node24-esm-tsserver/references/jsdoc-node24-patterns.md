# Padrões JSDoc para Node 24 ESM

## Tipar função simples

```js
/**
 * @param {string} id
 * @returns {Promise<{ ok: boolean, id: string }>}
 */
export async function loadById(id) {
  return { ok: true, id };
}
```

## Typedef reutilizável

```js
/**
 * @typedef {object} ShutdownResult
 * @property {boolean} ok
 * @property {number} durationMs
 * @property {string[]} warnings
 */
```

## Callback/eventos

```js
/**
 * @callback OnStateChange
 * @param {{ phase: string, progress: number }} evt
 * @returns {void}
 */
```

## Genéricos em JS

```js
/**
 * @template T
 * @param {T} value
 * @returns {T}
 */
export function identity(value) {
  return value;
}
```

## Satisfies para shape de configuração

```js
/** @satisfies {{ mode: 'quick'|'deep', retries: number }} */
const AUDIT_OPTIONS = { mode: 'quick', retries: 2 };
```

## Import de tipo em JSDoc

```js
/** @typedef {import('#server/engine/lifecycle.js').LifecycleState} LifecycleState */
```

## Regras práticas

1. Tipar fronteiras: entrada/saída de módulo, handlers, adapters.
2. Não tipar em excesso dentro de bloco local trivial.
3. Extrair typedef quando o objeto aparece 2+ vezes.
4. Para união literal, preferir enum-like constante + typedef derivado.
