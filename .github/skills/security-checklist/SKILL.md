---
name: security-checklist
user-invokable: true
description:
  'Skill canônico para auditoria de segurança: segredos hardcoded, superfícies HTTP, auth,
  headers, contratos do domínio security e revisão orientada por risco.'
---

# security-checklist

## Overview

Skill de segurança para revisar superfícies HTTP, autenticação/autorização, headers, contratos do
domínio `security` e sinais estáticos de risco.

## Recommended Tuple

- `audit_mode=security`
- `profile=quick` para triagem
- `profile=deep` para revisão séria
- `proposal_depth=standard|deep`

## When To Use

- Há risco de segurança funcional ou revisão preventiva de endpoints.
- Você precisa acionar o coletor `collect-security`.
- Há necessidade de validar `contracts/domains/security.json`.

## When Not To Use

- Não usar como substituto de pentest externo.
- Não usar para tuning de performance.

## Inputs / Preconditions

- `npm run audit:security`
- domínio `contracts/domains/security.json`
- referências:
  - `references/security-contracts-map.md`
  - `references/security-review-checklist.md`

## Workflow

1. Rodar a auditoria em modo `security`.
2. Ler `security_execution`, findings e contratos associados.
3. Validar segredos hardcoded, superfícies HTTP sem auth e ausência de headers.
4. Correlacionar com contratos do domínio `security`.
5. Escalar P0/P1 para `audit-proposal-deep-triage`.

## Guardrails

- Heurística não substitui revisão manual de auth.
- Não assumir que ausência de sinal textual prova vulnerabilidade; tratar como finding investigativo.
- Vincular toda conclusão a evidência de arquivo, linha ou contrato.

## Validation / Done Criteria

- Revisão de segurança executada com achados classificados.
- Contratos do domínio `security` considerados no parecer.
- Mitigação, patch ou backlog com risco residual documentado.

## Related Skills

- `audit-contracts-v3-ops`
- `audit-proposal-deep-triage`
