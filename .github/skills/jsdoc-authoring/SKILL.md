---
name: jsdoc-authoring
description:
  Phase 2 JSDoc authoring for this repository. Use for robust JS-first contracts in Node 24 + ESM,
  with @ts-check, explicit @param/@returns, options typedefs, and no weak public tags.
license: MIT
---

# Skill — JSDoc Authoring (Phase 2)

## Overview

Use this skill when the task is to author or harden JSDoc in `.js/.mjs/.cjs` without migrating the
runtime wholesale to `.ts`.

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

- Export presence remains 100% documented.
- Exported functions have `@returns`.
- Public parameters are fully tagged.
- Options objects use a named typedef when applicable.
- Public JSDoc avoids weak generic tags unless the dynamic contract is intentional.

## Related Skills

- [`../typescript-typing/SKILL.md`](../typescript-typing/SKILL.md)
- [`../typing-node24-esm-tsserver/SKILL.md`](../typing-node24-esm-tsserver/SKILL.md)
- [`../schema-contract-governance/SKILL.md`](../schema-contract-governance/SKILL.md)
