---
name: audit-system-analysis-planning
description:
  'Use when analyzing the Audit/Bug Tracker system architecture, reviewing codebase components,
  identifying issues and improvements, and planning next development steps.'
---

# Audit System Analysis and Planning

## Overview

Skill para análise e planejamento do sistema de auditoria e rastreamento de bugs. Inclui compreensão
da arquitetura, mapeamento de componentes, identificação de problemas e recomendações de evolução.

## Recommended Tuple

- `audit_mode=architecture`
- `profile=deep`
- `proposal_depth=off|standard`

## When To Use

- Analisar documentação CODEX_AUDIT_TRACKER.md e CODEX_AUDIT_AGENT_MASTER_PLAN.md
- Mapear arquivos e módulos do sistema de auditoria
- Identificar problemas, inconsistências ou áreas de melhoria
- Documentar integrações e dependências externas
- Planejar próximos passos de desenvolvimento ou refatoração

## When Not To Use

- Não usar como runbook operacional do pipeline.
- Não usar para proposta de patch reativa.

## Inputs / Preconditions

- documentação e tracker do subsistema
- referências:
  - `references/architecture-map.md`
  - `references/known-gaps.md`

## Canonical Principles

1. O sistema é composto por múltiplas camadas: execução determinística, ferramentas semânticas,
   inteligência de engenharia e governança.
2. Audit Agent orquestra jobs, chama LLMs, consolida findings e propõe patches.
3. Inference Gateway governa inferência com políticas, budgets, quotas e circuit breaker.
4. MCP, LSP/TSServer e RAG são fontes de contexto, não governança.
5. Control Plane gerencia todas as mutações via commands AUDIT*\*, INFERENCE*\_, DIAGNOSTIC\_\_.

## Workflow

1. Ler o mapa arquitetural e o tracker antes de inferir mudanças.
2. Mapear componentes, fronteiras e contratos.
3. Identificar drift estrutural, acoplamento excessivo e gaps de governança.
4. Produzir plano evolutivo por fases, sem misturar execução operacional.

## Guardrails

- Manter `SKILL.md` como orquestrador; detalhes extensos ficam em `references/`.
- Se a tarefa virar debugging de um caso concreto, escalar para `reactive-bug-audit`.
- Se a tarefa virar mudança de contrato, escalar para `audit-contracts-v3-ops`.

## Validation / Done Criteria

- Mapa arquitetural atualizado ou validado.
- Lista de gaps conhecida e priorizada.
- Próximas fases descritas sem conflitar com o runtime atual.

## Related Skills

- `audit-codex-analise-arquitetura` (alias legado)
- `audit-agent-background-llm-ops`
