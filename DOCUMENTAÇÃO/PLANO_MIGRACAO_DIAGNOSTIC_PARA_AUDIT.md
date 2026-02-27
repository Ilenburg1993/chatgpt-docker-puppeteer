# Plano de Migração: Eliminação do Diagnostic Agent e Fusão com Audit Agent

**Versão:** 1.0.0  
**Data:** 2026-02-23  
**Status:** Rascunho para Revisão  
**Autor:** Kilo Code (Architect Mode)

---

## Índice

1. [Resumo Executivo](#1-resumo-executivo)
2. [Análise do Sistema Atual](#2-análise-do-sistema-atual)
3. [Mapeamento de Funcionalidades](#3-mapeamento-de-funcionalidades)
4. [Plano de Migração por Fases](#4-plano-de-migração-por-fases)
5. [Estratégia de Testes](#5-estratégia-de-testes)
6. [Checklist de Remoção de Artefatos](#6-checklist-de-remoção-de-artefatos)
7. [Riscos e Mitigações](#7-riscos-e-mitigações)
8. [Próximos Passos](#8-próximos-passos)

---

## 1. Resumo Executivo

### 1.1 Objetivo

Este documento detalha o plano para **eliminar completamente o Diagnostic Agent** do projeto
`chatgpt-docker-puppeteer` e **incorporar todas as suas funcionalidades ao Audit Agent**. A fusão
consolidará dois processos separados em um único agente unificado, simplificando a arquitetura e
reduzindo a carga de manutenção.

### 1.2 Justificativa

| Aspecto            | Diagnostic Agent                    | Audit Agent                   | Benefício da Fusão     |
| ------------------ | ----------------------------------- | ----------------------------- | ---------------------- |
| **Processos PM2**  | Não está no PM2                     | Está no PM2                   | Elimina processo extra |
| **Propósito**      | Infraestrutura/ diagnóstico pontual | Auditoria contínua de código  | Unifica escopo         |
| **Jobs**           | Efêmeros (on-demand)                | Persistidos com lifecycle     | Melhor observabilidade |
| **Integração LLM** | Análise de código via LLM           | Triage + Patch Author via LLM | Pipeline completo      |
| **Manutenção**     | Código duplicado                    | Base consolidada              | Reduz esforço          |

### 1.3 Escopo

- **Incluído:** Todas as funcionalidades do Diagnostic Agent (health checks, system monitor, model
  analyzer, code analyzer, report generator)
- **Excluído:** Decisões de arquitetura do Audit Agent que não dependem do Diagnostic Agent

---

## 2. Análise do Sistema Atual

### 2.1 Diagnostic Agent - Estrutura de Arquivos

```
src/diagnostic_agent/
├── main.js                           # Entry point + HTTP server (porta 3097)
├── diagnostic-agent.js               # Classe principal (orquestrador)
├── utils/
│   ├── constants.js                  # DIAGNOSTIC_COMMANDS, configurações
│   ├── logger.js                    # Logger customizado
│   └── validators.js                # Schemas Zod para validação
└── services/
    ├── health-checker.js            # Health checks (Ollama, Gateway, System)
    ├── system-monitor.js            # Info sistema, logs, validação config
    ├── model-analyzer.js            # Lista modelos Ollama
    ├── code-analyzer.js             # Análise de código via LLM (689 linhas)
    └── report-generator.js          # Geração de relatórios JSON/Markdown
```

### 2.2 Diagnostic Agent - Comandos suportados

| Comando             | Descrição                                        | Equivalente no Audit Agent     |
| ------------------- | ------------------------------------------------ | ------------------------------ |
| `DIAGNOSTIC_HEALTH` | Verifica saúde de Ollama + Gateway               | **N/A** - preciso criar        |
| `DIAGNOSTIC_SYSTEM` | Info do sistema (CPU, memória, rede)             | **N/A** - preciso criar        |
| `DIAGNOSTIC_MODELS` | Lista modelos Ollama                             | Inference Gateway `/v1/models` |
| `DIAGNOSTIC_REPORT` | Gera relatório JSON/Markdown                     | **N/A** - preciso criar        |
| `DIAGNOSTIC_LOGS`   | Lê arquivos de log                               | **N/A** - preciso criar        |
| `DIAGNOSTIC_CONFIG` | Valida configuração do ambiente                  | **N/A** - preciso criar        |
| `DIAGNOSTIC_VERIFY` | Diagnóstico completo (saúde + sistema + modelos) | **N/A** - preciso criar        |

### 2.3 Diagnostic Agent - Jobs (via Control Plane)

| Comando                 | Descrição                  | Mapeamento Proposto                             |
| ----------------------- | -------------------------- | ----------------------------------------------- |
| `DIAGNOSTIC_JOB_CREATE` | Cria job de diagnóstico    | Novo tipo `infrastructure_check` no Audit Agent |
| `DIAGNOSTIC_JOB_RUN`    | Executa job de diagnóstico | Executar como job do Audit Agent                |
| `DIAGNOSTIC_JOB_CANCEL` | Cancela job                | Já suportado pelo Audit Agent                   |
| `DIAGNOSTIC_JOB_RETRY`  | Retry job                  | Já suportado pelo Audit Agent                   |

### 2.4 Diagnostic Agent - Endpoints HTTP

| Endpoint              | Método   | Descrição                      | Equivalente no Audit Agent       |
| --------------------- | -------- | ------------------------------ | -------------------------------- |
| `/health`             | GET      | Health check do agente         | `/health` (existente)            |
| `/metrics`            | GET      | Métricas do agente             | `/metrics` (existente)           |
| `/status`             | GET      | Status do agente               | `/jobs` (existente)              |
| `/command`            | POST     | Executa comando DIAGNOSTIC\_\* | Usar jobs do Audit Agent         |
| `/api/analyze`        | POST     | Analisa código via LLM         | **Precisa criar** no Audit Agent |
| `/api/analyze/report` | POST     | Gera relatório de análise      | **Precisa criar**                |
| `/jobs`               | GET/POST | Lista/cria jobs                | `/jobs` (existente)              |
| `/jobs/:id`           | GET      | Detalhe do job                 | `/jobs/:id` (existente)          |
| `/jobs/:id/run`       | POST     | Executa job                    | `/jobs/:id/run` (existente)      |
| `/jobs/:id/cancel`    | POST     | Cancela job                    | `/jobs/:id/cancel` (existente)   |

### 2.5 Diagnostic Agent - Variáveis de Ambiente

| Variável                              | Descrição                     | Ação                                |
| ------------------------------------- | ----------------------------- | ----------------------------------- |
| `DIAGNOSTIC_ENABLED`                  | Habilita/desabilita agente    | Deprecate                           |
| `DIAGNOSTIC_PORT`                     | Porta HTTP (default 3097)     | Remover                             |
| `DIAGNOSTIC_AGENT_PORT`               | Porta alternativa             | Remover                             |
| `DIAGNOSTIC_LOG_LEVEL`                | Nível de log                  | Mapear para `AUDIT_AGENT_LOG_LEVEL` |
| `DIAGNOSTIC_ALLOWED_PATHS`            | Paths permitidos para leitura | Mapear                              |
| `DIAGNOSTIC_ALLOWED_LOG_PATHS`        | Paths de log permitidos       | Mapear                              |
| `DIAGNOSTIC_DEFAULT_TIMEOUT_MS`       | Timeout padrão                | Mapear                              |
| `DIAGNOSTIC_HEALTH_CHECK_INTERVAL_MS` | Intervalo de health check     | Mapear                              |

---

## 3. Mapeamento de Funcionalidades

### 3.1 Servicios a Migrar/Criar no Audit Agent

| Serviço do Diagnostic Agent             | Complexidade | Ação                                                               | Estimativa |
| --------------------------------------- | ------------ | ------------------------------------------------------------------ | ---------- |
| `HealthChecker` (health-checker.js)     | Média        | Criar em `src/audit_agent/services/diagnostic-health-checker.js`   | 1-2 dias   |
| `SystemMonitor` (system-monitor.js)     | Média        | Criar em `src/audit_agent/services/diagnostic-system-monitor.js`   | 1-2 dias   |
| `ModelAnalyzer` (model-analyzer.js)     | Baixa        | Reusar do Inference Gateway                                        | 0 dias     |
| `CodeAnalyzer` (code-analyzer.js)       | Alta         | Criar novo tipo de job `code_analysis`                             | 2-3 dias   |
| `ReportGenerator` (report-generator.js) | Média        | Criar em `src/audit_agent/services/diagnostic-report-generator.js` | 1 dia      |
| Logger customizado                      | Baixa        | Reusar logger existente do Audit Agent                             | 0 dias     |
| Validators (Zod)                        | Baixa        | Reusar schemas existentes                                          | 0 dias     |

### 3.2 Novos Tipos de Job para Audit Agent

| Tipo de Job            | Origem            | Descrição                                       |
| ---------------------- | ----------------- | ----------------------------------------------- |
| `infrastructure_check` | DIAGNOSTIC*JOB*\* | Health check completo (Ollama, Gateway, System) |
| `code_analysis`        | `/api/analyze`    | Análise de código via LLM                       |
| `system_diagnostic`    | DIAGNOSTIC_SYSTEM | Coleta info do sistema                          |
| `config_validation`    | DIAGNOSTIC_CONFIG | Valida configuração do ambiente                 |

### 3.3 Integração com Control Plane

**Comandos a modificar:**

| Comando Atual           | Ação                                                           |
| ----------------------- | -------------------------------------------------------------- |
| `DIAGNOSTIC_JOB_CREATE` | Mapear para `AUDIT_JOB_CREATE` com `kind=infrastructure_check` |
| `DIAGNOSTIC_JOB_RUN`    | Mapear para `AUDIT_JOB_RUN`                                    |
| `DIAGNOSTIC_JOB_CANCEL` | Mapear para `AUDIT_JOB_CANCEL`                                 |
| `DIAGNOSTIC_JOB_RETRY`  | Mapear para `AUDIT_JOB_RETRY`                                  |

**Nova estrutura de payload:**

```javascript
// Antes (Diagnostic Agent)
{ diagnostic_job_id: 'diag_123', ... }

// Depois (Audit Agent)
{ job_id: 'audit_123', kind: 'infrastructure_check', ... }
```

---

## 4. Plano de Migração por Fases

### Fase 1: Preparação (Dias 1-3)

#### 1.1 Análise e Planejamento

- [ ] Validar este plano com stakeholders
- [ ] Definir datas de corte (cutover)
- [ ] Identificar dependências críticas

#### 1.2 Criar infraestrutura no Audit Agent

- [ ] Criar diretório `src/audit_agent/services/diagnostic/`
- [ ] Criar `diagnostic-health-checker.js` (copiar de `diagnostic_agent/services/health-checker.js`)
- [ ] Criar `diagnostic-system-monitor.js` (copiar de `diagnostic_agent/services/system-monitor.js`)
- [ ] Criar `diagnostic-report-generator.js` (copiar de
      `diagnostic_agent/services/report-generator.js`)
- [ ] Adaptar imports para usar logger existente do Audit Agent

#### 1.3 Criar novos tipos de job

- [ ] Adicionar `INFRASTRUCTURE_CHECK` ao `AUDIT_JOB_KIND` em `contracts.js`
- [ ] Adicionar `CODE_ANALYSIS` ao `AUDIT_JOB_KIND`
- [ ] Implementar processor para `INFRASTRUCTURE_CHECK` em `runtime.js`
- [ ] Implementar processor para `CODE_ANALYSIS` em `runtime.js`

### Fase 2: Implementação (Dias 4-10)

#### 2.1 Migrar endpoints HTTP

- [ ] Adicionar endpoint `/api/diagnostic/health` no Audit Agent server
- [ ] Adicionar endpoint `/api/diagnostic/system` no Audit Agent server
- [ ] Adicionar endpoint `/api/diagnostic/report` no Audit Agent server
- [ ] Adicionar endpoint `/api/analyze` (code analysis via LLM)
- [ ] Adicionar endpoint `/api/analyze/report`

#### 2.2 Migrar Control Plane

- [ ] Modificar `control_command_service.js` para mapear DIAGNOSTIC*\* → AUDIT*\*
- [ ] Adicionar backwards compatibility com flag `DIAGNOSTIC_COMPAT_MODE=true`
- [ ] Implementar proxy que redireciona chamadas DIAGNOSTIC*\* para jobs AUDIT*\*

#### 2.3 Testes unitários

- [ ] Migrar testes de `test_control_command_service_diagnostic.spec.js`
- [ ] Criar testes para novos serviços diagnostic no Audit Agent
- [ ] Criar testes de integração Diagnostic → Audit job

### Fase 3: Validação (Dias 11-14)

#### 3.1 Testes de integração

- [ ] Executar `audit:quick` completo
- [ ] Testar todos os endpoints migrados manualmente
- [ ] Validar fluxo via Control Plane

#### 3.2 Testes de carga (opcional)

- [ ] Verificar performance com jobs concorrentes

#### 3.3 Documentação

- [ ] Atualizar `CODEX_AUDIT_AGENT_MASTER_PLAN.md`
- [ ] Atualizar README do projeto

### Fase 4: Cutover (Dia 15)

#### 4.1 Comunicação

- [ ] Notificar equipe sobre mudança
- [ ] Documentar breaking changes

#### 4.2 Deploy

- [ ] Fazer deploy da nova versão
- [ ] Monitorar logs por 24h

---

## 5. Estratégia de Testes

### 5.1 Testes Unitários

| Area                | Testes a Criar                              | Prioridade |
| ------------------- | ------------------------------------------- | ---------- |
| Diagnostic Services | `test_diagnostic_health_checker.spec.js`    | Alta       |
| Diagnostic Services | `test_diagnostic_system_monitor.spec.js`    | Alta       |
| Diagnostic Services | `test_diagnostic_report_generator.spec.js`  | Média      |
| Code Analyzer       | `test_diagnostic_code_analyzer.spec.js`     | Alta       |
| Control Plane       | Testes de mapeamento DIAGNOSTIC → AUDIT     | Alta       |
| Integration         | `test_diagnostic_to_audit_job_flow.spec.js` | Alta       |

### 5.2 Testes de Integração

| Cenário          | Descrição                                           | Prioridade |
| ---------------- | --------------------------------------------------- | ---------- |
| Health check     | Executar DIAGNOSTIC_HEALTH via Control Plane        | Alta       |
| System info      | Executar DIAGNOSTIC_SYSTEM e validar resposta       | Alta       |
| Code analysis    | Enviar código para análise via LLM                  | Alta       |
| Job lifecycle    | Criar, executar, cancelar job de diagnóstico        | Alta       |
| Backwards compat | Validar que chamadas DIAGNOSTIC\_\* ainda funcionam | Alta       |

### 5.3 Comandos de Validação

```bash
# Teste de saúde
curl http://localhost:3097/api/diagnostic/health

# Teste de sistema
curl http://localhost:3097/api/diagnostic/system

# Teste de análise de código
curl -X POST http://localhost:3097/api/analyze \
  -H "Content-Type: application/json" \
  -d '{"patterns": ["src/**/*.js"]}'

# Via Control Plane (legado)
curl -X POST http://localhost:3000/api/control/commands \
  -H "Content-Type: application/json" \
  -d '{"command": "DIAGNOSTIC_JOB_CREATE", "payload": {"kind": "infrastructure_check"}}'
```

---

## 6. Checklist de Remoção de Artefatos

### 6.1 Arquivos a Remover

| Arquivo                                             | Ação                              | Quando      |
| --------------------------------------------------- | --------------------------------- | ----------- |
| `src/diagnostic_agent/main.js`                      | Deletar                           | Após Fase 4 |
| `src/diagnostic_agent/diagnostic-agent.js`          | Deletar                           | Após Fase 4 |
| `src/diagnostic_agent/utils/constants.js`           | Deletar                           | Após Fase 4 |
| `src/diagnostic_agent/utils/logger.js`              | Deletar                           | Após Fase 4 |
| `src/diagnostic_agent/utils/validators.js`          | Deletar                           | Após Fase 4 |
| `src/diagnostic_agent/services/health-checker.js`   | Deletar (movido para Audit Agent) | Após Fase 4 |
| `src/diagnostic_agent/services/system-monitor.js`   | Deletar (movido para Audit Agent) | Após Fase 4 |
| `src/diagnostic_agent/services/model-analyzer.js`   | Deletar                           | Após Fase 4 |
| `src/diagnostic_agent/services/code-analyzer.js`    | Deletar (movido para Audit Agent) | Após Fase 4 |
| `src/diagnostic_agent/services/report-generator.js` | Deletar (movido para Audit Agent) | Após Fase 4 |
| `src/diagnostic_agent/` (diretório)                 | Deletar                           | Após Fase 4 |

### 6.2 Variáveis de Ambiente a Remover

| Variável                              | Ação                                                   | Deprecation |
| ------------------------------------- | ------------------------------------------------------ | ----------- |
| `DIAGNOSTIC_ENABLED`                  | Deprecar em favor de `AUDIT_AGENT_DIAGNOSTIC_ENABLED`  | Fase 2      |
| `DIAGNOSTIC_PORT`                     | Remover (usar porta do Audit Agent)                    | Fase 4      |
| `DIAGNOSTIC_AGENT_PORT`               | Remover                                                | Fase 4      |
| `DIAGNOSTIC_LOG_LEVEL`                | Mapear para `AUDIT_AGENT_LOG_LEVEL`                    | Fase 2      |
| `DIAGNOSTIC_ALLOWED_PATHS`            | Mapear para `AUDIT_AGENT_DIAGNOSTIC_ALLOWED_PATHS`     | Fase 2      |
| `DIAGNOSTIC_ALLOWED_LOG_PATHS`        | Mapear para `AUDIT_AGENT_DIAGNOSTIC_ALLOWED_LOG_PATHS` | Fase 2      |
| `DIAGNOSTIC_DEFAULT_TIMEOUT_MS`       | Mapear para `AUDIT_AGENT_DIAGNOSTIC_TIMEOUT_MS`        | Fase 2      |
| `DIAGNOSTIC_HEALTH_CHECK_INTERVAL_MS` | Mapear para `AUDIT_AGENT_HEALTH_CHECK_INTERVAL_MS`     | Fase 2      |

### 6.3 Código a Modificar/Remover

| Arquivo                                                             | Modificação                                     | Quando |
| ------------------------------------------------------------------- | ----------------------------------------------- | ------ |
| `src/server/domain/control_command_service.js`                      | Remover handlers DIAGNOSTIC\_\* ou manter proxy | Fase 4 |
| `tests/unit/server/test_control_command_service_diagnostic.spec.js` | Migrar/reescrever                               | Fase 3 |
| `package.json`                                                      | Remover scripts relacionados (se houver)        | Fase 4 |

### 6.4 Documentação a Atualizar

| Documento                                            | Ação                                    |
| ---------------------------------------------------- | --------------------------------------- |
| `DOCUMENTAÇÃO/BUGS/CODEX_AUDIT_TRACKER.md`           | Atualizar status                        |
| `DOCUMENTAÇÃO/BUGS/CODEX_AUDIT_AGENT_MASTER_PLAN.md` | Documentar nova funcionalidade          |
| `README.md`                                          | Remover referências ao Diagnostic Agent |

---

## 7. Riscos e Mitigações

### 7.1 Riscos Técnicos

| Risco                                                | Impacto | Probabilidade | Mitigação                                |
| ---------------------------------------------------- | ------- | ------------- | ---------------------------------------- |
| Perda de funcionalidade durante migração             | Alto    | Baixa         | Testes extensivos antes do cutover       |
| Breaking changes para consumidores                   | Médio   | Média         | Manter backwards compatibility via proxy |
| Performance degradada com serviços extras            | Médio   | Baixa         | Monitorar e otimizar se necessário       |
| Jobs de diagnóstico competindo com jobs de auditoria | Baixo   | Média         | Usar filas/prioridades separadas         |

### 7.2 Riscos Operacionais

| Risco                           | Impacto | Mitigação                         |
| ------------------------------- | ------- | --------------------------------- |
| Equipe não saber da mudança     | Médio   | Comunicação clara antes do deploy |
| Dependências externas quebrarem | Alto    | Health checks robustos            |

### 7.3 Mitigações Aplicadas

1. **Zero-downtime migration:** Manter o Diagnostic Agent funcionando até nova versão estar validada
2. **Gradual cutover:** Habilitar features gradualmente via flags
3. **Rollback plan:** Manter código antigo taggeado para rollback rápido se necessário

---

## 8. Próximos Passos

### 8.1 Imediatos (Esta Semana)

1. Revisar e validar este plano
2. Obter aprovação dos stakeholders
3. Criar branch de feature: `feature/merge-diagnostic-into-audit`

### 8.2 Curtíssimo Prazo (1-2 Semanas)

1. Executar Fase 1 (Preparação)
2. Começar implementação dos serviços no Audit Agent

### 8.3 Médio Prazo (2-4 Semanas)

1. Executar Fases 2-4
2. Completar testes e validação
3. Deploy em produção

### 8.4 Checklist de Aprovação

| Item                      | Responsável | Status |
| ------------------------- | ----------- | ------ |
| Plano revisado            | Tech Lead   | ⬜     |
| Aprovação de stakeholders | PM          | ⬜     |
| Branch criada             | Dev         | ⬜     |
| Código implementado       | Dev         | ⬜     |
| Testes passando           | Dev/QA      | ⬜     |
| Deploy realizado          | DevOps      | ⬜     |
| Monitoramento OK          | SRE         | ⬜     |

---

## Anexo A: Glossário

| Termo                 | Definição                                                            |
| --------------------- | -------------------------------------------------------------------- |
| **Audit Agent**       | Agente de auditoria contínua de código (processo PM2)                |
| **Diagnostic Agent**  | Agente de diagnóstico de infraestrutura (será eliminado)             |
| **Control Plane**     | Sistema central de comandos (AUDIT*\*, INFERENCE*\_, DIAGNOSTIC\_\_) |
| **Inference Gateway** | Gateway de inferência LLM com políticas e budgets                    |
| **Job**               | Unidade de trabalho executada pelo Audit Agent                       |
| **Cutover**           | Momento de transição para o novo sistema                             |

---

## Anexo B: Referências

- [`DOCUMENTAÇÃO/BUGS/CODEX_AUDIT_TRACKER.md`](DOCUMENTAÇÃO/BUGS/CODEX_AUDIT_TRACKER.md)
- [`DOCUMENTAÇÃO/BUGS/CODEX_AUDIT_AGENT_MASTER_PLAN.md`](DOCUMENTAÇÃO/BUGS/CODEX_AUDIT_AGENT_MASTER_PLAN.md)
- Código fonte: `src/diagnostic_agent/`, `src/audit_agent/`
- Control Plane: `src/server/domain/control_command_service.js`
