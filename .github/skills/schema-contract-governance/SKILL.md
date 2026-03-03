---
name: schema-contract-governance
description:
  Use when the task is deciding or enforcing which contract layer the repository should use: JSDoc,
  shared .d.ts, JSON Schema, Zod, or ts.server.protocol.
license: MIT
---

# Skill — Schema Contract Governance

## Overview

This skill governs contract layering in the repository.

It answers:

- when JSDoc is enough
- when a shared `.d.ts` is warranted
- when JSON Schema is the correct artifact contract
- when Zod belongs at runtime
- when `ts.server.protocol` is the semantic source instead of a local schema

## When To Use

- Designing or revising report schemas
- Hardening tooling envelopes
- Deciding whether to introduce or reuse a shared type
- Avoiding overlap between runtime validation and static typing

## When Not To Use

- The task is only a local code fix with an obvious existing contract pattern

## Inputs / Preconditions

- Identify the consumer: runtime, static checker, CI artifact, or external tooling.
- Prefer existing canonic layers before introducing a new one.

## Workflow

1. If the contract is a code API in JS, start with JSDoc.
2. If the type is reused across modules, promote it to `.d.ts`.
3. If the artifact is JSON exchanged between scripts/CI/tools, use JSON Schema.
4. If the validation is runtime-facing, use Zod where the code already validates inputs.
5. If the surface is the local tsserver wrapper, map to `ts.server.protocol` and only schema the wrapper envelope.

## Guardrails

- Do not use JSON Schema as a substitute for TypeScript semantics.
- Do not create a `.d.ts` for a type that is clearly file-local.
- Do not use Zod just to document build artifacts.

## Validation / Done Criteria

- Every contract layer has one clear source of truth.
- Schema files are versioned and validated.
- Static and runtime contracts are not duplicating each other unnecessarily.

## Related Skills

- [`../jsdoc-authoring/SKILL.md`](../jsdoc-authoring/SKILL.md)
- [`../typescript-typing/SKILL.md`](../typescript-typing/SKILL.md)
- [`../typing-node24-esm-tsserver/SKILL.md`](../typing-node24-esm-tsserver/SKILL.md)
