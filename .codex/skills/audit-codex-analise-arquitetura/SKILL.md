---
name: audit-codex-analise-arquitetura
description:
  'Skill para análise completa do sistema de auditoria CODEX, incluindo mapeamento de arquivos, componentes, fluxos de trabalho, identificação de problemas e recomendações de desenvolvimento.'
---

# Audit CODEX - Análise de Arquitetura

## Overview

Skill para análise e planejamento do sistema de auditoria CODEX. Inclui mapeamento completo de arquivos, módulos, dependências, fluxos de trabalho e recomendações.

## When To Use

- Analisar a arquitetura do sistema de auditoria
- Mapear todos os componentes e suas relações
- Identificar problemas e áreas de melhoria
- Planejar próxima rodada de desenvolvimento
- Documentar integrações e dependências

## Documentos de Referência

| Documento | Descrição |
|-----------|-----------|
| `DOCUMENTAÇÃO/CODEX_AUDIT_TRACKER.md` | Tracker de auditoria ativa |
| `DOCUMENTAÇÃO/CODEX_AUDIT_AGENT_MASTER_PLAN.md` | Plano mestre do Audit Agent |
| `DOCUMENTAÇÃO/CODEX_AUDIT_ANALISE_ARQUITETURA_COMPLETA.md` | Análise completa de arquitetura |
| `contracts/domains/quality.json` | Contratos de qualidade (10 contratos) |

## Estrutura de Arquivos Principais

### Módulos Core

```
src/
├── audit_agent/          # Agente de auditoria LLM
│   ├── main.js         # Processo HTTP + tick
│   ├── runtime.js      # Loop de jobs
│   ├── context_builder.js  # Coleta contexto MCP/LSP/RAG
│   ├── triage_llm.js  # Triagem via Inference Gateway
│   ├── patch_author_llm.js  # Geração de patches
│   └── db_store.js    # Persistência SQLite
│
├── inference_gateway/    # Gateway de inferência
│   ├── gateway.js      # Governança + fallback
│   ├── server.js       # Endpoints REST
│   ├── persistence.js  # Loader de policies
│   └── ollama_host_supervisor.js  # Monitor Ollama
│
├── server/
│   ├── domain/
│   │   └── control_command_service.js  # SSOT de comandos
│   └── api/controllers/
│       ├── dashboard_audit.js   # API de auditoria
│       └── dashboard_inference.js  # API de inferência
│
├── infra/db/           # Repositórios
│   ├── audit_job_repo.js
│   ├── audit_finding_repo.js
│   ├── audit_patch_repo.js
│   ├── inference_profile_repo.js
│   └── ...
│
└── scripts/audit/      # Scripts de auditoria
    ├── runner.mjs     # Executor principal
    ├── collectors/    # Coletores de quality
    └── lib/          # Utilitários
```

## Componentes do Sistema

### 1. Audit Agent (F8-F9)

- **Context Builder**: Coleta sinais via MCP/LSP/RAG
- **Triage LLM**: Triagem via Inference Gateway
- **Patch Author LLM**: Geração de propostas
- **Runtime**: Loop de jobs em memória
- **DB Store**: Persistência SQLite

### 2. Inference Gateway (F3)

- **Gateway**: Governança, budgets, fallback
- **Server**: Endpoints /v1/generate, /v1/validate/*
- **Persistence**: Loader de policies do SQLite
- **Supervisor**: Monitor Ollama com circuit breaker

### 3. Control Plane (F6)

- **Commands**: AUDIT_*, INFERENCE_*
- **Validation**: Preflight, approval, dry-run
- **Guardrails**: Branch/path/mode checks

### 4. Dashboard APIs

- **Audit**: Jobs, patches, findings, watch-rules
- **Inference**: Profiles, policies, backends, models

## Fluxo de Pipeline LLM

```
Job Created → collect_context → deterministic_checks → triage → 
triage_llm → patch_author_llm → waiting_approval → apply
```

## Quality Gates

### Contratos P1 (Bloqueantes)
- CONTRACT-QUALITY-NODE-SYNTAX
- CONTRACT-QUALITY-TYPECHECK-NODE
- CONTRACT-QUALITY-TYPECHECK-BROWSER
- CONTRACT-QUALITY-TS-IGNORE-FORBIDDEN

### Contratos Warn
- CONTRACT-QUALITY-ENTRYPOINT-IMPORT-SMOKE
- CONTRACT-QUALITY-LINT-CLEAN
- CONTRACT-QUALITY-PRETTIER-CHECK
- CONTRACT-QUALITY-JSDOC-* (4 contratos)

## Status das Features

| Feature | Status | Fase |
|---------|--------|------|
| Audit Agent básico | ✅ Concluído | F0-F5 |
| Inference Gateway | ✅ Concluído | F3 |
| Pipeline LLM (triage) | ✅ Concluído | F8 |
| Pipeline LLM (patch_author) | ✅ Concluído | F8 |
| Dashboard APIs | ✅ Concluído | F9 |
| Guardrails de apply | ✅ Concluído | F6 |
| Cache intra-phase | ✅ Concluído | F7 |
| Apply real | ⏳ Pendente | F10 |

## Variáveis de Ambiente

| Variável | Default | Descrição |
|----------|---------|-----------|
| AUDIT_AGENT_ENABLED | false | Ativar Audit Agent |
| AUDIT_AGENT_TRIAGE_LLM_ENABLED | false | Ativar triage LLM |
| AUDIT_AGENT_PATCH_AUTHOR_LLM_ENABLED | false | Ativar patch author |
| INFERENCE_GATEWAY_ENABLED | false | Ativar Inference Gateway |
| OLLAMA_SUPERVISOR_ENABLED | false | Ativar supervisor Ollama |

## Problemas Ativos

| ID | Problema | Severidade |
|----|----------|------------|
| P1 | triage_llm desabilitado por padrão | Alta |
| P2 | patch_author_llm V0 proposal-only | Média |
| P3 | Falta truncation/token-budget | Alta |
| P4 | AUDIT_PATCH_APPLY guardado | Alta |
| P5 | Cache miss em quality gates | Média |

## Recomendações

### Curto Prazo
1. Expor apply_readiness em patch detail
2. Criar endpoint de patch_proposal detalhado
3. Preparar esqueleto de apply real

### Médio Prazo
1. Incrementar cobertura JSDoc por domínio
2. Implementar cache cross-phase
3. Calibrar thresholds de contratos

### Longo Prazo
1. Promover AUDIT_PATCH_APPLY para semi_auto
2. Implementar RBAC completo
3. Integrar Inference Gateway com consumidores

## Análise de Comandos

### AUDIT_*
- AUDIT_JOB_CREATE/RUN/CANCEL/RETRY
- AUDIT_PATCH_APPROVE/REJECT/APPLY
- AUDIT_PATCH_APPLY_VALIDATE
- AUDIT_WATCH_RULE_UPSER/TOGGLE

### INFERENCE_*
- INFERENCE_PROFILE_VALIDATE/UPSERT
- INFERENCE_CLIENT_POLICY_UPSERT
- INFERENCE_BACKEND_UPSERT/TOGGLE
- INFERENCE_MODEL_UPSERT/TOGGLE

## Testing

```bash
# Testes do Audit Agent
node --test tests/unit/audit_agent/*.spec.js

# Testes do Inference Gateway
node --test tests/unit/inference/*.spec.js

# Testes de Control Plane
node --test tests/unit/server/test_control_command_service_*.spec.js

# Audit quick
npm run audit:quick -- --triage false --progress false
```

## Done Criteria

- Runtime estável (audit:quick, typecheck:full, lint verdes)
- Sem side effects de import
- SSOT/control-plane preservados
- Feature flags seguros por padrão
