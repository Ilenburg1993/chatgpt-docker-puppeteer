# src/integration/mcp

**Propósito**: Adaptadores upstream do Model Context Protocol (MCP) — suporte a HTTP, stdio e SDK.  
**Status**: Especializado.  
**Público**: Mantenedores de integrações MCP e de tooling de IA.  
**Última atualização**: 2 de março de 2026.

## O que esta pasta contém

- `upstream-http.mjs`: adaptador MCP upstream via HTTP.
- `upstream-manager.mjs`: gerenciador de múltiplos upstreams MCP.
- `upstream-stdio-sdk.mjs`: adaptador MCP upstream via stdio com SDK.
- `upstream-stdio.mjs`: adaptador MCP upstream via stdio puro.

## O que não deve ficar aqui

- Handler MCP do servidor → `src/server/handlers/mcp-handler.js`
- Tools MCP de alto nível → `src/integration/tools/mcp-upstream-tools.mjs`

## Entradas principais

| Arquivo | Descrição |
|---|---|
| `upstream-manager.mjs` | Gerencia múltiplos upstreams MCP |
| `upstream-http.mjs` | Adaptador HTTP para servidores MCP |
| `upstream-stdio.mjs` | Adaptador stdio para servidores MCP locais |
| `upstream-stdio-sdk.mjs` | Adaptador stdio com SDK oficial MCP |

## Regras de manutenção

- Novos upstreams MCP devem ser registrados no `upstream-manager.mjs`.

## Links relacionados

- Módulo pai: `src/integration/`
- Handler MCP: `src/server/handlers/mcp-handler.js`
