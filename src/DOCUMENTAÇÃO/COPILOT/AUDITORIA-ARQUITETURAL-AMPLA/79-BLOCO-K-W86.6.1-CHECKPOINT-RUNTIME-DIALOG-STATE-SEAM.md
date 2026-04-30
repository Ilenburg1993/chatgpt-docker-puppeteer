# 79 — Bloco K / W86.6.1: checkpoint de extração do `runtime/dialog-runtime-state`

**Data:** 2026-04-30 **Escopo:** `agent-runtime-state` + `agent/runtime/dialog-runtime-state`

---

## 1) Objetivo da subonda

Continuar a decomposição da façade `agent-runtime-state`, extraindo o domínio de bootstrap/recovery
do dialog loop para um sub-seam dedicado.

---

## 2) Transformações aplicadas

### 2.1 Novo sub-seam criado

- `src/copilot/agent/runtime/dialog-runtime-state.js`

Operações extraídas:

- `readAgentRuntimeDialogBootstrapState`
- `readAgentRuntimeDialogPersistedState`
- `persistAgentRuntimeDialogState`
- `persistAgentRuntimePendingTurnState`
- `shouldScheduleAgentRuntimeDialogBootRecovery`
- `markAgentRuntimeDialogPausedForRecovery`

### 2.2 Façade preservada com delegação

`src/copilot/agent/facades/agent-runtime-state.js` mantém a API pública, agora delegando as
operações acima para o novo sub-seam.

### 2.3 Contrato anti-regressão

`tests/unit/copilot/contracts/test_arch_contracts.spec.js` recebeu regra W86.6.1 exigindo a
delegação explícita para `runtime/dialog-runtime-state`.

---

## 3) Critérios de conclusão (validados)

### Critério W86.6.1-A — extração semântica real

- [x] domínio de dialog bootstrap/recovery removido da implementação central da façade.
- [x] novo sub-seam dedicado criado e integrado.

### Critério W86.6.1-B — compatibilidade de surface

- [x] API pública de `agent-runtime-state` preservada para consumidores atuais.

### Critério W86.6.1-C — proteção contínua

- [x] contrato executável adicionado para bloquear regressão da delegação.

### Critério W86.6.1-D — integridade mínima

- [x] `node --check` verde em:
  - `agent/runtime/dialog-runtime-state.js`
  - `agent/facades/agent-runtime-state.js`
  - `tests/unit/copilot/contracts/test_arch_contracts.spec.js`

### Critério W86.6.1-E — evidência quantitativa

Medições pós-extração:

- `agent/facades/agent-runtime-state.js` → fanIn=11, fanOut=5
- `agent/runtime/pending-question-state.js` → fanIn=1, fanOut=1
- `agent/runtime/dialog-runtime-state.js` → fanIn=1, fanOut=1

Leitura: os novos seams nasceram com acoplamento controlado e uso centralizado (via façade),
mantendo governança previsível.

---

## 4) Próximo passo contínuo

Avançar para **W86.6.2**: extrair o eixo de snapshot/graceful-shutdown para sub-seam próprio,
reduzindo ainda mais densidade da façade principal.
