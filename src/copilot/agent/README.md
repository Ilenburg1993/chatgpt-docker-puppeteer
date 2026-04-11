# agent/

**Camada**: L4 — orquestração do agente IA (AlwaysAliveAgent).

Contém o singleton do agente, ciclo de vida (boot/reconnect/shutdown), loop de diálogo,
gestão de sessões, infraestrutura de tools e messaging.

## Subdomínios

| Diretório | Responsabilidade |
|---|---|
| `lifecycle/` | Bootstrap, entry point, reconnect policy, session setup |
| `dialog/` | Loop de diálogo, turn executor, backpressure, watchdog |
| `session/` | Boot wiring, event handlers, history sync, rotation, snapshot |
| `infra/` | Task executor, webhook manager, permission controller, message queue |
| `messaging/` | Envio de mensagens para o agente |

## Arquivos raiz

| Arquivo | Responsabilidade |
|---|---|
| `always-alive.js` | Singleton do agente (god object — decomposição planejada FB-1) |
| `agent-context.js` | Contexto compartilhado entre subsistemas do agente |
| `index.js` | Barrel de exportação |
| `types.js` | Typedefs do módulo |

## Regras de importação

- **Pode importar**: `core/`, `config/`, `observability/`, `sdk/`, `hooks/`, `bridges/`, `tools/`
- **NÃO pode importar**: `terminal/`, `channel/`, `api/`, `conversation-hub/`
