# 48 — Mapeamento de `AlwaysAliveAgent`, Runtime Controls e Dialog Runtime

**Status**: checkpoint complementar de transformação **Data-base**: 2026-04-28 **Programa**: P2 —
Purificação do runtime `agent/` **Ondas relacionadas**: W18, W21, W23

---

## 1. Objetivo desta subonda

Esta subonda aprofunda a limpeza semântica de `AlwaysAliveAgent`, com foco em dois eixos:

1. leituras de **runtime control / interaction state**;
2. operações de **dialog runtime**.

A meta foi reduzir a quantidade de getters e comandos em `always-alive.js` que ainda tocavam
`AgentContext` de forma direta para concerns que já possuem ou merecem uma façade semântica.

---

## 2. Problema arquitetural encontrado

`AlwaysAliveAgent` já havia deixado de operar vários detalhes crus do SDK, mas ainda permanecia com
uma concentração excessiva de chamadas diretas a `this.ctx` para:

- `getRuntimeStatus()`;
- `isDialogLoopActive()`;
- `getHandoffManagerSnapshot()`;
- `getQueueSnapshot().size`;
- perguntas pendentes e suas sombras persistidas;
- e, em parte do eixo de diálogo, `sendDialogTurn()` / `pauseDialogLoop()` / snapshots de PR.

Isso criava dois problemas:

1. o agent continuava sendo owner demais da topologia interna do contexto;
2. as façades `agent-runtime-controls` e `agent-dialog-runtime` existiam, mas ainda não haviam
   vencido plenamente dentro do próprio runtime principal.

---

## 3. Transformações realizadas

### 3.1 `AlwaysAliveAgent` agora consome `agent-runtime-controls`

Os seguintes concerns passaram a ser lidos por façade semântica em vez de tocar `ctx` diretamente:

- `status`;
- `dialogLoopActive`;
- `queueSize`;
- `getHandoffManager()`;
- `pendingQuestion`;
- `pendingQuestionKind`;
- `pendingQuestionShadow`;
- `pendingQuestionShadowKind`;
- `pendingQuestionShadowState`;
- `pendingQuestionShadowExpired`;
- `pendingQuestionShadowAgeMs`;
- `pendingQuestionShadowExpiresAt`;
- `pendingQuestionShadowRemainingMs`.

### 3.2 `AlwaysAliveAgent` já usa `agent-dialog-runtime`

O eixo de diálogo permaneceu consolidado via façade:

- `dispatchAgentDialogTurn()`;
- `pauseAgentDialogLoop()`;
- `isAgentDialogLoopPaused()`;
- `readAgentDialogPrMetrics()`;
- `readAgentDialogLastPrInfo()`.

### 3.3 Tipagem unificada da cadeia de diálogo

A subonda também alinhou os contratos de tipo entre:

- `agent-dialog-runtime.js`;
- `AgentContext.sendDialogTurn()`;
- `presentation/runtime-dialog.js`.

Regras agora explícitas:

- `sendDialogTurn()` resolve para `Promise<string>`;
- `timeout` pode ser `number | null`;
- `signal` também faz parte da surface pública da cadeia de diálogo;
- `pauseDialogLoop(sessionId)` usa `string | null`, refletindo o contrato real do runtime.

---

## 4. Guardrails adicionados

O gate estrutural recebeu a regra:

- `always-alive-must-not-touch-ctx-runtime-controls-directly`

Ela impede regressões onde `AlwaysAliveAgent` volte a chamar diretamente:

- `this.ctx.getRuntimeStatus()`;
- `this.ctx.isDialogLoopActive()`;
- `this.ctx.getHandoffManagerSnapshot()`;
- `this.ctx.getQueueSnapshot().size`;
- `this.ctx.getPendingQuestion*` / `getPendingQuestionShadow*` / derivados.

Essa regra complementa a já existente:

- `always-alive-must-not-touch-ctx-dialog-runtime-directly`

---

## 5. Testes que congelam a nova fronteira

### Testes estruturais

- `tests/unit/copilot/test_always_alive_delegation.spec.js`
- `tests/unit/copilot/contracts/test_lifecycle_boundary_block_b.spec.js`

### Testes unitários de façade

- `tests/unit/copilot/test_agent_runtime_controls.spec.js`

Esses testes garantem que:

- `AlwaysAliveAgent` usa `agent-runtime-controls` para state/interactions;
- `AlwaysAliveAgent` usa `agent-dialog-runtime` para commands/snapshots de diálogo;
- a cadeia de tipo entre agent/runtime/presentation continua coerente.

---

## 6. Leitura arquitetural consolidada

A regra geral reforçada nesta subonda é:

> `AlwaysAliveAgent` deve ser owner da **intenção do runtime vivo**, não do detalhe de leitura do
> contexto para cada concern de controle/interação.

Em outras palavras:

- `AgentContext` continua sendo o composition root interno;
- façades continuam sendo a surface canônica para leitura/operação semântica;
- `AlwaysAliveAgent` deve tender a orquestrar por contratos, não por chamadas cruas a snapshots e
  flags internas do contexto.

---

## 7. Como isso se encaixa no plano geral

Esta subonda empurra diretamente:

- **W18** — catalogar e reduzir leituras cruas de `AgentContext`;
- **W21** — revisar `AlwaysAliveAgent` e classificar métodos por owner/destino;
- **W23** — separar melhor startup/boot/recovery/wiring.

Também prepara terreno para subondas posteriores em:

- `cleanup.js`;
- `boot-wiring.js`;
- classificações adicionais do eixo `AlwaysAliveAgent`.

---

## 8. Próximos alvos naturais

Depois deste checkpoint, os próximos hotspots mais fortes são:

1. `cleanup.js` — verificar se ainda resta duplicação operacional ou detalhe baixo demais do SDK;
2. `boot-wiring.js` — revisar se lifecycle/quota/observer wiring ainda pode subir mais um nível de
   semântica;
3. `AlwaysAliveAgent` — continuar a classificação dos getters/comandos restantes por owner ideal;
4. `sdk/session/permissions.js` e `sdk/session/provider.js` — continuar o endurecimento fino do
   boundary SDK em paralelo.
