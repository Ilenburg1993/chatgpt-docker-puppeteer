---
name: lsp-ops
description:
  Canonic skill for the repository's local tsserver wrapper operations. Use for semantic navigation,
  diagnostics, code actions, and contract-aligned LSP tooling updates.
license: MIT
---

# Skill — LSP Ops

## Overview

This skill documents the local wrapper around TypeScript language services implemented in
`src/integration/lsp/tsserver-daemon.mjs`.

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
- Treat `ts.server.protocol` as the semantic base, and the local schema as the wrapper contract

## Workflow

1. Confirm the daemon operation list.
2. Confirm the schema operation list.
3. Keep this skill aligned with both.
4. Run `npm run analyze:tsserver-contract` after changes.

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

## Validation / Done Criteria

- `npm run analyze:tsserver-contract` returns `0`.
- This skill lists the same operations as the schema and the daemon.

## Related Skills

- [`../typing-node24-esm-tsserver/SKILL.md`](../typing-node24-esm-tsserver/SKILL.md)
- [`../schema-contract-governance/SKILL.md`](../schema-contract-governance/SKILL.md)
- [`../../../DOCUMENTAÇÃO/REFERENCIA/TYPING_INDEX.md`](../../../DOCUMENTAÇÃO/REFERENCIA/TYPING_INDEX.md)
