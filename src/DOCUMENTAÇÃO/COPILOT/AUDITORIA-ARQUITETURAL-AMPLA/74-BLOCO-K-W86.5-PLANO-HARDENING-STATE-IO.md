# 74 — Bloco K / W86.5: plano contínuo de hardening em `state-io`

**Data:** 2026-04-30 **Dependência:** conclusão da W86.4

---

## 1) Objetivo da W86.5

Reduzir acoplamento semântico em persistência do runtime: separar operações de IO cru das decisões
de política e reforçar façades como entrada canônica.

---

## 2) Escopo técnico

Alvos principais:

- `src/copilot/agent/lifecycle/state-io.js`
- `src/copilot/agent/facades/agent-runtime-state.js`
- consumidores diretos que ainda acoplam em IO de baixo nível

---

## 3) Critérios claros de conclusão da W86.5

### Critério W86.5-A — Separação de responsabilidade

- IO baixo nível isolado em seam de infraestrutura (`read/write/atomic update`).
- Política semântica (pending question, dialog paused, shutdown state) fora do módulo de IO cru.

### Critério W86.5-B — Fronteira de consumo

- consumidores de domínio passam por façade `agent-runtime-state`;
- imports diretos de `lifecycle/state-io.js` ficam restritos a pontos infra explícitos.

### Critério W86.5-C — Contrato anti-regressão

- novo/atualizado contract test bloqueando bypass para state-io fora da allowlist.

### Critério W86.5-D — Evidência de impacto

- re-medição de hotspot dos arquivos alvo com queda de pressão cross-module em `state-io`.

### Critério W86.5-E — Integridade mínima

- `node --check` verde em todos os arquivos alterados da onda.

---

## 4) Plano de execução contínua

1. inventário de imports de `state-io` no workspace;
2. classificação de cada consumidor em `infra legítima` vs `bypass semântico`;
3. extração de seam infra;
4. migração gradual de consumidores para façade;
5. atualização de contracts e checkpoint W86.5.

---

## 5) Próximo passo imediato

Iniciar subonda W86.5.1: inventário e classificação de imports de `state-io` para preparar migração
segura e profunda.
