# tools/mcp

**Propósito**: Servidor MCP (Model Context Protocol) unificado para uso em desenvolvimento e testes locais.  
**Status**: Canônico de apoio.  
**Público**: Desenvolvedores de integração MCP.  
**Última atualização**: 2 de março de 2026.

## Entradas principais

| Arquivo | Descrição |
|---|---|
| `unified-server.mjs` | Servidor MCP unificado que agrega múltiplos transportes (stdio, HTTP) |

## Regras de manutenção

- Usar para desenvolvimento local — não para produção.
- Configurar via variáveis de ambiente (ver `scripts/env/`).

## Links relacionados

- Ferramentas pai: `tools/README.md`
- Testes MCP: `tests/integration/mcp/`
- Exemplos de config: `docs/integration/examples/`
