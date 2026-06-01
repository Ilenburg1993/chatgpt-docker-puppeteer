# MCP HTTP/2 Origin Certificate Canary — 2026-05-31

## Objetivo

Habilitar um canary local HTTPS/HTTP2 para o origin MCP atrás do Cloudflare Tunnel sem commitar material secreto no repositório.

## Arquivos locais esperados

O adapter `src/copilot/mcp/adapters/http2.js` procura, por padrão:

- `src/copilot/.ai/cloudflare/origin-cert.pem`
- `src/copilot/.ai/cloudflare/origin-key.pem`

Esses arquivos são material sensível de runtime. Não devem ser versionados.

## Certificado Cloudflare Origin CA

O certificado emitido para este workspace cobre:

- `*.aurelin.org`
- `aurelin.org`

Por isso o origin local pode escutar em `https://127.0.0.1:3333`, mas o SNI/certificate server name usado pelo `cloudflared` deve ser um hostname coberto pelo certificado, por padrão:

- `mcp.aurelin.org`

## Variáveis do canary

```bash
export COPILOT_MCP_CLOUDFLARE_ORIGIN_URL=https://127.0.0.1:3333
export COPILOT_MCP_CLOUDFLARE_ORIGIN_SERVER_NAME=mcp.aurelin.org
export COPILOT_MCP_CLOUDFLARE_HTTP2_ORIGIN=true
export COPILOT_MCP_ORIGIN_TRANSPORT=http2
```

## Smoke local do origin HTTP/2

1. Salvar o certificado e a chave nos arquivos locais esperados.
2. Iniciar o servidor origin:

```bash
npm run copilot:mcp:http2
```

3. Em outro terminal, consultar `/health` usando o SNI correto. Para teste local direto com IP loopback e certificado Cloudflare Origin CA, use uma ferramenta que permita resolver o hostname para localhost:

```bash
curl --resolve mcp.aurelin.org:3333:127.0.0.1 https://mcp.aurelin.org:3333/health
```

O retorno esperado deve incluir `http.protocol` e headers de telemetria de origin quando acessado pelos smokes HTTP do projeto.

## Cloudflare Tunnel canary

Com os arquivos locais já salvos e as variáveis acima exportadas:

```bash
npm run copilot:mcp:cloudflare:restart
npm run copilot:mcp:cloudflare:remote-audit
npm run copilot:mcp:cloudflare:smoke
```

Critérios para manter o rollout:

- remote audit sem criticals;
- `originRequest.http2Origin=true` apenas quando `COPILOT_MCP_CLOUDFLARE_HTTP2_ORIGIN=true` e origin HTTPS;
- smoke público do ChatGPT connector OK;
- latência p50/p95 não piora contra baseline HTTP/1;
- nenhum erro novo de OAuth, CORS ou MCP initialize.

## Rollback

```bash
export COPILOT_MCP_CLOUDFLARE_ORIGIN_URL=http://127.0.0.1:3333
export COPILOT_MCP_CLOUDFLARE_HTTP2_ORIGIN=false
export COPILOT_MCP_ORIGIN_TRANSPORT=http
npm run copilot:mcp:cloudflare:restart
```

O modo HTTP/1 continua sendo o padrão seguro quando nenhuma variável de canary está ativa.
