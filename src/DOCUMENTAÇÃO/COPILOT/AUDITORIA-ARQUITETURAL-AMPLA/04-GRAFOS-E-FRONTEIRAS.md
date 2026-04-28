# 04 — Grafos e Fronteiras de `src/copilot`

Este documento concentra os **grafos iniciais da pré-auditoria**, com foco em:

1. topologia global por camadas;
2. fluxo operacional canônico do runtime;
3. zonas de fronteira críticas a investigar;
4. pipeline documental da auditoria ampla.

> Estes grafos são propositalmente **macroestruturais**. O inventário exaustivo de pastas e arquivos
> está nos anexos 01–03.

---

## 1. Grafo macroestrutural atual de `src/copilot`

```mermaid
flowchart TB
    subgraph ROOT["src/copilot/"]
        R1["README.md"]
        R2["agent.js\ncompat entrypoint"]
        R3["bootstrap.js\ncanonical boot entrypoint"]
        R4["runtime-wiring.js\ncomposition root"]
    end

    subgraph L0["Layer 0 — base / boot / primitives"]
        boot["boot/"]
        core["core/"]
        types["types/"]
        db["db/"]
        dialog["dialog/"]
    end

    subgraph L1["Layer 1–2 — config, SDK, event grammar and translation"]
        config["config/"]
        sdk["sdk/"]
        events["events/"]
        handlers["event-handlers/"]
    end

    subgraph L2["Layer 3 — policies, tools and external adapters"]
        hooks["hooks/"]
        tools["tools/"]
        bridges["bridges/"]
        plugins["plugins/"]
        infra["infra/"]
        audit["audit/"]
        observability["observability/"]
    end

    subgraph L3["Layer 4–5 — runtime and persistent conversation domain"]
        agent["agent/"]
        channel["channel/"]
        hub["conversation-hub/"]
    end

    subgraph L4["Layer 6–7 — shared edge projections and outer edges"]
        presentation["presentation/"]
        server["server/"]
        terminal["terminal/"]
    end

    artifacts["artifacts inside src/copilot\n.github/ + logs/"]

    ROOT --> L0
    ROOT --> L1
    ROOT --> L2
    ROOT --> L3
    ROOT --> L4
    ROOT -.contains.-> artifacts
```

---

## 2. Fluxo operacional canônico declarado hoje

```mermaid
flowchart LR
    Vendor["@github/copilot-sdk"] --> SDK["sdk/"]
    SDK --> EH["event-handlers/"]
    EH --> AG["agent/"]
    AG --> PR["presentation/"]
    PR --> SV["server/"]
    PR --> TM["terminal/"]

    SDK --> HK["hooks/"]
    HK --> AG

    SDK --> TL["tools/"]
    TL --> AG

    AG <--> HUB["conversation-hub/"]
    AG --> OBS["observability/"]
    EH --> OBS
    AG --> AUD["audit/"]
    BR["bridges/"] --> AG
    INF["infra/"] --> SV
    INF --> TM
```

### Leitura do grafo

- o **vendor SDK** deveria entrar apenas por `sdk/`;
- a **tradução de eventos vanilla** deveria ocorrer primeiro em `event-handlers/`;
- o **runtime vivo** deveria ser propriedade do `agent/`;
- o **consumo compartilhado de borda** deveria subir por `presentation/`;
- `server/` e `terminal/` deveriam consumir projeções/handlers, não reinventar semântica do runtime;
- `hooks/`, `tools/`, `bridges/`, `observability/` e `audit/` são áreas transversais, mas com papéis
  distintos que a auditoria precisa tornar inequivocamente explícitos.

---

## 3. Grafo das fronteiras mais críticas a auditar

```mermaid
flowchart TD
    sdk["sdk/"] -->|vanilla capabilities| agent["agent/"]
    sdk -->|session hooks / permission / elicitation| hooks["hooks/"]
    sdk -->|SessionEvent vanilla| eh["event-handlers/"]

    hooks -->|policy / callback| agent
    eh -->|translated signals| agent
    events["events/"] -->|catalog / schemas| eh
    events -->|catalog / schemas| observability["observability/"]

    agent -->|shared runtime access| presentation["presentation/"]
    presentation --> server["server/"]
    presentation --> terminal["terminal/"]

    agent <--> hub["conversation-hub/"]
    tools["tools/"] --> sdk
    bridges["bridges/"] --> agent
    audit["audit/"] --> observability

    confusion1["Q1: sdk vs agent\nquem é owner da capability?"]
    confusion2["Q2: hooks vs event-handlers vs events\npolicy? tradução? catálogo?"]
    confusion3["Q3: agent vs presentation\nsource-of-truth vs projection?"]
    confusion4["Q4: observability vs audit vs logs\nmedir? rastrear? auditar? persistir?"]
    confusion5["Q5: conversation-hub vs agent/session\nquem é dono da sessão persistida?"]

    sdk -.-> confusion1
    agent -.-> confusion1
    hooks -.-> confusion2
    eh -.-> confusion2
    events -.-> confusion2
    agent -.-> confusion3
    presentation -.-> confusion3
    observability -.-> confusion4
    audit -.-> confusion4
    hub -.-> confusion5
    agent -.-> confusion5
```

---

## 4. Grafo do plano de execução da auditoria ampla

```mermaid
flowchart TB
    P0["Faixa 0\nPré-auditoria + baseline"] --> P1["Faixa 1\nTaxonomia e ownership por módulo"]
    P1 --> P2["Faixa 2\nComposition roots, boot e wiring"]
    P2 --> P3["Faixa 3\nSDK e fronteira vanilla"]
    P3 --> P4["Faixa 4\nAgent runtime"]
    P4 --> P5["Faixa 5\nHooks, events e tradução de sinais"]
    P5 --> P6["Faixa 6\nPresentation, server e terminal"]
    P6 --> P7["Faixa 7\nHub, DB, logs e artefatos"]
    P7 --> P8["Faixa 8\nTools, bridges, infra, channel, plugins"]
    P8 --> P9["Faixa 9\nObservability e audit"]
    P9 --> P10["Faixa 10\nSituação ideal + roadmap final"]
```

---

## 5. Observações de uso destes grafos

1. Eles **não substituem** o inventário de arquivos; eles organizam o raciocínio arquitetural.
2. Eles devem ser lidos junto com os anexos 01–03.
3. Durante a auditoria ampla, este arquivo deverá crescer com:
   - grafos por subsistema;
   - grafos de comunicação real vs. ideal;
   - grafos de migração por faixas/fases;
   - grafos específicos de `sdk ↔ agent ↔ hooks ↔ presentation ↔ terminal/server`.
