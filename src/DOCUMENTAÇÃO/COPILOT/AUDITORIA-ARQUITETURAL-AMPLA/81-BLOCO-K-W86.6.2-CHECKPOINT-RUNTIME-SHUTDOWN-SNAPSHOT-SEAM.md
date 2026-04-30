# 81 — Bloco K / W86.6.2: checkpoint de extração do `runtime/shutdown-snapshot-state`

**Data:** 2026-04-30 **Escopo:** `agent-runtime-state` + `agent/runtime/shutdown-snapshot-state`

---

## 1) Objetivo da subonda

Avançar a decomposição da façade `agent-runtime-state`, removendo o eixo de snapshot/shutdown
gracioso para sub-seam dedicado.

---

## 2) Transformações aplicadas

### 2.1 Novo sub-seam criado

- `src/copilot/agent/runtime/shutdown-snapshot-state.js`

Operações extraídas:

- `resetAgentRuntimeGracefulShutdownFlag`
- `persistAgentRuntimePrConsumptionSnapshot`
- `saveAgentRuntimeShutdownSnapshot`
- `persistAgentRuntimeGracefulShutdownState`

### 2.2 Façade preservada com delegação

`src/copilot/agent/facades/agent-runtime-state.js` manteve a surface pública e passou a delegar o
eixo shutdown/snapshot para o sub-seam novo.

### 2.3 Contrato anti-regressão

`tests/unit/copilot/contracts/test_arch_contracts.spec.js` recebeu regra W86.6.2 exigindo presença
explícita da delegação para `runtime/shutdown-snapshot-state`.

---

## 3) Critérios de conclusão (validados)

### Critério W86.6.2-A — separação semântica

- [x] operações de snapshot/shutdown extraídas da implementação central da façade.

### Critério W86.6.2-B — compatibilidade

- [x] API pública preservada (sem breaking change para consumidores).

### Critério W86.6.2-C — anti-regressão executável

- [x] contrato W86.6.2 adicionado no `test_arch_contracts`.

### Critério W86.6.2-D — integridade mínima

- [x] `node --check` verde em:
  - `agent/runtime/dialog-runtime-state.js`
  - `agent/runtime/shutdown-snapshot-state.js`
  - `agent/facades/agent-runtime-state.js`
  - `tests/unit/copilot/contracts/test_arch_contracts.spec.js`

---

## 4) Leitura arquitetural

Com W86.6.1 + W86.6.2, a façade `agent-runtime-state` entra em fase clara de transição de “owner
central de tudo” para “gateway estável” sobre sub-seams especializados, reduzindo custo de
manutenção e risco de regressão por acoplamento interno.

---

## 5) Próximo passo contínuo

Abrir **W86.6.3** para extrair sessão-id/status bootstrap fallback (`readAgentRuntimeSessionId` +
leituras persistidas básicas) e fechar a rodada de decomposição primária da façade.
