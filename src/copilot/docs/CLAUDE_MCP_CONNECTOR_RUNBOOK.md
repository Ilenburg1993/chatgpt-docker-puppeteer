# Claude Custom Connector — Repo DevContainer MCP

Data: 2026-05-24

## Objetivo

Conectar `https://claude.ai/` ao mesmo MCP remoto usado pelo ChatGPT, mantendo:

1. endpoint publico permanente via Cloudflare;
2. OAuth como padrao;
3. fallback temporario Cloudflare apenas como emergencia;
4. LLM-B local independente do MCP;
5. engine compartilhada de IO, busca, indice, Git e validadores.

## Campos na caixa da Claude

Use estes valores em `Claude > Customize > Connectors > Add custom connector`:

| Campo                 | Valor                         |
| --------------------- | ----------------------------- |
| Name                  | `Repo DevContainer MCP`       |
| Remote MCP server URL | `https://mcp.aurelin.org/mcp` |
| OAuth Client ID       | deixar vazio                  |
| OAuth Client Secret   | deixar vazio                  |

Os campos OAuth avancados ficam vazios porque o issuer dev embutido publica Dynamic Client
Registration e Client ID Metadata Document para clientes publicos.

## Preflight local

Antes de adicionar ou reconectar na Claude:

```bash
make copilot-mcp-restart
make copilot-mcp-remote-audit
make copilot-mcp-oauth-smoke
make copilot-mcp-smoke-refresh
make copilot-mcp-status
```

O resultado esperado:

1. `remote-audit.ok=true`;
2. Cloudflare remoto com `mcp.aurelin.org -> http://127.0.0.1:3333`;
3. DNS CNAME apontando para o tunnel `workspace-mcp-dev`, quando `CLOUDFLARE_ZONE_ID` permitir
   auditoria DNS;
4. OAuth smoke com DCR, CIMD, refresh token e chamada bearer passando;
5. tools/list remoto com todas as tools locais.

## Metadata OAuth

O servidor expõe metadata para os dois estilos de cliente MCP:

1. Raiz:
   - `https://mcp.aurelin.org/.well-known/oauth-protected-resource`
2. Path-specific para `/mcp`:
   - `https://mcp.aurelin.org/.well-known/oauth-protected-resource/mcp`

O authorization server continua em:

```text
https://mcp.aurelin.org
```

Audiences aceitas pelo resource server:

1. `https://mcp.aurelin.org`
2. `https://mcp.aurelin.org/mcp`

## Smoke prompts na Claude

Depois de conectar:

```text
Use o conector Repo DevContainer MCP e chame repo_status.
```

```text
Chame mcp_session_profile e resuma recommendedFirstCalls.
```

```text
Chame mcp_cloudflare_remote_audit e confirme que o origin remoto e http://127.0.0.1:3333.
```

```text
Chame mcp_oauth_friction_audit e confirme refresh token persistence.
```

```text
Liste src/copilot/mcp com repo_tree maxDepth=2.
```

## Diagnostico

Se a Claude nao conectar:

1. rode `make copilot-mcp-remote-audit`;
2. confirme que o tunnel esta `healthy`;
3. confirme que o serviço remoto nao voltou para `localhost`;
4. rode `make copilot-mcp-oauth-smoke`;
5. teste manualmente:

```bash
curl -i https://mcp.aurelin.org/health
curl -i https://mcp.aurelin.org/.well-known/oauth-protected-resource/mcp
curl -i https://mcp.aurelin.org/.well-known/oauth-authorization-server
```

Se a Claude pedir Client ID/Secret obrigatorios em alguma mudanca futura da UI, usar DCR primeiro.
Se ela exigir um cliente estatico, criar um client publico dedicado e registrar o redirect URI
informado pela Claude.
