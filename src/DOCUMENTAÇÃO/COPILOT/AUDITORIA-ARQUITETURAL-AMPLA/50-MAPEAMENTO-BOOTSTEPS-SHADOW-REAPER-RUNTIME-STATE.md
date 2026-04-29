# 50 — Mapeamento `boot-steps` vs shadow reaper em `runtime-state`

**Data:** 2026-04-28 **Escopo:** `agent/session/boot-steps.js`,
`agent/facades/agent-runtime-state.js`, seams e testes focados.

---

## Objetivo

Remover decisão crua de reaper da `pendingQuestionShadow` de dentro de `boot-steps.js`, delegando a
leitura de estado para uma façade semântica de runtime.

---

## Transformação aplicada

### 1) Nova decisão semântica no runtime-state

`agent/facades/agent-runtime-state.js` agora expõe:

- `shouldReapAgentRuntimePendingQuestionShadow(ctx)`

Regra consolidada pela façade:

- só pode reap quando **não** existe pergunta viva;
- existe shadow restaurada;
- shadow está expirada.

### 2) `boot-steps.js` deixa de inspecionar `ctx` diretamente para esse eixo

`reapExpiredPendingQuestionShadow(ctx)` passou de:

- `ctx.hasPendingQuestion()`
- `ctx.hasPendingQuestionShadow()`
- `ctx.isPendingQuestionShadowExpired()`

para:

- `shouldReapAgentRuntimePendingQuestionShadow(ctx)`

mantendo a limpeza efetiva via `clearAgentRuntimePendingQuestionShadow(...)`.

---

## Guardrails e contratos

### 3) Nova regra de seam

`scripts/check-copilot-official-seams.mjs` recebeu:

- `boot-steps-must-not-check-shadow-reaper-state-directly`

Bloqueia regressão para uso direto de:

- `ctx.hasPendingQuestion(...)`
- `ctx.hasPendingQuestionShadow(...)`
- `ctx.isPendingQuestionShadowExpired(...)`

### 4) Contratos atualizados

`tests/unit/copilot/contracts/test_lifecycle_boundary_block_b.spec.js` passa a exigir:

- uso explícito de `shouldReapAgentRuntimePendingQuestionShadow(...)` em `boot-steps`;
- ausência de inspeção crua de `ctx` para o reaper.

---

## Testes focados

- `tests/unit/copilot/test_agent_runtime_state.spec.js`
  - cobertura da função `shouldReapAgentRuntimePendingQuestionShadow(...)`;
- `tests/unit/copilot/test_boot_steps_shadow_reaper.spec.js`
  - valida delegação da decisão para façade;
- `tests/unit/copilot/test_agent_runtime_controls.spec.js`
- `tests/unit/copilot/test_always_alive_delegation.spec.js`
- `tests/unit/copilot/contracts/test_lifecycle_boundary_block_b.spec.js`

Lote consolidado da subonda: **37/37 testes verdes**.

---

## Leitura arquitetural

Este checkpoint continua a linha de purificação do runtime:

- `boot-steps` fica mais próximo de orquestração;
- `agent-runtime-state` absorve a regra semântica de estado persistido/derivado;
- regras de seam tornam a regressão observável automaticamente.
