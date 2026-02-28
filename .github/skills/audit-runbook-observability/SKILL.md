---
name: audit-runbook-observability
user-invokable: true
description:
  'Use for day-to-day operation of the audit pipeline: semantic preflight, quick/deep/nightly
  execution, reading artifacts/events/progress, and troubleshooting MCP/RAG/LSP readiness.'
---

# Audit Runbook Observability

## Overview

Skill canônico para operação diária do pipeline de auditoria. Ele cobre preflight, baseline
operacional, execução controlada, leitura de artefatos e troubleshooting de `pm2`, `mcp`, `rag` e
`lsp`.

## Recommended Tuple

- `audit_mode=observability`
- `profile=quick|deep|nightly`
- `proposal_depth=off`

## When To Use

- Executar a rodada de auditoria com previsibilidade.
- Coletar baseline operacional antes e depois da rodada.
- Diagnosticar degradação de tooling e runs parciais.
- Ler `events.jsonl`, `progress.json`, `summary.md` e `audit_report_*.json`.

## When Not To Use

- Não usar para causa-raiz de bug reportado; escalar para `reactive-bug-audit`.
- Não usar para caça proativa; escalar para `exploratory-bug-hunt`.
- Não usar para revisão de segurança ou performance como foco principal.

## Inputs / Preconditions

- `npm run audit:preflight`
- tracker canônico: `DOCUMENTAÇÃO/BUGS/CODEX_AUDIT_TRACKER.md`
- artefatos em `artifacts/audit/runs/<run_id>/`
- referências detalhadas:
  - `references/command-matrix.md`
  - `references/preflight-failure-matrix.md`

## Workflow

1. Rodar preflight semântico e registrar estado inicial.
2. Coletar baseline de `pm2`, `mcp` e `rag`.
3. Executar o script correto para o objetivo (`audit:observability`, `audit:quick`, `audit:deep`,
   `audit:nightly`).
4. Ler o report com foco em `audit_mode`, `collector_plan`, `semantic_preflight`, `quality_execution`
   e `shadow_gate`.
5. Recoletar baseline final e registrar delta, risco residual e anomalias.

## Guardrails

- Tratar JSON e artefatos como fonte primária; nunca basear a conclusão em log solto.
- Se `shadow_gate.would_block=true`, abrir ação corretiva explícita.
- Se `rag` ou `lsp` estiver degradado, registrar o modo de fallback e o risco no tracker.
- Não usar este skill para aplicar patches.

## Validation / Done Criteria

- `audit_report` válido com `audit_mode=observability` ou baseline equivalente.
- `semantic_preflight` registrado.
- `collector_plan` e `phase_status` coerentes com a execução.
- Baseline início/fim registrado no tracker.

## Related Skills

- Escalar para `reactive-bug-audit` quando houver incidente específico.
- Escalar para `audit-proposal-deep-triage` quando um P0/P1 precisar de proposta robusta.
