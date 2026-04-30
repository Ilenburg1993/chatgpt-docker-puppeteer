# 80 — Bloco K / W86.6.2: plano contínuo de extração do seam `runtime/shutdown-snapshot-state`

**Data:** 2026-04-30 **Dependência:** conclusão da W86.6.1

---

## 1) Objetivo da subonda

Extrair da façade `agent-runtime-state` o eixo de snapshot/graceful-shutdown para um sub-seam
dedicado, reduzindo ainda mais o papel de “mega-owner” da façade.

---

## 2) Escopo técnico alvo

Funções candidatas à extração:

1. `saveAgentRuntimeShutdownSnapshot`
2. `persistAgentRuntimeGracefulShutdownState`
3. `resetAgentRuntimeGracefulShutdownFlag`
4. `persistAgentRuntimePrConsumptionSnapshot`

Novo arquivo alvo:

- `src/copilot/agent/runtime/shutdown-snapshot-state.js`

---

## 3) Critérios claros de conclusão

### Critério W86.6.2-A — separação semântica

- funções de snapshot/shutdown movidas para `runtime/shutdown-snapshot-state`;
- façade passa a delegar essas funções sem perder surface pública.

### Critério W86.6.2-B — isolamento de dependências

- sub-seam novo usa dependências mínimas e explícitas;
- evitar import cruzado indevido entre sub-seams de runtime.

### Critério W86.6.2-C — anti-regressão executável

- contrato em `test_arch_contracts` exigindo delegação para o novo sub-seam.

### Critério W86.6.2-D — evidência quantitativa

- re-medição de fanOut da façade principal;
- novos seams com fanIn/fanOut controlados.

### Critério W86.6.2-E — integridade mínima

- `node --check` verde em todos os arquivos alterados da subonda.

---

## 4) Riscos e mitigação

### R1 — quebra em caminhos de shutdown

Mitigação: preservar assinatura pública da façade e manter rótulos de persistência (`label`)
idênticos.

### R2 — import cycles acidentais entre seams

Mitigação: sub-seams runtime não importam uns aos outros sem necessidade; preferir dependência em
`state-io`/helpers estáveis.

### R3 — regressão silenciosa de comportamento

Mitigação: contrato arquitetural + validação sintática focada + medição pós-extração.

---

## 5) Próximo passo imediato

Iniciar a implementação W86.6.2.1 com extração de `resetAgentRuntimeGracefulShutdownFlag` e
`persistAgentRuntimeGracefulShutdownState` para o novo sub-seam.
