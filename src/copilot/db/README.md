# db/

**Camada**: L1 — persistência em disco (SQLite/JSON).

Abstração de banco de dados para conversas, TODOs e estado do agente.

## Conteúdo

| Arquivo | Responsabilidade |
|---|---|
| `store.js` | Abstração de store genérico |
| `migrations.js` | Migrações de schema |
| `index.js` | Barrel de exportação |

## Regras de importação

- **Pode importar**: `core/`, `config/`, `node:*`
- **NÃO pode importar**: nenhum outro módulo de `src/copilot/`
