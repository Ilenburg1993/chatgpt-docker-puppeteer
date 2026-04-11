# PARTE-21D — Grafos de Dependências: Atual e Ideal

**Data**: 2026-04-12 | **Status**: BASELINE (grafos pré-Faixa H) | **Versão**: 2.0
**Scope**: Grafos de dependência inter-módulo de `src/copilot` — ponderados por volume de imports
**Referência**: PARTE-21A (baseline), PARTE-21B (ideal), PARTE-21C (roadmap), PARTE-21F (atual)

> **⚠️ ATENÇÃO**: Os grafos neste documento refletem o estado **pré-execução** das Faixas H–N.
> O grafo pós-execução inclui 3 módulos novos (types, services, plugins) e 165 deep imports
> (vs 233 original). Ver PARTE-21F para fan-out atualizado por módulo.

---

## 1. Resumo

Este documento apresenta 4 grafos Mermaid:

1. **Grafo Atual — Módulo-level (ponderado)**: cada aresta indica quantos imports existem
2. **Grafo Atual — File-level (hot-spots)**: os 30 arquivos com mais cross-module imports
3. **Grafo Ideal — Módulo-level (target Wave 3)**: topologia limpa pós-roadmap
4. **Grafo Ideal — Barrel-only**: como ficaria se todos imports usassem barrels

Além dos grafos, inclui análises de:
- Fan-in / Fan-out / Estabilidade (métrica de Martin)
- Coupling clusters (módulos excessivamente acoplados)
- Violation map (arestas ilegais marcadas)

---

## 2. Grafo Atual — Módulo-level (Ponderado)

```mermaid
graph TD
    %% Layer 0
    core["core/ (L0)<br/>16 files, 1921 LoC"]
    db["db/ (L0)<br/>3 files, 437 LoC"]

    %% Layer 1
    sdk["sdk/ (L1)<br/>40 files, 7696 LoC"]
    audit["audit/ (L1)<br/>5 files, 812 LoC"]

    %% Layer 2
    config["config/ (L2)<br/>7 files, 1418 LoC"]
    obs["observability/ (L2)<br/>22 files, 4535 LoC"]

    %% Layer 3
    hooks["hooks/ (L3)<br/>20 files, 3526 LoC"]
    tools["tools/ (L3)<br/>24 files, 6236 LoC"]
    bridges["bridges/ (L3)<br/>10 files, 2233 LoC"]

    %% Layer 4
    agent["agent/ (L4)<br/>54 files, 7775 LoC"]
    convhub["conversation-hub/ (L4)<br/>12 files, 2592 LoC"]
    channel["channel/ (L4)<br/>7 files, 1497 LoC"]

    %% Layer 5
    api["api/ (L5)<br/>21 files, 3309 LoC"]

    %% Layer 6
    terminal["terminal/ (L6)<br/>46 files, 7645 LoC"]

    %% === EDGES (weight = import count) ===

    %% From terminal (L6)
    terminal -->|"15"| obs
    terminal -->|"12"| convhub
    terminal -->|"11"| agent
    terminal -->|"9"| config
    terminal -->|"8"| bridges
    terminal -->|"5"| channel
    terminal -->|"4"| core
    terminal -->|"3"| sdk
    terminal -->|"3"| audit
    terminal -->|"1"| api

    %% From api (L5)
    api -->|"18"| obs
    api -->|"6"| config
    api -->|"4"| core
    api -->|"3"| sdk
    api -->|"2"| hooks
    api -->|"2"| bridges
    api -->|"2"| agent
    api -->|"1"| tools
    api -->|"1"| convhub
    api -->|"1"| channel
    api -->|"1"| audit

    %% From agent (L4)
    agent -->|"53"| obs
    agent -->|"20"| core
    agent -->|"19"| sdk
    agent -->|"8"| config
    agent -->|"5"| hooks
    agent -->|"4"| tools
    agent -->|"3"| audit

    %% From conversation-hub (L4)
    convhub -->|"9"| obs
    convhub -->|"8"| core
    convhub -->|"1"| db
    convhub -->|"1"| config

    %% From channel (L4)
    channel -->|"6"| obs
    channel -->|"3"| core
    channel -->|"1"| config

    %% From hooks (L3)
    hooks -->|"16"| obs
    hooks -->|"3"| audit
    hooks -->|"2"| sdk
    hooks -->|"1"| tools
    hooks -->|"1"| config

    %% From tools (L3)
    tools -->|"21"| obs
    tools -->|"10"| sdk
    tools -->|"6"| core
    tools -->|"5"| config
    tools -->|"2"| audit
    tools -->|"1"| db

    %% From bridges (L3)
    bridges -->|"6"| obs
    bridges -->|"2"| sdk
    bridges -->|"2"| config
    bridges -->|"1"| core

    %% From config (L2)
    config -->|"2"| sdk
    config -->|"2"| obs
    config -->|"1"| core

    %% From observability (L2)
    obs -->|"6"| sdk
    obs -->|"4"| config
    obs -->|"2"| core
    obs -->|"2"| audit

    %% From sdk (L1) — includes violations
    sdk -->|"5"| core
    sdk -->|"2"| config
    sdk -.->|"2 ⚠️"| hooks

    %% From audit (L1)
    audit -->|"3"| core
    audit -->|"1"| sdk

    %% From core (L0) — violation!
    core -.->|"1 🔴"| config

    %% From db (L0)
    db -->|"2"| core

    %% Styling
    classDef L0 fill:#e8f5e9,stroke:#2e7d32,stroke-width:2px
    classDef L1 fill:#e3f2fd,stroke:#1565c0,stroke-width:2px
    classDef L2 fill:#fff3e0,stroke:#ef6c00,stroke-width:2px
    classDef L3 fill:#f3e5f5,stroke:#7b1fa2,stroke-width:2px
    classDef L4 fill:#fce4ec,stroke:#c62828,stroke-width:2px
    classDef L5 fill:#e0f7fa,stroke:#00838f,stroke-width:2px
    classDef L6 fill:#f5f5f5,stroke:#424242,stroke-width:2px

    class core,db L0
    class sdk,audit L1
    class config,obs L2
    class hooks,tools,bridges L3
    class agent,convhub,channel L4
    class api L5
    class terminal L6
```

### 2.1 Arestas Violadoras (marcadas com tracejado)

| Aresta            | Peso | Direção | Tipo de violação             |
| ----------------- | ---- | ------- | ---------------------------- |
| `core` → `config` | 1    | L0→L2   | re-export `export { } from`  |
| `sdk` → `hooks`   | 2    | L1→L3   | re-export factory/permission |

### 2.2 Top 10 Arestas Mais Pesadas

| #   | From     | To      | Weight | Significado                           |
| --- | -------- | ------- | ------ | ------------------------------------- |
| 1   | agent    | obs     | 53     | Agent depende massivamente de logging |
| 2   | tools    | obs     | 21     | Tools logam profusamente              |
| 3   | agent    | core    | 20     | Agent usa muitos utilitários          |
| 4   | agent    | sdk     | 19     | Agent é wrapper principal do SDK      |
| 5   | api      | obs     | 18     | API loga tudo                         |
| 6   | hooks    | obs     | 16     | Hooks logam decisões                  |
| 7   | terminal | obs     | 15     | Terminal em segundo lugar de logging  |
| 8   | terminal | convhub | 12     | Terminal orquestra conversas          |
| 9   | terminal | agent   | 11     | Terminal controla agent lifecycle     |
| 10  | tools    | sdk     | 10     | Tools usam SDK para configs           |

**Insight**: `observability/` é o módulo mais "importado-para" com total de **146 imports recebidos**.
É o hub gravitacional do sistema.

---

## 3. Grafo Atual — File-level (Hot-spots)

### 3.1 Top 30 Arquivos com Mais Imports Cross-Module

```mermaid
graph LR
    subgraph "Hot Spots ≥5 cross-module imports"
        entry["agent/lifecycle/entry.js<br/>10 imports"]
        apiobs["api/express/observability.js<br/>10 imports"]
        sysmet["terminal/handlers/system-metrics.js<br/>7 imports"]
        syscfg["terminal/handlers/system-config.js<br/>7 imports"]
        mcpbr["bridges/mcp-tool-bridge.js<br/>6 imports"]
        toolsboot["agent/infra/tools-bootstrap.js<br/>6 imports"]
        introtools["tools/introspection-tools.js<br/>5 imports"]
        diagnose["terminal/commands/diagnose.js<br/>5 imports"]
        sesshooks["hooks/session-hooks.js<br/>5 imports"]
        chaninj["channel/inject.js<br/>5 imports"]
        sessinit["agent/session/initializer.js<br/>5 imports"]
        sesssetup["agent/lifecycle/session-setup.js<br/>5 imports"]
        agentlife["agent/lifecycle/agent-lifecycle.js<br/>5 imports"]
        loopman["agent/dialog/loop-manager.js<br/>5 imports"]
    end

    entry --> obs_logger["obs/logger"]
    entry --> sdk_barrel["sdk/index"]
    entry --> config_barrel["config/env"]
    entry --> hooks_barrel["hooks/factory"]
    entry --> audit_barrel["audit/pipeline"]

    apiobs --> obs_logger
    apiobs --> config_barrel
    apiobs --> core_barrel["core/errors"]
    apiobs --> sdk_barrel
```

### 3.2 Arquivos Hub (High Fan-out, Cross-Module)

| Arquivo                               | Cross-module imports | Módulos distintos |
| ------------------------------------- | -------------------- | ----------------- |
| `agent/lifecycle/entry.js`            | 10                   | 7                 |
| `api/express/observability.js`        | 10                   | 5                 |
| `terminal/handlers/system-metrics.js` | 7                    | 5                 |
| `terminal/handlers/system-config.js`  | 7                    | 5                 |
| `bridges/mcp-tool-bridge.js`          | 6                    | 4                 |
| `agent/infra/tools-bootstrap.js`      | 6                    | 5                 |

**`agent/lifecycle/entry.js`** é o arquivo com maior fan-out — ele é o bootstrap principal que
conecta agent, sdk, hooks, config, audit, observability e tools.

---

## 4. Intra-module Dependencies

Imports dentro do mesmo módulo (indicam complexidade interna):

| Módulo        | Intra-imports | Maior subgrafo interno                             |
| ------------- | ------------- | -------------------------------------------------- |
| hooks         | 22            | lib/ → session-hooks → registry → factory          |
| sdk           | 5             | index → config → types                             |
| channel       | 4             | inject → manager → adapter                         |
| core          | 4             | security/ → errors → constants                     |
| config        | 3             | env → session-config → index                       |
| observability | 3             | presets/ → registry → logger                       |
| agent         | ~8            | lifecycle/ → session/ → dialog/ → infra/           |
| terminal      | ~12           | commands/ → handlers/ → rendering/ → terminal-mode |

> `hooks/` tem o maior número de intra-imports (22), indicando alta coesão interna —
> os arquivos de hooks dependem fortemente uns dos outros.

---

## 5. Análise de Estabilidade (Martin's Instability Metric)

| Módulo              | Ca (Fan-in) | Ce (Fan-out) | I = Ce/(Ca+Ce) | Zona              |
| ------------------- | ----------- | ------------ | -------------- | ----------------- |
| `core/`             | 64          | 1            | 0.02           | Muito estável     |
| `db/`               | 2           | 2            | 0.50           | Neutro            |
| `audit/`            | 14          | 4            | 0.22           | Estável           |
| `sdk/`              | 53          | 14           | 0.21           | Estável           |
| `config/`           | 44          | 5            | 0.10           | Estável           |
| `observability/`    | 146         | 14           | 0.09           | Muito estável     |
| `hooks/`            | 31          | 23           | 0.43           | Neutro            |
| `tools/`            | 8           | 45           | 0.85           | Instável          |
| `bridges/`          | 10          | 11           | 0.52           | Neutro            |
| `channel/`          | 10          | 10           | 0.50           | Neutro            |
| `conversation-hub/` | 13          | 19           | 0.59           | Moderado instável |
| `agent/`            | 14          | 112          | 0.89           | Muito instável    |
| `api/`              | 1           | 41           | 0.98           | Muito instável    |
| `terminal/`         | 0           | 71           | 1.00           | Root (leaf)       |

> Ca = afferent coupling (imports recebidos de outros módulos)
> Ce = efferent coupling (imports feitos para outros módulos)
> I = instabilidade (0 = máxima estabilidade, 1 = máxima instabilidade)

**Observações**:
- `observability/` é o módulo mais estável (I=0.09) — praticamente read-only
- `api/` e `terminal/` são os mais instáveis — esperado para camadas superiores
- `tools/` com I=0.85 é surpreendentemente instável — depende de muitos módulos
- `agent/` com Ce=112 tem o maior fan-out absoluto (volume de imports que faz)

### 5.1 Stable Abstractions Principle (SAP) Check

Para um design saudável (Robert C. Martin), módulos estáveis devem ser abstratos:

| Módulo        | I (instab) | Abstração estimada | Zona  | Posição  |
| ------------- | ---------- | ------------------ | ----- | -------- |
| core          | 0.02       | Alta (contratos)   | OK    | ✅ SAP    |
| observability | 0.09       | Média (impl+API)   | Risco | ⚠️ Rígido |
| config        | 0.10       | Média (env+schema) | Risco | ⚠️ Rígido |
| sdk           | 0.21       | Alta (wrapper)     | OK    | ✅ SAP    |
| tools         | 0.85       | Baixa (impl)       | OK    | ✅ SAP    |
| agent         | 0.89       | Baixa (impl)       | OK    | ✅ SAP    |

> `observability` e `config` estão na "zona de rigidez" — são estáveis mas com implementação
> concreta. Um DI Container (Wave 2) resolve invertendo para interfaces.

---

## 6. Coupling Clusters

### 6.1 Cluster 1: Agent-Observability (Tightest Coupling)

```
agent/ ←(53)→ observability/ ←(16)→ hooks/ ←(5)→ agent/
```

O triângulo `agent ↔ observability ↔ hooks` tem **74 imports** combinados.
Este é o cluster mais acoplado do sistema. Observability é o pivot.

### 6.2 Cluster 2: Terminal-Conversation (Orchestration Coupling)

```
terminal/ ←(12)→ conversation-hub/
terminal/ ←(11)→ agent/
terminal/ ←(8)→ bridges/
terminal/ ←(5)→ channel/
```

Terminal importa de 5 módulos L3-L4 para orquestrar. Isso é esperado para L6,
mas o volume (36 imports) indica lógica de orquestração que deveria estar em `services/`.

### 6.3 Cluster 3: Tools-SDK (Operational Coupling)

```
tools/ ←(10)→ sdk/ ←(2)→ config/
tools/ ←(5)→ config/
```

Tools dependem do SDK para definir schemas e do config para parametrizar. 17 imports.

---

## 7. Grafo Ideal — Módulo-level (Target Wave 3+)

```mermaid
graph TD
    %% Layer 0
    types["types/ (L0) ★NEW"]
    core["core/ (L0)"]
    db["db/ (L0)"]

    %% Layer 1
    sdk["sdk/ (L1)"]
    audit["audit/ (L1)"]

    %% Layer 2
    config["config/ (L2)"]
    obs["observability/ (L2)"]

    %% Layer 3
    hooks["hooks/ (L3)"]
    tools["tools/ (L3)"]
    bridges["bridges/ (L3)"]
    plugins["plugins/ (L3) ★NEW"]

    %% Layer 4
    services["services/ (L4) ★NEW"]
    agent["agent/ (L4)"]
    convhub["conversation-hub/ (L4)"]
    channel["channel/ (L4)"]

    %% Layer 5
    api["api/ (L5)"]

    %% Layer 6
    terminal["terminal/ (L6)"]

    %% === IDEAL EDGES (barrel-only, no violations) ===

    %% terminal via services (primary)
    terminal -->|"via services"| services
    terminal --> obs
    terminal --> config

    %% api via services (primary)
    api -->|"via services"| services
    api --> obs
    api --> config
    api --> core

    %% services (facades)
    services --> agent
    services --> convhub
    services --> channel
    services --> hooks
    services --> tools
    services --> bridges
    services --> plugins

    %% agent
    agent --> sdk
    agent --> obs
    agent --> core
    agent --> config

    %% conversation-hub
    convhub --> obs
    convhub --> core
    convhub --> db

    %% channel
    channel --> obs
    channel --> core
    channel --> config

    %% hooks
    hooks --> audit
    hooks --> obs
    hooks --> sdk

    %% tools
    tools --> sdk
    tools --> obs
    tools --> core
    tools --> config

    %% plugins
    plugins --> tools
    plugins --> bridges
    plugins --> hooks

    %% bridges
    bridges --> obs
    bridges --> sdk
    bridges --> config

    %% config
    config --> core
    config --> obs

    %% observability
    obs --> audit
    obs --> core

    %% sdk
    sdk --> core

    %% audit
    audit --> core

    %% db
    db --> core

    %% types é L0, importado via JSDoc/typecheck, sem runtime edges visíveis

    %% Styling
    classDef L0 fill:#e8f5e9,stroke:#2e7d32,stroke-width:2px
    classDef L1 fill:#e3f2fd,stroke:#1565c0,stroke-width:2px
    classDef L2 fill:#fff3e0,stroke:#ef6c00,stroke-width:2px
    classDef L3 fill:#f3e5f5,stroke:#7b1fa2,stroke-width:2px
    classDef L4 fill:#fce4ec,stroke:#c62828,stroke-width:2px
    classDef L5 fill:#e0f7fa,stroke:#00838f,stroke-width:2px
    classDef L6 fill:#f5f5f5,stroke:#424242,stroke-width:2px
    classDef NEW fill:#fff9c4,stroke:#f9a825,stroke-width:3px

    class core,db,types L0
    class sdk,audit L1
    class config,obs L2
    class hooks,tools,bridges,plugins L3
    class agent,convhub,channel,services L4
    class api L5
    class terminal L6
    class types,services,plugins NEW
```

### 7.1 Mudanças Chave no Grafo Ideal

| Aspecto                    | Atual                 | Ideal                               |
| -------------------------- | --------------------- | ----------------------------------- |
| `core → config` (violação) | 1 re-export           | **REMOVIDO**                        |
| `sdk → hooks` (violação)   | 2 re-exports          | **REMOVIDO**                        |
| `api/ fan-out`             | 11 módulos diretos    | **4** (services, obs, config, core) |
| `terminal/ fan-out`        | 10 módulos diretos    | **3** (services, obs, config)       |
| `services/` (novo)         | Inexiste              | **Facade** absorvendo complexidade  |
| `plugins/` (novo)          | Inexiste              | **Registry** para extensibilidade   |
| `types/` (novo)            | Inexiste              | **Shared types** L0                 |
| Arestas com peso > 20      | 5 (agent→obs:53, etc) | **0** (dispersão via DI+bus)        |

### 7.2 Grafo de Violações: Atual vs Ideal

```
ATUAL:
  core ─🔴─→ config   (L0→L2, re-export)
  sdk  ─🟠─→ hooks    (L1→L3, re-export)
  sdk  ─🟠─→ config   (L1→L2, re-export via sdk/config.js)

IDEAL:
  (zero violações — todas arestas são downward ou same-layer)
```

---

## 8. Grafo Ideal — Barrel-Only View

Se todos os 233 deep imports migrassem para barrel imports:

```mermaid
graph TD
    subgraph "Barrel-Only Import Map"
        core_b["#copilot/core"]
        db_b["#copilot/db"]
        sdk_b["#copilot/sdk"]
        audit_b["#copilot/audit"]
        config_b["#copilot/config"]
        obs_b["#copilot/observability"]
        hooks_b["#copilot/hooks"]
        tools_b["#copilot/tools"]
        bridges_b["#copilot/bridges"]
        agent_b["#copilot/agent"]
        channel_b["#copilot/channel"]
        convhub_b["#copilot/conversation-hub"]
        api_b["#copilot/api"]
        terminal_b["#copilot/terminal"]
    end

    terminal_b --> agent_b
    terminal_b --> convhub_b
    terminal_b --> bridges_b
    terminal_b --> channel_b
    terminal_b --> obs_b
    terminal_b --> config_b
    terminal_b --> sdk_b
    terminal_b --> audit_b
    terminal_b --> core_b

    api_b --> agent_b
    api_b --> convhub_b
    api_b --> channel_b
    api_b --> bridges_b
    api_b --> hooks_b
    api_b --> tools_b
    api_b --> obs_b
    api_b --> config_b
    api_b --> sdk_b
    api_b --> audit_b
    api_b --> core_b

    agent_b --> sdk_b
    agent_b --> hooks_b
    agent_b --> tools_b
    agent_b --> obs_b
    agent_b --> config_b
    agent_b --> core_b
    agent_b --> audit_b

    convhub_b --> obs_b
    convhub_b --> core_b
    convhub_b --> db_b
    convhub_b --> config_b

    channel_b --> obs_b
    channel_b --> core_b
    channel_b --> config_b

    hooks_b --> audit_b
    hooks_b --> obs_b
    hooks_b --> sdk_b
    hooks_b --> config_b
    hooks_b --> tools_b

    tools_b --> sdk_b
    tools_b --> obs_b
    tools_b --> core_b
    tools_b --> config_b
    tools_b --> audit_b
    tools_b --> db_b

    bridges_b --> obs_b
    bridges_b --> sdk_b
    bridges_b --> config_b
    bridges_b --> core_b

    config_b --> core_b
    config_b --> obs_b
    config_b --> sdk_b

    obs_b --> audit_b
    obs_b --> core_b
    obs_b --> config_b
    obs_b --> sdk_b

    sdk_b --> core_b

    audit_b --> core_b
    audit_b --> sdk_b

    db_b --> core_b
```

**Neste cenário**, cada módulo tem no máximo ~8 conexões de barrel, o que torna o grafo **plano e
previsível**. O encapsulamento é mantido pois internamente os arquivos de cada módulo importam
livremente entre si, mas cross-module é sempre via barrel.

---

## 9. Tabela Comparativa de Métricas de Grafo

| Métrica                   | Atual       | Ideal (W3)   | Delta |
| ------------------------- | ----------- | ------------ | ----- |
| Total de arestas (module) | ~55         | ~40          | -27%  |
| Arestas violadoras        | 4           | 0            | -100% |
| Aresta mais pesada        | 53 (ag→obs) | ≤15          | -72%  |
| Max fan-out (module)      | 11 (api)    | 4 (api)      | -64%  |
| Max fan-in (module)       | 146 (obs)   | ~80 (obs)    | -45%  |
| Deep imports              | 233         | ≤20          | -91%  |
| Barrel imports            | 88          | ~300         | +241% |
| Coupling clusters         | 3 (tight)   | 0 (loose)    | -100% |
| Módulos com I > 0.8       | 3           | 2 (api,term) | -33%  |
| Unique edges (sem peso)   | ~45         | ~35          | -22%  |

---

## 10. Indicadores de Progresso do Grafo

Para cada Wave do roadmap (PARTE-21C), o grafo deve convergir:

| Wave | Violações | Deep/Barrel ratio | Max fan-out | Coupling clusters |
| ---- | --------- | ----------------- | ----------- | ----------------- |
| 0    | 4→**0**   | 73%/23%→73%/23%   | 11          | 3                 |
| 1    | 0         | **≤20%/≥80%**     | 11          | 2                 |
| 2    | 0         | ≤15%/≥85%         | 11          | 1                 |
| 3    | 0         | ≤5%/≥90%          | **≤4**      | **0**             |

---

## 11. Conclusão

Os grafos revelam que o sistema atual, apesar de limpo em violações de camada (pelo CI), tem
**acoplamento fino excessivo** (233 deep imports), **clusters de coupling** fortemente acoplados,
e **fan-out desbalanceado** (api/ com 11 deps, agent/ com 112 imports feitos).

O grafo ideal, alcançável progressivamente pelas Waves 0-3 do roadmap, elimina violações,
introduz `services/` para absorver fan-out de api/ e terminal/, e migra para barrel-first para
reduzir acoplamento fino a ≤20 deep imports (allow-listed).
