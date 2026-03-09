# Catálogo Canônico de Skills

Este diretório é a fonte viva de skills do projeto.

Para o hub estrutural de `.github/`, consulte também [../README.md](../README.md).

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
- `exploratory-bug-hunt`: caça proativa sem pista inicial (grep-first, padrões)
- `code-audit-and-fix`: ciclo completo exploração + patches (padrões + aplicação)
- **`semantic-logic-audit`: auditoria profunda de lógica e semântica — verifica se o código faz o
  que deve, independente de padrões ou lint. Use para fluxos completos, state machines,
  invariantes.**
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
- `schema-contract-governance`: escolha e governança das camadas de contrato entre JSDoc, `.d.ts`,
  JSON Schema, Zod e `ts.server.protocol`

## Taxonomia de tipagem e JSDoc

- `jsdoc-authoring`: criação/hardening de JSDoc em arquivos `.js/.mjs`. Inclui cookbook completo de
  códigos TS, padrão por código de erro, ordem de cascata, edição em lote e casos especiais
- `typing-node24-esm-tsserver`: orquestração do Full-Strict Roadmap — lanes, tsconfig strict,
  declaração, vue-tsc, CI gates. Inclui protocolo de execução por lane e triagem de erros
- **`typing-fix-protocol`**: protocolo operacional de scan + triagem + fix lane por lane. Use como
  guia de execução passo a passo. Contém: comandos de diagnóstico, cookbook por TS code, ordem de
  cascata, estratégia de batch edit, casos especiais (emoji em catch, `never[]`, typedef malformado)

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
