# 📚 Índice de Documentação

**Navegação completa** de toda documentação do projeto `chatgpt-docker-puppeteer`.

---

## 🚀 Início Rápido

Novo no projeto? Comece aqui:

1. **[README.md](../README.md)** - Visão geral e quick start
2. **[CONTRIBUTING.md](../CONTRIBUTING.md)** - Como contribuir
3. **[SCRIPTS.md](SCRIPTS.md)** - Referência de 90+ npm scripts
4. **[CHROME_EXTERNAL_SETUP.md](../CHROME_EXTERNAL_SETUP.md)** - Setup Chrome remote debugging
5. **[DOCKER_SETUP.md](../DOCKER_SETUP.md)** - Deploy com Docker

---

## 📖 Documentação por Categoria

### 🏗️ Arquitetura & Design

| Documento                                                               | Descrição                               | Status          |
| ----------------------------------------------------------------------- | --------------------------------------- | --------------- |
| [ARCHITECTURE.md](ARCHITECTURE.md)                                      | Visão geral da arquitetura NERV-centric | ✅ Ativa        |
| [SYSTEM_ANALYSIS_COMPLETE.md](SYSTEM_ANALYSIS_COMPLETE.md)              | Análise técnica completa do sistema     | ✅ Ativa        |
| [ARCHITECTURE_DIAGRAMS.md](ARCHITECTURE_DIAGRAMS.md)                    | Diagramas visuais da arquitetura        | ✅ Ativa        |
| [TYPES_ARCHITECTURE.md](../TYPES_ARCHITECTURE.md)                       | Arquitetura de tipos e type safety      | 🔄 Em progresso |
| [TYPESCRIPT_MIGRATION_ANALYSIS.md](../TYPESCRIPT_MIGRATION_ANALYSIS.md) | Análise de migração para TypeScript     | 🔄 Planejado    |

### 🔧 Configuração

| Documento                                      | Descrição                                  | Status   |
| ---------------------------------------------- | ------------------------------------------ | -------- |
| [CONFIGURATION.md](CONFIGURATION.md)           | Guia de configuração (config.json, .env)   | ✅ Ativa |
| [CONFIG_FILES.md](CONFIG_FILES.md)             | Referência detalhada de arquivos de config | ✅ Ativa |
| [../config.json](../config.json)               | Configuração mestra (29 parâmetros)        | ✅ Ativa |
| [../dynamic_rules.json](../dynamic_rules.json) | DNA v5 - Selectors evolutivos              | ✅ Ativa |
| [../.env.example](../.env.example)             | Template de variáveis de ambiente          | ✅ Ativa |

### 🚢 Deploy & Produção

| Documento                                                  | Descrição                              | Status   |
| ---------------------------------------------------------- | -------------------------------------- | -------- |
| [DEPLOYMENT.md](DEPLOYMENT.md)                             | Guia de deploy (PM2, Docker, produção) | ✅ Ativa |
| [../DOCKER_SETUP.md](../DOCKER_SETUP.md)                   | Setup Docker detalhado                 | ✅ Ativa |
| [../Dockerfile](../Dockerfile)                             | Multi-stage Alpine (produção)          | ✅ Ativa |
| [../Dockerfile.dev](../Dockerfile.dev)                     | Dockerfile para desenvolvimento        | ✅ Ativa |
| [../docker-compose.yml](../docker-compose.yml)             | Compose base (dev/prod)                | ✅ Ativa |
| [../docker-compose.dev.yml](../docker-compose.dev.yml)     | Compose com hot-reload                 | ✅ Ativa |
| [../docker-compose.prod.yml](../docker-compose.prod.yml)   | Compose para produção                  | ✅ Ativa |
| [../docker-compose.linux.yml](../docker-compose.linux.yml) | Compose Linux-specific                 | ✅ Ativa |
| [../ecosystem.config.js](../ecosystem.config.js)           | PM2 config (2 apps)                    | ✅ Ativa |
| [../Makefile](../Makefile)                                 | 20+ comandos Docker/test/monitoring    | ✅ Ativa |

### 🧪 Testes

| Documento                                                          | Descrição                              | Status          |
| ------------------------------------------------------------------ | -------------------------------------- | --------------- |
| [TESTING.md](TESTING.md)                                           | Estratégia e framework de testes       | ✅ Ativa        |
| [../TESTS_STRATEGY.md](../TESTS_STRATEGY.md)                       | Estratégia de testes                   | ✅ Ativa        |
| [../TESTS_COVERAGE_MATRIX.md](../TESTS_COVERAGE_MATRIX.md)         | Matriz de cobertura (78% após cleanup) | ✅ Ativa        |
| [../TESTS_IMPLEMENTATION_PLAN.md](../TESTS_IMPLEMENTATION_PLAN.md) | Plano de implementação de testes       | 🔄 Em progresso |
| [../TESTS_MAPEAMENTO.md](../TESTS_MAPEAMENTO.md)                   | Mapeamento de testes existentes        | ✅ Ativa        |

### 🎨 Code Quality

| Documento                                              | Descrição                                 | Status   |
| ------------------------------------------------------ | ----------------------------------------- | -------- |
| [../eslint.config.mjs](../eslint.config.mjs)           | ESLint v9 Flat Config (255 linhas)        | ✅ Ativa |
| [../.prettierrc](../.prettierrc)                       | Prettier config (single quotes, 4 spaces) | ✅ Ativa |
| [../jsconfig.json](../jsconfig.json)                   | VS Code IntelliSense config               | ✅ Ativa |
| [../CONSTANTS_INVENTORY.md](../CONSTANTS_INVENTORY.md) | Inventário de constantes tipadas          | ✅ Ativa |
| [SCRIPTS.md](SCRIPTS.md)                               | Referência de 90+ npm scripts             | ✅ Ativa |

### 🔍 Análises Técnicas

| Documento                                                                  | Descrição                    | Status   |
| -------------------------------------------------------------------------- | ---------------------------- | -------- |
| [ANALISE_TECNICA.md](ANALISE_TECNICA.md)                                   | Análise técnica geral        | ✅ Ativa |
| [GAP_ANALYSIS.md](GAP_ANALYSIS.md)                                         | Gaps identificados           | ✅ Ativa |
| [DIAGNOSTIC_CONSOLIDADO.md](DIAGNOSTIC_CONSOLIDADO.md)                     | Diagnóstico consolidado      | ✅ Ativa |
| [DEPENDENCY_UPGRADE_RISK_ANALYSIS.md](DEPENDENCY_UPGRADE_RISK_ANALYSIS.md) | Análise de risco de upgrades | ✅ Ativa |
| [PROJECT_CONFIGURATION_AUDIT.md](PROJECT_CONFIGURATION_AUDIT.md)           | Auditoria de configurações   | ✅ Ativa |

### 🧠 Subsistemas (NERV, KERNEL, DRIVER, etc.)

| Documento                                                                          | Descrição                               | Status   |
| ---------------------------------------------------------------------------------- | --------------------------------------- | -------- |
| [CONNECTION_ORCHESTRATOR.md](CONNECTION_ORCHESTRATOR.md)                           | Browser pool e connection modes         | ✅ Ativa |
| [CONNECTION_ORCHESTRATOR_V2.md](CONNECTION_ORCHESTRATOR_V2.md)                     | Análise detalhada V2                    | ✅ Ativa |
| [DRIVER_INTEGRATION_REPORT.md](DRIVER_INTEGRATION_REPORT.md)                       | Integração de drivers (ChatGPT, Gemini) | ✅ Ativa |
| [CRITICAL_CASES_ANALYSIS_V2.md](CRITICAL_CASES_ANALYSIS_V2.md)                     | Análise de casos críticos               | ✅ Ativa |
| [TECHNICAL/NERV/ANALISE_NERV_ENVELOPE.md](TECHNICAL/NERV/ANALISE_NERV_ENVELOPE.md) | Análise do envelope NERV                | ✅ Ativa |

### 📋 Auditorias de Subsistemas (Mini-Auditorias)

| Documento                                                                            | Descrição                                      | Status                          |
| ------------------------------------------------------------------------------------ | ---------------------------------------------- | ------------------------------- |
| [AUDITORIAS/00_ROOT_FILES_AUDIT.md](AUDITORIAS/00_ROOT_FILES_AUDIT.md)               | Auditoria de arquivos root (fundação)          | ✅ Completa                     |
| [AUDITORIAS/01_CORE_AUDIT.md](AUDITORIAS/01_CORE_AUDIT.md)                           | Auditoria do subsistema CORE                   | ✅ Completa                     |
| [AUDITORIAS/02_NERV_AUDIT.md](AUDITORIAS/02_NERV_AUDIT.md)                           | Auditoria do subsistema NERV (IPC 2.0)         | ✅ Completa (13 correções P1)   |
| [AUDITORIAS/03_INFRA_AUDIT.md](AUDITORIAS/03_INFRA_AUDIT.md)                         | Auditoria do subsistema INFRA (Browser, I/O)   | ✅ Completa (4 correções P3)    |
| [AUDITORIAS/04_KERNEL_AUDIT.md](AUDITORIAS/04_KERNEL_AUDIT.md)                       | Auditoria do subsistema KERNEL (Decision Core) | ✅ Completa (5 correções P2+P3) |
| [AUDITORIAS/05_DRIVER_AUDIT.md](AUDITORIAS/05_DRIVER_AUDIT.md)                       | Auditoria do subsistema DRIVER                 | ⏳ Próxima                      |
| [AUDITORIAS/06_SERVER_AUDIT.md](AUDITORIAS/06_SERVER_AUDIT.md)                       | Auditoria do subsistema SERVER                 | ⏳ Pendente                     |
| [AUDITORIAS/07_LOGIC_AUDIT.md](AUDITORIAS/07_LOGIC_AUDIT.md)                         | Auditoria do subsistema LOGIC                  | ⏳ Pendente                     |
| [AUDITORIAS/08_DASHBOARD_AUDIT.md](AUDITORIAS/08_DASHBOARD_AUDIT.md)                 | Auditoria do DASHBOARD (futuro)                | ⏳ Pendente                     |
| [AUDITORIAS/NERV_CORRECTIONS_SUMMARY.md](AUDITORIAS/NERV_CORRECTIONS_SUMMARY.md)     | Resumo de correções NERV (13 aplicadas)        | ✅ Documentado                  |
| [AUDITORIAS/INFRA_CORRECTIONS_SUMMARY.md](AUDITORIAS/INFRA_CORRECTIONS_SUMMARY.md)   | Resumo de correções INFRA (4 aplicadas)        | ✅ Documentado                  |
| [AUDITORIAS/KERNEL_CORRECTIONS_SUMMARY.md](AUDITORIAS/KERNEL_CORRECTIONS_SUMMARY.md) | Resumo de correções KERNEL (5 aplicadas)       | ✅ Documentado                  |
| [AUDITORIAS/AUDIT_COVERAGE_MASTER_PLAN.md](AUDITORIAS/AUDIT_COVERAGE_MASTER_PLAN.md) | Plano mestre de cobertura de auditorias        | ✅ Atualizado                   |

### 📝 Planejamento & Roadmap

| Documento                                              | Descrição                            | Status          |
| ------------------------------------------------------ | ------------------------------------ | --------------- |
| [CANONICAL_DOCS_PLAN.md](CANONICAL_DOCS_PLAN.md)       | Plano de documentação canônica       | ✅ Ativa        |
| [ROADMAP_DOCUMENTATION.md](ROADMAP_DOCUMENTATION.md)   | Roadmap de documentação              | ✅ Ativa        |
| [ROADMAP.md](ROADMAP.md)                               | Roadmap geral do projeto             | ✅ Ativa        |
| [../IMPLEMENTATION_PLAN.md](../IMPLEMENTATION_PLAN.md) | Plano de implementação (type safety) | 🔄 Em progresso |

### 🔐 Segurança

| Documento                                                | Descrição                      | Status   |
| -------------------------------------------------------- | ------------------------------ | -------- |
| [../SECURITY_SCAN_POLICY.md](../SECURITY_SCAN_POLICY.md) | Política de scans de segurança | ✅ Ativa |
| [../LICENSE](../LICENSE)                                 | MIT License                    | ✅ Ativa |

### 📚 Referências & Outros

| Documento                                | Descrição                   | Status   |
| ---------------------------------------- | --------------------------- | -------- |
| [API.md](API.md)                         | Referência de APIs públicas | ✅ Ativa |
| [SUMMARY.md](SUMMARY.md)                 | Sumário executivo           | ✅ Ativa |
| [../CHANGELOG.md](../CHANGELOG.md)       | Histórico de versões        | ✅ Ativa |
| [../CONTRIBUTING.md](../CONTRIBUTING.md) | Guia de contribuição        | ✅ Ativa |

---

## 🗂️ Documentação de Trabalho

Documentação usada durante desenvolvimento mas não final:

| Documento                                                                      | Descrição                  | Status      |
| ------------------------------------------------------------------------------ | -------------------------- | ----------- |
| [../DOCUMENTACAO_AUDITORIA_COMPLETA.md](../DOCUMENTACAO_AUDITORIA_COMPLETA.md) | Auditoria de 99 .md files  | 🔄 Trabalho |
| [../MINI_AUDITORIAS_SUBSISTEMAS.md](../MINI_AUDITORIAS_SUBSISTEMAS.md)         | Template para 8 auditorias | 🔄 Trabalho |
| [../FASE_ESCLARECIMENTO.md](../FASE_ESCLARECIMENTO.md)                         | 14 dúvidas técnicas        | 🔄 Trabalho |

---

## 📂 Documentação Histórica (Legacy)

Documentação obsoleta mantida apenas para referência:

- **[../analysis/legacy/](../analysis/legacy/)** - Fases concluídas, otimizações aplicadas,
  relatórios antigos
  - FASE1_CONCLUIDA.md
  - FASE2_CONCLUIDA.md
  - MERGE_UPGRADE_COMPLETE.md
  - CONFIGURATION_OPTIMIZATION_COMPLETE.md
  - ESLINT_IMPROVEMENTS_COMPLETE.md
  - DOCKERFILE_OPTIMIZATION_REPORT.md
  - OPTIMIZATION_RECOMMENDATIONS.md
  - OPTIMIZATION_SUMMARY.md
  - TEST_REPORT_FINAL.md
  - TESTS_AUDIT_RESULTS.md

- **[../scripts/legacy/](../scripts/legacy/)** - Scripts obsoletos
  - rodar_agente.bat (deprecado - use `npm run daemon:start`)

---

## 🔍 Como Navegar

### Por Necessidade

**Quero começar agora**: → [README.md](../README.md) →
[CHROME_EXTERNAL_SETUP.md](../CHROME_EXTERNAL_SETUP.md)

**Quero entender a arquitetura**: → [ARCHITECTURE.md](ARCHITECTURE.md) →
[SYSTEM_ANALYSIS_COMPLETE.md](SYSTEM_ANALYSIS_COMPLETE.md)

**Quero configurar**: → [CONFIGURATION.md](CONFIGURATION.md) → [CONFIG_FILES.md](CONFIG_FILES.md)

**Quero fazer deploy**: → [DEPLOYMENT.md](DEPLOYMENT.md) → [DOCKER_SETUP.md](../DOCKER_SETUP.md)

**Quero escrever testes**: → [TESTING.md](TESTING.md) → [TESTS_STRATEGY.md](../TESTS_STRATEGY.md)

**Quero contribuir**: → [CONTRIBUTING.md](../CONTRIBUTING.md) → [SCRIPTS.md](SCRIPTS.md)

**Quero troubleshoot**: → [TROUBLESHOOTING.md](TROUBLESHOOTING.md) →
[DIAGNOSTIC_CONSOLIDADO.md](DIAGNOSTIC_CONSOLIDADO.md)

### Por Subsistema

- **CORE**: [AUDITORIAS/01_CORE_AUDIT.md](AUDITORIAS/01_CORE_AUDIT.md) ✅
- **NERV**: [AUDITORIAS/02_NERV_AUDIT.md](AUDITORIAS/02_NERV_AUDIT.md) +
  [NERV_CORRECTIONS_SUMMARY.md](AUDITORIAS/NERV_CORRECTIONS_SUMMARY.md) ✅
- **INFRA**: [AUDITORIAS/03_INFRA_AUDIT.md](AUDITORIAS/03_INFRA_AUDIT.md) +
  [INFRA_CORRECTIONS_SUMMARY.md](AUDITORIAS/INFRA_CORRECTIONS_SUMMARY.md) ✅
- **KERNEL**: [AUDITORIAS/04_KERNEL_AUDIT.md](AUDITORIAS/04_KERNEL_AUDIT.md) +
  [KERNEL_CORRECTIONS_SUMMARY.md](AUDITORIAS/KERNEL_CORRECTIONS_SUMMARY.md) ✅
- **DRIVER**: [AUDITORIAS/05_DRIVER_AUDIT.md](AUDITORIAS/05_DRIVER_AUDIT.md) ⏳ Próximo
- **SERVER**: [AUDITORIAS/06_SERVER_AUDIT.md](AUDITORIAS/06_SERVER_AUDIT.md) ⏳
- **LOGIC**: [AUDITORIAS/07_LOGIC_AUDIT.md](AUDITORIAS/07_LOGIC_AUDIT.md) ⏳
- **DASHBOARD**: [AUDITORIAS/08_DASHBOARD_AUDIT.md](AUDITORIAS/08_DASHBOARD_AUDIT.md) ⏳

---

## 📊 Estatísticas

- **Total de documentos**: 99+ arquivos .md
- **Documentação ativa**: ~50 arquivos
- **Documentação legacy**: 11 arquivos (movidos para analysis/legacy/)
- **Auditorias completas**: 5/8 (ROOT, CORE, NERV, INFRA, KERNEL)
- **Auditorias pendentes**: 3/8 (DRIVER, SERVER, LOGIC/DASHBOARD)
- **Correções aplicadas**: 22 total (NERV: 13, INFRA: 4, KERNEL: 5)
- **Cobertura de testes**: 78% (após cleanup Jan 2026)
- **Scripts npm**: 90+

---

## 🔄 Última Atualização

**Data**: 2026-01-21 **Versão**: v1.0.0 **Status**: Em consolidação (mini-auditorias em andamento)

---

## 💡 Dicas

1. Use **Ctrl+F** para buscar tópicos específicos neste índice
2. Cada documento tem **links internos** para navegação rápida
3. Documentos marcados com 🔄 estão **em progresso**
4. Documentos marcados com ⏳ estão **planejados** mas não iniciados
5. Para contribuir com docs: veja [CONTRIBUTING.md](../CONTRIBUTING.md)

---

**Mantido por**: Projeto chatgpt-docker-puppeteer **Licença**: MIT
