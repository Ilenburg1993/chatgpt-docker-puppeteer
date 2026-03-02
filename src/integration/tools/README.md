# src/integration/tools

**Propósito**: Ferramentas de integração de alto nível — LSP, MCP upstream, Ollama e RAG, disponíveis para o runtime e agentes.  
**Status**: Especializado.  
**Público**: Agentes e módulos que consomem ferramentas de IA e desenvolvimento.  
**Última atualização**: 2 de março de 2026.

## O que esta pasta contém

- `lsp-tools.mjs`: ferramentas de análise de código via LSP.
- `mcp-upstream-tools.mjs`: ferramentas disponibilizadas via MCP upstream.
- `ollama-tools.mjs`: ferramentas de inferência local via Ollama.
- `rag-tools.mjs`: ferramentas de busca semântica via RAG.

## O que não deve ficar aqui

- Daemons e adaptadores de protocolo → `src/integration/lsp/`, `src/integration/mcp/`
- Gateway central de inferência → `src/inference_gateway/`

## Entradas principais

| Arquivo | Descrição |
|---|---|
| `lsp-tools.mjs` | Ferramentas de análise estática via LSP/tsserver |
| `mcp-upstream-tools.mjs` | Ferramentas expostas por servidores MCP |
| `ollama-tools.mjs` | Ferramentas de inferência local Ollama |
| `rag-tools.mjs` | Ferramentas de busca semântica RAG |

## Regras de manutenção

- Todas as ferramentas devem ser registradas em `src/integration/tool-registry.mjs`.

## Links relacionados

- Módulo pai: `src/integration/`
- Registry: `src/integration/tool-registry.mjs`
