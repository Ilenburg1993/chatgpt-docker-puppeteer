# ChatGPT Docker Puppeteer

**Sistema Node.js 24 ESM para orquestrar missões de longa duração com LLMs via automação de browser
(Puppeteer), com foco em confiabilidade operacional, observabilidade e evolução contínua.**

[![Node.js Version](https://img.shields.io/badge/Node.js-24+-green.svg)](https://nodejs.org/)
[![License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![PM2](https://img.shields.io/badge/PM2-6.0+-red.svg)](https://pm2.keymetrics.io/)

## 📚 Documentação Canônica

A documentação central do projeto agora está organizada em
[`DOCUMENTAÇÃO/README.md`](DOCUMENTAÇÃO/README.md).

- Guias e onboarding: [`DOCUMENTAÇÃO/GUIAS/`](DOCUMENTAÇÃO/GUIAS/)
- Arquitetura e diagramas: [`DOCUMENTAÇÃO/ARQUITETURA/`](DOCUMENTAÇÃO/ARQUITETURA/)
- Referências e APIs: [`DOCUMENTAÇÃO/REFERENCIA/`](DOCUMENTAÇÃO/REFERENCIA/)
- Operações e deploy: [`DOCUMENTAÇÃO/OPERACOES/`](DOCUMENTAÇÃO/OPERACOES/)
- Planos ativos: [`DOCUMENTAÇÃO/PLANOS/`](DOCUMENTAÇÃO/PLANOS/)
- Relatórios e histórico: [`DOCUMENTAÇÃO/RELATORIOS/`](DOCUMENTAÇÃO/RELATORIOS/) e
  [`DOCUMENTAÇÃO/ARQUIVO_MORTO/`](DOCUMENTAÇÃO/ARQUIVO_MORTO/)

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

````bash
# Clone o repositório
git clone https://github.com/Ilenburg1993/chatgpt-docker-puppeteer.git
cd chatgpt-docker-puppeteer
## Python helpers & local agents

In addition to the Node.js core there are two lightweight Python "agents" used
for demonstrations (`agents/code_explainer` and `agents/cooking_ai`).  A
shared HTTP wrapper (`agents/server.py`) exposes a minimal REST API so that the
AI Toolkit Agent Inspector can attach via **agentdev**.

To prepare the environment:

```bash
# create a local venv (recommended in this DevContainer)
python3 -m venv .venv && source .venv/bin/activate
pip install -r agents/code_explainer/requirements.txt \
            -r agents/cooking_ai/requirements.txt
````

> **Nota:** neste DevContainer o suporte a `venv` faz parte da imagem. A pasta `.venv/` é um
> artefato local, fica ignorada pelo Git e não deve ser tratada como parte do código do projeto.
>
> Em ambientes externos, a criação de venv ainda pode falhar devido à falta de `python3-venv` ou
> políticas de "externally-managed environment".
>
> Se isso ocorrer, escolha um dos seguintes caminhos:
>
> 1. Instale `python3-venv` no seu sistema e repita o passo anterior.
> 2. Use `pipx` ou `pip install --user` para colocar as dependências em seu diretório de usuário:
>    ```bash
>    python3 -m pip install --user -r agents/code_explainer/requirements.txt \
>                -r agents/cooking_ai/requirements.txt
>    ```
> 3. Ou simplesmente execute os comandos dentro de um ambiente controlado (venv/conda) fora deste
>    contêiner.
>
> Após isso, você terá `pytest`, `debugpy` e `agent-dev-cli` disponíveis para executar os testes e
> iniciar o servidor HTTP para depuração.

You can still run each agent interactively:

```bash
python agents/code_explainer/cli.py
python agents/cooking_ai/cli.py
```

or start the HTTP server (8087 by default):

```bash
python agents/server.py --server
```

### Debugging with Agent Inspector

The workspace contains VS Code tasks and launch configurations that wire up `debugpy` and
`agentdev`. Use **Run Python Agent HTTP Server** from the task list and then launch the **Debug
Python Agent HTTP Server** configuration to attach the debugger and automatically open the inspector
on port 8087.

See `.vscode/tasks.json` and `.vscode/launch.json` for the full commands.

# Instale dependências

npm install

# Configure variáveis de ambiente

cp .env.local.example .env.local

# Edite .env.local com suas chaves API e overrides locais

# Inicie em modo desenvolvimento

npm run dev

````

### Produção (PM2)

```bash
# Configure produção
cp .env.production .env
# Edite .env com configurações de produção

# Inicie com PM2
npm run daemon:start

# Verifique status
npm run daemon:status
````

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

## 🔧 Depuração

O workspace já inclui um arquivo `./.vscode/launch.json` moderno com perfis para o agente, o
dashboard, testes e attaches (PM2/Docker/Vite).

#### Usando o VS Code

1. Abra a paleta de comandos (Ctrl+Shift+P) e selecione **Run and Debug**.
2. Escolha um dos lançadores como **Node: Agente (dev)** ou o compound _Full system_.
3. Para perfis de subsistema (NERV, Kernel, etc.) basta copiar o perfil do agente e alterar a
   variável de ambiente `DEBUG` para o filtro desejado.

> ⚠️ Requer **VS Code 1.80+** para suporte aos tipos `pwa-node`/`pwa-chrome`.

#### Iniciando PM2 com inspeção

O `ecosystem.config.cjs` foi atualizado para aceitar a variável de ambiente `DEBUG_PORT`. por
exemplo:

```bash
# iniciar o agente com inspector na porta 9229
DEBUG_PORT=9229 npm run daemon:start

# ou usar o script auxiliar
scripts/ops/start-pm2-debug.sh
```

O campo `DEBUG_PORT` aceita uma lista separada por vírgulas se você precisar ligar múltiplos
processos.

#### Outros utilitários

- `npm run dev` já executa `nodemon` com `--inspect=0.0.0.0:9229`.
- Há scripts de profiling em `package.json` (`debug:memory-leak`, `debug:performance`, etc.).

**Snippet útil** – copie e ajuste para criar novos perfis rapidamente:

```json
{
  "name": "Node: NERV Subsystem",
  "type": "pwa-node",
  "request": "launch",
  "program": "${workspaceFolder}/index.js",
  "env": {
    "NODE_ENV": "development",
    "DEBUG": "nerv:*,nerv:emit:*"
  },
  "runtimeArgs": ["--max-old-space-size=2048"],
  "skipFiles": ["<node_internals>/**", "node_modules/**"],
  "autoAttachChildProcesses": true
}
```

Estas instruções garantem que a nova configuração de debug esteja documentada e funcionando para
qualquer desenvolvedor.

## 🧩 Usando o daemon LSP integrado

Para scripts ou editores que queiram interagir com o servidor TypeScript interno, a biblioteca
exporta `TsserverDaemon` em `src/integration/lsp/tsserver-daemon.mjs`. Exemplo mínimo:

```js
import { TsserverDaemon } from './src/integration/lsp/tsserver-daemon.mjs';

async function demo() {
  const daemon = new TsserverDaemon({ rootDir: process.cwd() });
  await daemon.start();
  const defs = await daemon.execute('definition', {
    filePath: 'src/index.js',
    line: 10,
    character: 5,
  });
  console.log('definitions', defs);
  await daemon.stop();
}

demo();
```

Esse serviço pode ser ampliado com `completion`, `updateFile`, etc., e a integração com
`typescript-language-server` é documentada em `DOCUMENTAÇÃO/LSP_UPGRADE_AUDIT.md`.

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

- **[Arquitetura Completa](DOCUMENTAÇÃO/ARQUITETURA/ARCHITECTURE.md)**
- **[Guia de Configuração](DOCUMENTAÇÃO/REFERENCIA/CONFIGURATION.md)**
- **[API Reference](DOCUMENTAÇÃO/REFERENCIA/API_REFERENCE.md)**
- **[Guia de Deploy](DOCUMENTAÇÃO/OPERACOES/DEPLOYMENT.md)**

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
