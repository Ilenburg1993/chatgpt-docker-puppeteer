```mermaid
graph TB
    subgraph "ADAPTIVE SYSTEM V46 - Current State"
        A[adaptive.js] -->|getAdjustedTimeout| B[ChatGPTDriver]
        A -->|getAdjustedTimeout| C[SubmissionController]
        A -->|getAdjustedTimeout| D[BiomechanicsEngine]
        A -->|getSnapshot| E[Stabilizer]

        B -->|STREAM timeout| B1[Stall Detection]
        C -->|ECHO timeout| C1[Debounce Delay]
        D -->|INITIAL timeout| D1[Wait for Idle]
        E -->|avg stream| E1[Silence Window]

        A -.->|recordMetric| F[❌ NO CALLERS]

        style F fill:#ff6b6b,stroke:#c92a2a,color:#fff
        style A fill:#51cf66,stroke:#37b24d
    end

    subgraph "MISSING INTEGRATION"
        G[TTFT Measurement] -.->|should call| A
        H[Stream Gap Measurement] -.->|should call| A
        I[Echo Time Measurement] -.->|should call| A
        J[Heartbeat Measurement] -.->|should call| A

        style G fill:#ffd43b,stroke:#fab005
        style H fill:#ffd43b,stroke:#fab005
        style I fill:#ffd43b,stroke:#fab005
        style J fill:#ffd43b,stroke:#fab005
    end

    subgraph "DATA FLOW (Desired)"
        K[ChatGPTDriver] -->|TTFT| A
        L[ChatGPTDriver] -->|Stream Gaps| A
        M[SubmissionController] -->|Echo Time| A
        N[BiomechanicsEngine] -->|Wait Time| A
        O[Stabilizer] -->|Heartbeat| A

        A -->|learns & adapts| P[adaptive_state.json]
        P -->|persisted| Q[Next Execution]

        style P fill:#4dabf7,stroke:#1971c2
    end
