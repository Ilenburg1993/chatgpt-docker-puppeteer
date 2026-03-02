# tools/rag/lib

**Propósito**: Biblioteca core do sistema RAG — facade, chunking, embeddings, storage, retrieve, fingerprint, scan e configuração.  
**Status**: Canônico.  
**Público**: Desenvolvedores do sistema RAG.  
**Última atualização**: 2 de março de 2026.

## O que esta pasta contém

- Módulos ESM do sistema RAG organizados por responsabilidade.

## Entradas principais

| Arquivo/Pasta | Descrição |
|---|---|
| `facade.mjs` | Fachada pública do sistema RAG |
| `chunking/` | Divisão de documentos em chunks |
| `embeddings/` | Geração de embeddings via Ollama |
| `storage/` | Persistência vetorial (LanceDB) |
| `retrieve/` | Diversidade e re-ranking de resultados |
| `migrations/` | Migrações de schema do banco vetorial |
| `text/` | Normalização de queries de texto |
| `scan.mjs` | Scanner de arquivos do projeto |
| `fingerprint.mjs` | Fingerprinting para deduplicação |
| `contract.mjs` | Contratos de interface do RAG |
| `manifest.mjs` | Manifesto de arquivos indexados |
| `scope_config.mjs` | Configuração de escopo de indexação |
| `paths.mjs` | Gerenciamento de caminhos RAG |
| `adaptive_throttler.mjs` | Throttler adaptativo |

## Links relacionados

- Hub RAG: `tools/rag/README.md`
- Testes RAG: `tests/unit/rag/`
