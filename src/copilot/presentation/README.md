# presentation/

Camada de **projeções compartilhadas de borda**.

## Pergunta que esta pasta responde

> O que `server/`, `terminal/` e outras bordas precisam consumir em comum sem depender umas das
> outras?

## Regra arquitetural principal

- `presentation/` não é fonte de verdade do runtime.
- Ela monta **projeções e handlers compartilhados** usando `agent/`, `sdk/`, `conversation-hub/`,
  `observability/` e estado legítimo do terminal quando isso for inevitável.
- Serve para evitar acoplamentos como `server -> terminal/handlers/*`.

## Critério de fronteira: `agent/` vs `presentation/`

Use `agent/` quando o problema exigir:

- source-of-truth do runtime;
- lifecycle, reconnect, dialog loop, queue, `ask_user`, health source-of-truth;
- mutation/invariantes do `AgentContext`;
- facades públicas estratégicas do runtime ou da superfície útil do SDK.

Use `presentation/` quando o problema exigir:

- seleção compartilhada de `runtimeId`;
- payload/projection consumida por mais de uma borda;
- composição de deps de router;
- parsing compartilhado de request/payload para handlers de borda;
- visibilidade explícita de fallback/targeting do runtime para HTTP/REPL.

Em resumo:

- `agent/` governa o runtime;
- `presentation/` governa o acesso compartilhado das bordas ao runtime.

## Arquivos

| Arquivo                     | Função                                                                      |
| --------------------------- | --------------------------------------------------------------------------- |
| `index.js`                  | barrel/hub canônico das superfícies compartilhadas                          |
| `agent-runtime.js`          | accessor compartilhado do runtime default / runtimes registrados            |
| `runtime-controls.js`       | mutações/controles compartilhados do runtime default e runtimes explícitos  |
| `runtime-health.js`         | projection compartilhada de health do runtime                               |
| `runtime-ownership.js`      | ownership compartilhado do vínculo SDK ↔ hub                                |
| `runtime-overview.js`       | projection base compartilhada do runtime default (snap/health/runtimeId)    |
| `runtime-status.js`         | payloads compartilhados de status/session/SSE para bordas HTTP e stream     |
| `runtime-route-deps.js`     | composição compartilhada de dependências para routers de borda              |
| `runtime-request.js`        | resolução canônica de `runtimeId` e deps por requisição HTTP                |
| `runtime-targeting.js`      | normalização/seleção canônica de `runtimeId` entre HTTP, REPL e façades     |
| `runtime-sdk-session.js`    | façade compartilhada de `mode/plan` vanilla da sessão SDK por runtime       |
| `runtime-file-context.js`   | implementação compartilhada de contexto de arquivos/attachments             |
| `runtime-ui-state-store.js` | store compartilhada do estado operacional/UI do terminal                    |
| `runtime-ui-state.js`       | façade de leitura do estado operacional/UI compartilhado                    |
| `runtime-dialog.js`         | façade compartilhada de turnos e embeddings de input                        |
| `runtime-webhooks.js`       | façade compartilhada das operações de webhook do runtime                    |
| `agent-control.js`          | controle compartilhado do agente (inject, pipeline, dialog, handoff)        |
| `agent-http-errors.js`      | mapeamento canônico `Error -> HTTP` para o runtime do agente                |
| `conversation-hub.js`       | handlers compartilhados de sessões, turns, memory e health do hub           |
| `realtime.js`               | contratos compartilhados de realtime / SSE crítico / reset de rate limiters |
| `sdk-sessions.js`           | ownership e projections compartilhadas da sessão SDK                        |
| `system-config.js`          | health/config compartilhados para server e terminal                         |
| `system-metrics.js`         | métricas, budget, git/gh e observabilidade compartilhada                    |

## Heurística prática

- Se uma borda precisa consumir algo **igual** à outra, considere `presentation/`.
- Se a lógica é puramente do terminal, deixe em `terminal/`.
- Se a lógica é puramente do server, deixe em `server/`.
- Se a capability nasce no SDK, comece em `sdk/` e só depois projete aqui se houver uso
  compartilhado.

## Runtime compartilhado

`agent-runtime.js` é o novo ponto canônico para bordas consumirem:

- runtime default atual do agent;
- futuros runtimes nomeados vindos da `AgentRuntimeRegistry`;
- metadata segura de runtimes conhecidos para health/config/UX.

Isso evita que `terminal/` e `server/` precisem conhecer diretamente a combinação de:

- singleton lazy `getAgent()`;
- registry explícita de runtimes;
- política de seleção do runtime default.

`runtime-overview.js` concentra a **leitura compartilhada** do runtime default:

- `runtimeId`
- `agentRuntimes`
- `snap`
- `health`
- `runtimeSessionId`
- `contextWindow` normalizado

`runtime-status.js` concentra os payloads menores e repetitivos de borda:

- `/status`
- `/session`
- SSE `connected`

`runtime-controls.js` concentra mutações/controles antes espalhados entre bordas:

- dialog pause/resume/stop/ping
- handoff manager / history
- background compaction threshold
- snapshots do runtime

Além do caminho default, a façade já resolve também `runtimeId` explícito quando a borda precisa
atuar sobre outro runtime registrado.

`runtime-webhooks.js` concentra as operações administrativas de webhook do runtime default:

- listagem
- registro
- remoção

`runtime-route-deps.js` concentra a composição de dependências repetitivas de routers como:

- `copilot-api/index.js`
- `sdk/index.js`

assim `server/routes/*` deixa de remontar manualmente a combinação de runtime default, métricas, SDK
client e tools.

`runtime-request.js` transforma essa preparação em **caminho operacional por requisição**:

- lê `runtimeId` por `query/header/body/params`;
- resolve deps canônicas por request para `copilot-api` e `/sdk`;
- evita que cada router reimplemente parsing de seleção de runtime.

`runtime-targeting.js` agora centraliza a semântica base de `runtimeId` para todas as bordas:

- `normalizeRuntimeId()`
- `hasRuntimeId()`
- `pickRuntimeId()`

Com isso, tanto o parsing HTTP (`runtime-request.js`) quanto o parser do REPL
(`terminal/commands/runtime-target.js`) e os accessors do runtime compartilham a mesma política de
trim/empty/fallback.

`agent-runtime.js` também já expõe `resolveAgentRuntimeSelection()` para distinguir com clareza:

- `requestedRuntimeId`
- `runtimeId` efetivamente resolvido
- `runtimeFound`
- `usedDefaultRuntimeFallback`

Isso permite que projections como `runtime-overview.js` e handlers de `system-config.js` informem
explicitamente quando um runtime pedido não existe e a borda acabou operando sobre o default.

`runtime-sdk-session.js` concentra as operações vanilla da sessão SDK por runtime:

- `getSdkSessionMode()`
- `setSdkSessionMode()`
- `readSdkPlan()`
- `updateSdkPlan()`
- `deleteSdkPlan()`

Com isso, o frontend do terminal já consegue propagar `runtimeId` explícito também nas projections
de `mode/plan`, diagnóstico, métricas e snapshots sem voltar a chamar essas capabilities diretamente
no runtime.

`server/handler-bridge.js` já propaga esse `runtimeId` canônico também para os handlers
compartilhados legados de:

- `agent-control.js`
- `system-metrics.js`

Então rotas históricas como `server/routes/agent.js` e `server/routes/observability.js` já conseguem
participar do caminho multi-agent sem reinventar parsing local de `query/header/body/params`.

`runtime-health.js` concentra a semântica de health compartilhada do runtime:

- fallback legado
- shape HTTP-safe
- projection para registry de módulos

`runtime-ownership.js` concentra o vínculo canônico entre:

- `sdkSessionId`
- `hubSessionId`

`runtime-file-context.js` e `runtime-ui-state-store.js` agora carregam a implementação compartilhada
que antes vivia em `terminal/file-context.js` e `terminal/state.js`.

Com isso:

- `terminal/file-context.js` e `terminal/state.js` viraram apenas **shims de compatibilidade**;
- `presentation/` não importa mais `terminal/*` diretamente;
- `runtime-ui-state.js` e `runtime-dialog.js` passaram a ser apenas fachadas sobre primitivas já
  centralizadas.

## Anti-drift

- `presentation/` não deve inventar semântica paralela ao SDK.
- `presentation/` não deve virar dumping ground de utilitários genéricos.
- Se o código começa a abrir `AgentContext` ou a reinterpretar `SessionEvent` cru aqui dentro, a
  fronteira está errada.
- Se um módulo de `presentation/` voltar a importar `terminal/*` diretamente, isso tende a ser smell
  arquitetural e regressão de bypass — preferir usar `runtime-file-context.js`,
  `runtime-ui-state-store.js`, `runtime-ui-state.js` ou `runtime-dialog.js`.
