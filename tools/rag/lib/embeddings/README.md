# tools/rag/lib/embeddings

**Propósito**: Geração de embeddings vetoriais via Ollama para indexação e busca semântica.  
**Status**: Canônico.  
**Público**: Desenvolvedores do sistema RAG.  
**Última atualização**: 2 de março de 2026.

## Entradas principais

| Arquivo           | Descrição                                       |
| ----------------- | ----------------------------------------------- |
| `ollama.mjs`      | Provider de embeddings via API Ollama           |
| `embed_cache.mjs` | Cache de embeddings para evitar reprocessamento |

## Regras de manutenção

- Model de embeddings configurável via `options.model` ao chamar o provider, ou via defaults em
  `tools/rag/lib/contract.mjs` (`DEFAULT_EMBEDDING_MODEL`).
- Base URL do Ollama configurável via variável de ambiente `OLLAMA_LOCAL_BASE_URL` ou
  `options.baseUrl`.
- Tamanho máximo de texto configurável via `OLLAMA_EMBED_MAX_CHARS`.
- Cache em disco — limpar manualmente a pasta de cache se corrompido (usar `npm run rag:health`
  apenas para verificar saúde, não para resetar).

## Links relacionados

- RAG lib: `tools/rag/lib/README.md`
- Testes: `tests/unit/rag/test_ollama_embeddings_provider.spec.js`
