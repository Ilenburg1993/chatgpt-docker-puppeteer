---
name: agent-consolidation-ops
description: 'Use when consolidating Audit Agent and Diagnostic Agent systems to identify overlaps, create shared modules, add persistence to Diagnostic Agent, integrate with Control Plane, and perform code refactoring to eliminate duplication while maintaining backward compatibility.'
---

# Agent Consolidation Ops

## Overview

Skill para consolidação e integração dos sistemas **Audit Agent** e **Diagnostic Agent** neste repositório.
Esta skill orienta o trabalho de identificação de sobreposições, eliminação de redundâncias e criação de
módulos compartilhados, mantendo compatibilidade com o runtime existente.

## When To Use

- Unificar integração com Inference Gateway entre Audit Agent e Diagnostic Agent
- Adicionar persistência SQLite ao Diagnostic Agent
- Integrar Diagnostic Agent ao Control Plane (comandos DIAGNOSTIC_*)
- Identificar e eliminar código duplicado
- Refatorar health checks para módulo compartilhado
- Migrar funcionalidades de um agente para outro
- Atualizar o documento de análise comparativa

## Canonical Principles

1. **Manter especialização**: Cada agente tem propósito distinto e justificado
2. **Eliminar redundância**: Criar módulos compartilhados para lógica duplicada
3. **Compatibilidade**: Novas implementações não devem quebrar o runtime existente
4. **Flags seguros**: Novas funcionalidades entram atrás de flags (default off)
5. **Testes primeiro**: Criar testes unitários antes de refatorar
6. **Documentação**: Atualizar DOCUMENTAÇÃO/ANALISE_COMPARATIVA_AUDIT_DIAGNOSTIC_AGENT.md após mudanças

## Reference Document

O documento principal de referência para esta skill é:
```
DOCUMENTAÇÃO/ANALISE_COMPARATIVA_AUDIT_DIAGNOSTIC_AGENT.md
```

Este documento contém:
- Resumo executivo da arquitetura de ambos os agentes
- Mapeamento completo de arquivos e módulos
- Análise detalhada de funcionalidades
- Identificação de sobreposições e redundâncias
- Recomendações técnicas
- Roadmap de consolidação

## Known Overlaps

### 1. Inference Gateway Integration

| Arquivo | Agente | Função |
|---------|--------|--------|
| `src/audit_agent/triage_llm.js` | Audit | HTTP client para `/v1/generate` |
| `src/audit_agent/patch_author_llm.js` | Audit | HTTP client para `/v1/generate` |
| `src/diagnostic_agent/services/code-analyzer.js` | Diagnostic | HTTP client para `/v1/generate` |

**Ação recomendada**: Criar `src/shared/inference-gateway-client.js`

### 2. Health Checks

| Arquivo | Agente | Função |
|---------|--------|--------|
| `src/audit_agent/context_builder.js` (probeInferenceGateway) | Audit | Verifica `/health` e `/v1/models` |
| `src/diagnostic_agent/services/health-checker.js` | Diagnostic | Verifica `/health` e `/v1/models` |

**Ação recomendada**: Criar `src/shared/health-check.js` e refatorar ambos

### 3. Code Analysis (LLM)

| Arquivo | Agente | Função |
|---------|--------|--------|
| `src/audit_agent/triage_llm.js` | Audit | Triagem de código (prompt focado em risco) |
| `src/audit_agent/patch_author_llm.js` | Audit | Geração de patches |
| `src/diagnostic_agent/services/code-analyzer.js` | Diagnostic | Análise detalhada (bugs, gaps, recommendations) |

**Ação recomendada**: Avaliar se `code-analyzer.js` deve migrar para Audit Agent

## Consolidation Roadmap

### Fase 1: Imediata (1-2 dias)

- [ ] Revisar DOCUMENTAÇÃO/ANALISE_COMPARATIVA_AUDIT_DIAGNOSTIC_AGENT.md
- [ ] Executar `typecheck:full` e `lint` para baseline
- [ ] Identificar todos os pontos de duplicação no código

### Fase 2: Módulo Compartilhado (3-5 dias)

- [ ] Criar `src/shared/inference-gateway-client.js`
- [ ] Refatorar Audit Agent para usar módulo compartilhado
- [ ] Refatorar Diagnostic Agent para usar módulo compartilhado
- [ ] Executar testes unitários
- [ ] Executar `audit:quick` para validação

### Fase 3: Health Checks (2-3 dias)

- [ ] Criar `src/shared/health-check.js`
- [ ] Refatorar context_builder.js do Audit Agent
- [ ] Refatorar health-checker.js do Diagnostic Agent
- [ ] Executar testes de regressão

### Fase 4: Persistência (5-7 dias)

- [ ] Criar migration SQLite para `diagnostic_analyses`
- [ ] Criar `src/infra/db/diagnostic_analysis_repo.js`
- [ ] Integrar persistência ao Diagnostic Agent
- [ ] Criar endpoints de listagem no Dashboard

### Fase 5: Control Plane (3-5 dias)

- [ ] Adicionar comandos DIAGNOSTIC_* ao control_command_service.js
- [ ] Adicionar wrappers de mutação ao dashboard_diagnostic.js
- [ ] Testar fluxo completo via Control Plane
- [ ] Atualizar DOCUMENTAÇÃO/ANALISE_COMPARATIVA_AUDIT_DIAGNOSTIC_AGENT.md

## Commands Reference

### Audit Agent Commands (existentes)

| Comando | Descrição |
|---------|-----------|
| `AUDIT_JOB_CREATE` | Cria novo job de auditoria |
| `AUDIT_JOB_RUN` | Executa job de auditoria |
| `AUDIT_JOB_CANCEL` | Cancela job |
| `AUDIT_JOB_RETRY` | Retenta job falho |
| `AUDIT_PATCH_APPROVE` | Aprova patch proposto |
| `AUDIT_PATCH_REJECT` | Rejeita patch |
| `AUDIT_PATCH_APPLY` | Aplica patch (com guardrails) |
| `AUDIT_WATCH_RULE_UPSERT` | Cria/atualiza regra de monitoramento |

### Diagnostic Agent Commands (a implementar)

| Comando | Descrição | Status |
|---------|-----------|--------|
| `DIAGNOSTIC_HEALTH` | Verifica saúde Ollama/Gateway | ✅ Implementado |
| `DIAGNOSTIC_SYSTEM` | Informações do sistema | ✅ Implementado |
| `DIAGNOSTIC_MODELS` | Lista modelos | ✅ Implementado |
| `DIAGNOSTIC_REPORT` | Gera relatório | ✅ Implementado |
| `DIAGNOSTIC_LOGS` | Analisa logs | ✅ Implementado |
| `DIAGNOSTIC_CONFIG` | Valida configurações | ✅ Implementado |
| `DIAGNOSTIC_VERIFY` | Verificação completa | ✅ Implementado |
| `DIAGNOSTIC_ANALYZE_CODE` | Analisa código via LLM | ✅ Implementado |

## Quality Gates

Após qualquer mudança de consolidação, executar:

```bash
# TypeScript check
npm run typecheck:full

# Lint
npm run lint -- --quiet

# Audit quick
npm run audit:quick -- --triage false --progress false --eta false

# Unit tests (if exist)
npm test
```

## Environment Variables

### Audit Agent

| Variável | Padrão | Descrição |
|----------|---------|-----------|
| `AUDIT_AGENT_ENABLED` | `false` | Habilita o Audit Agent |
| `AUDIT_AGENT_MODE` | `semi_auto` | Modo de operação |
| `AUDIT_AGENT_TRIAGE_LLM_ENABLED` | `false` | Habilita triage LLM |
| `AUDIT_AGENT_PATCH_AUTHOR_LLM_ENABLED` | `false` | Habilita patch author |

### Diagnostic Agent

| Variável | Padrão | Descrição |
|----------|---------|-----------|
| `DIAGNOSTIC_ENABLED` | `false` | Habilita o Diagnostic Agent |
| `DIAGNOSTIC_PORT` | `3010` | Porta HTTP |
| `INFERENCE_GATEWAY_URL` | `http://localhost:3457` | URL do Gateway |

## File Structure Targets

### Módulo Compartilhado Proposto

```
src/shared/
├── inference-gateway-client.js   # Cliente HTTP unificado
├── health-check.js               # Verificações de saúde
└── constants.js                  # Constantes compartilhadas
```

### Diagnostic Agent (após consolidação)

```
src/diagnostic_agent/
├── main.js
├── diagnostic-agent.js
├── utils/
│   ├── constants.js
│   ├── logger.js
│   └── validators.js
├── services/
│   ├── code-analyzer.js         # ou migrar para Audit Agent
│   ├── health-checker.js        # agora usa src/shared/health-check.js
│   ├── model-analyzer.js
│   ├── report-generator.js
│   └── system-monitor.js
└── db/
    └── diagnostic_analysis_repo.js  # NOVO: persistência
```

## Done Criteria

- [ ] Runtime permanece estável (audit:quick, typecheck:full, lint verdes)
- [ ] Sem regressões em funcionalidades existentes
- [ ] Módulos compartilhados têm testes unitários
- [ ] DOCUMENTAÇÃO/ANALISE_COMPARATIVA_AUDIT_DIAGNOSTIC_AGENT.md atualizado
- [ ] Skills atualizadas refletem a nova arquitetura

## References

- Audit Agent: `src/audit_agent/`
- Diagnostic Agent: `src/diagnostic_agent/`
- Inference Gateway: `src/inference_gateway/`
- Control Plane: `src/server/domain/control_command_service.js`
- Dashboard: `src/server/api/controllers/dashboard*.js`
- Análise Comparativa: `DOCUMENTAÇÃO/ANALISE_COMPARATIVA_AUDIT_DIAGNOSTIC_AGENT.md`
