# Typing and JSDoc Canon

## Purpose

This document is the normative source of truth for typing, JSDoc, contract layering, and the
governance automation around them.

Use this file when the question is:

- which contract layer is canonical
- where a rule must live
- which scripts and gates are part of the supported interface
- what "done" means for typing and JSDoc

This file is normative. Supporting documents may explain, index, or operationalize it, but they
must not compete with it.

## Scope

This canon governs:

- JS-first static contracts in `src/**`, `scripts/**`, and `tests/**`
- shared type declarations in `src/types/**`
- typing schemas in `schemas/typing/**`
- typing and JSDoc audits in `scripts/analysis/**`
- governance checks in `scripts/ci/**`
- the canonical workflow in `.github/workflows/jsdoc-typing.yml`
- typing/JSDoc skills in `.github/skills/**`

This canon does not authorize broad runtime redesign, large-scale `.ts` migration, or parallel
governance systems.

## Source of Truth by Layer

### JS source contracts

- Canonical layer: TypeScript-supported JSDoc plus `// @ts-check`
- Source location: the `.js`, `.mjs`, or `.cjs` file that owns the API
- Use when: the contract is local to one module or directly expressed by a JS-first export

### Shared static types

- Canonical layer: `src/types/**/*.d.ts`
- Source location: the shared declaration file that owns the reused contract
- Use when: the same type is reused across modules, represents a stable external contract, or is
  needed for declaration emit fidelity

### JSON artifacts

- Canonical layer: JSON Schema Draft 2020-12 in `schemas/typing/**`
- Source location: the versioned local schema file
- Use when: the artifact is JSON exchanged by CI, scripts, reports, or tooling envelopes

### Runtime validation

- Canonical layer: Zod only where validation must execute at runtime
- Source location: the runtime module that parses or validates external input
- Use when: the contract must be enforced during execution

### Local tsserver wrapper

- Semantic source of truth: `ts.server.protocol` in `node_modules/typescript/lib/typescript.d.ts`
- Local wrapper envelope: `schemas/typing/tsserver-tool-contract.schema.json`
- Use when: the repository models the local wrapper around TypeScript language services

JSON Schema never replaces TypeScript semantics. JSDoc never replaces runtime validation. `.d.ts`
never replaces file-local JSDoc when the type is not shared.

## Frozen Architecture

### Static checking layer

- `tsconfig.base.json`: semantic base
- `tsconfig.node.json`, `tsconfig.browser.json`, `tsconfig.tools.json`, `tsconfig.tests.json`:
  family configs
- `tsconfig.strict.json`: strict workspace solution only
- `config/typing/strict/tsconfig.strict.*.json`: operational strict lanes
- `config/typing/strict/tsconfig.strict.public.json`: normative public-contract lane
- `tsconfig.declarations.json`: declaration emit validator for public JS-first APIs

### Contract layer

- JSDoc is the first layer for JS contracts
- `.d.ts` is the shared layer
- JSON Schema is the artifact layer
- `ts.server.protocol` is the semantic base for the local LSP wrapper
- Zod is the runtime execution layer

### Measurement and audit layer

- `scripts/analysis/jsdoc_coverage_engine.mjs`: measurement engine
- `scripts/analysis/jsdoc_coverage_cli.mjs`: canonical JSDoc report CLI
- `scripts/analysis/typing/typing_hardening_audit.mjs`: aggregate quality audit
- `scripts/analysis/typing/tsserver_contract_audit.mjs`: wrapper drift audit

### Governance layer

- `.github/workflows/jsdoc-typing.yml`: canonical blocking gate
- `check:schemas:typing`: schema and report integrity
- `check:skills:strict`: skill governance integrity
- `typecheck:*`, `jsdoc:coverage:*`, and `analyze:*`: supported internal automation interface

### Human instruction layer

- `.github/skills/**`: canonical instruction set
- `.codex/skills/**`: compatibility stubs only
- `DOCUMENTAÇÃO/REFERENCIA/**`: live reference
- `DOCUMENTAÇÃO/PLANOS/**`: active plans and transitions
- `DOCUMENTAÇÃO/ARQUIVO_MORTO/**`: historical only

## Normative Rules

### Public code contracts

- Every public JS-first API uses TypeScript-supported JSDoc.
- Every exported public function requires complete `@param` tags and `@returns`.
- Any public options object requires a named typedef.
- `Object`, `Array`, `Function`, `Promise<any>`, and `any` are not allowed in consolidated public
  JSDoc unless the dynamic contract is explicitly intentional and documented as such.
- `unknown` is allowed only at unsafe boundaries, with narrowing in the same module or via a local
  guard.

### Shared type promotion

Promote a type into `src/types/**` only when at least one of the following is true:

- it is reused by multiple modules
- it models a stable external contract
- declaration emit needs it to avoid a vague public surface

If none of those conditions is true, keep the type local to the owning module.

### Schema governance

- A typing schema exists only for JSON artifacts or wrapper envelopes.
- Every schema in `schemas/typing/**` has one clear consumer, one validator path, and a versioned
  contract surface.
- Schema version bumps follow semantic intent:
  - breaking structural change: major
  - additive compatible change: minor
  - non-structural clarification: patch or documentation only

### Directive policy

- `@ts-ignore` is prohibited.
- `@ts-expect-error` is allowed only under explicit allowlist policy and must remain countable by
  automation.

## Canonical Automation Interface

The following commands are part of the supported repository contract and may not change silently:

- `typecheck:repo`
- `typecheck:strict:public`
- `typecheck:strict:all`
- `typecheck:declarations`
- `jsdoc:coverage:json`
- `jsdoc:coverage:public`
- `analyze:typing`
- `analyze:typing:public`
- `analyze:tsserver-contract`
- `check:schemas:typing`
- `check:skills:strict`

Changing any of these commands requires a governance update in this canon, the automation index,
and the relevant skill documentation.

## Canonical CI Gate

The typing/JSDoc workflow remains blocking and uses this ordered contract:

1. `npm ci`
2. `npm run typecheck:repo`
3. `npm run typecheck:strict:public`
4. `npm run typecheck:strict:all`
5. `npm run typecheck:declarations`
6. `npm run jsdoc:coverage:json`
7. `npm run jsdoc:coverage:public`
8. `npm run check:schemas:typing`
9. `npm run analyze:typing`
10. `npm run analyze:typing:public`
11. `npm run check:skills:strict`

The workflow summary is part of the operational contract and must report:

- gate statuses
- `@ts-check` coverage
- strict lane counts
- `unsafe_generic_tags_total`
- schema validation status
- skill governance status
- public contract metrics

## Ownership Model

Ownership is by function, not by individual:

- Typing canon owner: repository maintainers responsible for static contract governance
- Schema owner: maintainers of the producing script or wrapper
- Skill owner: maintainers of the canonical `.github/skills/**` content
- CI owner: maintainers of `.github/workflows/jsdoc-typing.yml` and `scripts/ci/**`

Every future typing artifact must have one clear owner role before it becomes canonical.

## Definition of Done

Typing/JSDoc is considered completed and consolidated only when all of the following are true:

- source-of-truth layering is documented once and only once
- canonical docs are indexed and historical docs are clearly non-normative
- canonical skills point to this document
- schemas are versioned and tied to explicit validators
- canonical scripts are listed and treated as stable interface
- the blocking workflow reflects the same contract as the docs and skills
- no critical rule exists only in an old plan, historical note, or implicit tribal knowledge
- residual implementation work can be treated as execution backlog rather than architectural
  discovery

## Change Control

Any future governance change in typing/JSDoc must update, in the same change set:

- this canon
- [`TYPING_CONTRACT_MATRIX.md`](./TYPING_CONTRACT_MATRIX.md)
- [`TYPING_AUTOMATION_INDEX.md`](./TYPING_AUTOMATION_INDEX.md)
- the affected canonical skill(s)
- the affected CI or validation script(s)

If a change does not satisfy that bundle, it is not considered a complete governance change.

## Related Documents

- [`TYPING_INDEX.md`](./TYPING_INDEX.md)
- [`TYPING_CONTRACT_MATRIX.md`](./TYPING_CONTRACT_MATRIX.md)
- [`TYPING_AUTOMATION_INDEX.md`](./TYPING_AUTOMATION_INDEX.md)
- [`TYPING_SCHEMA_TSSERVER_CANON.md`](./TYPING_SCHEMA_TSSERVER_CANON.md)
- [`../PLANOS/TYPING_CANON_LIFECYCLE.md`](../PLANOS/TYPING_CANON_LIFECYCLE.md)
