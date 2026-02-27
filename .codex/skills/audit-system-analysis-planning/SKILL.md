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

## When To Use

- Analisar documentação CODEX_AUDIT_TRACKER.md e CODEX_AUDIT_AGENT_MASTER_PLAN.md
- Mapear arquivos e módulos do sistema de auditoria
- Identificar problemas, inconsistências ou áreas de melhoria
- Documentar integrações e dependências externas
- Planejar próximos passos de desenvolvimento ou refatoração

## Canonical Principles

1. O sistema é composto por múltiplas camadas: execução determinística, ferramentas semânticas,
   inteligência de engenharia e governança.
2. Audit Agent orquestra jobs, chama LLMs, consolida findings e propõe patches.
3. Inference Gateway governa inferência com políticas, budgets, quotas e circuit breaker.
4. MCP, LSP/TSServer e RAG são fontes de contexto, não governança.
5. Control Plane gerencia todas as mutações via commands AUDIT*\*, INFERENCE*\_, DIAGNOSTIC\_\_.

## Components Analysis

### Audit Agent (src/audit_agent/)

- contracts.js - Tipos de job: patch_suggest, bug_hunt, quick_audit, diagnostic
- runtime.js - Pipeline de execução de jobs
- context_builder.js - Coleta contexto semântico via MCP/LSP/RAG
- triage_llm.py - Cliente de triagem via Inference Gateway
- patch_author_llm.py - Geração de propostas de correção
- db_store.js - Persistência SQLite
- server.js - Endpoints HTTP locais
- main.js - Ponto de entrada do processo

### Inference Gateway (src/inference_gateway/)

- gateway.js - Lógica de roteamento, políticas, budgets, circuit breaker
- server.js - API REST do gateway
- persistence.js - Carregamento de políticas do SQLite
- policy_config.py - Configuração de políticas
- client_tags.py - Gerenciamento de clientTags obrigatórios
- ollama_host_supervisor.py - Supervisor do Ollama com polling/circuit

### Diagnostic Agent (src/diagnostic_agent/)

- main.js - Servidor HTTP nativo com 11 endpoints
- diagnostic-agent.js - Orquestrador de diagnósticos
- services/ - Módulos de diagnóstico específicos

## Known Issues

- Diagnostic Agent não está configurado no PM2
- Padrão de logging inconsistente entre componentes
- Persistência em modo sink incremental sem hidratação completa
- Pipeline LLM V0 proposal-only sem diff confiável
- Falta truncation/token budget formal antes de prompts LLM

## Recommendations

1. Habilitar gradualmente triage_llm após calibração
2. Implementar truncation/token budget formal
3. Adicionar testes unitários para cache e parsers
4. Consolidar padrão de logging entre componentes
5. Implementar hidratação de jobs no startup
