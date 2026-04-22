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
3. **`agent/` governa runtime contínuo, mas não governa tools, hooks, bridges, memória ou HTTP**.
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

---

## 3. Arquitetura global ideal

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
- `presentation/` pode depender de `agent/`, `conversation-hub/`, `config/`, `core/` e `infra/`.
- `agent/` pode depender de `sdk/`, `events/`, `config/`, `core/` e de `agent/ports/` para compor
  tools, hooks, bridges, conversation-hub e observability.
- `sdk/` não pode depender de `agent/`, `presentation/`, `server/` ou `terminal/`.
- `events/` não pode depender de runtime concreto.
- `event-handlers/` não pode renderizar HTTP, terminal ou UI.

## 3.3 Papel ideal de cada área

| Área               | Papel ideal                                                | Anti-padrão a evitar                                   |
| ------------------ | ---------------------------------------------------------- | ------------------------------------------------------ |
| `core/`            | primitivas, DI, erro, mutex, JSON, EventBus, shutdown      | conhecer runtime                                       |
| `types/`           | contratos compartilhados                                   | depender de implementação                              |
| `db/`              | armazenamento estrutural                                   | acionar UI/runtime                                     |
| `config/`          | configuração declarativa e prompt                          | decidir fluxo operacional                              |
| `sdk/`             | wrapper vanilla, sessão SDK, RPC, telemetry SDK            | conhecer `agent/`                                      |
| `events/`          | nomes, catálogo, schemas e middleware de eventos           | chamar runtime                                         |
| `event-handlers/`  | tradução de payload cru para evento/projection de domínio  | renderizar borda                                       |
| `hooks/`           | políticas de permissão, erro, prompt e tool interception   | virar runtime host                                     |
| `tools/`           | factories e execução de capacidades                        | depender de terminal                                   |
| `bridges/`         | integração externa MCP/Git/NERV                            | ser chamado como singleton implícito pelo runtime      |
| `plugins/`         | registro e descoberta de plugins                           | controlar ciclo de vida do agent                       |
| `infra/`           | webhooks, filas, lockfile, storage, SSE                    | guardar regra de domínio                               |
| `agent/`           | runtime contínuo, sessão ativa, dialog loop, ownership     | absorver tools, hub, presentation, terminal ou server  |
| `channel/`         | canal client/dialog/history/structured                     | duplicar runtime                                       |
| `conversation-hub` | memória conversacional, turns, broadcast e consultas       | ser store interno do agent                             |
| `presentation/`    | projections e comandos compartilhados para bordas          | virar runtime alternativo                              |
| `server/`          | HTTP, SSE, middleware, serialização                        | acessar internals do agent sem projection              |
| `terminal/`        | REPL, comandos, renderização local, atividade              | escutar eventos internos quando projection resolver    |
| `observability/`   | métricas, traces, snapshots, collectors, observers         | reinterpretar payload cru em paralelo a event-handlers |
| `audit/`           | trilha auditável, pipeline, buffers, permissões auditáveis | decidir política operacional                           |

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
- Manter exceções de composição como arquivos específicos (`agent/ports/*`,
  `config/sdk-config-port.js`, `terminal/di-wiring.js`, `types/index.js`).

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
  de input têm cadências diferentes.

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
- Próximo passo: retirar construção concreta de permission policy do construtor do contexto e mover
  para factory de runtime.

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

Pendente:

- reduzir reexports largos de `agent/index.js`.
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
- dialog loop e pending-question IO;
- permission policy;
- webhooks e handoff;
- health, quota e boot recovery.

Pendente:

- adicionar MCP/tools/conversation memory como capabilities explícitas quando houver readiness
  própria por port;
- trocar consumidores locais de status por esse mapa quando a UI precisar exibir disponibilidade.

### F4.3 Health por capability

Status: **parcial**.

- Cada capability expõe readiness mínima.
- `presentation/runtime-health.js` agrega.

Implementado agora:

- readiness mínima é derivada de `AgentHealthSnapshot.checks`.
- `sdk.resources` usa `getSdkResourceSnapshot()` para expor recursos presentes/ausentes.

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

- Extrair cost ledger.
- Extrair compaction policy.
- Extrair FSM simples.
- Extrair watchdog supervisor.
- Manter `DialogLoopManager` como orquestrador fino.

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
4. Reduzir reexports largos de `agent/index.js` em favor de facades nomeadas.
5. Começar Fase 5 pela extração de `DialogCostLedger` e `DialogCompactionPolicy`, que têm baixo
   risco e reduzem o peso do `DialogLoopManager`.

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
