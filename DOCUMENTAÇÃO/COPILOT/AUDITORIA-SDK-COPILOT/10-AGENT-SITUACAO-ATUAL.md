# 10 — Agent Module: Situação Atual Validada

**Data de atualização**: 2026-04-17
**Escopo**: `src/copilot/agent/`
**Status**: atualizado após leitura do código vivo + nova rodada de implementação
**Referências**:

- [09-AGENT-LOGICA-FLUXO.md](./09-AGENT-LOGICA-FLUXO.md)
- [11-AGENT-SITUACAO-IDEAL.md](./11-AGENT-SITUACAO-IDEAL.md)

> **Nota importante**: este documento substitui a análise de 2026-03-21. O texto anterior continua útil como
> trilha histórica, mas já não refletia o estado real do runtime em abril/2026.

---

## 1. Resumo executivo

O módulo `src/copilot/agent/` está **significativamente melhor** do que o retrato de março indicava.

Entre março e abril de 2026, várias peças que eram apenas “situação ideal proposta” passaram a existir de fato:

- `AgentContext` foi **particionado em subestados nomeados** (`sessionState`, `dialogState`, `configState`,
  `metricsState`, `runtimeState`, `ioState`), embora ainda não esteja plenamente encapsulado;
- existe **tracker de tarefas em background** (`background-tasks.js`) com `drain()` no shutdown;
- existe **política central de erro** (`error-policy.js`) e, nesta rodada, ela passou a expor também
  `withAgentErrorPolicy(...)`;
- o boot do agente saiu do formato “god function opaca” para um **pipeline nomeado de steps**
  (`createBootWiringSteps()`, `runBootPipeline()`, `boot-steps.js`);
- o pipeline de boot agora também começa a produzir **relatório observável por step** (`bootReport`), consumível pelo
  health do agente;
- o runner de boot agora distingue **falha fatal** de **degradação controlada** por step (`required`, `degraded`,
  `skipped`), em vez de tratar todo erro como abort obrigatório do boot;
- o bridge de eventos deixou de ser hardcoded no topo da classe e passou a ter **mapa declarativo**
  (`event-bridge-map.js` + `event-bridge-wiring.js`);
- o agente já expõe **health snapshot formal**, reaproveitado por rotas HTTP e health registry;
- o singleton já possui **lazy accessor** (`getAgent()`) e **proxy de compatibilidade** (`alwaysAliveAgent`).

Em outras palavras: a base arquitetural deixou de ser “monólito inchado com planos no papel” e virou um subsistema
modular com vários alicerces já entregues.

Ainda assim, o módulo **não chegou ao estado ideal**. O principal débito restante não é mais “falta de módulos”, e sim
**governança de estado e contratos**:

- o `AgentContext` continua sendo o centro mutável de tudo;
- ainda existem módulos com acesso direto a `ctx.*State` e alguns casts `unknown` residuais;
- a política de erro agora existe, mas sua adoção ainda é parcial;
- o lazy singleton existe, porém a migração para `getAgent()` ainda não terminou em 100% dos consumidores;
- o runtime ainda é essencialmente **single-session**;
- o watchdog do diálogo continua **estático**, sem adaptação por histórico real.

Além disso, embora o `agent` agora tenha uma façade canônica de acesso total ao SDK, a adoção integral de
`withAgentErrorPolicy(...)`, a propagação completa da mutation API e o fechamento final do ownership semântico do
`AgentContext` ainda seguem como trabalho de consolidação.

Também nesta última frente do subfluxo `ask_user`, o agent passou a:

- distinguir pergunta viva do SDK de `pendingQuestionShadow` restaurada do disco;
- carregar TTL/expiração explícita na shadow (`restoredAt`, `expiresAt`), agora com TTL semântico por `kind`;
- expor `pendingQuestionShadowExpired`, `pendingQuestionShadowAgeMs` e `pendingQuestionShadowExpiresAt` no health;
- disponibilizar limpeza canônica da shadow por API pública do agent, por rota HTTP dedicada e por comando explícito no
  REPL do terminal.
- fazer reap contínuo da shadow expirada no timer periódico do runtime, sem depender apenas do boot para limpeza.
- alimentar uma nova camada canônica de atividade do terminal, que agora traduz eventos do agent/SDK em fases
  operacionais visíveis (`turn`, `thinking`, `tool`, `task`, `question`, `compaction`, `error`).
- consumir `assistant.streaming_delta` como sinal operacional adicional de progresso de resposta, sem depender apenas do
  texto incremental renderizado.
- alinhar `tool.execution_progress` ao payload real do SDK (`progressMessage`, com `progress` opcional), melhorando a
  UX do terminal e removendo a suposição de que o progresso sempre viria em `%` numérico.
- expor `pendingQuestionShadowState` + `pendingQuestionShadowRemainingMs`, permitindo distinguir shadow recém-restaurada,
  ativa, expirando ou expirada sem reabrir o state cru.
- propagar a shadow persistida também para snapshots manuais do terminal/agent.

Também houve correção fina de conformidade com o SDK neste ponto:

- `onUserInputRequest` agora trata `allowFreeform` omitido como `true`, em linha com o contrato real do
  `@github/copilot-sdk`.
- o runtime do terminal/agent passou a alinhar seu default canônico para `gpt-5-mini` com `reasoning=high`, reduzindo
  drift entre defaults do agent, frontend do terminal e seleção de modelo em runtime.

Resumo franco: **o agent deixou de estar “arquiteturalmente atrasado”, mas ainda está “arquiteturalmente semi-endurecido”.**

---

## 2. O que do plano antigo já saiu do papel

O documento antigo ([11-AGENT-SITUACAO-IDEAL.md](./11-AGENT-SITUACAO-IDEAL.md), versão de março) propunha as fases
`K1`–`K8`. Em abril/2026, o status real é o seguinte:

| Fase antiga | Tema                              | Status em 2026-04-17 | Evidência principal                                                                                                    |
| ----------- | --------------------------------- | -------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `K1`        | Particionamento do `AgentContext` | **Parcial forte**    | `agent-context.js` agora tem subestados nomeados + accessors compat                                                    |
| `K2`        | Sprint de cobertura de testes     | **Parcial forte**    | já existem testes para context, health, error-policy, lifecycle, messaging, loop manager, queue                        |
| `K3`        | Error handling centralizado       | **Parcial forte**    | `error-policy.js` existe; nesta rodada ganhou `withAgentErrorPolicy(...)` e adoção em `messaging` + `reconnect-policy` |
| `K4`        | Background task tracker           | **Implementado**     | `background-tasks.js` + `ctx.backgroundTasks.drain(...)` no shutdown                                                   |
| `K5`        | Boot wiring pipeline              | **Implementado**     | `createBootWiringSteps()`, `runBootPipeline()`, `boot-steps.js`                                                        |
| `K6`        | Event bridge declarativo          | **Implementado**     | `event-bridge-map.js` + `event-bridge-wiring.js`                                                                       |
| `K7`        | Health check formal               | **Implementado**     | `health-check.js`, `server/routes/agent-health.js`, `/health`, `/health/agent`, `/health/modules`                      |
| `K8`        | Lazy singleton                    | **Parcial avançado** | `getAgent()` + proxy compat `alwaysAliveAgent`; migração em andamento                                                  |

### Leitura correta do delta

O plano antigo não “falhou”; ele foi **parcialmente absorvido** pelo código vivo.

O problema agora é outro: a documentação antiga continuava descrevendo o módulo como se quase nada tivesse sido
entregue. Isso já não era verdade.

---

## 3. Arquitetura atual do módulo `agent`

Hoje o `agent` já opera com uma topologia bem mais madura:

```text
src/copilot/agent/
├── always-alive.js            # fachada pública + lazy singleton + proxy compat
├── agent-context.js           # contexto compartilhado com subestados nomeados
├── background-tasks.js        # tracking de fire-and-forget com drain
├── error-policy.js            # classificação e wrapper de política de erro
├── event-bridge-map.js        # mapa declarativo de eventos
├── event-bridge-wiring.js     # wiring lazy EventEmitter -> EventBus
├── health-check.js            # snapshot canônico de health
├── lifecycle/                 # start / stop / reconnect / state-io / session-setup / entry
├── session/                   # init / ownership / cleanup / keepalive / boot-wiring / snapshots
├── dialog/                    # loop manager / turn executor / watchdog / protocol / backpressure
├── messaging/                 # send / steer / answer / process queue
├── infra/                     # queue / handoff / task execution compat
├── facades/                   # session/model/webhook facades
└── state/                     # snapshot e funções auxiliares de estado
```

### O que mudou de verdade em relação ao retrato antigo

1. **A classe `AlwaysAliveAgent` já não concentra a maior parte da lógica.**
   Ela virou majoritariamente uma fachada pública que delega para `lifecycle/`, `dialog/`, `messaging/`, `state/`
   e facades.

2. **O boot do agente já é step-based.**
   O antigo “performBootWiring monolítico” foi substituído por um pipeline com steps nomeados, extraídos em
   `boot-steps.js`.

3. **O runtime já ganhou mecanismos de shutdown mais sólidos.**
   Há `backgroundTasks.drain()`, `drainStateWrites()`, cleanup de watchers e controle melhor de reentrância.

4. **A observabilidade do agent é substancialmente melhor.**
   Existem snapshots formais, health checks, tracking de tarefas em background, spans OTEL e bridge de eventos
   declarativo.

---

## 4. Pontos fortes atuais

### 4.1 A decomposição funcional já aconteceu

O problema dominante em março era concentração de lógica. Em abril, a decomposição já está materializada.

Isso muda a natureza do trabalho: agora não é mais “quebrar monólito”, e sim **endurecer fronteiras entre módulos**.

### 4.2 O pipeline de boot deixou de ser uma caixa-preta

O boot está organizado por etapas nomeadas, o que melhora muito:

- leitura arquitetural;
- testabilidade por step;
- logging por etapa;
- rollback mental de problemas de boot.

### 4.3 O subsistema já possui noção formal de health

O agent não depende mais só de heurística ad hoc. Hoje há um `getHealthSnapshot()` canônico, com status consolidado e
detalhamento por checks (`runtime`, `client`, `session`, `dialog`, `queue`, `background`, `quota`, `io`).

### 4.4 O lazy singleton já existe de forma funcional

O `getAgent()` já encapsula a criação real. O export `alwaysAliveAgent` virou uma camada de compatibilidade, não mais
o mecanismo canônico de construção.

Nesta rodada, a migração avançou mais um pouco:

- `agent/lifecycle/entry.js` passou a usar `getAgent()`;
- `presentation/agent-control.js` passou a usar `getAgent()`;
- a documentação de uso do canal (`channel/index.js`) também foi alinhada.

### 4.5 Os testes atuais são muito melhores do que o documento antigo indicava

O documento de março subestimava a cobertura real. Hoje existem, entre outros:

- `tests/unit/copilot/test_agent_context.spec.js`
- `tests/unit/copilot/test_agent_error_policy.spec.js`
- `tests/unit/copilot/test_agent_health_check.spec.js`
- `tests/unit/copilot/test_agent_health_routes.spec.js`
- `tests/unit/copilot/test_agent_lifecycle.spec.js`
- `tests/unit/copilot/test_agent_messaging.spec.js`
- `tests/unit/copilot/test_agent_dialog_controller.spec.js`
- `tests/unit/copilot/test_loop_manager.spec.js`
- `tests/unit/copilot/test_message_queue.spec.js`
- `tests/unit/copilot/test_always_alive_dialog_loop.spec.js`
- `tests/unit/copilot/test_agent_background_tasks_integration.spec.js`
- `tests/unit/copilot/test_agent_state.spec.js`

Ainda há gaps, mas o cenário não é mais “quase sem testes”.

---

## 5. Problemas arquiteturais e gaps que continuam vivos

## 5.1 🔴 `AgentContext` ainda é o centro mutável do sistema

O `AgentContext` melhorou bastante: agora há subestados nomeados e, nesta rodada, ele ganhou **helpers semânticos** como:

- `invalidateStatusSnapshot()`
- `incrementSendCount()`
- `setPendingQuestion(...)`
- `clearPendingQuestion()`
- `setClient(...)` / `clearClient()`
- `setSession(...)` / `clearSession()`
- `setIsResumed(...)`
- `setSendCount(...)`
- `setDialogLoopAttached(...)`
- `setContextState(...)`
- `setLastCheckpointPath(...)`
- `setBootReport(...)`
- `resolvePendingQuestion(...)`
- `getBackgroundPendingLabels(...)`

Mesmo assim, o coração do problema permanece:

- vários módulos ainda leem e escrevem `ctx.sessionState`, `ctx.dialogState`, `ctx.runtimeState`, `ctx.metricsState`
  diretamente;
- não há ownership formal por domínio (“quem pode mutar o quê?”);
- os subestados são objetos públicos mutáveis, não controladores com invariantes.

**Conclusão**: a partição existe, mas a encapsulação ainda é parcial.

---

## 5.2 🟠 Contratos de host ainda são parcialmente informais

O cenário melhorou nesta rodada:

- `loop-manager.js` deixou de depender de casts `unknown -> EventEmitter` para ouvir `question.pending`;
- `messaging/agent-messaging.js` deixou de converter o host à força em `EventEmitter` só para trocar status;
- `types.js` foi ampliado para refletir melhor hosts que também são emissores de eventos.
- `session-setup.js` removeu parte importante da dívida artificial de compatibilidade: `mcpServers` voltou ao caminho
  tipado do builder, e o handler de `onUserInputRequest` agora normaliza a assinatura opcional do SDK antes de entrar
  no runtime do agente.

Mas ainda restam sinais de fragilidade:

- `session-setup.js` ainda possui casts e composições menos rígidas;
- `state-io.js`, `snapshot.js` e alguns pontos auxiliares ainda usam casts `unknown` por conveniência estrutural;
- os contratos continuam baseados em JSDoc estrutural, sem validação runtime dedicada.

Nesta rodada, porém, houve um endurecimento adicional importante:

- `runtime-contracts.js` passou a concentrar guards e compat shims (`assertEmitterHost(...)`,
  `trySetLiveSessionModel(...)`, normalizadores de eventos), retirando exceções de contrato dos módulos quentes;
- `sdk/types.js` e `hooks/types.js` foram realinhados com a shape real do SDK 0.2.0, eliminando o drift que ainda
  forçava boundary artificial em `session-setup.js`;
- `session-setup.js` passou a registrar `hooks` via `SessionConfigBuilder.hooks(...)`, sem cast de compatibilidade;
- `boot-steps.js` perdeu o cast residual para `ctx.mcpBridge`;
- `turn-executor.js` ganhou cleanup explícito dos listeners de `AbortSignal`, reduzindo leak passivo em retries e em
  turnos abortados.

**Status atual do grep estrutural**: o subtree `src/copilot/agent/` não retorna mais casts `unknown` residuais no hot
path.

**Conclusão**: saímos do modo “bypass por toda parte” para “bypass residual concentrado”, o que já é um avanço real.

---

## 5.3 🟠 Error handling centralizado existe, mas a adoção ainda está em rollout

O quadro atual é melhor que o de março e melhorou também nesta última onda:

- `classifyAgentError(...)` já existia;
- nesta rodada foi adicionada `withAgentErrorPolicy(...)`;
- `messaging/agent-messaging.js` passou a usar o wrapper central;
- `lifecycle/reconnect-policy.js` passou a usar o mesmo wrapper;
- `dialog/agent-dialog-controller.js` passou a usar a policy em `start/stop/resume` do loop;
- `session/ownership.js` ganhou wrappers `sync*WithPolicy` / `clear*WithPolicy` para não transformar falhas laterais
  de vínculo SDK↔hub em abortos arbitrários do runtime;
- `lifecycle/state-io.js` ganhou `persistStateWithPolicy(...)`, e esse helper passou a ser usado em
  `agent-lifecycle.js`, `dialog/user-input-handler.js`, `dialog/loop-manager.js` e `dialog/turn-executor.js`.
- o subsistema `src/copilot/hooks/` deixou de manter políticas de erro divergentes por preset/factory: `factory.js`,
  `session-hooks.js` e os presets `minimal/safe/interactive/deny-all/audit` agora convergem para handlers canônicos,
  com estado de retry/circuit isolado por `sessionId + errorContext`.
- o preset de produção também deixou de usar `console.info` como destino padrão de auditoria e passou a registrar
  entradas estruturadas em `defaultAuditLog`.
- numa rodada dedicada ao `ask_user`, o runtime passou a distinguir pergunta viva do SDK de sombra persistida restaurada
  do disco (`pendingQuestionShadow`), com classificação semântica (`ready/reply/stopped/question`) refletida em
  health, terminal e snapshots.

Também foi corrigido um bug operacional importante em `dialog/user-input-handler.js`: perguntas interativas reais agora
persistem `pendingQuestion + lastAskUserAt` em **uma única operação**, enquanto mensagens de protocolo interno do dialog
loop (`READY` / `REPLY` / `STOPPED`) deixam de gerar persistência redundante em disco.

O que ainda falta:

- adotar o wrapper em mais fluxos assíncronos do agent (especialmente boot/hooks internos que ainda operam por policy
  local ou via fire-and-forget simples);
- reduzir padrões locais duplicados de `try/catch + classify + emit + retry`;
- enriquecer a política com metadados estruturados por contexto (`label`, `phase`, `sessionId`, `taskId`).

Nesta continuação, o subsistema de hooks também deixou de compartilhar retry/circuit state por contexto puro:

- `hooks/error-handler.js` agora escopa `retryCounts` e `circuits` por `sessionId + errorContext`;
- isso elimina o leak cross-session em que uma sessão podia herdar o estado de retry/circuit-breaker de outra.

**Conclusão**: a policy deixou de ser apenas “um classificador com dois call sites” e passou a cobrir partes centrais
de `messaging`, `reconnect`, `dialog`, `ownership` e persistência auxiliar — mas ainda não domina o módulo inteiro.

---

## 5.4 🟠 O lazy singleton está funcional, porém ainda não foi “fechado” como fronteira única

Hoje a situação correta é:

- `getAgent()` é o mecanismo canônico;
- `alwaysAliveAgent` é um proxy de compatibilidade;
- parte dos consumidores já foi migrada.

Ainda assim, o runtime preserva uma nuance importante:

- o wiring de DI do terminal ainda usa o proxy por um motivo legítimo: evitar materialização prematura do singleton em
  caminhos onde `wireLegacySetters()` resolve tokens durante o boot.

Ou seja: a dívida atual **não é apagar o proxy a qualquer custo**, mas sim:

1. migrar consumidores operacionais onde isso é seguro;
2. manter o proxy como boundary explícita de compatibilidade;
3. documentar melhor as exceções legítimas.

Nesta rodada, o DI do terminal avançou exatamente nessa direção:

- o token canônico `ALWAYS_ALIVE_AGENT` passou a resolver `getAgent()`;
- os tokens legados usados por `wireLegacySetters()` permaneceram no proxy compatível `alwaysAliveAgent`, deixando a
  exceção de boot lazy explicitamente isolada em `terminal/di-wiring.js`.

---

## 5.5 🟡 O boot pipeline melhorou, mas o contexto de wiring ainda é largo demais

O `performBootWiring()` já não é o mesmo gargalo opaco de março. Porém ainda existe uma dívida de desenho:

- o `BootWiringContext` continua carregando muitos callbacks e referências;
- a orquestração dos steps ainda é imperativa, não descrita por contratos de capability/ownership;
- já existe medição nativa de duração/falha por step em `bootReport`, mas ela ainda não foi propagada com toda a
  riqueza possível para observabilidade, rotas e troubleshooting operacional.

**Conclusão**: o pipeline existe, mas ainda pode evoluir para um runtime de boot mais observável e mais tipado.

---

## 5.6 🟡 Multi-session continua ausente

O agent continua desenhado para uma sessão principal por vez. Há rotação, retomada, ownership e recuperação, mas não
há um runtime multi-session isolado com scheduling real entre sessões ativas.

Isso não é bug imediato, mas é uma limitação estrutural que continua válida.

---

## 5.7 🟡 Watchdog adaptativo e handoff formal continuam incompletos

- o watchdog do diálogo ainda usa thresholds configurados, não aprendidos a partir do histórico real;
- o handoff existe, mas segue menos formalizado/testado do que o restante do núcleo `agent`.

---

## 6. Mudanças concretas aplicadas nesta rodada

Além da reanálise documental, esta rodada entregou mudanças reais no código do `agent`:

### 6.1 Fortalecimento de contratos e remoção de casts quentes

- `dialog/loop-manager.js`
  - removeu parte relevante do bypass `unknown -> EventEmitter`;
  - o host agora é tratado como fonte opcional de eventos de forma explícita.
- `messaging/agent-messaging.js`
  - deixou de precisar forçar o host a `EventEmitter` só para atualizar status.

### 6.2 `AgentContext` ganhou mutações semânticas mínimas

Foram adicionados helpers para começar a reduzir mutação crua no hot path:

- `invalidateStatusSnapshot()`
- `incrementSendCount()`
- `setPendingQuestion(...)`
- `clearPendingQuestion()`

Ainda não resolve tudo, mas reduz entropia justamente nos campos mais tocados pelo runtime.

### 6.2b Mutation API ampliada na segunda onda

O endurecimento avançou além do primeiro lote. Hoje o `AgentContext` também já expõe:

- `setClient(...)` / `clearClient()`
- `setSession(...)` / `clearSession()`
- `setIsResumed(...)`
- `setSendCount(...)`
- `setDialogLoopAttached(...)`
- `setContextState(...)`
- `setLastCheckpointPath(...)`
- `setBootReport(...)`
- `resolvePendingQuestion(...)`
- `getBackgroundPendingLabels(...)`

Isso ainda não fecha a dívida de ownership, mas desloca mais mutações do runtime para uma API semântica central.

### 6.2c Leitura semântica começou a substituir leitura crua

Além da mutation API, o `AgentContext` passou a atuar também como fronteira de **leitura semântica**. Nesta rodada,
foram adicionados helpers como:

- `hasClient()`
- `hasActiveSession()`
- `hasPendingQuestion()`
- `getBackgroundPendingCount()`
- `getLastPrInfoSnapshot()`
- `getBootReportSnapshot()`

E eles já foram adotados em módulos quentes como:

- `health-check.js`
- `messaging/agent-messaging.js`
- `dialog/agent-dialog-controller.js`
- `facades/agent-sdk-access.js`
- `facades/agent-model-config.js`
- `facades/agent-session-ops.js`
- `state/agent-state.js`
- getters públicos de `always-alive.js`

Na prática, isso reduz o acoplamento estrutural ao shape interno de `sessionState/dialogState/...` e empurra o agent na
direção certa do `CA-3`.

### 6.3 Error policy evoluiu de classificador para wrapper operacional

`error-policy.js` agora expõe `withAgentErrorPolicy(...)`, e o wrapper já foi adotado em:

- `messaging/agent-messaging.js`
- `lifecycle/reconnect-policy.js`
- `dialog/agent-dialog-controller.js`
- `session/ownership.js` (wrappers protegidos para vínculo SDK↔hub)
- `lifecycle/state-io.js` via `persistStateWithPolicy(...)`

Esse helper de persistência canônica agora já é usado no runtime quente em:

- `lifecycle/agent-lifecycle.js`
- `messaging/agent-messaging.js`
- `dialog/user-input-handler.js`
- `dialog/loop-manager.js`
- `dialog/turn-executor.js`
- `session/boot-steps.js`
- `session/initializer.js`

Com isso, o grep de `writeStateAsync(...)` no subtree `src/copilot/agent/` ficou essencialmente restrito ao próprio
`lifecycle/state-io.js` (onde a primitiva de persistência deve continuar morando), em vez de aparecer espalhado pelos
módulos quentes do runtime.

### 6.4 Lazy singleton avançou em consumidores reais

Foram migrados para `getAgent()`:

- `agent/lifecycle/entry.js`
- `presentation/agent-control.js`

Também foi atualizada a documentação de uso em `channel/index.js`.

Além disso, o DI do terminal passou a resolver o token canônico `ALWAYS_ALIVE_AGENT` via `getAgent()`, preservando o
proxy compatível apenas nos tokens legados acionados por `wireLegacySetters()`.

Também nesta rodada:

- o `agent` passou a expor `getSdkHandles()` e `getSdkResourceSnapshot()`;
- a API pública do `AlwaysAliveAgent` agora inclui acesso canônico a status/auth/last session/foreground session/
  sessions/custom agents do SDK atual;
- `server/routes/agent-health.js` passou a projetar `sdkResources` no health do módulo.

### 6.5 Boot e health ficaram mais observáveis

Nesta segunda onda, o pipeline de boot do agent passou a registrar:

- nome da step;
- fase (`session`, `observability`, `dialog`, `quota`, etc.);
- duração;
- outcome (`ok` / `failed`);
- timestamp.

Esse `bootReport` agora entra no runtime state e alimenta o health snapshot do agente, junto com:

- `backgroundPendingLabels` para identificar backlog real de fire-and-forget;
- sinal de `boot.steps_failed` quando uma rodada de boot falhou em alguma etapa.
- sinal de `boot.steps_degraded` quando o boot conclui, mas com alguma etapa opcional degradada;
- `riskFlags` para resumir os riscos canônicos do snapshot operacional.
- `recommendedAction` para sugerir a próxima ação de troubleshooting.

Além disso, o próprio runner do pipeline agora executa cada etapa sob a `withAgentErrorPolicy(...)`:

- step `required=true` continua derrubando o boot quando falha;
- step opcional com erro retryable passa a ser marcado como `degraded`;
- step opcional abortado explicitamente passa a ser marcado como `skipped`.

Isso reduz falsos negativos operacionais: o boot não precisa mais fingir que está totalmente saudável quando parte da
observabilidade/startup lateral falha, mas também não derruba a LLM-B inteira por falhas não-críticas.

### 6.6 O agent agora tem superfície SDK explícita e auditável

Foi criada `agent/facades/agent-sdk-access.js`, e o `AlwaysAliveAgent` agora expõe:

- handles crus controlados (`client`, `session`, `serverRpc`, `sessionRpc`, `workspacePath`);
- snapshot de cobertura (`getSdkResourceSnapshot()`), com flags como `allCoreResourcesAvailable` e
  `allRuntimeResourcesAvailable`;
- operações canônicas sobre o runtime SDK atual:
  - `pingSdk()`
  - `getSdkStatus()`
  - `getSdkAuthStatus()`
  - `getLastSdkSessionId()`
  - `getForegroundSdkSessionId()` / `setForegroundSdkSessionId()`
  - `listSdkSessions()`
  - `listSdkAgents()` / `getCurrentSdkAgent()` / `selectSdkAgent()` / `deselectSdkAgent()` / `reloadSdkAgents()`

Isso fecha uma lacuna importante: antes o agent tinha acesso implícito ao SDK pelo contexto interno, mas não possuía
uma superfície pública/canônica suficientemente explícita nem um mecanismo runtime para verificar a cobertura real do
SDK acoplado.

---

## 7. Cobertura de testes atual — leitura corrigida

### 7.1 O que já existe

Cobertura atual já visível no repositório:

| Área                       | Evidência                                                                                                                |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Contexto/estado            | `test_agent_context.spec.js`, `test_agent_state.spec.js`                                                                 |
| Error policy               | `test_agent_error_policy.spec.js`                                                                                        |
| Health                     | `test_agent_health_check.spec.js`, `test_agent_health_routes.spec.js`                                                    |
| Lifecycle                  | `test_agent_lifecycle.spec.js`                                                                                           |
| Messaging                  | `test_agent_messaging.spec.js`                                                                                           |
| Dialog                     | `test_agent_dialog_controller.spec.js`, `test_loop_manager.spec.js`, `test_always_alive_dialog_loop.spec.js`             |
| Queue/backpressure         | `test_message_queue.spec.js`                                                                                             |
| Integração/observabilidade | `test_agent_background_tasks_integration.spec.js`, `test_agent_integration.spec.js`, `test_agent_event_observer.spec.js` |

### 7.2 O que ainda falta

Gaps ainda relevantes:

- boot steps isolados (`boot-steps.js`) com cobertura específica por step;
- regressão de lazy singleton/import-time behavior;
- cobertura mais profunda de `reconnect-policy.js`;
- cobertura para os novos helpers semânticos do `AgentContext` em cenários integrados, não só unitários simples;
- validação de ownership/ACL e cenários de session rotation em maior profundidade.

---

## 8. Dívida técnica priorizada (versão abril/2026)

| ID    | Severidade | Item                                                         | Estado  | Impacto                                  |
| ----- | ---------- | ------------------------------------------------------------ | ------- | ---------------------------------------- |
| `A1`  | 🔴          | Encapsular de verdade os subestados do `AgentContext`        | Aberto  | invariantes, testabilidade, ownership    |
| `A2`  | 🔴          | Eliminar casts residuais e endurecer contratos de host       | Parcial | robustez semântica, typing               |
| `A3`  | 🔴          | Expandir cobertura crítica de boot/reconnect/lazy singleton  | Parcial | regressão estrutural                     |
| `A4`  | 🟠          | Adotar `withAgentErrorPolicy(...)` em todo o núcleo do agent | Parcial | consistência operacional                 |
| `A5`  | 🟠          | Enxugar `BootWiringContext` e medir timings/falhas por step  | Aberto  | operabilidade de boot                    |
| `A6`  | 🟠          | Fechar migração canônica para `getAgent()`                   | Parcial | previsibilidade de lifecycle             |
| `A7`  | 🟠          | Consolidar superfície SDK do agent como contrato estável     | Parcial | capacidade operacional / extensibilidade |
| `A8`  | 🟡          | Health mais rico (step timings, backlog labels, ownership)   | Parcial | diagnóstico runtime                      |
| `A9`  | 🟡          | Watchdog adaptativo                                          | Aberto  | falsos positivos / tuning                |
| `A10` | 🟡          | Multi-session/handoff formal                                 | Aberto  | evolução arquitetural                    |

---

## 9. Conclusão

O retrato correto do `agent` em abril/2026 é:

- **não** é mais um módulo “quase todo por fazer”;
- **já** tem várias entregas estruturais relevantes que em março eram apenas idealização;
- **a principal dívida agora é de endurecimento de fronteiras**, não de decomposição bruta.

Em resumo:

> **Situação atual real** = base arquitetural boa, observabilidade forte, pipeline de boot modular, lazy singleton funcional,
> health formal e background task tracking entregues; porém ainda com `AgentContext` excessivamente mutável,
> contratos parcialmente informais, adoção incompleta da policy de erro e roadmap aberto para testes/ownership/multi-session.
