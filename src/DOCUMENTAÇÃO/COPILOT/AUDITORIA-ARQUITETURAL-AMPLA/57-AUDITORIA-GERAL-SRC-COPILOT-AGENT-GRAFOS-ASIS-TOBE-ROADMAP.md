# 57 — Auditoria geral de `src/copilot/agent`: grafos AS-IS, TO-BE e roadmap consolidado

Data: 2026-04-29 Escopo: `src/copilot/agent/**` Base metodológica: continuidade dos checkpoints
42–56 + inspeção estrutural atual + medição factual de dependências.

---

## 1) Resumo executivo

`src/copilot/agent` está em **estágio avançado de convergência semântica** (especialmente em
runtime-state, lifecycle SDK e boot wiring), mas ainda apresenta **densidade alta de acoplamento
transversal** entre eixos de orquestração, estado e observabilidade.

Medições atuais (madge sobre `src/copilot/agent`):

- nós: **178**
- arestas: **431**
- ciclos detectados: **0** (ótimo)
- hotspots de fan-out:
  - `always-alive.js` (18)
  - `facades/index.js` (16)
  - `dialog/loop-manager.js` (15)
  - `lifecycle/agent-lifecycle.js` (14)
- hotspots de fan-in:
  - `ports/observability-port.js` (35)
  - `../config/agent.js` (23)
  - `../core/error-handlers.js` (22)
  - `../tools/logger.js` (21)
  - `../tools/tool-factory.js` (18)
  - `facades/agent-sdk-access.js` (15)

Leitura arquitetural: o módulo já saiu da fase de "acoplamento circular bruto", mas ainda precisa
reduzir pontos de concentração (especialmente observabilidade e root orchestration).

---

## 2) Grafo AS-IS — macro-topologia atual (subdomínios)

### 2.1 Grafo macro (alto nível)

```dot
digraph AgentAsIsMacro {
  rankdir=LR;
  node [shape=box, style=rounded];

  root [label="agent/root\n(always-alive, runtime-registry, health-check, ...)"];
  dialog [label="agent/dialog"];
  session [label="agent/session"];
  lifecycle [label="agent/lifecycle"];
  facades [label="agent/facades"];
  ports [label="agent/ports"];
  infra [label="agent/infra"];
  messaging [label="agent/messaging"];
  state [label="agent/state"];
  external [label="copilot externos\n(core/config/tools/obs/...)", shape=ellipse];

  root -> facades [label="14"];
  root -> dialog [label="4"];
  root -> session [label="3"];
  root -> lifecycle [label="3"];
  root -> ports [label="7"];
  root -> external [label="8"];

  dialog -> dialog [label="20"];
  dialog -> facades [label="4"];
  dialog -> ports [label="6"];
  dialog -> lifecycle [label="1"];
  dialog -> external [label="12"];

  session -> session [label="14"];
  session -> facades [label="6"];
  session -> ports [label="13"];
  session -> lifecycle [label="2"];
  session -> root [label="5"];
  session -> external [label="15"];

  lifecycle -> facades [label="7"];
  lifecycle -> session [label="4"];
  lifecycle -> ports [label="11"];
  lifecycle -> root [label="3"];
  lifecycle -> external [label="10"];

  facades -> facades [label="23"];
  facades -> session [label="4"];
  facades -> ports [label="4"];
  facades -> root [label="2"];

  infra -> ports [label="5"];
  infra -> messaging [label="1"];

  state -> lifecycle [label="1"];
  state -> ports [label="1"];

  ports -> external [label="12"];
}
```

### 2.2 Interpretação

1. **Sem ciclos explícitos**: melhoria forte de robustez estrutural.
2. **`root` ainda denso**: melhor que antes, mas com papel de orchestration + compat ainda elevado.
3. **`facades` já é backbone real**: bom sinal de convergência semântica.
4. **`ports/observability-port` com fan-in muito alto**: risco de virar “semi-god port”.
5. **dependência externa ainda grande**: esperado por fase, mas alvo de redução nas próximas ondas.

---

## 3) Grafo AS-IS — fluxo operacional crítico (boot → loop → health → shutdown)

```dot
digraph AgentOperationalFlowAsIs {
  rankdir=LR;
  node [shape=box, style=rounded];

  entry [label="lifecycle/entry.js"];
  agent [label="always-alive.js"];
  setup [label="lifecycle/session-setup.js"];
  bootWiring [label="session/boot-wiring.js"];
  bootSteps [label="session/boot-steps.js"];
  sdkFacade [label="facades/agent-sdk-access.js"];
  runtimeState [label="facades/agent-runtime-state.js"];
  loopMgr [label="dialog/loop-manager.js"];
  turnExec [label="dialog/turn-executor.js"];
  health [label="health-check.js"];
  cleanup [label="session/cleanup.js"];

  entry -> agent;
  agent -> setup;
  setup -> bootWiring;
  bootWiring -> bootSteps;
  bootWiring -> sdkFacade [label="lifecycle/quota bridges"];
  bootSteps -> runtimeState [label="dialog flags/shadow"];
  agent -> loopMgr;
  loopMgr -> turnExec;
  loopMgr -> runtimeState [label="bootstrap/resume/dialog state"];
  turnExec -> runtimeState [label="pending turn marker"];
  health -> runtimeState [label="aggregated runtime snapshot"];
  cleanup -> sdkFacade [label="provider/session operations"];
}
```

Interpretação: o fluxo principal está semanticamente melhor delimitado do que nas fases anteriores
(42–56), com `runtime-state` e `sdk-access` sendo seams reais de domínio.

---

## 4) Grafo TO-BE — situação ideal proposta

```dot
digraph AgentToBeTarget {
  rankdir=TB;
  node [shape=box, style=rounded];

  subgraph cluster_orchestration {
    label="Orchestration Layer (agent runtime)";
    color=lightgrey;
    O1 [label="always-alive (thin)"];
    O2 [label="lifecycle orchestrators"];
    O3 [label="dialog orchestrators"];
  }

  subgraph cluster_semantic_seams {
    label="Semantic Seams Layer";
    color=lightblue;
    S1 [label="agent-runtime-state facade"];
    S2 [label="agent-sdk-access facade"];
    S3 [label="agent-runtime-controls facade"];
    S4 [label="agent-health-access facade"];
  }

  subgraph cluster_ports {
    label="Ports / Contracts";
    color=lightyellow;
    P1 [label="observability-port"];
    P2 [label="tool-port"];
    P3 [label="runtime contracts"];
  }

  subgraph cluster_infra {
    label="Infra / Persistence / Vendor";
    color=lightgreen;
    I1 [label="state-io + snapshots"];
    I2 [label="sdk/session wrappers"];
    I3 [label="core/config/tools externos"];
  }

  O1 -> O2;
  O1 -> O3;
  O2 -> S2;
  O2 -> S1;
  O3 -> S1;
  O3 -> S3;
  O3 -> S4;

  S1 -> I1;
  S2 -> I2;
  S3 -> P3;
  S4 -> P1;

  O1 -> P1;
  O1 -> P2;

  P1 -> I3;
  P2 -> I3;
  I2 -> I3;
}
```

Princípios TO-BE:

1. **orquestração não persiste estado cru**;
2. **orquestração não fala com SDK vanilla diretamente**;
3. **health/status derivam de snapshots semânticos agregados**;
4. **`always-alive` atua como coordenador fino (não como owner de detalhes)**.

---

## 5) Auditoria de maturidade atual (`src/copilot/agent`)

### 5.1 Pontos já convergidos (consistentes com 42–56)

- lifecycle SDK com seam dedicado (`agent-sdk-access`);
- recuperação de dialog em boot sem `state-io` inline;
- `loop-manager` e `turn-executor` convergidos para runtime-state semântico;
- cleanup com proteção de sessão foreground/last-session;
- health com leitura semântica agregada.

### 5.2 Gaps estruturais restantes

1. **P6 — Presentation monopoly incompleto**
   - status/health/lifecycle ainda montam payloads com padrões parcialmente repetidos.
2. **Hotspot de observabilidade em ports**
   - alto fan-in no `observability-port` pede modularização fina por domínio de sinal.
3. **Root orchestration ainda espesso**
   - `always-alive` evoluiu, porém ainda acumula algumas superfícies transitórias.
4. **SDK model/session debt adjacente**
   - drift residual entre lifecycle, registry e resolução de modelo ainda exige convergência.

---

## 6) Roadmap consolidado (o que falta, junto ao que já avançou)

### Faixa R1 (curto prazo, baixo risco, alto retorno)

- **R1.1**: concluir P6 no `presentation/` (meta/runtime projection unificada, sem montagem paralela
  redundante);
- **R1.2**: reduzir duplicações de metadata runtime em payloads HTTP/SSE;
- **R1.3**: travar contracts de projection com testes estruturais adicionais.

### Faixa R2 (médio prazo, transformação de ownership)

- **R2.1**: fatiar `observability-port` por domínios (`lifecycle`, `dialog`, `quota`, `errors`);
- **R2.2**: reduzir fan-out de `always-alive` com extração de orquestradores de fase;
- **R2.3**: consolidar pipeline boot/start em steps declarativos com relatórios estáveis.

### Faixa R3 (profundidade arquitetural)

- **R3.1**: convergência final SDK session/model lifecycle (registry + cache + resolution);
- **R3.2**: congelar API semântica dos facades com “seam contracts” anti-regressão;
- **R3.3**: reforçar governança de imports (proibir bypass de seams por novos pontos).

---

## 7) Plano de execução recomendado (próximas ondas)

1. **Onda imediata (já em curso)**: P6 em `presentation` + fechamento de metadata runtime
   compartilhada.
2. **Onda seguinte**: descompressão de `always-alive` e de `observability-port`.
3. **Onda subsequente**: convergência final de SDK model/session debts.

Com isso, `src/copilot/agent` transita de “runtime robusto com hotspots de concentração” para
“runtime modular com ownership semântico estável e baixo acoplamento transversal”.
