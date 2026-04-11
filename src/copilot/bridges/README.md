# bridges/

**Camada**: L3 — conecta o copilot ao mundo externo (NERV, MCP, Git/GitHub).

Cada bridge é um adaptador bidirecional entre o sistema copilot e uma infraestrutura externa.

## Subdomínios

| Bridge | Arquivos | Escopo |
|---|---|---|
| NERV | `nerv-bridge.js` | Event bus pub/sub com o sistema central |
| MCP | `mcp-tool-bridge.js`, `mcp-tool-schema.js` | Tools via Model Context Protocol |
| Git | `git-bridge.js` | Operações git (commit, push, diff) |
| GitHub | `gh/` | Issues, PRs, CI via `gh` CLI |

## Regras de importação

- **Pode importar**: `core/`, `config/`, `observability/`, `sdk/`, `node:*`
- **NÃO pode importar**: `agent/` (usa DI via `registerNervBridgeAgent`)
