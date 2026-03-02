# tests/integration/mcp

**Propósito**: Testes de integração do cliente MCP (Model Context Protocol) para transporte HTTP e stdio.  
**Status**: Canônico.  
**Público**: Desenvolvedores de integração MCP.  
**Última atualização**: 2 de março de 2026.

## Entradas principais

| Arquivo | Descrição |
|---|---|
| `test_upstream_http_import.spec.js` | Importação e conexão de servidor MCP via HTTP |
| `test_upstream_stdio_import.spec.js` | Importação e conexão de servidor MCP via stdio |

## Regras de manutenção

- Usar o servidor fixture de `tests/fixtures/mcp/stdio-server.mjs`.

## Links relacionados

- Testes de integração: `tests/integration/README.md`
- Testes unitários MCP: `tests/unit/mcp/`
- Fixture MCP: `tests/fixtures/mcp/`
