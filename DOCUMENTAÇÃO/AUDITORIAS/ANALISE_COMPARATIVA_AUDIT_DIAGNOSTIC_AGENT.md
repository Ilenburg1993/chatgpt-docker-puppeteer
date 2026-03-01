# Relatório Comparativo: Audit Agent vs Diagnostic Agent

**Data de Criação:** 2026-02-23  
**Versão:** 1.0.0  
**Status:** Análise Concluída

---

## Índice

1. [Resumo Executivo](#1-resumo-executivo)
2. [Mapeamento de Arquivos e Módulos](#2-mapeamento-de-arquivos-e-módulos)
3. [Análise de Funcionalidades Implementadas](#3-análise-de-funcionalidades-implementadas)
4. [Sobreposições e Redundâncias](#4-sobreposições-e-redundâncias)
5. [Problemas, Inconsistências e Áreas de Melhoria](#5-problemas-inconsistências-e-áreas-de-melhoria)
6. [Integrações e Dependências Externas](#6-integrações-e-dependências-externas)
7. [Recomendações Técnicas](#7-recomendações-técnicas)
8. [Próximos Passos - Roadmap de Consolidação](#8-próximos-passos---roadmap-de-consolidação)
9. [Integração com Dashboard](#9-integração-com-dashboard)
10. [Conclusão](#10-conclusão)

---

## 1. Resumo Executivo

### 1.1 Visão Geral dos Agentes

Após análise detalhada do código-fonte de ambos os sistemas, identificamos que existem dois agentes
com propósitos distintos, porém com algumas sobreposições funcionais:

| Aspecto                 | Audit Agent                                                    | Diagnostic Agent                                                    |
| ----------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------- |
| **Propósito Principal** | Auditoria de código, detecção de bugs, geração de patches      | Diagnóstico de infraestrutura LLM/Ollama, análise de código via LLM |
| **Escopo**              | Focado em quality gates, contratos, lint, typecheck            | Focado em saúde do Ollama, análise de código, relatórios            |
| **Maturidade**          | Alto - múltiplas ondas de desenvolvimento (AQ1-AQ6, AAG-F3-F9) | Médio - implementação inicial recente                               |
| **Persistência**        | SQLite com repositórios completos                              | Não possui persistência (apenas memória)                            |
| **Integração com LLM**  | Via Inference Gateway com políticas                            | Via Inference Gateway direto                                        |

### 1.2 Conclusão Principal

**A existência de ambos é justificada**, pois atendem a propósitos complementares:

- **Audit Agent**: focado em auditoria determinística e assistida por LLM para código
- **Diagnostic Agent**: focado em diagnóstico de infraestrutura e análise de código via LLM

Porém, há **sobreposições significativas** em:

- Análise de código via LLM
- Integração com Inference Gateway
- Verificação de saúde de serviços

---

## 2. Mapeamento de Arquivos e Módulos

### 2.1 Audit Agent (`src/audit_agent/`)

```
src/audit_agent/
├── main.js                    # Entry point do processo PM2
├── runtime.js                 # Motor de execução de jobs (classes, state machine)
├── server.js                  # Servidor HTTP local (/health, /metrics, /jobs)
├── contracts.js                # Definição de contratos e tipos (AUDIT_JOB_STATUS, etc.)
├── db_store.js                # Persistência SQLite
├── context_builder.js          # Coleta contexto via MCP/LSP/RAG
├── triage_llm.js              # Cliente LLM para triagem de código
├── patch_author_llm.js        # Cliente LLM para geração de patches
└── server/
    └── (integrado em server.js)
```

### 2.2 Diagnostic Agent (`src/diagnostic_agent/`)

```
src/diagnostic_agent/
├── main.js                    # Entry point do processo
├── diagnostic-agent.js        # Classe principal orquestradora
├── utils/
│   ├── constants.js          # Definição de constantes
│   ├── logger.js             # Logger estruturado
│   └── validators.js         # Validadores de comandos
└── services/
    ├── code-analyzer.js      # Análise de código via LLM (LEITURA DE ARQUIVOS)
    ├── health-checker.js     # Verificação de saúde Ollama/Gateway
    ├── model-analyzer.js     # Análise de modelos disponíveis
    ├── report-generator.js   # Geração de relatórios
    └── system-monitor.js    # Monitoramento de recursos
```

### 2.3 Dashboard Integration

```
src/server/api/controllers/
├── dashboard.js               # Router principal (mount de todos os sub-routers)
├── dashboard_audit.js         # Endpoints para Audit Agent
├── dashboard_inference.js     # Endpoints para Inference Gateway
└── dashboard_diagnostic.js   # Endpoints para Diagnostic Agent (RECÉM-CRIADO)
```

---

## 3. Análise de Funcionalidades Implementadas

### 3.1 Audit Agent - Funcionalidades

| Funcionalidade                | Status      | Descrição                                                                                                               |
| ----------------------------- | ----------- | ----------------------------------------------------------------------------------------------------------------------- |
| **Job Queue System**          | ✅ Completo | Sistema de jobs com estados (PENDING, QUEUED, RUNNING, WAITING_APPROVAL, COMPLETED, FAILED, CANCELLED)                  |
| **Context Builder**           | ✅ Completo | Coleta contexto via MCP (lsp_diagnostics, lsp_definition, rag_search, rag_expand, lsp_references, lsp_document_symbols) |
| **Triage LLM**                | ✅ Completo | Triagem de código via Inference Gateway com preflight de policy                                                         |
| **Patch Author LLM**          | ✅ Completo | Geração de proposals de patch via Inference Gateway                                                                     |
| **Persistência SQLite**       | ✅ Completo | Repositórios para jobs, runs, findings, patches, watch_rules                                                            |
| **Control Plane Integration** | ✅ Completo | Comandos AUDIT_JOB_CREATE, AUDIT_JOB_RUN, AUDIT_PATCH_APPLY, etc.                                                       |
| **Dry-run Validation**        | ✅ Completo | Validação temporal de dry-run com TTL                                                                                   |
| **Guardrails de Apply**       | ✅ Completo | Validação de branch, path, worktree antes de apply                                                                      |

### 3.2 Diagnostic Agent - Funcionalidades

| Funcionalidade                | Status      | Descrição                                         |
| ----------------------------- | ----------- | ------------------------------------------------- |
| **Health Check Ollama**       | ✅ Completo | Verificação de conectividade, modelos disponíveis |
| **Health Check Gateway**      | ✅ Completo | Verificação de políticas carregadas               |
| **System Monitor**            | ✅ Completo | CPU, memória, uptime                              |
| **Code Analyzer**             | ✅ Completo | Leitura de arquivos + análise via LLM             |
| **Report Generator**          | ✅ Completo | Geração de relatórios em Markdown                 |
| **Model Analyzer**            | ✅ Completo | Listagem de modelos disponíveis                   |
| **Persistência**              | ❌ Ausente  | Não há persistência de dados                      |
| **Control Plane Integration** | ❌ Ausente  | Não há comandos DIAGNOSTIC\_\* no control plane   |

### 3.3 Comparação de Pipeline LLM

#### Audit Agent Pipeline

```
Job Creation → Collect Context (MCP/LSP/RAG) → Triage LLM → Patch Author LLM → Findings → Patches → Approval → Apply
```

#### Diagnostic Agent Pipeline

```
Request → Read Files → Analyze with LLM → Generate Report (Markdown/JSON)
```

---

## 4. Sobreposições e Redundâncias

### 4.1 Sobreposições Identificadas

| Área                              | Audit Agent                                  | Diagnostic Agent                | Severity  |
| --------------------------------- | -------------------------------------------- | ------------------------------- | --------- |
| **Análise de Código via LLM**     | `triage_llm.js`, `patch_author_llm.js`       | `code-analyzer.js`              | **ALTA**  |
| **Verificação de Saúde**          | `context_builder.js` (probeInferenceGateway) | `health-checker.js`             | **MÉDIA** |
| **Inference Gateway Integration** | HTTP client para `/v1/generate`              | HTTP client para `/v1/generate` | **ALTA**  |
| **Relatórios**                    | `result_json` em jobs                        | `report-generator.js`           | **BAIXA** |

### 4.2 Análise Detalhada das Redundâncias

#### 4.2.1 Análise de Código via LLM

**Audit Agent:**

- Usa contexto do MCP (LSP diagnostics, RAG search)
- Prompt focado em triagem e risco
- Saída estruturada (summary, risk_level, next_actions)
- Integração com patch author

**Diagnostic Agent:**

- Lê arquivos diretamente do filesystem
- Prompt focado em análise detalhada (bugs, gaps, recommendations)
- Saída estruturada (issues, gaps, recommendations, score)
- Não há integração com sistema de patches

**Conclusão:** Embora o propósito seja diferente (triagem vs análise detalhada), há lógica duplicada
na chamada LLM.

#### 4.2.2 Verificação de Saúde

**Audit Agent:**

- `probeInferenceGateway()` em `context_builder.js`
- Verifica `/health` e `/v1/models`

**Diagnostic Agent:**

- `HealthChecker.checkGateway()` em `health-checker.js`
- Verifica `/health` e `/v1/models`

**Conclusão:** Lógica idêntica duplicada em dois módulos diferentes.

---

## 5. Problemas, Inconsistências e Áreas de Melhoria

### 5.1 Problemas Críticos

| ID  | Problema                           | Impacto                                         | агента     |
| --- | ---------------------------------- | ----------------------------------------------- | ---------- |
| P1  | Diagnostic Agent sem persistência  | Não mantém histórico de análises                | Diagnostic |
| P2  | Diagnostic Agent sem Control Plane | Não pode ser operado via comandos centralizados | Diagnostic |
| P3  | Duplicação de integração LLM       | Manutenção duplicada                            | Ambos      |
| P4  | Duplicação de health checks        | Manutenção duplicada                            | Ambos      |

### 5.2 Inconsistências Arquiteturais

| Inconsistência              | Descrição                                                                                            |
| --------------------------- | ---------------------------------------------------------------------------------------------------- |
| **Pattern de Logging**      | Audit Agent usa logger custom via callback; Diagnostic Agent usa logger próprio em `utils/logger.js` |
| **Pattern de Configuração** | Audit Agent usa env vars diretas; Diagnostic Agent usa `constants.js`                                |
| **HTTP Server**             | Audit Agent usa servidor simples; Diagnostic Agent usa servidor com mais estrutura                   |
| **Type Safety**             | Audit Agent tem `@ts-check` e tipos mais rigorosos; Diagnostic Agent tem tipos menos definidos       |

### 5.3 Áreas de Melhoria

| Área              | Melhoria Proposta                                                          |
| ----------------- | -------------------------------------------------------------------------- |
| **Reutilização**  | Criar módulo compartilhado para integração com Inference Gateway           |
| **Persistência**  | Adicionar persistência SQLite ao Diagnostic Agent                          |
| **Control Plane** | Adicionar comandos DIAGNOSTIC\_\* ao control_command_service.js            |
| **Unificação**    | Considerar migrar análise de código do Diagnostic Agent para o Audit Agent |

---

## 6. Integrações e Dependências Externas

### 6.1 Inference Gateway

| Aspecto         | Audit Agent                                                              | Diagnostic Agent                                        |
| --------------- | ------------------------------------------------------------------------ | ------------------------------------------------------- |
| **URL Base**    | `INFERENCE_GATEWAY_HOST:INFERENCE_GATEWAY_PORT` (default 127.0.0.1:3099) | `INFERENCE_GATEWAY_URL` (default http://localhost:3457) |
| **Client Tags** | `audit_agent_triage`, `audit_agent_patch`                                | `diagnostic_code_analyzer`                              |
| **Preflight**   | Sim (via `/v1/validate/generate`)                                        | Não                                                     |
| **Políticas**   | DB-backed (inference_client_policies)                                    | Não                                                     |

### 6.2 MCP/LSP/RAG (Apenas Audit Agent)

O Diagnostic Agent **não utiliza** MCP, LSP ou RAG para análise de código. Ele lê arquivos
diretamente do filesystem, enquanto o Audit Agent utiliza ferramentas semânticas.

### 6.3 SQLite

| Tabela                      | Audit Agent | Diagnostic Agent |
| --------------------------- | ----------- | ---------------- |
| `audit_jobs`                | ✅          | ❌               |
| `audit_job_runs`            | ✅          | ❌               |
| `audit_job_findings`        | ✅          | ❌               |
| `audit_patch_proposals`     | ✅          | ❌               |
| `audit_watch_rules`         | ✅          | ❌               |
| `inference_profiles`        | ✅          | ❌               |
| `inference_client_policies` | ✅          | ❌               |
| `inference_backends`        | ✅          | ❌               |
| `inference_models`          | ✅          | ❌               |

---

## 7. Recomendações Técnicas

### 7.1 Recomendação de Curto Prazo (Immediately)

| #   | Recomendação                                                              | Justificativa                                     | Esforço |
| --- | ------------------------------------------------------------------------- | ------------------------------------------------- | ------- |
| R1  | Adicionar health check do Diagnostic Agent ao Audit Agent context_builder | Elimina duplicação de lógica de health check      | Baixo   |
| R2  | Unificar URL do Inference Gateway em constants compartilhadas             | Elimina inconsistência de configuração            | Baixo   |
| R3  | Adicionar comandos DIAGNOSTIC\_\* ao Control Plane                        | Permite operação centralizada do Diagnostic Agent | Médio   |

### 7.2 Recomendação de Médio Prazo

| #   | Recomendação                                                    | Justificativa                         | Esforço |
| --- | --------------------------------------------------------------- | ------------------------------------- | ------- |
| R4  | Criar módulo compartilhado `llm-client` para Inference Gateway  | Elimina duplicação de código HTTP     | Médio   |
| R5  | Adicionar persistência SQLite ao Diagnostic Agent               | Permite histórico de análises         | Médio   |
| R6  | Migrar análise de código do Diagnostic Agent para o Audit Agent | Unifica funcionalidade de análise LLM | Alto    |

### 7.3 Recomendação de Longo Prazo

| #   | Recomendação                                            | Justificativa                              | Esforço    |
| --- | ------------------------------------------------------- | ------------------------------------------ | ---------- |
| R7  | Consolidar ambos os agentes em um único sistema modular | Simplifica manutenção e reduz complexidade | Muito Alto |

---

## 8. Próximos Passos - Roadmap de Consolidação

### Fase 1: Integração Imediata (Semana Atual)

- [ ] **T1.1** - Executar typecheck e lint no novo dashboard_diagnostic.js
- [ ] **T1.2** - Testar endpoints do Diagnostic Agent no Dashboard
- [ ] **T1.3** - Documentar a integração no CODEX_AUDIT_TRACKER.md

### Fase 2: Consolidação de Code (Próximas 2 Semanas)

- [ ] **T2.1** - Criar módulo compartilhado `src/shared/inference-gateway-client.js`
- [ ] **T2.2** - Refatorar Diagnostic Agent para usar o módulo compartilhado
- [ ] **T2.3** - Refatorar Audit Agent para usar o módulo compartilhado
- [ ] **T2.4** - Executar regression tests

### Fase 3: Persistência (Próximas 3 Semanas)

- [ ] **T3.1** - Criar migration SQLite para `diagnostic_analyses`
- [ ] **T3.2** - Criar repositório `diagnostic_analysis_repo.js`
- [ ] **T3.3** - Integrar persistência ao Diagnostic Agent
- [ ] **T3.4** - Criar endpoints de listagem no Dashboard

### Fase 4: Control Plane (Próximas 4 Semanas)

- [ ] **T4.1** - Adicionar comandos DIAGNOSTIC\_\* ao control_command_service.js
- [ ] **T4.2** - Adicionar wrappers de mutação ao dashboard_diagnostic.js
- [ ] **T4.3** - Testar fluxo completo via Control Plane

### Fase 5: Unificação (Roadmap Futuro)

- [ ] **T5.1** - Avaliar se `code-analyzer.js` deve migrar para Audit Agent
- [ ] **T5.2** - Se migrado, remover duplicação e manter apenas um sistema de análise LLM
- [ ] **T5.3** - Diagnostic Agent passa a focar apenas em health check e monitoramento

---

## 9. Integração com Dashboard

### 9.1 Estado Atual

#### Dashboard Audit (dashboard_audit.js)

- Endpoints de leitura: `/audit/jobs`, `/audit/jobs/:id`, `/audit/jobs/:id/findings`,
  `/audit/jobs/:id/patches`
- Endpoints de mutação: `POST /audit/jobs`, `POST /audit/jobs/:id/run`,
  `POST /audit/patches/:id/approve`
- Read-models enriquecidos: `llm_triage_summary`, `dry_run_state`, `apply_readiness`

#### Dashboard Diagnostic (dashboard_diagnostic.js) - RECÉM-CRIADO

- Endpoints de leitura: `/diagnostic/health`, `/diagnostic/status`, `/diagnostic/models`,
  `/diagnostic/system`, `/diagnostic/config`
- Endpoints de análise: `POST /diagnostic/analyze`, `POST /diagnostic/analyze/report`
- Endpoints de comando: `POST /diagnostic/command`

### 9.2 Gaps Identificados

| Gap | Descrição                                                              | Prioridade |
| --- | ---------------------------------------------------------------------- | ---------- |
| G1  | Diagnostic Agent não expõe métricas no formato esperado pelo Dashboard | Alta       |
| G2  | Não há endpoint de listagem de análises históricas                     | Alta       |
| G3  | Não há integração com Control Plane para comandos DIAGNOSTIC\_\*       | Média      |

### 9.3 Ações Recomendadas

1. **Expor métricas padronizadas** no Diagnostic Agent para consistência com Audit Agent
2. **Criar endpoints de listagem** de análises com paginação
3. **Integrar com Control Plane** para permitir operação via comandos centralizados

---

## 10. Conclusão

### 10.1 Síntese

A análise comparativa entre o **Audit Agent** e o **Diagnostic Agent** revela:

1. **Dois sistemas complementares**: Cada agente atende a propósitos distintos e justificados
2. **Sobreposições significativas**: Particularmente em análise de código LLM e health checks
3. **Inconsistências arquiteturais**: Diferentes patterns de logging, configuração e tipagem
4. **Oportunidades de consolidação**: Módulo compartilhado para integração LLM, persistência
   unificada

### 10.2 Recomendação Final

**Manter ambos os agentes**, mas com as seguintes ações de consolidação:

1. **Curto prazo**: Criar módulo compartilhado para Inference Gateway e unificar URLs
2. **Médio prazo**: Adicionar persistência e Control Plane ao Diagnostic Agent
3. **Longo prazo**: Avaliar migração de análise de código para o Audit Agent

Esta abordagem preserva a especialização de cada agente enquanto reduz redundância e complexidade de
manutenção.

---

_Documento gerado automaticamente via análise de código-fonte_ _Versão do código analisado:
2026-02-22_
