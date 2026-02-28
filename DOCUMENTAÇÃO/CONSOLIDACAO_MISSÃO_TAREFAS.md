# Missão de Consolidação: Audit Agent + Diagnostic Agent

**Data de Criação:** 2026-02-23 **Versão:** 1.0.0 **Status:** Missão Ativa

---

## 🎯 Objetivo da Missão

Consolidar os sistemas **Audit Agent** e **Diagnostic Agent** através de:

1. Eliminação de redundâncias e código duplicado
2. Criação de módulos compartilhados
3. Adição de persistência ao Diagnostic Agent
4. Integração com Control Plane
5. Melhoria da arquitetura geral

---

## 📋 Estrutura de Tarefas

### Fase 1: Fundação e Validação (1-2 dias)

#### T1.1 - Revisão e Baseline

- [ ] Revisar `DOCUMENTAÇÃO/ANALISE_COMPARATIVA_AUDIT_DIAGNOSTIC_AGENT.md`
- [ ] Executar `npm run typecheck:full` - registrar baseline
- [ ] Executar `npm run lint -- --quiet` - registrar baseline
- [ ] Executar `npm run audit:quick -- --triage false --progress false --eta false` - registrar
      baseline

#### T1.2 - Mapeamento de Duplicações

- [ ] Identificar todos os pontos de duplicação no código
- [ ] Documentar localizações específicas:
  - `src/audit_agent/triage_llm.js` - Inference Gateway client
  - `src/audit_agent/patch_author_llm.js` - Inference Gateway client
  - `src/diagnostic_agent/services/code-analyzer.js` - Inference Gateway client
  - `src/audit_agent/context_builder.js` (probeInferenceGateway) - Health check
  - `src/diagnostic_agent/services/health-checker.js` - Health check

---

### Fase 2: Módulo Compartilhado - Inference Gateway (3-5 dias)

#### T2.1 - Criar Módulo Compartilhado

- [ ] Criar `src/shared/inference-gateway-client.js`
- [ ] Implementar funções:
  - `createInferenceGatewayClient(config)` - factory
  - `generate(clientTag, prompt, options)` - chamada de geração
  - `validateGenerate(clientTag, options)` - validação preflight
  - `listModels(clientTag)` - listar modelos
  - `healthCheck()` - verificação de saúde
- [ ] Implementar tratamento de erros padronizado
- [ ] Adicionar Types/JSDoc

#### T2.2 - Refatorar Audit Agent

- [ ] Refatorar `src/audit_agent/triage_llm.js` para usar módulo compartilhado
- [ ] Refatorar `src/audit_agent/patch_author_llm.js` para usar módulo compartilhado
- [ ] Remover código duplicado
- [ ] Executar `node --check` nos arquivos alterados

#### T2.3 - Refatorar Diagnostic Agent

- [ ] Refatorar `src/diagnostic_agent/services/code-analyzer.js` para usar módulo compartilhado
- [ ] Remover código duplicado
- [ ] Executar `node --check` nos arquivos alterados

#### T2.4 - Validação

- [ ] Executar testes unitários existentes
- [ ] Executar `npm run typecheck:full`
- [ ] Executar `npm run lint -- --quiet`
- [ ] Executar `npm run audit:quick -- --triage false --progress false --eta false`
- [ ] Documentar melhorias de código (linhas removidas)

---

### Fase 3: Módulo Compartilhado - Health Check (2-3 dias)

#### T3.1 - Criar Módulo de Health Check

- [ ] Criar `src/shared/health-check.js`
- [ ] Implementar funções:
  - `checkOllamaHealth(host, timeoutMs)` - verificação Ollama
  - `checkGatewayHealth(host, port, timeoutMs)` - verificação Gateway
  - `checkSystemHealth()` - verificação de recursos
  - `calculateOverallStatus(results)` - status agregado
- [ ] Padronizar formato de resposta

#### T3.2 - Refatorar Audit Agent

- [ ] Refatorar `src/audit_agent/context_builder.js` (probeInferenceGateway)
- [ ] Usar `src/shared/health-check.js`
- [ ] Executar `node --check` nos arquivos alterados

#### T3.3 - Refatorar Diagnostic Agent

- [ ] Refatorar `src/diagnostic_agent/services/health-checker.js`
- [ ] Usar `src/shared/health-check.js`
- [ ] Executar `node --check` nos arquivos alterados

#### T3.4 - Validação

- [ ] Executar testes unitários existentes
- [ ] Executar `npm run typecheck:full`
- [ ] Executar `npm run lint -- --quiet`
- [ ] Executar `npm run audit:quick`

---

### Fase 4: Persistência do Diagnostic Agent (5-7 dias)

#### T4.1 - Migration SQLite

- [ ] Criar migration `v9: diagnostic_analyses` em `src/infra/db/migrations.js`
- [ ] Definir schema:
  ```sql
  CREATE TABLE diagnostic_analyses (
    id TEXT PRIMARY KEY,
    analysis_type TEXT NOT NULL,
    input_json TEXT NOT NULL,
    result_json TEXT NOT NULL,
    status TEXT NOT NULL,
    duration_ms INTEGER,
    created_at_ms INTEGER NOT NULL,
    completed_at_ms INTEGER
  );
  ```
- [ ] Executar migration

#### T4.2 - Repositório

- [ ] Criar `src/infra/db/diagnostic_analysis_repo.js`
- [ ] Implementar métodos:
  - `createAnalysis(analysis)` - criar análise
  - `getAnalysisById(id)` - buscar por ID
  - `listAnalyses(limit, offset, status)` - listar com filtros
  - `updateAnalysisStatus(id, status, result)` - atualizar status
  - `deleteOldAnalyses(beforeMs)` - limpar análises antigas

#### T4.3 - Integração com Diagnostic Agent

- [ ] Modificar `src/diagnostic_agent/diagnostic-agent.js` para usar repositório
- [ ] Modificar `src/diagnostic_agent/services/code-analyzer.js` para persistir análises
- [ ] Adicionar configuração `DIAGNOSTIC_PERSIST_DB=true/false`

#### T4.4 - Endpoints de Listagem

- [ ] Adicionar `GET /api/diagnostic/analyses` em
      `src/server/api/controllers/dashboard_diagnostic.js`
- [ ] Adicionar `GET /api/diagnostic/analyses/:id` em
      `src/server/api/controllers/dashboard_diagnostic.js`
- [ ] Implementar paginação e filtros

#### T4.5 - Validação

- [ ] Executar testes unitários
- [ ] Executar `npm run typecheck:full`
- [ ] Executar `npm run lint -- --quiet`
- [ ] Executar `npm run audit:quick`
- [ ] Testar manualmente endpoints de listagem

---

### Fase 5: Control Plane Integration (3-5 dias)

#### T5.1 - Comandos DIAGNOSTIC\_\*

- [ ] Adicionar comandos em `src/server/domain/control_command_service.js`:
  - `DIAGNOSTIC_ANALYZE` - executar análise de código
  - `DIAGNOSTIC_HEALTH` - verificar saúde
  - `DIAGNOSTIC_REPORT` - gerar relatório
- [ ] Implementar handlers para cada comando
- [ ] Adicionar validação de entrada

#### T5.2 - Wrappers de Mutação

- [ ] Adicionar `POST /api/diagnostic/analyze` em
      `src/server/api/controllers/dashboard_diagnostic.js`
- [ ] Adicionar `POST /api/diagnostic/command` em
      `src/server/api/controllers/dashboard_diagnostic.js`
- [ ] Conectar com Control Plane

#### T5.3 - Testes de Integração

- [ ] Criar testes para comandos DIAGNOSTIC\_\* em `tests/unit/server/`
- [ ] Testar fluxo completo via Control Plane

#### T5.4 - Validação

- [ ] Executar todos os testes unitários
- [ ] Executar `npm run typecheck:full`
- [ ] Executar `npm run lint -- --quiet`
- [ ] Executar `npm run audit:quick`

---

### Fase 6: Documentação e Finalização (1-2 dias)

#### T6.1 - Atualizar Documentos

- [ ] Atualizar `DOCUMENTAÇÃO/ANALISE_COMPARATIVA_AUDIT_DIAGNOSTIC_AGENT.md` com resultados
- [ ] Documentar módulos criados em `src/shared/`
- [ ] Atualizar SKILL.md se necessário

#### T6.2 - Limpeza

- [ ] Remover código morto
- [ ] Adicionar comentários onde necessário
- [ ] Verificar consistência de nomenclatura

#### T6.3 - Validação Final

- [ ] Executar `npm run typecheck:full` - verificar 0 erros
- [ ] Executar `npm run lint -- --quiet` - verificar 0 warnings
- [ ] Executar `npm run audit:quick` - verificar success

---

## 📊 Métricas de Sucesso

| Métrica                       | Baseline | Meta    |
| ----------------------------- | -------- | ------- |
| Linhas de código duplicado    | ~150     | 0       |
| Módulos compartilhados        | 0        | 2       |
| Persistência Diagnostic Agent | ❌       | ✅      |
| Comandos no Control Plane     | 0        | 3+      |
| typecheck:full erros          | 0        | 0       |
| audit:quick                   | success  | success |

---

## 🔗 Referências

- **Documento de Análise:** `DOCUMENTAÇÃO/ANALISE_COMPARATIVA_AUDIT_DIAGNOSTIC_AGENT.md`
- **Skill:** `.github/skills/agent-consolidation-ops/SKILL.md`
- **Audit Agent:** `src/audit_agent/`
- **Diagnostic Agent:** `src/diagnostic_agent/`
- **Inference Gateway:** `src/inference_gateway/`
- **Control Plane:** `src/server/domain/control_command_service.js`
- **Dashboard:** `src/server/api/controllers/dashboard*.js`

---

## ⚠️ Notas

1. **Compatibilidade**: Todas as mudanças devem manter compatibilidade com o runtime existente
2. **Flags**: Novas funcionalidades devem entrar atrás de flags (default off)
3. **Testes**: Criar testes unitários para novos módulos antes de refatorar
4. **Validação**: Executar quality gates após cada fase

---

_Documento será atualizado conforme avanzarmos na missão_
