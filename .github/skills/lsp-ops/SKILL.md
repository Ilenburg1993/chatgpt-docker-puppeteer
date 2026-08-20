---
name: lsp-ops
description:
  Compatibility skill for the repository's opt-in TypeScript 7 native LSP wrapper. Use only when
  maintaining its contract; the wrapper is disabled by default.
license: MIT
---

# Skill — LSP Ops

## Overview

This skill documents the preserved local wrapper around the native TypeScript 7 LSP implemented in
`src/integration/lsp/tsgo-lsp-daemon.mjs`. It is disabled by default and is not the editor path.

The canonical contract lives in:

- [`../../../schemas/typing/tsserver-tool-contract.schema.json`](../../../schemas/typing/tsserver-tool-contract.schema.json)
- [`../../../DOCUMENTAÇÃO/REFERENCIA/TYPING_JSDOC_CANON.md`](../../../DOCUMENTAÇÃO/REFERENCIA/TYPING_JSDOC_CANON.md)
- [`../../../DOCUMENTAÇÃO/REFERENCIA/TYPING_SCHEMA_TSSERVER_CANON.md`](../../../DOCUMENTAÇÃO/REFERENCIA/TYPING_SCHEMA_TSSERVER_CANON.md)

## When To Use

- Reviewing or extending the local LSP wrapper
- Aligning MCP-facing LSP behavior with the daemon
- Auditing operation drift between code, schema, and skill docs

## When Not To Use

- Plain text search is enough
- The task is editor usage, not repository wrapper maintenance

## Inputs / Preconditions

- Read the daemon dispatch table first
- Read the schema before changing operation names
- Treat the standard LSP methods exposed by `tsc --lsp --stdio` as the semantic base and the local
  schema as the compatibility contract

## Workflow

1. Confirm the daemon operation list.
2. Confirm the schema operation list.
3. Keep this skill aligned with both.
4. Keep `LSP_ENABLED=false` and `LSP_MUTATIONS_ENABLED=false` as defaults.
5. Run `npm run analyze:tsserver-contract` after changes.

## Supported Operations

- `definition`: find the definition location for a symbol.
- `references`: list references for a symbol.
- `hover`: return quick info / hover payload.
- `document_symbols`: enumerate symbols in one file.
- `workspace_symbols`: search symbols across the workspace.
- `diagnostics`: collect syntactic, semantic, and suggestion diagnostics.
- `code_actions`: list fix candidates for a range.
- `completion`: collect completion entries at a position.
- `updateFile`: replace in-memory/on-disk file content for the wrapper.
- `apply_code_action`: preview or apply an action payload, subject to mutation guards.

## Guardrails

- Do not add an operation here unless it exists in the daemon dispatch table.
- Do not rename operations without updating schema and audit tooling.
- Do not bypass workspace path guards or mutation guards.
- Do not start, probe, or require the wrapper unless `LSP_ENABLED=true` was explicit for that
  process.

## Validation / Done Criteria

- `npm run analyze:tsserver-contract` returns `0`.
- This skill lists the same operations as the schema and the daemon.

## Related Skills

- [`../typing-node24-esm-tsserver/SKILL.md`](../typing-node24-esm-tsserver/SKILL.md)
- [`../schema-contract-governance/SKILL.md`](../schema-contract-governance/SKILL.md)
- [`../../../DOCUMENTAÇÃO/REFERENCIA/TYPING_INDEX.md`](../../../DOCUMENTAÇÃO/REFERENCIA/TYPING_INDEX.md)
