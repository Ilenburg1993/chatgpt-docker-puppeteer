---
name: audit-proposal-deep-triage
description: "Use for deep triage and proposal generation in audit findings: contextual diff suggestion, root-cause ranking, test-plan synthesis, rollback guidance, and regression-risk framing."
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

2. Ranquear causa-raiz.
- Gerar Top 3 causas com score.
- Priorizar contrato explícito e evidências runtime/test.

3. Gerar proposta.
- `summary` objetivo.
- `suggested_diff` textual não aplicado, contextualizado por linha.
- `validation_commands` e `test_plan` específicos.
- `rollback_hint` simples e executável.

4. Validar consistência.
- Proposta precisa apontar arquivo afetado.
- Evitar causas irrelevantes fora de `src/` e `scripts/`.

## Guardrails
- Não aplicar patch automaticamente.
- Se contexto semântico estiver degradado, marcar confiança reduzida e usar fallback determinístico.

## Done Criteria
- Todo `P0/P1` com proposta estruturada completa.
- `proposal_context` preenchido (`code_context_used`, `rag_scope`, `lsp_signal_quality`).
