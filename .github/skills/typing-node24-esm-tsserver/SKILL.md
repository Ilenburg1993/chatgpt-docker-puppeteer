---
name: typing-node24-esm-tsserver
description:
  Phase 2 orchestration skill for typing hardening in this repository: strict multi-lane configs,
  declaration emit, JSDoc coverage, tsserver wrapper contracts, and CI validation.
license: MIT
---

# Skill — Typing Node24 ESM TS Server (Phase 2 Orchestrator)

## Overview

This is the orchestration skill for repository-wide typing hardening.

It covers:

- `typecheck:repo`
- `typecheck:strict:*`
- `typecheck:declarations`
- `jsdoc:coverage:json`
- `analyze:typing`
- `check:skills:strict`
- tsserver wrapper contract drift

## When To Use

- Stabilizing or extending strict lanes
- Hardening public JS contracts
- Updating the tsserver wrapper, schemas, or LSP skills
- Enforcing typing/JSDoc CI gates

## When Not To Use

- A small local JSDoc-only edit is sufficient
- The task is purely MCP usage, without changing the local wrapper or contracts

## Inputs / Preconditions

- Treat `tsconfig*.json` as the source of truth for static checking.
- Treat `ts.server.protocol` in `node_modules/typescript/lib/typescript.d.ts` as the official
  semantic source for tsserver protocol names.
- Treat `schemas/typing/*.schema.json` as the contract layer for local JSON artifacts and wrapper
  envelopes.

## Workflow

1. Run `npm run typecheck:repo`.
2. Run `npm run typecheck:strict:all`.
3. Run `npm run typecheck:declarations`.
4. Run `npm run jsdoc:coverage:json -- --validate-schema`.
5. Run `npm run analyze:typing`.
6. Run `npm run analyze:tsserver-contract`.
7. Run `npm run check:skills:strict`.

## Guardrails

- Keep runtime JS-first unless a `.d.ts` or tiny auxiliary TS artifact is clearly justified.
- Do not weaken strict lanes just to hide errors.
- Do not invent a parallel tsserver protocol; map local operations to the wrapper only.
- Do not treat SchemaStore as the semantic authority for TypeScript behavior.

## Validation / Done Criteria

- Every strict lane is green.
- Declaration emit is green.
- JSDoc report validates against schema.
- `analyze:typing` meets phase 2 thresholds.
- Daemon, schema, and `lsp-ops` remain in sync.

## Related Skills

- [`../jsdoc-authoring/SKILL.md`](../jsdoc-authoring/SKILL.md)
- [`../typescript-typing/SKILL.md`](../typescript-typing/SKILL.md)
- [`../lsp-ops/SKILL.md`](../lsp-ops/SKILL.md)
- [`../schema-contract-governance/SKILL.md`](../schema-contract-governance/SKILL.md)
