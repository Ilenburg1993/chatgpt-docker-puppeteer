# 10 — Agent Module: Situação Atual Validada

**Data de atualização**: 2026-04-21  
**Escopo primário**: `src/copilot/agent/`  
**Escopo contextual**: relação de `agent/` com `sdk/`, `event-handlers/`, `presentation/`, `server/`, `terminal/`, `conversation-hub/` e `observability/` em `src/copilot/`  
**Status**: auditoria reescrita e consolidada a partir do código vivo  
**Referências**:

- [09-AGENT-LOGICA-FLUXO.md](./09-AGENT-LOGICA-FLUXO.md)
- [11-AGENT-SITUACAO-IDEAL.md](./11-AGENT-SITUACAO-IDEAL.md)
- [../AUDITORIA-PROFUNDA-ABRIL-2026/14-FLUXO-AGENT-TERMINAL-SDK.md](../AUDITORIA-PROFUNDA-ABRIL-2026/14-FLUXO-AGENT-TERMINAL-SDK.md)
- [../AUDITORIA-PROFUNDA-ABRIL-2026/15-ARQUITETURA-PADRONIZADA-E-CENTRALIZADA.md](../AUDITORIA-PROFUNDA-ABRIL-2026/15-ARQUITETURA-PADRONIZADA-E-CENTRALIZADA.md)

> **Leitura correta deste documento**: ele descreve a situação atual real do `agent/` no estado do código em 2026-04-21. Não é um plano aspiracional, nem um retrato histórico de março. Quando houver divergência entre documentação antiga e o código vivo, este documento deve ser tratado como fonte canônica mais recente.

---

## 1. Resumo executivo

O módulo `src/copilot/agent/` **já não é um monólito em fase de desmontagem**.

A decomposição estrutural principal aconteceu. Hoje o `agent/` já conta com:

- fachada pública em `always-alive.js`;
- `AgentContext` particionado em subestados nomeados;
- pipeline de boot por steps;
- event bridge declarativo;
- política de erro central com wrapper operacional;
- health canônico e reutilizável;
- tracker de tarefas em background;
- lazy singleton funcional com `getAgent()`;
- superfície SDK explícita e auditável;
- registry explícita de runtime;
- integração arquitetural madura com `presentation/` para bordas compartilhadas.

Em outras palavras:

> **o problema principal do `agent` já não é mais falta de modularização; o problema principal agora é hardening final de fronteiras, governança semântica de estado e fechamento das poucas dívidas internas remanescentes.**

O estado atual pode ser resumido assim:

### O que já está forte

- decomposição por domínio (`lifecycle/`, `dialog/`, `session/`, `messaging/`, `state/`, `facades/`, `infra/`);
- `AlwaysAliveAgent` bem mais próximo de uma fachada fina;
- integração com o SDK mais explícita e menos artesanal;
- `presentation/` já assumiu o papel correto de camada de borda compartilhada;
- `runtimeId` já atravessa parte relevante do HTTP e da UX local do terminal;
- a trilha `ask_user` já é semântica e governada;
- hot path com casts residuais praticamente drenados;
- health e boot com observabilidade muito superiores ao retrato antigo.

### O que ainda não está fechado

- `AgentContext` ainda não governa 100% do hot path por mutation/read API semântica;
- alguns consumers ainda mantêm fallback estrutural para `ctx.*State` em pontos residuais;
- `withAgentErrorPolicy(...)` ainda não virou padrão absoluto em todo o núcleo;
- `alwaysAliveAgent` ainda sobrevive em boundaries de compatibilidade legítimos;
- multi-session real ainda não existe;
- parte da UX local ainda precisa decisão explícita sobre o que deve continuar `default-only`.

### Diagnóstico franco

Hoje o `agent` está em um estado que pode ser descrito assim:

> **arquitetura boa, modular e operacionalmente madura, porém ainda semi-endurecida no núcleo.**

---

## 2. O que já foi entregue de verdade

Abaixo está a leitura correta do que saiu do papel e hoje já faz parte do desenho vivo.

| Tema | Situação atual | Observação |
| --- | --- | --- |
| Decomposição do runtime | **entregue** | a lógica principal já está distribuída entre submódulos de domínio |
| `AgentContext` particionado | **entregue parcialmente** | subestados nomeados existem; encapsulação total ainda não |
| Boot pipeline por steps | **entregue** | `boot-steps.js` + `runBootPipeline()` |
| Event bridge declarativo | **entregue** | `event-bridge-map.js` + `event-bridge-wiring.js` |
| Background task tracker | **entregue** | `background-tasks.js` com `drain()` no shutdown |
| Health formal | **entregue** | `health-check.js` + rotas e projections correlatas |
| Lazy singleton | **entregue parcialmente** | `getAgent()` é canônico; proxy compatível ainda existe |
| Error policy | **entregue parcialmente** | classificador + wrapper + adoção forte, mas ainda não total |
| Superfície SDK pública do agent | **entregue** | `agent-sdk-access.js` + `getSdkHandles()` / `getSdkResourceSnapshot()` |
| Registry explícita de runtime | **entregue** | `runtime-registry.js` |
| Shared edge layer em `presentation/` | **entregue parcialmente** | já cobre várias bordas críticas; ainda há espaço de extensão |
| Runtime targeting compartilhado | **entregue parcialmente** | `runtime-request.js` + `runtime-targeting.js` + `agent-runtime.js` |
| Semântica governada de `ask_user` | **entregue parcialmente** | forte no runtime/health/terminal, mas ainda com espaço de refinamento |

A conclusão correta não é “ainda falta fazer tudo”. A conclusão correta é:

> **o esforço bruto de refatoração estrutural já aconteceu; o esforço restante é de consolidação e endurecimento.**

---

## 3. Fotografia atual de `src/copilot/`

O `agent/` não pode mais ser avaliado isoladamente como em março. Hoje ele precisa ser entendido dentro da topologia real do `src/copilot/`.

```text
src/copilot/
├── sdk/              # contratos vanilla, sessões, RPC, agents, mode/plan, telemetry SDK
├── event-handlers/   # tradução de SessionEvent cru em sinais internos estáveis
├── agent/            # runtime contínuo, lifecycle, dialog, queue, health, reconnect, ownership
├── presentation/     # seleção de runtime + projections/shared handlers de borda
├── terminal/         # REPL, comandos, prompt, render e UX operacional local
├── server/           # rotas HTTP, SSE e composição web
├── channel/          # cliente de conversa contínua com LLM-B
├── conversation-hub/ # sessões e turns do hub
├── observability/    # logs, métricas, tracing, timelines e observers
└── hooks/            # composição de hooks do SDK e políticas de permissão/erro/auditoria
```

### Leitura correta dessa topologia

- `sdk/` define **capacidade vanilla**;
- `event-handlers/` traduz **evento cru do SDK**;
- `agent/` governa o **runtime contínuo**;
- `presentation/` governa o **acesso compartilhado de borda**;
- `terminal/` e `server/` são **consumidores** das capacidades do runtime;
- `observability/` coleta e projeta sinais, mas não governa semântica do runtime.

Essa divisão já é visível no código. O principal risco atual não é ausência de camada; é **regressão de fronteira**.

---

## 4. Fronteiras atuais por camada

## 4.1 `sdk/`

### Responsabilidade atual correta

- encapsular contratos e helpers vanilla do `@github/copilot-sdk`;
- centralizar client/session lifecycle;
- centralizar RPCs vanilla (`mode`, `plan`, `agents`, `sessions`, etc.);
- manter telemetry e helpers de sessão ligados ao SDK.

### O que já está saudável

- `mode/plan` e RPCs vanilla vivem em `sdk/`;
- a superfície de sessão do SDK está mais auditável;
- `agent/` já consegue expor handles do SDK sem duplicar contratos.

### O que ainda pede vigilância

- evitar reexportações confusas ou overlap desnecessário entre barrels;
- evitar que `terminal/` ou `presentation/` reinventem semantics vanilla fora desta camada.

## 4.2 `event-handlers/`

### Responsabilidade atual correta

- traduzir `SessionEvent` cru em sinais internos estáveis;
- concentrar a leitura do payload real do SDK;
- impedir que a interpretação do evento vanilla se espalhe pelo runtime.

### O que já está saudável

- a pasta existe e está organizada por famílias semânticas (`streaming`, `tool-lifecycle`, `mode-and-tools`, etc.);
- a fronteira conceitual com `agent/` está muito melhor do que antes.

### O que ainda pede vigilância

- impedir que payload HTTP ou state do runtime sejam montados aqui;
- impedir drift entre payload vanilla do SDK e o shape interno traduzido.

## 4.3 `agent/`

### Responsabilidade atual correta

- source-of-truth do runtime contínuo da LLM-B;
- lifecycle, reconnect, dialog loop, queue, ownership e health;
- manutenção de invariantes do runtime;
- facades públicas de alto valor do SDK para consumidores do runtime.

### O que já está saudável

- `always-alive.js` está mais fino;
- boot, reconnect, shutdown e sessão já não estão mais esmagados numa única classe;
- health, `ask_user`, SDK access e state snapshots já têm pontos canônicos.

### O que ainda pede hardening

- governança de estado via `AgentContext`;
- remoção dos últimos fallback reads de `ctx.*State` no hot path;
- adoção total da error policy;
- fechamento da migração canônica para `getAgent()`.

## 4.4 `presentation/`

### Responsabilidade atual correta

- seleção compartilhada de runtime;
- projections/payloads consumidos por mais de uma borda;
- composição de deps de router/handlers;
- explicitação de fallback/targeting do runtime.

### O que já está saudável

Hoje já existem e são reais:

- `agent-runtime.js`
- `runtime-targeting.js`
- `runtime-request.js`
- `runtime-overview.js`
- `runtime-status.js`
- `runtime-health.js`
- `runtime-controls.js`
- `runtime-dialog.js`
- `runtime-webhooks.js`
- `runtime-sdk-session.js`
- `runtime-file-context.js`
- `runtime-ui-state-store.js`

Isso significa que a camada já deixou de ser “ideia” e virou parte real da arquitetura.

### O que ainda pede vigilância

- não virar fonte de verdade do runtime;
- não reinterpretar `SessionEvent` cru;
- não reabrir dependência de implementação do terminal;
- continuar drenando duplicação de payloads e handlers das bordas.

## 4.5 `terminal/`

### Responsabilidade atual correta

- REPL;
- prompt e render;
- waiting UX;
- narrativa local do operador;
- comandos e interação local.

### Situação atual

O `terminal/` está bem mais saudável porque deixou de ser “camada comum informal”. Mas ainda precisa disciplina:

- deve consumir `presentation/` quando a capacidade já for compartilhada;
- não deve reinterpretar o SDK em paralelo;
- precisa explicitar, caso a caso, o que continua `default-only` por decisão de UX.

## 4.6 `server/`

### Situação atual

As rotas críticas já deixaram de montar muitos snapshots e composições na mão. Há progresso real em:

- `copilot-api/*`
- `sdk/*`
- `health.js`
- `webhooks.js`

O ganho principal foi arquitetural:

> **as rotas já dependem muito menos da topologia concreta do runtime default e muito mais das facades/projections compartilhadas.**

---

## 5. Arquitetura atual do `agent/`

Hoje a estrutura do módulo é esta:

```text
src/copilot/agent/
├── always-alive.js            # fachada pública + singleton lazy + proxy compat
├── agent-context.js           # estado interno + mutation/read API semântica
├── background-tasks.js        # tracking de fire-and-forget
├── error-policy.js            # classificação e wrapper de erro
├── runtime-registry.js        # registro explícito de runtimes
├── health-check.js            # snapshot canônico de health
├── lifecycle/                 # start, stop, reconnect, state-io, session-setup
├── session/                   # wiring, snapshots, keepalive, ownership, boot
├── dialog/                    # dialog loop, turn executor, protocol, watchdog
├── messaging/                 # send, answer, steer, queue processing
├── infra/                     # queue, handoff, webhooks, task helpers
├── facades/                   # surface pública do runtime e do SDK
└── state/                     # snapshots e helpers de estado
```

### Leitura correta da arquitetura atual

- `AlwaysAliveAgent` continua sendo a API pública canônica;
- `AgentContext` já virou a peça central de composição de estado;
- o runtime agora é controlado por módulos especializados, e não por um “mega arquivo” único;
- a topologia atual já permite hardening incremental sem refactor destrutivo.

---

## 6. Estado atual por eixo de consolidação

## 6.1 Estado e `AgentContext`

### O que já foi entregue

- subestados nomeados (`sessionState`, `dialogState`, `configState`, `metricsState`, `runtimeState`, `ioState`);
- mutation API significativa;
- getters e snapshots semânticos relevantes;
- redução clara de aliases largos no lifecycle quente.

### Evidência operacional atual

No estado atual do código:

- o grep de acessos crus relevantes a `ctx.(sessionState|dialogState|runtimeState|metricsState|configState|ioState)` no subtree `src/copilot/agent/**/*.js` está reduzido a **poucas ocorrências residuais**;
- essas ocorrências já não representam “domínio espalhado”, e sim poucos pontos de fallback/compatibilidade ainda abertos;
- `session-setup.js` e `agent-lifecycle.js` já consomem majoritariamente `ctx.model`, `ctx.reasoningEffort`, `ctx.status`, `ctx.session`, `ctx.client`, snapshots e helpers.

### Leitura correta

A dívida dominante continua sendo esta, mas agora ela mudou de natureza:

> antes era “o contexto é um saco mutável sem forma”; agora é “o contexto já tem forma, mas precisa dominar completamente o hot path”.

## 6.2 Contratos de host e capability boundaries

### O que já foi entregue

- drenagem dos piores casts estruturais;
- centralização de guards e compat shims em `runtime-contracts.js`;
- alinhamento dos tipos do SDK e hooks ao shape real;
- limpeza de listeners de `AbortSignal` no `turn-executor`.

### Situação atual correta

O hot path do `agent` já não vive mais de `unknown -> cast -> esperança`.

Ainda assim, a fronteira ainda não é perfeita porque:

- alguns pontos continuam baseados em JSDoc estrutural;
- a validação runtime é leve, não formal;
- boundaries compatíveis ainda existem em pontos controlados.

## 6.3 Error policy

### O que já foi entregue

- `withAgentErrorPolicy(...)` existe;
- adoção forte em `messaging`, `reconnect`, `dialog`, `ownership` e persistência auxiliar;
- `persistStateWithPolicy(...)` já virou caminho canônico de persistência quente.

### Evidência operacional atual

- o grep de `writeStateAsync(` no subtree `src/copilot/agent/**/*.js` está essencialmente concentrado em `lifecycle/state-io.js`;
- o runtime quente já opera majoritariamente sobre `persistStateWithPolicy(...)`, não sobre chamadas dispersas.

### Leitura correta

A error policy já é parte do desenho vivo, não tese. O que falta é **dominar 100% dos fluxos críticos**.

## 6.4 Lazy singleton e governança da instância

### O que já foi entregue

- `getAgent()` é o caminho canônico;
- `alwaysAliveAgent` está rebaixado a camada de compatibilidade;
- DI do terminal já isola explicitamente o que fica no proxy e o que usa a instância real.

### Leitura correta

A dívida remanescente aqui não é “remover o proxy imediatamente”. É:

- manter o proxy apenas em boundaries justificadas;
- impedir novos consumidores operacionais de nascerem nele;
- documentar as exceções legítimas.

## 6.5 Boot pipeline e observabilidade

### O que já foi entregue

- pipeline por steps;
- criticidade explícita por step;
- `bootReport` no runtime;
- health refletindo `failed`/`degraded`;
- ação recomendada e flags de risco.

### Leitura correta

O boot já não é mais caixa-preta. A dívida remanescente é **enriquecimento adicional**, não ausência de estrutura.

## 6.6 Health snapshot

### O que já foi entregue

- runtime, client, session, dialog, queue, io, background, boot, quota;
- `riskFlags`;
- `recommendedAction`;
- `sdkResources`;
- ask_user shadow semântica.

### Leitura correta

O health atual já é operacionalmente útil. O próximo passo não é “ter health”; é **torná-lo ainda mais acionável**.

## 6.7 Superfície SDK do agent

### O que já foi entregue

- `getSdkHandles()`;
- `getSdkResourceSnapshot()`;
- status/auth/ping/last session/foreground session;
- agents, sessions, mode, plan;
- handles crus controlados.

### Leitura correta

A fronteira `agent ↔ sdk` está muito melhor. O que falta agora é estabilidade de longo prazo e cobertura total consistente em todas as bordas e testes.

## 6.8 `ask_user`

### O que já foi entregue

- semântica de `ready/reply/stopped/question`;
- persistência seletiva;
- shadow com TTL e expiração;
- projeção consistente em runtime/terminal/health/snapshots;
- reaper contínuo;
- alinhamento com defaults reais do SDK;
- atividade em tempo real do terminal baseada em sinais reais do SDK.

### Leitura correta

A trilha `ask_user` já deixou de ser gambiarra textual. Hoje ela é um subsistema governado, embora ainda possa ser refinado.

## 6.9 Relação `agent ↔ presentation`

### O que já foi entregue

- `runtime-registry.js`;
- `presentation/agent-runtime.js`;
- targeting compartilhado;
- runtime-aware HTTP e parte do REPL;
- transparência explícita de fallback.

### Leitura correta

O que mudou de forma decisiva foi isto:

> **o runtime já não é só um singleton implícito exposto a todo mundo; ele já está sendo acessado por uma fronteira compartilhada e deliberada.**

Esse avanço é um dos mais importantes do ciclo atual de consolidação.

---

## 7. Indicadores verificáveis do estado atual

Os indicadores abaixo são os que melhor resumem o estado do módulo hoje.

### Indicadores positivos já observáveis

- casts `unknown` do hot path do `agent/` praticamente drenados;
- `writeStateAsync()` concentrado em `state-io.js`;
- `presentation/` sem imports runtime de `terminal/*`;
- targeting de `runtimeId` já compartilhado entre HTTP, REPL e accessors;
- `agent/` com runtime registry explícita;
- `health-check.js` enriquecido e reutilizável;
- `alwaysAliveAgent` já rebaixado a boundary compatível, e não mais ponto canônico.

### Indicadores de dívida ainda viva

- poucas leituras cruas de `ctx.*State` ainda sobrevivem como fallback/compatibilidade;
- `boot/hooks/cleanup` ainda não são dominados integralmente pela error policy;
- multi-session continua ausente;
- ainda existem paths de UX que precisam decisão formal sobre `default-only` vs `runtime-aware`.

---

## 8. O que ainda falta de forma relevante

## 8.1 Encapsulamento final do `AgentContext`

Ainda faltam, de forma objetiva:

- dominar 100% dos writes quentes por mutation API semântica;
- reduzir o restante dos raw reads estruturais;
- explicitar ownership por subestado;
- impedir que novos módulos voltem a depender do shape cru.

## 8.2 Error policy total

Ainda faltam, de forma objetiva:

- adoção em mais trechos de boot interno;
- adoção em cleanup/rotation residuais;
- padronização mais forte de contexto operacional (`label`, `phase`, `taskId`, `sessionId`).

## 8.3 Hardening de fronteira

Ainda faltam, de forma objetiva:

- reduzir compat shims residuais onde não forem mais necessários;
- impedir novas dependências cruzadas ruins;
- formalizar melhor boundaries de capability no núcleo.

## 8.4 Multi-session real

Ainda falta, de forma objetiva:

- múltiplos runtimes/sessões ativas com isolamento real;
- governança de scheduling e seleção ativa;
- semantics mais explícitas de lifecycle entre runtimes.

## 8.5 Watchdog e handoff

Ainda faltam, de forma objetiva:

- watchdog adaptativo por histórico real;
- protocolo de handoff mais formalizado;
- mais cobertura de regressão em cenários de stall e transferência.

---

## 9. Backlog priorizado a partir do estado atual

| ID | Severidade | Tema | Estado atual | Próxima ação correta |
| --- | --- | --- | --- | --- |
| `A1` | 🔴 | Governança final de estado | parcial | completar mutation/read API do `AgentContext` e drenar raw reads restantes |
| `A2` | 🔴 | Contratos de host/capability | parcial | consolidar boundaries e remover compatibilidade residual indevida |
| `A3` | 🔴 | Cobertura estrutural | parcial | ampliar malha em boot/reconnect/lazy singleton/ownership |
| `A4` | 🟠 | Error policy total | parcial | adotar wrapper e contexto estruturado em todo o núcleo crítico |
| `A5` | 🟠 | Boot observável | parcial | enriquecer telemetria por step e impacto no health |
| `A6` | 🟠 | Governança do singleton | parcial | revisar call sites restantes e documentar boundaries compatíveis |
| `A7` | 🟠 | Superfície SDK estável | parcial | manter cobertura e impedir drift entre runtime e SDK |
| `A8` | 🟡 | Health mais acionável | parcial | enriquecer backlog labels, timings e rotation ownership |
| `A9` | 🟡 | Watchdog adaptativo | aberto | mover de threshold estático para threshold informado por histórico |
| `A10` | 🟡 | Multi-session / handoff formal | aberto | desenhar governança real de múltiplos runtimes |

---

## 10. Conclusão

O retrato correto do `agent` hoje é este:

- **não** é um subsistema atrasado em decomposição estrutural;
- **já** é uma arquitetura modular razoavelmente madura;
- **já** possui base forte de boot, health, hooks, SDK, `ask_user`, singleton e observabilidade;
- **a principal dívida agora é de consolidação arquitetural**, não de “quebra de monólito”.

Em termos simples:

> **situação atual real** = runtime modular, funcional e muito mais governado do que antes, com fronteiras externas bem melhores, porém ainda com dívida interna relevante em `AgentContext`, error policy total, multi-session e fechamento final de boundaries.

É exatamente esse estado que justifica a estratégia correta para as próximas ondas:

> **menos refactor destrutivo; mais hardening rigoroso.**
