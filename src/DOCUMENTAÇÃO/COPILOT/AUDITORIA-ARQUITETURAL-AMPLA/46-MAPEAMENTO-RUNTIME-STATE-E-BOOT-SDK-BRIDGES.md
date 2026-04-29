# 46 — Runtime State Semântico e Bridges de Boot do SDK

**Status**: checkpoint complementar do Bloco B / continuidade do Bloco C **Última atualização**:
2026-04-28 **Escopo desta etapa**:

- remover mais uma zona de acoplamento entre `AlwaysAliveAgent`/`boot-steps` e `state-io`;
- tornar `boot-wiring` menos conhecedor dos detalhes de lifecycle/quota do SDK;
- reforçar, ao mesmo tempo, o papel do `agent` como owner do runtime vivo e do `sdk` como owner das
  integrações vanilla.

---

## 1. Problema arquitetural atacado

Após as ondas anteriores, o sistema já tinha melhorado em pontos importantes:

- `keepalive` deixou de tocar handles crus do SDK;
- `initializer` e `history-sync` deixaram de sondar `getMessages` diretamente;
- `agent/lifecycle/*` deixou de espalhar `client.start/stop/ping` e `create/resume` crus.

Mesmo assim, restavam duas zonas de nebulosidade:

### 1.1 `AlwaysAliveAgent` e `boot-steps` ainda conheciam demais o estado persistido

Havia uso inline de:

- `readState()?.sessionId`
- `persistStateWithPolicy(...)`

para problemas que, semanticamente, não são “I/O de estado”, e sim:

- **qual é o sessionId canônico do runtime?**
- **como limpar de forma correta a shadow persistida de `ask_user`?**

### 1.2 `boot-wiring` ainda conhecia helpers de baixo nível demais do boundary SDK

Embora já não tocasse o SDK cru diretamente, ele ainda chamava por nomes baixos de integração:

- `observeAgentSdkSessionLifecycle(...)`
- `startAgentSdkQuotaMonitor(...)`

Isso mantinha o runner de boot mais acoplado à mecânica do boundary SDK do que o necessário.

---

## 2. Regra arquitetural consolidada nesta subonda

### 2.1 Runtime state

> módulos do runtime vivo podem decidir **quando** consultar um fallback persistido ou limpar uma
> shadow restaurada, mas não devem conhecer o boilerplate de `state-io` para isso.

### 2.2 Boot ↔ SDK

> `boot-wiring` pode decidir **quando** acoplar lifecycle e quota ao runtime, mas não deve carregar
> nomes e passos de baixo nível do boundary SDK quando uma bridge semântica de boot pode existir.

---

## 3. Transformação aplicada

### 3.1 Nova façade `agent-runtime-state.js`

Foi introduzida:

- `src/copilot/agent/facades/agent-runtime-state.js`

Ela passa a ser owner de duas semânticas antes espalhadas:

#### A. `readAgentRuntimeSessionId(ctx)`

Resolve o sessionId canônico do runtime usando:

1. sessão viva (`ctx.getSessionSnapshot()?.sessionId`)
2. fallback persistido (`readState()?.sessionId`)

#### B. `clearAgentRuntimePendingQuestionShadow(ctx, options)`

Encapsula:

- limpeza da shadow em memória (`ctx.clearPendingQuestionShadow()`)
- persistência canônica em background com:
  - `persistStateWithPolicy(...)`
  - `ctx.trackBackgroundTask(...)`

Resultado:

- `AlwaysAliveAgent` e `boot-steps` já não precisam conhecer detalhes de `state-io` para essa
  operação.

### 3.2 `AlwaysAliveAgent` ficou mais limpo

`src/copilot/agent/always-alive.js` passou a usar:

- `readAgentRuntimeSessionId(this.ctx)`
- `clearAgentRuntimePendingQuestionShadow(this.ctx, ...)`

Com isso, ele deixa de ser owner direto de:

- fallback persistido de `sessionId`
- persistência da limpeza do pending question shadow

### 3.3 `boot-steps` deixou de persistir shadow inline

`src/copilot/agent/session/boot-steps.js` agora reaproveita:

- `clearAgentRuntimePendingQuestionShadow(ctx, { label, description })`

para o reaper da shadow expirada.

Resultado:

- `boot-steps` continua owner da decisão **quando** reaper deve acontecer;
- a forma canônica de limpar e persistir deixa de ser reimplementada localmente.

### 3.4 `boot-wiring` passou a usar bridges de boot mais semânticas

Em `src/copilot/agent/facades/agent-sdk-access.js` foram introduzidas:

- `attachAgentSdkBootLifecycleBridge(client, onEvent)`
- `startAgentSdkBootQuotaBridge(options)`

Essas funções continuam delegando ao boundary já existente, mas tornam explícito que o callsite é:

- **boot integration**
- e não apenas “consumo genérico” do helper de baixo nível.

`src/copilot/agent/session/boot-wiring.js` passou então a usar essas bridges semânticas.

---

## 4. Guardrails adicionados

O `scripts/check-copilot-official-seams.mjs` foi expandido para impedir regressão em dois pontos:

- `always-alive-must-not-touch-state-io-for-shadow-or-sessionid`
- `boot-steps-must-not-persist-shadow-inline`

Em termos práticos, isso bloqueia a volta de:

- `readState()?.sessionId`
- `persistStateWithPolicy(...)` inline nesses callsites

quando o uso correto deveria passar pela façade semântica do runtime.

---

## 5. Testes que congelam a nova fronteira

### Testes funcionais

- `tests/unit/copilot/test_agent_runtime_state.spec.js`
- `tests/unit/copilot/test_boot_steps_shadow_reaper.spec.js`
- `tests/unit/copilot/test_agent_sdk_access.spec.js`

### Testes estruturais

- `tests/unit/copilot/test_always_alive_delegation.spec.js`
- `tests/unit/copilot/contracts/test_lifecycle_boundary_block_b.spec.js`

Esses testes agora congelam que:

- `AlwaysAliveAgent` delega `sessionId`/shadow à façade `agent-runtime-state`;
- `boot-steps` usa a mesma façade para o reaper;
- `boot-wiring` usa bridges semânticas de boot do SDK, e não os helpers mais baixos.

---

## 6. Como isso se encaixa no plano geral

Esta subonda continua a transição entre:

- **P1 / Bloco B** — reforço do boundary SDK
- **P2 / Bloco C** — purificação do runtime `agent/`

Mais especificamente, ela prepara terreno para:

- **W17** — classificação mais rigorosa dos subdomínios internos do `agent`;
- **W18** — catalogar e reduzir leituras/decisões cruas sobre estado vivo e estado persistido;
- **W23** — separar melhor boot, startup, host binding, session setup e recovery.

---

## 7. Conclusão

Esta etapa não foi apenas “refactor cosmético”. Ela reduziu duas pequenas, porém persistentes,
fontes de nebulosidade:

1. **runtime vivo vs state-io**
2. **boot runner vs detalhes baixos do boundary SDK**

Com isso, a arquitetura fica mais consistente com a regra maior da revolução:

> o runtime do `agent` decide intenções e timing; o boundary do SDK e as façades semânticas decidem
> como materializar essas intenções sem vazar topologia interna.
