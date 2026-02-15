---
name: audit-contracts-v3-ops
description: "Use when the task involves Contract Registry v3: creating/migrating contracts DSL, checking hybrid parity, calibrating enforce levels, validating coverage/drift, and preparing rollout from warn to blocking."
---

# Audit Contracts v3 Ops

## When To Use
- Definir ou alterar contratos em `contracts/domains/*.json`.
- Migrar regra legada para DSL canônica.
- Investigar divergência DSL vs legado (`contracts-mode=hybrid`).
- Ajustar `enforce-level` e estratégia de rollout.
- Revisar cobertura/drift de contratos no relatório da auditoria.

## Canonical Workflow
1. Validar registry.
- Rodar `node scripts/check_forbidden_patterns.js --json --contracts-mode hybrid --parity-mode`.
- Confirmar `registry.errors=[]`.

2. Ajustar contrato.
- Atualizar domínio em `contracts/domains/*.json`.
- Definir `id`, `kind`, `severity_default`, `type_default`, `owner`, `enforcement.level`, `test_recipe`.

3. Validar cobertura operacional.
- Rodar `npm run audit:quick -- --json --shadow-gate true`.
- Verificar `contract_coverage`, `contract_drift`, `contract_parity`.

4. Fechar governança.
- Garantir `owner` em contratos `P0/P1`.
- Atualizar documentação canônica em `DOCUMENTAÇÃO/BUGS/PLANO_MESTRE_CONTRATOS_V3.md`.

## Guardrails
- Contrato crítico (`P0/P1`) sem `owner` é inválido para rollout.
- Sem `test_recipe`, contrato não pode ficar `active`.
- Em `hybrid`, divergência de paridade deve ser tratada antes de aumentar enforcement.

## Done Criteria
- Contrato ativo carregado sem erro.
- Evidência de cobertura no `audit_report`.
- Drift sem novos `unowned_critical`.
