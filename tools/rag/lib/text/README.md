# tools/rag/lib/text

**Propósito**: Normalização e pré-processamento de queries de texto para busca semântica RAG.  
**Status**: Canônico.  
**Público**: Desenvolvedores do sistema RAG.  
**Última atualização**: 2 de março de 2026.

## Entradas principais

| Arquivo                | Descrição                                                                                                             |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `query_normalizer.mjs` | Normaliza queries (lowercase, colapso de espaços, remoção de caracteres especiais) e expande com sinônimos semânticos |

## Links relacionados

- RAG lib: `tools/rag/lib/README.md`
- Retrieve: `tools/rag/lib/retrieve/`
