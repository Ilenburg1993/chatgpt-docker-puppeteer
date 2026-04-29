# 51 — Bugfix: recursão `AlwaysAliveAgent` ↔ `runtime-controls` no boot da LLM-B

**Data:** 2026-04-29 **Escopo:** `agent/always-alive.js`, `agent/facades/agent-runtime-controls.js`,
`sdk/session/client-facade.js`, testes focados e validação live de `terminal:llm-b`.

---

## Incidente observado

Ao executar `npm run terminal:llm-b`, o boot falhava com:

- `RangeError: Maximum call stack size exceeded`

Stack principal:

- `readRuntimeInteractionState(...)`
- `AlwaysAliveAgent.pendingQuestion`
- `readRuntimeInteractionState(...)`

Ou seja, havia uma recursão estrutural entre a façade `agent-runtime-controls` e os getters
recém-delegados de `AlwaysAliveAgent`.

---

## Causa raiz

Durante a purificação do runtime, `AlwaysAliveAgent` passou a delegar getters de status/interação
para:

- `readRuntimeControlState(...)`
- `readRuntimeInteractionState(...)`

mas essas próprias funções ainda liam propriedades como:

- `runtime.pendingQuestion`
- `runtime.pendingQuestionShadow`
- `runtime.dialogLoopActive`

Quando `runtime === AlwaysAliveAgent`, essas propriedades eram getters que chamavam a própria façade
novamente.

---

## Correção estrutural

### 1) `AlwaysAliveAgent` passa `this.ctx` para `runtime-controls`

Os getters desse eixo agora usam `AgentContext` como fonte estável:

- `readRuntimeControlState(this.ctx)`
- `readRuntimeInteractionState(this.ctx)`
- `getRuntimeHandoffManager(this.ctx)`

### 2) `agent-runtime-controls` passou a preferir métodos estáveis do `AgentContext`

Prioridade agora é dada a métodos como:

- `getRuntimeStatus()`
- `getModelSnapshot()`
- `getReasoningEffortSnapshot()`
- `getQueueSnapshot()`
- `getPendingQuestionForStatusSnapshot()`
- `getPendingQuestionKind()`
- `getPendingQuestionShadowSnapshot()`
- `getPendingQuestionShadowKind()`
- `getPendingQuestionShadowState()`
- `isPendingQuestionShadowExpired()`
- `getPendingQuestionShadowAgeMs()`
- `getPendingQuestionShadowExpiresAt()`
- `getPendingQuestionShadowRemainingMs()`
- `getHandoffManagerSnapshot()`
- `isDialogLoopActive()`

### 3) Ajustes associados

- tipagem da façade alinhada ao contrato real de `AgentContext`;
- `clearRuntimePendingQuestionShadow()` deixou de assumir retorno boolean do método do contexto;
- `sdk/session/client-facade.js` recebeu fix strict-safe em `Symbol.asyncDispose`.

---

## Validação

### Estática

- `npm run typecheck:strict:src.copilot` ✅
- `eslint` focado ✅

### Testes focados

- `tests/unit/copilot/test_agent_runtime_controls.spec.js` ✅
- `tests/unit/copilot/test_always_alive_delegation.spec.js` ✅
- `tests/unit/copilot/contracts/test_lifecycle_boundary_block_b.spec.js` ✅

Lote final: **31/31** testes verdes.

### Runtime live

`npm run terminal:llm-b` voltou a subir corretamente:

- servidor iniciado em `127.0.0.1:3009`;
- `AlwaysAliveAgent` inicializado;
- stack overflow **não** reapareceu;
- `/health` respondeu `ok: true`, `healthStatus: healthy`.

Observação operacional relevante:

- a instância live encontra-se limitada por **`rate_limit` externo do Copilot**;
- isso bloqueia diálogo efetivo, mas não invalida o bugfix do boot/stack overflow.

---

## Leitura arquitetural

Esse bug mostrou uma regra importante da revolução:

> quando `AlwaysAliveAgent` delega getters para façades, a façade não pode voltar a ler getters do
> próprio `AlwaysAliveAgent`; ela deve preferir snapshots/métodos estáveis do `AgentContext` ou de
> outra superfície semântica não recursiva.

Isso reforça as waves W18/W21/W23 e evita que a purificação do runtime introduza loops semânticos
invisíveis.

---

## Checkpoint complementar (bug hunt pós-fix)

Na rodada seguinte de caça proativa, foram encontrados e corrigidos dois gaps adicionais:

1. **Timers de timeout sem cleanup em wrappers RPC**

- arquivos: `tools/session-rpc-tools.js` e `tools/experimental-rpc-tools.js`;
- padrão anterior: `Promise.race([... setTimeout(reject) ...])` sem `clearTimeout` garantido;
- risco: timers pendurados em chamadas de sucesso rápido (leak gradual em carga alta);
- fix: helper `withTimeout(...)` com `try/finally` e `clearTimeout(timer)` sempre.

2. **Precedência de leitura em `agent-runtime-controls`**

- `dialogPaused` agora usa `isDialogLoopPaused()` quando disponível (além de health/property);
- `getRuntimeHandoffManager()` agora prioriza `getHandoffManagerSnapshot()` antes de
  `getHandoffManager()` para reduzir acoplamento com managers vivos e evitar reentrada futura.

### Regressões adicionadas

- `tests/unit/copilot/tools/test_session_rpc_tools.spec.js`
  - garante que timeout timer é limpo (`vi.getTimerCount() === 0`) em sucesso rápido;
- `tests/unit/copilot/tools/test_experimental_rpc_tools.spec.js` (novo)
  - cobertura mínima dos tools experimentais + cleanup de timer;
- `tests/unit/copilot/test_agent_runtime_controls.spec.js`
  - valida precedência `isDialogLoopPaused()`;
  - valida precedência `getHandoffManagerSnapshot()`.
