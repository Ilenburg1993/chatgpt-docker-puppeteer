# 72 — Bloco K / W86.3: checkpoint de extração do `DialogLoopRuntimeKit`

**Data:** 2026-04-30 **Escopo de código:** `src/copilot/agent/dialog/loop-manager.js` + novo seam
`loop-runtime-kit.js`

---

## 1) Objetivo da subonda

Reduzir a concentração estrutural no construtor do `DialogLoopManager`, extraindo o setup de
componentes internos para um seam dedicado de composição.

---

## 2) Transformações aplicadas

### 2.1 Novo seam criado

- `src/copilot/agent/dialog/loop-runtime-kit.js`

Responsabilidades centralizadas:

- criação de `TurnQueue`;
- criação de `DialogWatchdogSupervisor`;
- bootstrap de fallback model state;
- bootstrap de `DialogLoopStateMachine` com estado persistido;
- bootstrap de `DialogCostLedger` e `DialogCompactionPolicy`.

### 2.2 Refatoração do manager

- `loop-manager.js` passou a consumir `createDialogLoopRuntimeKit(...)`;
- construtor ficou mais fino e declarativo;
- imports de componentes internos passaram a concentrar-se no kit.

---

## 3) Impacto arquitetural esperado

1. menor fan-out direto no `loop-manager`;
2. melhor legibilidade do papel de orquestração do manager;
3. padrão reaproveitável para próximas extrações em boot/resume/controle de sinais.

---

## 4) Validação executada

Validação sintática local:

- `node --check src/copilot/agent/dialog/loop-runtime-kit.js`
- `node --check src/copilot/agent/dialog/loop-manager.js`

Resultado: **sem erro de sintaxe**.

---

## 5) Próximo passo imediato

Avançar para W86.4 no eixo `boot-steps`/`lifecycle` com extrações orientadas a fase (session prep,
dialog recovery e runtime bind), mantendo contratos anti-bypass ativos.
