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

2. Baseline operacional obrigatório (início da rodada).
- `npm run daemon:status`
- `npm run mcp:diagnose`
- `npm run rag:health -- --json`
- Registrar baseline no tracker:
  - `DOCUMENTAÇÃO/BUGS/CODEX_AUDIT_TRACKER.md`

3. Execução por objetivo.
- Rápida: `npm run audit:quick`
- Rápida (quality full): `npm run audit:quick:full`
- Rápida (quality changed-only forçado): `npm run audit:quick:changed`
- Rápida (quality serial / tuning): `npm run audit:quick:serial`
- Rápida (quality sem cache / baseline): `npm run audit:quick:cache-off`
- Quality-focused (tuning): `npm run audit:quality`
- Shadow explícito: `npm run audit:quick:shadow`
- Profunda: `npm run audit:deep`
- Profunda com foco JSDoc full: `npm run audit:deep:jsdoc`
- Noturna: `npm run audit:nightly`

4. Leitura de artefatos.
- Pasta: `artifacts/audit/runs/<run_id>/`
- Arquivos mínimos: `events.jsonl`, `progress.json`, `audit_report_*.json`, `summary.md`.
- Ler também no `audit_report`:
  - `quality_execution.strategy/risk`
  - `quality_execution.cache`
  - `quality_execution.parallelism`
  - `quality_execution.dedup`
  - `quality_gates.*`
  - `contract_coverage.quality`

5. Troubleshooting.
- MCP: `npm run mcp:diagnose`
- LSP funcional: `npm run lsp:health -- --json`
- RAG: `npm run rag:health -- --json`

6. Baseline final obrigatório (fim da rodada).
- Reexecutar:
  - `npm run daemon:status`
  - `npm run mcp:diagnose`
  - `npm run rag:health -- --json`
- Atualizar tracker com delta início/fim e risco residual.

## Guardrails
- Pipeline nesta fase é não-bloqueante, mas `shadow_gate.would_block=true` exige ação.
- Não confiar em log solto; usar sempre JSON/artefatos como fonte primária.
- Se `rag:health.ok=false`, seguir em modo lexical/fallback e marcar risco explicitamente no tracker.
- Toda rodada deve gerar ou atualizar snapshot em `DOCUMENTAÇÃO/BUGS/rodadas/`.
- Em tuning de performance do quick, comparar pares de runs (`cache miss` vs `cache hit`) e registrar deltas de `duration_ms_total` + `quality_execution.cache`.

## Done Criteria
- Run finalizada com `report` válido.
- `semantic_preflight` registrado.
- `shadow_gate` e `gate_decision` presentes e coerentes.
- Baseline de início/fim registrado em `CODEX_AUDIT_TRACKER.md`.
