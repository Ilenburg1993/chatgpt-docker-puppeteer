# server/routes/

**Camada**: borda HTTP/SSE local do Copilot.

Este diretório monta a API local do Copilot, mas não deve possuir domínio do agent, SDK,
presentation, observability ou runtime-state. Rotas validam entrada HTTP, aplicam middleware, abrem
streams e delegam para owners canônicos.

## Como ler este diretório

1. Comece em `../router.js`, onde os routers são montados no Express app.
2. Use `module-map.js` como inventário executável recursivo.
3. Leia as rotas de raiz para endpoints históricos e compatíveis.
4. Leia `copilot-api/` para a superfície do AlwaysAliveAgent.
5. Leia `sdk/` como adapter HTTP/SSE do SDK; `sdk/deps.js` é o composition root desse subdomínio.

## Mapa atual de papéis

| Papel               | Arquivos/diretórios                                                                                                        |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `inventory`         | `module-map.js`                                                                                                            |
| `root-route`        | `agent.js`, `config.js`, `git.js`, `health.js`, `memory.js`, `observability.js`, `sessions.js`, `webhooks.js`              |
| `compat-reexport`   | `agent-health.js`                                                                                                          |
| `sse-route`         | `sse.js`                                                                                                                   |
| `module-health`     | `health-modules.js`                                                                                                        |
| `health-registry`   | `health-registry.js`                                                                                                       |
| `surface`           | `copilot-api/`, `sdk/`                                                                                                     |
| `copilot-api-route` | `copilot-api/*.js`                                                                                                         |
| `sdk-composition`   | `sdk/index.js`, `sdk/sessions.js`                                                                                          |
| `sdk-deps`          | `sdk/deps.js`                                                                                                              |
| `sdk-middleware`    | `sdk/middleware.js`, `sdk/session-middleware.js`                                                                           |
| `sdk-schema`        | `sdk/session-schemas.js`                                                                                                   |
| `sdk-route`         | `sdk/agent.js`, `sdk/client.js`, `sdk/hooks.js`, `sdk/observability.js`, `sdk/session-crud.js`, `sdk/session-messaging.js` |

## Risco e próxima decomposição

`module-map.js` marca `risk: 'hotspot'` para arquivos que combinam muitas rotas, schemas, streaming
ou múltiplas famílias de operação. Hotspot não significa bug; significa que a próxima mudança física
deve começar por ali.

Prioridade atual:

1. `sdk/session-messaging.js`: separar messaging, workspace, UI/permissions/tools, compaction e
   shell.
2. `sdk/session-crud.js`: separar inventory/foreground, create/resume e destructive operations.
3. `sdk/observability.js`: separar health/metrics, errors/logs, audit e event catalog.
4. `sdk/session-middleware.js`: schemas já foram separados em `sdk/session-schemas.js`; próximo
   corte, se voltar a crescer, é dividir rate-limit, error wrapper e model sanitizer.
5. `copilot-api/control.js` e `copilot-api/tasks.js`: separar lifecycle/control de payloads
   auxiliares.

## Regra para novos arquivos

Todo novo arquivo JS sob `server/routes/` precisa aparecer em `module-map.js`. Arquivos acima de 300
linhas devem ser marcados como `hotspot`; arquivos acima de 220 linhas, no mínimo como `watch`,
exceto inventários e documentação. Rotas não devem criar projection própria quando já existir owner
em `presentation/`.
