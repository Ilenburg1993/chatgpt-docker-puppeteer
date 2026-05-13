# 103 — Plano de execução para convergência canônica geral (`src/copilot`)

**Data:** 2026-05-01 **Atualização:** 2026-05-04 **Objetivo:** executar a transição final para fluxo
canônico unificado em todas as camadas.

---

## 1) Estratégia de execução

- **Onda curta, validação contínua** (`typecheck:strict`, `lint`, `test:unit`);
- **contract-first** para impedir regressão enquanto migra;
- **uma dívida paralela por vez** (fechar PR antes de abrir novo);
- **telemetria e metadata explícita** em fallback/compat paths.

---

## 2) Backlog executivo por ondas

## Onda E1 — Governança de fronteira de fluxo (imediata)

**Meta:** bloquear reabertura de bypasss arquiteturais.

Ações:

1. criar contrato de fronteira para manter `#copilot/channel` isolado no gateway de diálogo do
   terminal;
2. reforçar regra de composição em `server/routes/sdk/*` (via `deps.js`);
3. documentar matriz de fluxos e prioridade de convergência.

Critério de pronto:

- novo contrato verde em `tests/unit/copilot/contracts/*`;
- docs 100–103 publicadas.

## Onda E2 — Convergência de fallback de runtime

**Meta:** transformar fallback implícito em fallback explícito e auditável.

Ações:

1. padronizar metadata `requestedRuntimeId/runtimeId/runtimeFound/usedDefaultRuntimeFallback` em
   todas as bordas;
2. elevar fallback silencioso a warning canônico de projection;
3. adicionar testes de regressão para fallback e runtime inexistente.

Critério de pronto:

- ausência de fallback silencioso em command/route crítico.

### Progresso atual da E2

- `presentation/runtime/models.js`, `runtime-sdk-session.js`, `runtime-tools.js` e
  `runtime-webhooks.js` já migraram para `requireAgentRuntimeSelection()`, abolindo fallback
  silencioso quando um `runtimeId` explícito não existe;
- `server/routes/sdk/deps.js` passou a usar a mesma resolução estrita, fazendo o adapter `/sdk/*`
  inteiro falhar semanticamente com `AGENT_RUNTIME_NOT_FOUND` em vez de executar contra o runtime
  default errado;
- `server/routes/sdk/middleware.js`, `session-middleware.js` e `sessions.js` foram endurecidos para
  responder `404` com metadata canônica (`requestedRuntimeId`, `runtimeFound=false`,
  `usedDefaultRuntimeFallback=false`) mesmo quando a falha acontece antes da resolução completa das
  deps da rota.
- rodada 2026-05-04: rotas auxiliares que ainda resolviam deps fora do `withErrorHandler` foram
  corrigidas em `server/routes/sdk/agent.js`, `hooks.js` e `observability.js`; `agent/tools`,
  `agent/telemetry`, `hooks/registry`, `observability/otel-status`, `observability/events/catalog` e
  `observability/events/dead-letter` agora também respondem `404 AGENT_RUNTIME_NOT_FOUND` com
  metadata canônica.
- a borda `server/routes/webhooks.js` também passou a anexar a metadata canônica de runtime ausente
  na resposta `AGENT_RUNTIME_NOT_FOUND`.

## Onda E3 — Timeline unificada de sessão/diálogo

**Meta:** reduzir dualidade `llmBridgeClient.history` vs histórico de sessão SDK.

Ações:

1. definir projection reconciliada de timeline;
2. ajustar `/now` e diagnostics para expor origem de timeline;
3. criar trilha de migração sem quebrar UX atual.

Critério de pronto:

- uma narrativa canônica de histórico por runtime.

### Progresso atual da E3

- `terminal/frontend/projections/timeline.js` criado como family canônica de reconciliação entre hub
  persistido e bridge vivo;
- `/status`, `/history`, `/context`, `/export` e `metrics` passaram a consumir metadata de timeline
  reconciliada (`timelineSource`, `timelineAuthority`, `reconciliationStatus`) em vez de depender
  implicitamente do feed cru do bridge;
- `frontend/index.js` deixou de reexportar helpers crus do bridge history, reduzindo o bypass
  público e forçando consumo por projection.
- rodada 2026-05-04, segunda transformação: `bridge_only` e `bridge_tail` agora são materializados
  no Conversation Hub por sync lazy a partir da projection canônica, com dedupe por assinatura,
  metadata `terminal.timeline_sync` e estado operacional exposto em `/status`, `/now`, `/history`,
  `/context` e `/export`.
- rodada 2026-05-04, terceira transformação: o sync lazy ganhou retry por turno, retentativa
  lifecycle pós-falha, TTL/limite de cache, gauges/counters e exposição em `/metrics`; E3 não possui
  resíduo operacional conhecido.

## Onda E4 — Redução de compat paths

**Meta:** reduzir caminhos paralelos controlados.

Ações:

1. migrar os consumers remanescentes de setters locais para DI pura quando isso não romper
   isolamento de camada;
2. reduzir o uso de overrides mutáveis de composição fora de testes;
3. consolidar política PM2/compat entrypoint com guardrails de execução única.

Critério de pronto:

### Progresso atual da E4

`presentation/` em rotas raiz; canônico; import;

- `runtime-legacy-compat.js`, `observability/bootstrap-legacy.js`, `server/handler-bridge.js`,
  `boot/compat-entrypoint.js` e o processo PM2 `copilot-sdk-agent` foram removidos.
  - rotas raiz não podem recriar shim paralelo ao `presentation-route.js`;
  - `wireLegacySetters` não deve reaparecer no runtime.
- no terminal, `agent-sse-fallback.js` foi substituído por `agent-sse-passthrough.js`, reduzindo o
  fluxo residual a uma allowlist explícita de eventos raw ainda sem adapter dedicado;
- no terminal, o hotspot `terminal-phases/boot-listeners.js` foi fatiado em `boot-banner.js`,
  `boot-reflection-loop.js` e `boot-shutdown.js`, reduzindo acoplamento entre política de boot e
  wiring vivo.
- no canal LLM-A ↔ LLM-B, o contrato de timeout do `channel/inject.js` foi endurecido para tratar
  HTTP `408/504` como timeout canônico em vez de `invalid response`;
- rodada 2026-05-05: a policy de timeout do inject foi centralizada em
  `core/dialog-timeout-policy.js`, removendo drift entre `channel`, `presentation` e `terminal`;
- o fluxo `/inject` passou a aceitar watchdog-only (`timeout=0/null`) ponta a ponta, com
  diagnósticos estruturados de `preflight/context/attachments/dialog` e sinais de `autoStarted` /
  `recoveredInputChannel` vindos de `runtime-dialog.js`;
- o histórico operacional do inject agora filtra o último evento por `runtimeId`, evitando que
  `/metrics` de um runtime apresente telemetria do inject executado em outro runtime;
- `observability/logger.js` passou a tratar stdout/stderr quebrados como detalhe operacional da
  borda, não como falha fatal do runtime.

## Onda E5 — Multi-runtime/multi-agent readiness

**Meta:** estruturar base de expansão futura.

Ações:

1. reforçar isolamento por `runtimeId` em concorrência/stream/rate-limiter;
2. introduzir metadata de `agentProfileId` por runtime;
3. preparar contratos de capabilities por profile.

Critério de pronto:

- runtimes múltiplos e profiles preparados sem quebrar default runtime.

### Progresso atual da E5

- `agent/runtime-registry.js` passou a aceitar metadata opcional `agentProfileId` por runtime, sem
  quebrar a API atual baseada em `runtimeId`;
- o runtime default lazy agora se registra explicitamente com profile `always-alive`;
- `presentation/runtime/overview.js`, `presentation/agent-runtime.js` e `/status` do terminal já
  propagam `agentProfileId`, preparando a UX e a topologia para múltiplos runtimes/perfis sem criar
  um segundo owner operacional.

## Onda E6 — Convergência canônica do system prompt

**Meta:** estabelecer fluxo único e configurável para instruções do SDK, com barrels puros e
auto-reload compatível.

Ações:

1. tornar `config/system-prompt/index.js` barrel puro;
2. mudar o default de `replace` para `append`;
3. introduzir config declarativa do usuário (`env` + `system-prompt.json` + arquivos append);
4. usar `buildLiveSystemMessage()` nas sessões do agent com `SectionTransformFn` para recarga
   automática de `append/customize`;
5. expor introspecção de `session.instructions.getSources()` para auditoria e diagnose;
6. documentar explicitamente a limitação residual de `replace` em sessão viva.

Critério de pronto:

- append-first canônico e testado;
- barrel puro sem lógica operacional;
- sessões novas e retomadas sempre carregam instruções atuais;
- edições em `sections/*.js` e arquivos append do usuário passam a refletir na próxima avaliação de
  transform do SDK.

### Progresso transversal relevante desta rodada

- a normalização de `ElicitationResult` foi centralizada em `core/elicitation-schema.js`, com
  aplicação consistente em terminal, hooks da fila pendente e rota compat de resposta HTTP;
- isso reduz fluxos paralelos onde cada borda aceitava um subconjunto diferente do mesmo contrato.
- a auditoria exploratória de 2026-05-04 achou e corrigiu bugs de borda: algumas rotas SDK de
  leitura (`agent`, `hooks`, `observability`) escapavam da projeção canônica de erro ao receber
  `runtimeId` inexistente, e `webhooks` devolvia 404 sem a metadata de targeting. A correção fechou
  esses gaps e adicionou testes focais em `test_sdk_runtime_targeting_strict_routes.spec.js` e
  `test_webhooks_routes.spec.js`.
- rodada system-prompt 2026-05-04: `config/system-prompt` foi refatorado em registry/builders/live
  builders/user-config/sdk-introspection; `buildLiveSystemMessage()` agora usa transforms do SDK
  para recarregar seções e customizações locais; `initializer.js` passou a consumir esse builder
  vivo; o default mudou para `append` e `index.js` virou barrel puro. O residual reconhecido é
  apenas `mode:'replace'` sem live-set RPC nativo do SDK.

---

## 3) Priorização objetiva (próximas 2 semanas)

1. **W125/W129 — passthrough SSE**: transformar allowlist residual em adapters ou ignores
   declarativos;
2. **W129/E2 residual**: manter fallback apenas em projections informativas com warning explícito;
3. **E5 — multi-runtime/multi-agent readiness**: isolar stream/rate-limit por runtime em contratos
   adicionais;
4. **E6 residual — system prompt replace**: decidir se a mitigação final será resume automático,
   recreação explícita da sessão ou sunset do `replace` vivo;
5. **Hotspots estruturais**: decompor handlers grandes sem alterar semântica já estabilizada.

---

## 4) Execução iniciada nesta rodada

- investigação profunda transversal concluída;
- mapeamento e matriz de fluxos publicados (docs 100/101);
- TO-BE unificado publicado (doc 102);
- plano executivo detalhado publicado (doc 103);
- onda E1 iniciada com criação de contrato arquitetural novo (ver
  `tests/unit/copilot/contracts/test_canonical_flow_governance.spec.js`);
- onda E4 iniciada com migração do adapter HTTP raiz para `server/routes/presentation-route.js`.

---

## 5) Gate de validação por onda

Comandos obrigatórios por merge de onda:

```bash
npm run typecheck:strict
npm run lint
npm run test:unit
```

Recomendado durante execução incremental:

```bash
npx vitest run tests/unit/copilot/contracts/*.spec.js
```

---

## 6) Definição de sucesso

O plano está completo quando:

- todos os fluxos críticos operam em caminho canônico único;
- paralelos PR = 0;
- paralelos PC com sunset explícito;
- barrels `index.js` permanecem puros (imports/exports/JSDoc/tipagem), com toda lógica deslocada
  para módulos semânticos próprios;
- runtime headless continua funcional mesmo sem TTY vivo e o transporte `/inject` preserva erro
  semântico consistente em timeout;
- multi-runtime/multi-agent preparado com contratos e isolamento comprovado.
