# 70 — Bloco K / W86: plano profundo de extração de seams em `src/copilot/agent`

**Data:** 2026-04-30 **Dependência direta:** `69-BLOCO-K-W85-HOTSPOT-MAP-AGENT-COM-EVIDENCIA.md`

---

## 1) Objetivo da W86

Executar a primeira onda de **descompressão semântica real** do runtime `agent`, reduzindo
concentração de lifecycle/dialog/boot sem quebrar API pública.

---

## 2) Escopo prioritário de transformação

## Eixo A — Lifecycle split

### Arquivo-alvo principal

- `agent/lifecycle/agent-lifecycle.js`

### Extrações previstas

1. seam de transição de fase (`lifecycle-phase-transitions`)
2. seam de recovery/retry de sessão (`lifecycle-recovery-seam`)
3. seam de integração SDK lifecycle (`lifecycle-sdk-bridge`)

### Ganho esperado

- queda de fan-out do arquivo;
- melhor testabilidade por subfluxo de lifecycle.

## Eixo B — Dialog orchestration split

### Arquivo-alvo principal

- `agent/dialog/loop-manager.js`

### Extrações previstas

1. seam de decisão de turno (`dialog-turn-decision`)
2. seam de controle de loop (`dialog-loop-control`)
3. seam de sinais/eventos de diálogo (`dialog-loop-signals`)

### Ganho esperado

- reduzir acoplamento com componentes de estado/SDK;
- clarificar boundaries entre controle e execução.

## Eixo C — Boot semantics split

### Arquivo-alvo principal

- `agent/session/boot-steps.js`

### Extrações previstas

1. seam de preparação de sessão (`boot-session-prep`)
2. seam de recuperação de estado de diálogo (`boot-dialog-recovery`)
3. seam de binding/runtime final (`boot-runtime-bind`)

### Ganho esperado

- pipeline de boot mais legível;
- rollback/diagnóstico mais previsíveis por step.

## Eixo D — Estado persistido semântico

### Arquivo-alvo principal

- `agent/lifecycle/state-io.js`

### Extrações previstas

1. separar IO cru de política semântica (`state-io-core` vs `state-policy`)
2. limitar imports cross-module ao mínimo necessário
3. reforçar uso de façade `agent-runtime-state` como entrada canônica

### Ganho esperado

- reduzir pressão cross-module;
- evitar bypass de persistência semântica.

---

## 3) Estratégia de execução (subondas W86.1–W86.6)

### W86.1 — Preparação contratual

- adicionar contratos de import para novos seams-alvo;
- congelar baseline dos hotspots atuais (fan-out/fan-in/cross).

### W86.2 — Extração lifecycle

- mover subfluxos de `agent-lifecycle.js` para seams dedicados;
- manter API pública idêntica.

### W86.3 — Extração dialog

- refatorar `loop-manager.js` em coordenador fino;
- delegar decisão e sinais para seams novos.

### W86.4 — Extração boot

- modularizar `boot-steps.js` por fases semânticas;
- alinhar com estratégia transacional de lifecycle.

### W86.5 — Hardening de state-io

- separar infra de política;
- reduzir chamadas diretas fora da façade canônica.

### W86.6 — Re-medição e avaliação

- rerodar análise de hotspots;
- comparar delta de score por arquivo alvo;
- registrar checkpoint W86 concluído.

---

## 4) Gates de aceitação da W86

## Gate W86-A — redução de concentração

- `agent/lifecycle/agent-lifecycle.js`: fan-out reduzido de forma mensurável;
- `agent/dialog/loop-manager.js`: fan-out reduzido de forma mensurável;
- `agent/session/boot-steps.js`: fan-out reduzido de forma mensurável.

## Gate W86-B — estado semântico governado

- `state-io` com imports e responsabilidades estritamente definidos;
- ausência de bypass novo para persistência crua fora das rotas permitidas.

## Gate W86-C — contratos e compatibilidade

- contratos de arquitetura ajustados para impedir regressão;
- superfícies públicas de `#copilot/agent` preservadas.

---

## 5) Riscos e mitigação

### R1 — quebra de comportamento operacional

**Mitigação:** extração incremental em subondas curtas + contratos de anti-bypass.

### R2 — refatorar sem reduzir acoplamento real

**Mitigação:** medir delta de hotspots em cada subonda (não aceitar “refactor cosmético”).

### R3 — explosão de seams irrelevantes

**Mitigação:** cada seam novo só entra se reduzir aresta/complexidade de hotspot prioritário.

---

## 6) Saídas obrigatórias da W86

1. mudanças de código em `agent/*` com seams extraídos;
2. atualização dos contratos de arquitetura;
3. checkpoint documental da onda;
4. re-medição factual pós-extração para validar ganho real.

---

## 7) Próximo passo imediato

Iniciar W86.1 pela preparação contratual + baseline de hotspots em teste, seguido da extração do
eixo lifecycle (W86.2).
