# Investigação de compatibilidade Claude × MCP/OAuth/Cloudflare/stdio

Data: 2026-06-11 Escopo: compatibilidade do MCP deste workspace com Claude custom connectors
remotos, OAuth, Cloudflare Tunnel permanente e conexões locais por stdio/stdin.

## 0. Atualização pós-teste real no Claude

Após o teste real na UI do Claude, apareceu `{"error":"invalid_request"}` no navegador. O log local
identificou a causa concreta como rejeição de autorização por `unknown_client`: o Claude hospedado
usa CIMD com `client_id` em `https://claude.ai/oauth/mcp-oauth-client-metadata` e callback
`https://claude.ai/api/mcp/auth_callback`. O issuer dev agora tem fallback/fast-path estrito para
esse par estável do Claude, além do fallback já existente para ChatGPT.

Esse fix fica em:

```text
src/copilot/mcp/control-plane/dev-oauth.js
```

Depois de aplicar esse fix é obrigatório reiniciar o MCP antes de tentar conectar no Claude
novamente.

## 1. Sumário executivo

O servidor MCP do workspace está **compatível com Claude custom connectors remotos** no desenho
atual:

```text
Claude cloud -> HTTPS público -> Cloudflare Tunnel -> origin MCP local -> /mcp
```

Endpoint canônico:

```text
https://mcp.aurelin.org/mcp
```

A conexão remota atende aos pontos principais exigidos pelo Claude:

- endpoint público e HTTPS;
- transporte MCP remoto por Streamable HTTP;
- OAuth com Protected Resource Metadata;
- resposta 401 com `WWW-Authenticate` e `resource_metadata`;
- authorization server metadata;
- Dynamic Client Registration / Client ID Metadata Document para cliente público;
- PKCE S256;
- refresh tokens;
- audiences aceitas para resource raiz e `/mcp`;
- Cloudflare Tunnel permanente saudável;
- origem MCP com health público 200;
- ferramenta local stdio disponível para Claude Desktop/local MCP.

Foi aplicado um upgrade de neutralidade multi-host:

```text
src/copilot/mcp/control-plane/auth.js
DEFAULT_RESOURCE_DOCUMENTATION:
  antes: https://developers.openai.com/apps-sdk/build/auth
  agora: https://mcp.aurelin.org/oauth/status
```

Motivo: o endpoint é usado por Claude e ChatGPT; a metadata OAuth do resource não deve apontar por
default para documentação específica da OpenAI.

## 2. Fontes oficiais consultadas

Documentação Anthropic/Claude:

- https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp
- https://support.claude.com/en/articles/11176164-use-connectors-to-extend-claude-s-capabilities
- https://claude.com/docs/connectors/building
- https://claude.com/docs/connectors/building/authentication
- https://claude.com/docs/connectors/building/mcp

Documentação MCP:

- https://modelcontextprotocol.io/specification/2025-06-18/basic/transports
- https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization
- https://modelcontextprotocol.io/docs/develop/connect-local-servers
- https://modelcontextprotocol.io/docs/tools/debugging
- https://modelcontextprotocol.io/docs/tools/inspector

Documentação Cloudflare:

- https://developers.cloudflare.com/agents/model-context-protocol/
- https://developers.cloudflare.com/agents/model-context-protocol/guides/remote-mcp-server/

Arquivos locais relevantes:

- `src/copilot/mcp/README.md`
- `src/copilot/docs/CLAUDE_MCP_CONNECTOR_RUNBOOK.md`
- `src/copilot/mcp/cli.js`
- `src/copilot/mcp/adapters/stdio.js`
- `src/copilot/mcp/server.js`
- `src/copilot/mcp/control-plane/auth.js`
- `src/copilot/mcp/tool-surface.js`
- `package.json`

## 3. Campos exatos para o conector remoto do Claude

Na janela mostrada na imagem enviada, use literalmente:

```text
Nome:
Repo DevContainer MCP

URL do servidor MCP remoto:
https://mcp.aurelin.org/mcp

ID do Cliente OAuth (opcional):
[deixar em branco]

Client Secret OAuth (opcional):
[deixar em branco]
```

Tabela equivalente:

| Campo na UI do Claude          | Valor exato                   |
| ------------------------------ | ----------------------------- |
| Nome                           | `Repo DevContainer MCP`       |
| URL do servidor MCP remoto     | `https://mcp.aurelin.org/mcp` |
| ID do Cliente OAuth (opcional) | deixar vazio                  |
| Client Secret OAuth (opcional) | deixar vazio                  |

### Por que deixar Client ID/Secret vazios?

O servidor publica metadata OAuth e suporta o fluxo de cliente público com registro/metadata
dinâmicos. O Claude consegue descobrir o authorization server e concluir o fluxo sem você colar um
client secreto manual.

Use Client ID/Secret apenas se, no futuro, você migrar para um authorization server de produção que
exija cliente confidencial estático. Esse não é o modo atual.

## 4. Resultado dos checks locais do servidor atual

Readiness atual após refresh de smoke:

```text
connectorUrl: https://mcp.aurelin.org/mcp
ready: true
mode: named-permanent
localHealth.status: 200
publicHealth.status: 200
mcpHttp.alive: true
cloudflared.alive: true
connectorSmoke.fresh: true
```

Smoke remoto do conector:

```text
protocolVersion: 2025-06-18
authMode: oauth
health.status: 200
protectedResource.status: 200
authorizationServer.status: 200
unauthenticated tools/list: 401 esperado
WWW-Authenticate presente: sim
```

OAuth/friction audit:

```text
mode: oauth
enforcement: all
resource: https://mcp.aurelin.org
expectedIssuer: https://mcp.aurelin.org
acceptedAudiences:
  - https://mcp.aurelin.org
  - https://mcp.aurelin.org/
  - https://mcp.aurelin.org/mcp
  - https://mcp.aurelin.org/mcp/
PKCE S256 advertised: true
CIMD supported: true
token endpoint auth methods:
  - none
  - private_key_jwt
refresh token rotation: one-time-rotating-persistent
refresh token persistence: enabled, hashes only
```

Conclusão: o endpoint está operacionalmente pronto para cadastro no Claude como conector remoto.

## 5. Compatibilidade com requisitos Claude

### 5.1 Endpoint público

Claude custom connectors remotos são acessados a partir da infraestrutura Anthropic, não do
computador local do usuário. Portanto, o endpoint precisa ser acessível pela internet pública.

Nosso endpoint cumpre isso via Cloudflare Tunnel permanente:

```text
https://mcp.aurelin.org/mcp
```

### 5.2 Transporte MCP remoto

Claude suporta Streamable HTTP e ainda aceita HTTP+SSE legado. O transporte remoto moderno
recomendado é Streamable HTTP.

Nosso smoke mostra `protocolVersion: 2025-06-18`, e o endpoint `/mcp` responde como MCP remoto
autenticado, com tools/list protegido por OAuth.

### 5.3 OAuth

Claude exige descoberta OAuth correta para conectores autenticados:

- Protected Resource Metadata;
- Authorization Server Metadata;
- 401 com `WWW-Authenticate` apontando para metadata do resource;
- PKCE S256;
- DCR ou CIMD quando não houver client estático;
- refresh token funcional quando aplicável.

Nosso servidor atende:

```text
Protected Resource Metadata raiz:
https://mcp.aurelin.org/.well-known/oauth-protected-resource

Protected Resource Metadata path-specific:
https://mcp.aurelin.org/.well-known/oauth-protected-resource/mcp

Authorization Server:
https://mcp.aurelin.org

JWKS:
https://mcp.aurelin.org/oauth/jwks.json
```

A metadata path-specific é importante porque a URL que você cola no Claude inclui `/mcp`. A
documentação de autenticação do Claude enfatiza que o `resource` da Protected Resource Metadata deve
bater com a URL exata usada pelo cliente, incluindo path.

### 5.4 Callback OAuth do Claude

Para conectores hospedados no Claude, o callback esperado é:

```text
https://claude.ai/api/mcp/auth_callback
```

O nosso fluxo atual usa metadata dinâmica e cliente público; se algum dia for necessário criar
cliente estático dedicado para Claude, esse callback deve ser incluído na allowlist de redirect
URIs.

### 5.5 Tamanho de resultados

Claude documenta limite de resultado de tool em torno de 150.000 caracteres para Claude.ai/Desktop.
Nosso registry MCP tem limite default maior:

```text
COPILOT_MCP_REGISTRY_MAX_TOOL_RESULT_BYTES default: 2 MiB
```

Isso **não bloqueia a conexão**, mas é uma diferença operacional. Para um serviço dedicado a Claude,
considere:

```bash
COPILOT_MCP_REGISTRY_MAX_TOOL_RESULT_BYTES=140000
```

Não recomendo alterar o serviço compartilhado ChatGPT+Claude sem testar, porque isso pode tornar
mais agressivas rejeições de resultados que hoje funcionam bem no ChatGPT. Para Claude, prefira
também chamadas com janela:

```text
repo_read_file startLine/endLine
repo_read_file_chunks chunkLines
repo_search_text maxResults
repo_tree depth/maxEntries
```

### 5.6 Tool surface

O repo já tem modo de superfície para Claude:

```bash
COPILOT_MCP_TOOL_SURFACE=claude
```

Esse modo reduz a superfície para ferramentas read/research/safe úteis. Para o endpoint remoto
compartilhado, o modo atual pode permanecer `full` se você quer liberdade máxima. Para uma instância
dedicada ao Claude, eu recomendaria testar:

```bash
COPILOT_MCP_TOOL_SURFACE=claude
```

ou, se quiser apenas leitura/validação:

```bash
COPILOT_MCP_TOOL_SURFACE=research
```

## 6. Cloudflare: compatibilidade e postura operacional

Estado atual relevante:

```text
Public URL: https://mcp.aurelin.org/mcp
Mode: named-permanent
Tunnel transport: quic
Origin transport: http2
Origin URL: https://127.0.0.1:3333
Origin server name: mcp.aurelin.org
Auth mode: oauth
Auth enforcement: all
```

Pontos importantes:

1. Claude precisa alcançar o endpoint público; Cloudflare Tunnel cumpre isso.
2. `/mcp` não deve ser cacheado na edge.
3. Rotas OAuth `/.well-known/*`, `/oauth/*` e `/mcp` não devem sofrer transform rules que alterem
   headers críticos.
4. O serviço remoto do tunnel deve continuar sincronizado com o origin local configurado.
5. Se houver firewall/allowlist adicional, considere permitir tráfego outbound da Anthropic conforme
   a documentação oficial.

Preflight recomendado antes de conectar/reconectar no Claude:

```bash
make copilot-mcp-restart
make copilot-mcp-smoke-refresh
make copilot-mcp-status
npm run copilot:mcp:cloudflare:remote-audit
npm run copilot:mcp:cloudflare:oauth-smoke
```

Se quiser validar o modo HTTP/2 origin especificamente:

```bash
npm run copilot:mcp:cloudflare:h2-remote-audit
npm run copilot:mcp:quic:status
```

## 7. Passo a passo no Claude remoto

1. Abra Claude.
2. Vá em configurações/customização/conectores.
3. Clique em adicionar conector personalizado.
4. Preencha:

```text
Nome: Repo DevContainer MCP
URL do servidor MCP remoto: https://mcp.aurelin.org/mcp
ID do Cliente OAuth: deixar vazio
Client Secret OAuth: deixar vazio
```

5. Clique em adicionar.
6. Conclua o fluxo OAuth quando Claude abrir a autorização.
7. Em uma conversa, habilite o conector pelo menu de conectores/anexos.
8. Teste com os prompts abaixo.

## 8. Smoke prompts para Claude remoto

Use estes prompts no Claude após conectar:

```text
Use o conector Repo DevContainer MCP e chame repo_status.
```

```text
Chame mcp_session_profile e resuma recommendedFirstCalls.
```

```text
Chame mcp_oauth_friction_audit e confirme se pkceS256Advertised e cimidSupported estão true.
```

```text
Chame repo_tree com path="src/copilot/mcp" e depth=2.
```

```text
Chame repo_file_outline em src/copilot/mcp/cli.js e resuma os símbolos principais.
```

```text
Chame mcp_runtime_health e verifique metrics.repoReadFileCache, metrics.ioCache.lineOffsets e metrics.ioParser.fileContext.
```

## 9. Conexão local via stdio/stdin

### 9.1 O que é diferente no modo local

O modo local não usa o conector remoto do Claude web. Ele é para clientes locais compatíveis com MCP
stdio, principalmente Claude Desktop ou Claude Code, conforme disponibilidade do cliente.

No transporte stdio:

```text
Claude local client -> inicia subprocesso node -> stdin/stdout JSON-RPC -> MCP server
```

O MCP spec exige que:

- o servidor leia mensagens MCP de `stdin`;
- o servidor escreva mensagens MCP em `stdout`;
- logs usem `stderr`, nunca `stdout`;
- cada mensagem JSON-RPC seja delimitada por newline.

Nosso CLI já foi desenhado para isso:

```text
node src/copilot/mcp/cli.js --transport stdio
```

Ele redireciona ruído de bootstrap de stdout para stderr antes de iniciar o transporte stdio.

### 9.2 Importante: auth em stdio

A especificação MCP recomenda que stdio **não** use o mesmo fluxo HTTP OAuth. Em vez disso,
credenciais locais devem vir do ambiente quando necessárias.

Para uso local com Claude Desktop, a configuração mais simples e funcional é desativar OAuth HTTP no
subprocesso local:

```text
COPILOT_MCP_AUTH_MODE=none-dev
COPILOT_MCP_AUTH_ENFORCEMENT=off
```

Isso vale apenas para uso local confiável. Não use `none-dev` no endpoint remoto público.

### 9.3 Config Claude Desktop — macOS/Linux/devcontainer

Arquivo de configuração no macOS:

```text
~/Library/Application Support/Claude/claude_desktop_config.json
```

Exemplo para este workspace no DevContainer:

```json
{
  "mcpServers": {
    "repo-devcontainer-mcp-local": {
      "command": "node",
      "args": [
        "/workspaces/chatgpt-docker-puppeteer/src/copilot/mcp/cli.js",
        "--transport",
        "stdio"
      ],
      "env": {
        "COPILOT_MCP_AUTH_MODE": "none-dev",
        "COPILOT_MCP_AUTH_ENFORCEMENT": "off",
        "COPILOT_MCP_TOOL_SURFACE": "claude",
        "COPILOT_MCP_SERVER_NAME": "repo-devcontainer-mcp-local",
        "COPILOT_MCP_SERVER_TITLE": "Repo DevContainer MCP Local"
      }
    }
  }
}
```

Se o Claude Desktop local estiver fora do container, ele precisa conseguir executar `node` e acessar
o path real do projeto. Nesse caso, substitua o path `/workspaces/...` pelo path absoluto no host.

### 9.4 Config Claude Desktop — Windows

Arquivo de configuração no Windows:

```text
%APPDATA%\Claude\claude_desktop_config.json
```

Exemplo:

```json
{
  "mcpServers": {
    "repo-devcontainer-mcp-local": {
      "command": "C:\\Program Files\\nodejs\\node.exe",
      "args": [
        "C:\\path\\to\\chatgpt-docker-puppeteer\\src\\copilot\\mcp\\cli.js",
        "--transport",
        "stdio"
      ],
      "env": {
        "COPILOT_MCP_AUTH_MODE": "none-dev",
        "COPILOT_MCP_AUTH_ENFORCEMENT": "off",
        "COPILOT_MCP_TOOL_SURFACE": "claude",
        "COPILOT_MCP_SERVER_NAME": "repo-devcontainer-mcp-local",
        "COPILOT_MCP_SERVER_TITLE": "Repo DevContainer MCP Local"
      }
    }
  }
}
```

### 9.5 Alternativa local com proxy remoto `mcp-remote`

Se o cliente local suportar stdio mas não suportar bem OAuth remoto, pode-se usar proxy local para o
endpoint remoto:

```json
{
  "mcpServers": {
    "repo-remote-via-mcp-remote": {
      "command": "npx",
      "args": [
        "-y",
        "mcp-remote",
        "https://mcp.aurelin.org/mcp"
      ]
    }
  }
}
```

Esse modo depende do pacote externo `mcp-remote`, recomendado em guias Cloudflare/MCP para clientes
locais que precisam falar com servidor remoto autenticado. Para Claude web, prefira o conector
remoto nativo.

### 9.6 Smoke local stdio

Teste manual no terminal:

```bash
COPILOT_MCP_AUTH_MODE=none-dev \
COPILOT_MCP_AUTH_ENFORCEMENT=off \
COPILOT_MCP_TOOL_SURFACE=claude \
node src/copilot/mcp/cli.js --transport stdio
```

O processo deve ficar aguardando mensagens JSON-RPC. Não espere output humano em stdout.

Para depurar de forma visual, use o MCP Inspector:

```bash
npx @modelcontextprotocol/inspector node src/copilot/mcp/cli.js --transport stdio
```

## 10. Troubleshooting remoto Claude

### Claude diz que não consegue conectar

Checklist:

```bash
make copilot-mcp-smoke-refresh
make copilot-mcp-status
curl -i https://mcp.aurelin.org/health
curl -i https://mcp.aurelin.org/.well-known/oauth-protected-resource/mcp
curl -i https://mcp.aurelin.org/.well-known/oauth-authorization-server
```

Verifique:

- health público 200;
- metadata OAuth 200;
- `/mcp` sem bearer retorna 401 com `WWW-Authenticate`;
- Cloudflare Tunnel vivo;
- nenhuma regra de cache/WAF removendo headers OAuth.

### OAuth falha depois de abrir autorização

Verifique:

- callback do Claude permitido, se usar client estático;
- PKCE S256 anunciado;
- token endpoint aceitando `application/x-www-form-urlencoded`;
- DCR/CIMD public client ativo;
- `resource` exato da metadata para `/mcp`;
- issuer/audience coerentes.

### Tools aparecem mas chamadas falham por tamanho

Use janelas e chunks:

```text
repo_read_file startLine=1 endLine=200
repo_read_file_chunks chunkLines=100
repo_tree depth=2 maxEntries=200
repo_search_text maxResults=50
```

Para serviço Claude dedicado, testar:

```bash
COPILOT_MCP_REGISTRY_MAX_TOOL_RESULT_BYTES=140000
```

### Permissões/approvals no Claude

Claude pode pedir aprovação de tools. A documentação alerta para riscos de prompt injection em
conectores. Mantenha:

- tools com descrições claras;
- tool surface reduzida quando possível;
- revisão antes de operações de escrita;
- `repo_patch_plan`/dry-run antes de apply;
- evitar `Allow always` para ações destrutivas.

## 11. Troubleshooting local stdio

Se o servidor local não aparecer no Claude Desktop:

1. confirme o path absoluto do `node`;
2. confirme o path absoluto de `cli.js`;
3. reinicie o Claude Desktop;
4. veja logs:

macOS:

```text
~/Library/Logs/Claude
```

Windows:

```text
%APPDATA%\Claude\logs
```

5. rode manualmente o comando do config;
6. garanta que nenhum `console.log`/stdout humano seja emitido pelo bootstrap.

Nosso `cli.js` já mitiga o risco de stdout sujo redirecionando bootstrap stdout para stderr no modo
stdio.

## 12. Upgrades recomendados futuros

### U1 — Serviço dedicado Claude

Se Claude passar a ser usado intensivamente, considere uma instância dedicada com:

```bash
COPILOT_MCP_TOOL_SURFACE=claude
COPILOT_MCP_REGISTRY_MAX_TOOL_RESULT_BYTES=140000
COPILOT_MCP_SERVER_TITLE="Repo DevContainer MCP for Claude"
```

Isso reduz tools/list, reduz risco de resultado grande e aproxima o comportamento dos limites do
Claude.

### U2 — OAuth de produção

O issuer dev embutido é bom para ambiente controlado. Para uso multiusuário real:

- usar issuer externo de produção;
- preferir CIMD com `private_key_jwt` quando possível;
- separar client Claude, ChatGPT e ferramentas internas;
- revisar escopos por cliente;
- rotacionar chaves e armazenar secrets fora do repo.

### U3 — Auditoria Cloudflare para Claude

Adicionar check explícito de compatibilidade Claude no smoke:

- endpoint público acessível;
- PRM path-specific `resource == https://mcp.aurelin.org/mcp`;
- DCR/CIMD anunciado;
- PKCE S256;
- `WWW-Authenticate` com resource metadata;
- size policy opcional <= 150k para perfil Claude.

### U4 — Perfil local seguro

Criar script dedicado:

```bash
npm run copilot:mcp:stdio:claude
```

com env local seguro:

```bash
COPILOT_MCP_AUTH_MODE=none-dev
COPILOT_MCP_AUTH_ENFORCEMENT=off
COPILOT_MCP_TOOL_SURFACE=claude
```

Isso evitaria copiar manualmente flags/env no `claude_desktop_config.json`.

## 13. Conclusão

Para Claude remoto, os campos exatos são:

```text
Nome: Repo DevContainer MCP
URL do servidor MCP remoto: https://mcp.aurelin.org/mcp
ID do Cliente OAuth: deixar vazio
Client Secret OAuth: deixar vazio
```

Para Claude local via stdio, o comando canônico é:

```bash
node /workspaces/chatgpt-docker-puppeteer/src/copilot/mcp/cli.js --transport stdio
```

com env local:

```bash
COPILOT_MCP_AUTH_MODE=none-dev
COPILOT_MCP_AUTH_ENFORCEMENT=off
COPILOT_MCP_TOOL_SURFACE=claude
```

A compatibilidade geral é boa. O único upgrade aplicado nesta rodada foi tornar a metadata OAuth
neutra e própria do nosso resource, substituindo o default de documentação OpenAI por
`https://mcp.aurelin.org/oauth/status`. O próximo passo operacional é restartar o MCP para carregar
essa alteração e então adicionar/reconectar o conector no Claude.
