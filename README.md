# ChatGPT Docker Puppeteer

**Sistema Node.js 24 ESM para orquestrar missões de longa duração com LLMs via automação de browser
(Puppeteer), com foco em confiabilidade operacional, observabilidade e evolução contínua.**

[![Node.js Version](https://img.shields.io/badge/Node.js-24+-green.svg)](https://nodejs.org/)
[![License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![PM2](https://img.shields.io/badge/PM2-6.0+-red.svg)](https://pm2.keymetrics.io/)

## 🚀 Visão Geral

Este sistema automatiza interações complexas com Large Language Models (LLMs) como ChatGPT, Gemini e
Claude através de automação de navegador usando Puppeteer. Projetado para missões de longa duração
com intervenção humana mínima através de um dashboard web.

### ✨ Características Principais

- **🧠 Orquestração Inteligente**: Sistema de tarefas com execução paralela e controle de
  concorrência
- **🌐 Dashboard Web**: Interface em tempo real para monitoramento e controle
- **🔄 Arquitetura Event-Driven**: Comunicação baseada em eventos NERV para alta performance
- **🛡️ Segurança Enterprise**: HTTPS obrigatório, circuit breakers, validações rigorosas
- **📊 Observabilidade**: Telemetria completa, health checks, métricas em tempo real
- **🐳 Container-Ready**: Docker e docker-compose para deploy simplificado
- **🔧 Manutenibilidade**: 100% JSDoc, testes automatizados, CI/CD

## 🏗️ Arquitetura

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Dashboard     │    │     Kernel      │    │     Driver      │
│   (Port 3008)   │◄──►│   (Orquestra)   │◄──►│   (Puppeteer)   │
│                 │    │                 │    │                 │
│ • Task Queue    │    │ • Policy Engine │    │ • Browser Pool  │
│ • Real-time UI  │    │ • Health Checks │    │ • Human Sim.    │
│ • Telemetry     │    │ • Circuit Brk.  │    │ • Error Rec.    │
└─────────────────┘    └─────────────────┘    └─────────────────┘
         │                       │                       │
         └───────────────────────┼───────────────────────┘
                                 │
                    ┌─────────────────┐
                    │      NERV       │
                    │  (Event Bus)    │
                    │                 │
                    │ • Local Events  │
                    │ • Socket.io     │
                    │ • Circuit Brk.  │
                    │ • Correlation   │
                    └─────────────────┘
```

## 📋 Pré-requisitos

- **Node.js 24+** (ESM obrigatório)
- **Chrome/Chromium** (para automação)
- **PM2** (para produção)
- **Docker** (opcional, para containerização)

## 🚀 Instalação Rápida

### Desenvolvimento

```bash
# Clone o repositório
git clone https://github.com/Ilenburg1993/chatgpt-docker-puppeteer.git
cd chatgpt-docker-puppeteer

# Instale dependências
npm install

# Configure variáveis de ambiente
cp .env.example .env.local
# Edite .env.local com suas chaves API

# Inicie em modo desenvolvimento
npm run dev
```

### Produção (PM2)

```bash
# Configure produção
cp .env.production .env
# Edite .env com configurações de produção

# Inicie com PM2
npm run daemon:start

# Verifique status
npm run daemon:status
```

### Pipeline Canônico RAG/MCP

```bash
# Sobe PM2 + valida MCP + reconstrói RAG do zero (profile full)
npm run rag:rebuild:zero

# Watch incremental contínuo (debounce + batch)
npm run rag:watch

# Expandir um resultado específico por chunk_id
npm run rag:expand -- --chunk-id <chunk_id> --mode symbol
```

### Docker

```bash
# Build e execute
make build
make up

# Verifique logs
make logs
```

## 🏗️ Build e Distribuição

### Build de Desenvolvimento

```bash
# Build completo com dependências de desenvolvimento
npm run build

# Resultado: diretório `dist/` (~850MB) pronto para execução
```

### Build de Produção

```bash
# Build otimizado para produção (NODE_ENV=production)
npm run build:prod

# Resultado: diretório `dist/` com bundle minificado
```

### Executando o Build

```bash
# Desenvolvimento
cd dist && node index.js

# Produção (recomendado)
cd dist && node start.js

# Com PM2
cd dist && npx pm2 start ecosystem.config.cjs
```

### Build Executável (Standalone)

```bash
# Criar executáveis nativos para Linux e Windows
npm run build:exe

# Resultado: diretório `release/` com binários executáveis
# - release/chatgpt-docker-puppeteer-linux
# - release/chatgpt-docker-puppeteer-win.exe
```

> **Nota**: O build executável usa Node.js 18 (via pkg) devido a limitações de compatibilidade com
> recursos modernos do Node.js 24+ (como top-level await). Os executáveis são totalmente funcionais
> mas usam uma versão ligeiramente mais antiga do runtime.

### Estratégia de Build

- **Copy-first**: Copia todos os arquivos fonte para `dist/`
- **Bundle inteligente**: Usa ESBuild para otimizar módulos compatíveis
- **External dependencies**: Mantém dependências nativas externas (@pm2/blessed, term.js, pty.js,
  @lancedb/lancedb-\*)
- **Node.js 24+**: Requer Node.js 24 ou superior
- **ESM obrigatório**: Mantém compatibilidade com módulos ES
- **✅ Validado**: Build de produção testado e funcional
- **⚠️ Executável**: Usa Node.js 18 (limitações do pkg com recursos modernos)

### Distribuição Recomendada

1. **Docker** (recomendado para produção)
2. **Bundle otimizado** (`npm run build:prod`) - ✅ Totalmente funcional
3. **Executável standalone** (`npm run build:exe`) - ⚠️ Funcional mas limitado

## ⚙️ Configuração

### Variáveis de Ambiente

| Variável                              | Descrição                                       | Padrão          |
| ------------------------------------- | ----------------------------------------------- | --------------- | ------- | ---- |
| `NODE_ENV`                            | Ambiente (development/production)               | development     |
| `SERVER_MODE`                         | Modo do servidor (integrated/split/disabled)    | integrated      |
| `SERVER_AUTHORITY`                    | Autoridade do servidor (standalone/delegated)   | standalone      |
| `FORCE_HTTPS`                         | Forçar HTTPS em produção                        | true (produção) |
| `MAX_CONCURRENT_TASKS`                | Máximo de tarefas simultâneas                   | 1               |
| `OLLAMA_CLOUD_API_KEY`                | Chave API Ollama Cloud                          | -               |
| `OLLAMA_NON_EMBEDDING_RUNTIME`        | Roteamento de geração/chat (`auto               | cloud           | local`) | auto |
| `OLLAMA_NON_EMBEDDING_LOCAL_FALLBACK` | Fallback local quando cloud falhar (`true       | false`)         | true    |
| `OLLAMA_LOCAL_MODEL_PROFILE`          | Perfil de segurança para modelos locais (`light | custom`)        | light   |
| `OLLAMA_LOCAL_ALLOWED_MODELS`         | Allowlist opcional de modelos locais (CSV)      | -               |
| `RAG_PROFILE_DEFAULT`                 | Perfil de escopo RAG (`core                     | dev             | full`)  | core |
| `RAG_DEGRADED_MODE_ENABLED`           | Fallback lexical no RAG (`true                  | false`)         | true    |
| `RAG_AST_CHUNK_ENABLED`               | Ativa chunking AST-aware em JS/TS (`true        | false`)         | true    |
| `RAG_CHUNK_TARGET_CHARS`              | Alvo de tamanho de chunk (chars)                | 2400            |
| `RAG_CHUNK_MAX_CHARS`                 | Limite máximo de chunk (chars)                  | 4200            |
| `RAG_EXPAND_DEFAULT_LINES`            | Linhas padrão para `rag_expand`                 | 40              |
| `RAG_EXPAND_MAX_LINES`                | Limite máximo de linhas para `rag_expand`       | 240             |
| `RAG_WATCH_ENABLED`                   | Liga/desliga watch incremental (`true           | false`)         | true    |
| `RAG_WATCH_DEBOUNCE_MS`               | Debounce do watch incremental (ms)              | 3000            |
| `RAG_WATCH_BATCH_MAX`                 | Máximo de arquivos por lote incremental         | 64              |
| `LSP_ENABLED`                         | Habilita ferramentas MCP de LSP/tsserver        | true            |
| `LSP_TOOL_TIMEOUT_MS`                 | Timeout por operação LSP (ms)                   | 15000           |
| `LSP_MUTATIONS_ENABLED`               | Permite apply de code action (`true             | false`)         | false   |
| `LSP_MAX_RESULTS`                     | Limite de resultados por ferramenta LSP         | 200             |
| `GITHUB_PERSONAL_ACCESS_TOKEN`        | Token GitHub                                    | -               |

### Arquivos de Configuração

- `config.json` - Configurações globais
- `ecosystem.config.cjs` - Configuração PM2
- `chrome-config.json` - Configurações do Chrome

## 🎯 Uso

### Criar uma Missão

1. **Acesse o Dashboard**: `https://localhost:3008`
2. **Clique em "Nova Missão"**
3. **Configure os parâmetros**:
   - Tipo de LLM (ChatGPT, Gemini, Claude)
   - Prompt inicial
   - Parâmetros de execução
4. **Inicie a missão**

### Monitoramento

- **Dashboard em Tempo Real**: Status de tarefas, métricas, logs
- **PM2 Monitor**: `npm run daemon:monit`
- **Health Checks**: `npm run health:full`
- **Diagnóstico MCP**: `npm run mcp:diagnose`

### Gerenciamento de Tarefas

```bash
# Ver fila de tarefas
npm run queue:status

# Adicionar tarefa interativamente
npm run queue:add

# Limpar fila
npm run queue:clear
```

## 🔧 Desenvolvimento

### Estrutura do Projeto

```
src/
├── core/          # Configurações, constantes, identidade
├── nerv/          # Sistema de comunicação event-driven
├── kernel/        # Engine de execução e orquestração
├── driver/        # Automação de browsers (Puppeteer)
├── infra/         # Pool de browsers, filas, storage
├── server/        # API Express + Socket.io dashboard
├── logic/         # Regras de negócio e validações
└── state/         # Gerenciamento de estado

tests/             # Testes unitários e integração
scripts/           # Automação de desenvolvimento
DOCUMENTAÇÃO/      # Documentação técnica completa
```

### Comandos de Desenvolvimento

```bash
# Testes
npm test                    # Todos os testes
npm run test:unit          # Apenas unitários
npm run test:integration   # Integração

# Qualidade de Código
npm run lint               # Verificar linting
npm run lint:fix           # Corrigir automaticamente
npm run format             # Formatar código

# Análise
npm run analyze:deps       # Dependências circulares
npm run analyze:jsdoc      # Cobertura JSDoc
```

### Adicionando Novos Drivers

1. **Crie o driver** em `src/driver/`
2. **Implemente a interface**:
   ```javascript
   class NewDriver {
     async connect() {
       /* ... */
     }
     async execute(task) {
       /* ... */
     }
     async disconnect() {
       /* ... */
     }
   }
   ```
3. **Registre no factory** `src/driver/factory.js`

## 🔒 Segurança

- **HTTPS Obrigatório** em produção com HSTS
- **Circuit Breakers** para resiliência
- **Rate Limiting** e validações de entrada
- **Secrets Management** via variáveis de ambiente
- **Auditoria de Logs** com correlação

## 📊 Monitoramento

### Métricas em Tempo Real

- **Throughput**: Tarefas/minuto
- **Latência**: Tempo de resposta médio
- **Disponibilidade**: Uptime dos serviços
- **Erros**: Taxa de falha por componente

### Health Checks

```bash
# Verificação rápida
npm run health:quick

# Verificação completa
npm run health:full
```

### Logs

```bash
# Seguir logs em tempo real
npm run logs:follow

# Logs filtrados
npm run logs:watch
```

## 🐛 Troubleshooting

### Problemas Comuns

**Chrome não conecta:**

```bash
# Verifique se Chrome está rodando
curl http://localhost:9224/json/version

# Inicie Chrome manualmente
npm run start:chrome
```

**PM2 não inicia:**

```bash
# Verifique configuração
npm run validate

# Limpe e reinicie
npm run clean
npm run daemon:start
```

**Testes falhando:**

```bash
# Execute testes individuais
node --test tests/unit/core/test_config.spec.js

# Verifique dependências
npm run check
```

## 🤝 Contribuição

1. **Fork** o projeto
2. **Crie uma branch** `feature/nova-funcionalidade`
3. **Commit** suas mudanças `git commit -m 'feat: adiciona nova funcionalidade'`
4. **Push** para a branch `git push origin feature/nova-funcionalidade`
5. **Abra um Pull Request**

### Padrões de Código

- **ESLint + Prettier** obrigatórios
- **JSDoc 100%** cobertura
- **Testes** para novas funcionalidades
- **Conventional Commits**

## 📚 Documentação

- **[Arquitetura Completa](DOCUMENTAÇÃO/ARCHITECTURE.md)**
- **[Guia de Configuração](DOCUMENTAÇÃO/CONFIGURATION.md)**
- **[API Reference](DOCUMENTAÇÃO/API.md)**
- **[Guia de Deploy](DOCUMENTAÇÃO/DEPLOYMENT.md)**

## 📄 Licença

MIT - veja [LICENSE](LICENSE) para detalhes.

## 🙏 Agradecimentos

- **Puppeteer** - Automação de browser
- **PM2** - Gerenciamento de processos
- **Socket.io** - Comunicação em tempo real
- **Express.js** - Framework web

---

**Desenvolvido com ❤️ para automação inteligente de LLMs**</content>
<parameter name="filePath">/workspaces/chatgpt-docker-puppeteer/README.md
