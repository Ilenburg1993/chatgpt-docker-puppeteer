# src/integration/lsp

**Propósito**: Daemon do servidor LSP (tsserver) para integração de inteligência de código no runtime.  
**Status**: Especializado.  
**Público**: Mantenedores de integrações de tooling de desenvolvimento e auditoria de código.  
**Última atualização**: 2 de março de 2026.

## O que esta pasta contém

- `tsserver-daemon.mjs`: daemon que gerencia o processo tsserver para análise de código.

## O que não deve ficar aqui

- Ferramentas LSP de alto nível → `src/integration/tools/lsp-tools.mjs`
- Integração MCP → `src/integration/mcp/`

## Entradas principais

| Arquivo | Descrição |
|---|---|
| `tsserver-daemon.mjs` | Gerencia o processo tsserver como daemon LSP |

## Regras de manutenção

- Verifique a saúde do LSP com `npm run lsp:health` antes de depender dele.

## Links relacionados

- Módulo pai: `src/integration/`
- Ferramentas LSP: `src/integration/tools/lsp-tools.mjs`
