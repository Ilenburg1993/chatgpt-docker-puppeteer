# Diagnostic Agent - Guia de Uso e Próximos Passos

## Status Atual

O Diagnostic Agent foi implementado com sucesso e passou em todos os quality gates:
- ✅ `typecheck:full` - 0 erros
- ✅ `lint` - OK
- ✅ `audit:quick` - success

## O que já está implementado

### Estrutura de Arquivos
```
src/diagnostic_agent/
├── main.js                    # Entry point HTTP server
├── diagnostic-agent.js         # Orquestrador principal
├── services/
│   ├── health-checker.js      # Verifica saúde Ollama + Inference Gateway
│   ├── system-monitor.js      # Coleta info de sistema, logs, validação config
│   ├── model-analyzer.js     # Lista modelos disponíveis no Ollama
│   ├── report-generator.js    # Gera relatórios JSON/Markdown/HTML
│   └── code-analyzer.js      # ✨ NOVO: Análise de código via LLM
├── utils/
│   ├── constants.js           # Constantes e configurações
│   ├── validators.js          # Schemas Zod para validação
│   └── logger.js              # Logger estruturado
└── routes/
    └── diagnostic-routes.js   # Rotas HTTP do agente
```

### Comandos Implementados
- **DIAGNOSTIC_HEALTH** - Verifica saúde do Ollama e Inference Gateway
- **DIAGNOSTIC_SYSTEM** - Coleta informações do sistema (CPU, memória, rede)
- **DIAGNOSTIC_MODELS** - Lista modelos disponíveis no Ollama
- **DIAGNOSTIC_LOGS** - Lê logs do sistema (com allowlist de paths)
- **DIAGNOSTIC_CONFIG** - Valida configuração do ambiente
- **DIAGNOSTIC_VERIFY** - Verificação completa do sistema
- **DIAGNOSTIC_REPORT** - Gera relatório consolidado
- **DIAGNOSTIC_ANALYZE_CODE** - ✨ NOVO: Analisa código via LLM local

---

## 🎯 Como Pedir à LLM para Analisar Código

Agora você pode pedir à **LLM local (Ollama)** para:
1. **Ler arquivos de código fonte**
2. **Analisar o código** para encontrar bugs, gaps, problemas
3. **Gerar relatório** com propostas de correção

### API de Análise de Código

#### 1. Analisar arquivos específicos

```bash
curl -X POST http://localhost:3456/api/analyze \
  -H "Content-Type: application/json" \
  -d '{
    "patterns": ["src/diagnostic_agent/main.js"],
    "workspaceDir": "/workspaces/chatgpt-docker-puppeteer",
    "gatewayUrl": "http://localhost:3457",
    "clientTag": "diagnostic_code_analyzer"
  }'
```

#### 2. Analisar um diretório

```bash
curl -X POST http://localhost:3456/api/analyze \
  -H "Content-Type: application/json" \
  -d '{
    "patterns": ["src/diagnostic_agent/"],
    "workspaceDir": "/workspaces/chatgpt-docker-puppeteer",
    "model": "llama3.2"
  }'
```

#### 3. Gerar relatório em Markdown

```bash
curl -X POST http://localhost:3456/api/analyze/report \
  -H "Content-Type: application/json" \
  -d '{
    "patterns": ["src/diagnostic_agent/"],
    "workspaceDir": "/workspaces/chatgpt-docker-puppeteer",
    "format": "markdown"
  }'
```

### Parâmetros da API

| Parâmetro | Tipo | Padrão | Descrição |
|-----------|------|--------|-----------|
| `patterns` | string[] | obrigatório | Arquivos/diretórios para analisar |
| `workspaceDir` | string | cwd | Diretório base do projeto |
| `gatewayUrl` | string | http://localhost:3457 | URL do Inference Gateway |
| `clientTag` | string | diagnostic_code_analyzer | Tag do cliente para políticas |
| `model` | string | llama3.2 | Modelo Ollama a usar |
| `parallel` | boolean | false | Executar análises em paralelo |
| `format` | string | markdown | Formato do relatório (markdown/json) |

---

## Como Utilizar

### 1. Iniciar o Agente (API HTTP)

```bash
# Definir variáveis de ambiente
export DIAGNOSTIC_ENABLED=true
export DIAGNOSTIC_PORT=3456
export OLLAMA_HOST=http://localhost:11434
export INFERENCE_GATEWAY_HOST=http://localhost
export INFERENCE_GATEWAY_PORT=3455
export INFERENCE_GATEWAY_URL=http://localhost:3457

# Iniciar o agente
node src/diagnostic_agent/main.js
```

### 2. Utilizar a API

```bash
# Verificar saúde
curl http://localhost:3456/health

# Ver modelos disponíveis
curl http://localhost:3456/api/models

# Ver info do sistema
curl http://localhost:3456/api/system

# Verificar configuração
curl http://localhost:3456/api/config

# Gerar relatório completo (JSON)
curl -X POST http://localhost:3456/api/report \
  -H "Content-Type: application/json" \
  -d '{"format": "json", "scope": "full"}'

# Gerar relatório em Markdown
curl -X POST http://localhost:3456/api/report \
  -H "Content-Type: application/json" \
  -d '{"format": "markdown", "scope": "full"}'
```

### 3. Example de Uso Programático

```javascript
import { analyzeCode, generateMarkdownReport } from './services/code-analyzer.js';

// Analisar código
const result = await analyzeCode({
  patterns: ['src/diagnostic_agent/'],
  workspaceDir: '/workspaces/chatgpt-docker-puppeteer',
  gatewayUrl: 'http://localhost:3457',
  clientTag: 'diagnostic_code_analyzer',
  model: 'llama3.2'
});

console.log(result.summary);
console.log(result.allIssues);
console.log(result.allGaps);

// Gerar relatório
const report = generateMarkdownReport(result);
console.log(report);
```

---

## Exemplos de Prompts para a LLM

Agora você pode pedir ao Diagnostic Agent para fazer análises como:

> *"Analise todos os arquivos em `src/server/` e identifique possíveis bugs, problemas de segurança e oportunidades de refatoração."*

> *"Faça uma auditoria do código em `src/diagnostic_agent/` e gere um relatório com os principais problemas encontrados."*

> *"Analise o arquivo `src/core/config.js` e sugira correções para qualquer code smell ou problema de performance."*

---

## Próximos Passos (O que falta para o sistema estar plenamente funcional)

### 1. Integração com Control Plane (Alta Prioridade)
- Adicionar comandos `DIAGNOSTIC_*` ao `control_command_service.js`
- Criar endpoints no dashboard para acionar o agente
- Permitir que LLMs chamem o agente via API

### 2. Configuração PM2 (Alta Prioridade)
- Adicionar processo ao `ecosystem.config.cjs`
- Scripts npm para start/stop/restart

### 3. Testes Unitários (Média Prioridade)
- Criar testes em `tests/unit/diagnostic_agent/`
- Testar cada serviço individualmente

### 4. Integração com MCP (Futuro)
- Expor ferramentas via MCP para que outras LLMs possam usar

---

## Variáveis de Ambiente

| Variável | Padrão | Descrição |
|----------|--------|-----------|
| `DIAGNOSTIC_ENABLED` | `false` | Habilita o agente |
| `DIAGNOSTIC_PORT` | `3456` | Porta do servidor HTTP |
| `DIAGNOSTIC_ALLOWED_LOG_PATHS` | `artifacts/logs,logs,var/log` | Paths permitidos para leitura de logs |
| `DIAGNOSTIC_DEFAULT_TIMEOUT_MS` | `30000` | Timeout padrão em ms |
| `OLLAMA_HOST` | `http://localhost:11434` | Host do Ollama |
| `INFERENCE_GATEWAY_HOST` | `http://localhost` | Host do Inference Gateway |
| `INFERENCE_GATEWAY_PORT` | `3455` | Porta do Inference Gateway |
| `INFERENCE_GATEWAY_URL` | `http://localhost:3457` | URL completa do Inference Gateway |

---

## Roadmap Sugerido

1. **Fase 1** - Integração Control Plane + PM2
2. **Fase 2** - Testes unitários + npm scripts
3. **Fase 3** - Integração MCP + UI no Dashboard
