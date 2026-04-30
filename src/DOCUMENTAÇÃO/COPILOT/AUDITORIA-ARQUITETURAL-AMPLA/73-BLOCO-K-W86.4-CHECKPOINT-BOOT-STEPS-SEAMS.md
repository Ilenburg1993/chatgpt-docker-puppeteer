# 73 — Bloco K / W86.4: checkpoint de extração de seams em `boot-steps`

**Data:** 2026-04-30 **Escopo:** `src/copilot/agent/session/*` (pipeline de boot)

---

## 1) Objetivo da W86.4

Desconcentrar `boot-steps.js` em seams semânticos, mantendo compatibilidade de consumo em
`boot-wiring.js`.

---

## 2) Transformações aplicadas

Foram criados três novos módulos internos:

1. `boot-session-prep.js`
   - `createBootWiringState`
   - `stepWireSessionEvents`
   - `stepAttachEventCollector`
   - `stepCleanupStaleSessions`

2. `boot-dialog-recovery.js`
   - `scheduleDialogBootRecovery`
   - `runDialogBootRecovery`
   - `stepScheduleDialogRecovery`
   - `reapExpiredPendingQuestionShadow`

3. `boot-runtime-bind.js`
   - `stepAttachAgentObserver`
   - `stepStartMetricsTimer`
   - `stepStartMcpReconnect`
   - `stepStartKeepalive`
   - `stepWireHandoff`
   - `stepWireQuestionAnsweredRelay`

E `boot-steps.js` foi convertido em aggregate de **re-export** (surface estável).

---

## 3) Critérios de conclusão da W86.4 (definidos e validados)

### Critério W86.4-A — Separação semântica explícita

- [x] Session prep separado em seam dedicado.
- [x] Dialog recovery separado em seam dedicado.
- [x] Runtime bind separado em seam dedicado.

### Critério W86.4-B — Compatibilidade do pipeline

- [x] `boot-wiring.js` continua importando `./boot-steps.js` (sem churn externo).
- [x] `boot-steps.js` preserva superfície pública via re-exports.

### Critério W86.4-C — Redução de concentração no aggregate

- [x] `boot-steps.js` fan-out mensurado: **3** (somente os três novos seams).
- [x] `boot-steps.js` fan-in mensurado: **1** (`boot-wiring.js`).

### Critério W86.4-D — Anti-regressão executável

- [x] contrato adicionado em `tests/unit/copilot/contracts/test_arch_contracts.spec.js` para impedir
      reconcentração de lógica em `boot-steps.js`.

### Critério W86.4-E — Integridade sintática

- [x] `node --check` verde em:
  - `boot-session-prep.js`
  - `boot-dialog-recovery.js`
  - `boot-runtime-bind.js`
  - `boot-steps.js`
  - `boot-wiring.js`
  - `test_arch_contracts.spec.js`

---

## 4) Leitura arquitetural

A W86.4 conclui a etapa de extração por fases no pipeline de boot sem quebrar a interface estável do
runner. Isso reduz custo cognitivo e prepara terreno para W86.5 (hardening de persistência/estado
semântico).

---

## 5) Próxima onda contínua

Avançar imediatamente para **W86.5** com foco em:

1. diminuir acoplamento residual de `state-io`;
2. separar IO cru vs política semântica;
3. consolidar entradas pela façade canônica de runtime-state.
