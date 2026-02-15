---
name: rag-mcp-lsp-ops
description: "Use this skill when tasks involve RAG/MCP/LSP operations in this repository: bringing PM2 + MCP online, diagnosing MCP availability, rebuilding RAG from zero, and validating semantic tooling readiness for coding workflows."
---

# RAG MCP LSP Ops

## Overview
This skill defines the canonical operational workflow for RAG + MCP + LSP in this repository. Use it when the assistant needs reliable code-context retrieval, semantic navigation readiness, or full RAG rebuild.
For contract governance, runbook observability and deep proposal generation, combine with:
- `audit-contracts-v3-ops`
- `audit-runbook-observability`
- `audit-proposal-deep-triage`

## When To Use
- User asks to rebuild/reindex RAG.
- MCP tools are unavailable or inconsistent.
- LSP tools need validation before deeper coding work.
- Assistant must prepare runtime (`pm2`, `server`, `mcp`) before coding tasks that depend on tool context.

## Canonical Workflow
1. Preflight runtime.
- Check Ollama local: `curl http://host.docker.internal:11434/api/version`
- Ensure PM2 runtime: `npm run daemon:start`
- Wait endpoints: `GET /health` and `GET /api/mcp` on `http://localhost:3008`
2. Diagnose MCP.
- Run `npm run mcp:diagnose`
- Confirm required tools (`rag_*`, `ollama_*`, `lsp_*`) are listed.
3. Rebuild RAG from zero.
- Run `npm run rag:rebuild:zero`
- If needed, force profile full manually: `npm run rag:index -- --profile full`
- For scope control, use the same flags across rebuild/index/watch:
  - `--docs-mode include|exclude|only`
  - `--include-glob` / `--exclude-glob` (repeatable)
  - `--max-file-bytes`
- Recommended phased indexing:
  - Code/config first (no markdown): `npm run rag:index -- --profile full --docs-mode exclude`
  - Docs later: `npm run rag:index -- --profile full --docs-mode only`
4. Validate usable retrieval.
- Execute one `rag_search` smoke call over MCP (`tools/call`) and confirm non-error response.
5. Continue coding flow.
- For normal coding queries use `profile=core`.
- Reserve `profile=full` for rebuild/reindex and wide investigation.

## Tooling Policy
- Prefer MCP tools before broad local text search when task is semantic code understanding:
  - `rag_search` first for recall.
  - Then `lsp_definition`, `lsp_references`, `lsp_hover`, `lsp_diagnostics`.
- Daily coding order:
  - Symbol/API-level navigation: LSP (`lsp_*`) first.
  - Broad cross-file context: `rag_search`.
  - If embeddings are degraded: keep working in lexical mode temporarily, with diagnostics enabled.
- If MCP is down, recover via canonical preflight, then retry MCP tools.

## Failure Handling
- `mcp:diagnose` failing:
  - Recheck PM2 status (`npm run daemon:status`)
  - Re-run `npm run daemon:restart`
  - Re-run `npm run mcp:diagnose`
- RAG health failing:
  - Confirm `OLLAMA_LOCAL_BASE_URL`
  - Run `npm run rag:rebuild:zero`
- Long rebuild:
  - Keep process running; full profile can take minutes.
  - If markdown volume is delaying index, run with `--docs-mode exclude` and process docs in a second pass.

## Command Reference
- `npm run daemon:start`
- `npm run daemon:status`
- `npm run mcp:diagnose`
- `npm run rag:rebuild:zero`
- `npm run rag:rebuild:zero -- --docs-mode exclude`
- `npm run rag:health -- --json`
- `npm run rag:index -- --profile full --docs-mode only`

## Done Criteria
- PM2 shows `agente-gpt`, `dashboard-web`, `chrome-proxy` online.
- `http://localhost:3008/api/mcp` responds.
- `mcp:diagnose` passes.
- RAG rebuild completes with exit code `0`.
