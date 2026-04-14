# conversation-hub/

**Camada**: L5 — gestão multi-sessão de conversas do copilot.

Store persistente, orquestração de sessões, socket.io namespace e sincronização.

## Conteúdo

| Arquivo             | Responsabilidade                                       |
| ------------------- | ------------------------------------------------------ |
| `hub.js`            | Singleton `conversationHub` — ponto de entrada         |
| `store.js`          | Store principal — CRUD de conversas em memória + disco |
| `store-helpers.js`  | Helpers de manipulação de store                        |
| `store-queries.js`  | Queries especializadas sobre o store                   |
| `store-sync.js`     | Sincronização store ↔ disco                            |
| `store-memories.js` | Subsistema de memórias do store                        |
| `orchestrator.js`   | Orquestração de sessões, fallback, retry               |
| `socket-ns.js`      | Socket.IO namespace para realtime                      |
| `schema.js`         | Schemas de validação do hub                            |
| `index.js`          | Barrel de exportação                                   |

## Regras de importação

- **Pode importar**: `core/`, `config/`, `observability/`, `sdk/`, `db/`
- **NÃO pode importar**: `terminal/`, `api/`
