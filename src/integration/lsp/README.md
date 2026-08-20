# src/integration/lsp

**Propósito**: compatibilidade opt-in das ferramentas MCP com o LSP nativo do TypeScript 7.
**Status**: preservado, desligado por padrão.
**Público**: Mantenedores de integrações de tooling de desenvolvimento e auditoria de código.
**Última atualização**: 19 de agosto de 2026.

## O que esta pasta contém

- `tsgo-lsp-daemon.mjs`: cliente JSON-RPC do `tsc --lsp --stdio` nativo.
- `tsserver-daemon.mjs`: alias temporário para consumidores com o nome histórico.
- `tsserver-process-daemon.mjs` e `tsserver-worker.mjs`: isolamento e reciclagem do heap.

## O que não deve ficar aqui

- Ferramentas LSP de alto nível → `src/integration/tools/lsp-tools.mjs`
- Integração MCP → `src/integration/mcp/`

## Entradas principais

| Arquivo | Descrição |
| --- | --- |
| `tsgo-lsp-daemon.mjs` | Implementação canônica preservada do cliente LSP TS7 |
| `tsserver-daemon.mjs` | Alias de compatibilidade de nomes |

## Regras de manutenção

- `LSP_ENABLED=false` e `LSP_MUTATIONS_ENABLED=false` são os defaults obrigatórios.
- O editor usa diretamente o LSP/TSServer 7; este daemon não participa do fluxo normal.
- Para um teste explícito, habilite `LSP_ENABLED=true` apenas no processo isolado e execute
  `npm run lsp:health`.

## Links relacionados

- Módulo pai: `src/integration/`
- Ferramentas LSP: `src/integration/tools/lsp-tools.mjs`
