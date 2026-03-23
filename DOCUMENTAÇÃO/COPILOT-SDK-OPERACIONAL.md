# Guia Operacional — Copilot SDK

**Status**: ✅ Implementado (Sprint 25) **Última atualização**: 2026-07-27 **Módulo**:
`src/copilot/` **API base**: `http://localhost:3008/api/sdk`

---

## O que é e como funciona

O `@github/copilot-sdk` é uma **biblioteca Node.js que controla o GitHub Copilot CLI** via JSON-RPC.
Ele NÃO é uma chamada direta à API da OpenAI/Anthropic — ele delega para o processo `gh copilot`
local, que por sua vez se comunica com o LLM (GPT-5, Claude Sonnet, Ollama, etc.).

```
Sua aplicação (Express)
       │
       ▼
sdk-client.js (singleton CopilotClient)
       │
       ▼
@github/copilot-sdk (JSON-RPC)
       │
       ▼
GitHub Copilot CLI (processo local, spawned automaticamente)
       │
       ▼
LLM (GitHub-hosted: GPT-5, Claude Sonnet; ou BYOK: Ollama, Azure, etc.)
```

**Sim, é através do GitHub CLI (gh).** O SDK faz o `gh` (ou o binário `copilot`) funcionar como um
servidor local. Autenticação = a mesma conta do `gh auth login`.

---

## Pré-requisitos para uso real

### 1. GitHub CLI autenticado

```bash
# Verificar se está autenticado
gh auth status

# Se não estiver:
gh auth login
```

A conta precisa ter **acesso ao GitHub Copilot** (Individual, Business ou Enterprise).

### 2. Extensão Copilot ativa

O SDK usa o CLI `gh copilot`. Verifique:

```bash
gh copilot --version
# Se não tiver: gh extension install github/gh-copilot
```

> **Observação importante**: o SDK v0.1.32 (instalado) spawna o processo CLI automaticamente via
> `CopilotClient.start()`. Você NÃO precisa rodar o CLI manualmente — apenas autenticar.

### 3. Servidor Express rodando

```bash
# Desenvolvimento
npm start

# Produção (PM2)
npm run daemon:start
```

A variável `COPILOT_SDK_ENABLED` controla se as rotas são montadas (padrão: `true`).

```bash
# Para desativar:
COPILOT_SDK_ENABLED=false npm start
```

### 4. Modelo disponível

Para Claude Sonnet, o nome do modelo na API é:

```
claude-sonnet-4-5
```

Para listar todos os modelos disponíveis na sua conta:

```bash
curl -s http://localhost:3008/api/sdk/models | jq '.models[].id'
```

---

## Fluxo completo — da inicialização ao uso com Sonnet

### Passo 1: Verificar conectividade

```bash
# Healthcheck do SDK
curl -s http://localhost:3008/api/sdk/ping
# => {"ok":true,"latencyMs":43,"message":"pong"}

# Estado da conexão
curl -s http://localhost:3008/api/sdk/status
# => {"ok":true,"state":"connected","version":"..."}

# Autenticação
curl -s http://localhost:3008/api/sdk/auth
# => {"ok":true,"user":"seulogin","status":"ok"}
```

### Passo 2: Criar sessão com Sonnet

```bash
curl -s -X POST http://localhost:3008/api/sdk/sessions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude-sonnet-4-5",
    "sessionId": "minha-sessao-sonnet",
    "systemMessage": "Você é um assistente de engenharia de software especializado em Node.js.",
    "workingDirectory": "/workspaces/chatgpt-docker-puppeteer"
  }'
# => {"ok":true,"sessionId":"minha-sessao-sonnet","model":"claude-sonnet-4-5","createdAt":...}
```

### Passo 3: Enviar mensagem e aguardar resposta

```bash
# Síncrono (waitForResponse=true, timeout 60s por padrão)
curl -s -X POST http://localhost:3008/api/sdk/sessions/minha-sessao-sonnet/send \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "Quais são as rotas registradas no router.js?",
    "waitForResponse": true,
    "timeoutMs": 30000
  }'
# => {"ok":true,"messageId":"...","response":"As rotas registradas são...","model":"claude-sonnet-4-5"}
```

### Passo 4: Streaming (SSE)

```javascript
// No browser ou com EventSource
const es = new EventSource('http://localhost:3008/api/sdk/sessions/minha-sessao-sonnet/stream');

es.addEventListener('message', (e) => {
  const event = JSON.parse(e.data);
  if (event.type === 'assistant.message') {
    console.log(event.data.content); // resposta completa
  }
  if (event.type === 'assistant.message_delta') {
    process.stdout.write(event.data.deltaContent); // streaming incremental
  }
});

es.addEventListener('heartbeat', (e) => {
  console.log('keepalive', JSON.parse(e.data).ts);
});

es.addEventListener('connected', (e) => {
  console.log('SSE conectado', JSON.parse(e.data));
});
```

### Passo 5: Retomar ou encerrar sessão

```bash
# Listar sessões ativas (em memória)
curl -s http://localhost:3008/api/sdk/sessions/active

# Desconectar (preserva dados em disco para retomada futura)
curl -s -X POST http://localhost:3008/api/sdk/sessions/minha-sessao-sonnet/disconnect

# Retomar sessão que foi desconectada
curl -s -X POST http://localhost:3008/api/sdk/sessions/minha-sessao-sonnet/resume \
  -H "Content-Type: application/json" \
  -d '{"model": "claude-sonnet-4-5"}'

# Listar todas as sessões (disco + memória)
curl -s http://localhost:3008/api/sdk/sessions

# Deletar permanentemente
curl -s -X DELETE http://localhost:3008/api/sdk/sessions/minha-sessao-sonnet
```

---

## Referência completa das rotas

### Controle do cliente (`/api/sdk/client/*`)

| Rota                 | Descrição                                           |
| -------------------- | --------------------------------------------------- |
| `POST /client/start` | Inicia o CopilotClient singleton explicitamente     |
| `POST /client/stop`  | Para o cliente e limpa todas as sessões do registry |

### Diagnóstico (`/api/sdk/*`)

| Rota          | Descrição                                                      |
| ------------- | -------------------------------------------------------------- |
| `GET /ping`   | Latência do CLI + healthcheck                                  |
| `GET /status` | ConnectionState (`connected\|disconnected\|connecting\|error`) |
| `GET /auth`   | Status de autenticação GitHub                                  |
| `GET /models` | Modelos disponíveis (id, name, capabilities)                   |
| `GET /tools`  | Ferramentas registradas em `src/copilot/tools/`                |

### Sessões (`/api/sdk/sessions/*`)

| Rota                            | Body / Params                                              | Descrição                                   |
| ------------------------------- | ---------------------------------------------------------- | ------------------------------------------- |
| `GET /sessions/active`          | —                                                          | Sessões ativas no registry em memória       |
| `GET /sessions`                 | —                                                          | Todas as sessões (disco via `listSessions`) |
| `POST /sessions`                | `{ model, sessionId?, systemMessage?, workingDirectory? }` | Cria nova sessão                            |
| `GET /sessions/:id`             | —                                                          | Detalhes: metadata + status registry        |
| `DELETE /sessions/:id`          | —                                                          | Deleta permanentemente do disco             |
| `POST /sessions/:id/resume`     | `{ model? }`                                               | Retoma sessão desconectada                  |
| `POST /sessions/:id/disconnect` | —                                                          | Desconecta (dados preservados em disco)     |
| `POST /sessions/:id/send`       | `{ prompt, waitForResponse?, timeoutMs?, attachments? }`   | Envia mensagem                              |
| `GET /sessions/:id/stream`      | —                                                          | SSE — streaming de eventos                  |

#### Body de criação de sessão (`POST /sessions`)

```json
{
  "model": "claude-sonnet-4-5",
  "sessionId": "minha-sessao",
  "systemMessage": "Prompt de sistema opcional.",
  "workingDirectory": "/workspaces/chatgpt-docker-puppeteer",
  "infiniteSessions": true
}
```

**Campos opcionais**: `sessionId` (gerado automaticamente se ausente), `systemMessage`,
`workingDirectory`, `infiniteSessions` (padrão: `true` — compactação automática de contexto).

#### Body de envio de mensagem (`POST /sessions/:id/send`)

```json
{
  "prompt": "Analise o arquivo src/copilot/sdk-api.js e liste as rotas.",
  "waitForResponse": true,
  "timeoutMs": 60000,
  "attachments": [{ "type": "file", "path": "src/copilot/sdk-api.js", "displayName": "sdk-api.js" }]
}
```

---

## Custom Providers — BYOK (Bring Your Own Key)

### Ollama (custo zero)

```bash
curl -s -X POST http://localhost:3008/api/sdk/sessions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "qwen2.5-coder:7b",
    "provider": {
      "type": "openai",
      "baseUrl": "http://localhost:11434/v1"
    }
  }'
```

> Requer Ollama rodando localmente: `ollama serve` + `ollama pull qwen2.5-coder:7b`

### OpenAI (sua chave)

```bash
curl -s -X POST http://localhost:3008/api/sdk/sessions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4o",
    "provider": {
      "type": "openai",
      "baseUrl": "https://api.openai.com/v1",
      "apiKey": "sk-..."
    }
  }'
```

### Anthropic direto

```bash
curl -s -X POST http://localhost:3008/api/sdk/sessions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude-opus-4-5",
    "provider": {
      "type": "anthropic",
      "baseUrl": "https://api.anthropic.com",
      "apiKey": "sk-ant-..."
    }
  }'
```

---

## Ferramentas disponíveis

As ferramentas em `src/copilot/tools/` são injetadas automaticamente quando você cria uma sessão via
`createSdkSession()`. Cada ferramenta permite que o modelo LLM chame de volta o seu processo para
executar ações reais:

| Ferramenta         | Módulo             | O que faz                                          |
| ------------------ | ------------------ | -------------------------------------------------- |
| `get_tasks`        | `task-tools.js`    | Lista tarefas da fila (REST interno)               |
| `create_task`      | `task-tools.js`    | Cria nova tarefa na fila                           |
| `update_task`      | `task-tools.js`    | Atualiza status de uma tarefa                      |
| `analyze_code`     | `code-tools.js`    | Executa análise de um arquivo JS                   |
| `run_lint`         | `code-tools.js`    | Roda `npm run lint` e retorna resultado            |
| `git_status`       | `git-tools.js`     | Status do repositório git                          |
| `git_diff`         | `git-tools.js`     | Diff das mudanças atuais                           |
| `git_log`          | `git-tools.js`     | Log dos commits recentes                           |
| `get_session_info` | `session-tools.js` | Contexto da sessão atual (branch, workspace, etc.) |

Ver quais ferramentas estão registradas:

```bash
curl -s http://localhost:3008/api/sdk/tools | jq '.tools[].name'
```

---

## Always-Alive Agent (`/api/copilot/*`)

Além da API multi-sessão em `/api/sdk`, existe o **AlwaysAliveAgent** em `/api/copilot`:

```bash
# Iniciar o agente
curl -s -X POST http://localhost:3008/api/copilot/start

# Estado atual
curl -s http://localhost:3008/api/copilot/status

# Enviar mensagem
curl -s -X POST http://localhost:3008/api/copilot/send \
  -H "Content-Type: application/json" \
  -d '{"message": "Qual tarefa devo fazer agora?"}'

# Responder uma pergunta que o agente fez ao usuário (ask_user)
curl -s -X POST http://localhost:3008/api/copilot/answer \
  -H "Content-Type: application/json" \
  -d '{"answer": "Pode fazer o deploy."}'

# Parar o agente
curl -s -X POST http://localhost:3008/api/copilot/stop
```

O AlwaysAliveAgent fica em loop aguardando por `onUserInputRequest` (padrão "ask_user").

---

## O que ainda falta para uso "rigoroso e persistente"

### Gaps críticos (implantação bloqueada sem isso)

| Gap                                                         | Impacto                                 | Mitigação Atual                                                                             |
| ----------------------------------------------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------- |
| **Autenticação `gh auth` em produção**                      | CLI falha sem `gh auth login`           | Variável `GITHUB_TOKEN` funciona como alternativa (`CopilotClient({ githubToken: token })`) |
| **Reconexão automática após crash do CLI**                  | Sessão perde estado                     | `sdk-client.js` detecta estado `'error'` e rechama `client.start()`                         |
| **Persistência do `sessionId` entre reinícios do servidor** | Precisa recriar sessão sempre           | `session-manager.js` persiste em disco; falta integrar com `sdk-client.js` na startup       |
| **SSE streaming não ativa `streaming: true` na sessão**     | `assistant.message_delta` não é emitido | Sessão precisa ser criada com `streaming: true` para receber deltas                         |

### Gaps médios (usável, mas com limitações)

| Gap                                   | Descritivo                                                                                         |
| ------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Sessões só carregadas em memória      | Restart do servidor mata o registry (sessões em disco sobrevivem, mas precisam de `resume` manual) |
| Sem autenticação nas rotas `/api/sdk` | Qualquer processo na rede pode criar sessões que consomem billing                                  |
| `timeoutMs` máximo de 60s             | Tarefas longas de Sonnet são truncadas; sem callback de progresso                                  |
| Nenhuma métrica NERV                  | Sem observabilidade de sessões via event bus                                                       |

### Gaps baixos (melhoria de qualidade)

- Dashboard web para visualizar sessões ativas
- Testes de integração com CLI real (não mocado)
- Rate limiting específico por sessão SDK
- Hook `onPreToolUse` / `onPostToolUse` exposto via HTTP para auditoria

---

## Checklist de Início Rápido

```bash
# 1. Autenticação
gh auth status # deve mostrar login ativo

# 2. Servidor rodando
curl -s http://localhost:3008/health # deve responder {"ok":true}

# 3. SDK disponível
curl -s http://localhost:3008/api/sdk/ping # latência do CLI

# 4. Modelos disponíveis (inclui Sonnet?)
curl -s http://localhost:3008/api/sdk/models | jq '[.models[].id]'

# 5. Criar sessão Sonnet e testar
SESSION_ID="teste-sonnet-$(date +%s)"
curl -s -X POST http://localhost:3008/api/sdk/sessions \
  -H "Content-Type: application/json" \
  -d "{\"model\":\"claude-sonnet-4-5\",\"sessionId\":\"$SESSION_ID\"}"

curl -s -X POST http://localhost:3008/api/sdk/sessions/$SESSION_ID/send \
  -H "Content-Type: application/json" \
  -d '{"prompt":"Olá! Diga apenas: funciona.", "waitForResponse":true}'

# 6. Limpeza
curl -s -X POST http://localhost:3008/api/sdk/sessions/$SESSION_ID/disconnect
```

---

## Referências

- [SDK README](../node_modules/@github/copilot-sdk/README.md) — documentação oficial do
  `@github/copilot-sdk`
- [Arquitetura profunda](ARQUITETURA/SDK-COPILOT-ARQUITETURA-PROFUNDA.md) — análise completa (18
  seções)
- [sdk-client.js](../src/copilot/sdk-client.js) — singleton e registry
- [sdk-api.js](../src/copilot/sdk-api.js) — router Express (16 rotas)
- [always-alive.js](../src/copilot/always-alive.js) — AlwaysAliveAgent
- [tools/](../src/copilot/tools/) — ferramentas injetadas nas sessões
