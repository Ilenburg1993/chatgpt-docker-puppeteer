# 12 — `src/copilot`: Arquitetura Global Ideal

**Data de atualização**: 2026-04-22  
**Escopo**: todo o diretório `src/copilot/`  
**Função deste documento**: guia global de arquitetura para submeter os planos específicos de
`agent/`, `sdk/`, `events`, `event-handlers`, `presentation`, `terminal`, `server`, `tools`,
`hooks`, `conversation-hub`, `observability` e demais módulos.  
**Roadmap operacional detalhado**:
[13-SRC-COPILOT-ARQUITETURA-GLOBAL-IDEAL-ROADMAP.md](./13-SRC-COPILOT-ARQUITETURA-GLOBAL-IDEAL-ROADMAP.md)  
**Documento
subordinado principal**: [11-AGENT-SITUACAO-IDEAL.md](./11-AGENT-SITUACAO-IDEAL.md)

> **Leitura correta**: este documento é a camada superior. Planos locais, incluindo a arquitetura
> ideal do `agent/`, devem obedecer a esta topologia global. Quando houver conflito, a regra global
> prevalece e o documento local deve ser ajustado. Para execução por fases, use o documento 13 como
> roadmap canônico.

---

## 1. Tese global

`src/copilot/` não deve ser guiado por uma pasta central que sabe tudo. O sistema deve ser guiado
por camadas com responsabilidade clara:

```text
core/types/db/config
  -> sdk/events/event-handlers/hooks/tools/bridges
    -> agent/conversation-hub/channel
      -> presentation
        -> server/terminal
          -> UX/API/operador

cross-cutting:
  observability/audit/infra/plugins
```

A situação ideal global é:

> **um runtime Copilot local em que cada módulo tem owner claro, eventos e contratos são estáveis,
> bordas consomem projections compartilhadas, o SDK vanilla permanece como fonte de verdade das
> capacidades análogas, e o `agent/` governa apenas o runtime contínuo, não o sistema inteiro.**

---

## 2. Árvore atual extraída

Extração feita a partir de:

```bash
find src/copilot -type d | sort
find src/copilot -type f | sort
```

## 2.1 Diretórios

```text
src/copilot
src/copilot/.github
src/copilot/.github/hooks
src/copilot/.github/hooks/state
src/copilot/.github/hooks/state/snapshots
src/copilot/agent
src/copilot/agent/dialog
src/copilot/agent/facades
src/copilot/agent/infra
src/copilot/agent/lifecycle
src/copilot/agent/messaging
src/copilot/agent/ports
src/copilot/agent/session
src/copilot/agent/state
src/copilot/audit
src/copilot/bridges
src/copilot/bridges/gh
src/copilot/channel
src/copilot/config
src/copilot/config/system-prompt
src/copilot/config/system-prompt/sdk-defaults
src/copilot/config/system-prompt/sections
src/copilot/conversation-hub
src/copilot/core
src/copilot/core/security
src/copilot/db
src/copilot/event-handlers
src/copilot/events
src/copilot/events/middleware
src/copilot/events/schemas
src/copilot/hooks
src/copilot/hooks/presets
src/copilot/infra
src/copilot/infra/sse
src/copilot/logs
src/copilot/observability
src/copilot/observability/bus-actions
src/copilot/observability/collectors
src/copilot/observability/observers
src/copilot/plugins
src/copilot/presentation
src/copilot/sdk
src/copilot/sdk/agent
src/copilot/sdk/models
src/copilot/sdk/rpc
src/copilot/sdk/session
src/copilot/sdk/telemetry
src/copilot/sdk/tools
src/copilot/server
src/copilot/server/middleware
src/copilot/server/routes
src/copilot/server/routes/copilot-api
src/copilot/server/routes/sdk
src/copilot/server/socket
src/copilot/server/sse
src/copilot/terminal
src/copilot/terminal/commands
src/copilot/terminal/dialog
src/copilot/terminal/frontend
src/copilot/terminal/handlers
src/copilot/tools
src/copilot/tools/file
src/copilot/tools/git
src/copilot/tools/shell
src/copilot/tools/todo
src/copilot/types
src/copilot/types/contracts
```

## 2.2 Contagem por área

```text
.github                  dirs=   4 files=   7 js=   0 md=  0
agent                    dirs=   9 files=  68 js=  66 md=  2
audit                    dirs=   1 files=  10 js=   9 md=  1
bridges                  dirs=   2 files=  14 js=  13 md=  1
channel                  dirs=   1 files=   9 js=   8 md=  1
config                   dirs=   4 files=  28 js=  25 md=  2
conversation-hub         dirs=   1 files=  14 js=  13 md=  1
core                     dirs=   2 files=  21 js=  20 md=  1
db                       dirs=   1 files=   4 js=   3 md=  1
event-handlers           dirs=   1 files=  14 js=  13 md=  1
events                   dirs=   3 files=  21 js=  20 md=  1
hooks                    dirs=   2 files=  26 js=  25 md=  1
infra                    dirs=   2 files=  12 js=  12 md=  0
logs                     dirs=   1 files=  13 js=   0 md=  0
observability            dirs=   4 files=  35 js=  34 md=  1
plugins                  dirs=   1 files=   3 js=   3 md=  0
presentation             dirs=   1 files=  24 js=  23 md=  1
sdk                      dirs=   7 files=  39 js=  38 md=  1
server                   dirs=   7 files=  41 js=  41 md=  0
terminal                 dirs=   5 files=  62 js=  58 md=  4
tools                    dirs=   5 files=  34 js=  33 md=  1
types                    dirs=   2 files=   5 js=   4 md=  1
```

## 2.3 Leitura da árvore

A árvore mostra cinco fatos importantes:

1. `agent/` e `terminal/` são os maiores módulos, o que confirma que runtime e UX local ainda
   concentram muita lógica.
2. `presentation/` já existe como camada real e deve ser fortalecida, não contornada.
3. `events/`, `event-handlers/` e `observability/` são áreas distintas, mas ainda precisam de
   hierarquia mais explícita.
4. `tools/`, `hooks/` e `bridges/` são superfícies sensíveis de execução e integração; não devem
   ficar embutidas no núcleo do `agent/`.
5. `.github/hooks/state` e `logs/` aparecem dentro de `src/copilot`; para arquitetura, devem ser
   tratados como artefatos de runtime, não como código-fonte canônico.

## 2.4 Inventário de arquivos por área

Este inventário lista os arquivos relevantes por área. Artefatos gerados aparecem ao final como
runtime artifacts.

```text
src/copilot/
  README.md
  agent.js
  bootstrap.js

agent/
  README.md
  agent-context.js
  always-alive.js
  background-tasks.js
  di-tokens.js
  error-policy.js
  event-bridge-map.js
  event-bridge-wiring.js
  health-check.js
  index.js
  queue-processor.js
  runtime-contracts.js
  runtime-registry.js
  types.js
  dialog/
    agent-dialog-controller.js
    backpressure.js
    event-wiring.js
    index.js
    loop-manager.js
    model-fallback.js
    pending-question-shadow.js
    protocol.js
    turn-executor.js
    user-input-handler.js
    watchdog.js
  facades/
    README.md
    agent-dialog-runtime.js
    agent-model-config.js
    agent-runtime-controls.js
    agent-runtime-ownership.js
    agent-runtime-status.js
    agent-runtime-webhooks.js
    agent-sdk-access.js
    agent-session-ops.js
    agent-webhook-ops.js
  infra/
    handoff-manager.js
    index.js
    message-queue.js
    task-executor.js
  lifecycle/
    agent-lifecycle.js
    entry.js
    index.js
    reconnect-policy.js
    session-setup.js
    state-io.js
  messaging/
    agent-messaging.js
    index.js
  ports/
    conversation-port.js
    hook-port.js
    index.js
    mcp-port.js
    observability-port.js
    permission-port.js
    tool-port.js
  session/
    boot-steps.js
    boot-wiring.js
    cleanup.js
    event-wirer.js
    history-sync.js
    hook-context.js
    index.js
    initializer.js
    keepalive.js
    ownership.js
    rotation.js
    snapshot.js
  state/
    agent-state.js
    index.js

audit/
  README.md
  di-tokens.js
  index.js
  jsonl-writer.js
  logger.js
  pipeline-audit-log.js
  pipeline-permission.js
  pipeline-sdk-buffer.js
  pipeline.js
  ring-buffer.js

bridges/
  README.md
  di-tokens.js
  git-bridge-read.js
  git-bridge-write.js
  git-bridge.js
  index.js
  mcp-tool-bridge.js
  mcp-tool-schema.js
  nerv-event-bus-adapter.js
  gh/
    ci.js
    index.js
    issues.js
    prs.js
    shared.js

channel/
  README.md
  client-dialog.js
  client-history.js
  client-structured.js
  client.js
  di-tokens.js
  index.js
  inject.js
  sse-client.js

config/
  README.md
  agent.js
  auth.js
  client-options.js
  custom-agents.js
  env.js
  index.js
  mcp-servers.js
  pinned-files.js
  sdk-config-port.js
  session-config.js
  system-prompt.js
  system-prompt/
    index.js
    mode.js
    sdk-defaults/
      README.md
      capture.js
      captured-2026-04-14.json
      snapshot.js
    sections/
      code-change-rules.js
      custom-instructions.js
      environment-context.js
      guidelines.js
      identity.js
      last-instructions.js
      safety.js
      tone.js
      tool-efficiency.js
      tool-instructions.js

conversation-hub/
  README.md
  access.js
  broadcast.js
  call-strategies.js
  di-tokens.js
  hub.js
  index.js
  orchestrator.js
  send-pipeline.js
  store-helpers.js
  store-memories.js
  store-queries.js
  store-sync.js
  store.js

core/
  README.md
  cache.js
  circuit-breaker.js
  di-container.js
  di-tokens.js
  di.js
  error-codes.js
  error-handlers.js
  errors.js
  event-bus.js
  index.js
  interfaces.js
  mutex.js
  retry.js
  safe-json.js
  schemas.js
  shared-state.js
  shutdown.js
  structured-message.js
  timer-registry.js
  security/
    url-validator.js

db/
  README.md
  index.js
  migrations.js
  sqlite.js

event-handlers/
  README.md
  catch-all.js
  compaction.js
  index.js
  interaction-events.js
  mcp-events.js
  mode-and-tools.js
  sdk-responses.js
  session-lifecycle.js
  streaming.js
  system-notifications.js
  token-budget.js
  tool-lifecycle.js
  usage.js

events/
  agent-events.js
  catalog.md
  create-emitter.js
  emitter-events.js
  hook-events.js
  hub-events.js
  index.js
  legacy-events.js
  nerv-events.js
  sdk-events.js
  service-events.js
  system-events.js
  terminal-events.js
  middleware/
    correlation-enricher.js
    index.js
    rate-limiter.js
    schema-validator.js
    timestamp-enricher.js
  schemas/
    builtin-schemas.js
    index.js
    registry.js

hooks/
  README.md
  audit-trail.js
  bus.js
  composer.js
  di-tokens.js
  error-handler.js
  factory.js
  index.js
  logger.js
  permission-controller.js
  permission-handler.js
  prompt-transformer.js
  registry.js
  session-hooks.js
  tool-filter.js
  tool-interceptor.js
  types.js
  user-input.js
  presets/
    audit.js
    deny-all.js
    index.js
    interactive.js
    minimal.js
    production.js
    profiles.js
    safe.js

infra/
  di-tokens.js
  index.js
  lockfile.js
  queue.js
  sdk-session-registry.js
  storage.js
  webhooks.js
  sse/
    fanout.js
    index.js
    replay-buffer.js
    state.js
    utils.js

observability/
  README.md
  agent-event-observer.js
  bootstrap.js
  di-tokens.js
  error-alerting.js
  error-tracker.js
  event-bus-observers.js
  event-bus-runtime.js
  event-catalog.js
  event-collector.js
  index.js
  logger.js
  metrics-histogram.js
  metrics.js
  otel.js
  snapshots.js
  tool-stats.js
  bus-actions/
    activity-tracker.js
    correlation-tracer.js
    error-alerter.js
    health-updater.js
    index.js
    log-observer.js
    metrics-collector.js
  collectors/
    assistant-handlers.js
    context.js
    index.js
    interaction-handlers.js
    session-handlers.js
    tool-handlers.js
  observers/
    context.js
    dialog-task-handlers.js
    event-name-map.js
    index.js
    session-agent-handlers.js

plugins/
  di-tokens.js
  index.js
  plugin-registry.js

presentation/
  README.md
  agent-control.js
  agent-http-errors.js
  agent-runtime.js
  conversation-hub.js
  index.js
  realtime.js
  runtime-controls.js
  runtime-dialog.js
  runtime-file-context.js
  runtime-health.js
  runtime-overview.js
  runtime-ownership.js
  runtime-request.js
  runtime-route-deps.js
  runtime-sdk-session.js
  runtime-status.js
  runtime-targeting.js
  runtime-ui-state-store.js
  runtime-ui-state.js
  runtime-webhooks.js
  sdk-sessions.js
  system-config.js
  system-metrics.js

sdk/
  README.md
  config.js
  constants.js
  di-tokens.js
  event-helpers.js
  feature-flags.js
  http-request.js
  index.js
  logger.js
  rpc.js
  types.js
  utils.js
  agent/
    agents.js
  models/
    helpers.js
    index.js
    known-models.js
    registry.js
    selector.js
    stats-tracker.js
  rpc/
    experimental.js
    ops.js
    server.js
    session.js
  session/
    client-events.js
    client-facade.js
    client.js
    events.js
    lifecycle.js
    permissions.js
    provider.js
    system-message.js
    wrapper.js
  telemetry/
    health.js
    quota-monitor.js
    tracing.js
  tools/
    core.js
    custom.js
    registry.js
    state.js

server/
  app.js
  handler-bridge.js
  index.js
  router.js
  middleware/
    auth.js
    cors.js
    error-handler.js
    rate-limiter-state.js
    rate-limiter.js
    request-id.js
    security-headers.js
    validate.js
  routes/
    agent-health.js
    agent.js
    config.js
    git.js
    health-modules.js
    health-registry.js
    health.js
    memory.js
    observability.js
    sessions.js
    sse.js
    webhooks.js
    copilot-api/
      control.js
      dialog.js
      index.js
      stream.js
      tasks.js
    sdk/
      agent.js
      client.js
      hooks.js
      index.js
      middleware.js
      observability.js
      session-crud.js
      session-messaging.js
      session-middleware.js
      sessions.js
  socket/
    hub-ns.js
    index.js
  sse/

terminal/
  README.md
  activity-state.js
  agent-runtime-events.README.md
  agent-runtime-events.js
  agent-sse-fallback.js
  alias-store.js
  bootstrap.js
  dialog.js
  di-wiring.js
  file-context.js
  index.js
  rate-limiter-state.js
  repl-listeners.js
  repl.js
  sdk-session-events.js
  state.js
  task-stream-events.js
  terminal-agent-wiring.js
  workspace-context.js
  commands/
    activity.js
    alias.js
    attach.js
    audit.js
    config.js
    context.js
    diagnose.js
    display.js
    errors.js
    export.js
    gh.js
    git.js
    help.js
    index.js
    memory.js
    metrics.js
    plan.js
    resume.js
    runtime-target.js
    search.js
    session.js
    skills.js
    thinking.js
    tools.js
    usage.js
  dialog/
    README.md
    engine-persistence.js
    engine.js
    index.js
    output.js
    sse.js
    turn-display.js
  frontend/
    README.md
    index.js
    llm-b-frontend.js
    llm-b-runtime.js
    sdk-session-projection.js
  handlers/
    agent.js
    dialog.js
    index.js
    shared.js
    system-config.js
    system-metrics.js

tools/
  README.md
  bootstrap.js
  code-tools.js
  di-tokens.js
  experimental-rpc-tools.js
  hook-tools.js
  hub-tools.js
  index.js
  introspection-tools.js
  logger.js
  metrics-proxy.js
  permission-tools.js
  session-rpc-tools.js
  session-tools.js
  task-tools.js
  tool-factory.js
  web-tools.js
  file/
    index.js
    read-tools-io.js
    read-tools-search.js
    read-tools.js
    shared.js
    write-tools.js
  git/
    index.js
  shell/
    executor.js
    index.js
    sandbox.js
  todo/
    bulk-tools.js
    crud-tools.js
    index.js
    query-tools.js
    store.js
    todo-schema.js
    todo-write-tools.js

types/
  README.md
  index.js
  contracts/
    bridge-contract.js
    channel-contract.js
    contract.js

runtime artifacts:
  .github/hooks/state/
    sdk-always-alive.json
    snapshots/*.json
  logs/
    *.log
    *.jsonl
```

---

## 3. Camadas globais ideais

## 3.1 L0 — Fundação

### Pastas

- `core/`
- `types/`
- `db/`
- partes puras de `config/`

### Responsabilidade

- erros;
- DI base;
- schemas;
- safe JSON;
- mutex/retry/cache;
- contratos transversais;
- storage básico;
- tipos compartilhados.

### Regra

L0 não deve depender de módulos de runtime.

Permitido:

- `node:*`;
- utilidades puras;
- configurações de ambiente quando inevitável.

Proibido:

- `agent/`;
- `sdk/`;
- `presentation/`;
- `terminal/`;
- `server/`;
- `tools/`.

## 3.2 L1 — Configuração declarativa

### Pastas

- `config/`

### Responsabilidade

- env;
- auth config;
- agent defaults;
- MCP config;
- session config;
- system prompt;
- custom agents;
- pinned files.

### Regra

Config define valores e builders. Não deve iniciar runtime, registrar tools reais, criar sessão ou
montar payload de borda.

## 3.3 L2 — SDK vanilla e contratos de eventos

### Pastas

- `sdk/`
- `events/`
- `event-handlers/`

### Responsabilidade

`sdk/`:

- wrapper canônico do `@github/copilot-sdk`;
- client/session lifecycle vanilla;
- RPCs;
- mode/plan;
- agents;
- models;
- telemetry SDK;
- tools registry SDK.

`events/`:

- catálogo de nomes;
- schemas;
- middlewares;
- constantes por domínio.

`event-handlers/`:

- tradução de `SessionEvent` cru do SDK para sinais internos estáveis.

### Regra

Se existe capability análoga no SDK, a implementação local começa em `sdk/`.

Se existe evento cru do SDK, o primeiro lugar a interpretar é `event-handlers/`.

`events/` define linguagem. `event-handlers/` traduz payload. Nenhum dos dois deve governar runtime.

## 3.4 L3 — Políticas, tools e integrações externas

### Pastas

- `hooks/`
- `tools/`
- `bridges/`
- `plugins/`
- partes de `infra/`

### Responsabilidade

`hooks/`:

- policies da sessão SDK;
- permissions;
- prompt transforms;
- tool interceptors;
- circuit breakers.

`tools/`:

- definição e registro de custom tools;
- file/git/shell/web/session/todo/hub tools;
- tool factory.

`bridges/`:

- Git/GitHub;
- MCP;
- NERV;
- adaptadores externos.

`plugins/`:

- registry de plugins.

### Regra

Essas áreas são sensíveis. Elas não devem depender diretamente de `terminal/` ou de detalhes
internos do `agent/`. O `agent/` pode orquestrar o uso, mas por ports/facades, não por acoplamento
crescente.

## 3.5 L4 — Runtime contínuo

### Pastas

- `agent/`
- partes de `channel/`

### Responsabilidade

`agent/`:

- lifecycle do runtime;
- sessão ativa;
- reconnect;
- dialog loop;
- queue;
- `ask_user`;
- health source-of-truth;
- SDK access estratégico;
- ownership do runtime;
- facades públicas do runtime.

`channel/`:

- transporte LLM-A <-> LLM-B;
- bridge de mensagens;
- client estruturado.

### Regra

O `agent/` governa o runtime contínuo, mas não governa todo `src/copilot`.

Ele deve consumir:

- SDK por `sdk/`;
- eventos traduzidos por `event-handlers/`;
- policies por `hooks/`;
- tools por port/facade;
- conversation hub por port/facade;
- observability por eventos/snapshots.

## 3.6 L5 — Estado conversacional e memória

### Pastas

- `conversation-hub/`

### Responsabilidade

- hub sessions;
- turns;
- replay;
- memórias;
- store persistente;
- sincronização store/disco;
- orquestração conversacional.

### Regra

`conversation-hub/` não deve virar lifecycle do `agent/`. O vínculo entre SDK session e hub session
deve ser mediado por façade/port.

## 3.7 L6 — Projeções compartilhadas de borda

### Pastas

- `presentation/`

### Responsabilidade

- runtime targeting;
- request parsing compartilhado;
- projections;
- route deps;
- runtime health/status/controls;
- conversation-hub handlers compartilhados;
- system config/metrics;
- realtime contracts.

### Regra

`presentation/` não é source-of-truth. Ela lê e compõe.

Se `server/` e `terminal/` precisam da mesma forma de um dado, essa forma deve nascer em
`presentation/`.

## 3.8 L7 — Bordas

### Pastas

- `server/`
- `terminal/`

### Responsabilidade

`server/`:

- HTTP;
- middleware;
- rotas;
- SSE/socket;
- serialização web.

`terminal/`:

- REPL;
- comandos;
- prompt/render;
- waiting UX;
- SSE local;
- narrativa operacional.

### Regra

Bordas não governam semântica de runtime. Elas consomem `presentation/` e, quando necessário,
facades públicas estáveis.

## 3.9 Cross-cutting — Observabilidade e auditoria

### Pastas

- `observability/`
- `audit/`
- `logs/`

### Responsabilidade

`observability/`:

- logs;
- métricas;
- tracing;
- timelines;
- observers;
- snapshots observáveis.

`audit/`:

- trilhas de tool calls;
- permissões;
- buffers;
- JSONL;
- compliance.

`logs/`:

- artefatos gerados.

### Regra

Observability e audit consomem sinais. Eles não devem decidir semântica do SDK nem ownership do
runtime.

---

## 4. Fluxos globais canônicos

## 4.1 Fluxo de evento SDK

```text
@github/copilot-sdk SessionEvent
  -> sdk/session/events.js
  -> event-handlers/*
  -> agent/session/event-wirer.js
  -> agent runtime state + EventEmitter compat
  -> events/EventBus
  -> observability/audit/presentation/terminal/server
```

Regra:

- `event-handlers/` traduz;
- `agent/` decide impacto no runtime;
- `events/` nomeia e valida;
- `observability/` coleta;
- `presentation/` projeta;
- bordas renderizam/serializam.

## 4.2 Fluxo de comando de borda

```text
server/terminal
  -> presentation/*
  -> agent/facades ou runtime-facade
  -> agent lifecycle/dialog/messaging/session
  -> sdk/
```

Regra:

- borda não chama internals do `agent`;
- `presentation/` resolve runtime e payload;
- `agent/` executa;
- `sdk/` fornece capability vanilla.

## 4.3 Fluxo de tool execution

```text
sdk session
  -> hooks/ permission + interception
  -> tools/ registry
  -> bridges/ quando externo
  -> audit/ + observability/
  -> event-handlers/ quando SDK emitir evento
  -> agent/ quando afetar runtime
```

Regra:

- `tools/` define tool;
- `hooks/` governa permissão/interceptação;
- `bridges/` adaptam mundo externo;
- `agent/` não deve embutir detalhes de cada tool.

## 4.4 Fluxo de health/status

```text
agent/health-check.js
  -> presentation/runtime-health.js
  -> server routes / terminal commands / observability
```

Regra:

- source-of-truth do runtime health é `agent/`;
- projection compartilhada é `presentation/`;
- borda só serializa/renderiza.

## 4.5 Fluxo de memória e replay

```text
agent/sdk session events
  -> presentation/conversation-hub.js ou ConversationPort
  -> conversation-hub/store*
  -> server/terminal projections
```

Regra:

- `conversation-hub/` é dono de memória e turns;
- `agent/` não deve virar store conversacional.

---

## 5. Relação ideal do `agent/` com áreas críticas

## 5.1 `agent/` e `sdk/`

Hoje:

- `agent/` consome `CopilotClient`, sessions, quota, mode/plan/agents por facades.

Ideal:

- toda capability vanilla nasce em `sdk/`;
- `agent/facades/agent-sdk-access.js` expõe apenas o que é útil para runtime contínuo;
- `presentation/runtime-sdk-session.js` projeta para bordas.

Regra:

> o `agent/` não recria SDK; ele governa uma sessão runtime usando SDK.

## 5.2 `agent/` e `event-handlers/`

Hoje:

- eventos SDK são traduzidos, mas alguns fluxos ainda passam por wiring/emitter.

Ideal:

- `event-handlers/` é primeira fronteira de payload cru;
- `agent/session/event-wirer.js` consome sinais traduzidos;
- `agent/` atualiza estado e emite sinais runtime;
- `observability/` não reinterpreta payload cru.

Regra:

> se o código precisa entender o shape do `SessionEvent`, ele provavelmente pertence a
> `event-handlers/`, não ao `agent/`.

## 5.3 `agent/` e `events/`

Hoje:

- `events/` contém catálogos, constantes e schemas;
- `agent/` ainda emite muitos eventos diretamente.

Ideal compatível:

- eventos novos devem ser registrados em `events/`;
- payloads relevantes ganham schema;
- `agent/event-bridge-map.js` permanece compat;
- não é necessário inverter tudo para domain events agora, mas é obrigatório catalogar.

Regra:

> evento sem dono e sem catálogo vira dívida de observabilidade.

## 5.4 `agent/` e `presentation/`

Hoje:

- `presentation/agent-runtime.js` já resolve runtime default/registrado;
- há projections de health/status/dialog/controls/webhooks/sdk-session.

Ideal:

- `presentation/` é a única camada que server e terminal compartilham para runtime targeting;
- `agent/` não monta payload HTTP;
- `terminal/` não duplica projection compartilhada;
- `server/` não conhece internals do agent.

Regra:

> se dois consumidores de borda precisam da mesma forma do dado, sobe para `presentation/`.

## 5.5 `agent/` e `hooks/`

Hoje:

- `AgentContext` possui `PermissionController`;
- session setup usa hooks e permission handler;
- hooks têm factories e policies próprias.

Ideal:

- `hooks/` define policy de sessão/tool;
- `agent/` injeta e observa o resultado;
- alterações de permission mode passam por façade/port;
- `agent/` não replica composer/interceptor de hooks.

Regra:

> hooks decidem política de SDK/tool; agent decide impacto operacional no runtime.

## 5.6 `agent/` e `tools/`

Hoje:

- `agent/` ainda importa `tools/bootstrap`;
- `session/boot-steps.js` importa `hook-tools` dinamicamente.

Ideal:

- `tools/` define e registra tools;
- `agent/` consome `ToolBootstrapPort`;
- `hook-tools` é capability/port, não dependência dinâmica escondida.

Regra:

> tools são capacidades oferecidas ao SDK; não são camada interna do `agent`.

## 5.7 `agent/` e `conversation-hub/`

Hoje:

- lifecycle importa `CONVERSATION_STORE`;
- ownership/history sync toca hub diretamente.

Ideal:

- `conversation-hub/` continua dono de sessions/turns/memory;
- `agent/` fala por `ConversationSyncPort` ou façade em `presentation/`;
- ownership SDK <-> hub fica em contrato dedicado.

Regra:

> agent mantém sessão runtime; conversation-hub mantém memória conversacional.

## 5.8 `agent/` e `observability/audit`

Hoje:

- agent inicializa collectors e emite eventos;
- observability coleta;
- audit registra tool/permission pipelines.

Ideal:

- `agent/` emite sinais estáveis;
- `observability/` mede/correlaciona;
- `audit/` registra ações sensíveis;
- nenhum dos dois governa lifecycle.

Regra:

> observabilidade não decide; auditoria não executa.

## 5.9 `agent/` e `server/terminal`

Hoje:

- server e terminal já usam parte de `presentation/`, mas ainda há acoplamentos diretos.

Ideal:

- server e terminal consomem `presentation/`;
- acesso direto a `agent/` fica restrito a boot/DI ou compatibilidade documentada;
- UX local fica no terminal;
- HTTP serialization fica no server.

Regra:

> borda não deve conhecer a topologia interna do runtime.

---

## 6. Regras globais de importação

## 6.1 Permitido por direção

```text
core/types/db/config
  <- sdk/events/event-handlers/hooks/tools/bridges/infra
    <- agent/conversation-hub/channel
      <- presentation
        <- server/terminal
```

`observability/` e `audit/` podem ser consumidos transversalmente, mas devem evitar governar
semântica.

## 6.2 Proibições fortes

- `core/` importar qualquer runtime.
- `sdk/` importar `agent/`, `presentation/`, `server/` ou `terminal/`.
- `event-handlers/` montar payload HTTP/terminal.
- `events/` depender de runtime concreto.
- `tools/` depender de `terminal/`.
- `agent/` depender de `server/` ou `terminal/`.
- `server/` depender de `terminal/`.
- `terminal/` depender de routes/middleware do server.

## 6.3 Proibições suaves, com plano de drenagem

- `agent/` importar `tools/` diretamente.
- `agent/` importar `conversation-hub/` diretamente.
- `presentation/` acumular regra de runtime que pertence ao `agent/`.
- `observability/` reinterpretar payload cru do SDK.

---

## 7. Situação ideal global

## 7.1 Arquitetura ideal

```text
L0 Foundation:
  core/ types/ db/

L1 Configuration:
  config/

L2 SDK and events:
  sdk/ events/ event-handlers/

L3 Policies and external capabilities:
  hooks/ tools/ bridges/ plugins/ infra/

L4 Runtime:
  agent/ channel/

L5 Conversation state:
  conversation-hub/

L6 Shared presentation:
  presentation/

L7 Edges:
  server/ terminal/

Cross-cutting:
  observability/ audit/

Generated runtime artifacts:
  logs/ .github/hooks/state/
```

## 7.2 Critérios de sucesso globais

- Cada pasta tem owner claro.
- Cada fluxo SDK cru passa por `event-handlers/`.
- Cada capability vanilla nasce em `sdk/`.
- Cada projection compartilhada nasce em `presentation/`.
- Cada borda só renderiza/serializa.
- `agent/` não vira dono de tools, hub, HTTP ou terminal.
- Eventos novos entram no catálogo.
- Imports proibidos são bloqueados por gate.
- Runtime artifacts não são confundidos com source.

---

## 8. Roadmap global

## Fase G0 — Baseline e gates

Status: **implementado**. O roadmap operacional detalhado e o baseline atualizado vivem no
documento 13. Baseline atual do gate global: `hard=0 soft=0 info=117`.

- Congelar árvore e contagens.
- Criar gate de imports proibidos.
- Criar gate para evento sem catálogo.
- Criar gate para `server -> terminal`.
- Criar gate para `sdk -> presentation/terminal/server`.

## Fase G1 — Eventos e tradução

- Consolidar catálogo `events/catalog.md`.
- Mapear eventos do `agent/` para `events/`.
- Garantir que eventos SDK crus passem por `event-handlers/`.
- Reduzir parsing duplicado em observability/terminal/server.

## Fase G2 — Presentation como camada obrigatória de borda

- Revisar rotas server que chamam agent direto.
- Revisar comandos terminal que duplicam projection.
- Subir projections compartilhadas restantes.
- Padronizar `runtimeId`.

## Fase G3 — Ports para boundaries sensíveis

Status: **primeira onda implementada**. `agent/ports/` concentra tools, hooks, MCP bridge,
conversation-hub e observability. `config/sdk-config-port.js` concentra defaults do SDK consumidos
por configuração.

- `ToolBootstrapPort`.
- `ConversationSyncPort`.
- `InputResolverPort`.
- `AuditPort`.
- `BridgePort` quando necessário.

## Fase G4 — Health e capabilities globais

- Capability map leve do runtime.
- Health por capability.
- Projections globais de readiness.
- Dashboard/terminal/server lendo do mesmo contrato.

## Fase G5 — Runtime artifacts fora do caminho mental de source

- Documentar `.github/hooks/state`.
- Documentar `logs/`.
- Garantir gitignore/retention quando aplicável.
- Evitar docs/plano tratarem artefatos gerados como módulos.

---

## 9. Como o documento do agent se submete a este guia

O documento 11 deve obedecer a estas decisões:

- `agent/` é L4 Runtime, não camada global central.
- `agent/` consome SDK, eventos traduzidos, hooks e tools por contrato.
- `agent/` publica health/status para `presentation/`, não para bordas diretamente como caminho
  preferencial.
- `agent/` deve manter imports para `tools/`, `hooks/`, `bridges/`, `conversation-hub` e
  `observability` concentrados em `agent/ports/`.
- `agent/` não deve criar event system paralelo; deve usar `events/` e `event-handlers/`.
- `agent/` não deve substituir `presentation/` como hub de borda.
- `agent/` não deve assumir memória conversacional; isso é `conversation-hub/`.

---

## 10. Conclusão

O `src/copilot/` já tem peças boas, mas precisa de uma autoridade arquitetural global. O maior risco
não é falta de módulos; é cada módulo evoluir uma versão própria de runtime, evento, projection,
tooling ou memória.

A arquitetura ideal global é uma topologia de responsabilidades:

- `sdk/` define vanilla;
- `event-handlers/` traduz vanilla;
- `events/` nomeia e valida;
- `agent/` governa runtime;
- `conversation-hub/` governa memória conversacional;
- `presentation/` governa acesso compartilhado de borda;
- `server/` e `terminal/` são bordas;
- `observability/` e `audit/` registram e correlacionam;
- `tools/`, `hooks/` e `bridges/` oferecem capacidades sensíveis sob contrato.

Com essa regra, a evolução do `agent/` deixa de ser uma discussão isolada e passa a ser uma peça de
uma arquitetura maior, mais estável e mais fácil de auditar.
