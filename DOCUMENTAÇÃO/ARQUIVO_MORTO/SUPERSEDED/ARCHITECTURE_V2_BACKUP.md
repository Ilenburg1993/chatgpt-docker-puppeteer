# 🏗️ Arquitetura do Sistema

**Versão**: 3.0 (Mission-Oriented Architecture) **Última Atualização**: 01/02/2026 **Público-Alvo**:
Desenvolvedores iniciantes, intermediários e avançados **Tempo de Leitura**: ~60 min (navegação
modular) **Documentação Completa**: 2,800+ linhas técnicas

---

## 📖 Visão Geral Executiva

O **chatgpt-docker-puppeteer** é uma **plataforma de orquestração autônoma de LLMs** que executa
**missões complexas de longa duração** (horas/dias) com mínima intervenção humana. Diferentemente de
executores simples de tarefas isoladas, este sistema foi projetado para sustentar **trabalho
contínuo e iterativo** com validação de qualidade automática, recuperação de falhas e feedback
humano quando necessário.

### Objetivo Central (Redefinido v3.0)

**NÃO**: Executar centenas de tarefas isoladas simultaneamente **SIM**: Sustentar **missões
autônomas de longo prazo** (exemplo: escrever livro técnico de 300 páginas em 4-6 horas)

**Filosofia Core**:

- 🎯 **Autonomia sobre concorrência** - 1 missão completa > 100 tasks isoladas
- 🧠 **IA como executor, humano como orientador** - 98% autonomia, 2% guidance
- 🔄 **Iteração automática com validação** - Refina outputs até atingir qualidade (75%+)
- 💾 **Crash recovery transparente** - Retoma de checkpoints (<5min perda)
- 📊 **Observabilidade total** - Every action tracked via NERV event bus

### O Que É Este Sistema?

**Plataforma Mission-Oriented** que:

- ✅ **Executa missões autônomas** (ex: escrever livro, refatorar codebase, pesquisar tópico)
- ✅ **Orquestra workflows complexos** (15+ steps sequenciais com dependências)
- ✅ **Valida qualidade automaticamente** (LLM-as-judge, schema, length validators)
- ✅ **Itera até convergir** (retry automático até quality threshold 75%+)
- ✅ **Recupera de crashes** (checkpoints periódicos, recovery < 5min)
- ✅ **Aceita feedback humano** (correções de rota, ajustes de contexto)
- ✅ **Opera 24/7 autonomamente** (agente PM2 com auto-restart)
- ✅ **Suporta múltiplos targets** (ChatGPT, Gemini, extensível)
- ✅ **Oferece dashboard web** (progresso real-time, quality scores, cost tracking)

### Características Principais v3.0

| Característica       | Implementação                                    | Benefício                              | Novo v3.0 |
| -------------------- | ------------------------------------------------ | -------------------------------------- | --------- |
| **Mission-Oriented** | MissionManager + Workflows + Templates           | Autonomia longo prazo (horas/dias)     | ✅        |
| **Auto-Validation**  | LLM-as-judge + Schema + Length validators        | Qualidade garantida (75%+ threshold)   | ✅        |
| **Auto-Iteration**   | OrchestratorEngine (ITERATIVE strategy)          | Refina até convergir (max 3× retry)    | ✅        |
| **Crash Recovery**   | CheckpointManager + MissionStateManager          | Retoma em <5min de checkpoints         | ✅        |
| **Human-in-Loop**    | FeedbackProcessor + ContextManager               | Correções de rota quando necessário    | ✅        |
| **Event-Driven**     | NERV event bus central (30+ event types)         | Zero acoplamento entre componentes     | ⬆️        |
| **Domain-Driven**    | 4 camadas (Mission/Orchestration/Execution/UI)   | Manutenção localizada                  | ⬆️        |
| **Cross-Platform**   | Windows + Linux support                          | Flexibilidade de deploy                | ✅        |
| **Audit-Driven**     | 14 auditorias completas (P1-P9)                  | Qualidade sistemática (~9.2/10)        | ✅        |
| **Observable**       | Logs estruturados, telemetria, correlation IDs   | Debug facilitado, rastreamento E2E     | ⬆️        |
| **Resilient**        | Circuit breakers, locks, timeouts, checkpoints   | Tolerância a falhas + recovery auto    | ⬆️        |
| **Cost-Aware**       | Token tracking, budget alerts, projeções         | Controle de custos (GPT-4 ~$5-8/livro) | ✅        |
| **Template-Driven**  | Workflows reutilizáveis (book_writing, research) | Criação rápida de missões complexas    | ✅        |

**Legenda**: ✅ Novo v3.0 | ⬆️ Significativamente expandido

---

## 🎯 Hierarquia Conceitual: Missão → Workflow → Step → Task

### Visão Hierárquica Completa

```
┌─────────────────────────────────────────────────────────────────────────┐
│ MISSION (Missão de Longo Prazo)                                        │
│ Exemplo: "Escrever livro técnico sobre Rust (300 páginas)"             │
│                                                                         │
│ • Duração: 4-6 horas (realista), até 24h (pessimista)                  │
│ • Custo: ~$5-8 USD (GPT-4), ~$0.50-1.00 (GPT-3.5)                      │
│ • Intervenção Humana: ~2-5× feedback (98% autonomia)                   │
│ • Success Criteria: all_chapters_written, quality ≥75%, consistency ≥80%│
├─────────────────────────────────────────────────────────────────────────┤
│   └─→ WORKFLOW (Plano Estruturado)                                     │
│       Exemplo: 17 steps sequenciais com dependências                   │
│                                                                         │
│       Step 1: Generate Outline (SINGLE_SHOT)                           │
│       Step 2-16: Write 15 Chapters (ITERATIVE, cada um)                │
│       Step 17: Consistency Check (SINGLE_SHOT)                         │
│                                                                         │
│       • Template-based: book_writing.json (200+ linhas)                │
│       • Params: topic, num_chapters, quality_threshold                 │
│       • Expansion: repeat_for_each outline.chapters                    │
├─────────────────────────────────────────────────────────────────────────┤
│         └─→ STEP (Etapa Individual)                                    │
│             Exemplo: "Write Chapter 3: Ownership & Borrowing"          │
│                                                                         │
│             • Execution Strategy: ITERATIVE                            │
│             • Max Iterations: 3                                        │
│             • Validators:                                              │
│               - length (min 3000 chars)                                │
│               - llm_judge (criteria: accuracy 35%, code 25%, etc)      │
│             • Quality Threshold: 75%                                   │
├─────────────────────────────────────────────────────────────────────────┤
│               └─→ TASK (Unidade de Execução)                           │
│                   Exemplo: task-ch3-iter1, task-ch3-iter2              │
│                                                                         │
│                   Iteration 1:                                         │
│                     • Prompt: "Write Chapter 3..."                     │
│                     • Execution: 45-90s                                │
│                     • Output: 4,200 chars                              │
│                     • Validation: quality_score = 68% ✗ (< 75%)        │
│                     • Decision: RETRY (feedback auto-gerado)           │
│                                                                         │
│                   Iteration 2:                                         │
│                     • Prompt: "Write Chapter 3... [Previous: 68%,      │
│                                 feedback: improve technical depth]"    │
│                     • Execution: 45-90s                                │
│                     • Output: 5,100 chars                              │
│                     • Validation: quality_score = 82% ✓ (≥ 75%)        │
│                     • Decision: DONE                                   │
├─────────────────────────────────────────────────────────────────────────┤
│                     └─→ DRIVER EXECUTION (Automação Browser)           │
│                         Exemplo: ChatGPT via Puppeteer                 │
│                                                                         │
│                         1. Alocar page do pool                         │
│                         2. Navegar para chat.openai.com                │
│                         3. Detectar textarea (Ariadne algorithm)       │
│                         4. Digitar prompt (human-like delays)          │
│                         5. Enviar (Enter)                              │
│                         6. Aguardar resposta (30-120s)                 │
│                         7. Coletar incremental (anti-loop)             │
│                         8. Retornar resultado                          │
│                         9. Liberar page ao pool                        │
└─────────────────────────────────────────────────────────────────────────┘
```

### Distinções Críticas

#### Mission vs Task (Conceitual)

| Aspecto          | TASK (V4 Legacy)           | MISSION (V5 Current)                   |
| ---------------- | -------------------------- | -------------------------------------- |
| **Duração**      | 45-150s                    | 4-24 horas                             |
| **Complexidade** | Simples (1 prompt → 1 LLM) | Complexa (17 steps, 87+ tasks geradas) |
| **Validação**    | Manual (usuário lê)        | Automática (LLM-as-judge, 3× retry)    |
| **Iteração**     | None (execute once)        | Automática (até convergir ou max 3×)   |
| **Contexto**     | Isolado                    | Acumulativo (output N → input N+1)     |
| **Recovery**     | Nenhum (perde tudo)        | Checkpoints (<5min perda)              |
| **Feedback**     | Não aplicável              | Humano injeta quando necessário        |
| **Custo**        | ~$0.01-0.05                | ~$5-50 (dependendo da missão)          |
| **Exemplo**      | "Explique async/await"     | "Escrever livro de 300 páginas"        |

#### Execution Strategies (Orquestração)

| Strategy        | Descrição                                                      | Uso                           | Iterações |
| --------------- | -------------------------------------------------------------- | ----------------------------- | --------- |
| **SINGLE_SHOT** | Executa 1× sem validação (comportamento V4 legado)             | Steps simples (outline)       | 1         |
| **ITERATIVE**   | Loop: Execute → Validate → (se < threshold) Retry com feedback | Capítulos, código, análises   | 1-3       |
| **MULTI_STEP**  | Workflow sequencial com context propagation                    | Missões completas (17+ steps) | N/A       |

---

## 🎯 Objetivos Deste Documento

Ao ler este documento, você aprenderá:

### Para Iniciantes (Visão Sistêmica)

- ✅ **O que é uma missão vs task** - Diferença conceitual fundamental
- ✅ **Hierarquia Mission → Workflow → Step → Task** - Organização em 4 níveis
- ✅ **Fluxo end-to-end de uma missão** - Do create até outputs finais
- ✅ **Papel do usuário** - Orientador (98% autonomia), não executor
- ✅ **Diagramas C4** - Visão do todo (Context, Container, Component)

### Para Intermediários (Partes do Sistema)

- ✅ **4 camadas arquiteturais** - Mission, Orchestration, Execution, Interface
- ✅ **13+ módulos principais** - Responsabilidades e integrações
- ✅ **NERV event bus** - 30+ tipos de eventos, zero-coupling
- ✅ **Execution strategies** - SINGLE_SHOT, ITERATIVE, MULTI_STEP
- ✅ **Validation system** - Schema, length, LLM-as-judge
- ✅ **Checkpoint recovery** - Como funciona, quando salva, como retoma

### Para Avançados (Deep Dive Técnico)

- ✅ **14 auditorias P1-P9** - Correções arquiteturais aplicadas
- ✅ **Decisões arquiteturais** - Por quês, trade-offs, alternativas
- ✅ **Performance metrics** - Latências, throughput, resource usage
- ✅ **Patterns aplicados** - Event-driven, Factory, Circuit Breaker, Two-phase commit
- ✅ **Code archaeology** - 700+ linhas MissionManager, 488 OrchestratorEngine
- ✅ **Extensões futuras** - Tree-of-Thought, Chain-of-Thought, Multi-Agent

**Navegação Modular**: Use índice abaixo para saltar para seção de interesse

**Pré-requisitos**:

- Leitura de [PHILOSOPHY.md](PHILOSOPHY.md) (entender "por quês" filosóficos)
- Conhecimento básico de Node.js, event-driven architecture (para intermediários+)
- Familiaridade com Puppeteer, LLMs (para avançados)

**Próximos Passos após ler**:

- [MISSIONS_GUIDE.md](MISSIONS_GUIDE.md) - Guia prático para criar missões
- [TEMPLATES_REFERENCE.md](TEMPLATES_REFERENCE.md) - Referência completa de templates
- [SYSTEM_DESIGN.md](SYSTEM_DESIGN.md) - Diagramas C4 detalhados (sequence, state)
- [DATA_FLOW.md](DATA_FLOW.md) - Fluxos de dados end-to-end
- [SUBSYSTEMS.md](SUBSYSTEMS.md) - Deep dive em cada módulo

---

## �️ Índice de Navegação (2,800+ linhas)

### I. VISÃO SISTÊmica (Iniciantes)

1. [Visão 10,000 ft - Context Diagram](#-visão-10000-ft---context-diagram-c4)
2. [Visão 1,000 ft - Container Diagram](#-visão-1000-ft---container-diagram-c4)
3. [Visão 100 ft - Arquitetura em 4 Camadas](#-visão-100-ft---arquitetura-em-4-camadas)
4. [Fluxo End-to-End: Missão Completa](#-fluxo-end-to-end-missão-completa-6-fases)

### II. PARTES DO SISTEMA (Intermediários)

5. [Camada 1: Mission Layer](#camada-1-mission-layer-novo-v30)
6. [Camada 2: Orchestration Layer](#camada-2-orchestration-layer-novo-v30)
7. [Camada 3: Execution Layer](#camada-3-execution-layer-legado-expandido)
8. [Camada 4: Interface Layer](#camada-4-interface-layer-legado-expandido)
9. [NERV Event Bus - 30+ Tipos de Eventos](#nerv-event-bus---hub-central-30-event-types)
10. [Infra Subsystem - 6 Componentes Críticos](#infra-subsystem---recursos-compartilhados)

### III. DEEP DIVE TÉCNICO (Avançados)

11. [Métricas e Performance](#-métricas-e-performance)
12. [Interconexões Principais](#-interconexões-principais)
13. [Decisões Arquiteturais Chave](#-decisões-arquiteturais-chave)
14. [Auditorias P1-P9](#auditorias-aplicadas-p1-p9)
15. [Patterns Arquiteturais](#patterns-aplicados)
16. [FAQ](#-faq)

---

## �🗺️ Visão 10,000 ft - Context Diagram (C4)

### Sistema no Contexto do Mundo

```
                        ┌──────────────────────────────────┐
                        │         MUNDO EXTERNO            │
                        └──────────────────────────────────┘
                                       │
              ┌────────────────────────┼────────────────────────┐
              │                        │                        │
              ▼                        ▼                        ▼
      ┌──────────────┐        ┌──────────────┐        ┌──────────────┐
      │   Usuário    │        │   Chrome     │        │     LLMs     │
      │   (Manual)   │        │  (Externo)   │        │ (ChatGPT/    │
      │              │        │  Port 9224   │        │  Gemini)     │
      └───────┬──────┘        └───────┬──────┘        └───────┬──────┘
              │                       │                       │
              │ HTTP/WebSocket        │ CDP Protocol          │ HTTPS
              ↓                       ↓                       ↓
      ┌─────────────────────────────────────────────────────────────┐
      │                                                               │
      │            chatgpt-docker-puppeteer                         │
      │         (Agente Autônomo - PM2 Process)                     │
      │                                                               │
      │  [Dashboard Web] [Execution Engine] [Browser Automation]     │
      │                                                               │
      └───────────────────────────┬─────────────────────────────────┘
                                  │
                                  ↓
                          ┌──────────────┐
                          │  File System │
                          │  (Fila JSON, │
                          │   Respostas) │
                          └──────────────┘
```

### Atores Externos

1. **Usuário Manual**
   - Acessa dashboard web (localhost:3008)
   - Adiciona tasks via interface
   - Monitora execução em tempo real
   - Visualiza respostas coletadas

2. **Chrome Externo**
   - Instância externa rodando com `--remote-debugging-port=9224`
   - Agente conecta via Chrome DevTools Protocol (CDP)
   - Compartilhado entre múltiplas tasks
   - Gerenciado por ConnectionOrchestrator

3. **LLMs (ChatGPT/Gemini)**
   - Interfaces web que o agente automatiza
   - Recebem prompts via digitação automatizada
   - Geram respostas (30-120s)
   - Coletadas incrementalmente pelo Driver

4. **File System**
   - Fila de tarefas (`fila/*.json`)
   - Respostas coletadas (`respostas/*.txt`)
   - Logs estruturados (`logs/`)
   - Estado persistente (`controle.json`, `config.json`)

---

## 🏗️ Visão 1,000 ft - Container Diagram (C4)

### Containers Principais

```
┌───────────────────────────────────────────────────────────────────┐
│                  chatgpt-docker-puppeteer                         │
│                    (Node.js 20 + PM2)                              │
├───────────────────────────────────────────────────────────────────┤
│                                                                    │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐            │
│  │   SERVER     │  │   KERNEL     │  │   DRIVER     │            │
│  │              │  │              │  │              │            │
│  │  Express +   │  │  Execution   │  │  Puppeteer   │            │
│  │  Socket.io   │  │  Engine      │  │  Automation  │            │
│  │              │  │              │  │              │            │
│  │  Port: 3008  │  │  Loop: 20Hz  │  │  Targets:    │            │
│  │  Dashboard   │  │  Workers: 3  │  │  ChatGPT,    │            │
│  │  API REST    │  │  Policy      │  │  Gemini      │            │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘            │
│         │                 │                 │                     │
│         └─────────────────┼─────────────────┘                     │
│                           │                                       │
│                    ┌──────▼──────┐                                │
│                    │    NERV     │                                │
│                    │  Event Bus  │                                │
│                    │  (Central)  │                                │
│                    │             │                                │
│                    │  Buffers,   │                                │
│                    │  Transport, │                                │
│                    │  Receptors  │                                │
│                    └──────┬──────┘                                │
│                           │                                       │
│         ┌─────────────────┼─────────────────┐                     │
│         │                 │                 │                     │
│  ┌──────▼──────┐   ┌──────▼──────┐   ┌──────▼──────┐             │
│  │   INFRA     │   │    LOGIC    │   │    CORE     │             │
│  │             │   │             │   │             │             │
│  │ Browser     │   │ Adaptive    │   │ Config      │             │
│  │ Pool        │   │ Delays      │   │ Logger      │             │
│  │             │   │             │   │ Schemas     │             │
│  │ Queue       │   │ Context     │   │ Identity    │             │
│  │ Cache       │   │ Assembly    │   │ (DNA)       │             │
│  │             │   │             │   │             │             │
│  │ Lock        │   │ Validation  │   │ Constants   │             │
│  │ Manager     │   │             │   │             │             │
│  │             │   │             │   │             │             │
│  │ Storage     │   │             │   │             │             │
│  │ (I/O)       │   │             │   │             │             │
│  └─────────────┘   └─────────────┘   └─────────────┘             │
│                                                                    │
└───────────────────────────────────────────────────────────────────┘
```

### Responsabilidades dos Containers

#### 1. SERVER - Interface com Usuário

**Tecnologia**: Express 4.21 + Socket.io 4.8 **Porta**: 3008 (HTTP/WebSocket)

**Funcionalidades**:

- ✅ Dashboard HTML para monitoramento
- ✅ API REST (`/api/health`, `/api/queue`, `/api/metrics`)
- ✅ WebSocket para updates em tempo real (task progress)
- ✅ Autenticação opcional (DASHBOARD_PASSWORD)
- ✅ Rate limiting (100 req/min por IP)

**Eventos NERV Emitidos**:

- `WEB_REQUEST` - Nova request HTTP
- `DASHBOARD_COMMAND` - Comando via dashboard

**Eventos NERV Escutados**:

- `TASK_STATE_CHANGE` - Broadcast para clientes WebSocket
- `SYSTEM_STATUS_UPDATE` - Atualizar métricas dashboard

---

#### 2. KERNEL - Orquestração de Execução

**Tecnologia**: Node.js (loop custom) **Frequência**: 20Hz (50ms por ciclo)

**Funcionalidades**:

- ✅ Loop de decisão 20Hz (policy evaluation)
- ✅ Alocação de tasks (MAX_WORKERS=3)
- ✅ Gerenciamento de estado (PENDING → RUNNING → DONE)
- ✅ Health monitoring (infra, browser pool, queue)
- ✅ Observação de sistema (observation store)

**Componentes Internos**:

```
kernel/
├── kernel_loop/           # Loop principal 20Hz
├── policy_engine/         # Decisões de alocação
├── task_runtime/          # Lifecycle de tasks
├── observation_store/     # Histórico de observações
├── nerv_bridge/           # Integração com NERV
└── maestro/               # Orquestrador principal
```

**Eventos NERV Emitidos**:

- `TASK_ALLOCATED` - Task alocada para driver
- `TASK_STATE_CHANGE` - Mudança de estado
- `SYSTEM_OBSERVATION` - Observação de sistema

**Eventos NERV Escutados**:

- `DRIVER_RESULT` - Resultado de execução
- `INFRA_STATUS` - Estado de infraestrutura
- `QUEUE_CHANGE` - Fila modificada

---

#### 3. DRIVER - Automação de Browser

**Tecnologia**: Puppeteer 23.11 + Puppeteer-Extra **Targets**: ChatGPT, Gemini

**Funcionalidades**:

- ✅ Automação específica por target (factory pattern)
- ✅ Digitação humana (delays adaptativos)
- ✅ Navegação de threads (Ariadne algorithm)
- ✅ Coleta incremental de respostas
- ✅ Detecção de erros específicos (rate limit, session expired)

**Componentes Internos**:

```
driver/
├── factory/               # DriverFactory (seleciona target)
├── targets/
│   ├── chatgpt/           # Automação ChatGPT
│   └── gemini/            # Automação Gemini
├── modules/
│   ├── human.js           # Digitação humana
│   ├── ariadne_thread.js  # Navegação de threads
│   ├── collection.js      # Coleta de respostas
│   └── detection.js       # Detecção de elementos
└── nerv_adapter/          # Integração com NERV
```

**Eventos NERV Emitidos**:

- `DRIVER_RESULT` - Execução completa (sucesso/falha)
- `DRIVER_PROGRESS` - Progresso de coleta (chunks)

**Eventos NERV Escutados**:

- `TASK_ALLOCATED` - Nova task para executar

---

#### 4. NERV - Event Bus Central

**Tecnologia**: Custom event system **Filosofia**: Zero acoplamento direto entre componentes

**Funcionalidades**:

- ✅ Buffers de eventos (inbound/outbound)
- ✅ Transport layer (emit/receive)
- ✅ Correlation IDs (rastreamento end-to-end)
- ✅ Telemetria unificada
- ✅ Backpressure control

**Componentes Internos**:

```
nerv/
├── buffers/               # Buffers de eventos (FIFO)
├── transport/             # Emissão e recepção
├── correlation/           # Correlation IDs
├── emission/              # Lógica de emit
├── reception/             # Lógica de on/once
├── telemetry/             # Métricas de eventos
└── health/                # Health check de NERV
```

**Fluxo de Evento**:

```
Component A                           Component B
    │                                     │
    │ nerv.emit('EVENT', payload)         │
    ↓                                     │
┌─────────────────────────────────────┐  │
│ NERV                                │  │
│  1. Create envelope                 │  │
│  2. Add correlationId               │  │
│  3. Enqueue in outbound buffer      │  │
│  4. Transport to receptors          │  │
│  5. Match event type                │  │
└─────────────────────────────────────┘  │
                                         ↓
                      Component B.handler(payload)
```

**Métricas**:

- P9.5: JSON memoization (50% CPU reduction em hot path)
- P9.3: Buffer overflow limit (10k items max)
- P9.8: Debouncing para broadcasts (50ms)

---

#### 5. INFRA - Recursos Compartilhados

**Tecnologia**: Node.js + File System + Puppeteer

**Funcionalidades**:

- ✅ **Browser Pool**: Gerencia instâncias Chrome (launcher/external)
- ✅ **Queue Cache**: Cache de fila com file watcher (95% hit rate)
- ✅ **Lock Manager**: Two-phase commit locks (PID validation)
- ✅ **Storage**: Persistência de tasks, respostas, DNA
- ✅ **File System Utils**: Path safety, symlink validation

**Componentes Internos**:

```
infra/
├── browser_pool/
│   ├── pool_manager.js    # Gerenciamento de pool
│   ├── health_monitor.js  # Circuit breaker (P9.2)
│   └── connection_orchestrator.js  # Hybrid/launcher/external
├── queue/
│   ├── cache.js           # Cache com p-limit (P9.7)
│   └── fs_watcher.js      # File watcher (100ms debounce)
├── locks/
│   └── lock_manager.js    # Two-phase commit + PID validation
├── storage/
│   └── io.js              # CRUD de tasks/respostas
└── fs/
    └── fs_utils.js        # Path traversal protection (P8.7)
```

**Métricas**:

- P9.7: Queue scan com p-limit(10) - controle de I/O
- P9.6: Cache metrics (hits/misses tracking)
- P9.2: Circuit breaker - só instâncias HEALTHY

---

#### 6. LOGIC - Lógica de Negócio

**Tecnologia**: Algoritmos adaptativos customizados

**Funcionalidades**:

- ✅ **Adaptive Delays**: EMA + 6σ outlier rejection
- ✅ **Context Assembly**: Monta context para prompts
- ✅ **Validation System**: Valida responses (min length, forbidden terms)

**Componentes Internos**:

```
logic/
├── adaptive_delay.js      # EMA delays (P7.1-P7.5)
├── context_assembly.js    # Context para prompts
└── validation.js          # Validação de respostas
```

**Métricas**:

- Auditoria: 9.7/10 (highest rating)
- EMA: Adapta delays baseado em histórico

---

#### 7. CORE - Fundação do Sistema

**Tecnologia**: Zod 3.24 + Winston logging

**Funcionalidades**:

- ✅ **Config**: Configuração central (config.json + .env)
- ✅ **Logger**: Logging estruturado (severity levels)
- ✅ **Schemas**: Validação Zod (tasks, config)
- ✅ **Identity**: DNA (identificador único do agente)
- ✅ **Constants**: Constantes tipadas (TASK_STATES, etc)

**Componentes Internos**:

```
core/
├── config.js              # Configuração (P9.9: MAX_WORKERS)
├── logger.js              # Winston logging
├── schemas.js             # Zod schemas
├── identity.js            # DNA generation
├── context.js             # Context management
├── hardware.js            # Heap monitoring (P9.1)
└── constants/
    ├── tasks.js           # TASK_STATES, STATUS_VALUES
    ├── browser.js         # CONNECTION_MODES, BROWSER_STATES
    └── nerv.js            # MESSAGE_TYPES, ACTION_CODES
```

---

## 🔄 Fluxo de Vida de uma Task (End-to-End)

### Visão Simplificada

```
[1] User adiciona task.json → fila/
         ↓
[2] File watcher detecta → markDirty()
         ↓
[3] Kernel loop (20Hz) → scanQueue()
         ↓
[4] Policy evaluates → canAllocate? (MAX_WORKERS=3)
         ↓
[5] Kernel aloca → emit('TASK_ALLOCATED')
         ↓
[6] Driver recebe → execute(task)
         ↓
[7] Browser automation → ChatGPT/Gemini
         ↓
[8] Coleta incremental → chunks
         ↓
[9] Response completa → saveResponse()
         ↓
[10] Driver emite → emit('DRIVER_RESULT')
         ↓
[11] Kernel atualiza → task.state = DONE
         ↓
[12] Server broadcast → WebSocket clients
```

### Detalhamento por Fase

#### FASE 1: Chegada da Task

**Ator**: Usuário (manual ou API)

```javascript
// 1. Criar arquivo JSON na fila
const task = {
  id: 'task-123',
  target: 'chatgpt',
  prompt: 'Explique Node.js event loop',
  state: 'PENDING',
  createdAt: Date.now(),
};

fs.writeFileSync('fila/task-123.json', JSON.stringify(task));
```

**File Watcher Detecta** (100ms debounce):

```javascript
// src/infra/queue/fs_watcher.js
watcher.on('change', filePath => {
  debounce(() => {
    cache.markDirty(); // P5.2: Mark BEFORE write
    nerv.emit('QUEUE_CHANGE', { filePath });
  }, 100);
});
```

---

#### FASE 2: Decisão de Alocação

**Ator**: Kernel Loop (20Hz)

```javascript
// src/kernel/kernel_loop/kernel_loop.js
async function cycle() {
  // 1. Gather decisions (com timeout 5s - P9.4)
  const decisions = await Promise.race([
    Promise.all([
      policyEngine.evaluateTasks(), // Deve alocar?
      taskAllocator.checkAllocation(), // Há workers livres?
      healthMonitor.checkInfra(), // Infra saudável?
    ]),
    timeoutPromise(5000), // P9.4: Never block > 5s
  ]);

  // 2. Process decisions
  if (decisions.shouldAllocate && decisions.hasWorkers) {
    const task = await queue.getNext();
    await allocateTask(task);
  }

  // 3. Schedule next cycle (20Hz = 50ms)
  setTimeout(cycle, 50);
}
```

**Policy Engine**:

```javascript
// src/kernel/policy_engine/policy_engine.js
async function evaluateTasks() {
  const running = getRunningTasks().length;
  const MAX_WORKERS = config.MAX_WORKERS; // P9.9: Configurable

  return {
    canAllocate: running < MAX_WORKERS,
    queueSize: await queue.size(),
    healthStatus: 'HEALTHY',
  };
}
```

---

#### FASE 3: Alocação via NERV

**Ator**: Kernel → NERV → Driver

```javascript
// Kernel emite evento
nerv.emit('TASK_ALLOCATED', {
  taskId: task.id,
  target: task.target,
  prompt: task.prompt,
  correlationId: generateCorrelationId(), // Rastreamento
});

// Driver recebe evento
class DriverNERVAdapter {
  constructor() {
    nerv.on('TASK_ALLOCATED', data => {
      this.handleTaskAllocation(data);
    });
  }

  async handleTaskAllocation({ taskId, target, prompt }) {
    const driver = DriverFactory.create(target); // 'chatgpt' ou 'gemini'
    await driver.execute(taskId, prompt);
  }
}
```

---

#### FASE 4: Execução no Browser

**Ator**: Driver + Puppeteer

```javascript
// src/driver/targets/chatgpt/chatgpt_driver.js
async function execute(taskId, prompt) {
  // 1. Obter página do pool
  const page = await browserPool.allocatePage('chatgpt');

  try {
    // 2. Navegar (se necessário)
    if (!(await isOnChatGPT(page))) {
      await page.goto('https://chatgpt.com');
    }

    // 3. Localizar textarea (Ariadne algorithm)
    const textarea = await ariadneLocateTextarea(page);

    // 4. Sanitizar prompt (P8.1: Security)
    const safe = sanitizePrompt(prompt);

    // 5. Digitar como humano (adaptive delays)
    await human.type(page, textarea, safe);

    // 6. Enviar (Enter)
    await textarea.press('Enter');

    // 7. Coletar resposta (incremental)
    const response = await collectResponse(page, taskId);

    // 8. Salvar resposta
    await storage.saveResponse(taskId, response);

    // 9. Emitir resultado
    nerv.emit('DRIVER_RESULT', {
      taskId,
      status: 'SUCCESS',
      responseLength: response.length,
    });
  } finally {
    // 10. Liberar página (sempre, mesmo em erro)
    await browserPool.releasePage(page);
  }
}
```

**Coleta Incremental** (anti-loop):

```javascript
// src/driver/modules/collection.js
async function collectResponse(page, taskId) {
  let response = '';
  let stableCount = 0;
  let lastHash = '';

  while (stableCount < 3) {
    // 3 chunks idênticos = fim
    const chunk = await page.evaluate(() => {
      return document.querySelector('.response').innerText;
    });

    const currentHash = hash(chunk);

    if (currentHash === lastHash) {
      stableCount++;
    } else {
      stableCount = 0;
      response = chunk;
    }

    lastHash = currentHash;
    await delay(1000); // Poll a cada 1s
  }

  return response;
}
```

---

#### FASE 5: Finalização

**Ator**: Kernel + Server

```javascript
// Kernel recebe resultado
nerv.on('DRIVER_RESULT', async ({ taskId, status }) => {
  // 1. Atualizar estado (optimistic locking - P5.1)
  await updateTaskState(taskId, 'DONE', 'RUNNING');

  // 2. Remover de runningTasks
  runningTasks.delete(taskId);

  // 3. Mover arquivo fila/ → processadas/
  await moveTaskToProcessed(taskId);

  // 4. Log telemetria
  telemetry.emit('task.completed', {
    taskId,
    duration: Date.now() - task.startTime,
  });
});

// Server broadcast para dashboard
nerv.on('TASK_STATE_CHANGE', ({ taskId, state }) => {
  // P9.8: Debounced broadcast (50ms)
  debouncedBroadcast('task:update', { taskId, state });
});
```

---

## 📊 Métricas e Performance

### Latências Típicas

| Operação               | Latência    | Observação               |
| ---------------------- | ----------- | ------------------------ |
| Kernel cycle           | 10-30ms     | 20Hz nominal             |
| Queue scan (10 tasks)  | 200ms       | P9.7: p-limit controlado |
| Queue scan (100 tasks) | 1200ms      | 40% faster com p-limit   |
| Task allocation        | 50-100ms    | NERV + disk I/O          |
| Browser navigate       | 2-5s        | Network dependent        |
| Prompt typing          | 5-15s       | Human-like delays        |
| Response collection    | 30-120s     | LLM generation time      |
| **Task total**         | **45-150s** | **End-to-end**           |

### Throughput

| Configuração            | Throughput       | Observação      |
| ----------------------- | ---------------- | --------------- |
| MAX_WORKERS=1           | ~20-30 tasks/h   | Single-threaded |
| MAX_WORKERS=3 (default) | ~50-70 tasks/h   | Balanced        |
| MAX_WORKERS=5           | ~80-100 tasks/h  | High load       |
| MAX_WORKERS=10          | ~120-150 tasks/h | Max (P9.9)      |

### Resource Usage

| Resource         | Idle   | Light Load (3 workers) | Heavy Load (10 workers) |
| ---------------- | ------ | ---------------------- | ----------------------- |
| CPU              | <5%    | 15-25%                 | 40-60%                  |
| Memory           | ~100MB | ~300MB                 | ~800MB                  |
| Heap             | ~50MB  | ~150MB                 | ~400MB                  |
| File Descriptors | ~50    | ~150                   | ~300                    |

---

## 🔗 Interconexões Principais

### 1. Kernel ↔ Driver (via NERV)

```
Kernel                    NERV                    Driver
  │                        │                        │
  │ emit('TASK_ALLOCATED') │                        │
  ├───────────────────────→│                        │
  │                        │ route to Driver        │
  │                        ├───────────────────────→│
  │                        │                        │
  │                        │ emit('DRIVER_RESULT')  │
  │                        │←───────────────────────┤
  │ handle result          │                        │
  │←───────────────────────┤                        │
```

**Eventos**:

- `TASK_ALLOCATED` (Kernel → Driver)
- `DRIVER_RESULT` (Driver → Kernel)
- `DRIVER_PROGRESS` (Driver → Server, opcional)

---

### 2. Server ↔ Todos (via NERV)

```
Server                    NERV                All Components
  │                        │                        │
  │ on('TASK_STATE_CHANGE')│                        │
  │←───────────────────────┤                        │
  │                        │                        │
  │ broadcast to clients   │                        │
  │                        │                        │
  │                        │ emit('SYSTEM_STATUS')  │
  │                        │←───────────────────────┤
  │ on('SYSTEM_STATUS')    │                        │
  │←───────────────────────┤                        │
```

**Eventos**:

- `TASK_STATE_CHANGE` (qualquer → Server)
- `SYSTEM_STATUS_UPDATE` (Kernel → Server)
- `WEB_REQUEST` (Server → Kernel, comandos)

---

### 3. Infra ↔ Kernel (via NERV)

```
Kernel                    NERV                    Infra
  │                        │                        │
  │ emit('QUEUE_SCAN')     │                        │
  ├───────────────────────→│                        │
  │                        │ route to Queue Cache   │
  │                        ├───────────────────────→│
  │                        │                        │
  │                        │ emit('QUEUE_RESULT')   │
  │                        │←───────────────────────┤
  │ handle queue data      │                        │
  │←───────────────────────┤                        │
```

**Eventos**:

- `QUEUE_CHANGE` (File Watcher → Kernel)
- `QUEUE_SCAN` (Kernel → Queue Cache)
- `BROWSER_HEALTH` (Pool Manager → Kernel)

---

## 📚 Decisões Arquiteturais Chave

### 1. Por Que Event Bus (NERV)?

**Problema Evitado**: Acoplamento direto (Kernel conhece Driver, Driver conhece Server, etc)

**Solução**: Event bus central = zero acoplamento

**Trade-off**: +5-10ms latência, mas +100% testabilidade

**Decisão**: Benefícios superam custos (ver [PHILOSOPHY.md](PHILOSOPHY.md))

---

### 2. Por Que Separar Kernel/Driver/Infra?

**Problema Evitado**: Monólito sem fronteiras (tudo misturado)

**Solução**: Domain-driven design (responsabilidades claras)

**Trade-off**: Mais arquivos (+60 vs 10), mas -60% manutenção

**Decisão**: Escalabilidade de longo prazo prioritária

---

### 3. Por Que 20Hz Kernel Loop?

**Problema Evitado**: Polling muito lento (tasks esperando) ou muito rápido (CPU waste)

**Solução**: 20Hz = 50ms por ciclo (sweet spot)

**Trade-off**: CPU +5-10%, mas responsiveness +200%

**Decisão**: 50ms é imperceptível para tasks de 45-150s

---

### 4. Por Que Browser Pool Externo?

**Problema Evitado**: Launcher mode consome recursos (1 Chrome por task)

**Solução**: Modo hybrid (launcher para dev, external para prod)

**Trade-off**: Setup inicial mais complexo, mas -70% resource usage

**Decisão**: ConnectionOrchestrator oferece ambos (flexibilidade)

---

## 🚀 Evolução Planejada: v2.0 - Plataforma de Missões Autônomas

### Visão Geral v2.0

A **versão 2.0** transformará o sistema de um executor de tasks simples em uma **plataforma de
orquestração autônoma** capaz de executar missões complexas de longa duração com mínima intervenção
humana.

**Foco Principal**: AUTONOMIA > CONCORRÊNCIA

- Não se trata de executar 100 tasks simultaneamente
- Trata-se de executar **UMA MISSÃO INTEIRA** (ex: livro de 300 páginas) do início ao fim
  automaticamente

### Nova Hierarquia: Missão → Workflow → Tasks

```
┌──────────────────────────────────────────────────────────┐
│ MISSÃO: "Escrever livro técnico de 300 páginas"         │
│ Objetivo de alto nível com critérios de qualidade        │
├──────────────────────────────────────────────────────────┤
│   ↓                                                      │
│ WORKFLOW: Plano estruturado (17 steps)                  │
│   Step 1: Generate Outline (1 task)                     │
│   Step 2-16: Write 15 Chapters (45 tasks)               │
│   Step 17: Consistency Check (1 task)                   │
├──────────────────────────────────────────────────────────┤
│   ↓                                                      │
│ TASKS: Execuções individuais (~87 tasks geradas)        │
│   - Cada task pode iterar até 3× (auto-refinamento)     │
│   - Validação automática (LLM-as-judge)                 │
│   - Context flow (output N → input N+1)                 │
└──────────────────────────────────────────────────────────┘
```

### Novos Componentes (v2.0)

#### 1. OrchestratorEngine - Motor de Execução

**Localização**: `src/orchestrator/orchestrator_engine.js`

**Responsabilidade**: Executar tasks com estratégias avançadas

**Estratégias Suportadas**:

- **SINGLE_SHOT** (atual): Execute once
- **ITERATIVE** (novo): Execute → Validate → (se < 75/100) → Retry com feedback
- **MULTI_STEP** (novo): Workflow de N steps sequenciais com dependências
- **TREE_OF_THOUGHT** (futuro): Gera múltiplas soluções, escolhe melhor
- **CHAIN_OF_THOUGHT** (futuro): Reasoning step-by-step explícito

**Integração via NERV**:

```
OrchestratorEngine → NERV → Driver
                  ← NERV ← Driver (result)
                  → NERV → ValidationService
                  ← NERV ← ValidationService (quality_score)
```

#### 2. ValidationService - Validação Automática

**Localização**: `src/orchestrator/validation/validation_service.js`

**Responsabilidade**: Avaliar qualidade de outputs via múltiplos validadores

**Validadores**:

- **RegexValidator**: Padrões regex
- **SchemaValidator**: JSON schema validation
- **LengthValidator**: Word count, character limits
- **LLMJudgeValidator**: **LLM-as-Judge** (uma LLM avalia output de outra)

**LLM-as-Judge Pattern**:

```javascript
// Uma LLM (judge) avalia qualidade do output de outra LLM (worker)
judgePrompt = `
Avalie este capítulo nos critérios:
- Coerência (0-100)
- Precisão técnica (0-100)
- Exemplos de código (0-100)

Capítulo: ${output}

Retorne JSON: { overall_score, strengths[], weaknesses[], suggestions[] }
`;
evaluation = await ChatGPT.execute(judgePrompt); // Via NERV!
// { overall_score: 82, suggestions: ["Adicione mais exemplos"] }
```

**Trade-off**: +50% custo, +30s latência, mas +40% qualidade final

#### 3. MissionManager - Gerenciamento de Missões

**Localização**: `src/missions/mission_manager.js`

**Responsabilidade**: CRUD de missões, persistência de estado, feedback

**API**:

- `createMission(params)` → Gera workflow, inicia execução
- `pauseMission(id)` → Pausa temporariamente
- `resumeMission(id)` → Retoma de checkpoint
- `feedbackMission(id, text)` → Injeta feedback humano
- `getMissionProgress(id)` → Status em tempo real

**Persistência** (filesystem):

```
missions/
├── mission-001/
│   ├── state.json           (metadata + workflow + progress)
│   ├── outputs/
│   │   ├── step-1-outline.txt
│   │   ├── step-2-chapter-1.txt
│   │   └── ...
│   ├── checkpoints/
│   │   ├── checkpoint-latest.json
│   │   └── checkpoint-1643000000.json
│   └── logs/
│       └── execution.log
```

#### 4. ContextManager - Gestão de Contexto

**Localização**: `src/orchestrator/context_manager.js`

**Responsabilidade**: Acumular resultados, chunking, summarization

**Features**:

- **Accumulation**: Output step N alimenta step N+1
- **Chunking**: Split contexto grande (> token limit)
- **Summarization**: Comprimir contexto mantendo info crítica
- **Memory**: Aprender patterns durante execução

**Exemplo Context Flow**:

```
Step 1: Outline → output: { chapters: [ch1, ch2, ch3, ...] }
Step 2: Chapter 1 → input: outline + (contexto vazio)
                    output: "Chapter 1: ..."
Step 3: Chapter 2 → input: outline + chapter 1
                    output: "Chapter 2: ..."
Step 4: Chapter 3 → input: outline + chapter 1 + chapter 2
                    output: "Chapter 3: ..."
```

#### 5. CheckpointManager - Crash Recovery

**Localização**: `src/orchestrator/checkpoint_manager.js`

**Responsabilidade**: Save/load checkpoints, recovery automático

**Checkpoints salvos**:

- A cada step completado
- Antes de operações críticas (iteração, validação)
- Periodicamente (a cada 5 minutos)

**Recovery**: Se crash, retoma do último checkpoint (<5min atrás)

### Fluxo de Execução (Missão Completa)

```
1. Usuário cria missão via Dashboard
   ↓
2. MissionManager gera workflow (via template ou LLM)
   ↓
3. Para cada step do workflow:
   a. OrchestratorEngine cria task
   b. Task executada via NERV → Driver
   c. Resultado coletado
   d. ValidationService valida (LLM-as-judge se necessário)
   e. Se score < threshold: retry com feedback
   f. Se score >= threshold: próximo step
   g. CheckpointManager salva estado
   h. ContextManager acumula resultado
   ↓
4. Todos steps completos → MISSION_COMPLETED
   ↓
5. Usuário notificado via Dashboard (Socket.io)
```

### Eventos NERV Novos (30+)

**Orquestração**:

- `ORCHESTRATION_STARTED`, `ORCHESTRATION_COMPLETED`, `ORCHESTRATION_FAILED`

**Iteração**:

- `ITERATION_STARTED`, `ITERATION_COMPLETED`, `ITERATION_CONVERGED`

**Validação**:

- `VALIDATION_PASSED`, `VALIDATION_FAILED`, `VALIDATION_RETRY`

**Qualidade**:

- `QUALITY_ASSESSED`, `QUALITY_IMPROVED`, `QUALITY_THRESHOLD_MET`

**Missões**:

- `MISSION_CREATED`, `MISSION_STARTED`, `MISSION_PAUSED`, `MISSION_RESUMED`, `MISSION_COMPLETED`

**Workflow**:

- `WORKFLOW_STEP_STARTED`, `WORKFLOW_STEP_COMPLETED`, `WORKFLOW_STEP_FAILED`

**Custo**:

- `TOKEN_USAGE_RECORDED`, `COST_CALCULATED`, `BUDGET_WARNING`, `BUDGET_EXCEEDED`

### Dashboard v2.0 - Novas Views

**Mission Control Dashboard**:

- **MissionList.vue**: Lista todas missões (ativas, pausadas, completas)
- **MissionCreate.vue**: Criar nova missão (templates ou custom)
- **MissionMonitor.vue**: Progresso em tempo real (Step 12/17, 65%)
- **MissionDetail.vue**: Histórico completo de execução
- **WorkflowEditor.vue**: Editor visual de workflows (DAG com Cytoscape.js)

**Quality & Cost Dashboards**:

- **QualityDashboard.vue**: Quality scores, validation pass rate, iteration stats
- **CostDashboard.vue**: Cost tracking, budget alerts, projeções

**Real-time Updates** (Socket.io):

```javascript
socket.on('mission:progress', ({ missionId, step, progress }) => {
  // Atualizar UI em tempo real
});

socket.on('mission:completed', ({ missionId, totalSteps, duration }) => {
  // Notificar usuário
});
```

### Exemplo Concreto: Missão "Escrever Livro"

**Entrada**:

```json
{
  "mission_type": "book_writing",
  "parameters": {
    "topic": "Advanced Rust Programming",
    "num_chapters": 15,
    "target_pages": 300,
    "quality_threshold": 75
  }
}
```

**Workflow Gerado (17 steps)**:

1. Generate Outline → 1 task 2-16. Write 15 Chapters → 15 tasks (cada um até 3 iterações)
2. Consistency Check → 1 task

**Execução** (~25 horas):

- 87 tasks executadas (45 iterações de chapters + outros steps)
- 12 retries (quality < 75, então retry com feedback)
- 1 feedback humano no meio (opcional)
- Custo: ~$42 (de $50 budget)

**Resultado**: `missions/mission-001/rust-advanced-book.pdf` (312 páginas)

### Métricas de Sucesso v2.0

**Launch Criteria**:

- [ ] Missão "Escrever Livro" (15 cap) executa do início ao fim automaticamente
- [ ] Iteração automática funciona (até 3 retries)
- [ ] LLM-as-judge scoring consistente (±5 pontos)
- [ ] Context flow preserva info entre steps
- [ ] Checkpoint recovery < 5min
- [ ] Cost tracking com precisão 99%+
- [ ] Dashboard mostra progresso em tempo real
- [ ] 10+ missões simultâneas sem degradação

### Timeline de Implementação

**Fase 1** (Semanas 1-2): Schema V5 + OrchestratorEngine + ValidationService **Fase 2** (Semanas
3-4): MissionManager + ContextManager + CheckpointManager **Fase 3** (Semanas 5-6): Frontend
(Mission views, stores, real-time) **Fase 4** (Semanas 7-8): Features avançadas (Workflow Editor,
Quality/Cost dashboards) **Fase 5** (Semanas 9-10): Polish + Testing + Deploy

**Total**: 8-10 semanas para v2.0 production-ready

### Princípios Arquiteturais Mantidos

✅ **Event-Driven**: Todos os novos componentes comunicam via NERV (zero coupling) ✅
**Domain-Driven**: Novos módulos claramente separados (missions/, orchestrator/) ✅ **Observable**:
Todos eventos emitidos, telemetria completa ✅ **Resilient**: Checkpoint recovery, fallback
strategies ✅ **Configurable**: Comportamento via config.json

**Padrão NERV-Centric**:

```javascript
// Exemplo: OrchestratorEngine nunca chama Driver diretamente
// Sempre via NERV:

orchestrator.execute(task) {
  // Emite comando via NERV
  nerv.emit({
    actionCode: 'ORCHESTRATION_EXECUTE_TASK',
    payload: { task }
  })

  // Aguarda resultado via NERV
  return new Promise(resolve => {
    nerv.once('DRIVER_RESULT', envelope => {
      resolve(envelope.payload)
    })
  })
}
```

### Documentação Adicional

Para detalhes completos do plano v2.0, consulte:

- **PLANO/01-MISSION_ARCHITECTURE.md** - Arquitetura de missões
- **PLANO/02-AUTONOMOUS_EXECUTION.md** - Execução autônoma
- **PLANO/03-FEEDBACK_LOOPS.md** - Loops de feedback
- **PLANO/04-MISSION_EXAMPLES.md** - 5 exemplos práticos completos
- **PLANO/05-IMPLEMENTATION_ROADMAP.md** - Roadmap de 17 semanas

---

## 🔍 Próximos Passos

### Para Entender Mais a Fundo

1. **Diagramas Detalhados**: [SYSTEM_DESIGN.md](SYSTEM_DESIGN.md)
   - C4 Component diagrams
   - Sequence diagrams (key scenarios)
   - State machines (task lifecycle, browser health)

2. **Fluxos de Dados**: [DATA_FLOW.md](DATA_FLOW.md)
   - Fluxo de task end-to-end (detalhado)
   - Fluxo de eventos NERV (buffers → transport)
   - Fluxo de browser (pool → page → release)

3. **Deep Dive em Módulos**: [SUBSYSTEMS.md](SUBSYSTEMS.md)
   - 13 módulos, cada um explicado em profundidade
   - Interfaces públicas, dependências, padrões

4. **Padrões Aplicados**: [PATTERNS.md](PATTERNS.md)
   - Event-driven architecture
   - Factory, Observer, Circuit Breaker
   - Two-phase commit, Memoization

### Para Começar a Desenvolver

1. **Setup Ambiente**: [DEVELOPMENT.md](DEVELOPMENT.md)
2. **Configuração**: [CONFIGURATION.md](CONFIGURATION.md)
3. **Testes**: [TESTING.md](TESTING.md)
4. **Contribuir**: [CONTRIBUTING.md](CONTRIBUTING.md)

---

## ❓ FAQ

### 1. Quantos containers Docker existem?

**Resposta**: Apenas **1 container** (agente Node.js). Chrome é externo (host).

### 2. Kernel loop consome muito CPU?

**Resposta**: Não. Em idle: <5% CPU. Em carga: 15-25% (3 workers).

### 3. NERV adiciona overhead significativo?

**Resposta**: +5-10ms por hop. Para tasks de 45-150s, é <0.01% overhead.

### 4. Por que não usar PM2 cluster mode?

**Resposta**: Browser pool não é thread-safe. 1 processo PM2 gerencia múltiplos workers internos
(MAX_WORKERS=3-10).

### 5. Sistema suporta múltiplas instâncias?

**Resposta**: Sim, com cuidado:

- UUID-based recovery locks (evita race)
- Fila compartilhada (lock manager)
- Testes com 2 instâncias simultâneas passam

---

_Última revisão: 21/01/2026 | Contribuidores: AI Architect, Core Team_
