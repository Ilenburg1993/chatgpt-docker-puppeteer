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

- [`../../../DOCUMENTAÇÃO/REFERENCIA/TYPING_JSDOC_CANON.md`](../../../DOCUMENTAÇÃO/REFERENCIA/TYPING_JSDOC_CANON.md)

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
