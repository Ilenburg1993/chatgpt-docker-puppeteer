# Cloudflare Tunnel para ChatGPT MCP

**Data:** 2026-05-22  
**Escopo:** `src/copilot/`  
**Origin local:** `http://127.0.0.1:3333`  
**Endpoint MCP local:** `http://127.0.0.1:3333/mcp`  
**Tunnel Cloudflare padrao:** `workspace-mcp-dev`  
**Dominio Cloudflare:** `aurelin.org`  
**Endpoint MCP publico esperado:** `https://mcp.aurelin.org/mcp`

---

## 1. Objetivo

Este documento consolida a frente Cloudflare Tunnel do conector ChatGPT para o MCP server em
`src/copilot/mcp`.

O objetivo pratico e transformar o servidor local do Dev Container em um endpoint HTTPS que a caixa
de criacao de conector em `https://chatgpt.com/` consiga alcancar:

```text
ChatGPT
  -> HTTPS publico /mcp
  -> Cloudflare edge
  -> cloudflared no Dev Container
  -> HTTP origin local
  -> src/copilot/mcp
  -> workspace Git real
```

O tunnel nao substitui:

1. O MCP server.
2. A validacao de path e schemas.
3. A auditoria JSONL.
4. As confirmacoes das tools destrutivas.
5. A autenticacao propria que venha a ser escolhida para uso persistente fora de developer mode.

---

## 2. Pesquisa oficial consolidada

### 2.1 OpenAI

A pagina oficial de conexao do Apps SDK exige que:

1. Developer mode esteja habilitado no ChatGPT para criar conector customizado.
2. O MCP server seja alcancavel por HTTPS.
3. O campo Connector URL receba o endpoint publico `/mcp`.
4. Cloudflare Tunnel seja uma opcao para expor um servidor local durante desenvolvimento.
5. Ao criar o conector com sucesso, ChatGPT mostre as tools anunciadas pelo servidor.

Fonte:

```text
https://developers.openai.com/apps-sdk/deploy/connect-chatgpt
```

### 2.2 Cloudflare

A documentacao Cloudflare estabelece dois caminhos relevantes:

1. Quick Tunnel:
   - `cloudflared tunnel --url http://localhost:8080`;
   - subdominio aleatorio `trycloudflare.com`;
   - uso de teste/desenvolvimento;
   - limite de concorrencia documentado;
   - sem suporte a Server-Sent Events;
   - dura enquanto o processo estiver rodando.
2. Tunnel publicado:
   - hostname publico;
   - service/origin local;
   - execucao por `cloudflared`;
   - token suficiente para tunnel remoto.

Fontes:

```text
https://developers.cloudflare.com/tunnel/setup/
https://developers.cloudflare.com/tunnel/advanced/tunnel-tokens/
https://developers.cloudflare.com/tunnel/downloads/
```

### 2.3 Conclusao para este repo

O servidor MCP atual usa Streamable HTTP e o adapter local responde JSON para chamadas usuais de
smoke.

1. Tunnel permanente e o caminho principal deste projeto a partir de 2026-05-23.
2. O tunnel remoto se chama `workspace-mcp-dev`.
3. O hostname publico canonico e `mcp.aurelin.org`.
4. A rota Cloudflare deve mapear o origin raiz `http://127.0.0.1:3333`.
5. O campo ChatGPT deve receber o endpoint publico permanente `https://mcp.aurelin.org/mcp`.
6. Cloudflare Tunnel sozinho nao adiciona OAuth ao MCP.
7. Quick Tunnel `trycloudflare.com` permanece como fallback operacional explicito, nao como padrao.

---

## 3. Estado implementado no workspace

### 3.1 Binario instalado nesta rodada

O ambiente atual recebeu:

```text
cloudflared version 2026.5.0
```

A instalacao usada foi o `.deb` oficial da release Cloudflare correspondente a arquitetura Debian do
container.

### 3.2 Instalacao repetivel

Package script:

```bash
npm run copilot:mcp:cloudflare:install
```

Arquivo:

```text
src/copilot/mcp/cloudflare/install-cloudflared.sh
```

O script:

1. Detecta a arquitetura por `dpkg --print-architecture` e mapeia os nomes Debian para os assets
   Cloudflare.
2. Aceita `CLOUDFLARED_RELEASE=latest` por default.
3. Aceita `CLOUDFLARED_RELEASE=<versao>` para baixar uma release pinada.
4. Baixa o `.deb` oficial.
5. Usa `dpkg -i`.
6. Usa `sudo -n` quando o processo nao for root.
7. Imprime `cloudflared --version` no final.

### 3.3 Rebuild do Dev Container

`.devcontainer/Dockerfile` agora:

1. Declara `ARG CLOUDFLARED_VERSION=2026.5.0`.
2. Baixa o `.deb` pinado da release Cloudflare.
3. Instala o pacote durante build.
4. Inclui `cloudflared` no Tool Validation Gate.

### 3.4 Package scripts

```text
copilot:mcp:cloudflare:install
copilot:mcp:cloudflare:doctor
copilot:mcp:cloudflare:quick
copilot:mcp:cloudflare:run
copilot:mcp:cloudflare:up
copilot:mcp:cloudflare:down
copilot:mcp:cloudflare:status
copilot:mcp:cloudflare:smoke
```

### 3.5 CLI local

Arquivos:

```text
src/copilot/mcp/cloudflare/config.js
src/copilot/mcp/cloudflare/cli.js
```

O CLI:

1. Nao imprime token.
2. Monta args do quick tunnel.
3. Monta args do tunnel remoto.
4. Falha cedo quando o tunnel remoto nao tem `CLOUDFLARE_TUNNEL_TOKEN`.
5. Faz doctor do binario e do origin.
6. Valida a URL publica ChatGPT configurada.
7. Captura automaticamente a URL `trycloudflare.com` emitida pelo Quick Tunnel.
8. Grava estado temporario em `src/copilot/.ai/cloudflare/quick-tunnel.json`.
9. Executa smoke remoto contra `/health` e `/mcp`.

---

## 4. Variaveis operacionais

### 4.1 Origin

Default:

```bash
COPILOT_MCP_CLOUDFLARE_ORIGIN_URL=http://127.0.0.1:3333
```

Este valor aponta para a raiz HTTP, nao para `/mcp`.

### 4.2 URL publica temporaria

No modo principal, a URL publica vem do `cloudflared` a cada sessao:

```text
https://<aleatorio>.trycloudflare.com/mcp
```

O CLI grava essa URL em:

```text
src/copilot/.ai/cloudflare/quick-tunnel.json
```

`COPILOT_MCP_CLOUDFLARE_PUBLIC_URL` continua existindo como override manual, mas nao e necessario no
uso normal temporario.

### 4.3 Protocolo de transporte

O wrapper desta rodada usa HTTP/2 por default:

```bash
COPILOT_MCP_CLOUDFLARE_PROTOCOL=http2
```

O motivo e pratico: no smoke do Dev Container a tentativa automatica por QUIC falhou, enquanto
HTTP/2 registrou o tunnel e atravessou `/health` e `/mcp`.

Valores oficiais aceitos:

1. `auto`
2. `http2`
3. `quic`

Cloudflare documenta que `auto` escolhe QUIC e pode fazer fallback para HTTP/2 quando UDP nao
estiver disponivel.

### 4.4 Arquivo de estado de sessao

Default:

```bash
COPILOT_MCP_CLOUDFLARE_STATE_FILE=src/copilot/.ai/cloudflare/quick-tunnel.json
```

Esse arquivo e runtime local e fica ignorado pelo Git. Ele contem:

1. URL base temporaria.
2. URL MCP final para ChatGPT.
3. PID do `cloudflared`.
4. Origin local.
5. Protocolo usado.
6. Campos do formulario ChatGPT.
7. Comando de smoke.

### 4.5 Janela de stale para URL temporaria

Default:

```bash
COPILOT_MCP_CLOUDFLARE_STALE_AFTER_MS=21600000
```

Isto equivale a 6 horas. O valor aceito fica entre 1 minuto e 7 dias.

O objetivo nao e tornar Quick Tunnel "fixo". A URL `trycloudflare.com` continua efemera. A janela de
stale serve para operacao profissional:

1. `status` mostra `ageMs`, `ageSeconds`, `ageMinutes`, `stale` e `recommendedAction`.
2. `doctor` mostra a politica ativa e o resumo da ultima sessao.
3. `mcp_tunnel_status` e `mcp_runtime_health` expoem a mesma informacao para o ChatGPT.
4. Quando a sessao fica velha, a acao recomendada passa a ser `smoke`.
5. Quando o PID gravado nao esta vivo, a acao recomendada passa a ser `restart`.
6. Quando `smoke` roda, o resultado e gravado em `lastSmoke` no arquivo de estado temporario.

Valores de `recommendedAction`:

1. `start`: nenhum estado local existe; suba origin e Quick Tunnel.
2. `restart`: estado invalido ou processo do tunnel encerrado; crie nova URL e atualize o ChatGPT.
3. `smoke`: processo vivo, mas sessao mais antiga que a janela configurada; rode smoke antes de
   usar.
4. `use`: processo vivo e sessao ainda fresca; ainda assim rode smoke antes de uma operacao longa.

### 4.6 Token do tunnel remoto futuro

```bash
CLOUDFLARE_TUNNEL_TOKEN=<segredo>
```

Nunca:

1. Commitar o token.
2. Colocar o token em documentacao versionada.
3. Imprimir o token em logs de CI.
4. Colocar o token dentro do formulario ChatGPT.

---

## 5. Subir o origin MCP

Terminal A:

```bash
COPILOT_MCP_HOST=127.0.0.1 COPILOT_MCP_PORT=3333 npm run copilot:mcp:http
```

Health local:

```bash
curl http://127.0.0.1:3333/health
```

`tools/list` local:

```bash
curl -sS -X POST http://127.0.0.1:3333/mcp \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  --data '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

Perfil ChatGPT local:

```bash
curl http://127.0.0.1:3333/chatgpt-connector.json
```

---

## 6. Doctor

Com o origin rodando:

```bash
npm run copilot:mcp:cloudflare:doctor
```

Saida esperada:

1. `ok: true`.
2. Versao de `cloudflared`.
3. `health.ok: true`.
4. Origin `http://127.0.0.1:3333`.
5. URL publica validada quando configurada.

Quando `ok` for false:

1. Se `cloudflared.ok` for false, instale o binario.
2. Se `health.ok` for false, suba `npm run copilot:mcp:http`.
3. Se `publicUrlValidation` for false, corrija HTTPS e `/mcp`.

---

## 7. Quick Tunnel temporario como modo principal

### 7.1 Quando usar

Use para:

1. Expor este workspace sem comprar, delegar ou fixar dominio.
2. Criar uma URL publica efemera por sessao.
3. Colar uma URL nova no ChatGPT quando a sessao reiniciar.
4. Testar `GET /health` no endpoint remoto.
5. Testar `POST /mcp` remoto.
6. Manter a arquitetura aderente a natureza temporaria do projeto.

### 7.2 Como rodar

Terminal B:

```bash
npm run copilot:mcp:cloudflare:quick
```

O wrapper chama:

```bash
TUNNEL_TRANSPORT_PROTOCOL=http2 cloudflared tunnel --url http://127.0.0.1:3333 --no-autoupdate
```

Assim que o `cloudflared` imprime a URL, o wrapper captura e grava o estado. Em outro terminal:

```bash
npm run copilot:mcp:cloudflare:status
npm run copilot:mcp:cloudflare:smoke
```

O endpoint para colar e:

```text
https://<aleatorio>.trycloudflare.com/mcp
```

`status` tambem verifica se o PID do `cloudflared` registrado ainda esta vivo. Se a sessao foi
encerrada, ele mostra o estado antigo, mas retorna `ok=false`; nesse caso, suba um novo Quick Tunnel
e use a nova URL.

A partir desta rodada, `status` tambem devolve um bloco `summary`:

```json
{
  "configured": true,
  "stateValid": true,
  "processAlive": true,
  "ageMinutes": 14,
  "staleAfterMs": 21600000,
  "stale": false,
  "recommendedAction": "use",
  "lastSmokeAt": "2026-05-22T12:02:00.000Z",
  "lastSmokeOk": true,
  "lastSmokeAgeMinutes": 3,
  "connectorUrl": "https://alpha-beta-gamma.trycloudflare.com/mcp"
}
```

Esse resumo e a fonte preferencial para saber se a caixa do ChatGPT deve continuar usando a URL
atual ou se deve receber uma URL nova.

### 7.3 Arquivo de estado

Exemplo de estado:

```json
{
  "mode": "temporary-trycloudflare",
  "originUrl": "http://127.0.0.1:3333",
  "publicBaseUrl": "https://alpha-beta-gamma.trycloudflare.com",
  "connectorUrl": "https://alpha-beta-gamma.trycloudflare.com/mcp",
  "transportProtocol": "http2",
  "chatgpt": {
    "name": "Repo DevContainer MCP",
    "mcpServerUrl": "https://alpha-beta-gamma.trycloudflare.com/mcp",
    "authentication": "none-dev"
  }
}
```

### 7.4 Limites

Quick Tunnel e o estado atual deliberado, mas tem limites:

1. Reiniciar muda URL.
2. Sem hostname proprio.
3. O conector do ChatGPT precisa ser atualizado ou recriado a cada nova URL.
4. Sem SSE segundo a documentacao Cloudflare.
5. Limite de concorrencia de desenvolvimento.

---

## 8. Tunnel publicado futuro opcional

Esta secao fica como referencia futura. O fluxo atual nao usa dominio fixo por decisao de
arquitetura.

### 8.1 Objeto no Cloudflare

No dashboard Cloudflare:

1. Abra Networking.
2. Abra Tunnels.
3. Crie ou selecione um tunnel remoto.
4. Adicione Published application route.
5. Escolha o hostname, por exemplo `repo-mcp.seudominio.example`.
6. Informe service URL:

```text
http://127.0.0.1:3333
```

### 8.2 Token e execucao

O token do tunnel remoto e obtido no dashboard ao adicionar replica, ou pela API Cloudflare
apropriada.

Terminal A:

```bash
npm run copilot:mcp:http
```

Terminal B:

```bash
export CLOUDFLARE_TUNNEL_TOKEN_FILE="src/copilot/.ai/cloudflare/workspace-mcp-dev.token"
export COPILOT_MCP_CLOUDFLARE_PUBLIC_URL="https://mcp.aurelin.org/mcp"
npm run copilot:mcp:cloudflare:doctor
npm run copilot:mcp:cloudflare:up
```

Teste:

```text
https://repo-mcp.seudominio.example/health
https://repo-mcp.seudominio.example/mcp
```

`/health` prova roteamento. `/mcp` prova MCP.

---

## 9. Caixa do ChatGPT para sessao temporaria

### Nome

```text
Repo DevContainer MCP
```

### Descricao

```text
Conecta o ChatGPT ao repositório aberto no VS Code Dev Container. Permite ler arquivos, buscar no código, inspecionar Git, executar validadores controlados e operar o workspace por tools MCP auditáveis.
```

### URL do servidor MCP

```text
https://<aleatorio>.trycloudflare.com/mcp
```

### Autenticacao

Estado real nesta rodada:

1. O server MCP deste repo nao expoe OAuth proprio.
2. Cloudflare Tunnel so publica o transporte HTTPS.
3. No developer mode, use a opcao sem autenticacao apenas se a caixa a disponibilizar e se aceitar a
   exposicao controlada.
4. Selecionar OAuth exige uma camada OAuth compativel com o conector.
5. O profile helper responde `authMode=none-dev` por default; altere `COPILOT_MCP_CHATGPT_AUTH_MODE`
   quando houver autenticacao real diferente.

### Confirmacao

A confirmacao de risco deve ser marcada somente depois de:

1. Origin local validado.
2. Quick Tunnel temporario validado por `npm run copilot:mcp:cloudflare:smoke`.
3. URL HTTPS correta.
4. Entendimento de que as write tools operam o workspace real.

---

## 10. Smoke remoto

Com Quick Tunnel em execucao:

```bash
npm run copilot:mcp:cloudflare:status
npm run copilot:mcp:cloudflare:smoke
```

````bash
Ou manualmente, com `PUBLIC_BASE=https://<aleatorio>.trycloudflare.com`:

```bash
curl -sS "${PUBLIC_BASE}/health"
curl -sS -X POST "${PUBLIC_BASE}/mcp" \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  --data '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
````

Smoke no ChatGPT:

```text
Use o conector Repo DevContainer MCP e chame repo_status.
```

Depois:

```text
Liste a arvore de src/copilot/mcp com repo_tree.
```

Depois:

```text
Leia src/copilot/mcp/README.md com repo_read_file.
```

---

## 11. Seguranca

Este conector tem tools de escrita e jobs allowlistados. O tunnel deve ser tratado como uma porta
real para o repo.

Regras minimas:

1. Nao exponha outro processo na mesma rota por engano.
2. Nao aponte a rota Cloudflare para porta errada.
3. Nao use token em shell history compartilhado quando puder usar secret injection local.
4. Rotacione token comprometido.
5. Pare `cloudflared` quando a sessao remota nao for necessaria.
6. Revise audit JSONL apos operacoes importantes.
7. Preserve confirms das tools destrutivas.

Cloudflare Access:

1. Uma pagina de login interativa antes de `/mcp` pode impedir que o backend do ChatGPT use o
   endpoint.
2. Se autenticacao for exigida, desenhe OAuth compativel com o conector.
3. Nao trate Cloudflare Tunnel simples como OAuth.

---

## 12. Troubleshooting

### 12.1 Doctor falha no health

1. Verifique se `npm run copilot:mcp:http` esta vivo.
2. Verifique `COPILOT_MCP_HOST=127.0.0.1`.
3. Verifique porta `3333`.
4. Verifique se `COPILOT_MCP_CLOUDFLARE_ORIGIN_URL` nao aponta para `/mcp`.

### 12.2 Cloudflare responde 502

1. O origin local nao esta acessivel para o processo `cloudflared`.
2. O service URL da rota aponta para host/porta errados.
3. O MCP foi encerrado depois que o tunnel subiu.

### 12.3 ChatGPT diz conexao falhou

1. Teste `GET /health` remoto.
2. Teste `POST /mcp` remoto.
3. Confirme HTTPS.
4. Confirme `/mcp`.
5. Confirme que a rota nao retorna HTML de login.
6. Recarregue a ferramenta apos reiniciar o MCP.

---

## 13. Validacoes e prontidao

Validadores canonicos:

```bash
npm run typecheck:strict:src.copilot
npm run lint:copilot
npm run test:copilot:unit
```

Testes MCP focados:

```bash
npx vitest --config vitest.copilot.config.js run tests/unit/copilot/mcp/*.spec.js
```

Tudo fica pronto para preencher a caixa quando:

1. `cloudflared --version` funciona.
2. `npm run copilot:mcp:http` responde localmente.
3. `npm run copilot:mcp:cloudflare:doctor` passa.
4. Quick Tunnel temporario esta rodando.
5. `npm run copilot:mcp:cloudflare:status` mostra a URL atual.
6. `npm run copilot:mcp:cloudflare:smoke` passa.
7. O endpoint colado no ChatGPT termina em `/mcp`.
8. A opcao de autenticacao escolhida corresponde ao que existe de fato no endpoint.

O smoke remoto agora tambem valida a superficie de tools:

1. Compara os nomes remotos de `tools/list` com o registry local.
2. Reporta `expectedLocalTools`, `missingLocalTools` e `unexpectedRemoteTools`.
3. Exige que a superficie remota corresponda ao registry local.
4. Exige que o conjunto critico esteja presente:
   - `repo_status`;
   - `repo_tree`;
   - `repo_root_tree`;
   - `repo_read_file`;
   - `repo_read_file_chunks`;
   - `repo_file_stats`;
   - `repo_search_text`;
   - `repo_find_symbol_usages`;
   - `repo_symbol_search`;
   - `repo_file_outline`;
   - `repo_index_status`;
   - `project_doctor`;
   - `run_copilot_validator`;
   - `job_list`;
   - `job_get_output`;
   - `mcp_runtime_health`;
   - `mcp_smoke_workspace`;
   - `mcp_tunnel_status`.

Se `toolsMatchLocalRegistry=false`, `missingLocalTools` nao estiver vazio, `unexpectedRemoteTools`
nao estiver vazio ou `missingCriticalTools` nao estiver vazio, a URL pode ate estar viva, mas nao
deve ser colada como conector operacional.

O dado principal da captura e:

```text
https://<aleatorio>.trycloudflare.com/mcp
```

---

## 14. Evidencia executada nesta rodada

Ambiente:

1. Debian Bookworm Dev Container.
2. Arquitetura `amd64`.
3. `cloudflared version 2026.5.0`.

Doctor:

1. Origin local `http://127.0.0.1:3333`.
2. Health local HTTP 200.
3. URL publica exemplo normalizada para `/mcp`.
4. Token remoto ausente reportado apenas como booleano.

Quick Tunnel:

1. Tentativa inicial por transporte automatico escolheu QUIC e retornou erro de control stream neste
   container.
2. HTTP/2 registrou a conexao Cloudflare.
3. O wrapper passou a setar `TUNNEL_TRANSPORT_PROTOCOL=http2` por default.
4. A URL `trycloudflare.com` temporaria retornou `GET /health` com JSON do MCP.
5. A chamada remota `POST /mcp` para `tools/list` retornou 26 tools.
6. A rodada posterior promoveu Quick Tunnel a modo principal e confirmou:
   - captura automatica de `https://sen-recall-handbook-tim.trycloudflare.com/mcp`;
   - escrita de `src/copilot/.ai/cloudflare/quick-tunnel.json`;
   - `npm run copilot:mcp:cloudflare:status` retornando nome, descricao, URL e autenticacao
     `none-dev`;
   - `npm run copilot:mcp:cloudflare:smoke` passando com `GET /health` e `POST /mcp tools/list`;
   - 26 tools vistas pelo smoke remoto.

Validadores:

1. Testes MCP focados passaram com 10 arquivos e 34 testes.
2. Typecheck strict do `src/copilot` passou.
3. Lint do `src/copilot` passou.
4. Suite unit ampla do `src/copilot` voltou a apresentar 6 falhas preexistentes fora do modulo
   MCP/Cloudflare; elas foram posteriormente corrigidas na rodada pos-primeiro uso ChatGPT.
5. Apos promover dominio temporario como padrao, testes MCP focados passaram com 10 arquivos e 36
   testes.
6. `npm run typecheck:strict:src.copilot` e `npm run lint:copilot` passaram apos a mudanca de
   dominio temporario.
7. Na rodada de correcao profunda seguinte, os tres validadores canonicos passaram:
   - `npm run typecheck:strict:src.copilot`;
   - `npm run lint:copilot`;
   - `npm run test:copilot:unit` com 3038/3038 testes e 1008/1008 suites.
8. A estrategia de dominio permanece temporaria por decisao arquitetural:
   - usar `*.trycloudflare.com`;
   - registrar a URL ativa em `src/copilot/.ai/cloudflare/quick-tunnel.json`;
   - expor recuperacao por `copilot:mcp:cloudflare:status`, `doctor` e `smoke`;
   - nao introduzir dependencia de dominio fixo ate nova decisao explicita.
9. Apos o upgrade de paridade IO, `tools/list` local passa a expor 32 tools; o proximo smoke remoto
   deve confirmar esse numero no endpoint temporario ativo.
10. A rodada de robustez Cloudflare acrescentou:
    - stale window configuravel por `COPILOT_MCP_CLOUDFLARE_STALE_AFTER_MS`;
    - `recommendedAction` para `start`, `restart`, `smoke` e `use`;
    - `doctor`, `status`, `mcp_tunnel_status` e `mcp_runtime_health` usando o mesmo resumo
      operacional;
    - `smoke` remoto conferindo tools criticas e divergencia contra o registry MCP local.
11. A rodada seguinte acrescentou persistencia de `lastSmoke` no estado temporario, com horario,
    health remoto e resumo da paridade de tools do endpoint publico.
12. O smoke HTTP local canonico passou antes do Cloudflare:
    - `GET /health` HTTP 200;
    - `tools/list` com 43 tools apos a familia `repo_index_*`, `repo_file_stats` e
      `repo_find_symbol_usages`;
    - paridade exata contra o registry local;
    - `tools/call mcp_runtime_health` sem erro JSON-RPC.
