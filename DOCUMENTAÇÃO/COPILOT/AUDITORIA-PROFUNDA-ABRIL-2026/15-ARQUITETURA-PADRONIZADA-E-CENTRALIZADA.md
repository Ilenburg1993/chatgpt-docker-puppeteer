# 15 — Arquitetura Padronizada e Centralizada (Proposta v3)

**Auditoria Profunda de `src/copilot`** · Abril 2026 **Escopo**: `sdk/`, `event-handlers/`,
`agent/`, `presentation/`, `terminal/`, `observability/` **Status**: proposta arquitetural canônica
com primeira implementação já iniciada (P1/P2 entregues; P3 parcial)

> Atualização adicional: a arquitetura já passou de “multi-agent-ready” para um primeiro estado
> **multi-agent-path-enabled** nas bordas HTTP, com resolução explícita de `runtimeId` por request
> em `copilot-api`, `/sdk`, `health/agent` e `webhooks`.

> Atualização complementar: o targeting de `runtimeId` também já passou a usar uma semântica
> compartilhada única entre HTTP, REPL e accessors (`presentation/runtime-targeting.js`), reduzindo
> deriva de normalização entre bordas.

---

## 1. Objetivo

Este documento responde a uma pergunta estrutural importante:

> **qual é o fluxo mais padronizado e centralizado para que `sdk`, `agent`, `terminal`,
> `presentation` e `observability` deixem de parecer um conjunto de caminhos concorrentes?**

Também responde às dúvidas derivadas:

- tudo deveria passar pelo `agent` antes de chegar ao `terminal`?
- como preparar o código para mais de um agent no futuro?
- onde devem viver os módulos compartilhados?
- como evitar que `terminal/` e `server/` reinterpretem o SDK por conta própria?

---

## 2. Resposta curta

### 2.1 Sim: tudo que for **runtime/session/capability do SDK** deve passar pelo `agent`

Se a informação ou operação nasce de:

- `CopilotClient`
- `CopilotSession`
- `session RPC`
- `server RPC`
- `SessionEvent`
- `mode/plan`
- `usage/streaming/tool execution`

então o caminho ideal é:

```text
sdk/ -> event-handlers/ -> agent/ -> presentation/ ou terminal/
```

O terminal não deve reinterpretar o SDK diretamente quando já existe um runtime contínuo
(`AlwaysAliveAgent`) no meio.

### 2.2 Não: nem tudo do sistema precisa passar pelo `agent`

Existem subsistemas que **não são propriedade do agent**:

- `conversation-hub/`
- partes do `channel/`
- concerns puros de `observability/`
- concerns puros de UI/REPL do terminal

Nesses casos, o `agent` não deve virar um “God Object”.

A regra correta é:

> **tudo que for sessão/runtime do SDK passa pelo agent; tudo que for compartilhado entre bordas
> passa por `presentation/`; tudo que for exclusivamente de uma borda fica na própria borda.**

### 2.3 Critério operacional de fronteira: `agent` vs `presentation`

Quando houver dúvida entre `agent/` e `presentation/`, a regra ideal agora fica assim:

| Se o problema é…                                             | Camada correta    |
| ------------------------------------------------------------ | ----------------- |
| source-of-truth de sessão, dialog loop, reconnect, state     | `agent/`          |
| capability pública do runtime ou façade estratégica do SDK   | `agent/facades/`  |
| seleção compartilhada de `runtimeId`                         | `presentation/`   |
| payload/status/health/session compartilhado entre bordas     | `presentation/`   |
| composição de deps de router / request parsing compartilhado | `presentation/`   |
| prompt/render/comandos/UX local                              | `terminal/`       |
| tradução de `SessionEvent` cru                               | `event-handlers/` |
| coleta/log/métrica/tracing                                   | `observability/`  |

Se a resposta for “isso precisa ser igual em `server/` e `terminal/`”, a chance alta é que deva
nascer em `presentation/`, não em `agent/`.

---

## 3. Situação ideal v3

## 3.1 Fluxo canônico

```text
@github/copilot-sdk
  -> src/copilot/sdk/                    # wrappers e contratos vanilla
    -> src/copilot/event-handlers/       # tradução SessionEvent -> sinais internos
      -> src/copilot/agent/              # runtime contínuo + estado + facades
        -> src/copilot/presentation/     # projeções compartilhadas de borda
          -> src/copilot/terminal/       # REPL / SSE / UX local
          -> src/copilot/server/         # HTTP / routes / sockets

Em paralelo:
agent/presentation outputs
  -> src/copilot/observability/          # logs, métricas, tracing, audit
```

---

## 3.2 Regras por camada

### `sdk/`

É a fonte canônica de toda capability vanilla.

### `event-handlers/`

É a única camada autorizada a traduzir `SessionEvent` cru para sinais internos estáveis.

### `agent/`

É o dono do runtime contínuo.

Deve ser o único lugar com autoridade sobre:

- sessão ativa do SDK;
- reconnect;
- dialog loop;
- pending question / ask_user;
- boot / shutdown / health;
- facades públicas do runtime.

### `presentation/`

É o lugar único dos **compartilhados de borda**.

Tudo que `terminal/` e `server/` consomem em comum deve preferir viver aqui.

### `terminal/`

É apenas consumidor da verdade do runtime.

Pode ter:

- prompt / render / waiting UX;
- comandos REPL;
- state puramente local da borda;
- SSE e narrativa operacional.

Mas não deve se comportar como “segunda fonte de verdade” do SDK.

---

## 3.3 Multi-agent futuro

A arquitetura atual já melhorou bastante, mas ainda carrega a suposição implícita de **um único
runtime default**.

A situação ideal v3 deve introduzir explicitamente:

### `AgentRuntimeRegistry`

Responsabilidades:

- registrar runtimes de agent por `runtimeId`;
- expor um runtime default;
- permitir listagem/lookup por id;
- evitar que bordas precisem assumir que só existe um agent.

Exemplo conceitual:

```text
agent/runtime-registry.js
  default -> AlwaysAliveAgent
  audit   -> AuditAgentRuntime (futuro)
  diag    -> DiagnosticAgentRuntime (futuro)
```

### Regra de consumo

- código legado compatível continua usando o runtime default;
- novas bordas e módulos compartilhados usam a registry;
- `getAgent()` vira sugar para “obter runtime default”.

---

## 3.4 Shared centralizado

A dúvida “os compartilhados não deveriam ter um lugar único?” tem resposta: **sim**.

Esse lugar deve ser `presentation/`, não `terminal/` e não `agent/`.

### O que deve ir para `presentation/`

- projections compartilhadas de runtime;
- handlers compartilhados de config/metrics/health;
- accessors compartilhados para o runtime default;
- formatos/resumos que são usados por `server` e `terminal` ao mesmo tempo.

### O que não deve ir para `presentation/`

- estado interno do agent;
- tradução de `SessionEvent` cru;
- lógica específica de REPL;
- lógica específica de rota HTTP.

---

## 4. Problemas do estado atual

Os principais pontos que ainda causam confusão são:

1. `terminal/frontend/` ainda conhece mais do runtime do agent do que deveria em alguns pontos;
2. `presentation/` ainda não é o hub único de acesso compartilhado ao runtime default;
3. o singleton lazy do agent existe, mas ainda não há uma registry explícita de runtimes;
4. alguns módulos compartilham semântica via imports diretos onde uma projection/shared facade seria
   mais clara;
5. a documentação já melhorou, mas ainda não estava respondendo explicitamente às perguntas sobre
   multi-agent e centralização.

---

## 5. Proposta prática por fases

## Fase P1 — Registry do runtime

Criar `agent/runtime-registry.js`.

### Objetivo

Desacoplar o runtime default da ideia de que o sistema sempre terá um único agent.

### Estado atual

Entregue:

- `src/copilot/agent/runtime-registry.js` criado como SSOT dos runtimes registrados;
- `always-alive.js` já registra/desregistra o runtime default lazy nessa registry;
- `agent/index.js` já expõe a registry como parte da API pública do módulo.

---

## Fase P2 — Accessor compartilhado do runtime default

Criar `presentation/agent-runtime.js`.

### Objetivo

Fornecer um lugar único para bordas consumirem:

- runtime default;
- snapshot/health/identity do runtime;
- futuras seleções por `runtimeId`.

### Estado atual

Entregue:

- `src/copilot/presentation/agent-runtime.js` criado como accessor compartilhado do runtime default;
- `src/copilot/presentation/runtime-controls.js` criado como façade de mutações/controles do runtime
  default;
- `src/copilot/presentation/runtime-health.js` criado como projection compartilhada de health do
  runtime;
- `src/copilot/presentation/runtime-ownership.js` criado como façade do vínculo SDK↔hub;
- `src/copilot/presentation/runtime-overview.js` criado como projection base compartilhada
  (`snap/health/runtimeId`);
- `src/copilot/presentation/runtime-status.js` criado como payload layer compartilhada para
  `/status`, `/session` e SSE `connected`;
- `src/copilot/presentation/runtime-route-deps.js` criado para compor deps compartilhadas de routers
  do `server/`;
- `src/copilot/presentation/runtime-request.js` criado para resolver `runtimeId` e deps por
  requisição HTTP;
- `src/copilot/presentation/runtime-targeting.js` criado para centralizar trim/empty/fallback de
  `runtimeId` entre HTTP, REPL e accessors;
- `src/copilot/server/handler-bridge.js` agora também propaga `runtimeId` canônico para handlers
  compartilhados legados, preservando-o mesmo quando há `paramsExtractor` customizado;
- `src/copilot/presentation/runtime-webhooks.js` criado para centralizar operações administrativas
  de webhook;
- `src/copilot/presentation/runtime-ui-state.js` e `src/copilot/presentation/runtime-dialog.js`
  criados para concentrar o boundary ainda necessário com `terminal/*`;
- `src/copilot/agent/facades/agent-dialog-runtime.js` criado para concentrar a capability de diálogo
  runtime (`start/send/stop`) entre `presentation/`, `channel/` e `conversation-hub`;
- `system-config.js`, `system-metrics.js`, `agent-control.js` e `terminal/frontend/llm-b-runtime.js`
  já passaram a consumi-lo;
- `server/routes/copilot-api/control.js`, `server/routes/copilot-api/stream.js` e
  `server/routes/sdk/observability.js` já deixaram de montar snapshots ad hoc em pontos críticos;
- `server/routes/health.js` e `server/routes/health-registry.js` já migraram para a camada
  compartilhada de health;
- `server/routes/copilot-api/dialog.js`, `server/routes/webhooks.js`, `server/routes/sdk/index.js` e
  `server/routes/copilot-api/index.js` já consomem a camada compartilhada em vez de
  chamar/runtime-compor diretamente;
- `server/routes/copilot-api/*` e `server/routes/sdk/*` mais críticos já aceitam seleção explícita
  de runtime por `query/header/body/params`, preservando o default quando nenhum `runtimeId` é
  informado;
- `/status`, `/session`, SSE `connected`, `/health/agent` e `/webhooks` já conseguem sinalizar
  também quando houve fallback para o runtime default após pedido de `runtimeId` inexistente;
- `presentation/system-metrics.js` e `presentation/agent-control.js` também já aceitam `runtimeId`
  explícito via `handler-bridge`, permitindo que rotas legadas (`server/routes/agent.js`,
  `server/routes/observability.js`) entrem no mesmo caminho canônico;
- `terminal/frontend/llm-b-runtime.js` e `terminal/frontend/llm-b-frontend.js` também já aceitam
  `runtimeId` explícito nos principais caminhos compartilhados de inspeção/controle do runtime, sem
  perder o fallback local para o runtime default;
- health/config compartilhados já expõem `runtimeId` e `agentRuntimes`.

---

## Fase P3 — Terminal como consumidor mais fino

Migrar `terminal/frontend/` e projections compartilhadas para consumir
`presentation/agent-runtime.js` em vez de depender diretamente de `getAgent()` sempre que fizer
sentido.

### Objetivo

Deixar explícito:

- o que é acesso canônico compartilhado ao runtime;
- o que é consumo puramente do terminal.

### Estado atual

Parcialmente entregue:

- `terminal/frontend/llm-b-runtime.js` já consome o runtime via `presentation/agent-runtime.js`;
- `terminal/frontend/llm-b-frontend.js` já consome `presentation/runtime-overview.js` como base
  canônica do runtime;
- a identidade do runtime default já aparece nas projections compartilhadas e no frontend do
  terminal;
- `/status` e `/diagnose` já expõem `runtimeId` e a lista de `agentRuntimes`, preparando
  troubleshooting multi-agent;
- `presentation/system-config.js`, `presentation/system-metrics.js` e
  `presentation/agent-control.js` já deixaram de importar `terminal/*` diretamente, usando as novas
  façades locais;
- `presentation/` zerou imports diretos de `terminal/*` e os módulos antigos do terminal viraram
  apenas shims compatíveis (`terminal/state.js`, `terminal/file-context.js`);
- ainda restam pontos do terminal que podem ser afinados para depender menos da topologia do
  runtime.

---

## Fase P4 — Observability como consumidor puro

Refinar a narrativa de `observability/` para que ela consuma sinais estabilizados e projections,
evitando acoplamento desnecessário ao runtime interno.

---

## 6. Done criteria da proposta v3

A arquitetura pode ser considerada mais padronizada e centralizada quando:

1. toda capability vanilla do SDK entrar por `sdk/` e `event-handlers/` antes de chegar às bordas;
2. `agent/` for claramente o único dono do runtime da sessão SDK;
3. `presentation/` virar o hub único das projeções compartilhadas entre bordas;
4. existir uma `AgentRuntimeRegistry` explícita para preparar multi-agent sem quebrar o singleton
   atual;
5. `terminal/` consumir o runtime via acessos canônicos mais claros e não como “segunda camada de
   orquestração”;
6. a documentação ativa responder sem ambiguidade:
   - quem é dono do quê;
   - por onde cada dado passa;
   - onde uma feature nova deve nascer.

### Status atualizado desta frente

Após a onda atual, os desvios distribuídos mais críticos já foram removidos:

- `presentation -> terminal/*` zerado;
- `server/routes/*` deixou de compor/reabrir runtime em múltiplos pontos;
- `dialog runtime capability` foi centralizada em `agent/facades/agent-dialog-runtime.js`;
- a transparência de fallback multi-runtime agora também atravessa payloads HTTP/SSE e parte
  relevante da UX local;
- o que resta agora é majoritariamente refinamento de **fronteiras canônicas**, não bypass
  estrutural real.

---

## 7. Conclusão

A melhor resposta para o estado atual não é “passar absolutamente tudo pelo agent”.

A melhor resposta é:

> **passar tudo que for runtime/session do SDK pelo agent; passar tudo que for compartilhado de
> borda por `presentation/`; e manter cada borda responsável apenas pela sua UX/protocolo final.**

Esse desenho preserva:

- compatibilidade com o SDK vanilla;
- clareza de fluxo;
- espaço para multi-agent futuro;
- menos confusão entre runtime, shared projections e UX local.
