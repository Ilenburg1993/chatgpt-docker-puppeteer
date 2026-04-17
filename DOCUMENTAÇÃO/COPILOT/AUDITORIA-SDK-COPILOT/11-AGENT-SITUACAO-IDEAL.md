# 11 — Agent Module: Nova Situação Ideal Proposta

**Data de atualização**: 2026-04-17
**Escopo**: `src/copilot/agent/`
**Status**: proposta v2.1 alinhada com o código vivo, com critérios explícitos de consolidação
**Referências**:

- [09-AGENT-LOGICA-FLUXO.md](./09-AGENT-LOGICA-FLUXO.md)
- [10-AGENT-SITUACAO-ATUAL.md](./10-AGENT-SITUACAO-ATUAL.md)

---

## 1. Princípio básico desta nova proposta

A situação ideal **não é reescrever o agent**.

A base de abril/2026 já tem muitos elementos corretos:

- fachada pública em `always-alive.js`;
- submódulos por domínio (`dialog`, `lifecycle`, `session`, `messaging`, `state`, `infra`, `facades`);
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

As propostas antigas `K4`–`K7` já foram essencialmente entregues e não devem reaparecer como “ideal futuro pendente”:

| Tema                     | Situação em abril/2026 |
| ------------------------ | ---------------------- |
| Background task tracker  | já entregue            |
| Boot pipeline            | já entregue            |
| Event bridge declarativo | já entregue            |
| Health check formal      | já entregue            |

`K8` (lazy singleton) e `K3` (error policy) não estão mais “por fazer”; estão em **fase de endurecimento e adoção**.

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
- health, boot e shutdown sejam **auditáveis por step e por backlog**, não apenas por status agregado.

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
- `getBackgroundPendingLabels(...)`
- `hasClient()`
- `hasActiveSession()`
- `hasPendingQuestion()`
- `getBackgroundPendingCount()`
- `getLastPrInfoSnapshot()`
- `getBootReportSnapshot()`

### Próximo passo ideal

Fechar o ownership final dos poucos reads/writes restantes no núcleo e manter o subtree quente (`messaging`, `dialog`,
`facades`, `state`, `health`) dependente apenas da API semântica do `AgentContext`, não do shape cru dos subestados.

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
- `session-setup.js` removeu parte importante da dívida artificial de compatibilidade, mantendo cast estreito apenas na
        fronteira real de `hooks`, enquanto `mcpServers` e `onUserInputRequest` voltaram ao caminho semanticamente tipado.
- `runtime-contracts.js` concentrou guards e compat shims leves (`assertEmitterHost(...)`,
        `trySetLiveSessionModel(...)`, normalizadores de eventos), retirando exceções de contrato do meio dos módulos
        quentes.
- `boot-steps.js` deixou de usar cast estrutural para acessar `ctx.mcpBridge`.
- `turn-executor.js` ganhou normalização explícita de payloads e cleanup determinístico de listeners de `AbortSignal`
        tanto no retry quanto no caminho principal de `sendTurn()`.
- `sdk/types.js` e `hooks/types.js` foram realinhados com a shape real de hooks do SDK 0.2.0, permitindo que
        `session-setup.js` passe a registrar `hooks` via builder tipado, sem o boundary artificial de compatibilidade.

### Próximo passo ideal

manter zero casts residuais no hot path e empurrar qualquer compatibilidade futura para adapters explícitos e isolados.

---

## L3 — Error Policy v2: classifier + wrapper + adoção total 🔴

### Situação atual

O classificador existe; agora também existe `withAgentErrorPolicy(...)`, mas a adoção ainda é parcial.

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

Também foi corrigido o bug de persistência redundante em `dialog/user-input-handler.js`: perguntas interativas reais
passam a persistir `pendingQuestion + lastAskUserAt` em uma única operação, enquanto mensagens de protocolo do dialog
loop deixam de gerar I/O desnecessário.

### Próximo passo ideal

Expandir para:

- hooks internos do agent;
- rotação/session cleanup onde ainda houver tratamento local demais;
- etapas de boot/wiring que ainda dependem de heurística ad hoc em vez de contexto operacional padronizado.

---

## L4 — Lazy singleton “fechado” como caminho canônico 🔴

### Situação atual

`getAgent()` já é o caminho certo, mas o proxy compatível ainda convive com consumidores legados.

### Situação ideal

- consumidores operacionais usam `getAgent()`;
- o proxy `alwaysAliveAgent` fica marcado como camada de compatibilidade;
- exceções legítimas (como DI que não pode materializar a instância cedo demais) ficam documentadas e isoladas.

### Estado desta rodada

Migração aplicada em:

- `agent/lifecycle/entry.js`
- `presentation/agent-control.js`
- documentação pública do canal
- `terminal/di-wiring.js` agora registra o token canônico `ALWAYS_ALIVE_AGENT` resolvendo `getAgent()`, enquanto os
        tokens legados consumidos por `wireLegacySetters()` permanecem no proxy compatível.

### Estado adicional desta rodada

- o caminho quente do `agent` deixou de ter casts `unknown` residuais no grep do subtree `src/copilot/agent/`;
- o proxy `alwaysAliveAgent` permanece apenas como camada de compatibilidade deliberada, enquanto a instância real já é
        o default do token canônico de DI e dos consumidores operacionais novos.

### Próximo passo ideal

revisar os poucos call sites restantes e decidir, caso a caso, se devem usar `getAgent()` ou manter proxy por motivo de
boot lazy.

---

## L5 — Boot pipeline com observabilidade de step 🟠

### Situação atual

O pipeline de steps já existe.

### Estado desta rodada

Avanço real:

- `runBootPipeline(...)` passou a registrar duração/resultado por step;
- o runner de boot agora classifica steps opcionais como `degraded` ou `skipped`, em vez de derrubar o boot inteiro por
        qualquer erro lateral;
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

propagar `degraded/skipped` para dashboards/rotas/diagnósticos adicionais e reduzir ainda mais heurísticas locais no
boot wiring.

---

## L6 — Health snapshot enriquecido 🟠

### Situação atual

O health atual já é bom. O problema deixou de ser “não existe health” e passou a ser “ainda dá para enriquecer muito”.

### Estado desta rodada

O health já evoluiu além da versão anterior e agora expõe:

- `backgroundPendingLabels`;
- `bootReport`;
- check `boot` com `failedSteps` e `lastCompletedAt`.
- check `boot` com `degradedSteps` além de `failedSteps`.
- `riskFlags` canônicas derivadas do estado operacional.
- `recommendedAction` com próxima ação sugerida para troubleshooting.
- `sdkResources` na projeção HTTP/registry, permitindo verificar em runtime a cobertura real da superfície SDK acoplada
        ao agent.

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

1. alguns recursos reais do `CopilotClient` não estavam cobertos pela camada canônica (`getLastSessionId()`,
         foreground session e `client.rpc`);
2. o `AlwaysAliveAgent` não oferecia um ponto único e explícito para acessar handles crus do SDK nem um snapshot
         verificável da cobertura de recursos disponíveis em runtime.

### Situação ideal

O agent deve conseguir acessar **toda** a superfície útil do SDK por duas vias complementares:

1. **via façade canônica de alto nível**, para operações comuns e estáveis;
2. **via handles crus controlados** (`client`, `session`, `serverRpc`, `sessionRpc`) quando for necessário consumir uma
         capacidade nova do SDK sem esperar uma nova rodada de wrappers.

### Estado desta rodada

Entregue:

- `sdk/session/client.js` agora expõe:
        - `getLastClientSessionId()`
        - `getForegroundClientSessionId()`
        - `setForegroundClientSessionId()`
        - `getServerRpc()`
- `agent/facades/agent-sdk-access.js` passou a centralizar:
        - `getSdkHandles()`
        - `getSdkResourceSnapshot()`
        - `pingSdk()`
        - `getSdkStatus()`
        - `getSdkAuthStatus()`
        - `getLastSdkSessionId()`
        - `getForegroundSdkSessionId()` / `setForegroundSdkSessionId()`
        - `listSdkSessions()`
        - `listSdkAgents()` / `getCurrentSdkAgent()` / `selectSdkAgent()` / `deselectSdkAgent()` / `reloadSdkAgents()`
- `AlwaysAliveAgent` agora expõe essa superfície na API pública.

### Regra de consolidação

Quando `getSdkResourceSnapshot()` reportar `allCoreResourcesAvailable=true` e `allRuntimeResourcesAvailable=true` em um
boot saudável da LLM-B, consideramos que a superfície runtime do SDK está consolidada para o agent.

---

## L8 — Backlog estratégico (não bloquear curto prazo) 🟡

Esses itens seguem importantes, mas não são o melhor próximo corte para o runtime atual:

- multi-session real;
- watchdog adaptativo baseado em histórico;
- protocolo formal de handoff;
- ownership/migração de estado entre sessões em modo avançado.

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

O `agent` só deve ser considerado **arquiteturalmente consolidado** quando todos os critérios abaixo forem verdadeiros
ao mesmo tempo:

### CA-1 — Hot path sem casts residuais

Critério verificável:

- `rg -n "@type \{unknown\}|/\*\* @type \{unknown\} \*/" src/copilot/agent --glob '*.js'` retorna `0` matches.

### CA-2 — Boundary de hooks alinhado ao SDK

Critério verificável:

- `sdk/types.js` e `hooks/types.js` refletem a shape atual do SDK;
- `buildSessionOptions()` registra `hooks` via `SessionConfigBuilder.hooks(...)`, sem cast de compatibilidade.

### CA-3 — Mutation API domina o hot path

Critério verificável:

- `messaging`, `dialog`, `lifecycle` e `session wiring` não fazem writes diretos a `ctx.*State` nos caminhos quentes,
        salvo exceções documentadas e justificadas.
- os módulos quentes de leitura (`health`, `state`, `facades`, getters públicos do agent) usam getters/helpers do
        `AgentContext` em vez de depender diretamente de `sessionState/dialogState/configState/...`.

### CA-4 — Error policy vira padrão operacional

Critério verificável:

- `withAgentErrorPolicy(...)` é adotado nos fluxos centrais de `messaging`, `reconnect`, `dialog`, `session ownership`
        e persistence auxiliar com contexto estruturado.
- `persistStateWithPolicy(...)` é o caminho dominante para snapshots auxiliares do runtime do `agent`, em vez de
        chamadas dispersas a `writeStateAsync(...)` nos módulos quentes de diálogo.
- fora do próprio `state-io.js`, o grep de `writeStateAsync(...)` no subtree `src/copilot/agent/` fica zerado ou
        restrito apenas a comentários/documentação histórica.

### CA-5 — Lazy singleton totalmente governado

Critério verificável:

- consumidores operacionais usam `getAgent()`;
- o proxy `alwaysAliveAgent` permanece apenas em boundaries de compatibilidade explicitamente documentados.

### CA-6 — Superfície SDK consolidada e auditável

Critério verificável:

- `AlwaysAliveAgent` expõe `getSdkHandles()` e `getSdkResourceSnapshot()`;
- `getSdkResourceSnapshot()` reporta `allCoreResourcesAvailable=true` e `allRuntimeResourcesAvailable=true` em boot
        saudável da LLM-B;
- client/session/serverRpc/sessionRpc/foreground/last session/custom agents ficam acessíveis pela API canônica.

### CA-7 — Health acionável de verdade

Critério verificável:

- o snapshot de health explica boot/runtime/backlog com granularidade suficiente para troubleshooting direto,
        incluindo `riskFlags`, `recommendedAction`, `bootReport`, `sdkResources` e contagem de boot `degraded/failed`.

### CA-8 — Testes de regressão estrutural mínimos

Critério verificável:

- a malha cobre pelo menos:
        - `session-setup`
        - `agent-sdk-access`
        - `sdk/session/client` surface
        - `boot/reconnect`
        - `health routes`
        - comportamento lazy singleton / DI

---

## 7. Conclusão

A nova situação ideal do `agent` não é mais “fatiar um monólito”. Isso já aconteceu em grande medida.

A nova situação ideal é:

> **transformar uma boa arquitetura modular em uma arquitetura modular com fronteiras rígidas, contratos semânticos,
> mutation API explícita, política de erro unificada e lazy singleton plenamente governado.**

Em resumo:

- a era do “grande refactor estrutural” já passou;
- a era correta agora é a do **hardening arquitetural**.
