# 71 — Bloco K / W86.2: checkpoint de extração de seam de teardown em lifecycle

**Data:** 2026-04-30 **Escopo de código:** `src/copilot/agent/lifecycle/agent-lifecycle.js` e novo
seam `runtime-teardown.js`

---

## 1) Objetivo da subonda

Aplicar a primeira extração concreta da W86 no eixo lifecycle para reduzir densidade semântica e
duplicação de teardown entre:

- rollback de start (`rollbackFailedAgentStart`)
- shutdown normal (`agentStop`)

---

## 2) Transformações aplicadas

### 2.1 Novo seam interno criado

- `src/copilot/agent/lifecycle/runtime-teardown.js`

Funções introduzidas:

1. `teardownRuntimeSidecars(ctx, keepaliveStopReason)`
2. `detachRuntimeObservers(ctx)`
3. `disconnectRuntimeSdkHandles(ctx, labels)`

### 2.2 Refatoração no lifecycle principal

Em `agent-lifecycle.js`, os blocos duplicados de cleanup foram substituídos por chamadas ao novo
seam:

- rollback de start passa a usar `teardownRuntimeSidecars`, `detachRuntimeObservers` e
  `disconnectRuntimeSdkHandles`;
- shutdown normal passa a usar os mesmos helpers, mantendo fluxo e contratos de ownership.

---

## 3) Impacto arquitetural esperado

1. **Menor concentração no `agent-lifecycle.js`** (menos lógica operacional repetida).
2. **Ownership explícito de teardown** em módulo dedicado de lifecycle.
3. **Base pronta para próximas extrações** (W86.3/W86.4) em dialog e boot com padrão semelhante.

---

## 4) Compatibilidade e risco

- API pública de `#copilot/agent` não foi alterada;
- sem mudança de contrato externo de start/stop;
- risco residual principal: divergência futura entre mensagens de log por contexto (mitigável com
  testes focados de comportamento).

---

## 5) Validação executada

Validação sintática dos arquivos tocados:

- `node --check src/copilot/agent/lifecycle/runtime-teardown.js`
- `node --check src/copilot/agent/lifecycle/agent-lifecycle.js`

Resultado: **sem erro de sintaxe**.

---

## 6) Próximo passo imediato

Prosseguir para W86.3 no eixo dialog (`loop-manager`) com a mesma estratégia: extrair seams internos
de decisão/controle/sinais e reduzir fan-out do orquestrador principal.
