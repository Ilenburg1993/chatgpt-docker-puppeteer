# channel/

**Camada**: L5 — comunicação LLM-A ↔ LLM-B via AlwaysAliveAgent.

Bridge de mensagens entre o client (LLM-B terminal) e o agente principal.

## Conteúdo

| Arquivo     | Responsabilidade                                      |
| ----------- | ----------------------------------------------------- |
| `client.js` | `LlmBridgeClient` — client de comunicação com o agent |
| `inject.js` | Injeção de mensagens programáticas no agent loop      |
| `index.js`  | Barrel de exportação                                  |
| `types.js`  | Typedefs do módulo                                    |

## Escopo vs `conversation-hub/`

- `channel/` = transporte de mensagens entre LLM-A e LLM-B
- `conversation-hub/` = gestão multi-sessão, store, orquestração

## Regras de importação

- **Pode importar**: `core/`, `config/`, `observability/`, `sdk/`, `agent/`
- **NÃO pode importar**: `terminal/`, `api/`
