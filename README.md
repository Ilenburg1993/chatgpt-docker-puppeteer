# chatgpt-docker-puppeteer

[![Tests](<https://img.shields.io/badge/tests-38%2F38%20(em%20consolida%C3%A7%C3%A3o)-yellow>)](tests/)
![Node.js Version](https://img.shields.io/badge/node-%E2%89%A520.0.0-brightgreen)
![License](https://img.shields.io/badge/license-MIT-blue)
![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)
![Status](https://img.shields.io/badge/status-pre--v1.0-orange)
![Stability](https://img.shields.io/badge/stability-unstable-red)

**Sistema de agente autônomo para controle de Large Language Models (ChatGPT, Gemini) via automação de browser usando Puppeteer e Chrome remote debugging.**

> ⚠️ **Status de Desenvolvimento**: Este projeto está em **desenvolvimento ativo** e **NÃO atingiu v1.0 stable**. A fase de testes e consolidação está em andamento. Features, APIs e comportamentos podem mudar sem aviso prévio. **NÃO use em produção**.

---

## 🚀 Quick Start

```bash
# 1. Clone o repositório
git clone https://github.com/Ilenburg1993/chatgpt-docker-puppeteer.git
cd chatgpt-docker-puppeteer

# 2. Instale dependências
npm install

# 3. Inicie o Chrome com remote debugging
# Windows:
"C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222 --user-data-dir="C:\chrome-automation"

# Linux/macOS:
google-chrome --remote-debugging-port=9222 --user-data-dir="~/chrome-automation"

# 4. Execute o agente
npm run dev

# 5. Acesse o dashboard
# Abra http://localhost:3008
```

**Guia completo**: [DOCUMENTAÇÃO/QUICK_START.md](DOCUMENTAÇÃO/QUICK_START.md)

---

## 📋 O Que é Este Projeto?

Sistema de **agente autônomo** que:

- Controla chatbots LLM (ChatGPT, Gemini) através de automação de browser
- Processa tarefas de uma fila baseada em arquivos JSON (`fila/`)
- Salva respostas de IA em `respostas/`
- Fornece monitoramento em tempo real via dashboard web
- Usa Chrome remote debugging (sem Chromium embarcado)

### Arquitetura NERV (IPC 2.0)

```
                  NERV (Pub/Sub - Canal Universal)
                            ↕
              ┌─────────────┼─────────────┐
              │             │             │
           KERNEL        DRIVER        SERVER
              │             │             │
         TaskQueue    BrowserPool    Dashboard
              │             │             │
         (Fila JSON)  (Puppeteer)   (Socket.io)
                            ↓
                     Chrome :9222 (Host)
                            ↓
                    ChatGPT / Gemini
```

**Princípios:**

- **Zero-coupling**: Comunicação apenas via NERV (pub/sub)
- **Sovereign interruption**: AbortController para interrupção autônoma
- **Schema validation**: Zod para validação de dados
- **Adaptive backoff**: Retry inteligente com backoff exponencial
- **Typed constants**: Centralized constants (`src/core/constants/`) eliminam magic strings

**Componentes Core:**

- **`src/core/constants/`**: Typed constants (STATUS_VALUES, CONNECTION_MODES, LOG_CATEGORIES)
- **`src/nerv/`**: Event bus com pub/sub, buffers, correlation, telemetry
- **`src/kernel/`**: Task execution engine com policy engine e runtime
- **`src/driver/`**: Target-specific automation (ChatGPT, Gemini drivers)
- **`src/infra/`**: Browser pool, locks, queue, storage (tasks/responses/DNA)
- **`src/server/`**: Dashboard API (Express + Socket.io)

---

## 📚 Documentação

- **[Guia de Arquitetura](DOCUMENTAÇÃO/ARCHITECTURE.md)** - Arquitetura completa do sistema
- **[Referência de API](DOCUMENTAÇÃO/API.md)** - APIs públicas dos módulos
- **[Guia de Configuração](DOCUMENTAÇÃO/CONFIGURATION.md)** - Todos os parâmetros explicados
- **[Guia de Testes](DOCUMENTAÇÃO/TESTING.md)** - Framework de testes e como criar novos
- **[Guia de Deploy](DOCUMENTAÇÃO/DEPLOYMENT.md)** - Deploy para produção (Docker/PM2)
- **[Como Contribuir](CONTRIBUTING.md)** - Workflow de desenvolvimento
- **[FAQ](DOCUMENTAÇÃO/FAQ.md)** - Problemas comuns e troubleshooting

---

## ✨ Features Principais

### Core

- ✅ **Automação de Browser**: Controle via Puppeteer
- ✅ **Chrome Remote Debugging**: Conexão com Chrome existente
- ✅ **Sistema de Fila**: Queue baseada em arquivos JSON com lock PID
- ✅ **Dashboard Real-time**: Monitoramento via Socket.io
- ✅ **Coleta Incremental**: Streaming de respostas conforme são geradas
- ✅ **Validação de Qualidade**: Regras configuráveis de validação

### Arquitetura

- ✅ **NERV (IPC 2.0)**: Canal universal de comunicação pub/sub
- ✅ **Zero-coupling**: Desacoplamento completo entre módulos
- ✅ **Retry Adaptativo**: Backoff exponencial com classificação de falhas
- ✅ **Hot-reload**: Atualização de config sem restart
- ✅ **Process Management**: PM2 para produção
- ✅ **Schema Validation**: Zod para contratos de dados

### Operacional

- ✅ **Docker Ready**: Imagens multi-stage (~150MB)
- ✅ **Health Checks**: Endpoints de saúde do sistema
- ✅ **Telemetria**: Logs estruturados e métricas
- ✅ **Forensics**: Dumps automáticos em crashes

> ⚠️ **Nota**: Features marcadas como ✅ indicam implementação atual, mas ainda em fase de consolidação de testes.

---

## 🛠 Stack Tecnológica

- **Node.js**: ≥20.0.0 (runtime)
- **Puppeteer**: 21.11.0 (automação de browser)
- **Express**: 4.22.1 (servidor web)
- **Socket.io**: 4.8.3 (comunicação real-time)
- **PM2**: 5.4.3 (gerenciamento de processos)
- **Zod**: 3.25.76 (validação de schemas)
- **Docker**: Multi-stage builds

---

## 📦 Estrutura do Projeto

```
chatgpt-docker-puppeteer/
├── src/
│   ├── core/              # Motor de execução e schemas
│   ├── driver/            # Drivers de automação específicos por LLM
│   ├── infra/             # Queue, locks, storage
│   ├── kernel/            # Gerenciamento de ciclo de vida de tasks
│   ├── nerv/              # Sistema de comunicação IPC 2.0
│   └── server/            # Dashboard web
├── scripts/               # Scripts utilitários
├── tests/                 # Suites de testes
├── fila/                  # Fila de tarefas (arquivos JSON)
├── respostas/             # Respostas de IA
├── logs/                  # Logs da aplicação
├── DOCUMENTAÇÃO/          # Documentação completa
└── public/                # Arquivos estáticos do dashboard
```

---

## 🧪 Testes

**Status Atual:** 38/38 testes passando (em consolidação)

```bash
# Executar todos os testes
npm test

# Testes unitários (P1-P5 - Correções críticas)
npm run test:p1

# Testes E2E (Fio de Ariadne - Conectividade)
npm run test:e2e

# Testes de integração (Driver-NERV)
npm run test:integration
```

> ⚠️ **Importante**: Os testes atuais validam a arquitetura e funcionalidades críticas, mas a **fase de consolidação de testes ainda não terminou**. Novos testes estão sendo criados para cobrir cenários de produção, performance e edge cases.

**Documentação completa**: [DOCUMENTAÇÃO/TESTING.md](DOCUMENTAÇÃO/TESTING.md)

---

## 🚢 Deploy

### Docker (Recomendado para desenvolvimento)

```bash
# Build e start
docker-compose up -d

# Verificar saúde
curl http://localhost:3008/api/health

# Ver logs
docker-compose logs -f
```

### PM2 (Para produção)

```bash
# Instalar PM2 globalmente
npm install -g pm2

# Iniciar agente
npm run daemon:start

# Monitorar
pm2 status
pm2 logs agente-gpt
```

**Guia completo**: [DOCUMENTAÇÃO/DEPLOYMENT.md](DOCUMENTAÇÃO/DEPLOYMENT.md)

---

## 🔧 Configuração

### Principais Arquivos

| Arquivo              | Propósito                         | Hot-reload        |
| -------------------- | --------------------------------- | ----------------- |
| `config.json`        | Configuração principal do sistema | ✅ Sim            |
| `dynamic_rules.json` | Seletores CSS e regras por target | ✅ Sim            |
| `.env`               | Variáveis de ambiente             | ❌ Requer restart |

### Exemplo de Task

```json
{
    "id": "task-001",
    "target": "chatgpt",
    "prompt": "Explique computação quântica de forma simples",
    "state": "PENDING"
}
```

**Guia completo**: [DOCUMENTAÇÃO/CONFIGURATION.md](DOCUMENTAÇÃO/CONFIGURATION.md)

---

## 📊 Uso

### Criar uma Task

```bash
# Via CLI
npm run queue:add

# Via script
node scripts/gerador_tarefa.js
```

### Monitorar Execução

- **Dashboard**: http://localhost:3008
- **Logs**: `tail -f logs/agent.log`
- **Health**: http://localhost:3008/api/health

### Obter Resultados

Respostas salvas em `respostas/{taskId}.txt`

---

## 🤝 Contribuindo

Contribuições são bem-vindas! Consulte [CONTRIBUTING.md](CONTRIBUTING.md) para:

- Setup de desenvolvimento
- Padrões de código
- Formato de commits
- Processo de pull request

---

## 📝 Licença

MIT License - veja [LICENSE](LICENSE) para detalhes.

---

## 🔗 Links

- **Repositório**: https://github.com/Ilenburg1993/chatgpt-docker-puppeteer
- **Issues**: https://github.com/Ilenburg1993/chatgpt-docker-puppeteer/issues
- **Changelog**: [CHANGELOG.md](CHANGELOG.md)

---

## ⚠️ Disclaimer

Esta ferramenta é para fins educacionais e de automação. Certifique-se de estar em conformidade com os Termos de Serviço das plataformas com as quais você interage. Use com responsabilidade.

**Lembrete**: Este projeto está em **desenvolvimento ativo** e **não é stable**. Use por sua conta e risco.
