# sdk/

**Camada**: L1-L2 — wrapper sobre `@anthropic-ai/sdk` e `@anthropic-ai/bedrock-sdk`.

Encapsula toda a comunicação com o SDK do provedor de IA. Nenhum outro módulo deve importar
diretamente do SDK externo — sempre via este módulo.

## Subdomínios

| Área              | Arquivos                                      |
| ----------------- | --------------------------------------------- |
| Client lifecycle  | `client.js`, `client-factory.js`, `config.js` |
| Session lifecycle | `sdk-session-wrapper.js`, `session-setup.js`  |
| RPC facade        | `rpc.js`, `rpc-health.js`                     |
| Types & utils     | `types.js`, `utils.js`                        |
| Wrappers          | `send.js`, `command.js`, `response.js`        |

## Regras de importação

- **Pode importar**: `core/`, `config/`, `observability/`, `node:*`, SDKs externos
- **NÃO pode importar**: `agent/`, `bridges/`, `terminal/`, `tools/`
