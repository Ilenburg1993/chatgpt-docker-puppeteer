---
name: audit-proposal-deep-triage
description:
  'Use for deep triage and proposal generation in audit findings: contextual diff suggestion,
  root-cause ranking, test-plan synthesis, rollback guidance, and regression-risk framing.'
---

# Audit Proposal Deep Triage

## When To Use

- Refinar propostas para achados `P0/P1`.
- Melhorar qualidade de `suggested_diff`, `test_plan` e `rollback_hint`.
- Reduzir proposta genérica sem contexto de arquivo/linha.
- Ajustar confiança e risco de regressão com base em evidência convergente.

## Canonical Workflow

1. Coletar contexto.

- Finding + `code_context` + `rag` + `lsp` + histórico do master.
- Vincular com tracker vivo (`DOCUMENTAÇÃO/BUGS/CODEX_AUDIT_TRACKER.md`).

2. Ranquear causa-raiz.

- Gerar Top 3 causas com score.
- Priorizar contrato explícito e evidências runtime/test.

3. Gerar proposta.

- `summary` objetivo.
- `suggested_diff` textual não aplicado, contextualizado por linha.
- `validation_commands` e `test_plan` específicos.
- `rollback_hint` simples e executável.
- Metadados mínimos obrigatórios na proposta:
  - `bug_id`
  - `status`
  - `severity`
  - `tracker_ref`
  - `rollback_hint`
  - `validation_commands`

4. Validar consistência.

- Proposta precisa apontar arquivo afetado.
- Evitar causas irrelevantes fora de `src/` e `scripts/`.
- Confirmar que proposta está refletida no tracker/snapshot da rodada.

## Guardrails

- Não aplicar patch automaticamente.
- Se contexto semântico estiver degradado, marcar confiança reduzida e usar fallback determinístico.
- Não publicar proposta P0/P1 sem comando objetivo de validação e caminho de rollback.

## Done Criteria

- Todo `P0/P1` com proposta estruturada completa.
- `proposal_context` preenchido (`code_context_used`, `rag_scope`, `lsp_signal_quality`).
- Proposta vinculada no tracker com `bug_id` e status atualizado.
