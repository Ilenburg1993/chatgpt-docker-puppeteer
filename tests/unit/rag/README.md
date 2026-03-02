# tests/unit/rag

**Propósito**: Testes unitários do sistema RAG — chunking, embeddings, fingerprint, throttler, scan, scope e watch.  
**Status**: Canônico.  
**Público**: Desenvolvedores do sistema RAG (`tools/rag/`).  
**Última atualização**: 2 de março de 2026.

## Entradas principais

| Arquivo | Descrição |
|---|---|
| `test_chunking.spec.js` | Divisão de documentos em chunks |
| `test_ollama_embeddings_provider.spec.js` | Provider de embeddings via Ollama |
| `test_fingerprint.spec.js` | Fingerprinting de documentos para dedup |
| `test_adaptive_throttler.spec.js` | Throttler adaptativo de indexação |
| `test_scan.spec.js` | Scanner de arquivos do projeto |
| `test_rag_health_and_progress.spec.js` | Saúde e progresso do sistema RAG |
| `test_rag_watch.spec.js` | Watcher de mudanças para re-indexação |
| `test_scope_config.spec.js` | Configuração de escopo RAG |
| `test_env_bootstrap.spec.js` | Bootstrap de variáveis de ambiente RAG |

## Links relacionados

- Hub unitário: `tests/unit/README.md`
- Sistema RAG: `tools/rag/`
- Integração RAG: `tests/integration/rag/`
