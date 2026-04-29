# 49 — Mapeamento `AlwaysAliveAgent` vs runtime governance/capabilities

**Data:** 2026-04-28
**Escopo:** `src/copilot/agent/always-alive.js`, `agent/facades/agent-runtime-controls.js`,
contratos de seams e testes unitários.

---

## Objetivo

Continuar a purificação estrutural do `AlwaysAliveAgent`, removendo acoplamento direto a
`AgentContext` no eixo de:

- modo de permissão (`permission mode`);
- snapshots de capability de permissões/factories;
- snapshots do registry de tools.

---

## Transformações aplicadas

### 1) Façade de governança/capabilities no runtime

`agent/facades/agent-runtime-controls.js` passou a expor funções canônicas para esse eixo:

- `readRuntimeGovernanceState(runtime)`
- `readRuntimePermissionMode(runtime)`
- `setRuntimePermissionMode(runtime, mode, opts)`
- `readRuntimePermissionCapability(runtime)`
- `readRuntimeContextFactoryCapabilities(runtime)`
- `readRuntimeToolRegistry(runtime)`
- `readRuntimeToolRegistryEntries(runtime)`

Com isso, status/interação **e** governança/capabilities passam a morar na mesma superfície
semântica do runtime-controls.

### 2) `AlwaysAliveAgent` deixa de tocar `ctx` diretamente nesse eixo

`agent/always-alive.js` passou a delegar:

- `getPermissionMode()` → `readRuntimePermissionMode(this.ctx)`
- `setPermissionMode(...)` → `setRuntimePermissionMode(this.ctx, ...)`
- `getPermissionCapabilitySnapshot()` → `readRuntimePermissionCapability(this.ctx)`
- `getContextFactoryCapabilitiesSnapshot()` → `readRuntimeContextFactoryCapabilities(this.ctx)`
- `getToolRegistrySnapshot()` → `readRuntimeToolRegistry(this.ctx)`
- `getToolRegistryEntriesSnapshot()` → `readRuntimeToolRegistryEntries(this.ctx)`

---

## Guardrails estruturais

### 3) Nova regra de seam oficial

`scripts/check-copilot-official-seams.mjs` recebeu:

- `always-alive-must-not-touch-ctx-runtime-governance-directly`

Bloqueia regressões de chamadas diretas a:

- `this.ctx.getPermissionModeSnapshot()`
- `this.ctx.setPermissionMode(...)`
- `this.ctx.getPermissionCapabilitySnapshot()`
- `this.ctx.getContextFactoryCapabilitiesSnapshot()`
- `this.ctx.getToolRegistrySnapshot()`
- `this.ctx.getToolRegistryEntriesSnapshot()`

---

## Testes e contratos

### 4) Cobertura unitária/façade

`tests/unit/copilot/test_agent_runtime_controls.spec.js` foi ampliado para validar:

- leitura agregada de governança/capabilities;
- wrappers dedicados de permission/capabilities/registry;
- delegação de `setRuntimePermissionMode(...)`.

### 5) Contratos do Bloco B atualizados

- `tests/unit/copilot/test_always_alive_delegation.spec.js`
- `tests/unit/copilot/contracts/test_lifecycle_boundary_block_b.spec.js`

Ambos passam a congelar que esse eixo não pode voltar a chamar `ctx` diretamente em
`AlwaysAliveAgent`.

---

## Leitura arquitetural

Este checkpoint reforça a direção já estabelecida:

- `AlwaysAliveAgent` como orquestrador de intenção;
- `agent-runtime-controls` como owner de leitura/controle semântico do runtime;
- `AgentContext` preservado como composition root interno, mas não como API primária para
  consumidores de alto nível.

Em termos de roadmap, acelera principalmente as frentes **W18/W21**, reduzindo difusão de ownership
no runtime principal.
