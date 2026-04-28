# 31 — Inventário Final de Capabilities SDK Pendentes ou Parcialmente Promovidas

**Status**: início do Bloco B / W9 **Última atualização**: 2026-04-27 **Escopo desta etapa**:
consolidar, com base no código vivo de `src/copilot/`, quais capabilities do `@github/copilot-sdk`
já foram plenamente promovidas, quais estão apenas parcialmente promovidas e quais ainda carecem de
owner canônico claro dentro da arquitetura local.

---

## 1. Objetivo deste documento

O W9 do roadmap não é um exercício teórico. Ele é a porta de entrada do Bloco B.

Antes de “fechar wrappers pendentes”, precisamos saber exatamente:

1. quais capabilities do SDK já estão bem incorporadas;
2. quais aparecem apenas em tipos/builders, mas sem promoção completa pelo runtime local;
3. quais ainda nem chegaram ao codebase como surface real;
4. onde o owner atual é suficiente e onde ainda existe lacuna arquitetural.

---

## 2. Escala de classificação usada

| Status                      | Significado                                                                      |
| --------------------------- | -------------------------------------------------------------------------------- |
| **promovida**               | capability já possui owner claro e surface razoavelmente madura em `src/copilot` |
| **parcialmente promovida**  | capability existe no tipo/builder/camadas baixas, mas ainda sem integração total |
| **lacuna real**             | capability aparece no SDK, mas praticamente não existe como surface local        |
| **fora de escopo imediato** | capability existe, mas ainda não justifica promoção prioritária                  |

---

## 3. Resumo executivo da W9

### Capabilities já relativamente bem promovidas

- `commands`
- `customAgents`
- `defaultAgent`
- `modelCapabilities`
- `provider`
- `onEvent`

### Capabilities com promoção parcial relevante

- session-level auth (`gitHubToken` por sessão)
- trace context propagation
- multitenancy/provider ownership

### Lacunas reais fortes identificadas

- aprofundamento do recovery transversal por `SdkErrorKind` além de `client.connect`,
  `session.create` e `session.resume`
- adapters adicionais e política final de longo prazo para `sessionFs`

Conclusão inicial do W9:

> o maior gap funcional concreto remanescente no boundary SDK não parece mais ser ELICITATION/UI,
> mas sim o eixo **session filesystem + session-scoped auth/runtime state plumbing + recovery
> transversal remanescente por `SdkErrorKind`**.

> **Atualização pós-W12**: `sessionFs` e `createSessionFsHandler` já não são mais lacunas puras.
> Ambos passaram para o estado de **promoção parcial relevante**, com wiring real inicial no
> runtime, métricas L1 por operação, gate de soberania do owner e projeção no EventBus canônico,
> restando principalmente a discussão sobre adapters adicionais e política final de longo prazo.

> **Atualização pós-W13 complementar**: o recovery por `SdkErrorKind` também já não está mais
> restrito a `client.connect`; ele passou a cobrir `session.create`, `session.resume` e os fluxos
> singleton `createClientSession()`/`resumeClientSession()`, restando sobretudo os fluxos vivos mais
> especializados do runtime.

---

## 4. Capability por capability

## 4.1 `commands`

### Evidências observadas

- `config/session-config.js` já expõe `.commands(commands)`;
- `sdk/types.js` já documenta o contrato de commands;
- há forte presença de sinais de command em:
  - `events/`
  - `event-handlers/interaction-events.js`
  - `observability/collectors/interaction-handlers.js`
- `terminal/commands/*` existe como UX local, embora não seja a mesma coisa que SDK slash commands.

### Diagnóstico

`commands` está **parcialmente para fortemente promovida**.

A capability já existe no eixo:

- tipos;
- builder;
- observabilidade;
- event flow.

O que ainda falta é menos “suporte bruto” e mais:

- explicitar owner semântico dessa capability no runtime local;
- documentar melhor a relação entre SDK slash commands e UX do terminal.

### Classificação

**promovida**, com refinamento pendente de governança.

### Owner atual mais adequado

- vanilla contract: `sdk/`
- montagem declarativa: `config/`
- consumo/runtime impact: `agent/` + `events/`

---

## 4.2 `customAgents`

### Evidências observadas

- `config/custom-agents.js` contém superfície explícita;
- `config/session-config.js` expõe `.customAgents(agents)` e `.agent(name)`;
- `sdk/types.js` já documenta `CustomAgentConfig`;
- `sdk/agent/agents.js` existe como surface vanilla-promoted para seleção/listagem/controle.

### Diagnóstico

Aqui já existe uma promoção bem avançada.

A capacidade está visível em:

- SDK types;
- config declarativa;
- wrappers/agent surface;
- modelagem de agentes customizados no runtime local.

### Classificação

**promovida**.

### Pendências remanescentes

- clarificar a fronteira entre custom agents do SDK e estratégias locais do `agent/`;
- reforçar testes estruturais de ownership entre `config/custom-agents.js`, `sdk/agent/agents.js` e
  runtime selection.

---

## 4.3 `defaultAgent`

### Evidências observadas

- `config/session-config.js` expõe `.defaultAgent(config)`;
- `sdk/types.js` documenta `DefaultAgentConfig`.

### Diagnóstico

A capability já está presente no eixo declarativo/tipado, mas ainda parece depender fortemente do
builder/config para existir na prática.

Não há ainda uma leitura arquitetural tão forte quanto a de `customAgents`.

### Classificação

**parcialmente promovida**.

### Pendência principal

Transformar `defaultAgent` de “campo suportado em builder” em capability arquitetural explicitamente
compreendida e governada pelo runtime local.

---

## 4.4 `modelCapabilities`

### Evidências observadas

- `sdk/types.js` tipa `ModelCapabilitiesOverride`;
- `config/session-config.js` expõe `.modelCapabilities(overrides)`;
- documentação arquitetural anterior já o cita como capability relevante.

### Diagnóstico

Hoje a capacidade existe claramente no plano do contrato e do builder.

Mas sua promoção arquitetural ainda é mais fraca do que:

- `session.ui.*`
- `commands`
- `customAgents`

### Classificação

**parcialmente promovida**.

### Pendência principal

Definir se `modelCapabilities` será apenas surface de configuração declarativa ou se o runtime local
terá também:

- leitura/projeção pública consistente;
- observabilidade específica;
- validação reforçada por owner.

---

## 4.5 `provider` / BYOK

### Evidências observadas

- `config/session-config.js` expõe `.provider(provider)`;
- `sdk/session/provider.js` existe com helpers explícitos (`openaiProvider`, `azureProvider`,
  `anthropicProvider` etc.);
- `sdk/types.js` documenta `ProviderConfig` e o domínio BYOK;
- a auditoria anterior já havia destacado `sdk/session/provider.js` como módulo ainda merecedor de
  hardening adicional.

### Diagnóstico

Provider/BYOK já existe de forma clara no boundary vanilla e no plano declarativo.

O gap não é mais “falta de suporte”. O gap é:

- ownership fino;
- clareza de multitenancy/session-level auth;
- validação/hardening de provider lifecycle.

### Classificação

**promovida**, mas ainda com hardening importante pendente.

---

## 4.6 `onEvent`

### Evidências observadas

- `config/session-config.js` expõe `.onEvent(handler)`;
- `sdk/types.js` documenta `SessionEventHandler` e `onEvent` em `SessionConfig`;
- `lib/session.js` legado também já refletia esse suporte.

### Diagnóstico

A capability existe no contrato e no builder.

O que ainda parece faltar é uma política arquitetural mais clara sobre quando usar `onEvent`
precoce, versus:

- `event-handlers/`
- `onSessionEvent`
- `catch-all`
- wiring do runtime.

### Classificação

**promovida**, porém com necessidade de clarificação de uso e owner.

---

## 4.7 session-level auth (`gitHubToken` por sessão)

### Evidências observadas

- `sdk/types.d.ts` oficial prevê `gitHubToken` em `SessionConfig`;
- em `src/copilot/`, o `gitHubToken` aparece fortemente no nível de client options:
  - `sdk/session/client-options.js`
  - `boot/config.js` (flag de token configurado)
- **não** aparece como builder explícito em `config/session-config.js`.

### Diagnóstico

Este é um gap real e relevante.

Hoje o repositório parece cobrir melhor:

- auth do client/processo SDK;

mas não promove com a mesma força:

- auth por sessão;
- identidade por sessão;
- multitenancy session-scoped.

### Classificação

**parcialmente promovida**, com lacuna material.

### Pendência principal

Adicionar e governar explicitamente no plano declarativo/local:

- `SessionConfigBuilder.gitHubToken(...)`;
- documentação do owner dessa capability;
- testes de surface/contrato;
- avaliação do impacto sobre multitenancy e content exclusion.

---

## 4.8 `sessionFs`

### Evidências observadas

- `sdk/types.d.ts` oficial prevê `sessionFs` no `CopilotClientOptions`;
- `sdk/types.js` local documenta `SessionFs*` e o capability set do SDK;
- `boot/session-fs.js` passou a ser owner canônico de env/defaults/paths;
- `sdk/session/session-fs.js` agora promove:
  - config client-level;
  - provider local;
  - handler por sessão;
  - integração com o runtime do agent;
- `sdk/session/client-options.js` passou a promover a capability automaticamente a partir do boot.

### Diagnóstico

O gap bruto do W9 já foi atacado.

A capability deixou de ser apenas tipada/teórica e passou a possuir:

- owner de boot;
- owner L1;
- wiring client-level;
- wiring session-level;
- injeção no fluxo real de inicialização da sessão.

### Classificação

**parcialmente promovida**.

### Pendência principal

Consolidar a promotion recém-aberta. O próximo passo já não é decidir “se” a capability existe, mas
endurecer “como” ela existirá. Restam:

- observabilidade específica por operação;
- gate de soberania estrutural;
- decisão sobre adapters adicionais além do provider local;
- clareza da relação com persistência e runtime state de mais longo prazo.

---

## 4.9 `createSessionFsHandler`

### Evidências observadas

- é previsto no SDK oficial dentro de `SessionConfig`;
- `config/session-config.js` já expõe `.createSessionFsHandler(...)`;
- `sdk/session/lifecycle.js` já propaga a capability;
- `agent/session/initializer.js` já a injeta no fluxo real via façade do agent;
- `sdk/session/session-fs.js` já oferece handler canônico configurado por boot.

### Diagnóstico

Tal como `sessionFs`, esta capability já deixou de ser apenas contrato do SDK.

O eixo agora possui promotion operacional mínima, mas ainda precisa de endurecimento arquitetural.

### Classificação

**parcialmente promovida**.

### Pendência principal

Fixar o owner final e a governança dessa capability, incluindo:

- teste estrutural de soberania;
- métricas de criação/uso do handler;
- decisão de longo prazo sobre stores locais/virtuais e extensão do provider.

---

## 4.10 Trace context propagation (`traceparent`, `tracestate`, `onGetTraceContext`)

### Evidências observadas

- `sdk/types.js` documenta `traceparent`/`tracestate` em `ToolInvocation`;
- `sdk/telemetry/tracing.js` existe e oferece helpers como `createStaticTraceProvider(...)`;
- há observabilidade L1 já em expansão.

### Diagnóstico

Não é uma lacuna total, mas também não parece uma capability plenamente promovida de ponta a ponta.

A infraestrutura existe; a governança arquitetural ainda parece parcial.

### Classificação

**parcialmente promovida**.

### Pendência principal

Decidir se a revolução tratará trace context apenas como capability interna do SDK boundary ou como
capability arquitetural de primeira classe do runtime local.

---

## 5. Tabela consolidada da W9

| Capability                  | Status                  | Owner atual dominante                                        | Prioridade do Bloco B |
| --------------------------- | ----------------------- | ------------------------------------------------------------ | --------------------- |
| `commands`                  | promovida               | `sdk/` + `config/` + `events/`                               | média                 |
| `customAgents`              | promovida               | `config/` + `sdk/agent`                                      | média                 |
| `defaultAgent`              | parcialmente promovida  | `config/`                                                    | média                 |
| `modelCapabilities`         | parcialmente promovida  | `config/` + `sdk/types`                                      | média                 |
| `provider` / BYOK           | promovida com hardening | `sdk/session/provider.js` + `config/`                        | alta                  |
| `onEvent`                   | promovida               | `config/` + `sdk/events`                                     | média                 |
| session-level `gitHubToken` | parcialmente promovida  | `sdk/session/client-options.js`                              | alta                  |
| `sessionFs`                 | parcialmente promovida  | `boot/session-fs.js` + `sdk/session/session-fs.js`           | muito alta            |
| `createSessionFsHandler`    | parcialmente promovida  | `sdk/session/session-fs.js` + `agent/session/initializer.js` | muito alta            |
| trace context propagation   | parcialmente promovida  | `sdk/telemetry/`                                             | média-alta            |

---

## 6. Decisões preliminares da W9

### D31-01

O maior gap funcional remanescente identificado no boundary SDK continua sendo o eixo `sessionFs` /
`createSessionFsHandler`, mas agora já em estado de **promoção parcial com wiring real**, não mais
como lacuna pura.

### D31-02

Session-level auth (`gitHubToken` por sessão) deve entrar na próxima leva de investigação de
hardening porque hoje sua promoção está muito atrás da do client-level auth.

### D31-03

`provider` não é mais lacuna de presença; é lacuna de hardening e clareza de ownership.

### D31-04

`commands`, `customAgents` e `onEvent` não devem ser tratados como “missing features”; devem ser
tratados como capabilities já existentes que precisam de clarificação e consolidação documental e
estrutural.

---

## 7. Próximos passos imediatos do Bloco B

A ordem recomendada após esta W9 é:

1. revisar `sdk/session/provider.js` e `sdk/session/permissions.js` como hardening técnico direto;
2. endurecer observabilidade, gates e ownership final de `sessionFs` / `createSessionFsHandler`;
3. introduzir `gitHubToken` por sessão no builder declarativo se a capability for assumida como
   parte do runtime local;
4. criar ADR da fronteira SDK atualizada.

---

## 8. Conclusão desta etapa

A W9 mostrou que o boundary SDK está muito mais maduro do que em ondas anteriores, mas a revolução
ainda tem uma tarefa clara no Bloco B:

- não simplesmente “adicionar o que falta”,
- e sim distinguir com rigor o que já está promovido, o que precisa endurecer e o que ainda nem
  entrou de fato no sistema.
