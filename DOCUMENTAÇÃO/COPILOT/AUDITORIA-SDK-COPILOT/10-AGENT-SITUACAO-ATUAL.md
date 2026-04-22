# 10 — Agent Module: Situação Atual Reavaliada

**Data de atualização**: 2026-04-22 **Escopo primário**: `src/copilot/agent/` **Escopo contextual**:
relação do `agent/` com `sdk/`, `event-handlers/`, `presentation/`, `server/`, `terminal/`,
`conversation-hub/`, `tools/`, `hooks/` e `observability/` **Status**: auditoria reavaliada a partir
do código vivo, corrigindo o excesso de otimismo da versão anterior **Documento par**:
[11-AGENT-SITUACAO-IDEAL.md](./11-AGENT-SITUACAO-IDEAL.md)

> **Leitura correta deste documento**: este arquivo descreve o estado real do `agent/` hoje. Ele não
> é plano aspiracional. O objetivo é evitar que a situação ideal parta de uma fotografia falsa: o
> `agent/` está muito melhor do que um monólito, mas ainda não é apenas caso de “hardening final”.

---

## 1. Resumo executivo

O `src/copilot/agent/` já passou pela fase mais bruta de extração. A arquitetura atual tem separação
visível por domínios:

- `always-alive.js` como fachada pública e singleton lazy;
- `agent-context.js` como composição central de estado e managers;
- `lifecycle/` para start/stop/reconnect/session setup/state I/O;
- `session/` para boot wiring, setup, keepalive, ownership, snapshot e histórico;
- `dialog/` para loop, protocolo, turn executor, backpressure, watchdog e `ask_user`;
- `messaging/` para fila/envio/steering/resposta de pergunta;
- `state/` para snapshot público;
- `facades/` para SDK, runtime status, controls, ownership e webhooks;
- `infra/` para queue, handoff e task executor;
- `runtime-registry.js` para runtime default + runtimes nomeados.

Isso é um avanço real. Porém, a reavaliação mostra que a versão anterior deste documento era
otimista demais ao tratar o restante como “hardening final”. O estado atual é mais precisamente:

> **arquitetura modular em transição, operacionalmente madura, mas ainda centralizada em um runtime
> default, uma façade larga, um contexto mutável compartilhado e orquestradores densos.**

O melhor caminho não é uma “arquitetura totalmente nova” nem um big bang. Também não é fingir que só
falta polimento. O caminho correto é uma evolução compatível: criar contratos menores em torno do
que existe e, gradualmente, reduzir centralização e acoplamento.

---

## 2. O que está forte de verdade

## 2.1 Extração estrutural real

O `agent/` já tem submódulos com responsabilidades reconhecíveis. A extração não é cosmética.

Evidência de árvore viva:

```text
src/copilot/agent/
  always-alive.js
  agent-context.js
  health-check.js
  runtime-registry.js
  runtime-contracts.js
  dialog/
  lifecycle/
  session/
  messaging/
  state/
  facades/
  infra/
```

Essa estrutura já sustenta uma evolução incremental.

## 2.2 `AlwaysAliveAgent` já não contém toda a lógica

`always-alive.js` delega para:

- `agent-lifecycle.js`;
- `agent-messaging.js`;
- `agent-state.js`;
- `health-check.js`;
- `agent-sdk-access.js`;
- `agent-model-config.js`;
- `agent-session-ops.js`;
- `agent-webhook-ops.js`;
- `agent-dialog-controller.js`.

Isso confirma que ele já é parcialmente fachada.

## 2.3 Health e boot estão bem acima do baseline antigo

O `health-check.js` já consolida:

- status;
- session id;
- modelo/reasoning;
- dialog loop;
- pending question e shadow;
- fila;
- starvation;
- background tasks;
- boot report;
- quota monitor;
- SDK resources;
- risk flags;
- recommended action.

O boot em `session/boot-wiring.js` e `session/boot-steps.js` já tem steps com:

- nome;
- fase;
- `required`;
- duração;
- status `ok`, `skipped`, `degraded` ou `failed`;
- policy de erro.

## 2.4 Superfície SDK está mais auditável

`facades/agent-sdk-access.js` centraliza:

- `getSdkHandles()`;
- `getSdkResourceSnapshot()`;
- ping/status/auth;
- last/foreground session;
- mode/plan;
- list/select/deselect/reload agents;
- sessions.

Isso reduz duplicação nas bordas e cria uma fonte clara de introspecção do SDK.

## 2.5 `presentation/` já absorveu parte da borda compartilhada

`presentation/agent-runtime.js` já resolve:

- runtime default;
- runtime explícito;
- fallback para default;
- listagem segura de runtimes;
- `runtimeId`.

Isso é importante: o projeto já tem uma camada intermediária capaz de impedir que `server/` e
`terminal/` conheçam detalhes do singleton.

## 2.6 Lazy singleton e registry existem

`runtime-registry.js` já mantém:

- `DEFAULT_AGENT_RUNTIME_ID`;
- registro de runtimes;
- default runtime id;
- listagem;
- clear para testes.

`alwaysAliveAgent` já é proxy lazy e `getAgent()` é o caminho canônico para materialização.

## 2.7 `ask_user` evoluiu semanticamente

O sistema já diferencia:

- pergunta viva;
- shadow persistida;
- kind;
- TTL;
- expiração;
- health impact;
- resposta;
- cleanup.

Isso é uma das áreas mais avançadas semanticamente.

---

## 3. O que ainda limita a arquitetura

## 3.1 `AgentContext` ainda é o centro real de mutação

`AgentContext` resolveu o problema de dezenas de campos privados em `AlwaysAliveAgent`, mas hoje é o
maior arquivo do subsistema e concentra:

- `sessionState`;
- `dialogState`;
- `configState`;
- `metricsState`;
- `runtimeState`;
- `ioState`;
- `DialogLoopManager`;
- `MessageQueue`;
- `WebhookManager`;
- `PermissionController`;
- `toolsRegistry`;
- `SessionKeepalive`;
- `HandoffManager`;
- `SessionMessagesCache`;
- `BackgroundTasks`.

A rodada recente reduziu raw access no hot path, mas isso não muda o fato arquitetural:

> o contexto ainda é a unidade viva onde quase tudo se encontra.

Isso é aceitável como etapa de extração. Não é o estado final ideal.

## 3.2 `AlwaysAliveAgent` ainda é largo

Inventário de superfície mostra mais de 50 métodos/getters/setters em `always-alive.js`, cobrindo:

- permissions;
- webhooks;
- status;
- handoff;
- pending question/shadow;
- session id;
- telemetry;
- tools registry;
- abort/watchdog/session log;
- lifecycle;
- messaging;
- steering;
- model/reasoning;
- SDK status/auth/session/mode/plan/agents;
- health;
- dialog loop;
- resource management.

Ele é fachada, mas ainda é fachada muito larga e conceitualmente misturada.

## 3.3 `agent-lifecycle.js` é mais que lifecycle

`agent-lifecycle.js` coordena:

- client SDK;
- session init/resume;
- tools/hooks/session options;
- ownership sync;
- boot wiring;
- observer;
- metrics timer;
- MCP reconnect;
- quota monitor;
- history sync;
- persisted state;
- pending question shadow;
- shutdown;
- background drain;
- snapshot;
- cleanup de session/client/tools;
- reconnect.

Isso faz dele um script transacional de runtime, não apenas lifecycle.

## 3.4 `DialogLoopManager` concentra protocolo e operação

`dialog/loop-manager.js` ainda mistura:

- active/stopping/paused/resuming;
- turn queue;
- watchdog;
- model fallback;
- compaction flag;
- boot timeout;
- PR metrics;
- persistência parcial;
- protocolo READY/REPLY;
- pause/resume;
- stall detection;
- token budget handling.

Ele já tem extrações auxiliares (`backpressure`, `watchdog`, `model-fallback`, `turn-executor`), mas
continua sendo eixo forte de acoplamento.

## 3.5 Persistência ainda mistura recuperação e controle

`lifecycle/state-io.js` está melhor tecnicamente: usa `fs/promises`, cache, mutex de escrita e
policy wrapper. Porém, o snapshot `sdk-always-alive.json` ainda carrega muita semântica:

- sessão;
- send count;
- modelo;
- pending question;
- dialog loop active/paused;
- pending turn;
- PR metrics;
- graceful shutdown;
- last ask user.

Isso é útil para recovery, mas ainda mistura recuperação, controle operacional e telemetria leve.

## 3.6 Eventos ainda nascem muito no `EventEmitter`

O projeto tem `EventBus`, `event-bridge-map.js` e `event-bridge-wiring.js`, mas muitos fluxos ainda
fazem `host.emit(...)`, `ctx.emit(...)` ou `dialogLoop.emit(...)`.

Isso é compatível com a arquitetura atual. Mas, para observabilidade mais forte e replay, a fonte
canônica ainda está espalhada.

## 3.7 Boundaries ainda vazam para contexts adjacentes

Imports diretos sensíveis encontrados:

```text
src/copilot/agent/infra/index.js
  -> ../../tools/bootstrap.js

src/copilot/agent/session/boot-steps.js
  -> import('../../tools/hook-tools.js')

src/copilot/agent/session/hook-context.js
  -> #copilot/tools

src/copilot/agent/lifecycle/session-setup.js
  -> ../../tools/bootstrap.js

src/copilot/agent/lifecycle/agent-lifecycle.js
  -> #copilot/conversation-hub
  -> ../../tools/bootstrap.js
```

Esses imports não são desastrosos; eles explicam integrações reais. Mas eles mostram que o `agent/`
ainda não tem boundaries totalmente limpas por ports.

## 3.8 Multi-runtime ainda é embrionário

Existe `runtime-registry.js` e `presentation/agent-runtime.js`, mas o runtime registrado ainda é
`AlwaysAliveAgent`. A arquitetura atual é:

- runtime default forte;
- registry explícita;
- fallback compartilhado;
- path-enabled para runtimeId;
- sem multi-session real;
- sem isolamento operacional completo entre runtimes.

---

## 4. Métricas de densidade do subsistema

Arquivos mais densos no baseline atual:

```text
1442  src/copilot/agent/agent-context.js
 941  src/copilot/agent/always-alive.js
 732  src/copilot/agent/dialog/loop-manager.js
 549  src/copilot/agent/types.js
 516  src/copilot/agent/dialog/turn-executor.js
 495  src/copilot/agent/lifecycle/agent-lifecycle.js
 429  src/copilot/agent/session/boot-wiring.js
 416  src/copilot/agent/session/boot-steps.js
 410  src/copilot/agent/messaging/agent-messaging.js
 347  src/copilot/agent/lifecycle/state-io.js
 321  src/copilot/agent/facades/agent-sdk-access.js
 305  src/copilot/agent/health-check.js
```

Leitura correta:

- o tamanho sozinho não prova erro;
- mas confirma onde há maior risco de acoplamento e regressão;
- `AgentContext`, `AlwaysAliveAgent`, `DialogLoopManager` e `agent-lifecycle.js` são os focos
  arquiteturais reais.

---

## 5. Topologia atual de `src/copilot`

```text
src/copilot/
├── sdk/              # contratos vanilla, sessões, RPC, mode/plan, agents
├── event-handlers/   # tradução de eventos crus do SDK
├── agent/            # runtime contínuo, lifecycle, dialog, queue, health, reconnect
├── presentation/     # runtime targeting e projections compartilhadas
├── terminal/         # REPL, comandos, render e UX operacional local
├── server/           # HTTP/SSE/middleware/rotas
├── channel/          # cliente de conversa contínua
├── conversation-hub/ # sessões, turns, replay e memória conversacional
├── tools/            # tools, bootstrap e superfícies operacionais
├── hooks/            # hooks SDK, permissions, transforms, policies
├── observability/    # logs, métricas, tracing, timelines
└── audit/            # trilhas de auditoria e buffers
```

Leitura correta:

- `agent/` deve governar runtime contínuo;
- `presentation/` deve seguir absorvendo acesso compartilhado de borda;
- `conversation-hub/` deve ser dono de sessão conversacional e memória, não lifecycle do agent;
- `tools/` deve ser consumido por contrato/port, não como detalhe interno do runtime;
- `hooks/` deve governar policy de tool/session, não estado vivo do agent;
- `observability/` e `audit/` devem registrar e projetar, não decidir runtime.

---

## 6. Estado por eixo arquitetural

## 6.1 Estado e contexto

**Situação atual**: parcialmente consolidado.

Pontos fortes:

- subestados nomeados;
- accessors e commands semânticos;
- hot path principal sem raw access nos campos rastreados;
- invalidação de cache centralizada;
- snapshots mais consistentes.

Limitações:

- managers vivos ainda são acessados via `ctx`;
- `ctx` ainda concentra dependências e estado;
- ainda não há agregados de domínio;
- ainda não há store governada por commands.

Diagnóstico:

> Bom estágio de transição. Ainda não é encapsulamento pleno.

## 6.2 Lifecycle

**Situação atual**: funcional, mas denso.

Pontos fortes:

- start/stop/reconnect extraídos;
- boot wiring separado;
- ownership sync com policy;
- shutdown drena background tasks;
- snapshot/cleanup explícitos.

Limitações:

- muitas integrações heterogêneas em um arquivo;
- imports diretos para `conversation-hub` e `tools/bootstrap`;
- boot, ownership, history sync, client/session e cleanup ainda acoplados no fluxo.

Diagnóstico:

> O lifecycle é confiável, mas precisa ser fatiado em services menores antes de qualquer
> multi-runtime sério.

## 6.3 Dialog

**Situação atual**: maduro funcionalmente, concentrado arquiteturalmente.

Pontos fortes:

- `TurnQueue`;
- `DialogWatchdog`;
- `ModelFallbackState`;
- `TurnExecutor`;
- protocolo separado em `protocol.js`;
- `ask_user` com handler próprio;
- event wiring.

Limitações:

- `DialogLoopManager` ainda coordena muitos conceitos;
- PR metrics e compaction ainda vivem perto demais do loop;
- persistência parcial aparece dentro do dialog;
- FSM ainda não é componente isolado.

Diagnóstico:

> A próxima evolução do dialog deve ser cirúrgica: extrair políticas e FSM sem reescrever o loop.

## 6.4 Messaging

**Situação atual**: relativamente saudável.

Pontos fortes:

- fila via `MessageQueue`;
- enqueue/shift/unshift/drain semânticos;
- support a steering;
- abort/error handling;
- eventos de task.

Limitações:

- ainda emite eventos via host;
- ainda persiste partes de pending turn;
- ainda depende do shape operacional do host.

Diagnóstico:

> Bom candidato para primeiro pacote de interface `RuntimeCommands`, porque já está razoavelmente
> isolado.

## 6.5 Health

**Situação atual**: forte.

Pontos fortes:

- snapshot acionável;
- risk flags;
- recommended action;
- boot report;
- SDK resources;
- queue/background/ask_user/quota.

Limitações:

- ainda não há health por capability;
- ainda não há health multi-runtime real;
- ainda depende de host/ctx atual.

Diagnóstico:

> Área madura. Deve ser preservada e usada como base da próxima arquitetura, não substituída.

## 6.6 SDK access

**Situação atual**: forte, mas ainda com compat fallback.

Pontos fortes:

- handles crus centralizados;
- resource snapshot;
- operations vanilla em façade;
- missing resources list.

Limitações:

- fallback estrutural ainda existe por compatibilidade;
- capabilities do SDK ainda são snapshot, não grafo completo.

Diagnóstico:

> Boa base para capability graph leve, sem precisar criar um kernel novo.

## 6.7 Runtime registry

**Situação atual**: embrião útil.

Pontos fortes:

- registry;
- default runtime id;
- listagem;
- integração com `presentation/agent-runtime.js`.

Limitações:

- registra `AlwaysAliveAgent`;
- não cria runtimes;
- não governa lifecycle;
- não isola estado.

Diagnóstico:

> Deve evoluir para `runtime-manager` leve, não necessariamente para um kernel profundo.

## 6.8 Event bridge

**Situação atual**: compatível e funcional.

Pontos fortes:

- bridge lazy;
- mapas declarativos;
- EventBus central consumível.

Limitações:

- origem dos eventos ainda é o emitter;
- dualidade EventEmitter/EventBus ainda não tem hierarquia clara.

Diagnóstico:

> Não precisa inverter tudo agora. Precisa catalogar eventos e estabilizar nomes/payloads.

---

## 7. Indicadores verificáveis

## 7.1 Indicadores positivos

```bash
rg -n "ctx\\.(ioState|sessionState|dialogState|runtimeState|metricsState|configState|statusSnapshotCache|status|model|reasoningEffort|sendCount|isResumed|pendingQuestion|messageQueue|backgroundTasks|quotaMonitor|isReconnecting)" src/copilot/agent --glob '*.js'
```

Resultado esperado no baseline atual: `0` matches.

Também são positivos:

- `runtime-registry.js` existe;
- `presentation/agent-runtime.js` consome registry e fallback;
- `health-check.js` inclui `sdkResources`;
- `boot-wiring.js` usa policy por step;
- `alwaysAliveAgent` é proxy lazy.

## 7.2 Indicadores de dívida

```bash
rg -n "from ['\"](#copilot/(conversation-hub|tools|bridges|terminal|server)|../../tools|../tools)" src/copilot/agent --glob '*.js'
```

Resultado atual inclui imports para `conversation-hub`, `tools/bootstrap`, `tools` e `hook-tools`.

```bash
rg -n "\\bemit\\(" src/copilot/agent --glob '*.js'
```

Resultado atual mostra emissão em muitos pontos do agent/dialog/session/lifecycle/messaging.

```bash
rg -n "ctx\\.(dialogLoop|handoff|permissions|toolsRegistry|webhooks|keepalive|messagesCache)" src/copilot/agent --glob '*.js'
```

Resultado atual mostra managers vivos ainda consumidos diretamente.

---

## 8. Reavaliação do risco

## 8.1 Riscos altos

- tentar introduzir um kernel completo agora;
- decompor `DialogLoopManager` antes de criar contratos externos;
- remover `AlwaysAliveAgent` ou `alwaysAliveAgent` cedo;
- criar multi-session real antes de isolar estado;
- reescrever `state-io.js` sem dual-write.

## 8.2 Riscos médios

- manter imports diretos para contexts adjacentes por tempo indefinido;
- aumentar a superfície do `AlwaysAliveAgent`;
- adicionar novos managers ao `AgentContext`;
- duplicar projections em `server/` e `terminal/`;
- ampliar eventos sem catálogo.

## 8.3 Riscos baixos e bons candidatos a primeira ação

- catalogar métodos públicos por capability;
- criar façade de runtime leve;
- criar queries explícitas para health/status/sdkResources;
- automatizar gates de imports e raw access;
- transformar `runtime-registry` em manager leve;
- documentar exceções compatíveis.

---

## 9. Diagnóstico final da situação atual

O `agent/` está em um ponto intermediário saudável:

- bom o suficiente para evoluir sem reescrita;
- modular o suficiente para fatiar;
- centralizado o suficiente para exigir cuidado;
- maduro o suficiente para não justificar uma arquitetura totalmente nova;
- acoplado o suficiente para não ser chamado de “pronto”.

O diagnóstico mais honesto é:

> **o `agent/` precisa de uma consolidação arquitetural compatível, não de uma substituição
> arquitetural profunda.**

Essa consolidação deve preservar:

- `AlwaysAliveAgent` como API compatível;
- `AgentContext` como ponte de transição;
- health/boot atuais;
- SDK façade;
- runtime registry;
- presentation runtime accessors.

E deve introduzir, gradualmente:

- runtime façade leve;
- capability map;
- ports para integrações adjacentes;
- manager leve sobre a registry;
- contracts de eventos;
- decomposição incremental do dialog;
- separação mais clara entre snapshot de recovery e estado operacional.

---

## 10. Backlog priorizado a partir do baseline

## P0 — Sem mudança de arquitetura ainda

- Congelar inventário de imports sensíveis.
- Congelar inventário de métodos do `AlwaysAliveAgent`.
- Criar gates de regressão para raw access e imports proibidos.
- Documentar quais usos de `alwaysAliveAgent` são compatíveis.

## P1 — Criar superfície moderna mínima

- Criar `runtime-facade` ou `runtime-handle` leve.
- Expor queries: status, health, SDK resources, runtime info.
- Expor commands: start, stop, send, answer.
- Delegar sem mudar comportamento.

## P2 — Organizar capabilities

- Classificar métodos atuais por capability.
- Expor capability map simples.
- Integrar health a capabilities degradadas.

## P3 — Drenar acoplamentos diretos

- Envolver `tools/bootstrap` por port.
- Envolver `conversation-hub` por port.
- Envolver `hook-tools`/input resolver por port.
- Migrar call sites sem quebrar API.

## P4 — Reduzir densidade dos orquestradores

- Extrair service de ownership/history sync do lifecycle.
- Extrair PR/cost ledger do dialog.
- Extrair FSM simples do dialog.
- Extrair compaction policy.

## P5 — Preparar multi-runtime sem multi-session real

- Evoluir registry para manager leve.
- Testar runtime nomeado fake.
- Expor listagem e selection por manager.
- Manter default runtime como política principal.

---

## 11. Conclusão

A situação atual não pede uma revolução. Ela pede lucidez.

A arquitetura atual é boa e operacionalmente madura, mas ainda carrega quatro centros de gravidade:

- `AgentContext`;
- `AlwaysAliveAgent`;
- `agent-lifecycle.js`;
- `DialogLoopManager`.

O plano ideal deve ser compatível com isso. A melhor evolução não é abandonar esses centros de uma
vez, e sim cercá-los com contratos menores até que eles possam encolher naturalmente.

Esse diagnóstico deve orientar o documento 11: uma situação ideal melhor é aquela que reduz
centralização e aumenta governança **sem exigir uma arquitetura completamente nova em relação ao que
já existe**.
