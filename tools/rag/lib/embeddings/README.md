# tools/rag/lib/embeddings

**Propósito**: Geração de embeddings vetoriais via Ollama para indexação e busca semântica.  
**Status**: Canônico.  
**Público**: Desenvolvedores do sistema RAG.  
**Última atualização**: 2 de março de 2026.

## Entradas principais

| Arquivo | Descrição |
|---|---|
| `ollama.mjs` | Provider de embeddings via API Ollama |
| `embed_cache.mjs` | Cache de embeddings para evitar reprocessamento |

## Regras de manutenção

- Model de embeddings configurável via variável de ambiente `RAG_EMBED_MODEL`.
- Cache em disco — limpar com `npm run rag:health` se corrompido.

## Links relacionados

- RAG lib: `tools/rag/lib/README.md`
- Testes: `tests/unit/rag/test_ollama_embeddings_provider.spec.js`
