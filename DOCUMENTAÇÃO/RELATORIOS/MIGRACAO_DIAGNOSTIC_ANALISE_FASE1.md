# Análise do Diagnostic Agent - Fase 1 Preparação

## Resumo Executivo

Esta análise foi conduzida como parte da **Fase 1: Preparação** do projeto de migração do Diagnostic
Agent para o Audit Agent. O objetivo é identificar todos os componentes, dependências e padrões de
implementação para planejar a integração.

---

## 1. Arquitetura do Diagnostic Agent

### 1.1 Estrutura de Arquivos

```
src/diagnostic_agent/
├── main.js                    # Entry point - servidor HTTP nativo
├── diagnostic-agent.js        # Orquestrador principal
├── utils/
│   ├── constants.js           # Comandos, configurações, env vars
│   ├── logger.js             # Logger próprio (não compartilhado)
│   └── validators.js         # Validação Zod
└── services/
    ├── health-checker.js      # Verifica Ollama + Inference Gateway + sistema
    ├── system-monitor.js      # Info do sistema, logs, validação de config
    ├── model-analyzer.js      # Lista modelos do Ollama
    ├── report-generator.js    # Gera relatórios de diagnóstico
    └── code-analyzer.js       # Analisa código usando LLM via Inference Gateway
```

### 1.2 Características Técnicas

| Característica           | Diagnostic Agent    | Audit Agent                   |
| ------------------------ | ------------------- | ----------------------------- |
| Servidor HTTP            | Native `node:http`  | Express                       |
| Logger                   | Próprio             | Compartilhado (`core/logger`) |
| Persistência             | Nenhuma (memória)   | SQLite                        |
| PM2 Configurado          | **Não**             | Sim (atrás de flag)           |
| Porta                    | 3097 (configurável) | 3098                          |
| Integração Control Plane | Proxy HTTP          | Direta                        |

---

## 2. Comandos Suportados

### 2.1 Comandos Internos (7)

```javascript
DIAGNOSTIC_COMMANDS = {
  DIAGNOSTIC_HEALTH: 'DIAGNOSTIC_HEALTH', // Verificação de saúde
  DIAGNOSTIC_LOGS: 'DIAGNOSTIC_LOGS', // Leitura de logs
  DIAGNOSTIC_MODELS: 'DIAGNOSTIC_MODELS', // Lista modelos Ollama
  DIAGNOSTIC_REPORT: 'DIAGNOSTIC_REPORT', // Gera relatórios
  DIAGNOSTIC_SYSTEM: 'DIAGNOSTIC_SYSTEM', // Info do sistema
  DIAGNOSTIC_CONFIG: 'DIAGNOSTIC_CONFIG', // Valida config
  DIAGNOSTIC_VERIFY: 'DIAGNOSTIC_VERIFY', // Verificação completa
};
```

### 2.2 Comandos do Control Plane (4)

```javascript
COMMANDS = {
  DIAGNOSTIC_JOB_CREATE: 'DIAGNOSTIC_JOB_CREATE', // Criar job
  DIAGNOSTIC_JOB_RUN: 'DIAGNOSTIC_JOB_RUN', // Executar job
  DIAGNOSTIC_JOB_CANCEL: 'DIAGNOSTIC_JOB_CANCEL', // Cancelar job
  DIAGNOSTIC_JOB_RETRY: 'DIAGNOSTIC_JOB_RETRY', // Retry job
};
```

---

## 3. Variáveis de Ambiente

### 3.1 Específicas do Diagnostic Agent

| Variável                              | Default                       | Descrição               |
| ------------------------------------- | ----------------------------- | ----------------------- |
| `DIAGNOSTIC_ENABLED`                  | `false`                       | Habilita o agente       |
| `DIAGNOSTIC_PORT`                     | `3097`                        | Porta HTTP              |
| `DIAGNOSTIC_LOG_LEVEL`                | `info`                        | Nível de log            |
| `DIAGNOSTIC_MAX_CONCURRENT_CHECKS`    | `3`                           | Checks concorrentes     |
| `DIAGNOSTIC_LOG_LINES_MAX`            | `10000`                       | Máximo de linhas de log |
| `DIAGNOSTIC_REPORT_MAX_SIZE_MB`       | `10`                          | Tamanho máx relatório   |
| `DIAGNOSTIC_DEFAULT_TIMEOUT_MS`       | `30000`                       | Timeout padrão          |
| `DIAGNOSTIC_HEALTH_CHECK_INTERVAL_MS` | `60000`                       | Intervalo health check  |
| `DIAGNOSTIC_ALLOWED_PATHS`            | `process.cwd()`               | Paths permitidos        |
| `DIAGNOSTIC_ALLOWED_LOG_PATHS`        | `artifacts/logs,logs,var/log` | Paths de log            |
| `DIAGNOSTIC_TICK_INTERVAL_MS`         | `10000`                       | Intervalo do loop       |

### 3.2 Comuns (Ollama + Inference Gateway)

| Variável                 | Default                  | Descrição     |
| ------------------------ | ------------------------ | ------------- |
| `OLLAMA_HOST`            | `http://localhost:11434` | Host Ollama   |
| `INFERENCE_GATEWAY_HOST` | `http://localhost`       | Host Gateway  |
| `INFERENCE_GATEWAY_PORT` | `3009`                   | Porta Gateway |

---

## 4. Endpoints HTTP

### 4.1 Endpoints do Diagnostic Agent

| Método | Path                  | Descrição               |
| ------ | --------------------- | ----------------------- |
| GET    | `/health`             | Health check            |
| GET    | `/metrics`            | Métricas do agente      |
| POST   | `/command`            | Executa comando         |
| GET    | `/status`             | Status atual            |
| POST   | `/api/analyze`        | Analisa código com LLM  |
| POST   | `/api/analyze/report` | Gera relatório markdown |
| POST   | `/jobs`               | Cria job de diagnóstico |
| GET    | `/jobs`               | Lista jobs              |
| GET    | `/jobs/:id`           | Detalhes do job         |
| POST   | `/jobs/:id/run`       | Executa job             |
| POST   | `/jobs/:id/cancel`    | Cancela job             |

---

## 5. Integração com Inference Gateway

### 5.1 Client Tags

```javascript
CLIENT_TAGS = {
  DIAGNOSTIC_HEALTH: 'diagnostic_health',
  DIAGNOSTIC_REPORT: 'diagnostic_report',
  DIAGNOSTIC_ANALYSIS: 'diagnostic_analysis',
};
```

### 5.2 Endpoints Usados

- `GET /health` - Health check
- `GET /v1/models` - Lista modelos
- `POST /v1/generate` - Gera análise de código

---

## 6. Mapeamento para Audit Agent

### 6.1 Equivalências de Funcionalidades

| Diagnostic Agent | Audit Agent                | Status Migrar |
| ---------------- | -------------------------- | ------------- |
| HealthChecker    | Context Builder (MCP/RAG)  | ✅ Sim        |
| SystemMonitor    | Runtime (system info)      | ✅ Sim        |
| ModelAnalyzer    | Inference Gateway          | ❌ Já existe  |
| ReportGenerator  | Dashboard APIs             | ✅ Parcial    |
| CodeAnalyzer     | TriageLLM + PatchAuthorLLM | ✅ Sim        |
| Job Management   | Audit Job System           | ✅ Parcial    |

### 6.2 Integração Proposta

1. **Job Types**: Adicionar `diagnostic` aos tipos de job do Audit Agent
2. **Serviços**: Reutilizar serviços do Diagnostic Agent como módulos
3. **API**: Migrar endpoints HTTP para o Express do Audit Agent
4. **Control Plane**: Redirecionar comandos DIAGNOSTIC\_\* para o Audit Agent

---

## 7. Testes Existentes

### 7.1 Cobertura Atual

- **Testes do Control Plane**: `tests/unit/server/test_control_command_service_diagnostic.spec.js`
  - 11 testes para validação e execução de comandos DIAGNOSTIC\_\*
  - Validação sem proxy (dryRun)
  - Teste de proxy para servidor indisponível

### 7.2 Testes Necessários (Fase 2)

- Testes unitários para cada serviço
- Testes de integração HTTP
- Testes de proxy do Control Plane

---

## 8. Riscos e Considerações

### 8.1 Riscos Identificados

1. **Logger Próprio**: O Diagnostic Agent usa logger customizado, não compartilhado com o core
2. **Servidor HTTP Nativo**: Diferente do padrão Express do projeto
3. **Sem Persistência**: Dados são perdidos ao reiniciar
4. **Sem PM2**: Não tem processo configurado no ecosystem.config.cjs

### 8.2 Recomendações

1. Migrar para logger compartilhado (`core/logger`)
2. Integrar ao servidor Express existente do Audit Agent
3. Adicionar persistência SQLite (herdada do Audit Agent)
4. Configurar no PM2 (similar ao Audit Agent)

---

## 9. Próximos Passos

### Fase 1 (Concluída)

- ✅ Análise do código fonte
- ✅ Mapeamento de dependências
- ✅ Definição de estratégia de testes

### Fase 2 (Implementação)

- [ ] Adicionar tipos de job `diagnostic` ao Audit Agent
- [ ] Criar serviços integrados
- [ ] Migrar endpoints HTTP
- [ ] Atualizar Control Plane

### Fase 3 (Validação)

- [ ] Testes unitários
- [ ] Testes de integração
- [ ] Testes de regressão

### Fase 4 (Cutover)

- [ ] Desabilitar Diagnostic Agent
- [ ] Habilitar diagnósticos no Audit Agent
- [ ] Monitoramento pós-migração

---

_Documento gerado em: 2026-02-23_ _Fase: 1.4 - Análise Concluída_
