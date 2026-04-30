# 88 — W86.8: Checkpoint — dialog boot lifecycle seam

**Data:** 2026-04-30 **Status:** concluído e validado **Escopo:**
`src/copilot/agent/dialog/loop-manager.js`

## Síntese

A W86.8 decompôs o eixo de boot do `DialogLoopManager`, que ainda concentrava boot prompt, espera
por `READY`, recuperação de `READY` tardio, emissão de timeout, fallback de modelo, circuit breaker
anti-storm e contabilidade de PR no mesmo arquivo.

## Situação consolidada

- `loop-boot-runner.js`: owner do fluxo operacional de boot do dialog loop.
- `loop-boot-circuit.js`: owner do circuit breaker local contra storms de boot/retry.
- `loop-manager.js`: permanece como API pública e orquestrador de alto nível do loop, sem conhecer
  detalhes de `waitForAgentSdkEvent()`, `sendMessageDialogBoot()` ou janela móvel de falhas.

## Métrica objetiva

- `loop-manager.js`: 829 LOC antes da W86.8.
- `loop-manager.js`: 653 LOC após a W86.8.
- Redução direta: 176 LOC de lógica operacional removida do hotspot principal.

## Correções e hardening

- O fallback para `host.sendMessage()` ficou isolado no runner de boot, preservando
  `sendMessageDialogBoot()` como caminho preferencial.
- O circuito de boot passou a ter classe dedicada e testável, reduzindo estado privado acumulado no
  manager.
- O contrato arquitetural agora impede regressão para `waitForAgentSdkEvent()` e constantes de
  circuit breaker inline dentro do manager.

## Validação

- `npm run typecheck:strict:src.copilot`
- `npx vitest run tests/unit/copilot/test_loop_manager.spec.js tests/unit/copilot/test_always_alive_dialog_loop.spec.js`

## Próximo passo

Abrir W87 com redução de imports diretos `agent -> core/config`, começando pelos hotspots ainda
apontados pelo script de análise: `agent/lifecycle/agent-lifecycle.js`,
`agent/lifecycle/state-io.js`, `agent/ports/hook-port.js` e seams de `session/*`.
