# 47 — Mapeamento de Dialog Boot Recovery e Runtime-State

**Status**: checkpoint complementar de transformação
**Data-base**: 2026-04-28
**Eixo principal**: `agent/session/boot-steps.js` ↔ `agent/facades/agent-runtime-state.js`
**Programa**: P2 — Purificação do runtime `agent/`
**Ondas relacionadas**: W18, W23

---

## 1. Objetivo desta subonda

Esta subonda continua a redução da nebulosidade entre:

- orchestration do runtime vivo do `agent`;
- fallback persistido do runtime (`state-io`);
- decisões de boot/recovery do dialog loop.

A meta específica aqui foi tirar de `boot-steps.js` a posse direta da semântica de estado persistido
necessária ao **dialog boot recovery**, do mesmo modo que a subonda anterior já havia removido a
persistência inline do reaper de `pendingQuestionShadow`.

---

## 2. Problema arquitetural identificado

Após o checkpoint 46, `boot-steps.js` ainda conhecia diretamente dois detalhes de `state-io`:

1. como ler o snapshot persistido para decidir se o dialog loop deveria ser retomado no boot;
2. como persistir `dialogPaused=true` antes de executar a retomada.

Na prática, isso mantinha `boot-steps.js` acumulando duas responsabilidades:

- **quando** executar o boot recovery;
- **como** consultar/persistir o estado para torná-lo seguro.

Essa segunda responsabilidade não pertence à orchestration pura do boot; ela pertence ao domínio de
**runtime-state semantics**.

---

## 3. Regra geral reforçada

A regra consolidada nesta subonda ficou:

> `boot-steps.js` pode decidir **quando** tentar recovery do dialog loop, mas não deve decidir
> **como** ler ou persistir estado em `state-io` para essa finalidade.

Ou seja:

- `boot-steps.js` = owner da sequência operacional do boot;
- `agent-runtime-state.js` = owner da semântica de fallback persistido e persistência canônica;
- `state-io.js` = owner técnico da serialização, não consumer direto de `boot-steps.js`.

---

## 4. Transformações realizadas

### 4.1 Façade `agent-runtime-state.js` expandida

Foram promovidas duas novas operações semânticas:

- `shouldScheduleAgentRuntimeDialogBootRecovery()`
- `markAgentRuntimeDialogPausedForRecovery()`

Essas funções absorvem respectivamente:

- a leitura do snapshot persistido (`dialogLoopActive && !dialogPaused`);
- a persistência canônica de `dialogPaused=true` para o recovery.

### 4.2 `boot-steps.js` convergido

`boot-steps.js` deixou de importar diretamente:

- `readStateAsync`
- `persistStateWithPolicy`

para esse caso específico.

Agora ele passa a usar:

- `shouldScheduleAgentRuntimeDialogBootRecovery()` em `stepScheduleDialogRecovery()`;
- `markAgentRuntimeDialogPausedForRecovery()` em `runDialogBootRecovery()`.

---

## 5. Efeito arquitetural

### Antes

`boot-steps.js` era ao mesmo tempo:

- runner/step library do boot;
- consumidor direto de `state-io` para a política de recovery.

### Agora

`boot-steps.js` fica mais próximo do papel correto:

- coordena e agenda o boot recovery;
- delega a semântica de runtime-state à façade dedicada.

Isso reduz o acoplamento entre:

- boot orchestration;
- persistência de estado;
- detalhes de serialização.

---

## 6. Guardrails adicionados

O gate `scripts/check-copilot-official-seams.mjs` recebeu a regra:

- `boot-steps-must-not-touch-state-io-for-dialog-boot-recovery`

Ela bloqueia regressões onde `boot-steps.js` volte a tocar diretamente:

- `readStateAsync()`
- `persistStateWithPolicy({ dialogPaused: true }, ...)`

---

## 7. Testes que congelam a nova fronteira

### Testes de comportamento

- `tests/unit/copilot/test_agent_runtime_state.spec.js`
- `tests/unit/copilot/test_boot_steps_dialog_recovery.spec.js`

### Testes estruturais

- `tests/unit/copilot/contracts/test_lifecycle_boundary_block_b.spec.js`
- `tests/unit/copilot/test_boot_wiring_pipeline.spec.js`

Essas suítes garantem que:

- a decisão de scheduling do recovery nasce na façade de runtime-state;
- a persistência de `dialogPaused` não é mais feita inline por `boot-steps.js`;
- o contrato arquitetural fica explícito e executável.

---

## 8. Como isso se encaixa no plano geral

Esta subonda empurra diretamente:

- **W18** — catalogar e reduzir leituras/mutações cruas do runtime state;
- **W23** — separar melhor boot/startup/recovery/wiring;
- e prepara o terreno para **W21**, reduzindo ainda mais a difusão semântica em torno de
  `AlwaysAliveAgent` e módulos adjacentes.

Também reforça a diretriz maior do programa:

> módulos do `agent` devem decidir intenção e timing do runtime vivo, mas não possuir detalhes
> baixos de persistência ou do SDK quando esses detalhes já podem ser encapsulados por façades
> semânticas.

---

## 9. Próximos alvos naturais

Depois deste checkpoint, os próximos candidatos mais fortes são:

1. `AlwaysAliveAgent` — continuar a classificação de métodos por owner/destino;
2. `boot-wiring.js` — revisar se ainda restam decisões de integração baixa que devem subir para
   façades semânticas;
3. `cleanup.js` — confirmar se o boundary com `agent ↔ sdk` já está totalmente coerente ou se ainda
   há pontos de duplicação operacional.
