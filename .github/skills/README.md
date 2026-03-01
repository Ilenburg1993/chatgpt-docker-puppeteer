# Catálogo Canônico de Skills

Este diretório é a fonte viva de skills do projeto.

## Regras de governança

- O conteúdo canônico mora em `.github/skills`.
- `.codex/skills` existe apenas como compatibilidade transitória para ambientes legados.
- Toda skill nova ou revisada deve manter `SKILL.md` enxuto e mover tabelas/playbooks longos para
  `references/`.
- Skills user-invokable ou operacionais frequentes devem expor `agents/openai.yaml`.
- Skills de auditoria devem declarar explicitamente:
  - `audit_mode`
  - `profile`
  - `proposal_depth`
  - quando escalar para outra skill

## Contrato editorial mínimo

Cada skill canônica deve ter:

1. Overview
2. When To Use
3. When Not To Use
4. Inputs / Preconditions
5. Workflow
6. Guardrails
7. Validation / Done Criteria
8. Related Skills

## Taxonomia de auditoria

- `audit-runbook-observability`: baseline e operação do pipeline
- `reactive-bug-audit`: bug reportado / incidente com pista inicial
- `exploratory-bug-hunt`: caça proativa sem pista inicial
- `audit-proposal-deep-triage`: causa-raiz e proposta P0/P1
- `audit-contracts-v3-ops`: contratos e governança
- `audit-system-analysis-planning`: análise e planejamento arquitetural
- `audit-agent-background-llm-ops`: Audit Agent e stack LLM
- `performance-audit`: auditoria de performance
- `security-checklist`: auditoria de segurança

## Taxonomia documental

- `documentation-governance`: auditoria, status, taxonomia, hubs e governança contínua da
  documentação
- `readme-standardization`: criação e revisão padronizada de `README.md` por pasta

## Taxonomia de configuração e ambiente

- `env-governance`: auditoria, consolidação, expansão e documentação da superfície de variáveis de
  ambiente, templates `.env*`, schema, precedência e placement entre Dockerfile, `containerEnv` e
  `remoteEnv`

## Compatibilidade

Ao atualizar uma skill de auditoria aqui:

- atualizar assets relevantes em `references/` e `agents/`
- evitar duplicar o mesmo runbook em outras skills
- se houver skill equivalente em `.codex/skills`, deixá-la como redirect curto

Ao criar ou revisar uma skill documental aqui:

- manter a distinção entre governança transversal e `README` local
- preferir templates enxutos e reaproveitáveis
- evitar que a skill replique o conteúdo inteiro do hub de documentação
