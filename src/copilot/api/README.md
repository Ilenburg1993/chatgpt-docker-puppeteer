# api/

**Camada**: L6 — API HTTP/REST e bridges de controle do agente.

Expõe endpoints Express para controle externo do copilot (sessões, agent, webhooks,
observabilidade).

## Subdomínios

| Diretório | Responsabilidade |
|---|---|
| `express/` | Rotas Express (agent, client, session-*, webhooks, observability) |
| `bridge/` | Bridges internos de controle (control, tasks) |

## Regras de importação

- **Pode importar**: qualquer módulo (camada de superfície)
- **NÃO pode ser importado por**: módulos internos (apenas `src/server/main.js` monta as rotas)
