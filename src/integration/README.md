# src/integration

**Propósito**: Integrações com ferramentas e serviços externos — LSP, MCP e ferramentas de IA (RAG, Ollama, LSP tools).  
**Status**: Especializado.  
**Público**: Mantenedores de integrações de tooling de IA e desenvolvimento.  
**Última atualização**: 2 de março de 2026.

## O que esta pasta contém

- Integração com Language Server Protocol (`lsp/`).
- Integração com Model Context Protocol (`mcp/`).
- Ferramentas de IA: LSP tools, MCP upstream tools, Ollama e RAG (`tools/`).
- Classificador de erros e circuit breaker Ollama (`error-classifier.mjs`, `ollama-circuit-breaker.mjs`).
- Registry de ferramentas disponíveis (`tool-registry.mjs`).

## O que não deve ficar aqui

- Gateway de inferência LLM → `src/inference_gateway/`
- Módulos de servidor → `src/server/`

## Entradas principais

| Arquivo/Pasta | Descrição |
|---|---|
| `lsp/` | Daemon do servidor LSP (tsserver) |
| `mcp/` | Adaptadores upstream MCP (HTTP, stdio, SDK) |
| `tools/` | Ferramentas LSP, MCP, Ollama e RAG |
| `tool-registry.mjs` | Registry centralizado de ferramentas disponíveis |
| `error-classifier.mjs` | Classificador de erros de integração |
| `ollama-circuit-breaker.mjs` | Circuit breaker para Ollama |

## Regras de manutenção

- Novas integrações devem ser registradas em `tool-registry.mjs`.
- Use `.mjs` para scripts de integração independentes.

## Links relacionados

- Gateway de inferência: `src/inference_gateway/`
- Skills: `.github/skills/`
