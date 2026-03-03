# tools/ollama

**Propósito**: Cliente Ollama auxiliar para uso em scripts de tooling — não é o cliente de runtime
(que fica em `src/`).  
**Status**: Canônico de apoio.  
**Público**: Desenvolvedores de ferramentas RAG e auditoria.  
**Última atualização**: 2 de março de 2026.

## Entradas principais

| Arquivo      | Descrição                                                 |
| ------------ | --------------------------------------------------------- |
| `client.mjs` | Cliente HTTP para API Ollama (generate, embeddings, tags) |

## Regras de manutenção

- Este cliente é para uso em ferramentas (`tools/`, `scripts/`) — não importar em `src/`.
- O cliente de runtime oficial fica em `src/core/`.

## Links relacionados

- Ferramentas pai: `tools/README.md`
- RAG embeddings: `tools/rag/lib/embeddings/`
