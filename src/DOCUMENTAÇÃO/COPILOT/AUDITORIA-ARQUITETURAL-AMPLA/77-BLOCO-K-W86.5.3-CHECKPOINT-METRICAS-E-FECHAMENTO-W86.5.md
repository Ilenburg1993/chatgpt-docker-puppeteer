# 77 — Bloco K / W86.5.3: métricas residuais e fechamento da W86.5

**Data:** 2026-04-30 **Escopo:** governança final da onda W86.5 (state-io)

---

## 1) Objetivo da subonda

Fechar a W86.5 com evidência quantitativa e guarda anti-regressão para o novo seam de IO bruto.

---

## 2) Métricas factuais coletadas

Medição realizada no grafo atual de `src/copilot`:

- `agent/lifecycle/state-io.js`
  - LOC: **345**
  - fan-in: **4**
  - fan-out: **6**

- `agent/lifecycle/state-file-io.js`
  - LOC: **77**
  - fan-in: **1**
  - fan-out: **1**

- `agent/facades/agent-runtime-state.js`
  - LOC: **396**
  - fan-in: **11**
  - fan-out: **3**

Leitura: a extração deslocou I/O cru para seam pequeno e com acoplamento controlado (`fanIn=1`),
preservando a governança sem explodir fan-out.

---

## 3) Contratos adicionais aplicados

`test_arch_contracts` ganhou reforço W86.5.3:

- `state-file-io.js` só pode ser importado por `agent/lifecycle/state-io.js`.

Isso evita bypass direto de FS cru por múltiplos consumidores.

---

## 4) Critérios de conclusão da W86.5 (consolidados)

### Critério W86.5-A — consumo por façade

- [x] consumidores de domínio migrados para `agent-runtime-state`.
- [x] imports diretos de `state-io` reduzidos para allowlist infra.

### Critério W86.5-B — separação interna de IO bruto

- [x] criado seam `state-file-io`.
- [x] `state-io` delega operações FS ao seam dedicado.

### Critério W86.5-C — anti-regressão executável

- [x] contrato de allowlist para `state-io`.
- [x] contrato de isolamento para `state-file-io`.

### Critério W86.5-D — integridade mínima

- [x] `node --check` verde em todos os arquivos alterados.

---

## 5) Fechamento da W86.5

A W86.5 está **concluída** no escopo definido para este bloco: houve refatoração real, redução de
bypass e criação de guards de continuidade.

---

## 6) Próximo bloco contínuo recomendado (W86.6)

1. reduzir densidade de `agent-runtime-state` por sub-seams (pending-question, dialog-bootstrap,
   shutdown-snapshot);
2. revisar consumidores de `snapshot.js` para decidir se permanece infra direta ou ganha bridge
   dedicada;
3. adicionar medição de tendência por onda (comparativo W85→W86.6) no hotspot map.
