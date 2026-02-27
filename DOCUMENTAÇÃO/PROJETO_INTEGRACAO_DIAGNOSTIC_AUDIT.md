# Projeto de Integração e Consolidação: Diagnostic Agent → Audit Agent

## Visão Geral do Projeto

Este documento consolida o plano de execução para a fusão do **Diagnostic Agent** no **Audit
Agent**, unificando os serviços de diagnóstico e auditoria em uma única plataforma de agente de
engenharia.

**Objetivo Principal**: Eliminar o Diagnostic Agent como processo separado e consolidar suas
funcionalidades no Audit Agent existente.

**Data de Início**: 2026-02-23  
**Status**: Planejamento  
**Versão**: 1.0.0

---

## Índice

1. [Contexto e Justificativa](#1-contexto-e-justificativa)
2. [Documentos de Referência](#2-documentos-de-referência)
3. [Análise Comparativa](#3-análise-comparativa)
4. [Plano de Execução por Fases](#4-plano-de-execução-por-fases)
5. [Tarefas Detalhadas](#5-tarefas-detalhadas)
6. [Critérios de Validação](#6-critérios-de-validação)
7. [Riscos e Mitigações](#7-riscos-e-mitigações)
8. [Checklist de Remoção de Artefatos](#8-checklist-de-remoção-de-artefatos)
9. [Cronograma de Marcos](#9-cronograma-de-marcos)
10. [Glossário](#10-glossário)

---

## 1. Contexto e Justificativa

### 1.1 Situação Atual

O sistema possui atualmente dois agentes separados:

| Agente               | Porta | Tipo                | PM2    | Status |
| -------------------- | ----- | ------------------- | ------ | ------ |
| **Audit Agent**      | 3098  | Background/Contínuo | ✅ Sim | Ativo  |
| **Diagnostic Agent** | 3097  | On-demand           | ❌ Não | Ativo  |

### 1.2 Problemas Identificados

1. **Redundância Operacional**: Dois processos separados para funcionalidades relacionadas
2. **Manutenção Duplicada**: Código Similar em dois módulos diferentes
3. **Integração Complexa**: Dois pontos de controle no Control Plane
4. **Recursos Desperdiciados**: Processos separados consumindo recursos

### 1.3 Benefícios Esperados

- **Redução de Código**: ~30% menos código total
- **Manutenção Simplificada**: Uma base de código para agentes de análise
- **Melhor Coesão**: Funcionalidades relacionadas no mesmo domínio
- **Recursos Otimizados**: Menos processos = menos overhead

---

## 2. Documentos de Referência

### 2.1 Documentos Principais

| Documento                  | Caminho                                                                                                    | Descrição                        |
| -------------------------- | ---------------------------------------------------------------------------------------------------------- | -------------------------------- |
| **Arquitetura do Sistema** | [`DOCUMENTAÇÃO/ARQUITETURA_SISTEMA_COMPLETO.md`](ARQUITETURA_SISTEMA_COMPLETO.md)                          | Visão completa da arquitetura    |
| **Plano de Migração**      | [`DOCUMENTAÇÃO/PLANO_MIGRACAO_DIAGNOSTIC_PARA_AUDIT.md`](PLANO_MIGRACAO_DIAGNOSTIC_PARA_AUDIT.md)          | Detalhamento técnico da migração |
| **Audit Tracker**          | [`DOCUMENTAÇÃO/BUGS/CODEX_AUDIT_TRACKER.md`](DOCUMENTAÇÃO/BUGS/CODEX_AUDIT_TRACKER.md)                     | Estado atual do Audit Agent      |
| **Master Plan Audit**      | [`DOCUMENTAÇÃO/BUGS/CODEX_AUDIT_AGENT_MASTER_PLAN.md`](DOCUMENTAÇÃO/BUGS/CODEX_AUDIT_AGENT_MASTER_PLAN.md) | Roadmap do Audit Agent           |

### 2.2 Código Fonte Relevante

| Módulo           | Caminho                                        | Responsabilidade                |
| ---------------- | ---------------------------------------------- | ------------------------------- |
| Audit Agent      | `src/audit_agent/`                             | Agente de auditoria contínua    |
| Diagnostic Agent | `src/diagnostic_agent/`                        | Agente de diagnósticos (origem) |
| Control Plane    | `src/server/domain/control_command_service.js` | Comandos centralizados          |
| Dashboard API    | `src/server/api/controllers/dashboard_*.js`    | APIs de integração              |

### 2.3 Regras do Workspace

- [**Workspace Rules**](../.kilocode/rules/workspace_rules_kilo.md) - Convenções de código
- **Node 24+ ESM** - Runtime e módulo system

---

## 3. Análise Comparativa

### 3.1 Commands Mapping

| Diagnostic Agent        | Audit Agent Equivalent | Status    |
| ----------------------- | ---------------------- | --------- |
| `DIAGNOSTIC_JOB_CREATE` | `AUDIT_JOB_CREATE`     | ✅ Exists |
| `DIAGNOSTIC_JOB_RUN`    | `AUDIT_JOB_RUN`        | ✅ Exists |
| `DIAGNOSTIC_JOB_CANCEL` | `AUDIT_JOB_CANCEL`     | ✅ Exists |
| `DIAGNOSTIC_JOB_RETRY`  | `AUDIT_JOB_RETRY`      | ✅ Exists |

### 3.2 Services Mapping

| Diagnostic Service | Função                 | Destino no Audit Agent             |
| ------------------ | ---------------------- | ---------------------------------- |
| `health-checker`   | Verificação de saúde   | `context_builder.js` (MCP health)  |
| `system-monitor`   | Monitor de recursos    | `context_builder.js` (system info) |
| `model-analyzer`   | Análise de modelos LLM | `Inference Gateway` API            |
| `code-analyzer`    | Análise de código      | `context_builder.js` (LSP)         |
| `report-generator` | Geração de relatórios  | Dashboard APIs existentes          |

### 3.3 APIs Mapping

| Diagnostic API          | Audit API Equivalent                |
| ----------------------- | ----------------------------------- |
| GET `/health`           | GET `/health` (já existe)           |
| GET `/jobs`             | GET `/jobs` (já existe)             |
| POST `/jobs`            | POST `/jobs` (já existe)            |
| POST `/jobs/:id/run`    | POST `/jobs/:id/run` (já existe)    |
| POST `/jobs/:id/cancel` | POST `/jobs/:id/cancel` (já existe) |

---

## 4. Plano de Execução por Fases

### Fase 1: Preparação (Semana 1)

**Objetivo**: Preparar a infraestrutura para a migração

- [ ] 1.1 Análise de código existente
- [ ] 1.2 Mapeamento de dependências
- [ ] 1.3 Definição de estratégia de testes
- [ ] 1.4 Backup do estado atual

### Fase 2: Implementação (Semanas 2-3)

**Objetivo**: Implementar as funcionalidades do Diagnostic no Audit

- [ ] 2.1 Adicionar tipos de job `diagnostic` ao Audit Agent
- [ ] 2.2 Criar serviços de diagnóstico integrados
- [ ] 2.3 Migrar endpoints de API
- [ ] 2.4 Atualizar Control Plane

### Fase 3: Validação (Semana 4)

**Objetivo**: Validar a integração

- [ ] 3.1 Testes unitários
- [ ] 3.2 Testes de integração
- [ ] 3.3 Testes de regressão
- [ ] 3.4 Validação manual

### Fase 4: Cutover (Semana 5)

**Objetivo**: Trocar para o novo sistema

- [ ] 4.1 Desativar Diagnostic Agent
- [ ] 4.2 Ativar funcionalidades no Audit Agent
- [ ] 4.3 Monitoramento pós-migração
- [ ] 4.4 Limpeza de artefatos

---

## 5. Tarefas Detalhadas

### 5.1 Tarefas da Fase 1 - Preparação

#### Tarefa 1.1: Análise de Código Existente

**Descrição**: Analisar o código fonte do Diagnostic Agent para identificar todas as funcionalidades

**Arquivos a analisar**:

- `src/diagnostic_agent/main.js`
- `src/diagnostic_agent/diagnostic-agent.js`
- `src/diagnostic_agent/services/*.js`

**Entregáveis**:

- Lista de funcionalidades identificadas
- Dependências mapeadas

**Critério de完成**: Relatório de análise aprovado

#### Tarefa 1.2: Mapeamento de Dependências

**Descrição**: Mapear todas as dependências do Diagnostic Agent

**Dependências a mapear**:

- Variáveis de ambiente
- Repositórios SQLite
- APIs externas
- Configurações de PM2

**Entregáveis**:

- Matriz de dependências
- Plano de migração de config

#### Tarefa 1.3: Estratégia de Testes

**Descrição**: Definir estratégia de testes para a migração

**Tipos de teste**:

- Unitários (novos + migrados)
- Integração (API endpoints)
- Regressão (funcionalidades existentes)
- E2E (fluxos completos)

**Entregáveis**:

- Plano de testes documentado
- Casos de teste definidos

#### Tarefa 1.4: Backup do Estado Atual

**Descrição**: Realizar backup completo antes da migração

**Itens a backupar**:

- Banco de dados SQLite
- Configurações
- Código fonte

**Entregáveis**:

- Backup verificado
- Procedimento de restore documentado

---

### 5.2 Tarefas da Fase 2 - Implementação

#### Tarefa 2.1: Adicionar Tipos de Job `diagnostic`

**Descrição**: Adicionar suporte a jobs de tipo `diagnostic` no Audit Agent

**Arquivos a modificar**:

- `src/audit_agent/runtime.js`
- `src/audit_agent/contracts.js`
- `src/audit_agent/db_store.js`

**Implementação**:

```javascript
// Novo tipo de job
const JOB_KINDS = Object.freeze({
  PATCH_SUGGEST: 'patch_suggest',
  BUG_HUNT: 'bug_hunt',
  DIAGNOSTIC: 'diagnostic', // ← Novo
  QUICK_AUDIT: 'quick_audit',
});
```

**Critério de完成**: Jobs `diagnostic` podem ser criados e executados

#### Tarefa 2.2: Criar Serviços de Diagnóstico Integrados

**Descrição**: Criar serviços de diagnóstico como parte do Audit Agent

**Serviços a criar**:

- `diagnostic-runner.js` - Executor de diagnósticos
- `diagnostic-services/health-checker.js` - Verificação de saúde
- `diagnostic-services/system-monitor.js` - Monitor de recursos
- `diagnostic-services/model-analyzer.js` - Análise de modelos
- `diagnostic-services/code-analyzer.js` - Análise de código
- `diagnostic-services/report-generator.js` - Geração de relatórios

**Localização**: `src/audit_agent/diagnostic-services/`

#### Tarefa 2.3: Migrar Endpoints de API

**Descrição**: Garantir compatibilidade de APIs

**Endpoints a garantir**:

- `GET /health` - Saúde do serviço
- `GET /jobs` - Listar jobs
- `POST /jobs` - Criar job
- `POST /jobs/:id/run` - Executar job
- `POST /jobs/:id/cancel` - Cancelar job
- `GET /jobs/:id` - Detalhar job
- `GET /jobs/:id/report` - Obter relatório

**Estratégia**: Redirecionar chamadas do Diagnostic Agent para o Audit Agent

#### Tarefa 2.4: Atualizar Control Plane

**Descrição**: Atualizar o Control Plane para remover dependência do Diagnostic Agent

**Comandos afetados**:

- `DIAGNOSTIC_JOB_CREATE` → mapping para `AUDIT_JOB_CREATE`
- `DIAGNOSTIC_JOB_RUN` → mapping para `AUDIT_JOB_RUN`
- `DIAGNOSTIC_JOB_CANCEL` → mapping para `AUDIT_JOB_CANCEL`
- `DIAGNOSTIC_JOB_RETRY` → mapping para `AUDIT_JOB_RETRY`

**Arquivo**: `src/server/domain/control_command_service.js`

---

### 5.3 Tarefas da Fase 3 - Validação

#### Tarefa 3.1: Testes Unitários

**Descrição**: Executar e criar testes unitários

**Comandos de teste**:

```bash
# Testes existentes
npm run test:unit:audit-agent

# Novos testes
npm run test:unit:diagnostic-integration
```

**Critério**: ≥ 90% de cobertura

#### Tarefa 3.2: Testes de Integração

**Descrição**: Testar integração entre componentes

**Cenarios**:

- Criar job de diagnóstico via API
- Executar job de diagnóstico
- Obter resultados
- Cancelar job em execução

#### Tarefa 3.3: Testes de Regressão

**Descrição**: Garantir que funcionalidades existentes não foram quebradas

**Áreas de teste**:

- Mission/Task execution
- Audit Agent (existente)
- Dashboard APIs
- Control Plane

#### Tarefa 3.4: Validação Manual

**Descrição**: Validação manual porQA

**Checklist**:

- [ ] Criar job de diagnóstico
- [ ] Executar diagnóstico de saúde
- [ ] Executar diagnóstico de sistema
- [ ] Executar análise de modelo
- [ ] Cancelar diagnóstico em andamento
- [ ] Obter relatório de diagnóstico

---

### 5.4 Tarefas da Fase 4 - Cutover

#### Tarefa 4.1: Desativar Diagnostic Agent

**Descrição**: Remover processo do Diagnostic Agent do PM2

**Ações**:

1. Remover de `ecosystem.config.cjs` (se presente)
2. Parar processo se estiver rodando
3. Atualizar documentação

#### Tarefa 4.2: Ativar Funcionalidades no Audit Agent

**Descrição**: Habilitar funcionalidades de diagnóstico no Audit Agent

**Configurações**:

```bash
AUDIT_AGENT_DIAGNOSTIC_ENABLED=true
```

#### Tarefa 4.3: Monitoramento Pós-Migração

**Descrição**: Monitorar sistema após migração

**Métricas a monitorar**:

- Latência de diagnósticos
- Uso de memória
- Erros de execução
- Uso de CPU

**Duração**: 72 horas

#### Tarefa 4.4: Limpeza de Artefatos

**Descrição**: Remover código e configuração antiga

**Artefatos a remover**:

- `src/diagnostic_agent/` (após migração completa)
- Referências em documentação
- Variáveis de ambiente obsoletas

---

## 6. Critérios de Validação

### 6.1 Critérios de Aceitação

| ID    | Critério                            | Método de Verificação |
| ----- | ----------------------------------- | --------------------- |
| AC-01 | Jobs `diagnostic` podem ser criados | POST /jobs → 201      |
| AC-02 | Diagnósticos executam corretamente  | Verificar output      |
| AC-03 | Relatórios são gerados              | GET /jobs/:id/report  |
| AC-04 | API compatível com original         | Teste de regressão    |
| AC-05 | Control Plane redireciona comandos  | Teste de integração   |

### 6.2 Critérios de Qualidade

| Métrica                 | Target  |
| ----------------------- | ------- |
| Cobertura de testes     | ≥ 90%   |
| Latência de diagnóstico | < 5s    |
| Memória adicional       | < 100MB |
| Tempo de startup        | < 10s   |

### 6.3 Gates de Qualidade

Antes de cada fase:

- [ ] `node --check` passa
- [ ] `npm run lint -- --quiet` passa
- [ ] `npm run typecheck:full` passa
- [ ] `npm run test:unit` passa

---

## 7. Riscos e Mitigações

### 7.1 Riscos Identificados

| ID   | Risco                              | Probabilidade | Impacto | Mitigação                       |
| ---- | ---------------------------------- | ------------- | ------- | ------------------------------- |
| R-01 | Quebra de funcionalidade existente | Média         | Alto    | Testes de regressão abrangentes |
| R-02 | Performance degradada              | Baixa         | Médio   | Monitoramento pós-migração      |
| R-03 | Perda de dados                     | Baixa         | Crítico | Backup completo antes           |
| R-04 | Incompatibilidade de API           | Média         | Médio   | Compatibilidade retroativa      |
| R-05 | Dependências quebradas             | Baixa         | Alto    | Análise detalhada de deps       |

### 7.2 Plano de Rollback

Se algo falhar:

1. **Rollback Imediato**: Restaurar backup
2. **Rollback Gradual**: Manter ambos agentes temporariamente
3. **Rollback de Código**: Reverter commits problemáticos

---

## 8. Checklist de Remoção de Artefatos

### 8.1 Código Fonte

- [ ] `src/diagnostic_agent/` - Remover após validação completa
- [ ] Referências em `package.json`
- [ ] Testes específicos do diagnostic_agent

### 8.2 Configuração

- [ ] `ecosystem.config.cjs` - Remover entrada do diagnostic-agent
- [ ] Variáveis de ambiente `DIAGNOSTIC_AGENT_*`
- [ ] Scripts npm relacionados

### 8.3 Documentação

- [ ] Remover referências em README.md
- [ ] Atualizar DOCUMENTAÇÃO/
- [ ] Atualizar SKILLs existentes

---

## 9. Cronograma de Marcos

| Marco                 | Data Alvo | Entregável                    |
| --------------------- | --------- | ----------------------------- |
| M1 - Início           | Semana 1  | Projeto aprovado              |
| M2 - Análise Completa | Semana 1  | Relatório de análise          |
| M3 - Código Migrado   | Semana 2  | Funcionalidades implementadas |
| M4 - Testes Passando  | Semana 3  | 90% cobertura                 |
| M5 - Validação QA     | Semana 4  | Aprovação de QA               |
| M6 - Cutover          | Semana 5  | Sistema migrado               |
| M7 - Estabilização    | Semana 6  | Monitoramento completo        |

---

## 10. Glossário

| Termo                | Definição                                   |
| -------------------- | ------------------------------------------- |
| **Audit Agent**      | Agente de auditoria contínua de código      |
| **Diagnostic Agent** | Agente de diagnóstico de infraestrutura     |
| **Control Plane**    | Sistema central de comandos                 |
| **Job**              | Unidade de trabalho executada por um agente |
| **Run**              | Execução específica de um job               |
| **MCP**              | Model Context Protocol                      |
| **SSOT**             | Single Source of Truth                      |
| **PM2**              | Process Manager 2                           |

---

## Anexo: Variáveis de Ambiente

### Variáveis do Diagnostic Agent (a migrar)

| Variável                         | Atual       | Futuro  |
| -------------------------------- | ----------- | ------- |
| `DIAGNOSTIC_AGENT_ENABLED`       | `true`      | Remover |
| `DIAGNOSTIC_AGENT_HOST`          | `127.0.0.1` | Remover |
| `DIAGNOSTIC_AGENT_PORT`          | `3097`      | Remover |
| `AUDIT_AGENT_DIAGNOSTIC_ENABLED` | N/A         | `true`  |

---

## Histórico de Versões

| Versão | Data       | Autor     | Descrição               |
| ------ | ---------- | --------- | ----------------------- |
| 1.0.0  | 2026-02-23 | Kilo Code | Versão inicial do plano |

---

**Próximos Passos**: Revisar este documento e aprobar o início da Fase 1 - Preparação.
