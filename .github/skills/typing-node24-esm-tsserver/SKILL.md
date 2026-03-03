---
name: typing-node24-esm-tsserver
description: Full-Strict Roadmap orchestration skill for typing hardening in this repository. Covers strict multi-lane configs, declaration emit, JSDoc coverage, tsserver wrapper contracts, dashboard vue-tsc, and CI gates.
license: MIT
---

# Skill — Typing Node24 ESM TS Server (Full-Strict Roadmap Orchestrator)

## Overview

This is the orchestration skill for repository-wide typing hardening.

The normative repository canon lives in:

- [`../../../DOCUMENTAÇÃO/REFERENCIA/TYPING_JSDOC_CANON.md`](../../../DOCUMENTAÇÃO/REFERENCIA/TYPING_JSDOC_CANON.md)

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

1. Run `npm run typecheck:repo` (inclui `typecheck:dashboard` a partir da Fase 2 do roadmap).
2. Run `npm run typecheck:strict:all`.
3. Run `npm run typecheck:declarations`.
4. Run `npm run jsdoc:coverage:json -- --validate-schema`.
5. Run `npm run analyze:typing` + `npm run analyze:typing:gaps` para ver arquivos sem cobertura.
6. Run `npm run analyze:tsserver-contract`.
7. Run `npm run check:skills:strict`.
8. Run `npm run typecheck:dashboard` para validar SFCs Vue em `src/dashboard-ui`.
9. Run `npm run jsdoc:coverage:gaps` para listar símbolos bloqueadores por lote.
10. Run `npm run check:ts-expect-error` para garantir allowlist zerada.
11. Run `npm run check:base-strict` (passe com `continue-on-error: true` até a Fase 5).

## Guardrails

- Keep runtime JS-first unless a `.d.ts` or tiny auxiliary TS artifact is clearly justified.
- Do not weaken strict lanes just to hide errors.
- Do not invent a parallel tsserver protocol; map local operations to the wrapper only.
- Do not treat SchemaStore as the semantic authority for TypeScript behavior.

## Validation / Done Criteria

As três condições de encerramento do programa full-strict (todas devem ser `true` simultaneamente):

- [ ] **100 % de cobertura** — `js_files_missing_ts_check_total = 0` (incluindo legacy).
- [ ] **Zero backlog JSDoc** — `functions_missing_param_tags = 0`, `unsafe_generic_tags_total = 0`,
      `public_any_tags_total = 0`.
- [ ] **Base strict** — `tsconfig.base.json` tem `strict: true`; `check:base-strict` verde.

Critérios contínuos (devem ser verdes em toda PR):

- [ ] Todas as lanes strict são verdes (`typecheck:strict:all`).
- [ ] Declaration emit verde (`typecheck:declarations`).
- [ ] Relatório JSDoc valida contra schema (`jsdoc:coverage:json -- --validate-schema`).
- [ ] `typecheck:dashboard` verde (vue-tsc --noEmit em `src/dashboard-ui`).
- [ ] `check:ts-expect-error` verde (sem ocorrências não-allowlistadas).
- [ ] Daemon, schema e `lsp-ops` sincronizados.

## Related Skills

- [`../jsdoc-authoring/SKILL.md`](../jsdoc-authoring/SKILL.md)
- [`../typescript-typing/SKILL.md`](../typescript-typing/SKILL.md)
- [`../strict-lane-governance/SKILL.md`](../strict-lane-governance/SKILL.md)
- [`../vue-tsc-dashboard/SKILL.md`](../vue-tsc-dashboard/SKILL.md)
- [`../lsp-ops/SKILL.md`](../lsp-ops/SKILL.md)
- [`../schema-contract-governance/SKILL.md`](../schema-contract-governance/SKILL.md)
- [TYPING_FULLSTRICT_ROADMAP.md](../../../DOCUMENTAÇÃO/PLANOS/TYPING_FULLSTRICT_ROADMAP.md)
- [`../../../DOCUMENTAÇÃO/REFERENCIA/TYPING_AUTOMATION_INDEX.md`](../../../DOCUMENTAÇÃO/REFERENCIA/TYPING_AUTOMATION_INDEX.md)
