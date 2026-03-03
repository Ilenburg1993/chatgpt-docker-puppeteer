# src/server/handlers

**Propósito**: Handlers de protocolos externos — MCP (Model Context Protocol) e compatibilidade
OpenAI.  
**Status**: Especializado.  
**Público**: Mantenedores de integrações com ferramentas externas e clientes OpenAI-compatíveis.  
**Última atualização**: 2 de março de 2026.

## O que esta pasta contém

- `mcp-handler.js`: handler para requisições do protocolo MCP.
- `openai-handler.js`: handler de compatibilidade com API OpenAI.
- `openai-transformer.js`: transformador de requests/responses para formato OpenAI.

## O que não deve ficar aqui

- Adaptadores MCP upstream → `src/integration/mcp/`
- Controllers REST genéricos → `src/server/api/controllers/`

## Entradas principais

| Arquivo                 | Descrição                                 |
| ----------------------- | ----------------------------------------- |
| `mcp-handler.js`        | Handler de protocolo MCP no servidor      |
| `openai-handler.js`     | Handler de compatibilidade com API OpenAI |
| `openai-transformer.js` | Transformação de formato OpenAI ↔ sistema |

## Regras de manutenção

- Handlers devem ser stateless e delegar processamento para `src/inference_gateway/`.

## Links relacionados

- Módulo pai: `src/server/`
- Gateway de inferência: `src/inference_gateway/`
- Integração MCP: `src/integration/mcp/`
