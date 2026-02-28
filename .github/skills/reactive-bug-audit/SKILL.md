---
name: reactive-bug-audit
user-invokable: true
description:
  'Skill reativa para conduzir auditoria focada em correção de bugs operacionais. Use quando houver
  erro reportado, stack trace, comportamento quebrado ou regressão já observada.'
---

# reactive-bug-audit

## Overview

Skill reativa para defeitos já observados. Ela parte de uma pista concreta: stack trace, log,
regressão, screenshot, relato funcional ou arquivo suspeito.

## Recommended Tuple

- `audit_mode=reactive_bug`
- `profile=quick` para triagem inicial
- `profile=deep` para P0/P1 ou persistência do defeito
- `proposal_depth=standard|deep`

## When To Use

- Há um bug reproduzível ou um incidente com evidência inicial.
- Há stack trace, erro de runtime, failing test ou regressão específica.
- É necessário sair de sintoma para causa-raiz e patch mínimo.

## When Not To Use

- Não usar sem pista inicial; nesse caso usar `exploratory-bug-hunt`.
- Não usar como runbook operacional; usar `audit-runbook-observability`.
- Não usar para uma proposta P0/P1 final sem passar por `audit-proposal-deep-triage`.

## Inputs / Preconditions

- bug report, stack trace ou evidência inicial
- `npm run audit:preflight`
- `npm run audit:reactive-bug-audit` ou `npm run audit:quick`
- referências:
  - `references/reactive-triage-prompt.md`
  - `references/evidence-template.md`

## Workflow

1. Consolidar a pista inicial e registrar escopo do incidente.
2. Rodar `audit:reactive-bug-audit` para coletar sinais de quality, static, runtime e tests.
3. Usar RAG/LSP só nos arquivos suspeitos, não em varredura ampla.
4. Produzir hipótese de causa-raiz, validar com reproduções/testes e só então propor patch.
5. Se o achado for P0/P1, escalar para `audit-proposal-deep-triage`.
6. Reexecutar a auditoria após a correção para confirmar remoção do finding.

## Guardrails

- Não misturar fluxo exploratório dentro desta skill.
- Não abrir escopo sem necessidade; começar no menor conjunto reproduzível.
- Não aplicar patch sem validação mínima local.
- Sempre vincular o achado a tracker, arquivo e evidência.

## Validation / Done Criteria

- Causa-raiz identificada com evidência concreta.
- Patch validado ou plano de correção pronto para review.
- Reexecução não reproduz o finding principal.
- Evidência registrada no tracker ou relatório da rodada.

## Related Skills

- `audit-runbook-observability` para baseline e artefatos.
- `audit-proposal-deep-triage` para proposta profunda.
- `exploratory-bug-hunt` para cenários sem pista inicial.
