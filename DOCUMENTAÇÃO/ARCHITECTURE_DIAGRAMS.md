# Architecture Diagrams - Visual Reference

> **Renderização**: Estes diagramas Mermaid são renderizados automaticamente no GitHub e VS Code com extensões adequadas.

## 📐 Visão Geral - Contexto C4

```mermaid
C4Context
    title Sistema Autônomo de Controle de LLMs - Contexto

    Person(user, "Usuário/Desenvolvedor", "Cria tarefas e monitora execução")
    System(agent, "Agent System", "Sistema autônomo de controle de LLMs via browser automation")
    System_Ext(chrome, "Chrome Browser", "Navegador com remote debugging (porta 9222)")
    System_Ext(llm, "LLM Services", "ChatGPT, Gemini, etc")

    Rel(user, agent, "Envia tarefas, monitora", "HTTP/WebSocket")
    Rel(agent, chrome, "Controla via CDP", "WebSocket")
    Rel(chrome, llm, "Acessa", "HTTPS")
```

## 🏗️ Arquitetura de Containers

```mermaid
C4Container
    title Containers do Sistema

    Container(dashboard, "Dashboard Web", "Express + Socket.io", "Interface de monitoramento e controle")
    Container(engine, "Execution Engine", "Node.js", "Loop principal de processamento de tarefas")
    Container(queue, "Queue Manager", "File-based", "Gerenciamento de fila em JSON")
    Container(driver, "Driver System", "Puppeteer", "Abstração para diferentes targets")

    ContainerDb(fila, "Task Queue", "JSON Files", "fila/*.json")
    ContainerDb(respostas, "Response Store", "Text Files", "respostas/*.txt")
    ContainerDb(config, "Configuration", "JSON", "config.json, dynamic_rules.json")

    System_Ext(chrome, "Chrome CDP", "Remote debugging")

    Rel(dashboard, engine, "Monitora/Controla", "WebSocket")
    Rel(engine, queue, "Lê tarefas", "File I/O")
    Rel(engine, driver, "Executa", "API")
    Rel(driver, chrome, "Automatiza", "CDP/WebSocket")
    Rel(queue, fila, "Persiste", "File I/O")
    Rel(engine, respostas, "Salva resultados", "File I/O")
    Rel(engine, config, "Lê configurações", "File I/O")
```

## 🔄 Fluxo de Processamento de Tarefas

```mermaid
sequenceDiagram
    participant User
    participant Dashboard
    participant Engine
    participant Queue
    participant Driver
    participant Chrome
    participant LLM

    User->>Dashboard: Cria tarefa (HTTP POST)
    Dashboard->>Queue: Salva task.json
    Queue-->>Dashboard: task_created event
    Dashboard-->>User: Confirmação

    loop Polling Loop
        Engine->>Queue: getNextTask()
        Queue-->>Engine: task
        Engine->>Queue: acquireLock(task)

        Engine->>Driver: execute(task)
        Driver->>Chrome: connect(CDP)
        Chrome-->>Driver: page

        Driver->>Chrome: navigate(LLM_URL)
        Driver->>Chrome: typePrompt(text)
        Driver->>Chrome: submit()

        loop Incremental Collection
            Chrome->>LLM: HTTP Request
            LLM-->>Chrome: Response chunks
            Driver->>Chrome: readResponse()
            Chrome-->>Driver: response chunk
            Driver->>Engine: progress update
            Engine->>Dashboard: emit progress
            Dashboard-->>User: Real-time update
        end

        Driver-->>Engine: final response
        Engine->>Engine: validate(response)
        Engine->>Queue: saveResponse(task)
        Engine->>Queue: releaseLock(task)
        Engine->>Dashboard: emit completed
        Dashboard-->>User: Task done notification
    end
```

## 🧩 Componentes do Driver System

```mermaid
classDiagram
    class BaseDriver {
        <<abstract>>
        +execute(task)
        +connect()
        +disconnect()
        #beforeExecution()
        #afterExecution()
    }

    class ChatGPTDriver {
        -analyzer
        -inputResolver
        -submissionController
        -biomechanics
        -recovery
        -stabilizer
        +execute(task)
        +waitForResponse()
    }

    class Analyzer {
        +detectInputElements()
        +detectSubmitButton()
        +verifyPageState()
    }

    class InputResolver {
        +typeText(selector, text)
        +pasteText(selector, text)
        +clearInput(selector)
    }

    class SubmissionController {
        +submitViaButton()
        +submitViaKeyboard()
        +waitForSubmission()
    }

    class BiomechanicsEngine {
        +humanLikeTyping()
        +randomizedDelay()
        +cursorMovement()
    }

    class RecoverySystem {
        +handleErrors()
        +retryOperation()
        +captureForensics()
    }

    class Stabilizer {
        +waitForStability()
        +waitForNavigation()
        +waitForElement()
    }

    BaseDriver <|-- ChatGPTDriver
    ChatGPTDriver --> Analyzer
    ChatGPTDriver --> InputResolver
    ChatGPTDriver --> SubmissionController
    ChatGPTDriver --> BiomechanicsEngine
    ChatGPTDriver --> RecoverySystem
    ChatGPTDriver --> Stabilizer
```

## 📊 Estados de Tarefa (State Machine)

```mermaid
stateDiagram-v2
    [*] --> PENDING: Task created
    PENDING --> RUNNING: Lock acquired
    RUNNING --> VALIDATING: Response collected
    VALIDATING --> DONE: Valid
    VALIDATING --> FAILED: Invalid
    FAILED --> RETRY: Retry available
    RETRY --> RUNNING: Lock acquired
    FAILED --> DEAD: Max retries
    DONE --> [*]
    DEAD --> [*]

    note right of RUNNING
        - Lock file active
        - PID tracked
        - Progress updates
    end note

    note right of FAILED
        - Classified error
        - Forensics saved
        - Backoff applied
    end note
```

## 🔐 Sistema de Locks (Concorrência)

```mermaid
flowchart TD
    A[Task available] --> B{Lock exists?}
    B -->|No| C[Create lock file]
    B -->|Yes| D{PID alive?}
    D -->|Yes| E[Skip task]
    D -->|No| F[Break orphan lock]
    F --> C
    C --> G{Lock acquired?}
    G -->|Yes| H[Process task]
    G -->|No| E
    H --> I[Release lock]
    I --> J[Task complete]
    E --> K[Next task]

    style H fill:#90EE90
    style E fill:#FFB6C1
    style F fill:#FFD700
```

## 🌐 Arquitetura NERV (IPC)

```mermaid
graph TB
    subgraph "NERV System"
        Transport[Transport Layer<br/>WebSocket + Reconnect]
        Message[Message Layer<br/>Emission + Reception]
        Buffer[Buffering Layer<br/>Queues + Backpressure]
        Correlation[Correlation Layer<br/>Context Management]

        Transport --> Message
        Message --> Buffer
        Buffer --> Correlation
    end

    subgraph "Protocol"
        Envelope[Envelope Format]
        Schema[Schema Validation]
        Ack[Acknowledgment]

        Envelope --> Schema
        Schema --> Ack
    end

    Correlation --> Envelope

    Agent1[Agent Process 1] -.->|emit| Transport
    Transport -.->|receive| Agent2[Agent Process 2]

    style Transport fill:#87CEEB
    style Message fill:#98FB98
    style Buffer fill:#DDA0DD
    style Correlation fill:#F0E68C
```

## 📦 Estrutura de Dados

```mermaid
erDiagram
    TASK ||--o{ RESPONSE : produces
    TASK ||--o{ FAILURE : logs
    TASK {
        string id PK
        string target
        string prompt
        object validation
        object backoff
        object metadata
        int retries
        string status
    }

    RESPONSE {
        string taskId FK
        string content
        timestamp createdAt
        int collectionTime
        object telemetry
    }

    FAILURE {
        string taskId FK
        string type
        string message
        object stackTrace
        timestamp timestamp
        string forensicsPath
    }

    CONFIG ||--|{ RULE : contains
    CONFIG {
        int maxRetries
        object backoffStrategy
        object healthCheck
        array targets
    }

    RULE {
        string name
        object condition
        object action
        int priority
    }
```

## 🚀 Deployment Architecture

```mermaid
graph TB
    subgraph "Host Machine"
        Chrome[Chrome :9222<br/>Remote Debug]

        subgraph "PM2 Ecosystem"
            Agent[Agent Process<br/>index.js]
            Dashboard[Dashboard Process<br/>Port 3008]
        end

        subgraph "File System"
            Queue[fila/]
            Responses[respostas/]
            Logs[logs/]
            Config[config.json]
        end
    end

    subgraph "Docker (Optional)"
        Container[Node Container]
        Volume[Mounted Volumes]
    end

    Agent -.->|CDP| Chrome
    Dashboard -->|HTTP| User[Users]
    Agent -->|Read/Write| Queue
    Agent -->|Write| Responses
    Agent -->|Write| Logs
    Agent -->|Read| Config

    Container -.->|Bind Mount| Volume
    Volume -.-> Queue
    Volume -.-> Responses

    style Chrome fill:#FF6347
    style Agent fill:#4682B4
    style Dashboard fill:#32CD32
```

## 📈 Performance Monitoring Flow

```mermaid
graph LR
    A[Task Start] --> B[Telemetry Collection]
    B --> C{Thresholds}
    C -->|Within| D[Continue]
    C -->|Exceeded| E[Alert]

    B --> F[Metrics Store]
    F --> G[Health Endpoint]
    G --> H[Dashboard]

    E --> I[Apply Backoff]
    I --> J[Cooldown]

    D --> K[Task End]
    K --> L[Update Trends]
    L --> F

    style E fill:#FF6347
    style D fill:#90EE90
    style L fill:#87CEEB
```

## 🔄 Estratégia de Backoff

```mermaid
graph TD
    A[Task Failed] --> B{Classify Error}
    B -->|Infrastructure| C[Infra Counter++]
    B -->|Task Error| D[Task Counter++]

    C --> E{Infra Failures > Threshold?}
    D --> F{Task Retries > Max?}

    E -->|Yes| G[Cooldown<br/>Exponential: 2^n * base]
    E -->|No| H[Immediate Retry]

    F -->|Yes| I[Mark as DEAD]
    F -->|No| J[Retry with Delay<br/>Linear: n * interval]

    G --> K[Wait Period]
    K --> L[Resume Processing]

    J --> M[Re-queue Task]
    I --> N[Move to Failed]

    style G fill:#FF6347
    style I fill:#8B0000
    style H fill:#90EE90
    style J fill:#FFD700
```

---

## 🛠️ Como Gerar Imagens dos Diagramas

### Opção 1: VS Code (Recomendado)

```bash
# Instale a extensão Mermaid Preview
code --install-extension bierner.markdown-mermaid
```

### Opção 2: GitHub

Abra este arquivo no GitHub - renderização automática.

### Opção 3: CLI (se precisar de PNGs)

```bash
# Usando mmdc (Mermaid CLI)
npm install -g @mermaid-js/mermaid-cli
mmdc -i ARCHITECTURE_DIAGRAMS.md -o output/diagrams/
```

### Opção 4: Online

Visite: https://mermaid.live/

---

## 📚 Referências

- **Mermaid Documentation**: https://mermaid.js.org/
- **C4 Model**: https://c4model.com/
- **PlantUML**: https://plantuml.com/
- **Structurizr**: https://structurizr.com/
