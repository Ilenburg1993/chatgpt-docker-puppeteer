---
name: typescript-typing
description:
  Incremental TypeScript typing for a JS-first repository. Use for JSDoc, shared typedefs, .d.ts
  promotion, declaration validation, and safer narrowing without broad TS migration.
license: MIT
---

# Skill — TypeScript Typing (JS-First)

## Overview

This skill governs incremental typing in a JS-first codebase.

The normative repository canon lives in:

- [`../../../DOCUMENTAÇÃO/REFERENCIA/TYPING_JSDOC_CANON.md`](../../../DOCUMENTAÇÃO/REFERENCIA/TYPING_JSDOC_CANON.md)

The default path is:

- JSDoc in source files
- `// @ts-check`
- shared `.d.ts` only when a type is reused across modules
- declaration validation through `emitDeclarationOnly`

## When To Use

- Adding or strengthening types in JavaScript
- Extracting repeated contracts into shared typedefs or `.d.ts`
- Replacing `any` with something narrower
- Building type guards and discriminated unions
- Aligning static typing with JSON Schema or runtime schema boundaries

## When Not To Use

- The task is purely documentation with no structural type change
- The task is strict-lane stabilization across configs; use `typing-node24-esm-tsserver`

## Inputs / Preconditions

- Confirm whether the type is local or shared
- Prefer existing contracts in `src/types/**/*.d.ts` when they already exist
- Keep runtime behavior unchanged unless the task explicitly asks otherwise

## Workflow

1. Start in JS with JSDoc.
2. Narrow `unknown` with type guards or shape checks instead of dropping to `any`.
3. Promote only genuinely shared types to `src/types/**/*.d.ts`.
4. Keep file-local types local when they serve one module.
5. Use declaration emit (`typecheck:declarations`) to validate public JS APIs.
6. Align JSON payload artifacts with JSON Schema, not with ad-hoc object comments alone.
7. Para `src/dashboard-ui`: rodar `npm run typecheck:dashboard` (vue-tsc --noEmit); consultar a
   skill `vue-tsc-dashboard` para tipagem de SFCs, props, emits e stores Pinia.

## Guardrails

- JS-first, TS later: do not migrate files to `.ts` unless there is a concrete payoff.
- Do not replace dynamic but valid contracts with fake certainty.
- Do not spread identical typedefs across multiple files.
- Do not introduce `@ts-ignore`.

## Validation / Done Criteria

- Types are narrower than `any` where feasible.
- Shared types live in one place.
- Public contracts stay consistent with declaration emit and schema layers.
- `typecheck:repo` remains green.

## Related Skills

- [`../jsdoc-authoring/SKILL.md`](../jsdoc-authoring/SKILL.md)
- [`../typing-node24-esm-tsserver/SKILL.md`](../typing-node24-esm-tsserver/SKILL.md)
- [`../strict-lane-governance/SKILL.md`](../strict-lane-governance/SKILL.md)
- [`../vue-tsc-dashboard/SKILL.md`](../vue-tsc-dashboard/SKILL.md)
- [`../schema-contract-governance/SKILL.md`](../schema-contract-governance/SKILL.md)
- [`../../../DOCUMENTAÇÃO/REFERENCIA/TYPING_INDEX.md`](../../../DOCUMENTAÇÃO/REFERENCIA/TYPING_INDEX.md)
