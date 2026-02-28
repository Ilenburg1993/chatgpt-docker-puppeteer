---
name: exploratory-bug-hunt
user-invokable: true
description:
  'Skill para caça proativa de bugs e gaps sem pistas iniciais; gera relatório versionado e sugere
  correções.'
---

# exploratory-bug-hunt

## Overview

Skill proativa para descoberta sem pista inicial. Ela existe para varrer áreas pouco exploradas,
componentes críticos ou rodadas periódicas de caça a bugs/gaps.

## Recommended Tuple

- `audit_mode=exploratory_bug`
- `profile=deep` por default
- `profile=nightly` para varredura ampla
- `proposal_depth=standard|deep`

## When To Use

- Não existe bug reportado, mas você quer encontrar riscos reais.
- A área tem alto churn, criticidade alta ou pouca cobertura histórica.
- Você precisa produzir backlog de achados por escopo.

## When Not To Use

- Não usar quando já existe stack trace ou bug reportado; use `reactive-bug-audit`.
- Não usar para baseline operacional; use `audit-runbook-observability`.

## Inputs / Preconditions

- escopo inicial (arquivo, diretório, módulo ou conjunto por churn)
- `npm run audit:exploratory-bug-hunt` ou `npm run audit:nightly`
- referências:
  - `references/scope-selection-playbook.md`
  - `references/exploratory-report-template.md`

## Workflow

1. Escolher e registrar o escopo inicial.
2. Rodar auditoria exploratória (`deep` ou `nightly`) para obter sinais amplos.
3. Quebrar o escopo em blocos pequenos: seleção, extração de fragmentos, leitura, síntese.
4. Consolidar achados em backlog priorizado por severidade e custo.
5. Encaminhar bugs confirmados para fluxo reativo ou triagem profunda conforme severidade.

## Guardrails

- Não começar sem delimitar escopo; evitar varredura “repo inteiro” ad hoc.
- Não misturar patches imediatos com exploração ampla; primeiro consolidar backlog.
- Não duplicar no relatório trechos já auditados na mesma rodada.

## Validation / Done Criteria

- Escopo declarado e coberto de forma rastreável.
- Relatório exploratório versionado.
- Ao menos um achado priorizado ou descarte explícito do escopo.

## Related Skills

- `reactive-bug-audit` para bugs com pista inicial.
- `audit-proposal-deep-triage` para P0/P1 descobertos.
