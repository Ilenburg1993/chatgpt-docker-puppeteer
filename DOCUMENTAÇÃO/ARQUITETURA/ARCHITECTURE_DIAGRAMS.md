# Diagramas da Arquitetura Oficial

**Propósito**: oferecer uma referência visual alinhada à topologia atual do runtime.  
**Status documental**: Canônico de apoio.  
**Público**: engenharia, manutenção, auditoria e agentes de IA.  
**Quando consultar**: ao precisar visualizar a relação entre `kernel`, `orchestrator`, `agent`,
`driver`, `infra` e as superfícies externas.  
**Documento-mestre relacionado**: [ARCHITECTURE.md](./ARCHITECTURE.md).  
**Última atualização**: 28 de fevereiro de 2026.

## Visão geral

Os diagramas abaixo refletem a arquitetura vigente. Eles já incluem `src/agent/` como plano
operacional do runtime e não descrevem versões históricas ou superseded.

## Mapa documental da arquitetura

```mermaid
flowchart LR
    root["ARQUITETURA/"]
    baseline["Raiz: baseline, fluxos e diagramas"]
    subs["SUBSISTEMAS/: deep-dives canônicos"]
    spec["ESPECIALIZADOS/: recortes não-baseline"]
    hist["ARQUIVO_MORTO/: histórico arquivado"]

    root --> baseline
    root --> subs
    root --> spec
    root -. histórico .-> hist
```

## Contexto do sistema

```mermaid
flowchart LR
    user["Usuário / Operador"]
    llm["LLMs e serviços externos"]
    chrome["Chrome externo + DevTools"]
    runtime["Runtime principal"]
    aux["Serviços auxiliares"]

    user -->|HTTP / WebSocket| runtime
    runtime -->|CDP / WebSocket| chrome
    runtime -->|HTTPS / APIs / tools| llm
    aux -->|apoio operacional| runtime
```

## Planos arquiteturais do runtime

```mermaid
flowchart TD
    main["src/main.js"]
    core["src/core"]
    nerv["src/nerv"]
    kernel["src/kernel"]
    orchestrator["src/orchestrator"]
    agent["src/agent"]
    driver["src/driver"]
    infra["src/infra"]
    missions["src/missions"]
    server["src/server"]
    dashboard["src/dashboard-ui"]
    integration["src/integration"]
    gateway["src/inference_gateway"]
    audit["src/audit_agent"]
    shared["src/shared + src/state + src/types + src/logic + src/validation"]

    main --> core
    main --> nerv
    main --> kernel
    main --> agent
    main --> server
    main --> missions
    main --> integration
    main --> gateway
    main --> audit

    kernel <--> nerv
    orchestrator <--> nerv
    agent <--> nerv
    driver <--> nerv
    server <--> nerv
    infra <--> nerv

    kernel --> orchestrator
    agent --> kernel
    agent --> missions
    agent --> infra
    orchestrator --> driver
    driver --> infra
    server --> dashboard
    integration --> server
    gateway --> server
    audit --> server
    shared -. suporte transversal .-> kernel
    shared -. suporte transversal .-> agent
    shared -. suporte transversal .-> server
```

## Fluxo de despacho de tarefa

```mermaid
sequenceDiagram
    participant Queue as src/agent/queue_worker
    participant Kernel as src/kernel
    participant Orchestrator as src/orchestrator
    participant Driver as src/driver
    participant Infra as src/infra
    participant NERV as src/nerv

    Queue->>Infra: claim de tarefa e contexto
    Queue->>Kernel: executeTask()
    Kernel->>NERV: publica/computa envelopes
    Kernel->>Orchestrator: resolve estratégia
    Orchestrator->>Driver: executa ação/step
    Driver->>Infra: usa pool, locks, storage, artifacts
    Driver->>NERV: publica resultado e telemetria
    NERV->>Kernel: feedback e continuidade
```

## Fluxo de missão

```mermaid
sequenceDiagram
    participant Missions as src/missions
    participant Runner as src/agent/mission_runner
    participant Planner as src/agent/mission_planner_processor
    participant Worker as src/agent/task_orchestration_worker
    participant Queue as src/agent/queue_worker

    Missions->>Runner: missão em RUNNING
    Runner->>Queue: cria tarefas do workflow
    Queue->>Worker: tarefa concluída alimenta pós-processamento
    Worker->>Planner: resultado pode gerar nova proposta/step
    Planner->>Queue: cria nova tarefa quando aplicável
```

## Mapa visual de diretórios estáveis

```mermaid
flowchart LR
    repo["Repositório"]
    src["src/ (runtime + serviços auxiliares)"]
    tests["tests/ (harness e validação)"]
    scripts["scripts/ (automação)"]
    docs["DOCUMENTAÇÃO/ (hub canônico)"]
    gh[".github/ (instruções e workflows)"]
    aux["assistant/ + agents/ + tools/ (suporte)"]

    repo --> src
    repo --> tests
    repo --> scripts
    repo --> docs
    repo --> gh
    repo --> aux
```

## Como manter os diagramas

- Se um novo plano estrutural surgir, ele deve aparecer aqui.
- Se `src/agent/` ganhar novos loops centrais, atualize o diagrama de fluxo.
- Se a taxonomia física de `ARQUITETURA/` mudar, atualize o mapa documental acima.
- Mantenha `DIAGRAMS/diagrama.mmd` e `DIAGRAMS/diagrams/architecture.mmd` coerentes com esta página.
- Não reintroduza diagramas históricos como se fossem baseline atual.
