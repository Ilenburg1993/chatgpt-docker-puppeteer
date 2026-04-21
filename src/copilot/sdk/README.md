# sdk/

## Responsabilidades

Wrapper canônico sobre o **`@github/copilot-sdk`**.

Esta pasta é a fonte de verdade local para:

- tipos do SDK (`types.js`);
- client lifecycle;
- session lifecycle;
- operações RPC vanilla (`mode`, `plan`, `agents`, `sessions`, etc.);
- model registry/helpers;
- telemetry e feature flags relacionadas ao SDK.

## Princípio arquitetural

Nenhum módulo do runtime deve “recriar” uma capability do SDK sem passar por esta camada.

Se o SDK já oferece:

- `mode.get/set`
- `plan.read/update/delete`
- `listSessions`
- `foreground session`
- `custom agents`
- `streaming` / `usage` / hooks / user input

então a implementação local deve começar aqui, e só depois ser ampliada em `agent/`, `terminal/` ou
`presentation/`.

## Subdomínios reais

| Área                 | Arquivos / pastas                                                                |
| -------------------- | -------------------------------------------------------------------------------- |
| Client lifecycle     | `session/client.js`, `session/lifecycle.js`                                      |
| Session ops          | `session/plan.js`, `session/mode.js`, `session/agents.js`, `session/messages.js` |
| RPC helpers          | `rpc/`, `rpc.js`                                                                 |
| Model registry       | `models/`                                                                        |
| Tools state/registry | `tools/`                                                                         |
| Types & helpers      | `types.js`, `utils.js`, `event-helpers.js`, `constants.js`                       |
| Telemetry            | `telemetry/`                                                                     |

## Relação com outras camadas

- `event-handlers/` traduz `SessionEvent` do SDK para sinais internos.
- `agent/facades/agent-sdk-access.js` expõe um subconjunto estratégico do SDK como API pública do
  runtime.
- `terminal/frontend/sdk-session-projection.js` monta UX vanilla de `mode/plan` em cima desta
  camada.

## Critério de fronteira com `agent/` e `presentation/`

- se a dúvida é “qual é a capacidade vanilla correta?”, a resposta nasce aqui;
- se a dúvida é “como isso vira capability pública do runtime contínuo?”, a resposta sobe para
  `agent/facades/`;
- se a dúvida é “como isso aparece igual em `server/` e `terminal/`?”, a resposta sobe para
  `presentation/`.

`sdk/` não deve virar camada de payload HTTP nem de UX local.

## Regras de importação

- **Pode importar**: `core/`, `config/`, `observability/`, `node:*`, `@github/copilot-sdk`
- **NÃO deve importar**: `terminal/`, `presentation/`
- `agent/` pode consumir `sdk/`, mas não deve duplicar contratos que já existem aqui.
