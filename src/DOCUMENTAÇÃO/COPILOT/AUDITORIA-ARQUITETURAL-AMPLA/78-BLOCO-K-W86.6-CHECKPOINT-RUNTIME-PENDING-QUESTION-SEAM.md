# 78 — Bloco K / W86.6: checkpoint de decomposição de `agent-runtime-state` (pending-question seam)

**Data:** 2026-04-30 **Escopo:** `src/copilot/agent/facades/agent-runtime-state.js` e
`src/copilot/agent/runtime/pending-question-state.js`

---

## 1) Objetivo da W86.6 (primeira subextração)

Iniciar a decomposição da façade `agent-runtime-state` em sub-seams de ownership explícito,
começando pelo domínio de `pendingQuestion`/shadow.

---

## 2) Transformações aplicadas

### 2.1 Novo sub-seam de runtime

Criado `src/copilot/agent/runtime/pending-question-state.js` com:

- `shouldReapAgentRuntimePendingQuestionShadow`
- `persistAgentRuntimePendingQuestionState`
- `clearAgentRuntimePendingQuestionShadow`

### 2.2 Façade preservada e delegada

`agent-runtime-state.js` preserva a API pública, mas agora delega essas três operações ao novo
sub-seam.

### 2.3 Anti-regressão executável

`test_arch_contracts` recebeu contrato W86.6 exigindo a delegação da façade para
`runtime/pending-question-state`.

---

## 3) Critérios de conclusão da subextração (validados)

- [x] API pública do barrel preservada (sem breaking change de consumer).
- [x] lógica de pending-question removida da implementação principal da façade.
- [x] contrato anti-regressão criado.
- [x] `node --check` verde nos arquivos alterados.

---

## 4) Leitura arquitetural

A W86.6 inaugura uma nova etapa de redução de densidade da façade. Em vez de um mega-arquivo
centralizador, o runtime-state passa a ter sub-seams por responsabilidade semântica.

---

## 5) Próxima subonda contínua (W86.6.1)

Extrair o domínio de `dialog bootstrap/recovery state` (leitura persistida + flags de recovery) para
um segundo sub-seam em `agent/runtime/*`.
