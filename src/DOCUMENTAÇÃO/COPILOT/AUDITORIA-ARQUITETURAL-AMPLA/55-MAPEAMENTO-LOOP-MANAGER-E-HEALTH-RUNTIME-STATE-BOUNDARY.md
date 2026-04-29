# 55 — Mapeamento: `loop-manager` e `health-check` convergidos para boundaries semânticos de runtime-state

**Data**: 2026-04-29 **Escopo**: `src/copilot/agent/dialog/loop-manager.js`,
`src/copilot/agent/health-check.js`, `src/copilot/agent/facades/*`

---

## Objetivo da subonda

Reduzir leitura/escrita crua de estado em módulos centrais do runtime do agent, deslocando
responsabilidades para façades semânticas.

---

## Transformações aplicadas

### 1) `DialogLoopManager` sem dependência direta de `state-io`

Foi removido o acesso direto a `readState`, `readStateAsync` e `persistStateWithPolicy` dentro do
loop manager.

A lógica foi movida para a fronteira canônica `agent/facades/agent-runtime-state.js` com três novas
capabilities:

- `readAgentRuntimeDialogBootstrapState()`
- `readAgentRuntimeDialogPersistedState()`
- `persistAgentRuntimeDialogState(partial, label)`

Com isso, o `loop-manager` passa a decidir **intenção operacional** (quando
pausar/retomar/persistir) sem decidir **mecânica de armazenamento**.

### 2) `health-check` sem leitura espalhada de `AgentContext`

Foi criada a façade:

- `agent/facades/agent-health-access.js`

com a capability:

- `readAgentHealthInputSnapshot(ctx, host)`

`health-check.js` agora consome um snapshot agregado de sinais (runtime, dialog, queue, IO, quota,
background, boot, SDK resources) em vez de acessar o contexto cru em múltiplos pontos.

---

## Resultado arquitetural

### Delimitação reforçada

- `dialog/loop-manager` ficou mais próximo de orquestração de protocolo/ciclo.
- `health-check` ficou mais próximo de avaliação de risco/recomendação.
- `facades/` passou a centralizar leituras/escritas de estado de runtime e coleta de sinais de
  health.

### Benefícios imediatos

- menor acoplamento estrutural com `state-io`;
- redução do espalhamento de chamadas em `ctx` para health;
- menor risco de drift de comportamento em novos consumers;
- seam mais clara para evolução futura de storage e telemetria de health.

---

## Validação executada

- testes unitários focados ✅
  - `tests/unit/copilot/test_agent_runtime_state.spec.js`
  - `tests/unit/copilot/test_loop_manager.spec.js`
  - `tests/unit/copilot/test_agent_health_check.spec.js`
  - `tests/unit/copilot/test_session_cleanup.spec.js`
  - `tests/unit/copilot/config/test_faixa_c_session_config_builder.spec.js`
  - `tests/unit/copilot/test_sdk_route_session_ownership.spec.js`
- `npm run typecheck:strict:src.copilot` ✅
- eslint focado dos arquivos tocados ✅
- prettier check/write dos arquivos tocados ✅

---

## Próximos passos recomendados

1. avançar na convergência de `agent/dialog/turn-executor.js` para a mesma fronteira semântica de
   runtime-state;
2. promover snapshot de health para uma DTO canônica compartilhável com
   `presentation/runtime-status`;
3. reduzir dependências cruzadas em `sdk/models/*` e `sdk/session/lifecycle.js` (singleton/model
   resolution).
