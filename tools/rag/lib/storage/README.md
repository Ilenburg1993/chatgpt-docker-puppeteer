# tools/rag/lib/storage

**Propósito**: Camada de persistência vetorial do sistema RAG — armazenamento e consulta via
LanceDB.  
**Status**: Canônico.  
**Público**: Desenvolvedores do sistema RAG.  
**Última atualização**: 2 de março de 2026.

## Entradas principais

| Arquivo       | Descrição                                                |
| ------------- | -------------------------------------------------------- |
| `lancedb.mjs` | Adapter para LanceDB — insert, search, delete de vetores |

## Regras de manutenção

- Banco LanceDB em disco — localização canônica em `/home/node/.local/share/rag-db`; configurável
  via override de opções em `getRagPaths()` em `tools/rag/lib/paths.mjs`.
- Migrations em `tools/rag/lib/migrations/` ao alterar schema.

## Links relacionados

- RAG lib: `tools/rag/lib/README.md`
- Migrations: `tools/rag/lib/migrations/`
