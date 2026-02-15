---
name: audit-runbook-observability
description: "Use for day-to-day operation of the audit pipeline: semantic preflight, quick/deep/nightly execution, reading artifacts/events/progress, and troubleshooting MCP/RAG/LSP readiness."
---

# Audit Runbook Observability

## When To Use
- Executar auditoria com previsibilidade operacional.
- Diagnosticar falha de preflight (`pm2`, `mcp`, `rag`, `lsp`).
- Acompanhar progresso/ETA/heartbeats e trilha de artefatos.
- Investigar runs parciais e degradação de tooling.

## Canonical Workflow
1. Preflight semântico.
- `npm run audit:preflight`
- Confirmar `components.pm2/mcp/rag/lsp.ok`.

2. Execução por objetivo.
- Rápida: `npm run audit:quick`
- Shadow explícito: `npm run audit:quick:shadow`
- Profunda: `npm run audit:deep`
- Noturna: `npm run audit:nightly`

3. Leitura de artefatos.
- Pasta: `artifacts/audit/runs/<run_id>/`
- Arquivos mínimos: `events.jsonl`, `progress.json`, `audit_report_*.json`, `summary.md`.

4. Troubleshooting.
- MCP: `npm run mcp:diagnose`
- LSP funcional: `npm run lsp:health -- --json`
- RAG: `npm run rag:health -- --json`

## Guardrails
- Pipeline nesta fase é não-bloqueante, mas `shadow_gate.would_block=true` exige ação.
- Não confiar em log solto; usar sempre JSON/artefatos como fonte primária.

## Done Criteria
- Run finalizada com `report` válido.
- `semantic_preflight` registrado.
- `shadow_gate` e `gate_decision` presentes e coerentes.
