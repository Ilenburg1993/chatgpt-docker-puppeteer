---
name: performance-audit
user-invokable: true
description:
  'Skill canônico para auditoria de performance: gargalos, regressões, leaks, custo de testes e
  leitura do coletor de performance do audit runner.'
---

# performance-audit

## Overview

Skill de performance para investigar CPU, memória, I/O, cache, event loop e custo operacional dos
quality gates. Ele trabalha sobre o coletor `scripts/audit/collectors/performance.mjs` e sobre o
report do runner.

## Recommended Tuple

- `audit_mode=performance`
- `profile=deep`
- `profile=nightly` para regressão contínua
- `proposal_depth=standard`

## When To Use

- Há suspeita de regressão de throughput/latência.
- Há sinais de gargalo, leak, N+1 ou custo de teste excessivo.
- Você quer ler e agir sobre `performance_execution`.

## When Not To Use

- Não usar para vulnerabilidades ou policy; usar `security-checklist`.
- Não usar para um bug funcional simples sem sintoma de performance.

## Inputs / Preconditions

- `npm run audit:performance`
- `audit_report` com `performance_execution`
- referências:
  - `references/perf-signal-catalog.md`
  - `references/perf-regression-triage.md`

## Workflow

1. Rodar a auditoria de performance.
2. Ler `performance_execution.score`, `categories` e findings associados.
3. Separar sinais por subtipo: CPU, memória, I/O, cache, event loop e custo de testes.
4. Formular hipótese, reproduzir medição e só então propor correção.
5. Encaminhar P0/P1 para `audit-proposal-deep-triage`.

## Guardrails

- Não confundir custo de build/test com gargalo de runtime sem evidência.
- Não tomar score agregado como prova suficiente; sempre inspecionar os findings.
- Comparar runs equivalentes antes de declarar regressão.

## Validation / Done Criteria

- Sinais agrupados por categoria.
- Hipótese de regressão ou descarte documentado.
- Correção proposta ou backlog criado com métrica de validação.

## Related Skills

- `audit-proposal-deep-triage`
- `audit-runbook-observability`
