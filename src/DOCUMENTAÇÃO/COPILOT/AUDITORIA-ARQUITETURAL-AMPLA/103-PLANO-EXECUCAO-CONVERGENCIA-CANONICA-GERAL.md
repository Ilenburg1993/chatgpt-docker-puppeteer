# 103 — Plano de execução para convergência canônica geral (`src/copilot`)

**Data:** 2026-05-01 **Objetivo:** executar a transição final para fluxo canônico unificado em todas
as camadas.

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
- `presentation/runtime-overview.js`, `presentation/agent-runtime.js` e `/status` do terminal já
  propagam `agentProfileId`, preparando a UX e a topologia para múltiplos runtimes/perfis sem criar
  um segundo owner operacional.

### Progresso transversal relevante desta rodada

- a normalização de `ElicitationResult` foi centralizada em `core/elicitation-schema.js`, com
  aplicação consistente em terminal, hooks da fila pendente e rota compat de resposta HTTP;
- isso reduz fluxos paralelos onde cada borda aceitava um subconjunto diferente do mesmo contrato.

---

## 3) Priorização objetiva (próximas 2 semanas)

1. **E1** (agora)
2. **E2** (seguida)
3. **E3** (em paralelo de baixo risco com E2)
4. **E4**
5. **E5**
6. **hardening operacional** (`channel/inject`, logger, fronteiras SSE/TTY)

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
- runtime headless continua funcional mesmo sem TTY vivo e o transporte `/inject` preserva erro
  semântico consistente em timeout;
- multi-runtime/multi-agent preparado com contratos e isolamento comprovado.
