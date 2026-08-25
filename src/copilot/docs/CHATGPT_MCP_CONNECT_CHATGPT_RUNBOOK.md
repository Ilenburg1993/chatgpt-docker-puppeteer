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
  -> Cloudflare Quick Tunnel temporario, Secure MCP Tunnel ou tunnel HTTPS equivalente
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

   Política local deste repo: o conector canônico do ChatGPT usa OAuth max-power por default
   (`repo:read`, `repo:write`, `repo:validate`, `repo:admin`). A contenção fica em validação de
   inputs, annotations, audit log, quarantine/plan tools e confirmação de host quando chatgpt.com
   decidir exibi-la, não na remoção desses escopos do primeiro linking.

5. `Set up Cloudflare Tunnel`
   - A pagina OpenAI de conexao cita Cloudflare Tunnel para expor um MCP local durante
     desenvolvimento.
   - Cloudflare publica hostname HTTPS para service HTTP local por `cloudflared`.
   - Quick Tunnels geram `trycloudflare.com`, sao temporarios e nao suportam SSE.
   - Fonte: `https://developers.cloudflare.com/tunnel/setup/`

6. `Tunnel tokens` e `Downloads — Cloudflare Tunnel`
   - Tunnel remoto precisa somente do token para rodar no host que alcanca o origin.
   - O binario oficial e `cloudflared`, instalavel por pacote Cloudflare ou `.deb` oficial no Linux.
   - Fonte: `https://developers.cloudflare.com/tunnel/advanced/tunnel-tokens/`
   - Fonte: `https://developers.cloudflare.com/tunnel/downloads/`

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

Doctor Cloudflare:

```bash
npm run copilot:mcp:cloudflare:doctor
```

O doctor confirma `cloudflared`, `GET /health` no origin local e a URL publica configurada quando
`COPILOT_MCP_CLOUDFLARE_PUBLIC_URL` existir. Ele nunca imprime `CLOUDFLARE_TUNNEL_TOKEN`.

### 4.2 Subir MCP por stdio

```bash
npm run copilot:mcp:stdio
```

Use `stdio` para VS Code, MCP Inspector local por comando, ou Secure MCP Tunnel em modo command.

---

## 5. Tunnel HTTPS para o ChatGPT

### 5.1 Escolha canônica deste workspace

Para a caixa do ChatGPT mostrada na captura, o caminho operacional atual e temporario:

```text
ChatGPT
  -> https://<aleatorio>.trycloudflare.com/mcp
  -> Cloudflare Quick Tunnel
  -> http://127.0.0.1:3333/mcp
  -> src/copilot/mcp
```

Configure a rota Cloudflare para o origin raiz:

```text
http://127.0.0.1:3333
```

Cole no ChatGPT a URL publica temporaria com o path MCP:

```text
https://<aleatorio>.trycloudflare.com/mcp
```

Nao teremos dominio fixo por ora. Isso e intencional: cada sessao gera uma URL nova e o conector no
ChatGPT deve ser atualizado/recriado com essa URL.

### 5.2 Cloudflare Quick Tunnel

Quick Tunnel e o modo principal sem conta Cloudflare e sem dominio fixo:

```bash
npm run copilot:mcp:http
npm run copilot:mcp:cloudflare:doctor
npm run copilot:mcp:cloudflare:quick
```

O wrapper captura a URL HTTPS aleatoria `trycloudflare.com`, acrescenta `/mcp`, grava
`src/copilot/.ai/cloudflare/quick-tunnel.json` e imprime o endpoint para uso no ChatGPT.

Em outro terminal:

```bash
npm run copilot:mcp:cloudflare:status
npm run copilot:mcp:cloudflare:smoke
```

Cloudflare documenta Quick Tunnels como teste/desenvolvimento, com URL temporaria, limite de
concorrencia e sem suporte a SSE. Esses limites sao aceitos neste projeto por enquanto.

### 5.3 Cloudflare Tunnel publicado futuro opcional

Nao usaremos dominio fixo por ora. Esta subfase fica apenas como referencia futura se a natureza do
projeto mudar.

Para uma URL estavel futura:

1. Crie no painel Cloudflare um tunnel remoto.
2. Adicione uma rota de published application.
3. Escolha o hostname publico.
4. Configure o service/origin como `http://127.0.0.1:3333` no ambiente que roda `cloudflared`.
5. Copie o token do tunnel para segredo local.
6. Rode:

```bash
npm run copilot:mcp:http
export CLOUDFLARE_TUNNEL_TOKEN="<token-do-tunnel>"
export COPILOT_MCP_CLOUDFLARE_PUBLIC_URL="https://<hostname-cloudflare>/mcp"
npm run copilot:mcp:cloudflare:doctor
npm run copilot:mcp:cloudflare:run
```

### 5.4 Status e smoke da sessao temporaria

Status:

```bash
npm run copilot:mcp:cloudflare:status
```

Retorna:

1. Nome.
2. Descricao.
3. URL MCP temporaria para a caixa do ChatGPT.
4. Autenticacao `none-dev`.
5. Arquivo de estado local.

Se o PID do `cloudflared` salvo no estado ja tiver encerrado, `status` retorna `ok=false`; a URL
antiga deve ser tratada como expirada.

Smoke:

```bash
npm run copilot:mcp:cloudflare:smoke
```

Valida:

1. `GET https://<aleatorio>.trycloudflare.com/health`.
2. `POST https://<aleatorio>.trycloudflare.com/mcp` com `tools/list`.
3. Quantidade de tools retornadas.
4. Paridade exata entre `tools/list` remoto e `getCanonicalMcpTools()`.
5. Presenca das tools criticas de leitura, validacao, runtime, smoke e indice.

Se `toolsMatchLocalRegistry=false`, a URL nao deve ser usada como conector operacional. O caso mais
comum durante desenvolvimento e simples: o `cloudflared` continua vivo, mas o origin local
`127.0.0.1:3333` ainda esta rodando uma versao antiga do MCP. Nesse caso:

1. Reinicie somente o origin MCP em `3333`.
2. Mantenha o processo `cloudflared` vivo quando possivel, para preservar a mesma URL temporaria.
3. Rode `npm run copilot:mcp:smoke:local` contra `http://127.0.0.1:3333/mcp`.
4. Rode `npm run copilot:mcp:cloudflare:smoke`.
5. Use a URL no ChatGPT somente quando `toolsMatchLocalRegistry=true`, `criticalToolsPresent=true`,
   `missingLocalTools=[]` e `unexpectedRemoteTools=[]`.

Estado validado em 2026-05-22 apos a rodada de paridade IO/indice:

```text
URL publica: https://hull-grove-hence-departmental.trycloudflare.com/mcp
Origin: http://127.0.0.1:3333/mcp
Tools remotas: 43
Tools esperadas: 43
toolsMatchLocalRegistry: true
criticalToolsPresent: true
missingLocalTools: []
unexpectedRemoteTools: []
```

### 5.5 Instalacao do cloudflared

Instalador desta rodada:

```bash
npm run copilot:mcp:cloudflare:install
```

Ele baixa o `.deb` oficial correspondente a arquitetura Debian e usa `dpkg -i` com `sudo -n` quando
necessario. O rebuild do Dev Container tambem instala a versao pinada definida em
`.devcontainer/Dockerfile`.

O wrapper usa `http2` como transporte Cloudflare por default porque a saida UDP/QUIC pode falhar em
Dev Containers. Para testar outro protocolo oficial:

```bash
COPILOT_MCP_CLOUDFLARE_PROTOCOL=auto npm run copilot:mcp:cloudflare:quick
COPILOT_MCP_CLOUDFLARE_PROTOCOL=quic npm run copilot:mcp:cloudflare:run
```

### 5.6 Secure MCP Tunnel alternativo

Secure MCP Tunnel continua documentado quando a preferencia for o `tunnel-client` da OpenAI.

### 5.7 Pre-requisitos Secure MCP Tunnel

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
  --tunnel-id tunnel_ \
  http://127.0.0.1:3333/mcp < preencher > --mcp-server-url

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
  --tunnel-id tunnel_ \
  "node src/copilot/mcp/cli/index.js --transport stdio" < preencher > --mcp-command

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
https://<aleatorio>.trycloudflare.com/mcp
```

Nunca use no formulário:

```text
http://localhost:3333/mcp
http://127.0.0.1:3333/mcp
```

Essas URLs só funcionam localmente. ChatGPT precisa de HTTPS alcançável por ele, por exemplo
Cloudflare Quick Tunnel temporario ou endpoint OpenAI do Secure MCP Tunnel.

### Autenticação

Para Cloudflare Tunnel:

1. O MCP server atual nao implementa OAuth proprio.
2. Se o formulario oferecer modo sem autenticacao em developer mode, use-o apenas no ambiente
   controlado.
3. Se voce selecionar OAuth, a URL `/mcp` precisa ter fluxo OAuth compativel; Cloudflare Tunnel
   simples nao o fornece.
4. Uma pagina de login interativa Cloudflare Access diante de `/mcp` pode bloquear o backend do
   ChatGPT.
5. O perfil JSON usa `authMode=none-dev` por default e aceita override
   `COPILOT_MCP_CHATGPT_AUTH_MODE`.

Para Secure MCP Tunnel:

1. Use a opcao compativel com o tunnel configurado.
2. Para uso persistente fora do ambiente controlado, prefira OAuth 2.1 ou autenticacao compativel
   com a infraestrutura.

### Confirmação de risco

Marque a confirmação apenas depois de:

1. `tools/list` local funcionar.
2. `repo_status` local funcionar.
3. `npm run copilot:mcp:cloudflare:smoke` passar para Cloudflare temporario ou
   `tunnel-client doctor` passar para Secure MCP Tunnel.
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

### Prompt 3.1 — Root Tree

```text
Liste a raiz real do workspace com repo_root_tree, maxEntries 80.
```

Esperado:

1. Tool `repo_root_tree` chamada.
2. Retorno com path `"."`.
3. A raiz real do repo aparece sem enviar `path=""`.

### Prompt 4 — Read file

```text
Leia src/copilot/mcp/README.md com repo_read_file.
```

Esperado:

1. Tool `repo_read_file` chamada.
2. Conteúdo do README retornado.
3. `sha256` retornado para uso posterior em writes com `expectedHash`.

### Prompt 4.1 — Search com contexto

```text
Busque registerCanonicalMcpTools em src/copilot/mcp com repo_search_text, contextLines 2.
```

Esperado:

1. Tool `repo_search_text` chamada.
2. Matches retornados com 2 linhas de contexto.
3. Se `nextCursor` vier preenchido, repita a mesma tool com `cursor`.

### Prompt 5 — Git

```text
Chame git_status e resuma o estado do repositório.
```

Esperado:

1. Tool `git_status` chamada.
2. Retorno equivalente a `git status --short --branch`.

### Prompt 6 — Capacidades e túnel

```text
Chame mcp_capabilities_summary, mcp_tunnel_status e mcp_runtime_health.
```

Esperado:

1. Resumo categorizado das tools.
2. Estado do Quick Tunnel temporário quando houver sessão ativa.
3. Métricas internas do MCP.

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

### Escrita controlada disponível no repo

Após a implementação da Faixa G.1, o ChatGPT deve enxergar também:

1. `repo_write_file`
2. `repo_create_file`
3. `repo_apply_patch`
4. `repo_move_file`
5. `repo_remove_file`

Uso recomendado:

1. Ler antes com `repo_read_file`.
2. Preferir `repo_apply_patch` para mudanças cirúrgicas.
3. Usar `dryRun=true` quando quiser revisar diff antes de aplicar.
4. Usar `expectedHash` em `repo_write_file` ou `repo_apply_patch` quando houver risco de corrida.
5. Usar `repo_create_file` para arquivos novos, pois ele falha se o destino já existir.
6. Usar `repo_move_file` sem overwrite por padrão.
7. Usar `confirmOverwrite=true` somente quando `repo_move_file` receber `overwrite=true`.
8. Usar `repo_remove_file` somente com `confirm=true`.

As tools de escrita gravam eventos de auditoria em JSONL, mas não persistem o conteúdo editado
dentro do log de auditoria.

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
3. `cloudflared` ou `tunnel-client` está rodando.
4. `npm run copilot:mcp:cloudflare:doctor` ou `tunnel-client doctor` passa.
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

### Escrita não aparece no ChatGPT

Verifique:

1. Servidor local está no commit que contém Faixa G.1.
2. `tools/list` local inclui `repo_apply_patch`.
3. O túnel foi reiniciado depois da atualização do servidor MCP.
4. O conector no ChatGPT foi recriado ou recarregado.
5. A chamada `chatgpt_connector_profile` retorna o perfil esperado.

---

## 15. Checklist final da Faixa I

1. `npm run copilot:mcp:http` sobe.
2. `GET /health` responde.
3. `GET /chatgpt-connector.json` responde.
4. `tools/list` inclui `chatgpt_connector_profile`.
5. Cloudflare Quick Tunnel temporario ou Secure MCP Tunnel configurado.
6. ChatGPT recebe `https://<aleatorio>.trycloudflare.com/mcp`.
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

### Validacao adicional apos Faixa G.1

1. `npm run typecheck:strict:src.copilot` passou.
2. `npm run lint:copilot` passou.
3. `node --max-old-space-size=6144 node_modules/.bin/eslint src/copilot/mcp tests/unit/copilot/mcp --no-cache`
   passou.
4. `npx vitest --config vitest.copilot.config.js run tests/unit/copilot/mcp/*.spec.js` passou: 6
   arquivos, 20 testes.
5. `npm run test:copilot:unit` ainda falha nas mesmas 6 areas preexistentes fora do MCP; nesta
   rodada foram 3019 testes totais e 3013 passaram.

### Validacao adicional apos Cloudflare Tunnel

1. `cloudflared` foi instalado no ambiente atual e reportou `2026.5.0`.
2. `npm run copilot:mcp:cloudflare:doctor` passou com origin local vivo e URL publica HTTPS
   normalizada.
3. `npm run copilot:mcp:cloudflare:run` sem token falhou de modo explicito e sem imprimir segredo.
4. Quick Tunnel em `auto` tentou QUIC e falhou neste Dev Container; o wrapper passou a usar `http2`
   por default.
5. Quick Tunnel em HTTP/2 passou para:
   - `GET /health` remoto com HTTP 200;
   - `POST /mcp` remoto com `tools/list`;
   - contagem remota de 26 tools.
6. `npx vitest --config vitest.copilot.config.js run tests/unit/copilot/mcp/*.spec.js` passou com 10
   arquivos e 34 testes.
7. `npm run typecheck:strict:src.copilot` passou.
8. `npm run lint:copilot` passou.
9. `npm run test:copilot:unit` repetiu as 6 falhas preexistentes fora do MCP: 3033 testes totais,
   3027 passaram.

### Validacao adicional apos promocao do dominio temporario

1. O modo operacional principal passou a ser Quick Tunnel temporario.
2. O CLI captura a URL `trycloudflare.com` automaticamente.
3. O arquivo runtime `src/copilot/.ai/cloudflare/quick-tunnel.json` guarda a URL da sessao.
4. `npm run copilot:mcp:cloudflare:status` mostra os dados da caixa do ChatGPT.
5. `npm run copilot:mcp:cloudflare:smoke` valida `GET /health` e `POST /mcp tools/list` na URL
   temporaria.
6. Smoke real desta rodada:
   - URL capturada: `https://sen-recall-handbook-tim.trycloudflare.com/mcp`;
   - `status` retornou `authentication=none-dev`;
   - `smoke` retornou `ok=true`;
   - `toolsList.tools=26`.
7. Validacao focada apos a mudanca:
   - `npm run typecheck:strict:src.copilot` passou;
   - `npm run lint:copilot` passou;
   - `npx vitest --config vitest.copilot.config.js run tests/unit/copilot/mcp/*.spec.js` passou com
     10 arquivos e 36 testes.
8. `npm run test:copilot:unit` executou 3035 testes, 3029 passaram e as 6 falhas preexistentes fora
   do MCP/Cloudflare permaneceram nas suites de contratos/config.

### Validacao adicional apos primeiro uso real no ChatGPT

Feedback aplicado:

1. `repo_tree path=""` agora usa o default `src/copilot` em vez de falhar.
2. `repo_root_tree` lista explicitamente a raiz real do workspace.
3. `repo_search_text` agora aceita `contextLines` e `cursor`.
4. `repo_read_file` agora retorna `sha256` e `returnedSha256`.
5. `mcp_capabilities_summary` resume a superfície por categoria.
6. `mcp_tunnel_status` expõe estado, idade, URL e recovery do Quick Tunnel temporário.
7. `mcp_runtime_health` inclui o resumo de tunnel.
8. Os smoke prompts do `chatgpt_connector_profile` foram ampliados para cobrir IO, busca, validação,
   jobs, métricas e túnel.

Validação focada:

1. `npm run typecheck:strict:src.copilot` passou.
2. `npm run lint:copilot` passou.
3. `npx vitest --config vitest.copilot.config.js run tests/unit/copilot/mcp/*.spec.js` passou com 10
   arquivos e 39 testes.
4. `npm run test:copilot:unit` executou 3038 testes, 3032 passaram e as 6 falhas preexistentes fora
   do MCP permaneceram nas suites de contratos/config.
5. Smoke HTTP local passou para as novas surfaces:
   - `repo_tree path=""`;
   - `repo_root_tree`;
   - `repo_read_file` com `sha256`;
   - `repo_search_text contextLines=2`;
   - `mcp_capabilities_summary`;
   - `mcp_tunnel_status`;
   - `tools/list` com 29 tools.
