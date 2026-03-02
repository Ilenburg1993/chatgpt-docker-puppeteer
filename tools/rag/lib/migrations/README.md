# tools/rag/lib/migrations

**Propósito**: Migrações de schema do banco de dados vetorial LanceDB usado pelo sistema RAG.  
**Status**: Canônico.  
**Público**: Desenvolvedores do sistema RAG.  
**Última atualização**: 2 de março de 2026.

## Entradas principais

| Arquivo | Descrição |
|---|---|
| `schema_v2.mjs` | Migração para schema v2 do banco vetorial |

## Regras de manutenção

- Migrações devem ser numeradas sequencialmente (`schema_v<N>.mjs`).
- Sempre testar migração em ambiente local antes de aplicar.
- Não remover migrações antigas — manter histórico completo.

## Links relacionados

- RAG lib: `tools/rag/lib/README.md`
- Storage: `tools/rag/lib/storage/`
