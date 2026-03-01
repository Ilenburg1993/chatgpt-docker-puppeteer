# Security Scan Policy

**Propósito**: consolidar a política viva de scans automatizados de dependências e a postura atual
de triagem de risco residual.  
**Status documental**: Canônico.  
**Público**: engenharia, auditoria, manutenção e agentes de IA.  
**Última atualização**: 1 de março de 2026.

## Escopo

Este documento cobre:

- scans automáticos executados no GitHub Actions;
- critérios de bloqueio para vulnerabilidades de dependências;
- tratamento de advisories sem versão publicada;
- postura atual sobre secret scanning.

## Workflows ativos

### Dependências e supply chain

- [../../.github/workflows/security.yml](../../.github/workflows/security.yml)
  - gate de `npm audit` para dependências de produção;
  - CodeQL;
  - resumo e artefatos do scan.
- [../../.github/workflows/dependency-review.yml](../../.github/workflows/dependency-review.yml)
  - `actions/dependency-review-action`;
  - `npm ci --ignore-scripts` para PRs do Dependabot;
  - triagem automática e rotulagem de PRs do Dependabot.
- [../../.github/workflows/dependency-hygiene.yml](../../.github/workflows/dependency-hygiene.yml)
  - auditoria completa (`prod + dev`);
  - verificação de dependências declaradas vs. usadas;
  - artifact periódico para revisão manual.

## Fonte de verdade para npm audit

O repositório não usa mais `npm audit` puro como gate bloqueante.

A fonte de verdade operacional é o wrapper
[../../scripts/security/npm-audit-gate.mjs](../../scripts/security/npm-audit-gate.mjs).

Ele:

- roda `npm audit --json`;
- confirma com `npm view` se a versão de correção sugerida existe no registry, exigindo
  consistência entre o packument do pacote (`versions` e `time`) e o manifesto da versão exata
  (`dist.tarball`);
- valida também a alcançabilidade real do tarball antes de classificar o finding como bloqueante;
- separa findings entre:
  - `actionable`
  - `manual-review`
  - `unpublished-fix`
  - `no-fix`

## Critério de bloqueio

O pipeline só deve falhar automaticamente quando:

- a vulnerabilidade está no threshold de severidade configurado; e
- existe correção publicada; e
- a correção não exige revisão `semver-major`.

## Casos que não bloqueiam automaticamente

Os cenários abaixo permanecem visíveis no relatório, mas não viram falha automática:

- advisory com “fix” para versão não publicada no registry;
- advisory cuja única saída é upgrade major;
- pacote sem fix disponível.

Esses casos exigem backlog e revisão humana, não `audit fix` cego.

O gate também reduz falsos positivos transitórios de cache/edge do registry: um único `npm view
<pacote>@<versão>` positivo não basta para classificar o finding como bloqueante.

## Dependabot

O Dependabot é parte da política de segurança de supply chain:

- atualiza `npm`, `github-actions` e `docker`;
- agrupa updates por domínio;
- usa `cooldown`, `rebase-strategy` e `versioning-strategy` para reduzir churn;
- PRs passam por `dependency-review`, `dependabot-installability` e `security`.

## Secret scanning

Hoje, **não há um workflow canônico dedicado de secret scanning** no GitHub Actions deste
repositório.

Portanto, não é correto afirmar que existe um `secret-scan-schedule.yml` ativo.

Postura atual:

- prevenção local via higiene operacional e revisão de PR;
- documentação de resposta e remediação permanece válida;
- um scanner dedicado de segredos continua sendo backlog explícito, não contrato já implantado.

## Fluxo de triagem

1. O workflow identifica findings e publica artefatos.
2. Se houver `actionable`, o pipeline falha.
3. Se houver apenas `manual-review`, `unpublished-fix` ou `no-fix`, o pipeline segue e o risco
   residual fica documentado.
4. Dependências major, downgrades de mitigação e advisories inconsistentes com o registry exigem
   decisão humana.

## Regras de manutenção

- Não documentar workflows que não existam na árvore real de `.github/workflows/`.
- Se um scan mudar de comportamento, atualizar este documento e o runbook em
  [../OPERACOES/DEPENDENCY_AUTOMATION.md](../OPERACOES/DEPENDENCY_AUTOMATION.md).
- Não converter risco residual do ecossistema em “falso erro do projeto”.

## Links relacionados

- Runbook operacional: [../OPERACOES/DEPENDENCY_AUTOMATION.md](../OPERACOES/DEPENDENCY_AUTOMATION.md)
- Segurança operacional do runtime: [../OPERACOES/SECURITY.md](../OPERACOES/SECURITY.md)
- Hub de auditorias: [README.md](./README.md)
