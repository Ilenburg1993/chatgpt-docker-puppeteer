# 82 — Bloco K / W86.6.3: plano contínuo de extração de session/status bootstrap seam

**Data:** 2026-04-30 **Dependência:** conclusão da W86.6.1 e W86.6.2

---

## 1) Objetivo da subonda

Extrair da façade `agent-runtime-state` o eixo de leitura básica de bootstrap/session fallback
(sessionId + leituras persistidas associadas), reduzindo ainda mais a concentração da façade.

---

## 2) Escopo técnico alvo

Candidatos primários:

1. `readAgentRuntimeSessionId`
2. leituras persistidas base de bootstrap que ainda não foram delegadas
3. possível bridge de fallback síncrono para estado persistido

Arquivo alvo proposto:

- `src/copilot/agent/runtime/session-bootstrap-state.js`

---

## 3) Critérios claros de conclusão

### Critério W86.6.3-A — extração funcional

- funções alvo movidas para sub-seam dedicado;
- façade preservada como gateway delegador.

### Critério W86.6.3-B — compatibilidade estável

- assinatura pública de `agent-runtime-state` preservada.

### Critério W86.6.3-C — anti-regressão

- contrato em `test_arch_contracts` exigindo delegação explícita ao novo sub-seam.

### Critério W86.6.3-D — métrica de densidade

- medição pós-extração de fanOut da façade principal e fanIn/fanOut do novo sub-seam.

### Critério W86.6.3-E — integridade mínima

- `node --check` verde em todos os arquivos alterados da subonda.

---

## 4) Próximo passo imediato

Iniciar W86.6.3.1 com extração de `readAgentRuntimeSessionId` e validação de consumo em pontos de
boot/recovery.
