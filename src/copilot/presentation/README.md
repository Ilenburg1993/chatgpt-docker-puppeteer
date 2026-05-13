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

## Topologia atual

> **Delta de execução — 2026-05-12**
>
> A primeira grande onda barrel-first de `presentation/` já foi aplicada:
>
> - `agent/`, `routing/`, `state/`, `system/`, `conversation/`, `contracts/`, `runtime/`, `files/` e `sdk/`
>   já são subdomínios físicos reais;
> - `agent/runtime/index.js` foi introduzido como surface estreita para seleção/lookup de runtime, evitando ciclos com
>   `agent/control.js`;
> - `server/` e `terminal/` já consomem `presentation/` via sub-barrels em vez de leaf files dos novos subdomínios;
> - o próximo foco passa a ser minimizar ainda mais a surface pública e decompor hotspots internos.

```text
presentation/
  index.js

  agent/
    index.js
    control.js
    http-errors.js
    runtime/
      index.js

  routing/
    index.js
    meta.js
    request.js
    route-deps.js
    targeting.js

  state/
    index.js
    realtime.js
    ui-state.js
    ui-store.js

  system/
    index.js
    config.js
    metrics.js

  conversation/
    index.js
    hub.js

  contracts/
    index.js
    types.js

  files/
    index.js
    context.js
    routing.js

  runtime/
    index.js
    capabilities.js
    controls.js
    dialog.js
    fallback-telemetry.js
    health.js
    lifecycle.js
    models.js
    overview.js
    ownership.js
    sdk-session.js
    status.js
    todos.js
    tools.js
    webhooks.js

  sdk/
    index.js
    recovery-policy.js
    sessions.js

  dialog-timeout-policy.js
```

## Superfícies principais

| Superfície              | Função                                                                     |
| ----------------------- | -------------------------------------------------------------------------- |
| `index.js`              | barrel/hub canônico das superfícies compartilhadas                         |
| `agent/index.js`        | controle do agente, projeção HTTP de erros e seleção compartilhada runtime |
| `routing/index.js`      | targeting, route deps e metadata de runtime para bordas HTTP               |
| `state/index.js`        | estado compartilhado de UI/realtime entre terminal e outras bordas         |
| `system/index.js`       | config, health operacional e métricas compartilhadas                       |
| `conversation/index.js` | handlers compartilhados de sessões, turns, memory e hub health             |
| `contracts/index.js`    | tipos locais das projections e handlers compartilhados                     |
| `runtime/index.js`      | façade barrelizada do runtime compartilhado                                |
| `files/index.js`        | leitura/embedding/routing de arquivos compartilhados                       |
| `sdk/index.js`          | ownership/recovery e projections compartilhadas da sessão SDK              |

## Heurística prática

- Se uma borda precisa consumir algo **igual** à outra, considere `presentation/`.
- Se a lógica é puramente do terminal, deixe em `terminal/`.
- Se a lógica é puramente do server, deixe em `server/`.
- Se a capability nasce no SDK, comece em `sdk/` e só depois projete aqui se houver uso
  compartilhado.

## Runtime compartilhado

`agent/runtime/index.js` é o novo ponto canônico para bordas consumirem:

- runtime default atual do agent;
- futuros runtimes nomeados vindos da `AgentRuntimeRegistry`;
- metadata segura de runtimes conhecidos para health/config/UX.

Isso evita que `terminal/` e `server/` precisem conhecer diretamente a combinação de:

- singleton lazy `getAgent()`;
- registry explícita de runtimes;
- política de seleção do runtime default.

`runtime/overview.js` concentra a **leitura compartilhada** do runtime default:

- `runtimeId`
- `agentRuntimes`
- `snap`
- `health`
- `runtimeSessionId`
- `contextWindow` normalizado

`runtime/status.js` concentra os payloads menores e repetitivos de borda:

- `/status`
- `/session`
- SSE `connected`

`runtime/controls.js` concentra mutações/controles antes espalhados entre bordas:

- dialog pause/resume/stop/ping
- handoff manager / history
- background compaction threshold
- snapshots do runtime

Além do caminho default, a façade já resolve também `runtimeId` explícito quando a borda precisa
atuar sobre outro runtime registrado.

`runtime/webhooks.js` concentra as operações administrativas de webhook do runtime default:

- listagem
- registro
- remoção

`routing/route-deps.js` concentra a composição de dependências repetitivas de routers como:

- `copilot-api/index.js`
- `sdk/index.js`

assim `server/routes/*` deixa de remontar manualmente a combinação de runtime default, métricas, SDK
client e tools.

`routing/request.js` transforma essa preparação em **caminho operacional por requisição**:

- lê `runtimeId` por `query/header/body/params`;
- resolve deps canônicas por request para `copilot-api` e `/sdk`;
- evita que cada router reimplemente parsing de seleção de runtime.

`routing/targeting.js` agora centraliza a semântica base de `runtimeId` para todas as bordas:

- `normalizeRuntimeId()`
- `hasRuntimeId()`
- `pickRuntimeId()`

Com isso, tanto o parsing HTTP (`runtime-request.js`) quanto o parser do REPL
(`terminal/commands/runtime-target.js`) e os accessors do runtime compartilham a mesma política de
trim/empty/fallback.

`agent/runtime/index.js` também já expõe `resolveAgentRuntimeSelection()` para distinguir com clareza:

- `requestedRuntimeId`
- `runtimeId` efetivamente resolvido
- `runtimeFound`
- `usedDefaultRuntimeFallback`

Isso permite que projections como `runtime-overview.js` e handlers de `system-config.js` informem
explicitamente quando um runtime pedido não existe e a borda acabou operando sobre o default.

`runtime/sdk-session.js` concentra as operações vanilla da sessão SDK por runtime:

- `getSdkSessionMode()`
- `setSdkSessionMode()`
- `readSdkPlan()`
- `updateSdkPlan()`
- `deleteSdkPlan()`

Com isso, o frontend do terminal já consegue propagar `runtimeId` explícito também nas projections
de `mode/plan`, diagnóstico, métricas e snapshots sem voltar a chamar essas capabilities diretamente
no runtime.

`server/routes/presentation-route.js` já propaga esse `runtimeId` canônico também para os handlers
compartilhados de:

- `agent/control.js`
- `system/metrics.js`

Então rotas históricas como `server/routes/agent.js` e `server/routes/observability.js` já conseguem
participar do caminho multi-agent sem reinventar parsing local de `query/header/body/params`.

`runtime-health.js` concentra a semântica de health compartilhada do runtime:

- fallback legado
- shape HTTP-safe
- projection para registry de módulos

`runtime-ownership.js` concentra o vínculo canônico entre:

- `sdkSessionId`
- `hubSessionId`

`runtime-file-context.js` e `state/ui-store.js` agora carregam a implementação compartilhada
que antes vivia no terminal.

Com isso:

- `presentation/files/context.js` e `presentation/state/ui-store/index.js` são os owners
  canônicos;
- `presentation/` não importa mais `terminal/*` diretamente;
- `state/ui-state.js` e `runtime-dialog.js` passaram a ser apenas fachadas sobre primitivas já
  centralizadas.

## Anti-drift

- `presentation/` não deve inventar semântica paralela ao SDK.
- `presentation/` não deve virar dumping ground de utilitários genéricos.
- Se o código começa a abrir `AgentContext` ou a reinterpretar `SessionEvent` cru aqui dentro, a
  fronteira está errada.
- Se um módulo de `presentation/` voltar a importar `terminal/*` diretamente, isso tende a ser smell
  arquitetural e regressão de bypass — preferir usar `runtime-file-context.js`,
  `state/ui-store.js`, `state/ui-state.js` ou `runtime-dialog.js`.
