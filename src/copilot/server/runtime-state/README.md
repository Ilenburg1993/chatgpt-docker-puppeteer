# server/runtime-state

Registries explícitos de **estado vivo module-level** usados por rotas multi-runtime críticas.

Objetivo arquitetural:

- tirar `Map`/`Set` sensíveis de dentro dos módulos de rota;
- tornar explícito o ownership do estado vivo de SSE/concorrência;
- permitir contratos do Gate 2.0-D sobre onde esse estado pode morar.

Categorias atuais:

- `copilot-api-dialog.js` — concorrência HTTP por `runtimeId` em `/copilot-api/dialog/turn`;
- `copilot-api-stream.js` — pools/subscriptions SSE de `/copilot-api/stream*`;
- `sdk-agent-stream.js` — SSE de `/api/sdk/agent/stream`;
- `sdk-hooks-stream.js` — SSE de `/api/sdk/hooks/events`;
- `sdk-session-stream.js` — SSE de `/api/sdk/sessions/:id/stream`, chaveado por
  `runtimeId:sessionId`;
- `sdk-session-rate-limit.js` — janela de rate limiting em memória para `sdk/session-middleware`.

Regra: rotas podem ser donas da **política**, mas não de registries anônimos process-wide quando o
estado já tem papel de registry explícito.
