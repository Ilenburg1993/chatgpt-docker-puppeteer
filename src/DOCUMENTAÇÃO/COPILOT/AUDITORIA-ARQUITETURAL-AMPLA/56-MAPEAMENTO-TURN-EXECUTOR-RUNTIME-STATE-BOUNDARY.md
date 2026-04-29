# 56 — Mapeamento: `turn-executor` convergido para a fronteira semântica de runtime-state

**Data**: 2026-04-29 **Escopo**: `src/copilot/agent/dialog/turn-executor.js`,
`src/copilot/agent/facades/agent-runtime-state.js`

---

## Objetivo da subonda

Completar a migração do eixo de persistência do diálogo para a fronteira semântica de runtime-state,
eliminando mais um acesso direto de módulos de diálogo ao `state-io`.

---

## Transformações aplicadas

### 1) `turn-executor` sem `persistStateWithPolicy` direto

`emitTurnStart()` deixou de construir o payload de persistência diretamente sobre `state-io`.

A responsabilidade foi promovida para `agent/facades/agent-runtime-state.js` com a capability:

- `persistAgentRuntimePendingTurnState({ message, ts })`

### 2) Façade de runtime-state ampliada

`agent-runtime-state.js` passou a encapsular também o marcador canônico de pending turn, ao lado de:

- bootstrap/read de estado do diálogo;
- persistência de fragmentos do dialog loop;
- flags de graceful shutdown;
- snapshots de consumo PR.

---

## Resultado arquitetural

### Antes

- `turn-executor` ainda conhecia `persistStateWithPolicy()` diretamente.
- a família `loop-manager`/`turn-executor` usava duas formas de acessar estado persistido.

### Agora

- `loop-manager` e `turn-executor` convergem na mesma borda semântica (`agent-runtime-state`).
- o eixo de diálogo fica mais próximo de protocolo/orquestração, e menos de storage.

---

## Validação executada

- testes focados ✅
  - `tests/unit/copilot/test_turn_executor.spec.js`
  - `tests/unit/copilot/test_agent_background_tasks_integration.spec.js`
  - `tests/unit/copilot/test_loop_manager.spec.js`
  - `tests/unit/copilot/test_agent_runtime_state.spec.js`
- `npm run typecheck:strict:src.copilot` ✅
- eslint/prettier focados ✅

---

## Próximos passos recomendados

1. unificar a projeção de health/status para bordas HTTP/SSE sobre snapshots canônicos
   compartilhados;
2. continuar a remoção de detalhes de contexto cru do runtime em `presentation/*`;
3. atacar o próximo eixo de dívida real no SDK (`models/helpers`/`session/lifecycle`).
