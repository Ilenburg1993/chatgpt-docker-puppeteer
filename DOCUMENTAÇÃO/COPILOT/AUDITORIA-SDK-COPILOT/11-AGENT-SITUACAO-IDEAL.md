# 11 — Agent Module: Nova Situação Ideal Proposta

**Data de atualização**: 2026-04-17 **Escopo**: `src/copilot/agent/` **Status**: proposta v2.1
alinhada com o código vivo, com critérios explícitos de consolidação **Referências**:

- [09-AGENT-LOGICA-FLUXO.md](./09-AGENT-LOGICA-FLUXO.md)
- [10-AGENT-SITUACAO-ATUAL.md](./10-AGENT-SITUACAO-ATUAL.md)
- [../AUDITORIA-PROFUNDA-ABRIL-2026/14-FLUXO-AGENT-TERMINAL-SDK.md](../AUDITORIA-PROFUNDA-ABRIL-2026/14-FLUXO-AGENT-TERMINAL-SDK.md)
- [../AUDITORIA-PROFUNDA-ABRIL-2026/15-ARQUITETURA-PADRONIZADA-E-CENTRALIZADA.md](../AUDITORIA-PROFUNDA-ABRIL-2026/15-ARQUITETURA-PADRONIZADA-E-CENTRALIZADA.md)

---

## 1. Princípio básico desta nova proposta

A situação ideal **não é reescrever o agent**.

A base de abril/2026 já tem muitos elementos corretos:

- fachada pública em `always-alive.js`;
- submódulos por domínio (`dialog`, `lifecycle`, `session`, `messaging`, `state`, `infra`,
  `facades`);
- boot pipeline por steps;
- bridge declarativo;
- health formal;
- background task tracker;
- lazy singleton funcional.

Portanto, a nova situação ideal deve atacar o que ainda dói de verdade:

1. **governança de estado**;
2. **contratos de host e remoção de bypasses**;
3. **centralização real do tratamento de erro**;
4. **completeza do lazy singleton**;
5. **observabilidade e testabilidade do boot/runtime**.

---

## 2. O que não faz sentido repropor

As propostas antigas `K4`–`K7` já foram essencialmente entregues e não devem reaparecer como “ideal
futuro pendente”:

| Tema                     | Situação em abril/2026 |
| ------------------------ | ---------------------- |
| Background task tracker  | já entregue            |
| Boot pipeline            | já entregue            |
| Event bridge declarativo | já entregue            |
| Health check formal      | já entregue            |

`K8` (lazy singleton) e `K3` (error policy) não estão mais “por fazer”; estão em **fase de
endurecimento e adoção**.

`K1` (estado) continua sendo a dívida arquitetural dominante.

---

## 3. Nova situação ideal — visão de arquitetura

## 3.1 Objetivo

Chegar a um `agent` onde:

- `AlwaysAliveAgent` seja **uma fachada fina** e previsível;
- `AgentContext` seja **composição**, não “bolsa de mutação livre”;
- cada submódulo tenha **contrato explícito de capabilities**;
- o runtime inteiro use **uma política canônica de erro**;
- `getAgent()` seja o caminho normal de obtenção da instância;
- health, boot e shutdown sejam **auditáveis por step e por backlog**, não apenas por status
  agregado.

---

## 3.2 Arquitetura-alvo (v2)

```text
┌────────────────────────────────────────────────────────────┐
│                    AlwaysAliveAgent                         │
│  - API pública                                              │
│  - zero lógica de negócio densa                             │
│  - delegação para lifecycle/dialog/messaging/state          │
└───────────────┬────────────────────────────────────────────┘
                │
        ┌───────▼────────────────────────────────────────┐
        │ AgentContext (composição + mutation API)       │
        │                                                │
        │ sessionState   -> owner: session/lifecycle     │
        │ dialogState    -> owner: dialog/               │
        │ configState    -> owner: facades/config        │
        │ metricsState   -> owner: state/observability   │
        │ runtimeState   -> owner: lifecycle             │
        │ ioState        -> owner: lifecycle/session     │
        │ backgroundTasks -> cross-cutting, read-only    │
        └───────┬────────────────────────────────────────┘
                │
   ┌────────────┼────────────┬────────────┬────────────┬────────────┐
   ▼            ▼            ▼            ▼            ▼            ▼
 lifecycle/   dialog/     session/    messaging/     state/      infra/
    │            │            │            │            │            │
    └───── usam apenas contracts/capabilities explícitos ───────────┘
```

### Regra central da proposta

O ideal não é “ninguém tocar `ctx.*State` nunca mais” de um dia para o outro.

O ideal é:

1. **módulos quentes** param de escrever campos crus primeiro;
2. `AgentContext` passa a oferecer uma **mutation API mínima e semântica**;
3. ownership por subestado fica explícito;
4. acesso bruto vira exceção controlada, não padrão dominante.

## 3.3 Critérios explícitos de fronteira entre `sdk`, `event-handlers`, `agent`, `presentation` e bordas

Para evitar regressão conceitual, a situação ideal precisa deixar de ser apenas “diagrama bonito” e
virar regra operacional verificável.

### `sdk/`

Deve ser responsável por:

- contratos vanilla do `@github/copilot-sdk`;
- wrappers canônicos de sessions/agents/rpc/mode/plan;
- helpers que preservam a semântica original do SDK.

Não deve ser responsável por:

- projections HTTP/REPL;
- estado contínuo do runtime local;
- narrativa de UX do terminal.

### `event-handlers/`

Deve ser responsável por:

- tradução de `SessionEvent` cru para sinais internos estáveis.

Não deve ser responsável por:

- health do runtime;
- payloads de borda;
- estado mutável do `agent`.

### `agent/`

Deve ser responsável por:

- lifecycle, reconnect, dialog loop, queue, `ask_user`, ownership, health source-of-truth;
- facades públicas do runtime e da superfície útil do SDK.

Não deve ser responsável por:

- parsing de request HTTP;
- projections compartilhadas de `server/`/`terminal/`;
- UX final do operador.

### `presentation/`

Deve ser responsável por:

- seleção compartilhada de runtime (`runtimeId`, fallback, targeting);
- projections/payloads compartilhadas entre `server/` e `terminal/`;
- composição de deps de routers e handlers compartilhados de borda.

Não deve ser responsável por:

- source-of-truth do runtime;
- tradução de `SessionEvent` cru;
- mutação arbitrária do `AgentContext`;
- estado exclusivamente local do terminal, exceto por façades deliberadas de compatibilidade.

### `terminal/`

Deve ser responsável por:

- REPL, prompt, render, waiting UX, narrativa operacional local.

Não deve ser responsável por:

- reinterpretar o SDK em paralelo;
- decidir sozinho como selecionar o runtime compartilhado quando já existir façade/projection em
  `presentation/`.

### `observability/`

Deve ser responsável por:

- logs, métricas, tracing, timelines e snapshots observáveis.

Não deve ser responsável por:

- governar semântica do SDK;
- criar payloads canônicos de borda;
- selecionar runtime.

---

## 4. Propostas novas (Faixa L)

## L1 — Hardening de estado (`AgentContext` deixa de ser “mutável por qualquer um”) 🔴

### Situação atual

Existe partição (`sessionState`, `dialogState`, etc.), mas ainda há mutação direta disseminada.

### Situação ideal

`AgentContext` expõe **mutation methods semânticos** para o hot path e reduz writes diretos.

Exemplos de API desejada:

- `setStatus(...)`
- `invalidateStatusSnapshot()`
- `incrementSendCount()`
- `setPendingQuestion(...)`
- `clearPendingQuestion()`
- `setClient(...)`
- `setSession(...)`
- `setDialogAttached(...)`
- `setContextWindow(...)`
- `setLastCheckpointPath(...)`

### Estado desta rodada

Entregue parcialmente:

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
- `getPendingQuestionSnapshot()`
- `getSessionEventUnsubscribersSnapshot()`
- `getBackgroundPendingLabels(...)`
- `hasClient()`
- `hasActiveSession()`
- `hasPendingQuestion()`
- `getBackgroundPendingCount()`
- `getLastPrInfoSnapshot()`
- `getBootReportSnapshot()`

Estado adicional desta continuação:

- `session-setup.js` passou a ler `model`/`reasoningEffort`/`mcpBridge` pelo caminho semântico
  (`ctx.model`, `ctx.reasoningEffort`, `ctx.mcpBridge`) no wiring quente da sessão;
- `agent-lifecycle.js` deixou de manter aliases largos de
  `configState/sessionState/dialogState/runtimeState/metricsState/ioState` nos fluxos principais de
  `start/stop/reconnect`, consumindo getters/snapshots do `AgentContext` em vez do shape cru;
- `health-check.js` passou a preferir snapshots semânticos (`getPendingQuestionSnapshot()` /
  `getPendingQuestionShadowSnapshot()`) antes de cair para fallback estrutural.

### Próximo passo ideal

Fechar o ownership final dos poucos reads/writes restantes no núcleo e manter o subtree quente
(`messaging`, `dialog`, `facades`, `state`, `health`) dependente apenas da API semântica do
`AgentContext`, não do shape cru dos subestados.

---

## L2 — Contratos de host e capability boundaries 🔴

### Situação atual

Os contratos via JSDoc já ajudam, mas ainda existem bypasses e casts residuais.

### Situação ideal

Criar fronteiras explícitas por capability:

- `AgentEventHost`
- `DialogRuntimeHost`
- `TurnHost`
- `ReconnectHost`
- `BootStepContext`

E, quando necessário, helpers de validação runtime leves:

- `assertEmitterHost(...)`
- `assertDialogHost(...)`
- `assertReconnectHost(...)`

### Estado desta rodada

Avanço real:

- `loop-manager.js` perdeu um dos casts mais feios (`unknown -> EventEmitter`);
- `messaging/agent-messaging.js` deixou de exigir cast de `host` só para `setStatus()`;
- `types.js` foi endurecido para refletir melhor hosts emissores de eventos.
- `session-setup.js` removeu parte importante da dívida artificial de compatibilidade, mantendo cast
  estreito apenas na fronteira real de `hooks`, enquanto `mcpServers` e `onUserInputRequest`
  voltaram ao caminho semanticamente tipado.
- `runtime-contracts.js` concentrou guards e compat shims leves (`assertEmitterHost(...)`,
  `trySetLiveSessionModel(...)`, normalizadores de eventos), retirando exceções de contrato do meio
  dos módulos quentes.
- `boot-steps.js` deixou de usar cast estrutural para acessar `ctx.mcpBridge`.
- `turn-executor.js` ganhou normalização explícita de payloads e cleanup determinístico de listeners
  de `AbortSignal` tanto no retry quanto no caminho principal de `sendTurn()`.
- `sdk/types.js` e `hooks/types.js` foram realinhados com a shape real de hooks do SDK 0.2.0,
  permitindo que `session-setup.js` passe a registrar `hooks` via builder tipado, sem o boundary
  artificial de compatibilidade.

### Próximo passo ideal

manter zero casts residuais no hot path e empurrar qualquer compatibilidade futura para adapters
explícitos e isolados.

---

## L3 — Error Policy v2: classifier + wrapper + adoção total 🔴

### Situação atual

O classificador existe; agora também existe `withAgentErrorPolicy(...)`, mas a adoção ainda é
parcial.

### Situação ideal

Todos os fluxos críticos do `agent` usam um mecanismo comum para:

- normalizar o erro;
- classificar (`ignore` / `retry` / `fatal`);
- registrar contexto operacional (`label`, `phase`, `taskId`, `sessionId`);
- decidir retry/reconnect/falha terminal.

### Estado desta rodada

`withAgentErrorPolicy(...)` foi implementado e adotado em:

- `messaging/agent-messaging.js`
- `lifecycle/reconnect-policy.js`
- `dialog/agent-dialog-controller.js`
- `session/ownership.js` por meio dos wrappers `syncActiveSessionOwnershipWithPolicy(...)` e
  `clearActiveSdkSessionOwnershipWithPolicy(...)`

Além disso, a persistência auxiliar do runtime ganhou um caminho canônico:

- `lifecycle/state-io.js` agora expõe `persistStateWithPolicy(...)`;
- esse helper já foi propagado para `agent-lifecycle.js`, `messaging/agent-messaging.js`,
  `dialog/user-input-handler.js`, `dialog/loop-manager.js`, `dialog/turn-executor.js`
  `session/boot-steps.js` e `session/initializer.js`.

Também foi corrigido o bug de persistência redundante em `dialog/user-input-handler.js`: perguntas
interativas reais passam a persistir `pendingQuestion + lastAskUserAt` em uma única operação,
enquanto mensagens de protocolo do dialog loop deixam de gerar I/O desnecessário.

### Próximo passo ideal

Expandir para:

- hooks internos do agent;
- rotação/session cleanup onde ainda houver tratamento local demais;
- etapas de boot/wiring que ainda dependem de heurística ad hoc em vez de contexto operacional
  padronizado.

### Estado adicional desta continuação

- `hooks/error-handler.js` deixou de compartilhar `retryCounts` e `circuits` entre sessões
  distintas;
- o estado de recuperação agora é escopado por `sessionId + errorContext`, reduzindo leak
  cross-session em hooks.
- `hooks/factory.js`, `hooks/session-hooks.js` e os presets
  `minimal/safe/interactive/deny-all/audit` passaram a delegar `onErrorOccurred` ao motor canônico
  de erro, reduzindo deriva de política entre módulos do subsistema de hooks.
- `presets/production.js` deixou de usar `console.info` como destino padrão de auditoria e passou a
  registrar entradas estruturadas em `defaultAuditLog`, mitigando a mistura entre audit log e log
  operacional.
- o subfluxo `ask_user` agora respeita também o default real do SDK para `allowFreeform`
  (`undefined` → `true`) em `session-setup.js`, em vez de degradar silenciosamente para `false`.

---

## L4 — Lazy singleton “fechado” como caminho canônico 🔴

### Situação atual

`getAgent()` já é o caminho certo, mas o proxy compatível ainda convive com consumidores legados.

### Situação ideal

- consumidores operacionais usam `getAgent()`;
- o proxy `alwaysAliveAgent` fica marcado como camada de compatibilidade;
- exceções legítimas (como DI que não pode materializar a instância cedo demais) ficam documentadas
  e isoladas.

### Estado desta rodada

Migração aplicada em:

- `agent/lifecycle/entry.js`
- `presentation/agent-control.js`
- documentação pública do canal
- `terminal/di-wiring.js` agora registra o token canônico `ALWAYS_ALIVE_AGENT` resolvendo
  `getAgent()`, enquanto os tokens legados consumidos por `wireLegacySetters()` permanecem no proxy
  compatível.

### Estado adicional desta rodada

- o caminho quente do `agent` deixou de ter casts `unknown` residuais no grep do subtree
  `src/copilot/agent/`;
- o proxy `alwaysAliveAgent` permanece apenas como camada de compatibilidade deliberada, enquanto a
  instância real já é o default do token canônico de DI e dos consumidores operacionais novos.

### Próximo passo ideal

revisar os poucos call sites restantes e decidir, caso a caso, se devem usar `getAgent()` ou manter
proxy por motivo de boot lazy.

---

## L5 — Boot pipeline com observabilidade de step 🟠

### Situação atual

O pipeline de steps já existe.

### Estado desta rodada

Avanço real:

- `runBootPipeline(...)` passou a registrar duração/resultado por step;
- o runner de boot agora classifica steps opcionais como `degraded` ou `skipped`, em vez de derrubar
  o boot inteiro por qualquer erro lateral;
- `performBootWiring(...)` agora retorna `bootReport` consolidado;
- `AgentContext.runtimeState.lastBootReport` já recebe esse relatório;
- `health-check.js` passou a refletir falhas de boot e backlog rotulado.

### Situação ideal

Cada step de boot deve carregar:

- nome canônico;
- fase (`session`, `observability`, `dialog`, `mcp`, `handoff`, `health`);
- duração;
- outcome (`ok`, `skipped`, `degraded`, `failed`);
- impacto no health snapshot.

### Próximo passo ideal

propagar `degraded/skipped` para dashboards/rotas/diagnósticos adicionais e reduzir ainda mais
heurísticas locais no boot wiring.

---

## L6 — Health snapshot enriquecido 🟠

### Situação atual

O health atual já é bom. O problema deixou de ser “não existe health” e passou a ser “ainda dá para
enriquecer muito”.

### Estado desta rodada

O health já evoluiu além da versão anterior e agora expõe:

- `backgroundPendingLabels`;
- `bootReport`;
- check `boot` com `failedSteps` e `lastCompletedAt`.
- check `boot` com `degradedSteps` além de `failedSteps`.
- `riskFlags` canônicas derivadas do estado operacional.
- `recommendedAction` com próxima ação sugerida para troubleshooting.
- `sdkResources` na projeção HTTP/registry, permitindo verificar em runtime a cobertura real da
  superfície SDK acoplada ao agent.

### Situação ideal

Adicionar no snapshot:

- labels das tarefas de background pendentes;
- timings recentes de boot steps;
- status de ownership/session rotation;
- flags de risco de drift (`dialog active but host detached`, `quota monitor stale`, etc.);
- hint operacional para o operador (“próxima ação recomendada”).

---

## L7 — Sprint de testes direcionada 🔴

### Situação atual

Existe uma malha razoável, mas ainda há zonas críticas subcobertas.

### Situação ideal

Priorizar testes para:

1. boot steps isolados;
2. reconnect policy;
3. mutation API do `AgentContext`;
4. comportamento lazy do singleton;
5. regressão dos contratos de host.

### Estado desta rodada

Cobertura nova/atualizada já entregue para:

- `session-setup` (sem boundary artificial de hooks);
- `sdk/session/client` (last session, foreground session e server RPC);
- `agent-sdk-access` (handles + snapshot de cobertura SDK + operações client/session);
- `agent-health-routes` (projeção de `sdkResources`).

## L9 — Cobertura total da superfície do SDK 🔴

### Situação atual

O projeto já tinha uma camada `src/copilot/sdk/`, mas ainda restavam dois problemas:

1. alguns recursos reais do `CopilotClient` não estavam cobertos pela camada canônica
   (`getLastSessionId()`, foreground session e `client.rpc`);
2. o `AlwaysAliveAgent` não oferecia um ponto único e explícito para acessar handles crus do SDK nem
   um snapshot verificável da cobertura de recursos disponíveis em runtime.

### Situação ideal

O agent deve conseguir acessar **toda** a superfície útil do SDK por duas vias complementares:

1. **via façade canônica de alto nível**, para operações comuns e estáveis;
2. **via handles crus controlados** (`client`, `session`, `serverRpc`, `sessionRpc`) quando for
   necessário consumir uma capacidade nova do SDK sem esperar uma nova rodada de wrappers.

### Estado desta rodada

Entregue:

- `sdk/session/client.js` agora expõe: - `getLastClientSessionId()` -
  `getForegroundClientSessionId()` - `setForegroundClientSessionId()` - `getServerRpc()`
- `agent/facades/agent-sdk-access.js` passou a centralizar: - `getSdkHandles()` -
  `getSdkResourceSnapshot()` - `pingSdk()` - `getSdkStatus()` - `getSdkAuthStatus()` -
  `getLastSdkSessionId()` - `getForegroundSdkSessionId()` / `setForegroundSdkSessionId()` -
  `listSdkSessions()` - `listSdkAgents()` / `getCurrentSdkAgent()` / `selectSdkAgent()` /
  `deselectSdkAgent()` / `reloadSdkAgents()`
- `AlwaysAliveAgent` agora expõe essa superfície na API pública.

### Regra de consolidação

Quando `getSdkResourceSnapshot()` reportar `allCoreResourcesAvailable=true` e
`allRuntimeResourcesAvailable=true` em um boot saudável da LLM-B, consideramos que a superfície
runtime do SDK está consolidada para o agent.

## L10 — Governança semântica do `ask_user` 🔴

### Situação atual

O `ask_user` deixou de ser só texto cru e já passou a carregar semântica persistível:

- `PendingQuestionKind`
- `PendingQuestionMeta`
- `PendingQuestionShadow`

Além disso, o runtime passou a separar:

- **pergunta viva do SDK**;
- **sombra persistida restaurada do disco**.

### Situação ideal

O subfluxo `ask_user` deve operar como protocolo governado, com:

1. persistência seletiva por `kind`;
2. recovery zero-PR baseado apenas em `ready` vivo;
3. shadow com TTL/expiração e UX operacional dedicada;
4. mesma semântica refletida em health, terminal, snapshots e rotas HTTP.

### Estado desta rodada

Entregue:

- classificação semântica `ready/reply/stopped/question`;
- persistência de `pendingQuestionMeta` para `ready/question`;
- restauração de `pendingQuestionShadow` no boot;
- TTL/expiração explícita da shadow (`restoredAt`, `expiresAt`) com janela semântica por `kind` e
  limpeza do estado persistido quando o boot encontra shadow já vencida;
- health com `pendingQuestionShadow`, `pendingQuestionShadowKind`, `pendingQuestionShadowExpired`,
  `pendingQuestionShadowAgeMs`, `pendingQuestionShadowExpiresAt` e ações
  `review_pending_question_shadow` / `clear_pending_question_shadow`;
- watchdog zero-PR do terminal exigindo `ready` vivo em vez de “qualquer pendência”.
- frontend/status do terminal com projeção semântica da shadow e limpeza canônica disponível via
  agent/HTTP/REPL.
- reaper contínuo da shadow expirada no timer periódico do runtime, evitando acúmulo após expiração
  tardia no mesmo processo.
- conformidade do `session-setup` com o default real de `allowFreeform=true` no SDK quando o campo
  vem omitido.
- o terminal passou a expor atividade canônica em tempo real (`activity-state.js`), consumindo a
  trilha semântica de `ask_user`, `tool.execution_*`, `task.*`, `assistant.intent` e eventos de
  compaction/runtime.
- o terminal passou a consumir também `assistant.streaming_delta` como sinal operacional de
  progresso de resposta, mesmo quando a UX decide não renderizar texto incremental.
- o fluxo de `tool.execution_progress` foi alinhado ao payload real do SDK, tratando
  `progressMessage` como fonte primária e `%` numérico como opcional.
- o terminal passou a consumir também `tool.execution_partial_result`, `session.mode_changed`,
  `session.plan_changed`, `session.info`, `session.warning`, `session.model_change`,
  `session.context_changed` e `exit_plan_mode.completed`, evitando perder sinais semânticos do SDK
  na última milha da UX.
- a shadow de `ask_user` agora também expõe estado semântico (`fresh/active/expiring_soon/expired`)
  e tempo restante, reduzindo ambiguidade operacional para terminal, health e troubleshooting.
- o runtime do terminal passou a operar com default canônico `gpt-5-mini` + `reasoning=high`,
  refletido no próprio prompt interativo do REPL e nas projeções públicas do frontend.

### Próximo passo ideal

aprimorar heurísticas por idade/estado operacional e enriquecer a UX do operador para estados
intermediários da shadow.

---

## L8 — Backlog estratégico (não bloquear curto prazo) 🟡

Esses itens seguem importantes, mas não são o melhor próximo corte para o runtime atual:

- multi-session real;
- watchdog adaptativo baseado em histórico;
- protocolo formal de handoff;
- ownership/migração de estado entre sessões em modo avançado.

## L11 — Arquitetura padronizada e centralizada entre SDK, agent e bordas 🔴

### Situação atual

O fluxo melhorou bastante, mas ainda há três fontes de confusão estrutural:

1. a noção de runtime default do agent continua implícita demais;
2. `presentation/` ainda não é o hub único de acesso compartilhado ao runtime;
3. `terminal/` ainda conhece partes demais da topologia do runtime em alguns pontos.

### Situação ideal

Padronizar o fluxo assim:

```text
sdk/
        -> event-handlers/
                -> agent/
                        -> presentation/
                                -> terminal/ e server/
```

Com regras explícitas:

- tudo que for runtime/session/capability vanilla do SDK passa pelo `agent` antes de chegar ao
  terminal;
- tudo que for compartilhado entre bordas passa por `presentation/`;
- o terminal deixa de conhecer detalhes do runtime onde uma projection/shared facade puder
  responder;
- o singleton lazy passa a conviver com uma `AgentRuntimeRegistry` explícita para preparar
  multi-agent futuro.

### Estado desta rodada

Entregue parcialmente:

- `agent/runtime-registry.js` criado como SSOT dos runtimes registrados;
- `always-alive.js` já registra/desregistra o runtime default lazy nessa registry;
- `presentation/agent-runtime.js` criado como accessor compartilhado do runtime default;
- `presentation/runtime-overview.js` criado como projection base compartilhada do runtime default
  (`snap/health/runtimeId`);
- `presentation/runtime-status.js` criado como payload layer compartilhada para `/status`,
  `/session` e SSE `connected`;
- `system-config.js`, `system-metrics.js`, `agent-control.js` e `terminal/frontend/llm-b-runtime.js`
  já migraram para esse accessor;
- `terminal/frontend/llm-b-frontend.js` e projections compartilhadas já consomem a overview
  centralizada do runtime;
- `server/routes/copilot-api/control.js`, `server/routes/copilot-api/stream.js` e
  `server/routes/sdk/observability.js` já deixaram de montar snapshots repetitivos em pontos
  críticos;
- `presentation/runtime-route-deps.js` agora centraliza a composição de dependências repetitivas de
  `server/routes/sdk/index.js` e `server/routes/copilot-api/index.js`;
- `presentation/runtime-request.js` agora centraliza a resolução canônica de `runtimeId` por
  `query/header/body/params` e a composição per-request das deps de `copilot-api` e `/sdk`;
- `presentation/runtime-targeting.js` agora centraliza a semântica compartilhada de `runtimeId`
  (`normalizeRuntimeId` / `pickRuntimeId`) entre HTTP, REPL e accessors do runtime;
- `presentation/agent-runtime.js` agora também expõe a seleção efetiva do runtime
  (`resolveAgentRuntimeSelection`) com sinalização explícita de fallback quando um `runtimeId`
  pedido não existe;
- `server/handler-bridge.js` agora também injeta `runtimeId` canônico nos handlers compartilhados
  legados, preservando-o mesmo quando há `paramsExtractor` customizado;
- `presentation/runtime-webhooks.js` agora centraliza as operações administrativas de webhook
  consumidas por `server/routes/webhooks.js`;
- `presentation/runtime-dialog.js` agora centraliza também `start/turn/stop` para o runtime default,
  e `server/routes/copilot-api/dialog.js` deixou de chamar esses métodos diretamente;
- `agent/facades/agent-dialog-runtime.js`, `agent/facades/agent-runtime-controls.js` e
  `agent/facades/agent-runtime-webhooks.js` agora concentram capacidades antes espalhadas entre
  `presentation/`, `channel/` e `conversation-hub`.
- `presentation/system-metrics.js` e `presentation/agent-control.js` agora aceitam `runtimeId`
  explícito nos handlers compartilhados (inclusive via payload bridgeado), reduzindo a diferença
  entre bordas novas e rotas legadas.
- projections compartilhadas e frontend do terminal já expõem `runtimeId` / `agentRuntimes`,
  preparando troubleshooting e multi-agent futuro.
- `server/routes/copilot-api/*`, `server/routes/sdk/*`, `server/routes/health.js` e
  `server/routes/webhooks.js` agora já aceitam caminho explícito de seleção de runtime por request,
  mantendo fallback seguro para o runtime default.
- `/status`, `/session`, SSE `connected`, `/health/agent` e `/webhooks` agora já conseguem expor
  também `requestedRuntimeId`, `runtimeFound` e `usedDefaultRuntimeFallback`, deixando explícito
  quando um runtime solicitado não existiu e a borda operou sobre o default.

### Próximo passo ideal

Implementar em fases:

1. `agent/runtime-registry.js` como SSOT dos runtimes registrados;
2. `presentation/agent-runtime.js` como hub compartilhado de acesso ao runtime default;
3. migração progressiva de `terminal/` e projections compartilhadas para esse accessor canônico;
4. documentação viva esclarecendo papéis de `agent/`, `presentation/`, `terminal/`,
   `event-handlers/` e `observability/`.

### Mapa canônico dos bypasses remanescentes (abril/2026)

#### Bypass A — mutações/controles do runtime dispersas em bordas compartilhadas

**Sintoma**

- `presentation/system-config.js` ainda puxava `setBackgroundCompactionThreshold` direto de
  `#copilot/agent`.
- `presentation/agent-control.js` ainda chamava `pauseDialogLoop()` / `resumeDialogLoop()` /
  `getHandoffManager()` diretamente no runtime default.
- `terminal/frontend/llm-b-runtime.js` ainda importava helpers de snapshot (`createSnapshot`,
  `saveSnapshotAsync`, `listSnapshotsAsync`, `loadSnapshotAsync`) direto de `#copilot/agent`.

**Situação ideal**

- toda mutação/controle de borda passa por uma façade única de `presentation/`.

**Estado desta rodada**

- `presentation/runtime-controls.js` criado como façade canônica para: - dialog controls
  (`pause/resume/stop/ping`) - handoff manager / history - background compaction threshold -
  snapshots do runtime
- `presentation/system-config.js`, `presentation/agent-control.js` e
  `terminal/frontend/llm-b-runtime.js` já migrados.

#### Bypass B — projeção de health ainda hospedada no server

**Sintoma**

- `server/routes/agent-health.js` ainda era dono da lógica compartilhada de health, mesmo sendo
  consumido por múltiplas bordas/registries.

**Situação ideal**

- health compartilhado nasce em `presentation/` e `server/routes/*` apenas reexporta/consome.

**Estado desta rodada**

- `presentation/runtime-health.js` criado como projection/shared health layer.
- `server/routes/agent-health.js` virou shim de compatibilidade/reexport.
- `server/routes/health.js`, `server/routes/health-registry.js` e
  `server/routes/copilot-api/control.js` já migrados para a camada compartilhada.
- `server/routes/health.js` e `server/routes/health-registry.js` deixaram também de importar
  `getDefaultAgentRuntime()` diretamente, usando helpers default-safe expostos por
  `presentation/runtime-health.js`.

#### Bypass C — leitura crua de `getStatusSnapshot()` em integrações não-edge

**Sintoma**

- `channel/client.js` e `conversation-hub/orchestrator.js` ainda liam `getStatusSnapshot()` só para
  extrair `sessionId`.

**Situação ideal**

- integrações usam propriedades/capabilities mínimas quando disponíveis, sem acionar snapshots ricos
  por hábito.

**Estado desta rodada**

- ambos já migrados para `agent.sessionId` direto.

#### Bypass D — boundaries intencionais que ainda não devem ser removidos

**Ainda permanecem de forma deliberada**

- `presentation/agent-runtime.js` importando `#copilot/agent`: - **não é bypass**, é a fronteira
  canônica entre `agent/` e bordas.
- imports de `ALWAYS_ALIVE_AGENT` em `server/` e `terminal/di-wiring.js`: - em `server/` já
  removidos das bordas HTTP; em `terminal/di-wiring.js` permanece apenas como boundary de DI, não
  como bypass de fluxo.
- `presentation/*`, `channel/client-dialog.js` e `conversation-hub/call-strategies.js` importando
  facades de `#copilot/agent`: - **não são bypasses**, e sim consumo deliberado da API
  pública/facades canônicas do runtime.

#### Bypass E — `presentation/` dependente demais de internals do terminal

**Sintoma**

- `presentation/system-config.js` importava `terminal/state.js` e `terminal/file-context.js`
  diretamente.
- `presentation/system-metrics.js` importava `getInjectHistory()` direto de `terminal/state.js`.
- `presentation/agent-control.js` importava `sendTurn`, `readFileContext`, `embedMultiple`,
  `attachmentToEmbed` e `recordInjectHistory` direto de `terminal/*`.

**Situação ideal**

- a camada compartilhada `presentation/` não conhece a árvore do terminal; quando precisar de
  estado/UI ou diálogo hospedado no terminal, acessa isso via façades locais explícitas em
  `presentation/`.

**Estado desta rodada**

- `presentation/runtime-ui-state.js` e `presentation/runtime-dialog.js` foram o passo intermediário
  inicial.
- `presentation/runtime-file-context.js` e `presentation/runtime-ui-state-store.js` agora carregam a
  implementação compartilhada que antes vivia em `terminal/file-context.js` e `terminal/state.js`.
- `presentation/runtime-dialog.js` deixou de depender de `terminal/dialog.js` e passou a usar
  `agent.startDialogLoop()` + `agent.sendDialogTurn()` via runtime default canônico.
- `terminal/file-context.js` e `terminal/state.js` viraram apenas shims de compatibilidade.
- o grep atual de `src/copilot/presentation/**` para imports de `terminal/*` está zerado.

#### Bypass F — rotas do server chamando métodos do runtime diretamente

**Sintoma**

- `server/routes/copilot-api/dialog.js` ainda chamava `startDialogLoop()` / `sendDialogTurn()` /
  `stopDialogLoop()` diretamente.
- `server/routes/webhooks.js` ainda chamava `listWebhooks()` / `registerWebhook()` /
  `unregisterWebhook()` diretamente.
- `server/routes/sdk/index.js` e `server/routes/copilot-api/index.js` ainda remontavam manualmente a
  composição de deps do runtime default.

**Situação ideal**

- rotas do `server/` consomem apenas façades/projeções compartilhadas de `presentation/`;
- a composição de deps repetitivas também nasce em `presentation/`, não em cada router.

**Estado desta rodada**

- `presentation/runtime-dialog.js` passou a expor `startRuntimeDialogLoop()`,
  `sendRuntimeDialogTurnOnActiveLoop()` e `stopRuntimeDialogLoopAuthorized()`;
- `presentation/runtime-webhooks.js` centralizou `list/register/unregister` dos webhooks do runtime
  default;
- `presentation/runtime-route-deps.js` centralizou a composição compartilhada de routers do
  `server/`;
- `server/routes/copilot-api/dialog.js`, `server/routes/webhooks.js`, `server/routes/sdk/index.js` e
  `server/routes/copilot-api/index.js` já migraram.

### Plano explícito de remoção total dos bypasses reais

| Fase   | Tema                      | Ação                                                                                                                         |
| ------ | ------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `L11a` | Controles compartilhados  | consolidar toda mutação de borda em `presentation/runtime-controls.js`                                                       |
| `L11b` | Health compartilhado      | mover toda lógica reutilizável de health para `presentation/runtime-health.js`                                               |
| `L11c` | Ownership compartilhado   | consolidar o vínculo SDK↔hub em `presentation/runtime-ownership.js`                                                          |
| `L11d` | Integrações internas      | substituir leituras cruas de snapshot por capabilities mínimas ou façades dedicadas                                          |
| `L11e` | Shareds sem terminal-leak | consolidar estado/UI, file-context e turnos compartilhados em `presentation/`, deixando `terminal/*` como shim ou consumidor |
| `L11f` | Multi-agent               | fazer `runtimeId` opcional atravessar mais projections/handlers e consolidar seleção explícita de runtime                    |

### Estado adicional de `L11f`

O trabalho deixou de ser apenas preparação abstrata:

- `runtimeId` já atravessa `copilot-api`, `/sdk`, `/health/agent` e `webhooks` na borda HTTP;
- `runtime-overview.js` já consegue ler projections por `runtimeId` explícito, não só do runtime
  default;
- `runtime-overview.js` e `system-config.js` agora distinguem também `requestedRuntimeId`,
  `runtimeFound` e `usedDefaultRuntimeFallback`, reduzindo ambiguidade quando uma borda pede um
  runtime inexistente;
- `system-config.js` já consegue consumir a projection compartilhada com `runtimeId` informado via
  `handler-bridge`.
- `system-metrics.js` e `agent-control.js` já participam desse mesmo caminho via
  `server/handler-bridge.js`, cobrindo também as rotas legadas `server/routes/agent.js` e
  `server/routes/observability.js`.
- `terminal/frontend/llm-b-runtime.js` e `terminal/frontend/llm-b-frontend.js` já conseguem
  inspecionar/controlar um `runtimeId` explícito nos principais caminhos compartilhados (`status`,
  `config`, `context`, handoff, pause/resume/stop, model/reasoning, answer/shadow cleanup), mantendo
  fallback seguro para o runtime default.
- o parser de targeting do REPL (`terminal/commands/runtime-target.js`) já deixou de ter semântica
  própria de trim/empty/fallback e passou a consumir a mesma normalização compartilhada de
  `presentation/runtime-targeting.js`.

Ou seja: o sistema saiu de “pronto para multi-agent no futuro” para um primeiro estado onde a
seleção explícita de runtime **já existe operacionalmente em HTTP e também em parte relevante da UX
local do terminal**.

### Situação prática ao final desta rodada

No estado atual do código:

- os **bypasses distribuídos reais** entre `server/`, `terminal/`, `presentation/` e `agent/` foram
  drenados;
- o grep de `src/copilot/presentation/**` para imports de `terminal/*` está zerado;
- o grep de `src/copilot/server/routes/**` para `getDefaultAgentRuntime()` também está zerado;
- o que resta são **fronteiras canônicas deliberadas**: - `presentation/agent-runtime.js` como
  accessor compartilhado do runtime; - facades públicas de `#copilot/agent` consumidas por
  `presentation/`, `channel/` e `conversation-hub`; - `terminal/di-wiring.js` como boundary de DI.

### O que ainda falta programar de forma relevante

Mesmo com a drenagem dos bypasses distribuídos, ainda restam frentes arquiteturais fortes:

1. **hardening final do `AgentContext`** - mutation API ainda não domina 100% dos writes quentes; -
   ownership formal por subestado ainda pode ser endurecido.

2. **adoção total da error policy** - vários fluxos já convergiram, mas ainda há espaço para reduzir
   heurística local em boot/hooks/cleanup.

3. **multi-session real** - seleção explícita de `runtimeId` já existe; - agendamento/isolamento de
   múltiplos runtimes/sessões ainda não.

4. **decisão explícita sobre caminhos `default-only`** - parte da UX local do terminal ainda pode
   permanecer default-only por pragmatismo; - isso precisa ser critério deliberado, não resíduo
   arquitetural.

---

## 5. Prioridade recomendada de implementação

## Sprint L-A (curto prazo, alto retorno)

| Fase  | Tema                                                | Status            |
| ----- | --------------------------------------------------- | ----------------- |
| `L1a` | ampliar mutation API do `AgentContext`              | **em andamento**  |
| `L2a` | remover casts do hot path                           | **em andamento**  |
| `L3a` | usar `withAgentErrorPolicy(...)` em fluxos críticos | **avançado**      |
| `L4a` | migrar consumidores seguros para `getAgent()`       | **quase fechado** |

### Objetivo

Fechar a primeira “casca dura” do agent sem reestruturação destrutiva.

---

## Sprint L-B (médio prazo)

| Fase | Tema                             | Objetivo                                 |
| ---- | -------------------------------- | ---------------------------------------- |
| `L5` | observabilidade de boot por step | diagnósticos operacionais mais precisos  |
| `L6` | health enriquecido               | health deixa de ser só semáforo agregado |
| `L7` | cobertura de testes              | blindar regressões do novo desenho       |

---

## Sprint L-C (estratégico)

| Fase   | Tema                | Objetivo                                         |
| ------ | ------------------- | ------------------------------------------------ |
| `L8.1` | multi-session       | suportar múltiplas sessões ativas com isolamento |
| `L8.2` | watchdog adaptativo | thresholds mais inteligentes                     |
| `L8.3` | handoff formal      | protocolo com mais governança e testes           |

---

## 6. Critérios claros de consolidação arquitetural

O `agent` só deve ser considerado **arquiteturalmente consolidado** quando todos os critérios abaixo
forem verdadeiros ao mesmo tempo:

### CA-1 — Hot path sem casts residuais

Critério verificável:

- `rg -n "@type \{unknown\}|/\*\* @type \{unknown\} \*/" src/copilot/agent --glob '*.js'` retorna
  `0` matches.

### CA-2 — Boundary de hooks alinhado ao SDK

Critério verificável:

- `sdk/types.js` e `hooks/types.js` refletem a shape atual do SDK;
- `buildSessionOptions()` registra `hooks` via `SessionConfigBuilder.hooks(...)`, sem cast de
  compatibilidade.

### CA-3 — Mutation API domina o hot path

Critério verificável:

- `messaging`, `dialog`, `lifecycle` e `session wiring` não fazem writes diretos a `ctx.*State` nos
  caminhos quentes, salvo exceções documentadas e justificadas.
- os módulos quentes de leitura (`health`, `state`, `facades`, getters públicos do agent) usam
  getters/helpers do `AgentContext` em vez de depender diretamente de
  `sessionState/dialogState/configState/...`.
- `lifecycle/session-setup.js` e `agent-lifecycle.js` evitam aliases largos de subestado
  (`const sessionState = ...`, `const configState = ...`) nos fluxos centrais, mantendo fallback
  estrutural apenas em fronteiras realmente compatíveis/testáveis.

### CA-4 — Error policy vira padrão operacional

Critério verificável:

- `withAgentErrorPolicy(...)` é adotado nos fluxos centrais de `messaging`, `reconnect`, `dialog`,
  `session ownership` e persistence auxiliar com contexto estruturado.
- `persistStateWithPolicy(...)` é o caminho dominante para snapshots auxiliares do runtime do
  `agent`, em vez de chamadas dispersas a `writeStateAsync(...)` nos módulos quentes de diálogo.
- fora do próprio `state-io.js`, o grep de `writeStateAsync(...)` no subtree `src/copilot/agent/`
  fica zerado ou restrito apenas a comentários/documentação histórica.
- no subsistema `src/copilot/hooks`, `factory`, `session-hooks` e presets usam handlers canônicos
  (`createErrorHandler` / `createCircuitBreakerHandler`) em vez de políticas artesanais duplicadas
  por arquivo.

### CA-5 — Lazy singleton totalmente governado

Critério verificável:

- consumidores operacionais usam `getAgent()`;
- o proxy `alwaysAliveAgent` permanece apenas em boundaries de compatibilidade explicitamente
  documentados.

### CA-6 — Superfície SDK consolidada e auditável

Critério verificável:

- `AlwaysAliveAgent` expõe `getSdkHandles()` e `getSdkResourceSnapshot()`;
- `getSdkResourceSnapshot()` reporta `allCoreResourcesAvailable=true` e
  `allRuntimeResourcesAvailable=true` em boot saudável da LLM-B;
- client/session/serverRpc/sessionRpc/foreground/last session/custom agents ficam acessíveis pela
  API canônica.

### CA-7 — Health acionável de verdade

Critério verificável:

- o snapshot de health explica boot/runtime/backlog com granularidade suficiente para
  troubleshooting direto, incluindo `riskFlags`, `recommendedAction`, `bootReport`, `sdkResources` e
  contagem de boot `degraded/failed`.
- a trilha de `ask_user` diferencia pergunta viva de sombra persistida, com `pendingQuestionKind` e
  `pendingQuestionShadowKind` consistentes entre runtime, health e terminal.
- shadows expirada expõem idade/expiração e podem ser limpas por caminho canônico do runtime.
- o terminal reflete progresso/atividade usando sinais reais do SDK (`assistant.streaming_delta`,
  `tool.execution_progress` com `progressMessage`) em vez de heurísticas exclusivamente locais.
- o terminal consome o plan mode vanilla do SDK sem manter um plan mode local paralelo, preservando
  alinhamento direto com `session.mode_changed`/`session.plan_changed`.
- a trilha de auditoria default dos hooks de produção é separada do stream operacional e observável
  por buffer estruturado, não por `console.info` solto.

### CA-8 — Testes de regressão estrutural mínimos

Critério verificável:

- a malha cobre pelo menos: - `session-setup` - `agent-sdk-access` - `sdk/session/client` surface -
  `boot/reconnect` - `health routes` - comportamento lazy singleton / DI - `runtime-registry` /
  accessors compartilhados de runtime quando introduzidos

---

## 7. Conclusão

A nova situação ideal do `agent` não é mais “fatiar um monólito”. Isso já aconteceu em grande
medida.

A nova situação ideal é:

> **transformar uma boa arquitetura modular em uma arquitetura modular com fronteiras rígidas,
> contratos semânticos, mutation API explícita, política de erro unificada e lazy singleton
> plenamente governado.**

Em resumo:

- a era do “grande refactor estrutural” já passou;
- a era correta agora é a do **hardening arquitetural**.
