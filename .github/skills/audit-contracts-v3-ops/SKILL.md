---
name: audit-contracts-v3-ops
description:
  'Use when the task involves Contract Registry v3: creating/migrating contracts DSL, checking
  hybrid parity, calibrating enforce levels, validating coverage/drift, and preparing rollout from
  warn to blocking.'
---

# Audit Contracts v3 Ops

## Overview

Skill canônico para contratos v3: criação, migração, paridade híbrida, cobertura, drift e rollout de
enforcement.

## Recommended Tuple

- `audit_mode=contracts`
- `profile=quick|deep`
- `proposal_depth=off|standard`

## When To Use

- Definir ou alterar contratos em `contracts/domains/*.json`.
- Ajustar contratos de quality gates em `contracts/domains/quality.json`.
- Migrar regra legada para DSL canônica.
- Investigar divergência DSL vs legado (`contracts-mode=hybrid`).
- Ajustar `enforce-level` e estratégia de rollout.
- Revisar cobertura/drift de contratos no relatório da auditoria.

## When Not To Use

- Não usar para debugging de runtime sem relação com contratos.
- Não usar como análise arquitetural geral.

## Inputs / Preconditions

- contrato alvo em `contracts/domains/*.json`
- `npm run audit:contracts` ou `npm run audit:quick -- --audit-mode contracts`
- referências:
  - `references/contract-rollout-ladder.md`
  - `references/quality-contracts-priority.md`

## Canonical Workflow

1. Validar registry.

- Rodar `node scripts/check_forbidden_patterns.js --json --contracts-mode hybrid --parity-mode`.
- Confirmar `registry.errors=[]`.

2. Ajustar contrato.

- Atualizar domínio em `contracts/domains/*.json`.
- Definir `id`, `kind`, `severity_default`, `type_default`, `owner`, `enforcement.level`,
  `test_recipe`.

3. Validar cobertura operacional.

- Rodar `npm run audit:quick -- --json --shadow-gate true`.
- Verificar `contract_coverage`, `contract_drift`, `contract_parity`.
- Para quality gates, verificar explicitamente:
  - `contract_coverage.quality`
  - findings com `contract_id=CONTRACT-QUALITY-*`
  - `quality_gates.*` e `quality_execution.*` no report

4. Fechar governança.

- Garantir `owner` em contratos `P0/P1`.
- Atualizar documentação canônica em `DOCUMENTAÇÃO/AUDITORIAS/BUGS/PLANO_MESTRE_CONTRATOS_V3.md`.

## Guardrails

- Contrato crítico (`P0/P1`) sem `owner` é inválido para rollout.
- Sem `test_recipe`, contrato não pode ficar `active`.
- Em `hybrid`, divergência de paridade deve ser tratada antes de aumentar enforcement.
- Rollout de quality contracts deve ser seletivo:
  - subir primeiro `node syntax`, `typecheck_*`, `ts-ignore`
  - manter `prettier`/`jsdoc` em `warn` até baseline calibrado

## Validation / Done Criteria

- Contrato ativo carregado sem erro.
- Evidência de cobertura no `audit_report`.
- Drift sem novos `unowned_critical`.

## Related Skills

- `audit-runbook-observability`
- `security-checklist` quando o domínio for `security`
