# 13 — `src/copilot`: Arquitetura Global Ideal e Roadmap Detalhado

**Data de atualização**: 2026-04-22  
**Escopo**: todo o diretório `src/copilot/`  
**Documento de origem**:
[12-SRC-COPILOT-ARQUITETURA-GLOBAL.md](./12-SRC-COPILOT-ARQUITETURA-GLOBAL.md)  
**Documentos subordinados**: [10-AGENT-SITUACAO-ATUAL.md](./10-AGENT-SITUACAO-ATUAL.md),
[11-AGENT-SITUACAO-IDEAL.md](./11-AGENT-SITUACAO-IDEAL.md)

> **Leitura correta**: este documento é a versão operacional da arquitetura global ideal. O
> documento 12 estabelece a topologia e o inventário; este documento transforma essa topologia em
> contratos, decisões, gates e roadmap executável para a implementação contínua.

---

## 1. Tese

O `src/copilot/` deve evoluir como uma plataforma local de runtime Copilot, não como um conjunto de
submódulos que crescem por conveniência. A situação ideal é compatível com a arquitetura atual, mas
mais rígida em quatro pontos:

1. **Eventos têm origem, tradução e catálogo claros**.
2. **Bordas acessam o sistema por `presentation/`, não por detalhes internos**.
3. **O SDK é o contrato mestre; o `agent/` governa runtime contínuo e exposição operacional antes de
   `presentation/`, `server/` e `terminal`, sem virar dono da implementação de tools, hooks,
   bridges, memória ou HTTP**.
4. **Gates automatizados protegem as fronteiras antes que a refatoração profunda comece**.

O objetivo não é redesenhar tudo agora. O objetivo é criar uma arquitetura que permita avançar em
ondas sem quebrar a API atual.

---

## 2. Investigações adicionais

## 2.1 Árvore e inventário

O documento 12 congelou a árvore atual de `src/copilot/`, incluindo diretórios, contagem por área e
inventário completo de arquivos. A leitura mais importante é que a arquitetura já tem as peças
certas:

- `sdk/`;
- `events/`;
- `event-handlers/`;
- `agent/`;
- `conversation-hub/`;
- `presentation/`;
- `server/`;
- `terminal/`;
- `tools/`;
- `hooks/`;
- `bridges/`;
- `observability/`;
- `audit/`.

A lacuna não é ausência de módulos. A lacuna é autoridade: cada módulo ainda pode virar um pequeno
centro de decisão se não houver uma linha global mais firme.

## 2.2 Gate de camadas existente

Foi executado:

```bash
npm run analyze:arch:layers
```

Resultado:

```text
✅ Nenhuma violação de camada encontrada.
```

Essa validação é útil, mas insuficiente para a arquitetura ideal. O script
`scripts/check-layer-violations.mjs` ainda usa uma topologia anterior:

```text
core/db -> sdk/audit -> config/observability -> hooks/tools/bridges
  -> agent/conversation-hub/channel -> api -> terminal
```

Pontos ausentes para o desenho atual:

- `presentation/` não aparece como camada explícita;
- `server/` não aparece como borda explícita;
- `event-handlers/` e `events/` não estão posicionados como contrato de eventos;
- `infra/` e `plugins/` aparecem de forma parcial;
- o gate mede somente import ascendente por camada, não regras semânticas como `terminal` depender
  de `presentation` e não de `agent`.

Conclusão: o gate antigo deve continuar existindo, mas a implementação da arquitetura ideal precisa
de um gate global novo, inicialmente em modo relatório.

## 2.3 SSOT de eventos

Foi executado:

```bash
npm run analyze:events:ssot -- --json
```

Resultado resumido:

```text
ssotCount=198
filesScanned=435
findingCount=39
violationCount=0
categoryCounts:
  domain=0
  legacy-emitter=0
  node-process=9
  ui-local=4
  infra-local=26
```

O auditor foi aprofundado para separar achados de eventos por família:

- `domain`: evento de domínio Copilot fora do SSOT;
- `legacy-emitter`: evento legado/local de `EventEmitter` que deve ter constante ou projection;
- `node-process`: `SIGTERM`, `SIGINT`, `SIGHUP`, `uncaughtException` e similares;
- `ui-local`: eventos locais como `activity:changed` e `phase:changed`;
- `infra-local`: streams, sockets, HTTP, readline e eventos Node de infraestrutura.

Leitura arquitetural:

- `events/` já é forte como SSOT;
- `node-process`, `ui-local` e `infra-local` agora são visíveis sem virar violação de domínio;
- os 20 `legacy-emitter` acionáveis iniciais foram drenados para constantes em
  `events/emitter-events.js`;
- `terminal/` ainda conhece eventos do `agent/` em alguns fluxos, mas agora por constantes do SSOT;
- `presentation/` deve absorver mais projections de runtime para reduzir listeners diretos de borda.

## 2.4 Grafo de fluxo de eventos

Foi executado:

```bash
npm run analyze:events:flow:json
```

Resultado resumido:

```text
totalEmits=9
totalListeners=52
uniqueEmitEvents=4
uniqueListenEvents=28
modules=agent,config,presentation,terminal,bridges,channel,db,infra,observability,sdk,server,tools
```

Leitura arquitetural:

- há muito mais escuta que emissão catalogada;
- a emissão canônica ainda não representa toda a vida do sistema;
- existem consumidores demais ligados a eventos sem uma projection comum;
- o caminho ideal é aumentar a emissão de eventos canônicos e reduzir listeners diretos de borda.

## 2.5 Imports reais observados

A leitura de imports entre áreas mostra um estado intermediário, mas já com avanço material da Fase
0 para a Fase 3:

- `server/` já usa muito `presentation/`, especialmente em rotas de health, agent, config,
  observability, memory, SDK e webhooks.
- `terminal/` também já usa `presentation/` em comandos, frontend e dialog.
- `presentation/agent-runtime.js` já encapsula a topologia `getAgent()` + runtime registry.
- `agent/index.js` ainda reexporta muitos subsistemas internos.
- `agent/ports/` agora é o ponto explícito de composição para `tools/`, `hooks/`, `bridges/`,
  `conversation-hub/` e `observability/`.
- `agent/agent-context.js` deixou de instanciar `PermissionController` via import direto de `hooks/`
  e passou a usar `createAgentPermissionController()`.
- `agent/lifecycle/session-setup.js`, `agent/session/boot-steps.js`,
  `agent/lifecycle/agent-lifecycle.js`, `agent/session/hook-context.js` e `agent/lifecycle/entry.js`
  deixaram de atravessar diretamente tools, hooks, MCP bridge e hub.
- `agent/state/agent-state.js` e `agent/infra/index.js` usam snapshot de observabilidade pelo
  `observability-port`.
- `config/sdk-config-port.js` centraliza os poucos defaults do SDK que ainda pertencem ao domínio de
  configuração.
- `presentation/agent-http-errors.js` importa `agent/error-policy.js`, que é aceitável no curto
  prazo, mas deve virar um contrato público de erro do runtime.

Conclusão: a base já aponta para a arquitetura ideal, e o maior ruído de fronteira do `agent/` foi
isolado em ports. O próximo gargalo arquitetural deixou de ser import direto e passou a ser
contrato: reduzir a superfície pública de `agent/index.js`, consolidar projections em
`presentation/` e preparar capability map/runtime façade.

## 2.6 Baseline inicial do gate global

Após a criação do gate global inicial, foi executado:

```bash
npm run analyze:arch:global
```

Resultado resumido:

```text
hard=0
soft=48
info=104
total=152
```

A violação `hard` inicial era:

```text
src/copilot/terminal/index.js:29 terminal -> server
```

Leitura arquitetural:

- este acoplamento é compreensível no estado atual porque o terminal ainda inicializa o servidor
  local;
- na situação ideal, esse bootstrap deve ser tratado como composição de aplicação, não como
  dependência direta da borda terminal para o módulo server;
- esse acoplamento foi removido movendo a composição para `bootstrap.js`, que injeta
  `startCopilotServer` em `startTerminalServer()`;
- `terminal/` permanece dono da UX/REPL, enquanto o composition root conhece `terminal/` e
  `server/`.

## 2.7 Taxonomia dura de host

Uma fonte recorrente de ambiguidade era a palavra `host`. A arquitetura ideal agora precisa tratá-la
como termo técnico contextual, e não como sinônimo genérico de "coisa principal":

- `boot host`: composição operacional que sobe o runtime local;
- `process host`: borda Node/IPC/sinais do runtime compatível;
- `HTTP host`: `server/`;
- `UX host`: `terminal/`;
- `runtime host`: `AlwaysAliveAgent` como runtime contínuo;
- `DialogHost` / `DialogLoopHost` / `DialogTurnHost`: adapters progressivamente menores de
  capability dentro de `agent/`.

Regra estrutural: módulos internos do `agent/` não devem depender do runtime inteiro quando um host
menor resolve o problema. "Host" no hot path significa capability adapter.

Os `soft` iniciais confirmam a hipótese do documento 12: o grosso do trabalho não é `server` e
`terminal`, que já usam bastante `presentation/`; o grosso está em fronteiras sensíveis do `agent/`
com `observability/`, `tools/`, `hooks/`, `bridges/` e `conversation-hub/`.

## 2.7 Baseline após Fase 0 inicial

Após a primeira implementação da Fase 0:

```text
analyze:events:ssot:
  ssotCount=198
  violationCount=0
  findingCount=39

analyze:arch:global:
  hard=0
  soft=48
  info=104
  total=152

analyze:arch:layers:
  sem violações
```

O próximo trabalho deixou de ser "limpar ruído". Agora é reduzir os 48 `soft` reais, começando por
`agent -> tools/hooks/bridges/conversation-hub` via ports. O soft isolado `terminal -> agent/types`
foi drenado para typedef JSDoc de bloco, sem dependência runtime de borda para `agent/`.

## 2.8 Baseline após drenagem de fronteiras quentes

Após a primeira onda ampla de ports e ajustes de composição:

```text
analyze:arch:global:strict:
  hard=0
  soft=0
  info=117
  total=117

analyze:events:ssot:strict:
  ssotCount=198
  violationCount=0
  findingCount=39
  filesScanned=443

typecheck:strict:src.copilot:
  sem erros
```

Mudanças arquiteturais consolidadas:

- `terminal -> server` deixou de existir: `bootstrap.js` é o composition root que injeta
  `startCopilotServer` em `startTerminalServer()`.
- `agent/ports/tool-port.js` concentra bootstrap de tools, sessão RPC, sessão experimental, hub de
  tools e resolução de input do usuário.
- `agent/ports/mcp-port.js` concentra `buildMcpTools`, configuração MCP e auto-reconnect.
- `agent/ports/hook-port.js` concentra hooks e bus default.
- `agent/ports/permission-port.js` concentra o `PermissionController` separado dos hooks de sessão
  para evitar carregamento eager de defaults do SDK em fluxos que só montam hooks.
- `agent/ports/conversation-port.js` concentra acesso ao store conversacional.
- `agent/ports/observability-port.js` concentra logs, spans, métricas, error tracker, collectors e
  snapshots de status.
- `config/sdk-config-port.js` concentra defaults do SDK consumidos por configuração e system prompt.
- `types/index.js` documenta `events/legacy-events.js` como contrato de barrel, não como dependência
  acidental.

Interpretação:

- o gate global agora é suficientemente estável para rodar em modo `--strict` contra violações
  `hard`;
- `soft=0` não significa arquitetura final, mas significa que os acoplamentos sensíveis conhecidos
  agora têm dono explícito;
- o próximo trabalho deve avançar de "corrigir grafo de imports" para "corrigir contratos de
  runtime": façade, capability map, projections e decomposição gradual do dialog/lifecycle.

## 2.9 Baseline após capability map inicial

A primeira fatia da Fase 4 foi implementada sem trocar o runtime atual:

- `presentation/runtime-capabilities.js` passou a ser a projection canônica das capabilities do
  runtime.
- `agent/facades/agent-runtime-capabilities.js` passou a concentrar a leitura semântica do mapa de
  capabilities, mantendo `presentation/` como projection de borda.
- `server/routes/copilot-api/control.js` expõe `GET /capabilities`.
- O payload inclui metadata de runtime (`runtimeId`, `requestedRuntimeId`, fallback) no mesmo padrão
  de `/status` e `/session`.
- O mapa inicial classifica capabilities por camada:
  - `runtime.lifecycle`;
  - `runtime.queue`;
  - `sdk.client`;
  - `sdk.session`;
  - `sdk.resources`;
  - `dialog.loop`;
  - `io.pending-question`;
  - `governance.permissions`;
  - `integration.webhooks`;
  - `integration.handoff`;
  - `observability.health`;
  - `observability.quota`;
  - `recovery.boot`.

Gate executado após a mudança:

```text
typecheck:strict:src.copilot:
  sem erros

analyze:arch:global:strict:
  hard=0
  soft=0
  info=117
  total=117

analyze:events:ssot:strict:
  ssotCount=198
  violationCount=0
  findingCount=39
  filesScanned=445

analyze:arch:layers:
  sem violações

tests/unit/copilot/test_agent_health_routes.spec.js:
  9 testes passando

suíte focada src/copilot:
  10 arquivos
  90 testes passando
```

Interpretação:

- o sistema agora tem um primeiro contrato listável de runtime, sem exigir que bordas conheçam
  métodos individuais do `AlwaysAliveAgent`;
- `presentation/` ganhou responsabilidade de projection, não de decisão operacional;
- o próximo passo natural é fazer `terminal/` e dashboards consumirem esse contrato quando
  precisarem explicar status/capabilities, em vez de remontar heurísticas locais.

## 2.10 Baseline após primeira extração Fase 5 do dialog

A primeira fatia de baixo risco da Fase 5 foi implementada sem alterar a API pública do
`DialogLoopManager`:

- `agent/dialog/cost-ledger.js` passou a concentrar o ledger de PRs consumidos por boot/resume.
- `agent/dialog/compaction-policy.js` passou a concentrar a decisão de compaction proativa/crítica.
- `agent/dialog/state-machine.js` passou a concentrar a FSM em memória de
  `active/stopping/paused/resuming`.
- `agent/dialog/resume-policy.js` passou a decidir Estratégia A/B de resume sem aplicar side
  effects.
- `agent/dialog/watchdog-supervisor.js` passou a concentrar a instância viva do watchdog, incluindo
  start, stop, ping e descarte.
- `DialogLoopManager` mantém a orquestração, emissão de eventos e persistência, mas deixou de ser
  dono direto dos contadores, do dedupe de compaction, da seleção de estratégia de resume e da
  materialização do watchdog.
- O sub-barrel `agent/dialog/index.js` expõe esses contratos para testes e evolução incremental.
- `agent/facades/index.js` passou a ser o barrel canônico das façades modernas; `agent/index.js`
  reexporta uma lista explícita compatível em vez de espalhar `export *` por cada façade.

Gate executado após a mudança:

```text
typecheck:strict:src.copilot:
  sem erros

analyze:arch:global:strict:
  hard=0
  soft=0
  info=117
  total=117

analyze:events:ssot:strict:
  ssotCount=198
  violationCount=0
  findingCount=39
  filesScanned=451

analyze:arch:layers:
  sem violações

tests/unit/copilot/test_loop_manager.spec.js +
tests/unit/copilot/test_always_alive_dialog_loop.spec.js +
tests/unit/copilot/test_dialog_watchdog.spec.js +
tests/unit/copilot/test_agent_health_routes.spec.js:
  97 testes passando
```

Interpretação:

- a Fase 5 começou pelo caminho recomendado no documento 11: extrações pequenas, testadas e
  compatíveis;
- o dialog loop fica mais fino sem troca de protocolo, sem novo kernel e sem mudança de evento;
- a próxima extração natural ainda no dialog é reduzir side effects duplicados de persistência em
  helpers de aplicação de estratégia, porque o supervisor de watchdog já saiu do manager.

## 2.11 Baseline após permissões SDK-first e borda semântica do AgentContext

A segunda fatia ampla após a extração inicial da Fase 5 reforçou duas regras de longo prazo:

- o SDK é o contrato mestre para permissões;
- o `agent` é a autoridade operacional interna imediatamente abaixo do SDK, antes de servidor,
  terminal, tools ou presentation.

Mudanças consolidadas:

- `PermissionController` agora entrega ao SDK um `PermissionHandler` estável; `setMode()` troca a
  policy delegada por esse handler, fazendo sessões vivas usarem a nova policy nas próximas
  requisições de permissão.
- `createPermissionHandler()` em `hooks/permission-handler.js` passou a aceitar
  `PermissionRequestResult` canônico do SDK em `onRequest`, além dos atalhos legados
  `true`/`false`/`'deny'`.
- `denyKinds` foi adicionado como dimensão SDK-first para negar por `PermissionRequest.kind`
  (`shell`, `write`, `mcp`, etc.) antes de allowlists/denylists por nome de tool.
- `createSafePermission()` e o modo `selective` com `denyShell` passaram a negar primeiro pelo kind
  `shell` do SDK, preservando a denylist nominal como compatibilidade.
- `sdk/session/permissions.js` recebeu a mesma semântica `denyKinds`, mantendo a camada SDK wrapper
  alinhada ao pacote `@github/copilot-sdk`.
- `AgentContext` ganhou operações semânticas para permission handler/mode, tool registry, handoff,
  dialog loop, webhooks e cache de mensagens, reduzindo acesso direto a managers vivos nos callers
  quentes.
- `AlwaysAliveAgent`, `session-setup`, `agent-lifecycle`, `agent-state`, façades e event bridge
  passaram a preferir essas operações semânticas.

Gate executado após a mudança:

```text
typecheck:strict:src.copilot:
  sem erros

analyze:arch:global:strict:
  hard=0
  soft=0
  info=117
  total=117

analyze:events:ssot:strict:
  ssotCount=198
  violationCount=0
  findingCount=39
  filesScanned=451

analyze:arch:layers:
  sem violações

suíte focada:
  9 arquivos
  242 testes passando
  3 testes skipped legados
```

Interpretação:

- a política de permissões deixou de ser "nome de tool first" e passou a seguir o shape do SDK;
- o agent mantém compatibilidade pública, mas fica mais apto a governar runtime/capabilities sem
  expor managers crus;
- o próximo passo natural é retirar a construção concreta do `PermissionController` do construtor do
  `AgentContext`, injetando-a por factory de runtime/capability.

## 2.12 Baseline após factory set do AgentContext

A decisão arquitetural foi validada e aplicada com um padrão geral:

- `agent/ports/*` continua sendo a fronteira para capacidades externas ao agent;
- `agent/context-factories.js` passa a ser o ponto de materialização default dos managers vivos do
  `AgentContext`;
- `AgentContext` recebe overrides estreitos via `options.factories`;
- `agent/facades/*` continua responsável por capabilities públicas consumidas por bordas.

Mudança consolidada:

- `PermissionController` saiu da construção concreta dentro do construtor de `AgentContext`.
- `createPermissions()` agora é uma factory do conjunto `AgentContextFactories`.
- O contrato `AgentPermissionController` foi estreitado para a superfície exigida pelo agent:
  `getMode()`, `setMode()` e `handler`.
- `resetToolsRegistry()` passou a usar a factory governada pelo contexto, preservando overrides de
  runtime/teste.
- O padrão ficou documentado também em `src/copilot/agent/README.md`.

Gate executado após a mudança:

```text
tests/unit/copilot/test_agent_context.spec.js +
tests/unit/copilot/test_permission_controller.spec.js +
tests/unit/copilot/test_hooks_module.spec.js +
tests/unit/copilot/sdk/test_sdk_permissions.spec.js +
tests/unit/copilot/test_session_setup.spec.js +
tests/unit/copilot/test_agent_dialog_controller.spec.js +
tests/unit/copilot/test_always_alive_dialog_loop.spec.js +
tests/unit/copilot/test_loop_manager.spec.js +
tests/unit/copilot/test_agent_health_routes.spec.js:
  243 testes passando
  3 testes skipped legados

typecheck:strict:src.copilot:
  sem erros

analyze:arch:global:strict:
  hard=0
  soft=0
  info=117
  total=117

analyze:events:ssot:strict:
  ssotCount=198
  violationCount=0
  findingCount=39
  filesScanned=452

analyze:arch:layers:
  sem violações
```

Interpretação:

- a injeção por factory é a arquitetura mais coerente aqui porque preserva o agent como mestre
  operacional sem acoplar o contexto à classe concreta de permissions;
- o padrão evita um container genérico dentro do runtime e cria uma trilha incremental para migrar
  outros managers (`DialogLoopManager`, `MessageQueue`, `WebhookManager`, `HandoffManager`) quando
  houver benefício real;
- o próximo passo natural é promover readiness/metadata dessas factories para o capability map,
  começando por `governance.permissions`.

## 2.13 Baseline após factory metadata no capability map

O padrão de factories deixou de ser apenas mecanismo de construção e passou a alimentar o mapa de
capabilities com metadata de origem/autoridade.

Mudanças consolidadas:

- `AgentContextFactories` ganhou `describeFactorySet()`.
- `AgentContext` expõe `getContextFactoryCapabilitiesSnapshot()` com cópia defensiva da metadata das
  factories.
- `AlwaysAliveAgent` repassa esse snapshot sem expor o contexto cru.
- `governance.permissions` agora usa `getPermissionCapabilitySnapshot()` para reportar:
  - modo;
  - disponibilidade do handler;
  - provider/factory;
  - `sdkFirst`;
  - `stableHandler`;
  - autoridade operacional (`agent`).
- `runtime.queue`, `dialog.loop`, `integration.webhooks` e `integration.handoff` passaram a incluir
  provider/factory/runtimeAuthority no capability map.

Gate executado após a mudança:

```text
suíte focada:
  9 arquivos
  244 testes passando
  3 testes skipped legados

typecheck:strict:src.copilot:
  sem erros

analyze:arch:global:strict:
  hard=0
  soft=0
  info=117
  total=117

analyze:events:ssot:strict:
  ssotCount=198
  violationCount=0
  findingCount=39
  filesScanned=452

analyze:arch:layers:
  sem violações
```

Interpretação:

- readiness continua pertencendo às façades/capabilities, não às factories;
- factories explicam origem e autoridade dos componentes vivos;
- o próximo passo natural é usar essa mesma metadata para separar `ToolBootstrapPort` de
  `ToolRuntimePort`, expondo tools como capability explícita sem abrir `tools/` para bordas.

## 2.14 Baseline após transição de tools e SDK session para facades semânticas

A varredura de `presentation/`, `server/` e `terminal/` mostrou dois pontos ainda crus:

- `/sdk/tools` e `/sdk/agent/tools` ainda liam `agent.toolsRegistry.entries` diretamente;
- `presentation/runtime-sdk-session.js` ainda resolvia `runtimeId` e chamava operações vanilla de
  `mode/plan` no agent sem uma façade agent-level explícita.

Mudanças consolidadas:

- `AgentContext` ganhou `getToolRegistryEntriesSnapshot()`, uma projeção serializável do registry
  vivo, preservando `getToolRegistrySnapshot()` apenas como compatibilidade interna/controlada.
- `AlwaysAliveAgent` passou a expor `getToolRegistrySnapshot()` e `getToolRegistryEntriesSnapshot()`
  como operações semânticas.
- `agent/facades/agent-runtime-tools.js` virou a leitura canônica de tools do runtime, com fallback
  estático somente para endpoints globais antes do boot.
- `presentation/runtime-tools.js` ficou responsável apenas por formato de borda: projection, filtro
  por categoria e paginação.
- `/sdk/tools` e `/sdk/agent/tools` passaram a consumir `presentation/runtime-tools.js`, sem abrir
  `toolsRegistry.entries` em `server/`.
- `agent/facades/agent-sdk-session.js` passou a concentrar as operações agent-level de `mode/plan`;
  `presentation/runtime-sdk-session.js` agora só resolve o runtime alvo e delega.
- `tools.registry` entrou no `describeFactorySet()` e no capability map com provider/factory,
  `sdkFirst` e `runtimeAuthority`.

Critério confirmado:

- `sdk/` define contratos vanilla e wrappers do pacote;
- `agent/` é a autoridade operacional sobre sessão viva, registry vivo, permissões, `mode/plan` e
  capabilities;
- `presentation/` seleciona runtime e formata payloads de borda;
- `server/` e `terminal/` não devem ler managers vivos nem reconstruir semântica do SDK.

Refinamento posterior:

- a configuração declarativa de skills/tools (`skills.json`, allowlist/denylist e custom tool
  definitions) não pertence a `presentation/`; pertence a `config/`;
- `presentation/system-config.js` deve apenas adaptar essas operações para shape de borda
  (`HandlerResult`, status, payload normalizado), sem ler arquivos nem falar com SDK/config ports
  diretamente;
- quando skills/tools deixam de ser declaração e entram no registry vivo da sessão, a autoridade
  passa para `agent/`, não para `presentation/`.

Gate executado após a mudança parcial:

```text
tests/unit/copilot/test_agent_runtime_tools.spec.js +
tests/unit/copilot/test_sdk_runtime_projection_routes.spec.js +
tests/unit/copilot/test_presentation_runtime_sdk_session.spec.js +
tests/unit/copilot/test_agent_context.spec.js +
tests/unit/copilot/test_agent_health_routes.spec.js +
tests/unit/copilot/test_agent_sdk_access.spec.js +
suíte focada de permissions/dialog/session setup:
  261 testes passando
  3 testes skipped legados

typecheck:strict:src.copilot:
  sem erros

analyze:arch:global:strict:
  hard=0
  soft=0
  info=117
  total=117

analyze:events:ssot:strict:
  ssotCount=198
  filesScanned=455
  violationCount=0
  findingCount=39

analyze:arch:layers:
  sem violações
```

Interpretação:

- não há mais leitura crua de `toolsRegistry.entries` em `server/` ou `presentation/`;
- `presentation/` ainda pode expor plan/mode, mas não é dona da operação SDK;
- `tools.registry` deixou de ser inferido como detalhe de `sdk.resources` e virou capability
  explícita do runtime.

## 2.15 Baseline após fechamento de fronteiras `presentation/config/server/terminal`

A pergunta nova foi: se `presentation/` é contrato de borda, por que skills ainda poderiam morar
ali? A resposta final é: **não podem**. Skills declarativas são configuração; skills efetivas do
runtime são autoridade do agent; `presentation/` só pode projetar e envelopar.

Mudanças consolidadas:

- `config/declarative-runtime-config.js` passou a ser o dono de `skills.json`, allowlist/denylist de
  tools e custom tool definitions. Ele centraliza leitura/escrita declarativa e usa o port de
  configuração SDK quando o dado ainda vem da configuração compatível com o SDK.
- `presentation/system-config.js` deixou de ler arquivo, parsear JSON e importar SDK/config port
  diretamente. Agora é apenas adapter de borda sobre `config/`, retornando `HandlerResult`.
- `presentation/types.js` removeu a dependência de typedefs de `terminal/handlers/shared.js`.
  `presentation/` não tipa mais seus contratos a partir da borda terminal.
- `server/routes/sdk/deps.js` virou o composition point das rotas SDK HTTP. Assim,
  `presentation/runtime-request.js` e `runtime-route-deps.js` não carregam mais client SDK, tools
  globais ou wiring específico de rota.
- `runtime-wiring.js` virou o composition root compartilhado do Copilot. `terminal/index.js` não
  registra DI nem importa `agent/`; recebe `wireRuntime` do bootstrap.
- `presentation/runtime-models.js` passou a projetar catálogo/model stats/model selection usando
  façade de `agent/`. O terminal deixou de importar `#copilot/sdk` para modelos.
- `presentation/runtime-overview.js` ganhou projection sem instância viva do agent para bordas.
  `terminal/frontend/*` deixou de carregar o `AlwaysAliveAgent` como objeto e passou a consumir
  campos serializáveis de runtime.
- `presentation/runtime-controls.js` passou a expor operações e event host semântico para start,
  abort, pending question e eventos do runtime. Watchdog, restart, reflection loop e listeners do
  terminal agora usam esse contrato em vez de chamar métodos/propriedades crus do agent.
- `terminal/` deixou de importar `tools/todo/store.js`; o cleanup de TODO é injetado pelo
  `bootstrap.js`, e a leitura diagnóstica de TODO passou por `agent/ports/todo-port.js` ->
  `agent/facades/agent-runtime-todos.js` -> `presentation/runtime-todos.js`.
- Tipos JSDoc do terminal deixaram de apontar para `#copilot/agent/types` e `#copilot/sdk/types`.
  Contratos estruturais de borda foram movidos para `presentation/types.js`.
- O auditor global passou a tratar como violação hard: `terminal -> agent/sdk/tools`,
  `presentation -> sdk`, `server -> agent`, `server -> sdk/tools` fora de `server/routes/sdk/*`, e
  `config -> sdk` fora de `config/sdk-config-port.js`.
- `server/routes/copilot-api/*` deixou de declarar localmente `AlwaysAliveAgentLike` e resolvers
  próprios. Todas as rotas comuns agora usam `CopilotApiRouteDeps` e
  `resolveCopilotApiRouteBinding()` de `presentation/`.
- `presentation/runtime-sdk-session.js` e `presentation/runtime-models.js` deixaram de usar typedefs
  do wrapper SDK em JSDoc; seus contratos são `presentation/types.js`.
- `config/custom-agents.js` e `config/system-prompt*` deixaram de importar typedefs do wrapper SDK.
  A camada declarativa agora publica objetos estruturais compatíveis com o SDK e deixa a validação
  final para o adapter de sessão.
- O auditor global ganhou regra de conteúdo: JSDoc também conta como fronteira. Typedefs de
  `terminal/`, `presentation/`, `server/routes/copilot-api/*` e `config/` não podem reabrir
  `agent/sdk/tools` por baixo do radar.

Contratos fechados:

- `config/` é dono de configuração declarativa. Pode usar ports internos de compatibilidade com o
  SDK em `config/sdk-config-port.js`, mas não decide runtime nem session.
- `agent/` é dono de sessão viva, registry vivo, permissões efetivas, model selection do runtime,
  `mode/plan`, loop e capabilities.
- `presentation/` é dono de projections e comandos compartilhados por bordas. Pode chamar façades
  públicas do `agent/` e operações públicas de `config/`; não pode possuir persistência declarativa,
  abrir managers vivos, importar SDK cru ou importar `server/`/`terminal/`.
- `server/` é borda HTTP. Rotas comuns passam por `presentation/`. Rotas em `server/routes/sdk/*`
  são adapter HTTP do SDK e podem importar `sdk/` porque essa é a função da pasta; quando expõem
  visão runtime do agent, devem voltar para projection/façade.
- `terminal/` é borda local/REPL. Não importa `agent/` ou `sdk/` para decisões de runtime; consome
  projections próprias ou de `presentation/` e recebe wiring por injeção do bootstrap. Tipos JSDoc
  podem referenciar contratos compartilhados, mas não podem servir para recuperar instância viva.
- `tools/` é capacidade. Se uma borda precisa observar estado de tool, o caminho é port/façade no
  `agent/` e projection em `presentation/`, nunca import direto da borda.
- `runtime-wiring.js` e `bootstrap.js` são composition roots. Eles podem conhecer módulos altos
  porque compõem o grafo, mas não implementam regra de domínio nem viram nova camada operacional.

Critério sem exceções:

```text
Declaração em repouso      -> config/
Estado vivo do SDK/runtime -> agent/
Formato para borda         -> presentation/
Transporte HTTP/SSE        -> server/
UX local/REPL              -> terminal/
Composição do processo     -> bootstrap/runtime-wiring
```

Gates executados após a drenagem:

```text
tests/unit/copilot/terminal/test_handlers_system_config.spec.js +
tests/unit/copilot/test_agent_runtime_tools.spec.js +
tests/unit/copilot/test_sdk_runtime_projection_routes.spec.js +
tests/unit/copilot/test_agent_context.spec.js +
tests/unit/copilot/test_agent_health_routes.spec.js +
tests/unit/copilot/test_presentation_runtime_request.spec.js +
tests/unit/copilot/test_presentation_runtime_route_deps.spec.js +
tests/unit/copilot/test_terminal_frontend_primary.spec.js +
tests/unit/copilot/test_terminal_runtime_frontend.spec.js +
tests/unit/copilot/test_presentation_runtime_sdk_session.spec.js:
  86 testes passando

typecheck:strict:src.copilot:
  sem erros

analyze:arch:global:strict:
  hard=0
  soft=0
  info=113
  total=113

analyze:events:ssot:strict:
  ssotCount=198
  filesScanned=462
  violationCount=0
  findingCount=39

analyze:arch:layers:
  sem violações
```

## 2.16 Baseline após endurecimento textual de fronteiras

A nova avaliação geral mostrou que import runtime já estava limpo nas bordas principais, mas ainda
havia um resíduo importante: contratos JSDoc podiam apontar para tipos crus do SDK wrapper e criar
dependência conceitual mesmo sem `import` executável. A situação ideal mais dura passou a ser:

```text
Import runtime proibido também é typedef proibido.
Contrato de borda mora na própria camada de borda/projection.
Configuração declarativa publica estrutura compatível, não tipo interno do runtime.
```

Implementado:

- `scripts/check-copilot-global-architecture.mjs` agora acusa como hard:
  - JSDoc de `terminal/` para `agent/sdk/tools`;
  - JSDoc de `presentation/` para o SDK wrapper;
  - JSDoc/tipos locais de `server/routes/copilot-api/*` para `agent/types` ou SDK wrapper;
  - JSDoc de `config/` para SDK wrapper fora de `config/sdk-config-port.js`.
- `presentation/runtime-sdk-session.js` usa `RuntimeSdkModeResult` e `RuntimeSdkPlanReadResult`.
- `presentation/runtime-models.js` usa `RuntimeModelInfo`.
- `config/system-prompt.js` e `config/system-prompt/index.js` definem uma união discriminada local
  para `SystemMessageConfig`, preservando compatibilidade com `exactOptionalPropertyTypes`.
- `config/custom-agents.js` define `SdkCustomAgentConfig` estrutural local para os agentes
  declarativos enviados ao SDK.

Conferência textual executada:

```text
terminal:
  sem referências a agent/sdk/tools internos

server/routes/copilot-api + config:
  sem referências a agent types, SDK wrapper ou aliases locais de AlwaysAliveAgent

presentation:
  sem referências ao SDK wrapper
```

Gates executados após o endurecimento:

```text
tests/unit/copilot/test_agent_runtime_tools.spec.js +
tests/unit/copilot/test_sdk_runtime_projection_routes.spec.js +
tests/unit/copilot/test_agent_context.spec.js +
tests/unit/copilot/test_agent_health_routes.spec.js +
tests/unit/copilot/terminal/test_handlers_system_config.spec.js +
tests/unit/copilot/test_presentation_runtime_request.spec.js +
tests/unit/copilot/test_presentation_runtime_route_deps.spec.js +
tests/unit/copilot/test_terminal_frontend_primary.spec.js +
tests/unit/copilot/test_terminal_runtime_frontend.spec.js +
tests/unit/copilot/test_presentation_runtime_sdk_session.spec.js +
tests/unit/copilot/test_copilot_api_runtime_errors.spec.js:
  92 testes passando

typecheck:strict:src.copilot:
  sem erros

analyze:arch:global:strict:
  hard=0
  soft=0
  info=113
  total=113

analyze:events:ssot:strict:
  ssotCount=198
  filesScanned=462
  violationCount=0
  findingCount=39

analyze:arch:layers:
  sem violações
```

Interpretação:

- a fronteira deixou de ser apenas "não importar em runtime" e passou a ser "não depender nem em
  contrato";
- `server/routes/sdk/*` permanece como adapter SDK isolado, enquanto rotas comuns só enxergam
  `presentation/`;
- a próxima dureza natural é reduzir os `info` de composição em `agent/ports/*` com ports ainda mais
  estreitos, começando por observability e conversation-hub.

## 2.17 Baseline após drenagem de estado vivo em `presentation/`

A avaliação seguinte apertou a regra: não basta `presentation/` não importar SDK cru; ela também não
deve ler propriedades vivas da instância do agent (`agent.status`, `agent.model`,
`agent.dialogLoopActive`, `agent.lastPrInfo`, etc.). A camada pode resolver o runtime e formatar
payloads, mas a leitura semântica do estado vivo pertence ao `agent/`.

Implementado:

- `agent/facades/agent-runtime-controls.js` passou a expor:
  - `readRuntimeControlState()`;
  - `readRuntimeInteractionState()`;
  - `readRuntimePrBudgetSnapshot()`;
  - operações semânticas para start/abort/answer/clear/pause/resume/event host.
- `agent/facades/agent-model-config.js` passou a expor:
  - `readRuntimeModelSelection()`;
  - `setRuntimeModel()`;
  - `setRuntimeReasoningEffort()`.
- `agent/facades/agent-runtime-status.js` passou a expor `readAgentRuntimeSdkResourceSnapshot()`.
- `presentation/runtime-controls.js`, `runtime-models.js`, `runtime-overview.js`,
  `runtime-health.js`, `system-config.js`, `system-metrics.js`, `sdk-sessions.js` e
  `agent-runtime.js` foram migrados para essas façades.
- `scripts/check-copilot-global-architecture.mjs` agora marca como hard qualquer leitura crua em
  `presentation/` de campos vivos típicos do agent/runtime: `status`, `model`, `sessionId`,
  `dialogLoopActive`, `dialogPaused`, `queueSize`, `reasoningEffort`, `lastPrInfo`,
  `dialogPrMetrics` e estados de pending question.

Conferência textual executada:

```text
presentation:
  sem leituras diretas de agent/runtime state proibido
```

Gates executados após a drenagem:

```text
tests/unit/copilot/test_agent_runtime_tools.spec.js +
tests/unit/copilot/test_sdk_runtime_projection_routes.spec.js +
tests/unit/copilot/test_agent_context.spec.js +
tests/unit/copilot/test_agent_health_routes.spec.js +
tests/unit/copilot/terminal/test_handlers_system_config.spec.js +
tests/unit/copilot/test_presentation_runtime_request.spec.js +
tests/unit/copilot/test_presentation_runtime_route_deps.spec.js +
tests/unit/copilot/test_terminal_frontend_primary.spec.js +
tests/unit/copilot/test_terminal_runtime_frontend.spec.js +
tests/unit/copilot/test_presentation_runtime_sdk_session.spec.js +
tests/unit/copilot/test_copilot_api_runtime_errors.spec.js:
  92 testes passando

typecheck:strict:src.copilot:
  sem erros

analyze:arch:global:strict:
  hard=0
  soft=0
  info=113
  total=113

analyze:events:ssot:strict:
  ssotCount=198
  filesScanned=462
  violationCount=0
  findingCount=39

analyze:arch:layers:
  sem violações
```

Interpretação:

- `presentation/` agora é projection de verdade: seleciona runtime, chama façades semânticas e
  envelope payloads;
- o `agent` ficou mais claramente mestre sobre estado vivo depois do SDK;
- a próxima etapa natural é fazer o mesmo endurecimento para `server/routes/sdk/*`, separando o que
  é adapter SDK puro do que é projection runtime.

## 2.18 Baseline final antes de sincronização

O fechamento desta rodada validou a arquitetura endurecida em suíte ampla, não apenas em recortes
locais. A diretriz aplicada foi: SDK como fonte mestre, agent como autoridade de runtime depois do
SDK, `presentation/` como projection sem estado vivo cru e bordas consumindo contratos estáveis.

Endurecimentos finais:

- `config/sdk-config-port.js` passou a importar do barrel canônico `#copilot/sdk`, preservando um
  único ponto explícito para defaults/handlers/configs do SDK e evitando bypass por submódulos do
  SDK.
- `readAgentRuntimeStatusSnapshot()` ficou tolerante a runtimes de compatibilidade/mocks sem
  `getStatusSnapshot()` e normaliza campos ausentes a partir do objeto vivo apenas dentro da façade
  do `agent`.
- testes estruturais de background tasks passaram a reconhecer `context-factories.js` como ponto de
  materialização dos managers, mantendo `AgentContext` como host governado e não como construtor
  concreto.
- testes de terminal e presentation foram atualizados para consumir a mesma malha de façades que as
  bordas reais usam, incluindo metadata SDK de modelos e store real de todos com override parcial.

Gates finais executados:

```text
npx vitest run tests/unit/copilot:
  264 arquivos passados
  18 arquivos skipped
  3988 testes passados
  28 testes skipped
  4016 testes totais

typecheck:strict:src.copilot:
  sem erros

analyze:arch:global:strict:
  hard=0
  soft=0
  info=111
  total=111

analyze:events:ssot:strict:
  ssotCount=198
  filesScanned=462
  violationCount=0
  findingCount=39

analyze:arch:layers:
  sem violações
```

Interpretação:

- a fronteira `presentation -> agent` agora é deliberada e semântica, não acesso oportunista a
  campos vivos;
- `server/` e `terminal/` permanecem como bordas, sem assumir governo de SDK, tools, skills, plan ou
  estado do agent;
- o próximo endurecimento ideal é reduzir os pontos `info` restantes de composição documentada,
  começando pelos ports de observability/conversation-hub, sem quebrar a regra central: SDK
  primeiro, agent mestre do runtime e presentation apenas como projection.

## 2.19 Baseline após endurecimento de `server/routes/sdk`

Esta rodada fechou duas ambiguidades: o ruído de teste que ainda varria a pasta morta
`src/copilot/api/`, e a fronteira de composição do adapter HTTP `/sdk`.

Implementado:

- `tests/unit/copilot/sdk/test_sdk_tools_registry_f28.spec.js` deixou de executar `grep` shell
  contra `src/copilot/api/` e passou a usar varredura Node silenciosa em caminhos existentes.
- `server/routes/sdk/deps.js` virou o composition root único do namespace `/sdk`:
  - SDK client/session;
  - seleção de runtime agent;
  - projections de runtime/tools/sessão;
  - hooks;
  - audit/observability/bridges;
  - tokens de política HTTP;
  - fallback estático de tools.
- `agent.js`, `client.js`, `hooks.js`, `observability.js`, `sessions.js`, `session-crud.js` e
  `session-messaging.js` passaram a receber essas capacidades por `deps.js`, sem importar SDK,
  agent, tools, hooks, audit, bridges, config ou presentation diretamente.
- `buildDefaultSdkRouteSharedDeps()` passou a tolerar ausência do `METRICS_STORE` no container,
  usando `defaultMetrics` como fallback para testes e boot parcial.
- `scripts/check-copilot-global-architecture.mjs` ganhou a regra hard
  `sdk-routes-must-compose-through-deps`: qualquer import de domínio/projection em
  `server/routes/sdk/*`, exceto `deps.js`, falha o gate.

Regra consolidada:

```text
server/routes/sdk/deps.js:
  único ponto que compõe SDK, agent runtime, tools, hooks, audit, bridges, config e presentation

server/routes/sdk/*.js:
  HTTP adapter puro; pode validar request, aplicar rate limit, serializar resposta e abrir SSE
  não pode compor domínio nem ler runtime vivo diretamente

server/routes/sdk/*middleware.js:
  middleware HTTP local; pode usar logging/error helpers transversais
  não pode acessar SDK/agent/presentation/tools
```

Interpretação:

- `/sdk` continua sendo adapter HTTP do SDK, mas já não contém pequenos composition roots
  espalhados;
- o SDK permanece mestre sobre client/session/model/tools do SDK;
- o agent permanece mestre sobre runtime vivo;
- `presentation/` permanece projection compartilhada, acessada por `deps.js`, não pelos handlers
  HTTP diretamente.

Gates executados:

```text
npx vitest run tests/unit/copilot:
  264 arquivos passados
  18 arquivos skipped
  3988 testes passados
  28 testes skipped
  4016 testes totais
  sem ruído de grep para src/copilot/api/

typecheck:strict:src.copilot:
  sem erros

analyze:arch:global:strict:
  hard=0
  soft=0
  info=105
  total=105

analyze:events:ssot:strict:
  ssotCount=198
  filesScanned=462
  violationCount=0
  findingCount=39

analyze:arch:layers:
  sem violações
```

## 2.20 Baseline após saneamento de resíduos `legacy/shim/deprecated`

Baseline transitório: esta seção registra a quarentena inicial de compatibilidade pública. A seção
2.21 substitui essa regra por uma postura mais dura: sem arquivos-shim físicos para os entrypoints
legados removidos.

Esta rodada separou compatibilidade pública de resíduo arquitetural. A regra adotada é dura:
arquivos compatíveis podem continuar existindo como API de borda quando há contrato público, mas
nenhum código interno novo pode depender deles. Implementação viva deve importar o módulo canônico.

Implementado:

- `events/base-events.js` virou o catálogo canônico de `EVENT_NAMES` e `EVENT_NAMESPACES`.
  `events/legacy-events.js` ficou apenas como shim público que reexporta o catálogo canônico.
- `events/local-emitter.js` virou o owner canônico de `createEmitter()` e `BaseEmitter`.
  `events/create-emitter.js` ficou apenas como shim público.
- `terminal/` deixou de consumir seus próprios shims `terminal/state.js` e
  `terminal/file-context.js`; o terminal agora importa diretamente
  `presentation/runtime-ui-state-store.js` e `presentation/runtime-file-context.js`.
- `bootstrap.js` deixou de lazy-loadar `terminal/dialog.js` e passou a usar o barrel canônico
  `terminal/dialog/index.js`.
- `scripts/generate-openapi.mjs` passou a escanear `src/copilot/server/routes/` e a gerar
  `src/copilot/server/routes/openapi.json` quando executado. `scripts/gen-openapi.mjs` virou wrapper
  compatível.
- `scripts/check-copilot-autonomy.mjs` deixou de exigir `src/copilot/api/`, `api/sse` e
  `src/copilot/api/openapi.json`; agora valida que `server/routes/` é a única borda HTTP canônica.
- `scripts/health-check-parte22.mjs` deixou de medir `api/` e `services/` como módulos críticos
  vivos e passou a medir `presentation/` e `server/`.
- `scripts/check-copilot-global-architecture.mjs` ganhou a regra hard
  `internal-code-must-not-import-compat-shims`.

Regra consolidada:

```text
Compatibilidade pública:
  pode existir em arquivos explicitamente marcados como shim/facade
  deve reexportar ou delegar para o módulo canônico
  não pode conter lógica própria nova

Implementação interna:
  não importa terminal/state.js, terminal/file-context.js ou terminal/dialog.js
  não importa agent/infra/task-executor.js ou agent/queue-processor.js
  não importa events/legacy-events.js ou events/create-emitter.js
  importa sempre presentation/, agent/messaging/ ou events/* canônico
```

Interpretação:

- `legacy` não é mais uma direção de arquitetura; é apenas uma camada de compatibilidade pública
  quarantinada;
- `presentation/` permanece dona de estado de UI/file-context compartilhado entre bordas;
- `events/` deixa de chamar seu catálogo base de “legacy” internamente;
- scripts de governança agora reforçam a arquitetura atual, não uma topologia já removida.

Gates executados nesta rodada:

```text
typecheck:strict:src.copilot:
  sem erros

analyze:arch:global:strict:
  hard=0
  soft=0
  info=105

analyze:arch:layers:
  sem violações

check-copilot-autonomy:
  sucesso

vitest terminal focado:
  23 arquivos passados
  208 testes passados

vitest events/observability/task-executor focado:
  6 arquivos passados
  73 testes passados
```

## 2.21 Baseline após eliminação física dos shims

Regra atual: shims físicos removidos não voltam. Compatibilidade pública só pode existir quando o
entrypoint aponta diretamente para o módulo canônico por mecanismo de resolução explícito, sem novo
arquivo intermediário com lógica, reexport ou delegação. O exemplo aceito é o import map
`#copilot/config/system-prompt`, que agora resolve diretamente para
`src/copilot/config/system-prompt/index.js`.

Entry points removidos e substitutos canônicos:

- `terminal/state.js` -> `presentation/runtime-ui-state-store.js`
- `terminal/file-context.js` -> `presentation/runtime-file-context.js`
- `terminal/dialog.js` -> `terminal/dialog/index.js`
- `events/legacy-events.js` -> `events/base-events.js`
- `events/create-emitter.js` -> `events/local-emitter.js`
- `agent/infra/task-executor.js` -> `agent/messaging/agent-messaging.js`
- `agent/queue-processor.js` -> `agent/messaging/agent-messaging.js`
- `config/system-prompt.js` -> `config/system-prompt/index.js`

Impacto arquitetural:

- consumers de `src/copilot/` e `tests/unit/copilot/` foram migrados para módulos canônicos;
- o catálogo público de system prompt preserva a API histórica pelo módulo canônico
  `config/system-prompt/index.js`, sem fachada física legada;
- `package.json` declara `#copilot/config/system-prompt` como alias exato para o índice canônico;
- `scripts/check-copilot-global-architecture.mjs` ganhou gate hard
  `removed-compat-entrypoints-must-stay-deleted`;
- a regra de import interno foi renomeada para `internal-code-must-not-import-removed-entrypoints`,
  deixando claro que o alvo antigo não é mais uma zona de compatibilidade aceita.

Regra consolidada, sem exceções:

```text
Código novo e código interno:
  importa sempre o módulo canônico
  não importa entrypoints removidos
  não recria arquivos-shim físicos para paths removidos

Compatibilidade pública:
  só é aceita por alias/resolution direto para módulo canônico
  não adiciona arquivo intermediário
  não contém lógica própria
```

Gates executados nesta rodada:

```text
typecheck:strict:src.copilot:
  sem erros

analyze:arch:global:strict:
  hard=0
  soft=0
  info=105

analyze:arch:layers:
  sem violações

analyze:events:ssot:strict:
  sem violações

check-copilot-autonomy:
  sucesso

vitest tests/unit/copilot:
  264 arquivos passados
  18 arquivos pulados
  3988 testes passados
  28 testes pulados
```

## 2.22 Baseline após hardening de boot e compat operacional

Esta rodada atacou compatibilidade que não era shim físico: entrypoints PM2/deprecated, wrappers
operacionais e lacunas de superfície SDK na borda HTTP.

Leitura do SDK instalado:

- `node_modules/README.md` não existe neste checkout;
- o README real lido integralmente foi `node_modules/@github/copilot-sdk/README.md`, com 893 linhas;
- a conferência também usou `dist/index.d.ts`, `dist/client.d.ts`, `dist/session.d.ts` e
  `dist/types.d.ts` para cobrir APIs que o README resume.

Situação ideal consolidada para boot:

```text
terminal:llm-b
  -> src/copilot/terminal/bootstrap.js        entrypoint canônico
    -> src/copilot/bootstrap.js               composition root de boot
      -> observability/bootstrap.js           loggers, métricas, audit bus
      -> runtime-wiring.js                    DI/runtime agent
      -> terminal/index.js                    host da UX local
        -> server/index.js                    HTTP/Socket.IO somente
        -> terminal/repl.js                   interação humana
```

Regras sem ambiguidade:

- `terminal/bootstrap.js` é o único boot real;
- `src/copilot/agent.js` é compat operacional e só delega para `bootCopilot()`;
- `copilot-sdk-agent` no PM2 não é segundo runtime e agora só entra com
  `COPILOT_SDK_AGENT_COMPAT_ENABLED=true`;
- `copilot-sdk-agent` não pode ser habilitado junto com `llm-b-terminal`;
- `server/index.js` não inicia terminal, REPL ou agent; ele apenas publica HTTP/Socket.IO;
- `terminal/index.js` é quem compõe o server local por injeção de `startCopilotServer`;
- o contrato vivo de boot agora fica em `src/copilot/boot/`, com `contract.js`, `config.js`,
  `workspace.js`, `skills.js` e `plan.js`.

Compatibilidade SDK endurecida:

- `/sdk/sessions` aceita os campos JSON-serializáveis da `SessionConfig`/`ResumeSessionConfig` do
  SDK: `configDir`, `mcpServers`, `agent`, `skillDirectories`, `disabledSkills`, `infiniteSessions`,
  `provider`, `reasoningEffort`, `availableTools`, `excludedTools`, `customAgents`, `systemMessage`,
  `streaming`, `workingDirectory` e `clientName`;
- `provider` custom continua SDK-first: exige `model`, como documentado pelo SDK;
- `POST /sdk/sessions/:id/model` agora repassa `reasoningEffort` para `CopilotSession.setModel`;
- `POST /sdk/sessions/:id/log` expõe `CopilotSession.log`;
- capacidades SDK baseadas em função (`tools[].handler`, hooks, permission handler, user input,
  `onEvent`, trace context) continuam process-local e entram por `deps.js`, ports, hooks e registry,
  não por JSON.

Governança adicionada:

- `scripts/check-copilot-autonomy.mjs` agora valida o contrato PM2 de boot único;
- o mesmo gate valida um baseline mínimo de capacidades vanilla do SDK em
  `src/copilot/boot/contract.js`;
- o gate exige que `/sdk/sessions` cubra a superfície JSON do SDK e `session.log`.

Gates executados nesta rodada:

```text
node --check:
  boot contract/config/workspace/skills/plan, session middleware/crud/messaging e autonomy gate sem erro de sintaxe

typecheck:strict:src.copilot:
  sem erros

check-copilot-autonomy:
  sucesso, incluindo checks de boot PM2 e baseline SDK

analyze:arch:global:strict:
  hard=0
  soft=0
  info=105

analyze:arch:layers:
  sem violações

analyze:events:ssot:strict:
  sem violações

vitest tests/unit/copilot:
  264 arquivos passados
  18 arquivos pulados
  3991 testes passados
  28 testes pulados
```

## 2.23 Boot centralizado e configurável

Esta rodada endurece a arquitetura de boot: `src/copilot/boot/` passa a ser o único lugar onde o
ambiente operacional é descoberto e transformado em plano de execução.

Situação ideal consolidada:

- `boot/config.js` é o arquivo canônico para variáveis de boot;
- `boot/workspace.js` resolve `COPILOT_WORKING_DIRECTORY`, raiz do pacote, raiz de `src/copilot`,
  estado de hooks e arquivos persistentes como `skills.json`;
- `boot/skills.js` resolve `COPILOT_SKILL_DIRECTORIES`, `COPILOT_PINNED_CONTEXT_DIRS` e
  `COPILOT_DISABLED_SKILLS`;
- `boot/plan.js` descreve fases, donos e responsabilidades de boot;
- `terminal/`, `server/`, `agent/` e `config/` consomem o boot, sem redescobrir workspace, skills ou
  porta local por conta própria.

Transições implementadas:

- `terminal/index.js` usa `bootConfig.skills.pinnedContextDirectories` para o `PinnedFilesLoader`;
- `terminal/index.js` injeta `host`, `port` e `token` do boot em `startCopilotServer`;
- `terminal/workspace-context.js` reexporta o contexto canônico de `#copilot/boot`;
- `agent/session/initializer.js` e `agent/lifecycle/session-setup.js` usam workspace e
  `skillDirectories` do boot para criar sessões SDK;
- `agent/session/hook-context.js` lista skills a partir dos diretórios do boot, com suporte a
  múltiplos diretórios e disabled skills;
- `tools/session-tools.js` carrega skills e estado de hooks a partir do boot;
- `config/mcp-servers.js` remove o path absoluto do filesystem MCP e usa `WORKSPACE_ROOT`;
- `declarative-runtime-config.js` persiste `skills.json` via path canônico do boot.
- `db/sqlite.js`, `sdk/tools/state.js`, `sdk/tools/custom.js`, `tools/file`, `tools/shell`,
  `tools/git`, `tools/todo` e `tools/code-tools` passaram a usar paths do boot para artefatos
  persistentes e raiz de execução.

Regra nova sem exceção: qualquer variável operacional de boot deve entrar primeiro em
`src/copilot/boot/config.js`. `config/env.js` pode reexportar variáveis para compat de domínio, mas
não é mais a autoridade para descobrir workspace/skills/entrypoints.

Validação da rodada 2.23:

```text
typecheck:strict:src.copilot:
  sem erros

check-copilot-autonomy:
  sucesso, incluindo Check 19 para boot centralizado

analyze:arch:global:strict:
  hard=0
  soft=0
  info=105

analyze:arch:layers:
  sem violações

analyze:events:ssot:strict:
  sem violações

## 2.23.1 Hardenings de boot, protocolo e visibilidade de tools

Rodada complementar após validação com `npm run terminal:llm-b` em ambiente real.

Decisões consolidadas:

- `entry.js` e o host de runtime não devem reinventar boot; fazem apenas hosting, sinais, IPC,
  preflight SDK e plugin discovery;
- `READY/REPLY/STOPPED` pertencem ao protocolo do agent. Se chegarem tardiamente após timeout de
  boot, continuam sendo protocolo, não input interativo comum;
- `availableTools` e `excludedTools` do SDK são fronteiras do SDK, não da nossa superfície local de
  tools; policy local do runtime deve ser aplicada em hooks/capabilities do agent;
- keepalive parado durante `dialogLoopActive=true` é estado normal, não degradação de health.

Transições implementadas:

- `agent/dialog/user-input-handler.js` passa a usar uma decisão semântica
  `shouldHandleProtocolInput(question)` em vez de depender apenas de `dialogLoopActive`;
- `agent/dialog/loop-manager.js` recupera `dialogLoopActive=true` quando um `READY` ou `REPLY`
  chega após drift transitório de boot, persistindo o estado corrigido;
- `agent/lifecycle/session-setup.js` aplica denylist/allowlist local por `onPreToolUse`, mantendo a
  política de tools do runtime dentro do agent;
- `agent/session/initializer.js` deixa de enviar denylist local crua para `excludedTools` do SDK,
  eliminando warnings de nomes desconhecidos e reforçando a regra "SDK first, agent as governor";
- `agent/health-check.js` deixa de marcar `io.keepalive_stopped` quando o keepalive está
  intencionalmente suprimido por dialog loop ativo;
- `terminal/repl.js` ganhou guard para não chamar `prompt()` após `/quit` fechar o `readline`.

Regra nova sem exceção:

- filtro nativo do SDK governa apenas recursos do SDK;
- filtro operacional do runtime governa tools locais, MCP exposto no runtime e políticas do agent;
- protocolo do dialog loop é decidido semanticamente, nunca por heurística de UI/terminal.

## 2.23.2 Hardenings finais de boot HTTP, inject e fila de turnos

Rodada adicional após testes live concretos pelo `terminal:llm-b`.

Decisões consolidadas:

- o boot canônico (`bootstrap.js`) também é responsável por registrar os global handlers de erro;
  isso não pode ficar escondido apenas no host compatível de `entry.js`;
- a borda HTTP (`server/routes/agent.js`) deve validar o mesmo contrato semântico de
  `presentation/agent-control.js`, aceitando `message` como campo canônico e `content` apenas como
  alias compatível;
- classificação de protocolo deve usar uma única fonte de verdade (`DialogProtocol`), e tokens de
  parada não podem ser inferidos por prefixo frouxo dentro de texto comum;
- infraestrutura de fila nunca pode gerar `Promise` rejeitada órfã como efeito colateral interno.

Transições implementadas:

- `bootstrap.js` passa a registrar `ERROR_TRACKER.registerGlobalHandlers()` no boot canônico;
- `presentation/agent-control.js` passa a propagar `timeout` explícito em `/inject` para
  `sendRuntimeDialogTurn`;
- `server/routes/agent.js` alinha os schemas de `/inject` e `/pipeline` com a surface canônica;
- `dialog/protocol.js` vira o contrato neutro do protocolo READY/REPLY; `agent/lifecycle/session-setup.js`,
  `agent/dialog/*` e `terminal/agent-runtime-events.js` convergem para essa mesma semântica sem dependência
  `terminal -> agent`;
- `agent/dialog/backpressure.js` remove o `next.finally(...)` órfão e passa a finalizar via
  `next.then(finalize, finalize)`, eliminando `unhandledRejection` espúrio da fila;
- testes unitários cobrindo boot, route validation, timeout propagation, protocolo e backpressure
  foram atualizados.

Validação live desta rodada:

- `/dialog/pause` e `/dialog/resume` passaram a refletir corretamente `dialogPaused` em `GET /health`
  e `GET /config`;
- `/inject` com `message` canônico deixou de falhar na validação legacy;
- timeouts de dialog turn passaram a ser projetados na HTTP surface como `DIALOG_TIMEOUT`, sem
  derrubar o processo;
- permanece um ponto funcional a investigar: em alguns cenários o modelo consome o input e conclui o
  `ask_user`, mas não emite `REPLY:` a tempo, fazendo `/inject` expirar. Isso deixou de ser falha
  de crash/boot e passa a ser investigação semântica do protocolo/modelo na próxima rodada.

## 2.23.3 Hardenings de métricas, timeout adaptativo e UX de thinking

Rodada posterior com validação live em `2026-04-23`, focada em separar semânticas que ainda estavam
misturadas e em organizar melhor a experiência do terminal.

Decisões consolidadas:

- `dialog` interno, `sdkDialog` e `inject` são métricas diferentes e não podem mais compartilhar o
  mesmo contador operacional;
- timeout explícito do caller continua soberano; timeout implícito passa por policy adaptativa comum,
  baseada em baseline, latência recente, fila e pressão de contexto;
- `thinking` precisa ter duas formas distintas:
  - **captura integral** e persistida em memória operacional;
  - **apresentação** colapsada por padrão, com expansão sob comando do usuário;
- `REPLY:` e `STOPPED` não podem virar `pendingQuestion` interativa; são mensagens de protocolo e
  devem ser respondidas automaticamente para não contaminar o próximo turno;
- o fallback semântico do dialog loop não pode depender apenas de `assistant.message`; ele também
  precisa aproveitar texto já emitido em streaming quando o modelo volta para `READY` sem `REPLY:`
  explícito.

Transições implementadas:

- `observability/metrics.js` e `metrics-histogram.js` passam a expor:
  - `dialog` (turnos do runtime/dialog loop),
  - `sdkDialog` (turnos concluídos pelo SDK),
  - `inject` (tentativas/sucesso/timeout/erro da borda HTTP);
- `presentation/system-config.js` e `system-metrics.js` passam a projetar essas superfícies
  separadamente em `/health` e `/metrics`;
- `presentation/dialog-timeout-policy.js` centraliza a policy adaptativa consumida pelas bordas
  `presentation/agent-control.js` e `terminal/dialog/engine.js`;
- `presentation/agent-control.js` passa a registrar `timeoutMs`, `timeoutStrategy`, `timeoutReasons`
  e outcome no histórico de `/inject`;
- `presentation/runtime-ui-state-store.js` ganha histórico explícito de `thinking`, e
  `terminal/commands/thinking.js` passa a suportar `list`, `show`, `latest` e `clear`;
- `terminal/dialog/turn-display.js` deixa de depender da impressão bruta como única forma de
  observação e passa a registrar o thinking completo com resumo colapsado;
- `terminal/task-stream-events.js` passa a registrar reasoning de tarefas internas no mesmo
  histórico e a tratá-lo como artefato colapsado, nunca como despejo bruto no stdout;
- `agent/dialog/user-input-handler.js` deixa de transformar `REPLY:` em pergunta pendente;
- `agent/dialog/turn-executor.js` endurece o fallback semântico em `READY` e em `task.delta`,
  reduzindo timeouts fantasma quando o modelo não segue o protocolo perfeitamente.
- `presentation/system-metrics.js` e `server/routes/observability.js` passam a expor
  `GET /thinking` e `GET /thinking/:id`, permitindo attach/follow por HTTP sem depender de
  acoplamento TTY.

Validação live desta rodada:

- `POST /inject` passou a responder com `traceId`, `timeoutMs`, `timeoutStrategy` e
  `timeoutReasons`;
- `GET /health` deixou de misturar “turno SDK concluído” com “inject HTTP bem-sucedido”;
- `terminal:llm-b` passou a permitir inspeção de thinking via `/thinking list` e
  `/thinking latest`;
- o caso live em que o modelo respondia e voltava a `READY` sem `REPLY:` deixou de bloquear o
  `/inject` para o cenário testado após o fallback ampliado;
- attach/follow recomendado para LLM-A deixa de ser “grudar no TTY”: a borda estável é
  `/events` + `/history` + `/thinking`, com o terminal permanecendo apenas como UI local.

Refinamento fechado na rodada seguinte:

- thinking de tarefa interna é sempre capturado integralmente, anunciado por resumo curto e
  finalizado mesmo quando `task.completed` chega sem `taskId`;
- o terminal não imprime mais reasoning bruto de tarefas internas, evitando poluição visual e
  preservando a política de UX colapsada;
- `/thinking show <id>` e `GET /thinking/:id` aceitam o sufixo curto exibido no terminal, mantendo
  a mesma operação mental nas duas bordas.
- `dialog/protocol.js` passa a ser o contrato puro de protocolo compartilhado por `agent/` e
  `terminal/`, removendo a dependência direta `terminal -> agent` para classificação de `READY:`,
  `REPLY:`, `DONE:` e `STOPPED`;
- `presentation/dialog-timeout-policy.js` passa a ser a policy compartilhada de timeout adaptativo
  para callers do dialog loop, removendo o import `terminal -> agent` que ainda restava no engine;
- consumers fora de `sdk/` voltam a passar pelo barrel `#copilot/sdk` para helpers/modelos/config de
  tools, preservando a diretriz SDK-first sem bypasses de submódulos.

vitest tests/unit/copilot:
  268 arquivos passados
  18 arquivos pulados

Gates finais da rodada:

- `npm run typecheck:strict:src.copilot`: verde;
- `npm run analyze:arch:global`: `hard=0`, `soft=0`; a última dependência sensível
  `agent/lifecycle/session-setup.js -> #copilot/hooks` foi drenada para `agent/ports/hook-port.js`;
- `npm run analyze:arch:global:strict`: passa a tratar `hard` e `soft` como regressões bloqueantes,
  preservando a topologia `hard=0 soft=0`;
- `npx vitest run tests/unit/copilot`: 4030 testes passados, 28 pulados.
  3994 testes passados
  28 testes pulados
```

---

## 3. Arquitetura global ideal

## 3.0 Glossário operativo

Estes termos passam a ser contratos de arquitetura:

- **SDK**: wrapper vanilla e camada mestre para client, sessão SDK, modelos, tools SDK, permissões
  SDK e eventos crus do SDK. O SDK não conhece runtime, agent, presentation, server ou terminal.
- **SDK client**: conexão operacional com o Copilot SDK/CLI. É infraestrutura de comunicação, não é
  uma conversa nem um agente.
- **SDK session**: unidade conversacional persistível do SDK, identificada por `sessionId`. Pode ser
  criada, retomada, listada, desconectada, ter modelo alterado e receber mensagens. Não é runtime.
- **Agent**: autoridade de runtime depois do SDK. Governa ciclo de vida, dialog loop, permissões em
  execução, registry vivo, handoff, cache, estado de pending question, health e ownership.
- **Runtime**: instância executável de um agent em um processo, endereçável por `runtimeId`. O
  runtime tem estado vivo e pode orquestrar uma ou mais sessões SDK ao longo do tempo. Hoje o
  runtime padrão é o AlwaysAliveAgent.
- **RuntimeId**: alvo operacional para selecionar uma instância de runtime. Não é `sessionId` do SDK
  e não é nome de persona.
- **Multi-runtime**: múltiplas instâncias de runtime coexistindo sob um registry/manager. Exemplo:
  `default` e `reviewer` como duas instâncias vivas, possivelmente da mesma classe de agent, com
  estados separados.
- **Multi-agent**: múltiplas identidades/políticas/capability sets de agent. Pode ser implementado
  com múltiplos runtimes, mas o conceito é diferente: multi-agent fala de papel/política;
  multi-runtime fala de instância viva.
- **Presentation**: camada de projections e comandos semânticos para bordas. Ela formata payloads e
  chama façades, mas não possui estado vivo, não decide política do SDK e não substitui o agent.
- **Server/Terminal**: bordas. Recebem entrada humana/HTTP/SSE/REPL e serializam saída. Não governam
  SDK, agent, tools, skills, plan ou permissões.
- **Composition root**: ponto autorizado a juntar domínios. Hoje os pontos explícitos são
  `bootstrap.js`, `runtime-wiring.js`, `agent/ports/*`, `config/sdk-config-port.js` e
  `server/routes/sdk/deps.js`.

## 3.1 Mapa de camadas

```text
L0 Foundation
  core/
  types/
  db/

L1 Configuração e contratos declarativos
  config/

L2 SDK vanilla e eventos
  sdk/
  events/
  event-handlers/

L3 Capacidades, políticas e integrações
  hooks/
  tools/
  bridges/
  plugins/
  infra/

L4 Runtime contínuo
  agent/
  channel/

L5 Estado conversacional
  conversation-hub/

L6 Projections compartilhadas
  presentation/

L7 Bordas
  server/
  terminal/

Cross-cutting
  observability/
  audit/

Runtime artifacts
  logs/
  .github/hooks/state/
```

## 3.2 Regra de dependência

Cada camada pode depender de camadas mais baixas. Dependências laterais ou ascendentes só podem
existir quando forem pontos de composição documentados.

Exemplos:

- `server/` pode depender de `presentation/`.
- `terminal/` pode depender de `presentation/`.
- `presentation/` pode depender de façades públicas de `agent/`, `conversation-hub/`, operações
  públicas de `config/`, `core/` e `infra/`.
- `agent/` pode depender de `sdk/`, `events/`, `config/`, `core/` e de `agent/ports/` para compor
  tools, hooks, bridges, conversation-hub e observability.
- `sdk/` não pode depender de `agent/`, `presentation/`, `server/` ou `terminal/`.
- `events/` não pode depender de runtime concreto.
- `event-handlers/` não pode renderizar HTTP, terminal ou UI.
- `server/` e `terminal/` não importam `agent/` ou `sdk/` para decisões de runtime. A pasta
  `server/routes/sdk/*` é o adapter HTTP do SDK e deve manter esse acoplamento isolado.
- `bootstrap.js` e `runtime-wiring.js` são composition roots; podem compor módulos, mas não podem
  abrigar regra operacional.

## 3.3 Papel ideal de cada área

| Área               | Papel ideal                                                  | Anti-padrão a evitar                                     |
| ------------------ | ------------------------------------------------------------ | -------------------------------------------------------- |
| `core/`            | primitivas, DI, erro, mutex, JSON, EventBus, shutdown        | conhecer runtime                                         |
| `types/`           | contratos compartilhados                                     | depender de implementação                                |
| `db/`              | armazenamento estrutural                                     | acionar UI/runtime                                       |
| `config/`          | configuração declarativa, prompt e skills/tools declarativos | decidir fluxo operacional                                |
| `sdk/`             | wrapper vanilla, sessão SDK, RPC, telemetry SDK              | conhecer `agent/`                                        |
| `events/`          | nomes, catálogo, schemas e middleware de eventos             | chamar runtime                                           |
| `event-handlers/`  | tradução de payload cru para evento/projection de domínio    | renderizar borda                                         |
| `hooks/`           | políticas de permissão, erro, prompt e tool interception     | virar runtime host                                       |
| `tools/`           | factories e execução de capacidades                          | depender de terminal                                     |
| `bridges/`         | integração externa MCP/Git/NERV                              | ser chamado como singleton implícito pelo runtime        |
| `plugins/`         | registro e descoberta de plugins                             | controlar ciclo de vida do agent                         |
| `infra/`           | webhooks, filas, lockfile, storage, SSE                      | guardar regra de domínio                                 |
| `agent/`           | runtime contínuo, sessão ativa, dialog loop, ownership       | absorver tools, hub, presentation, terminal ou server    |
| `channel/`         | canal client/dialog/history/structured                       | duplicar runtime                                         |
| `conversation-hub` | memória conversacional, turns, broadcast e consultas         | ser store interno do agent                               |
| `presentation/`    | projections e comandos compartilhados para bordas            | possuir persistência/config ou virar runtime alternativo |
| `server/`          | HTTP, SSE, middleware, serialização                          | acessar internals do agent sem projection                |
| `terminal/`        | REPL, comandos, renderização local, atividade                | escutar eventos internos quando projection resolver      |
| `observability/`   | métricas, traces, snapshots, collectors, observers           | reinterpretar payload cru em paralelo a event-handlers   |
| `audit/`           | trilha auditável, pipeline, buffers, permissões auditáveis   | decidir política operacional                             |

## 3.4 Critério de autoridade SDK/agent/presentation

Regra mestre:

```text
SDK vanilla
  -> agent runtime authority
    -> presentation projections
      -> server/terminal bordas
```

Critérios práticos:

- Fica em `sdk/`: wrappers do pacote `@github/copilot-sdk`, shapes vanilla, RPC/session/client,
  registry SDK e helpers que não conhecem runtime.
- Fica em `agent/`: sessão viva, handles SDK acoplados ao runtime, permissões efetivas, registry
  vivo de tools, `mode/plan`, dialog loop, handoff, webhooks runtime e capabilities.
- Fica em `presentation/`: seleção de runtime, envelopes HTTP/terminal-safe, paginação/filtros de
  borda, ownership projection, compatibilidade de payload e comandos compartilhados que delegam para
  `agent/` ou `config/`.
- Fica em `server/`: rotas, middleware, status HTTP, SSE e serialização. Rotas não devem abrir
  managers vivos do agent.
- Fica em `terminal/`: REPL, comandos, renderização e estado visual local. Comandos consomem
  projections e não métodos crus do runtime.
- Fica em `config/`: skills/tools declarativos, allowlist/denylist, custom definitions e defaults
  declarativos. Isso é configuração; ao virar sessão viva ou capability runtime, sobe para `agent/`.
- Fica em `server/routes/sdk/*`: adapter HTTP do SDK. Pode falar com `sdk/` quando expõe API SDK
  vanilla (`ping`, `auth`, `models`, CRUD de sessão SDK). Quando a rota expõe visão runtime do agent
  (`agent/tools`, registry vivo, capabilities, mode/plan), deve passar por `agent/` e
  `presentation/`.

---

## 4. Contratos globais

## 4.1 Contrato de evento

Todo evento de domínio deve ter:

- constante em `events/`;
- entrada no catálogo quando for público ou cross-module;
- payload normalizado ou schema quando cruzar fronteira;
- owner;
- classificação: `domain`, `sdk`, `ui-local`, `node-process`, `infra-local` ou `legacy-emitter`.

O auditor de eventos deve deixar de tratar todos os `.on('...')` como violação igual. Eventos de
processo e eventos locais de UI precisam ser classificados, não necessariamente movidos para
domínio.

## 4.2 Contrato de projection

Toda borda deve preferir `presentation/` para:

- status de runtime;
- health;
- comandos de diálogo;
- SDK sessions;
- config;
- métricas;
- memória;
- webhooks;
- runtime targeting;
- tools registradas no runtime;
- modo e plan vanilla da sessão SDK;
- estado de UI compartilhado.

`server/` e `terminal/` podem manter estado de renderização próprio, mas não devem duplicar decisões
de runtime.

## 4.3 Contrato de runtime

`agent/` deve expor superfície pública por grupos:

- lifecycle;
- status;
- dialog;
- session;
- ownership;
- webhooks;
- SDK access;
- model/config;
- capabilities.

O `AlwaysAliveAgent` pode permanecer como façade de compatibilidade, mas novas integrações devem
preferir runtime façade, registry/manager leve e projections.

## 4.4 Contrato de capability

Capabilities devem ser descobertas e descritas, não inferidas por presença acidental de métodos.

Capability mínima:

```text
id
owner
kind
status
health
runtimeId?
source
```

Exemplos:

- `runtime.dialog`;
- `runtime.lifecycle`;
- `runtime.ownership`;
- `sdk.session`;
- `sdk.plan`;
- `tools.registry`;
- `tools.file`;
- `tools.shell`;
- `hooks.permission`;
- `bridges.mcp`;
- `conversation.memory`;
- `presentation.status`;

## 4.5 Contrato de ports

Ports entram quando uma camada quente precisa chamar uma capacidade sensível de outra área.

Ports prioritários:

- `ToolBootstrapPort`;
- `ToolExecutionPort`;
- `HookPolicyPort`;
- `BridgeMcpPort`;
- `ConversationSyncPort`;
- `RuntimeSnapshotPort`;
- `AuditPort`;
- `EventPublishPort`.

Regra: criar port somente quando ele remove import sensível real ou estabiliza contrato usado por
duas ou mais bordas. Port sem pressão concreta vira cerimônia.

---

## 5. Arquitetura ideal dos fluxos

## 5.1 Evento SDK

```text
sdk/session/*
  -> event-handlers/*
    -> events/*
      -> agent quando afetar runtime
      -> conversation-hub quando afetar histórico/memória
      -> observability/audit quando afetar telemetria
      -> presentation quando afetar projeção de borda
```

O SDK não deve conhecer quem consome. Ele emite ou disponibiliza payload. A tradução semântica fica
em `event-handlers/`.

## 5.2 Comando de borda

```text
server/terminal
  -> presentation
    -> agent/conversation-hub/config/sdk
      -> events/observability/audit
```

Borda não deve reconstruir seleção de runtime, health, status ou erro HTTP/terminal a partir de
internals. Isso pertence a `presentation/`.

## 5.3 Diálogo runtime

```text
presentation/runtime-dialog
  -> agent facades
    -> dialog controller/loop
      -> sdk session
      -> event publish
      -> conversation sync
```

O dialog loop não deve ser dono de projeção, UI, HTTP ou terminal.

## 5.4 Tools e permissões

```text
agent/session setup
  -> ToolBootstrapPort
    -> tools/bootstrap
      -> hooks/permission
      -> audit/observability
```

O agent pode orquestrar a necessidade de tools, mas não deve conhecer detalhes de bootstrap e
registro de tools além do contrato.

Para leitura de runtime:

```text
sdk/tools-registry
  -> AgentContext factory
    -> agent/facades/agent-runtime-tools
      -> presentation/runtime-tools
        -> server/terminal
```

O registry vivo é SDK-first e agent-owned. Borda só recebe projeção serializável.

## 5.5 Health e readiness

```text
agent health
sdk health
tools health
bridges health
conversation health
observability health
  -> presentation/runtime-health
    -> server routes
    -> terminal projections
```

Health deve ser comparável entre bordas. Se terminal e HTTP mostram estados diferentes, a
arquitetura falhou.

---

## 6. Roadmap detalhado

## Fase 0 — Baseline operacional e gates não destrutivos

Objetivo: medir a arquitetura global sem bloquear desenvolvimento.

### F0.1 Criar gate global paralelo

Status: **implementado**.

- Criar script separado para topologia global.
- Manter `check-layer-violations.mjs` intacto enquanto o novo gate amadurece.
- Gerar relatório com severidade `hard`, `soft` e `info`.
- Saída inicial não deve falhar CI por padrão.

Critério de pronto:

- `npm run analyze:arch:global` executa;
- relatório mostra contagem por severidade;
- violações hard podem ser promovidas depois para erro com flag `--strict`.

### F0.2 Classificar exceções

Status: **implementado e drenado para baseline operacional**.

- Documentar imports sensíveis atuais.
- Separar composição legítima de acoplamento acidental.
- Criar allowlist curta com justificativa.
- Evitar allowlist genérica por diretório inteiro.
- Manter pontos de composição como arquivos específicos (`agent/ports/*`,
  `config/sdk-config-port.js`, `runtime-wiring.js`, `bootstrap.js`, `types/index.js`).

Critério de pronto:

- cada exceção tem arquivo, target, motivo e plano de drenagem;
- exceções sem plano não entram.

### F0.3 Atualizar auditor de eventos

Status: **implementado**.

- Classificar eventos por família.
- Ignorar ou classificar eventos Node/processo separadamente.
- Classificar eventos locais de UI como `ui-local`.
- Manter eventos de domínio inline como violação real.

Critério de pronto:

- o relatório deixa de misturar `SIGTERM`, `line`, `timeout` e eventos de domínio;
- violações de domínio ficam mais acionáveis.

### F0.4 Congelar baseline textual

Status: **implementado e atualizado após drenagem de fronteiras quentes**.

- Registrar contagens de módulos.
- Registrar contagens de eventos.
- Registrar violations atuais.
- Usar baseline como ponto de comparação por fase.

Critério de pronto:

- cada fase futura consegue mostrar redução objetiva de acoplamento.

## Fase 1 — Presentation como contrato obrigatório de borda

Objetivo: bordas param de conhecer detalhes de runtime.

### F1.1 Inventariar acessos diretos de `server/` e `terminal/`

- Listar imports de `#copilot/agent` e `../agent`.
- Separar os que já passam por `presentation/`.
- Priorizar listeners diretos do `terminal/` no emitter do agent.

### F1.2 Subir projections restantes

- Status de runtime.
- Eventos de sessão SDK.
- Tool execution stream.
- Runtime targeting.
- Erros de agent.

### F1.3 Padronizar contratos de erro

- `presentation/agent-http-errors.js` não deve depender de erro interno privado.
- Criar contrato público de erro do runtime em `agent/` ou `types/contracts`.

### F1.4 Gate suave

- Avisar quando `server/` importar `agent/` diretamente.
- Avisar quando `terminal/` importar `agent/` diretamente fora de wiring explícito.

## Fase 2 — Eventos canônicos e event-handlers como tradução

Objetivo: estabilizar o fluxo evento bruto -> tradução -> domínio -> projection.

### F2.1 Taxonomia de eventos

- `domain`;
- `sdk`;
- `legacy-emitter`;
- `ui-local`;
- `node-process`;
- `infra-local`;
- `test-only`.

### F2.2 Catálogo enriquecido

- Owner.
- Payload.
- Direção.
- Consumidores esperados.
- Se pode ser emitido pelo `agent`.
- Se pode ser escutado por borda.

### F2.3 Remover strings inline de domínio

- Começar por `agent.background.completed` e `agent.background.idle`.
- Depois atacar listeners diretos em `terminal/sdk-session-events.js`.

### F2.4 Separar bridge legado

- `EventEmitter` do agent continua existindo.
- `events/` e EventBus viram origem preferencial para domínio novo.
- Bridge legado fica documentado como compat.

## Fase 3 — Ports para boundaries quentes do agent

Objetivo: reduzir imports diretos do `agent/` para capacidades externas.

Status geral: **primeira onda implementada**. A fase ainda continua aberta para refinar contratos,
injetar ports por factory/runtime e reduzir a necessidade de reexports amplos em `agent/infra` e
`agent/index.js`.

### F3.1 `ToolBootstrapPort`

Status: **implementado como `agent/ports/tool-port.js`**.

- Encapsular `tools/bootstrap.js`.
- Trocar chamadas diretas em `agent/lifecycle/session-setup.js` e
  `agent/lifecycle/agent-lifecycle.js`.
- Manter adapter default apontando para implementação atual.
- Próximo passo: separar `ToolBootstrapPort` de `ToolRuntimePort`, pois bootstrap, hub e resolução
  de input têm cadências diferentes. A leitura runtime já começou por
  `agent/facades/agent-runtime-tools.js` e `presentation/runtime-tools.js`; o próximo passo é
  formalizar `ToolRuntimePort` quando houver mais de um consumer operacional além de routes.

### F3.2 `BridgeMcpPort`

Status: **implementado como `agent/ports/mcp-port.js`**.

- Encapsular `buildMcpTools` e `startMcpAutoReconnect`.
- Evitar que lifecycle conheça detalhes do MCP bridge.
- Próximo passo: modelar `McpRuntimeCapabilities` para que reconnect e tool discovery sejam
  observáveis por evento de domínio.

### F3.3 `HookPolicyPort`

Status: **implementado como `agent/ports/permission-port.js`**.

- Encapsular `PermissionController`.
- `AgentContext` passa a receber policy port ou factory.
- Construção concreta de permission policy retirada do construtor do contexto e movida para
  `agent/context-factories.js`.
- Próximo passo: expor readiness/metadata de `governance.permissions` a partir da
  factory/capability, sem depender da classe concreta.

### F3.4 `ConversationSyncPort`

Status: **implementado parcialmente como `agent/ports/conversation-port.js`**.

- Encapsular `history-sync`.
- Direcionar ownership/history para contrato com `conversation-hub`.
- Próximo passo: mover sincronização de histórico para listener/handler do hub, deixando o agent
  publicar intenção/estado em vez de conhecer rotina de sincronização.

### F3.5 `ObservabilityPort`

Status: **implementado como `agent/ports/observability-port.js`**.

- Encapsular logging, spans, métricas, collectors, error tracker e snapshots.
- Trocar imports diretos do `agent/` para `#copilot/observability` e `observability/snapshots.js`.
- Manter `observability/` como cross-cutting global, mas impedir que o runtime dependa de caminhos
  concretos em vários pontos.

Próximo passo:

- criar projections de runtime para health/status em `presentation/`, para que snapshots usados por
  bordas não dependam da estrutura interna do contexto.

### F3.6 `SdkConfigPort`

Status: **implementado como `config/sdk-config-port.js`**.

- Encapsular defaults do SDK usados por `config/`.
- Reduzir imports ascendentes de `config/` para `sdk/` a um único ponto documentado.

Próximo passo:

- avaliar se `SYSTEM_PROMPT_SECTIONS` deve virar snapshot versionado em `config/`, reduzindo ainda
  mais dependência runtime de defaults do SDK.

## Fase 4 — Runtime façade e capability map

Objetivo: `AlwaysAliveAgent` fica como compat, enquanto novas integrações falam com contrato menor.

### F4.1 Runtime façade

Status: **parcial**.

- Criar superfície mínima:
  - `commands`;
  - `queries`;
  - `events`;
  - `capabilities`.
- Delegar para o agent atual sem mudar comportamento.

Implementado agora:

- `agent/facades/agent-runtime-capabilities.js` funciona como façade de query para capabilities
  atuais.
- `presentation/runtime-capabilities.js` embrulha a façade com metadata de runtime e shape
  HTTP-safe.
- `server/` consome a projection via `GET /capabilities`.
- `agent/facades/index.js` centraliza as façades modernas, e `agent/index.js` mantém compatibilidade
  com reexport explícito da superfície já pública.

Pendente:

- reduzir reexports largos restantes de `dialog/`, `infra/`, `lifecycle/`, `messaging`, `session/` e
  `state/` em `agent/index.js`.
- separar `commands` e `queries` em contratos explícitos quando a superfície pública deixar de ser
  majoritariamente compat.

### F4.2 Capability map inicial

Status: **implementado em `presentation/runtime-capabilities.js`**.

- Runtime lifecycle.
- Dialog.
- SDK session.
- Permissions.
- Webhooks.
- MCP.
- Tools.
- Conversation memory.

Mapa inicial implementado:

- runtime lifecycle e queue;
- SDK client, session e resources;
- tools registry;
- dialog loop e pending-question IO;
- permission policy;
- webhooks e handoff;
- health, quota e boot recovery.

Pendente:

- adicionar MCP/conversation memory como capabilities explícitas quando houver readiness própria por
  port;
- detalhar capabilities por família de tool somente quando houver health real por categoria
  (`tools.file`, `tools.shell`, `tools.mcp`), sem inferir disponibilidade por nome;
- trocar consumidores locais de status por esse mapa quando a UI precisar exibir disponibilidade.

### F4.3 Health por capability

Status: **parcial**.

- Cada capability expõe readiness mínima.
- `presentation/runtime-health.js` agrega.

Implementado agora:

- readiness mínima é derivada de `AgentHealthSnapshot.checks`.
- `sdk.resources` usa `getSdkResourceSnapshot()` para expor recursos presentes/ausentes.
- `tools.registry` usa `getToolRegistryEntriesSnapshot()` para expor disponibilidade e contagem, com
  metadata de factory.

Pendente:

- promover health por capability para `runtime-health.js` quando houver consumidores agregados em
  `/health/modules` e dashboards;
- versionar o shape do capability map antes de clientes externos dependerem dele.

## Fase 5 — Lifecycle e dialog em serviços menores

Objetivo: reduzir orquestradores largos sem reescrever o runtime.

### F5.1 Lifecycle

- Separar boot SDK/session.
- Separar ownership/history.
- Separar shutdown/persistência.
- Separar timers/keepalive.

### F5.2 Dialog

Status: **iniciado**.

- Extrair cost ledger.
- Extrair compaction policy.
- Extrair FSM simples.
- Extrair watchdog supervisor.
- Manter `DialogLoopManager` como orquestrador fino.

Implementado agora:

- `DialogCostLedger` concentra contadores de boot, resume com PR e resume zero-PR.
- `DialogCompactionPolicy` concentra thresholds e dedupe de solicitação proativa.
- `DialogLoopStateMachine` concentra transições de `active/stopping/paused/resuming`.
- `selectDialogResumeStrategy()` separa decisão de Estratégia A/B do manager.
- `DialogWatchdogSupervisor` concentra start/stop/ping/clear do watchdog vivo.
- `DialogLoopManager` preserva eventos, API pública, persistência e protocolo.

Pendente:

- reduzir side effects repetidos de resume em helpers de aplicação de estratégia;
- manter watchdog e supervisor como componentes finos, sem mover decisão de domínio para eles.

### F5.3 Estado

- Transformar `AgentContext` em host de stores governadas.
- Bloquear mutações cruzadas novas.
- Preservar API atual com adapters.

## Fase 6 — Persistência, replay e auditoria operacional

Objetivo: snapshot deixa de ser plano de controle único.

### F6.1 Snapshot tipado

- Separar runtime snapshot, dialog snapshot, session snapshot e metrics snapshot.

### F6.2 Event journal opcional

- Registrar eventos de domínio importantes.
- Usar para replay e debugging.
- Não bloquear hot path inicial.

### F6.3 Audit trail integrado

- `audit/` consome eventos canônicos.
- Policies de permissão aparecem em trilha auditável.

## Fase 7 — Multi-runtime progressivo

Objetivo: preparar expansão sem quebrar singleton atual.

### F7.1 Runtime manager leve

- Evoluir `runtime-registry` para manager.
- Preservar `getAgent()` como compat.

### F7.2 Runtime targeting

- `presentation/runtime-targeting.js` vira contrato obrigatório.
- Server e terminal passam sempre por selection explícita.

### F7.3 Runtime secundário experimental

- Runtime fake primeiro.
- Runtime real secundário só depois de health/capabilities.

---

## 7. Sequência imediata de implementação

A sequência original da Fase 0 foi concluída:

1. Criar `scripts/check-copilot-global-architecture.mjs`.
2. Adicionar `npm run analyze:arch:global`.
3. Rodar o gate em modo relatório.
4. Atualizar o documento 12 para apontar este documento como roadmap detalhado.
5. Drenar acoplamentos sensíveis do `agent/` para ports explícitos.
6. Reduzir o gate global para `hard=0 soft=0`.

A próxima sequência recomendada é:

1. Criar `presentation/runtime-capabilities.js` como projection comum de capabilities atuais.
   **Concluído.**
2. Criar `agent/facades/agent-runtime-capabilities.js` ou módulo equivalente que leia o estado atual
   sem expor `AgentContext`. **Concluído.**
3. Fazer `server/` e `terminal/` consumirem capabilities/status por `presentation/`. **Parcial:
   `server` já expõe `GET /capabilities`.**
4. Reduzir reexports largos de `agent/index.js` em favor de facades nomeadas. **Parcial: façades
   centralizadas em `agent/facades/index.js`; demais subsistemas ainda usam barrels amplos.**
5. Começar Fase 5 pela extração de `DialogCostLedger` e `DialogCompactionPolicy`, que têm baixo
   risco e reduzem o peso do `DialogLoopManager`. **Concluído como primeira fatia da Fase 5.**
6. Remover leituras cruas restantes de registry vivo em `server/` e mover `mode/plan` para façade
   agent-level. **Concluído para `/sdk/tools`, `/sdk/agent/tools` e
   `presentation/runtime-sdk-session.js`.**

---

## 8. Critérios globais de sucesso

- `analyze:arch:global` existe e mede a topologia ideal.
- Violações novas são visíveis imediatamente.
- O SSOT de eventos separa evento de domínio de evento local/processo.
- `server/` e `terminal/` preferem `presentation/`.
- `agent/` não importa diretamente `tools/`, `hooks/`, `bridges/`, `conversation-hub` ou
  `observability` fora de `agent/ports/`.
- `config/` concentra dependências de defaults do SDK em `config/sdk-config-port.js`.
- `presentation/` não vira segundo runtime.
- `event-handlers/` não vira camada de UI.
- `observability/` e `audit/` consomem eventos, mas não reinterpretam domínio em paralelo.
- Roadmap futuro consegue ser executado em PRs pequenos.

---

## 9. Decisão arquitetural final

A melhor arquitetura global para o momento não é um novo kernel total. É uma arquitetura governada,
compatível e progressiva:

```text
SDK vanilla e eventos canônicos
  -> tradução por event-handlers
    -> runtime agent enxuto
      -> memória no conversation-hub
        -> projections em presentation
          -> bordas server/terminal

com tools, hooks e bridges acessados por ports,
e observability/audit como consumidores transversais.
```

Essa arquitetura preserva o que já funciona, cria gates reais, reduz acoplamento por ondas e prepara
o sistema para implementação contínua sem exigir uma ruptura estrutural prematura.
