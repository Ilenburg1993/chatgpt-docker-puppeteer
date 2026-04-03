# mcp-servers.js — Auditoria

**Módulo**: `src/copilot/config/` **Arquivo**: `mcp-servers.js` **LOC**: 128 | **Score**: 8.5/10

## Responsabilidade

Mapa canônico de servidores MCP e factory `buildMcpConfig`. Define 4 servidores: `github` (stdio),
`filesystem` (stdio), `memory` (stdio), `github-official` (http).

## ACHADO C12-01 — P5

**Token `GITHUB_TOKEN` interpolado em module init — não captura rotação**

```js
export const MCP_SERVERS = {
  github: {
    env: { GITHUB_TOKEN: process.env['GITHUB_TOKEN'] ?? '' }, // ← frozen at module eval
  },
  'github-official': {
    headers: { Authorization: `Bearer ${process.env['GITHUB_TOKEN'] ?? ''}` }, // ← idem
  },
};
```

Se `dotenv` for carregado APÓS o import deste módulo, ambos os objetos terão `''` como token. O
guard em `buildMcpConfig` detecta `process.env['GITHUB_TOKEN']` em tempo de chamada e emite WARN
(`continue`), prevenindo que o servidor seja registrado com token vazio. A proteção funciona, mas
depende de ordem de inicialização.

**Correção recomendada**: usar getter ou lazy evaluation no buildMcpConfig:

```js
if ((name === 'github' || name === 'github-official') && !process.env['GITHUB_TOKEN']) {
  // já existe — apenas adicionar nota de que MCP_SERVERS.github pode ter token frozen
}
```

## Destaques Positivos

- `buildMcpConfig` valida token em runtime (time-of-call), não apenas no objeto frozen
- GAP-Q01 fix: WARN quando 'memory' está em MCP_SERVERS mas em DEFAULT_EXCLUDED_TOOLS
- UPG-PROP-09 fix: skip de servidor sem GITHUB_TOKEN com log informativo
- `DEFAULT_ENABLED` via CSV de `COPILOT_MCP_SERVERS` — configurável sem rebuild

## 6. Status de Correção

### [FIXED] GAP-CONF-002 — Timeout por instância MCP adicionado

Adicionadas constantes `MCP_STDIO_TIMEOUT_MS` (default 30s) e `MCP_HTTP_TIMEOUT_MS` (default 15s),
configuráveis via `COPILOT_MCP_STDIO_TIMEOUT_MS` e `COPILOT_MCP_HTTP_TIMEOUT_MS`. Cada servidor em
`MCP_SERVERS` agora inclui o campo `timeout` mapeado ao tipo `MCPServerConfigBase.timeout` suportado
pelo SDK. Typedef `McpServerConfig` atualizado com `@property {number} [timeout]`.

**Pontuação atualizada: 9.0/10**

---

_Gerado automaticamente pelo COPILOT-FULL-AUDIT MF-II._
