# docs/integration/examples

**Propósito**: Exemplos prontos de configuração de clientes que consomem o servidor MCP deste
projeto.  
**Status**: Canônico de apoio.  
**Público**: Desenvolvedores configurando Claude Desktop, VS Code, OpenCode ou GitHub MCP.  
**Última atualização**: 2 de março de 2026.

## Entradas principais

| Arquivo                                  | Descrição                                           |
| ---------------------------------------- | --------------------------------------------------- |
| `claude_desktop_config.json`             | Config do Claude Desktop para conectar ao MCP local |
| `claude_desktop_config_with_github.json` | Config Claude Desktop com GitHub MCP integrado      |
| `opencode_config.json`                   | Config do OpenCode para usar o MCP                  |
| `vscode_settings_copilot.json`           | Settings VS Code para Copilot com MCP               |
| `test_github_mcp_integration.sh`         | Script de teste de integração GitHub MCP            |
| `test_mcp_endpoint.sh`                   | Script de teste do endpoint MCP                     |

## Regras de manutenção

- Atualizar exemplos quando o servidor MCP mudar de porta ou protocolo.
- Nunca incluir tokens reais ou credenciais nos exemplos.

## Links relacionados

- Integração pai: `docs/integration/README.md`
- Servidor MCP: `tools/mcp/`
