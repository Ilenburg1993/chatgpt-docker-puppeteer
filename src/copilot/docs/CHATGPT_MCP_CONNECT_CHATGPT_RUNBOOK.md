# Runbook — Conectar ChatGPT ao Repo via MCP

**Data:** 2026-05-22  
**Escopo:** `src/copilot/`  
**Servidor local:** `src/copilot/mcp`  
**Endpoint MCP local HTTP:** `http://127.0.0.1:3333/mcp`  
**Endpoint público esperado no ChatGPT:** `https://<endpoint-do-tunel>/mcp`

---

## 1. Objetivo

Este documento descreve tudo que precisa ser feito para conectar `https://chatgpt.com/` ao workspace
`/workspaces/chatgpt-docker-puppeteer` por meio do MCP server em `src/copilot/mcp`.

O resultado esperado é:

```text
ChatGPT
  -> Connector Apps & Connectors
  -> HTTPS /mcp
  -> Secure MCP Tunnel ou tunnel HTTPS equivalente
  -> MCP local no Dev Container
  -> src/copilot/mcp
  -> repo real
```

---

## 2. Fontes oficiais aplicadas

1. `Connect from ChatGPT — Apps SDK`
   - O conector exige um MCP server alcançável por HTTPS.
   - O campo de URL deve apontar para o endpoint público `/mcp`.
   - Depois de criado, o conector deve listar as tools anunciadas.
   - Fonte: `https://developers.openai.com/apps-sdk/deploy/connect-chatgpt`

2. `Secure MCP Tunnel`
   - O tunnel-client roda dentro da rede que alcança o MCP privado.
   - O túnel usa saída HTTPS outbound para a OpenAI.
   - O ambiente precisa de `tunnel_id`, runtime API key e MCP server local.
   - Fonte: `https://developers.openai.com/api/docs/guides/secure-mcp-tunnels`

3. `Build your MCP server — Apps SDK`
   - Streamable HTTP é o caminho recomendado.
   - MCP Inspector deve ser usado para validar localmente.
   - Tools precisam de annotations.
   - Fonte: `https://developers.openai.com/apps-sdk/build/mcp-server`

4. `Security & Privacy — Apps SDK`
   - Validar inputs no servidor.
   - Manter audit logs.
   - Usar least privilege.
   - Exigir confirmação humana para efeitos destrutivos.
   - Fonte: `https://developers.openai.com/apps-sdk/guides/security-privacy`

---

## 3. Estado atual do repo

O projeto já possui:

1. MCP server local em `src/copilot/mcp`.
2. Transporte HTTP Streamable em `/mcp`.
3. Transporte `stdio` local.
4. Audit log MCP em `src/copilot/.ai/audit/mcp-tool-calls.jsonl`.
5. Job logs em `src/copilot/.ai/jobs/*.log`.
6. Endpoint auxiliar `GET /chatgpt-connector.json`.
7. Tools de leitura, Git, diagnóstico, jobs e conexão.

---

## 4. Comandos locais

### 4.1 Subir MCP por HTTP

```bash
npm run copilot:mcp:http
```

Endpoint:

```text
http://127.0.0.1:3333/mcp
```

Health:

```bash
curl http://127.0.0.1:3333/health
```

Perfil do conector:

```bash
curl http://127.0.0.1:3333/chatgpt-connector.json
```

### 4.2 Subir MCP por stdio

```bash
npm run copilot:mcp:stdio
```

Use `stdio` para VS Code, MCP Inspector local por comando, ou Secure MCP Tunnel em modo command.

---

## 5. Pre-requisitos Secure MCP Tunnel

Antes de conectar o ChatGPT:

1. ChatGPT developer mode habilitado.
2. Um `tunnel_id` criado em Platform tunnel settings.
3. Runtime API key para o `tunnel-client`.
4. A key precisa de permissões `Tunnels Read + Use`.
5. O host/container que roda `tunnel-client` precisa alcançar o MCP local.
6. O host/container precisa de saída HTTPS para `api.openai.com:443`.
7. O MCP local deve estar saudável.

---

## 6. Onde rodar o tunnel-client

### Opção A — Dentro do Dev Container

Preferida quando o binário `tunnel-client` estiver disponível dentro do container.

Vantagens:

1. Caminhos iguais ao ambiente do repo.
2. `127.0.0.1:3333/mcp` aponta para o MCP server do próprio container.
3. Menos ambiguidade de rede WSL2/Docker.

### Opção B — WSL2 host

Possível se o WSL2 host conseguir alcançar a porta publicada do container.

Use quando:

1. O tunnel-client estiver instalado no WSL2 host.
2. O MCP server HTTP estiver exposto de modo alcançável a partir do WSL2 host.
3. Você tiver clareza sobre o mapeamento de porta.

### Opção C — Container companheiro

Possível se estiver na mesma rede Docker e alcançar o container do repo.

Use quando:

1. Há uma composição Docker com rede compartilhada.
2. O endpoint MCP está publicado em hostname interno estável.

---

## 7. Modo HTTP recomendado para Faixa I

1. Suba o MCP local:

```bash
COPILOT_MCP_HOST=127.0.0.1 COPILOT_MCP_PORT=3333 npm run copilot:mcp:http
```

2. Verifique health:

```bash
curl http://127.0.0.1:3333/health
```

3. Verifique tools/list com MCP Inspector ou JSON-RPC:

```bash
curl -sS -X POST http://127.0.0.1:3333/mcp \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  --data '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

4. Configure o tunnel-client apontando para o MCP local:

```bash
export CONTROL_PLANE_API_KEY="sk-..."

tunnel-client init \
  --profile repo-devcontainer-http \
  --tunnel-id tunnel_<preencher> \
  --mcp-server-url http://127.0.0.1:3333/mcp

tunnel-client doctor --profile repo-devcontainer-http --explain
tunnel-client run --profile repo-devcontainer-http
```

5. Use o endpoint HTTPS fornecido pelo túnel no formulário do ChatGPT.

---

## 8. Modo stdio alternativo

Use quando quiser evitar listener HTTP local persistente:

```bash
export CONTROL_PLANE_API_KEY="sk-..."

tunnel-client init \
  --sample sample_mcp_stdio_local \
  --profile repo-devcontainer-stdio \
  --tunnel-id tunnel_<preencher> \
  --mcp-command "node src/copilot/mcp/index.js --transport stdio"

tunnel-client doctor --profile repo-devcontainer-stdio --explain
tunnel-client run --profile repo-devcontainer-stdio
```

Notas:

1. O transporte `stdio` reserva stdout para JSON-RPC.
2. O bootstrap do servidor redireciona ruído inicial para stderr.
3. Logs operacionais continuam em stderr e audit JSONL.

---

## 9. Formulário do ChatGPT

Na tela da imagem:

### Nome

```text
Repo DevContainer MCP
```

### Descrição

```text
Conecta o ChatGPT ao repositório aberto no VS Code Dev Container. Permite ler arquivos, buscar no código, inspecionar Git, executar validadores controlados e operar o workspace por tools MCP auditáveis.
```

### URL do servidor MCP

```text
https://<endpoint-do-tunel>/mcp
```

Nunca use no formulário:

```text
http://localhost:3333/mcp
http://127.0.0.1:3333/mcp
```

Essas URLs só funcionam localmente. ChatGPT precisa de HTTPS alcançável por ele ou endpoint OpenAI do Secure MCP Tunnel.

### Autenticação

Para desenvolvimento local:

1. Use a opção compatível com o Secure MCP Tunnel configurado.
2. Se estiver em modo developer sem OAuth, mantenha a superfície restrita ao túnel e auditada.
3. Para uso real e persistente, preferir OAuth 2.1 ou a autenticação suportada pelo tunnel/infra escolhidos.

### Confirmação de risco

Marque a confirmação apenas depois de:

1. `tools/list` local funcionar.
2. `repo_status` local funcionar.
3. O tunnel-client doctor passar.
4. Você entender que as tools podem operar o repo real.

---

## 10. Testes no ChatGPT

Depois de criar o conector:

1. Abra um novo chat.
2. Clique em `+`.
3. Abra `More`.
4. Selecione `Repo DevContainer MCP`.
5. Execute os prompts de smoke.

### Prompt 1 — Tools aparecem

```text
Use o conector Repo DevContainer MCP e diga quais tools estão disponíveis.
```

Esperado:

1. ChatGPT reconhece o conector.
2. Tools MCP aparecem.
3. Não há erro de conexão.

### Prompt 2 — Status

```text
Use repo_status e me diga branch, HEAD e se o workspace está dirty.
```

Esperado:

1. Tool `repo_status` chamada.
2. Retorno com branch e HEAD.
3. Audit log registra chamada.

### Prompt 3 — Tree

```text
Liste a árvore de src/copilot/mcp com repo_tree, depth 2 e maxEntries 80.
```

Esperado:

1. Tool `repo_tree` chamada.
2. Retorno com arquivos do módulo MCP.

### Prompt 4 — Read file

```text
Leia src/copilot/mcp/README.md com repo_read_file.
```

Esperado:

1. Tool `repo_read_file` chamada.
2. Conteúdo do README retornado.

### Prompt 5 — Git

```text
Chame git_status e resuma o estado do repositório.
```

Esperado:

1. Tool `git_status` chamada.
2. Retorno equivalente a `git status --short --branch`.

---

## 11. Controle total progressivo

O objetivo final é controle amplo do repo. O caminho seguro é progressivo:

1. Faixa I valida conexão read-only e jobs allowlistados.
2. Faixa G adiciona escrita controlada.
3. Faixa H amplia execução controlada.
4. Faixa J integra LLM-B/Copilot SDK como consumidor ou delegador local.

Controle total não significa comando shell irrestrito no primeiro contato. Significa:

1. Tools amplas.
2. Path policy.
3. Audit log.
4. Jobs rastreáveis.
5. Confirmação para writes.
6. Reversibilidade por Git.
7. Escalada explícita para ações destrutivas.

---

## 12. Auditoria

Cada tool call registrada pelo registry MCP gera eventos em:

```text
src/copilot/.ai/audit/mcp-tool-calls.jsonl
```

Eventos:

1. `tool_call_started`
2. `tool_call_completed`
3. `tool_call_failed`

Variáveis:

```bash
COPILOT_MCP_AUDIT_FILE=/caminho/custom.jsonl
COPILOT_MCP_AUDIT_DISABLED=true
```

---

## 13. Jobs

Tools de job:

1. `run_copilot_validator`
2. `job_get_output`
3. `job_cancel`

Validadores allowlistados:

1. `typecheck`
2. `lint`
3. `unit-mcp`
4. `unit-copilot`

Logs:

```text
src/copilot/.ai/jobs/*.log
```

---

## 14. Diagnostico de falhas

### O ChatGPT não conecta

Verifique:

1. URL é HTTPS.
2. URL termina em `/mcp`.
3. tunnel-client está rodando.
4. tunnel-client doctor passa.
5. MCP local responde.
6. ChatGPT developer mode está habilitado.

### Tools não aparecem

Verifique:

1. `tools/list` local retorna JSON.
2. O túnel aponta para o endpoint correto.
3. O servidor MCP não está retornando HTML/404.
4. Tool annotations existem.
5. Schemas de input são válidos.

### ChatGPT funciona mas não vê arquivos certos

Verifique:

1. MCP roda no Dev Container correto.
2. `repo_status` aponta para `/workspaces/chatgpt-docker-puppeteer`.
3. `git_status` retorna o branch esperado.
4. `repo_tree` em `src/copilot` mostra os arquivos reais.

### Escrita ainda não está liberada

Isso é intencional até Faixa G.

Faixa I deve provar conexão, leitura, Git e jobs. A escrita controlada vem depois, com diff e auditoria própria.

---

## 15. Checklist final da Faixa I

1. `npm run copilot:mcp:http` sobe.
2. `GET /health` responde.
3. `GET /chatgpt-connector.json` responde.
4. `tools/list` inclui `chatgpt_connector_profile`.
5. Secure MCP Tunnel configurado.
6. ChatGPT recebe `https://<endpoint>/mcp`.
7. ChatGPT lista tools.
8. ChatGPT chama `repo_status`.
9. ChatGPT chama `repo_tree`.
10. ChatGPT chama `repo_read_file`.
11. ChatGPT chama `git_status`.
12. Audit JSONL registra chamadas.

---

## 16. Validacao local executada nesta implementacao

1. Typecheck strict:

```text
npm run typecheck:strict:src.copilot
```

Resultado: passou.

2. Lint completo do escopo:

```text
npm run lint:copilot
```

Resultado: passou.

3. Testes MCP focados:

```text
npx vitest --config vitest.copilot.config.js run tests/unit/copilot/mcp/*.spec.js
```

Resultado: passou com 5 arquivos e 13 testes.

4. Smoke HTTP:

```text
GET /health
GET /chatgpt-connector.json?publicMcpUrl=https://example.openai-tunnel.test
POST /mcp tools/list
POST /mcp tools/call chatgpt_connector_url_check
```

Resultado: passou.

5. Suite unit completa:

```text
npm run test:copilot:unit
```

Resultado: ainda falha em 6 testes preexistentes fora da Faixa I/MCP connection:

```text
tests/unit/copilot/config/test_faixa_c_session_config_builder.spec.js
tests/unit/copilot/contracts/test_arch_contracts.spec.js
tests/unit/copilot/contracts/test_global_architecture_strict.spec.js
tests/unit/copilot/contracts/test_owner_sovereignty_block_a.spec.js
tests/unit/copilot/contracts/test_terminal_barrel_governance.spec.js
```

Falhas observadas:

1. BYOK model list espera 2 entradas e recebe 3.
2. Contrato externo para `#copilot/agent/session` em `terminal/commands/session.js`.
3. Violacao global preexistente em `hooks/session-hooks.js`.
4. Violacoes de terminal barrel governance preexistentes em comandos/dialog/events BYOK.

Essas falhas ja apareciam antes da Faixa I e nao pertencem aos arquivos novos de conexao ChatGPT.
