# tests/fixtures/mcp

**Propósito**: Fixtures e servidores de exemplo para testes do protocolo MCP (Model Context
Protocol).  
**Status**: Canônico.  
**Público**: Desenvolvedores de testes de integração MCP.  
**Última atualização**: 2 de março de 2026.

## O que esta pasta contém

- Implementações mínimas de servidor MCP para uso em testes de integração e unitários.

## Entradas principais

| Arquivo            | Descrição                                        |
| ------------------ | ------------------------------------------------ |
| `stdio-server.mjs` | Servidor MCP via stdio para testes de transporte |

## Regras de manutenção

- Servidores fixture devem ser leves e encerrar limpo ao final dos testes.
- Não expor portas reais em testes — usar stdio ou portas efêmeras.

## Links relacionados

- Fixtures pai: `tests/fixtures/README.md`
- Testes MCP unitários: `tests/unit/mcp/`
- Testes MCP integração: `tests/integration/mcp/`
