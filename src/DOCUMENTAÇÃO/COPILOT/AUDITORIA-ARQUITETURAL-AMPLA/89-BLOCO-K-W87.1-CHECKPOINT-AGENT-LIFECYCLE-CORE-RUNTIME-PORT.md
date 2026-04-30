# 89 — W87.1: Checkpoint — agent lifecycle core-runtime port

**Data:** 2026-04-30 **Status:** concluído e validado **Escopo:**
`src/copilot/agent/lifecycle/agent-lifecycle.js`

## Síntese

A W87 foi aberta com uma redução cirúrgica dos imports diretos `agent -> core` no hotspot
`agent/lifecycle/agent-lifecycle.js`.

Antes desta etapa, o lifecycle consumia diretamente:

- `#copilot/core`;
- `../../core/di-container.js`;
- `../../core/error-handlers.js`.

Agora essas primitivas entram por `src/copilot/agent/ports/core-runtime-port.js`, uma fronteira
agent-local explícita para runtime core.

## Situação consolidada

- `core-runtime-port.js`: concentra `EVENT_BUS`, `SessionError`, `toError`, `isShuttingDown`,
  `getHubSessionId`, `setSharedSdkSessionId`, `container` e `logSwallowed`.
- `agent-lifecycle.js`: consome apenas a porta local, sem atravessar diretamente para core/container
  e error-handlers.
- `agent/ports/index.js`: exporta a nova porta para manter inventário de ports completo.

## Métrica objetiva

Hotspot analyzer antes da W87.1:

- `agent/lifecycle/agent-lifecycle.js`: score 47, fanOut 18, cross 3.

Hotspot analyzer após a W87.1:

- `agent/lifecycle/agent-lifecycle.js`: score 39, fanOut 17, cross 1.

## Contrato

`tests/unit/copilot/contracts/test_arch_contracts.spec.js` agora valida que:

- `agent-lifecycle.js` importa `../ports/core-runtime-port.js`;
- os imports diretos de `#copilot/core`, `../../core/di-container.js` e
  `../../core/error-handlers.js` ficam restritos à porta.

## Próximo passo

Continuar W87 nos demais hotspots com pressão `agent -> core/config`, priorizando
`agent/lifecycle/state-io.js`, `agent/session/snapshot.js`, `agent/session/hook-context.js` e
`agent/dialog/loop-manager.js`.
