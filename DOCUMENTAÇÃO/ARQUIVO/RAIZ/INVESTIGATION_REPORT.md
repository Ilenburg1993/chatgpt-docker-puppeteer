# 🔍 INVESTIGAÇÃO ARQUITETURAL PROFUNDA

## Sistema de Controle Autônomo de LLMs para Missões de Longo Prazo

**Data**: 1 de Fevereiro de 2026 **Objetivo**: Mapear arquitetura completa antes de atualizar
ARCHITECTURE.md **Foco**: Missões de longo prazo (ex: "escrever um livro") com baixa interferência
humana

---

## 📊 VISÃO GERAL DO SISTEMA

### Objetivo Central (Redefinido)

**NÃO** executar "muitas tasks" isoladas, mas sim:

- ✅ **Sustentar missões de longo prazo** (ex: escrever um livro de 15 capítulos)
- ✅ **Baixa interferência humana** (usuário como orientador, não executor)
- ✅ **Controle automatizado de LLM** (IA executa, humano corrige rota)
- ✅ **Dashboard para gerenciamento** (correções, mudanças de rota, orientações)

### Hierarquia Conceitual

```
MISSION (Missão de longo prazo)
└── WORKFLOW (Conjunto estruturado de steps)
    └── STEP (Etapa individual com estratégia de execução)
        └── TASK(S) (Unidade de execução no Kernel)
            └── DRIVER EXECUTION (Interação com LLM via browser)
```

---

## 🏗️ COMPONENTES DESCOBERTOS (13 Módulos + Novos Sistemas)

### 1. **MISSIONS** (`src/missions/`) - **NOVO SISTEMA CENTRAL**

**Responsabilidade**: Gerenciar ciclo de vida completo de missões de longo prazo

#### Arquivos Chave:

- `mission_manager.js` (700 linhas) - CRUD + execução + progresso
- `mission_state_manager.js` (381 linhas) - Persistência filesystem
- `workflow_generator.js` (306 linhas) - Templates → Workflows
- `feedback_processor.js` - Processar feedback humano
- `templates/book_writing.json` - Template exemplo (livro técnico)

#### Estrutura de Persistência:

```
missions/
├── mission-001/
│   ├── state.json              # Metadata + workflow + progress
│   ├── outputs/                # Outputs de cada step
│   │   ├── step-1-outline.txt
│   │   └── step-2-chapter-1.txt
│   ├── checkpoints/            # Crash recovery
│   │   └── checkpoint-latest.json
│   └── logs/                   # Logs específicos
│       └── execution.log
```

#### Estados da Missão:

- `PENDING`: Criada, não iniciada
- `RUNNING`: Em execução
- `PAUSED`: Pausada manualmente
- `COMPLETED`: Concluída com sucesso
- `FAILED`: Falhou criticamente

#### Funcionalidades:

- **createMission()**: Criar missão a partir de template + params
- **startMission()**: Iniciar execução (gera tasks V5 para Kernel)
- **pauseMission()**: Pausar temporariamente
- **resumeMission()**: Retomar de onde parou
- **injectFeedback()**: Usuário injeta correções/orientações
- **Crash Recovery**: Recupera missões interrompidas via checkpoints

---

### 2. **ORCHESTRATOR** (`src/orchestrator/`) - **MOTOR DE ORQUESTRAÇÃO**

**Responsabilidade**: Implementar estratégias de execução (SINGLE_SHOT, ITERATIVE, MULTI_STEP)

#### Arquivos Chave:

- `orchestrator_engine.js` (488 linhas) - Motor central
- `context_manager.js` - Gerenciar contexto entre steps
- `checkpoint_manager.js` - Salvar/restaurar estado
- `memory_store.js` - Memória de longo prazo
- `validation/validation_service.js` - Validação de qualidade

#### Estratégias de Execução:

**1. SINGLE_SHOT**: Executa 1x, sem validação (comportamento V4 legado)

```javascript
execution: {
  strategy: 'SINGLE_SHOT';
}
```

**2. ITERATIVE**: Executa → Valida → Retry com feedback (até max_iterations)

```javascript
execution: {
    strategy: "ITERATIVE",
    iterative_config: {
        max_iterations: 3,
        validation_criteria: { min_quality_score: 75 }
    }
}
```

**3. MULTI_STEP**: Workflow com múltiplos steps interdependentes

```javascript
execution: {
  strategy: 'MULTI_STEP';
}
// Steps executados sequencialmente com context propagation
```

#### Validadores Disponíveis:

- `schema`: Valida estrutura JSON
- `length`: Valida tamanho (min/max characters/words)
- `llm_judge`: LLM avalia qualidade com critérios ponderados

---

### 3. **KERNEL** (`src/kernel/`) - **NÚCLEO DE DECISÃO**

**Responsabilidade**: Executar tasks V5 com políticas e observabilidade

#### Subsistemas:

- `kernel.js` (311 linhas) - Fábrica e composição
- `execution_engine/` - Lógica de execução
- `kernel_loop/` - Loop temporal
- `task_runtime/` - Ciclo de vida de tasks
- `observation_store/` - Armazenar eventos NERV
- `policy_engine/` - Aplicar políticas (timeouts, limites)
- `telemetry/` - Métricas e logs estruturados
- `nerv_bridge/` - Ponte NERV (IPC)
- `task_execution_orchestrator.js` - Integração com OrchestratorEngine

#### Fluxo de Execução:

```
1. TaskRuntime cria task V5
2. OrchestratorEngine verifica se precisa orquestração
3. ExecutionEngine delega para Driver
4. ObservationStore registra eventos
5. PolicyEngine aplica limites
6. Telemetry emite métricas
```

---

### 4. **DRIVER** (`src/driver/`) - **AUTOMAÇÃO BROWSER**

**Responsabilidade**: Interagir com LLMs via Puppeteer

#### Estrutura:

- `factory.js` (178 linhas) - Discovery + instanciação lazy
- `targets/ChatGPTDriver.js` - Implementação ChatGPT
- `core/TargetDriver.js` - Classe base abstrata
- `nerv_adapter/` - Adaptador NERV (zero-coupling)
- `DriverLifecycleManager.js` - Gerenciar ciclo de vida

#### Pattern:

```javascript
const driver = getDriver('chatgpt', page, config, abortSignal);
const response = await driver.execute(task);
```

---

### 5. **INFRA** (`src/infra/`) - **INFRAESTRUTURA**

**Responsabilidade**: Browser pool, locks, queue, storage

#### Componentes:

- `ConnectionOrchestrator.js` (885 linhas, v3.0) - Conexão Chrome multi-modo
- `browser_pool/pool_manager.js` - Pool de browsers
- `proxy/chromeProxyService.js` (648 linhas) - Proxy transparente CDP
- `io.js` - Filesystem operations (tasks, responses, queue)
- `lock_manager.js` - Locks distribuídos
- `queue.js` - Fila de tarefas
- `fs_watcher.js` - Observar mudanças em arquivos

#### Browser Connection Modes:

- `launcher`: PM2 gerencia browser
- `external`: Conecta a Chrome externo
- `auto`: Tenta ambos (fallback strategy)

---

### 6. **SERVER** (`src/server/`) - **DASHBOARD WEB**

**Responsabilidade**: Interface HTTP + WebSocket para monitoramento

#### Estrutura:

- `main.js` - Entry point servidor
- `engine/server.js` - Express HTTP
- `engine/socket.js` - Socket.io (real-time)
- `api/router.js` - Endpoints REST
- `realtime/` - Streams (logs, telemetry, hardware)
- `watchers/` - Observar filesystem

#### Endpoints (Esperados):

- `GET /missions` - Listar missões
- `POST /missions` - Criar missão
- `GET /missions/:id` - Detalhes missão
- `PATCH /missions/:id` - Atualizar (pausar/resumir)
- `POST /missions/:id/feedback` - Injetar feedback
- `GET /missions/:id/progress` - Progresso em tempo real
- `GET /tasks` - Tasks individuais
- `WebSocket /live` - Updates em tempo real

---

### 7. **NERV** (`src/nerv/`) - **EVENT BUS CENTRAL**

**Responsabilidade**: IPC event-driven (zero-coupling entre componentes)

#### Pattern:

```javascript
nerv.sendEvent({
  type: MessageType.ACTION,
  code: ActionCode.TASK_STATE_CHANGE,
  payload: { task_id, new_state },
  metadata: { timestamp, source: 'kernel' },
});
```

#### Componentes Integrados:

- Kernel → NERV → Observers
- Driver → NERV → Telemetry
- Server → NERV → Dashboard clients
- MissionManager → NERV → Kernel

---

## 🌊 FLUXO COMPLETO: MISSÃO → TASKS → EXECUÇÃO

### FASE 1: Criação da Missão (Usuário → Dashboard)

```
1. Usuário acessa Dashboard Web
2. Seleciona template: "Book Writing"
3. Preenche parâmetros:
   - topic: "Rust Programming"
   - num_chapters: 15
   - target_pages: 300
   - quality_threshold: 75
4. Dashboard → POST /missions
5. MissionManager.createMission()
6. WorkflowGenerator.generateWorkflow()
   - Carrega template book_writing.json
   - Valida params
   - Expande steps (repeat_for_each)
   - Substitui placeholders ({{param}})
7. MissionStateManager salva em missions/mission-001/
8. Estado: PENDING
```

### FASE 2: Execução da Missão (MissionManager → Kernel)

```
1. Usuário clica "Start Mission"
2. Dashboard → PATCH /missions/001 { status: "running" }
3. MissionManager.startMission()
4. Estado: RUNNING
5. Para cada STEP no workflow:
   a. MissionManager gera Task V5 com spec.execution.strategy
   b. Envia para Kernel via NERV
   c. Kernel delega para OrchestratorEngine
   d. OrchestratorEngine determina estratégia:
      - SINGLE_SHOT: 1x execução
      - ITERATIVE: Loop com validação
      - MULTI_STEP: Próximo step após conclusão
```

### FASE 3: Execução de Task Individual (Kernel → Driver)

```
1. ExecutionEngine recebe task
2. PolicyEngine valida limites
3. BrowserPoolManager aloca page
4. Factory.getDriver('chatgpt', page, config, signal)
5. Driver.execute(task):
   a. Navega para chatgpt.com
   b. Espera chat input
   c. Envia prompt
   d. Aguarda resposta (incremental collection)
   e. Valida resposta
6. Retorna resultado para Kernel
7. ObservationStore registra eventos
8. Telemetry emite métricas
```

### FASE 4: Validação Iterativa (OrchestratorEngine)

```
Se strategy = ITERATIVE:
1. ValidationService valida resultado
2. Se passou: DONE
3. Se falhou:
   a. Gera feedback para próxima iteração
   b. Atualiza contexto
   c. Retry (até max_iterations)
   d. Se max atingido: FAILED
```

### FASE 5: Progresso e Feedback (MissionManager ↔ Dashboard)

```
1. MissionManager monitora conclusão de steps
2. Salva outputs em missions/001/outputs/
3. Atualiza progress: currentStepIndex++
4. Cria checkpoints periodicamente
5. Dashboard exibe via WebSocket:
   - Progresso geral (7/15 capítulos)
   - Step atual em execução
   - Últimos outputs
6. Usuário pode injetar feedback:
   Dashboard → POST /missions/001/feedback
   {
     "step_id": "step-2-chapter-3",
     "feedback": "Adicione mais exemplos práticos",
     "action": "retry_with_feedback"
   }
7. MissionManager injeta feedback no contexto
8. Próxima iteração usa feedback
```

### FASE 6: Conclusão (MissionManager)

```
1. Todos os steps concluídos
2. MissionManager valida success_criteria:
   - all_chapters_written: true
   - all_validations_passed: true
   - consistency_score_min: 80
3. Se critérios atendidos:
   Estado: COMPLETED
4. Se falhou:
   Estado: FAILED
5. Dashboard notifica usuário
6. Outputs disponíveis em missions/001/outputs/
```

---

## 🔄 INTEGRAÇÃO ENTRE SISTEMAS

### Missões → Orchestrator → Kernel

```
MissionManager: "Preciso executar STEP com strategy ITERATIVE"
       ↓ (gera Task V5)
Kernel: "Recebi task, delego para OrchestratorEngine"
       ↓
OrchestratorEngine: "Strategy ITERATIVE detectada"
       ↓ (beforeExecution)
ExecutionEngine: "Executo via Driver"
       ↓ (executa)
Driver: "Interajo com ChatGPT"
       ↓ (retorna resultado)
OrchestratorEngine: "Valido resultado"
       ↓ (afterExecution)
ValidationService: "Valido com llm_judge"
       ↓ (se falhou)
OrchestratorEngine: "Retry com feedback"
       ↓ (loop até max_iterations ou sucesso)
Kernel: "Task concluída, emito evento NERV"
       ↓
MissionManager: "Recebo conclusão, passo para próximo step"
```

### Dashboard → MissionManager → Kernel

```
Dashboard: "Usuário quer criar missão 'Escrever Livro'"
       ↓ POST /missions
API Router: "Recebo request, delego para MissionManager"
       ↓
MissionManager: "createMission(template='book_writing', params={...})"
       ↓
WorkflowGenerator: "Gero workflow de 17 steps"
       ↓
MissionStateManager: "Salvo em missions/001/"
       ↓ (estado: PENDING)
Dashboard: "Exibo missão criada, botão 'Start'"
       ↓ (usuário clica Start)
       ↓ PATCH /missions/001 { status: "running" }
MissionManager: "startMission()"
       ↓ (gera Task V5 para step-1)
Kernel: "Executo task"
       ↓ (via NERV)
Dashboard: "Recebo updates via WebSocket, exibo progresso"
```

### Feedback Loop (Humano no Loop)

```
Dashboard: Exibe "Chapter 3 completed, quality: 68% (below threshold 75%)"
       ↓
Usuário: "Needs more code examples"
       ↓ POST /missions/001/feedback
MissionManager: "injectFeedback(step_id, feedback, action='retry')"
       ↓
FeedbackProcessor: "Processa feedback humano"
       ↓
ContextManager: "Atualiza contexto para próxima iteração"
       ↓
MissionManager: "Resubmete task com feedback"
       ↓
Kernel: "Executa novamente com contexto atualizado"
       ↓
Driver: "Envia prompt com feedback: 'Previous attempt lacked code examples. Add more.'"
       ↓
ValidationService: "Valida nova resposta → 82% (passed)"
       ↓
MissionManager: "Salva output, próximo step"
```

---

## 🎯 TEMPLATES E WORKFLOWS

### Template book_writing.json (Exemplo Real)

```json
{
  "id": "book_writing",
  "params": {
    "topic": { "type": "string", "required": true },
    "num_chapters": { "type": "number", "default": 15 },
    "quality_threshold": { "type": "number", "default": 75 }
  },
  "workflow_template": {
    "steps": [
      {
        "id": "step-1-outline",
        "strategy": "SINGLE_SHOT",
        "prompt_template": "Generate outline for {{num_chapters}} chapters..."
      },
      {
        "id": "step-2-chapter-{{chapter_num}}",
        "repeat_for_each": "outline.chapters",
        "strategy": "ITERATIVE",
        "max_iterations": 3,
        "validation": {
          "validators": [
            { "type": "length", "min_length": 3000 },
            { "type": "llm_judge", "criteria": {...} }
          ]
        }
      },
      {
        "id": "step-final-consistency",
        "strategy": "SINGLE_SHOT"
      }
    ]
  }
}
```

### Expansão de repeat_for_each

```
Input: outline.chapters = [
  { number: 1, title: "Introduction" },
  { number: 2, title: "Getting Started" },
  ...
]

Output: 15 steps gerados:
- step-2-chapter-1
- step-2-chapter-2
- ...
- step-2-chapter-15
```

---

## 📦 NOVOS SISTEMAS NÃO DOCUMENTADOS

### 1. Missions System (CENTRAL)

- **Estado**: Production Ready (Audit Level 100)
- **Integração**: ✅ Com Kernel, ❌ Com Dashboard (em construção)
- **Persistência**: Filesystem (missions/)
- **Crash Recovery**: Checkpoints automáticos

### 2. Orchestrator System (MOTOR)

- **Estado**: Production Ready (Audit Level 100)
- **Estratégias**: SINGLE_SHOT, ITERATIVE, MULTI_STEP
- **Validadores**: schema, length, llm_judge
- **Integração**: ✅ Com Kernel

### 3. Chrome Proxy (PM2)

- **Estado**: Recém integrado (v3.0, 648 linhas)
- **Modo**: Processo standalone PM2
- **Função**: Proxy transparente CDP (container → Windows Chrome)
- **Status**: ✅ 100% funcional (5/5 testes passando)

### 4. Dashboard Web (EM CONSTRUÇÃO)

- **Estado**: Módulos faltando (snapshot, telemetry)
- **Objetivo**: Interface visual para gerenciar missões
- **Endpoints Necessários**: /missions CRUD, /feedback, WebSocket

---

## 🔍 GAPS IDENTIFICADOS

### 1. Dashboard ↔ Missions Integration

**Status**: ❌ Não integrado **Necessário**:

- Endpoints REST para Missions CRUD
- WebSocket para progresso em tempo real
- UI para criar/monitorar missões

### 2. Feedback System

**Status**: ⚠️ Parcialmente implementado **Existente**: FeedbackProcessor, ContextManager
**Faltando**: Endpoint /missions/:id/feedback no Dashboard

### 3. Validation UI

**Status**: ❌ Não implementado **Necessário**: Dashboard exibir:

- Scores de validação LLM-judge
- Histórico de iterações
- Sugestões de melhoria

### 4. Checkpoint Recovery

**Status**: ✅ Implementado (CheckpointManager) **Testado**: ❌ Não validado end-to-end

### 5. Multi-User Support

**Status**: ❌ Não implementado **Escopo Atual**: Single-user **Futuro**: Autenticação, permissões,
isolamento

---

## 🎓 CONCEITOS-CHAVE

### Task V5 (Unidade de Execução)

```javascript
{
  meta: {
    id: "task-001",
    mission_id: "mission-001",
    workflow_id: "workflow-001",
    step_id: "step-2-chapter-3"
  },
  spec: {
    execution: {
      strategy: "ITERATIVE",  // SINGLE_SHOT | ITERATIVE | MULTI_STEP
      iterative_config: { max_iterations: 3 }
    },
    validation: {
      validators: [
        { type: "length", config: { min_length: 3000 } },
        { type: "llm_judge", config: { criteria: {...} } }
      ]
    }
  },
  data: {
    prompt: "Write Chapter 3...",
    target: "chatgpt"
  }
}
```

### Workflow (Conjunto de Steps)

```javascript
{
  id: "workflow-001",
  template_id: "book_writing",
  steps: [
    { id: "step-1-outline", strategy: "SINGLE_SHOT" },
    { id: "step-2-chapter-1", strategy: "ITERATIVE" },
    ...
  ],
  metadata: {
    total_steps: 17,
    estimated_time: "4-6 hours"
  }
}
```

### Mission State

```javascript
{
  id: "mission-001",
  status: "running",  // pending | running | paused | completed | failed
  workflow: {...},
  progress: {
    current_step_index: 7,
    completed_steps: 6,
    failed_steps: 0
  },
  outputs: {
    "step-1-outline": "missions/001/outputs/step-1-outline.txt",
    "step-2-chapter-1": "missions/001/outputs/step-2-chapter-1.txt"
  }
}
```

---

## 📈 MÉTRICAS ESTIMADAS (Template book_writing)

### Custo (15 capítulos, 2 iterações médias)

- GPT-4: ~$5-8 USD
- GPT-3.5 Turbo: ~$0.50-1.00 USD
- Gemini Pro: ~$0.30-0.60 USD

### Tempo de Execução

- Otimista: 1-2 horas (1 iteração/capítulo)
- Realista: 4-6 horas (2 iterações médias)
- Pessimista: 12-24 horas (3 iterações/capítulo)

### Tokens Estimados

- Outline: ~4,000 tokens
- Por Capítulo: ~8,000 tokens × 2 iterações = 16,000
- Validação: ~2,000 tokens × 2 iterações = 4,000
- Consistency: ~10,000 tokens
- **Total**: ~250,000 tokens (15 capítulos)

---

## 🔍 INVESTIGAÇÃO DOS SUBSISTEMAS RESTANTES

### 7. **SERVER** (`src/server/`) - **DASHBOARD WEB + API**

**Responsabilidade**: Interface externa HTTP + WebSocket + API + Telemetria

#### Arquivos Descobertos:

- `main.js` (376 linhas) - Bootstrap canônico (10 fases)
- `engine/server.js` - HTTP singleton engine (Express bind)
- `engine/socket.js` - Socket.io hub (real-time)
- `engine/lifecycle.js` - Signal/shutdown manager
- `engine/app.js` - Express app configurada
- `api/router.js` - API Gateway (endpoints REST)
- `realtime/` - Streams (logs, telemetry, hardware)
  - `bus/pm2_bridge.js` - Ponte PM2
  - `streams/log_tail.js` - Tail de logs
  - `telemetry/hardware.js` - Métricas de hardware
- `watchers/` - Observadores de infraestrutura
  - `fs_watcher.js` - File system watcher
  - `log_watcher.js` - Log watcher
- `supervisor/reconcilier.js` - Autocura/supervisor
- `nerv_adapter/server_nerv_adapter.js` - Ponte NERV ⇄ Socket
- `middleware/` - Middlewares (auth, rate limit, CORS)
- `dashboard-api/` - API específica do dashboard (?)

#### Bootstrap Sequence (10 Fases Determinísticas):

```
1. Lifecycle / Signal Handling
2. Fundação HTTP (bind de rede, porta única)
3. Estado IPC (persistência para descoberta)
4. Socket Hub (acoplado sobre servidor bound)
5. Router / API (endpoints REST)
6. Telemetria (PM2 bridge, log tail, hardware)
7. Watchers (filesystem, logs)
8. NERV local (instância do processo)
9. ServerNERVAdapter (ponte NERV ⇄ Socket)
10. Reconciler (supervisor/autocura)
```

#### Endpoints Esperados (API):

- `GET /health` - Health check
- `GET /status` - Status geral do sistema
- `GET /metrics` - Métricas de performance
- `GET /queue` - Estado da fila
- `POST /queue` - Adicionar task
- `GET /tasks` - Listar tasks
- `GET /tasks/:id` - Detalhes de task
- `DELETE /tasks/:id` - Cancelar task
- **MISSING**: Endpoints para Missions (`/missions`, `/missions/:id/feedback`)

#### WebSocket Events:

- Emit: `task:state`, `task:progress`, `system:metrics`
- Listen: `task:cancel`, `queue:add`

#### Authority Modes:

- **STANDALONE**: Processo independente, gerencia lifecycle
- **DELEGATED**: Gerenciado por Maestro, suprime exit/signals

#### Status Atual:

- ❌ **Módulos faltando**: `telemetry/snapshot` (comentado temporariamente)
- ⏳ **Endpoints Missions**: Não implementados ainda
- ✅ **HTTP/Socket**: Funcional (endpoints básicos)

---

### 8. **NERV** (`src/nerv/`) - **EVENT BUS CENTRAL**

**Responsabilidade**: IPC event-driven (zero-coupling entre componentes)

#### Arquivos Descobertos:

- `nerv.js` (258 linhas) - Compositor estrutural puro
- `core.js` - Núcleo de primitivas
- `buffers/` - Buffers de eventos (FIFO)
  - `buffers.js` - Inbound/outbound queues
- `transport/` - Camada de transporte
  - `transport.js` - Emit/receive base
  - `hybrid_transport.js` - Local + Socket.io (ONDA 2.6)
- `emission/` - Lógica de emissão
- `reception/` - Lógica de recepção (on/once/onActor)
- `correlation/` - Correlation IDs
  - `correlation_store.js` - Rastreamento end-to-end
- `telemetry/` - Métricas de eventos
  - `ipc_telemetry.js` - Telemetria de IPC
- `health/` - Health check de NERV
- `discovery.js` - Descoberta de processos (IPC)
- `adapters/` - Adaptadores alto nível
  - `high_level_adapter.js` - API simplificada

#### Design Philosophy:

```
NERV é um COMPOSITOR ESTRUTURAL PURO:
- ❌ NÃO executa fluxo
- ❌ NÃO registra callbacks internos
- ❌ NÃO drena buffers
- ❌ NÃO reage a eventos
- ❌ NÃO decide
- ❌ NÃO interpreta

✅ APENAS CONSTRÓI e EXPÕE o NERV
```

#### Transport Modes (ONDA 2.6):

- **LOCAL**: Comunicação in-process (EventEmitter)
- **HYBRID**: Local + Socket.io (multi-processo)
- **CUSTOM**: Transport customizado via adapter

#### Envelope Structure (Protocolo Universal):

```javascript
{
  type: MessageType.ACTION,  // ACTION | QUERY | ACK
  code: ActionCode.TASK_STATE_CHANGE,  // Código semântico
  payload: { task_id, new_state },
  metadata: {
    timestamp: Date.now(),
    correlationId: 'corr-001',
    source: 'kernel',
    actor: { role: ActorRole.KERNEL, pid: 12345 }
  }
}
```

#### API Pública:

```javascript
nerv.emit(envelope); // Emite evento
nerv.send(envelope); // Alias para emit
nerv.emitEvent(envelope); // Evento genérico
nerv.emitCommand(envelope); // Comando específico
nerv.emitAck(envelope); // Acknowledgement
nerv.receive(handler); // Recebe qualquer envelope
nerv.onReceive(handler); // Recebe eventos
nerv.onEvent(filter, handler); // Recebe eventos filtrados
nerv.onCommand(filter, handler); // Recebe comandos
nerv.onActor(role, handler); // Recebe por actor role
```

#### Correlation & Tracing:

- ✅ Correlation IDs automáticos
- ✅ Rastreamento end-to-end
- ✅ Telemetria unificada (latências, throughput)
- ✅ Backpressure control (buffers FIFO)

#### Discovery (IPC):

```javascript
Discovery.publishServerReady(nerv, payload);
// 1. Tenta via NERV (SERVER_READY event)
// 2. Fallback: arquivo state.json (se ENABLE_STATE_FILE=true)
```

#### Status Atual:

- ✅ **Hybrid Transport**: Funcional (local + Socket.io)
- ✅ **Adapters**: KernelNERVBridge, DriverNERVAdapter, ServerNERVAdapter
- ✅ **Correlation**: Rastreamento completo
- ✅ **Health**: Observação de buffers, transport

---

### 9. **CORE** (`src/core/`) - **FUNDAÇÃO**

**Responsabilidade**: Configuração, logger, schemas, identidade

#### Componentes:

- `config.js` - Hot-reload de config.json/dynamic_rules.json
- `logger.js` - Logger estruturado (níveis: DEBUG, INFO, WARN, ERROR)
- `identity/` - DNA do sistema
  - `identity.js` - Geração de identidade única
- `schemas/` - Zod schemas (validação)
  - `task_schema.js` - Schema de tasks V5
  - `config_schema.js` - Schema de config
- `constants/` - Constantes tipadas
  - `tasks.js` - STATUS_VALUES, TASK_STATES
  - `browser.js` - CONNECTION_MODES, BROWSER_STATES
  - `errors.js` - ERROR_CODES
- `authority.js` - Authority modes (STANDALONE, DELEGATED)

---

### 10. **INFRA** (`src/infra/`) - **INFRAESTRUTURA**

**Responsabilidade**: Browser pool, locks, queue, storage

#### Componentes Chave:

- `ConnectionOrchestrator.js` (885 linhas, v3.0) - Conexão Chrome multi-modo
- `browser_pool/pool_manager.js` - Pool de browsers
  - Health checks (crash + degradação)
  - Cleanup automático
- `proxy/chromeProxyService.js` (648 linhas, v3.0) - Proxy CDP transparente
  - PM2 standalone process
  - 5/5 testes passing
- `io.js` - Filesystem operations
  - saveTask(), loadTask(), saveResponse()
  - markDirty() BEFORE writes (P5.2 fix)
- `lock_manager.js` - Locks distribuídos
  - Two-phase commit
  - PID validation
  - UUID-based orphan recovery (P5.3 fix)
- `queue.js` - Fila de tarefas
  - Filesystem-based (fila/\*.json)
  - Priority support
- `fs_watcher.js` - File system watcher
  - 100ms debounce (P5.2 fix)
  - Cache invalidation automática

---

## 📚 COMPARAÇÃO: ARCHITECTURE.md ATUAL vs REAL

### O Que ARCHITECTURE.md v2.0 Documenta:

✅ **13 módulos**: NERV, Kernel, Driver, Infra, Server, Core, Logic, Shared, etc. ✅ **C4
Diagrams**: Context, Container, Component ✅ **Fluxo de Task**: End-to-end (8 fases) ✅ **NERV Event
Bus**: Zero-coupling ✅ **14 Auditorias**: P1-P9 (qualidade 9.2/10) ✅ **Métricas**: Latências,
throughput, resource usage ✅ **Decisões Arquiteturais**: Event-driven, domain-driven

### O Que ESTÁ FALTANDO:

#### 1. **MISSIONS SUBSYSTEM** ❌

- ✅ Implementado: MissionManager (700 linhas), WorkflowGenerator (306 linhas)
- ❌ Não documentado em ARCHITECTURE.md
- **Importância**: CENTRAL para objetivo do sistema (missões de longo prazo)
- **Impacto**: Arquitetura atual não reflete sistema mission-oriented

#### 2. **ORCHESTRATOR SUBSYSTEM** ❌

- ✅ Implementado: OrchestratorEngine (488 linhas)
- ❌ Não documentado em ARCHITECTURE.md
- **Estratégias**: SINGLE_SHOT, ITERATIVE, MULTI_STEP
- **Impacto**: Fluxo de task simplificado, não inclui orquestração avançada

#### 3. **VALIDATION SYSTEM** ❌

- ✅ Implementado: ValidationService (schema, length, llm_judge)
- ❌ Não documentado em ARCHITECTURE.md
- **Importância**: Qualidade de saídas, iteração automática
- **Impacto**: Sistema parece não ter controle de qualidade

#### 4. **TEMPLATE SYSTEM** ❌

- ✅ Implementado: WorkflowGenerator + templates/
- ❌ Não documentado em ARCHITECTURE.md
- **Templates**: book_writing.json (200+ linhas)
- **Impacto**: Não explica como workflows são criados

#### 5. **CHECKPOINT & RECOVERY** ❌

- ✅ Implementado: CheckpointManager, MissionStateManager
- ❌ Não documentado em ARCHITECTURE.md
- **Importância**: Crash recovery para missões longas
- **Impacto**: Sistema parece frágil a crashes

#### 6. **FEEDBACK LOOP** ❌

- ✅ Implementado: FeedbackProcessor, ContextManager
- ❌ Não documentado em ARCHITECTURE.md
- **Importância**: Humano no loop (correções, orientações)
- **Impacto**: Não explica como usuário guia IA

#### 7. **CHROME PROXY** ⚠️

- ✅ Implementado: ChromeProxyService (648 linhas, v3.0)
- ⚠️ Mencionado brevemente, mas não detalhado
- **Status**: PM2 standalone, 5/5 testes passing
- **Impacto**: Arquitetura de conexão não completa

#### 8. **AUTHORITY MODES** ❌

- ✅ Implementado: STANDALONE vs DELEGATED
- ❌ Não documentado em ARCHITECTURE.md
- **Importância**: Deploy modes (single vs multi-processo)
- **Impacto**: Não explica como sistema escala

#### 9. **MISSION vs TASK DISTINCTION** ❌

- ✅ Conceito implementado (hierarquia Mission → Workflow → Step → Task)
- ❌ Não documentado em ARCHITECTURE.md
- **Importância**: FUNDAMENTO conceitual do sistema
- **Impacto**: Arquitetura parece task-oriented, não mission-oriented

---

## 🎯 VISÃO ATUALIZADA: SISTEMA MISSION-ORIENTED

### Redefinição do Objetivo Central

**ANTES (V4 - Task-Oriented)**:

> "Sistema de automação de LLMs que executa tarefas automaticamente via Puppeteer"

**AGORA (V5 - Mission-Oriented)**:

> "Sistema de controle autônomo de LLMs para sustentar **missões de longo prazo** (horas/dias) com
> **baixa interferência humana**, onde usuário atua como **orientador** (correções de rota, feedback
> qualitativo) e IA executa trabalho técnico de forma iterativa com validação automática."

### Hierarquia Conceitual Completa

```
MISSION (Missão de longo prazo: "Escrever livro de 15 capítulos")
└── WORKFLOW (Conjunto estruturado de steps: Outline → Chapters → Consistency)
    └── STEP (Etapa individual: "Write Chapter 3")
        ├── Execution Strategy: ITERATIVE
        ├── Validation: llm_judge (quality_threshold: 75%)
        ├── Max Iterations: 3
        └── TASK(S) (Unidade de execução no Kernel)
            ├── Iteration 1 → Quality 68% → RETRY
            ├── Iteration 2 → Quality 82% → DONE
            └── DRIVER EXECUTION (Interação com ChatGPT via Puppeteer)
```

### Papel do Usuário Redefinido

**NÃO**: Executor de tasks (manual) **SIM**: Orientador de missões (supervisor)

**Ações do Usuário**:

1. **Criar Missão**: Seleciona template, define params (topic, num_chapters)
2. **Iniciar Execução**: Start mission (sistema opera autonomamente)
3. **Monitorar Progresso**: Dashboard exibe progresso (7/15 capítulos)
4. **Injetar Feedback** (quando necessário):
   - "Capítulo 3 precisa de mais exemplos de código"
   - "Ajuste tom para público iniciante"
   - "Adicione seção sobre X no capítulo 5"
5. **Aprovar/Rejeitar**: Validação final (consistency check passed?)
6. **Extrair Outputs**: Download de outputs finais (missions/001/outputs/)

**Frequência de Intervenção**:

- Otimista: 0-2 intervenções (missão 100% autônoma)
- Realista: 3-5 intervenções (correções pontuais)
- Pessimista: 10+ intervenções (ajustes frequentes)

**Tempo de Intervenção**:

- Por feedback: ~30-60 segundos (ler output, escrever feedback)
- Total missão: 5-10 minutos (em 4-6 horas de execução)
- **Razão**: 98%+ do tempo é execução autônoma

---

## 🏗️ ARQUITETURA ATUALIZADA (4 Camadas)

### CAMADA 1: MISSION LAYER (Nova)

**Responsabilidade**: Gerenciar ciclo de vida de missões de longo prazo

**Componentes**:

- MissionManager (CRUD, execução, progresso)
- WorkflowGenerator (templates → workflows)
- MissionStateManager (persistência filesystem)
- FeedbackProcessor (processar feedback humano)
- Templates (book_writing, code_refactor, research, etc.)

**Conceitos**:

- Mission: Unidade de trabalho de longo prazo (horas/dias)
- Workflow: Conjunto estruturado de steps
- Step: Etapa individual com estratégia de execução
- Template: Blueprint reutilizável (params + workflow)

**Estados**: PENDING → RUNNING → PAUSED → COMPLETED/FAILED

**Persistência**:

```
missions/
└── mission-001/
    ├── state.json       # Metadata completo
    ├── outputs/         # Outputs por step
    ├── checkpoints/     # Recovery automático
    └── logs/            # Logs específicos
```

---

### CAMADA 2: ORCHESTRATION LAYER (Nova)

**Responsabilidade**: Implementar estratégias de execução e validação

**Componentes**:

- OrchestratorEngine (shouldOrchestrate, beforeExecution, afterExecution)
- ValidationService (schema, length, llm_judge)
- ContextManager (contexto entre steps)
- CheckpointManager (salvar/restaurar estado)
- MemoryStore (memória de longo prazo)

**Execution Strategies**:

1. **SINGLE_SHOT**: 1x execução, sem validação (comportamento V4 legado)
2. **ITERATIVE**: Loop → Execute → Validate → Retry (até max_iterations ou sucesso)
3. **MULTI_STEP**: Workflow com steps interdependentes (context propagation)

**Validators**:

- `schema`: Valida estrutura JSON (Zod schema)
- `length`: Valida tamanho (min/max chars/words)
- `llm_judge`: LLM avalia qualidade com critérios ponderados
  - Critérios: technical_accuracy (35%), code_quality (25%), clarity (20%), practical_value (20%)
  - Threshold: quality_threshold (default 75%)

**Decision Tree** (afterExecution):

```
Resultado da execução
└── Validação passou? (quality_score >= threshold)
    ├── SIM → Estado: DONE
    └── NÃO → Atingiu max_iterations?
        ├── SIM → Estado: FAILED (max iterations)
        └── NÃO → Estado: RETRY (feedback gerado automaticamente)
```

---

### CAMADA 3: EXECUTION LAYER (Existente)

**Responsabilidade**: Executar tasks V5 com políticas e observabilidade

**Componentes** (já documentados):

- Kernel (loop 20Hz, policy engine, task runtime)
- Driver (Puppeteer automation, factory pattern)
- Infra (browser pool, locks, queue, storage)

**Integração com Orchestrator**:

```
Kernel recebe Task V5 com spec.execution.strategy
    ↓
ExecutionEngine detecta strategy ITERATIVE
    ↓
Delega para OrchestratorEngine.beforeExecution()
    ↓
Driver executa task
    ↓
OrchestratorEngine.afterExecution() valida resultado
    ↓
Decision: DONE | RETRY | FAILED
    ↓
Kernel atualiza estado e emite NERV event
```

---

### CAMADA 4: INTERFACE LAYER (Existente)

**Responsabilidade**: Interface externa (HTTP + WebSocket + API)

**Componentes** (já documentados):

- Server (Express + Socket.io)
- Dashboard (HTML/JS client)
- API (REST endpoints)

**Novos Endpoints Necessários**:

```
GET    /missions                 # Listar missões
POST   /missions                 # Criar missão (template + params)
GET    /missions/:id             # Detalhes missão
PATCH  /missions/:id             # Atualizar (pause/resume)
DELETE /missions/:id             # Cancelar missão
POST   /missions/:id/feedback    # Injetar feedback
GET    /missions/:id/progress    # Progresso em tempo real
GET    /missions/:id/outputs     # Outputs por step
GET    /missions/:id/checkpoints # Checkpoints recovery
```

**WebSocket Events** (novos):

```
mission:created        # Missão criada
mission:started        # Execução iniciada
mission:step:started   # Step iniciado
mission:step:completed # Step concluído
mission:step:failed    # Step falhou
mission:paused         # Missão pausada
mission:resumed        # Missão retomada
mission:completed      # Missão concluída
mission:failed         # Missão falhou
mission:progress       # Update de progresso (%)
```

---

## 📊 COMPARAÇÃO DE COMPLEXIDADE: Task vs Mission

### Task V4 (Simple)

```json
{
  "id": "task-001",
  "status": "PENDING",
  "target": "chatgpt",
  "prompt": "Explain async/await in JavaScript",
  "timeout": 120
}
```

**Lifecycle**: PENDING → RUNNING → DONE (3 estados, ~2 minutos)

### Mission V5 (Complex)

```json
{
  "id": "mission-001",
  "template_id": "book_writing",
  "params": {
    "topic": "Rust Programming",
    "num_chapters": 15,
    "quality_threshold": 75
  },
  "workflow": {
    "steps": [
      {
        "id": "step-1-outline",
        "strategy": "SINGLE_SHOT",
        "estimated_time": "5 min"
      },
      {
        "id": "step-2-chapter-1",
        "strategy": "ITERATIVE",
        "max_iterations": 3,
        "estimated_time": "15-30 min"
      },
      ...  // 15 capítulos
      {
        "id": "step-final-consistency",
        "strategy": "SINGLE_SHOT",
        "estimated_time": "10 min"
      }
    ]
  },
  "progress": {
    "current_step_index": 7,
    "completed_steps": 6,
    "failed_steps": 0,
    "total_steps": 17,
    "elapsed_time": "2h 34m",
    "estimated_remaining": "1h 48m"
  }
}
```

**Lifecycle**: PENDING → RUNNING (17 steps) → COMPLETED (4-6 horas) **Complexity**: 100x maior que
task simples

---

## 🔄 FLUXO COMPLETO ATUALIZADO: MISSÃO END-TO-END

### FASE 1: Criação da Missão (Usuário → Dashboard)

```
1. Usuário acessa Dashboard Web (localhost:3008)
2. Navega para "Create Mission"
3. Seleciona template: "Book Writing"
4. Preenche params:
   - topic: "Rust Programming"
   - num_chapters: 15
   - target_pages: 300
   - target_audience: "intermediate developers"
   - quality_threshold: 75
5. Clica "Create Mission"
   ↓
6. Dashboard → POST /missions { template_id, params }
   ↓
7. API Router → MissionManager.createMission()
   ↓
8. WorkflowGenerator.generateWorkflow()
   a. Carrega template missions/templates/book_writing.json
   b. Valida params contra schema
   c. Expande steps (repeat_for_each outline.chapters)
   d. Substitui placeholders ({{topic}}, {{num_chapters}})
   ↓
9. MissionStateManager salva em missions/mission-001/
   a. state.json (metadata + workflow)
   b. Cria diretórios: outputs/, checkpoints/, logs/
   ↓
10. Estado inicial: PENDING
11. Dashboard exibe "Mission Created" + botão "Start Mission"
```

### FASE 2: Execução da Missão (MissionManager → Orchestrator → Kernel)

```
1. Usuário clica "Start Mission"
   ↓
2. Dashboard → PATCH /missions/001 { status: "running" }
   ↓
3. MissionManager.startMission()
   a. Atualiza estado: RUNNING
   b. Inicializa contexto vazio
   c. currentStepIndex = 0
   ↓
4. Para cada STEP no workflow (loop):
   a. step = workflow.steps[currentStepIndex]
   b. MissionManager gera Task V5:
      {
        meta: {
          id: "task-001",
          mission_id: "mission-001",
          workflow_id: "workflow-001",
          step_id: "step-1-outline"
        },
        spec: {
          execution: {
            strategy: "SINGLE_SHOT",  // do template
            timeout: 300
          },
          validation: {
            validators: [
              { type: "schema", config: {...} },
              { type: "length", config: { min_length: 500 } }
            ]
          }
        },
        data: {
          prompt: "Generate outline for 15 chapters on Rust Programming...",
          target: "chatgpt"
        }
      }
   c. MissionManager → NERV.emit('MISSION_TASK_CREATED', task)
   d. Kernel escuta evento e recebe task
   ↓
5. Kernel.TaskRuntime cria task no sistema
   a. Estado: PENDING
   b. Adiciona à fila interna
   ↓
6. Kernel.KernelLoop (20Hz) detecta task
   a. PolicyEngine valida limites (MAX_WORKERS=3)
   b. Aloca worker disponível
   c. Estado: RUNNING
   ↓
7. Kernel.ExecutionEngine recebe task
   a. Detecta spec.execution.strategy = "SINGLE_SHOT"
   b. shouldOrchestrate(task) → true (tem validators)
   c. Delega para OrchestratorEngine
   ↓
8. OrchestratorEngine.beforeExecution(task)
   a. Cria activeWorkflow entry
   b. Inicializa contexto
   c. Salva checkpoint
   ↓
9. ExecutionEngine → Driver.Factory.getDriver('chatgpt', page)
   ↓
10. ChatGPTDriver.execute(task)
    a. Navega para chat.openai.com
    b. Detecta chat input
    c. Digita prompt (human typing)
    d. Aguarda resposta (30-120s)
    e. Coleta resposta incremental (chunks)
    f. Retorna resultado
    ↓
11. OrchestratorEngine.afterExecution(task, result)
    a. ValidationService.validate(result, spec.validation)
       - schema validator: JSON válido? ✓
       - length validator: length >= 500? ✓
    b. Validação passou → Decision: DONE
    c. Remove activeWorkflow entry
    d. Retorna 'DONE'
    ↓
12. Kernel.TaskRuntime atualiza estado: DONE
13. Kernel → NERV.emit('TASK_STATE_CHANGE', { task_id, state: 'DONE', result })
    ↓
14. MissionManager escuta evento
    a. Salva output: missions/001/outputs/step-1-outline.txt
    b. Atualiza progress: completed_steps++
    c. Cria checkpoint
    d. currentStepIndex++
    e. Próximo step (se não atingiu total_steps)
```

### FASE 3: Step ITERATIVE (Capítulo 1)

```
1. MissionManager gera Task V5 para step-2-chapter-1:
   {
     spec: {
       execution: {
         strategy: "ITERATIVE",  // ← Estratégia diferente
         iterative_config: {
           max_iterations: 3,
           validation_criteria: { min_quality_score: 75 }
         }
       },
       validation: {
         validators: [
           { type: "length", config: { min_length: 3000 } },
           { type: "llm_judge", config: {
               criteria: {
                 technical_accuracy: 35,
                 code_quality: 25,
                 clarity: 20,
                 practical_value: 20
               },
               min_score: 75
             }
           }
         ]
       }
     }
   }
   ↓
2. Kernel → OrchestratorEngine.beforeExecution()
   a. Detecta strategy: ITERATIVE
   b. Inicializa activeIterations.set(task_id, { iteration: 1, context: {} })
   ↓
3. Driver executa (primeira iteração)
   ↓
4. OrchestratorEngine.afterExecution()
   a. ValidationService.validate()
      - length: 4,200 chars ✓
      - llm_judge: quality_score = 68%  ✗ (abaixo de 75%)
   b. Validação falhou
   c. iteration < max_iterations? (1 < 3) → SIM
   d. Gera feedback automático:
      "Quality score 68% below threshold 75%. Improvements needed:
       - Technical accuracy: 65% (target 75%+)
       - Code quality: 70% (good, maintain)
       Suggestion: Add more technical depth, improve code examples."
   e. Atualiza contexto: context.feedback = feedback
   f. Decision: RETRY
   ↓
5. Kernel mantém task RUNNING (não DONE)
6. Driver re-executa com feedback no prompt:
   "Previous attempt (iteration 1) had quality score 68%. Feedback: ..."
   ↓
7. ValidationService.validate() (segunda iteração)
   - llm_judge: quality_score = 82% ✓ (acima de 75%)
   ↓
8. Validação passou → Decision: DONE
9. MissionManager salva output com metadata:
   missions/001/outputs/step-2-chapter-1.json:
   {
     "content": "Chapter 1: Introduction to Rust...",
     "iterations": 2,
     "quality_score": 82,
     "validator_results": { ... }
   }
```

### FASE 4: Feedback Humano (Usuário Intervém)

```
1. Dashboard exibe progresso:
   "Step 8/17: Chapter 3 completed
    Quality Score: 68% (below threshold 75%)
    Max iterations (3) reached
    Status: FAILED"
   ↓
2. Usuário lê output (missions/001/outputs/step-2-chapter-3.txt)
3. Identifica problema: "Lacks practical code examples"
4. Dashboard → POST /missions/001/feedback
   {
     "step_id": "step-2-chapter-3",
     "feedback": "Add at least 3 practical Rust code examples with explanations",
     "action": "retry_with_feedback"
   }
   ↓
5. MissionManager.injectFeedback()
   a. FeedbackProcessor processa feedback humano
   b. ContextManager atualiza contexto do step:
      context.human_feedback = "Add at least 3 practical Rust code examples..."
   c. Reseta iteration counter para step-2-chapter-3
   d. Re-submete task ao Kernel
   ↓
6. Driver executa com contexto atualizado:
   Prompt: "Write Chapter 3 on Rust Programming.
            Previous attempts lacked practical code examples.
            Human feedback: Add at least 3 practical Rust code examples..."
   ↓
7. ValidationService.validate()
   - llm_judge: quality_score = 84% ✓
   ↓
8. MissionManager salva output com flag human_assisted=true
```

### FASE 5: Conclusão (MissionManager)

```
1. Todos os steps concluídos (currentStepIndex == total_steps)
   ↓
2. MissionManager valida success_criteria:
   a. all_chapters_written: 15/15 ✓
   b. all_validations_passed: 14/15 ✓ (1 com feedback humano)
   c. consistency_score: 85% ✓ (acima de 80%)
   ↓
3. Critérios atendidos → Estado: COMPLETED
4. MissionStateManager atualiza state.json:
   {
     "status": "completed",
     "completed_at": "2026-02-01T18:45:00Z",
     "elapsed_time": "4h 12m",
     "stats": {
       "total_steps": 17,
       "completed_steps": 17,
       "failed_steps": 1,
       "human_interventions": 1,
       "total_iterations": 38,
       "avg_quality_score": 81.2,
       "total_cost_usd": 6.84
     }
   }
   ↓
5. Dashboard → WebSocket 'mission:completed'
6. Dashboard exibe:
   "✅ Mission Completed Successfully!
    Outputs available at: missions/001/outputs/
    Download all outputs as ZIP"
```

---

## 🚧 GAPS CRÍTICOS ENTRE CÓDIGO E ARQUITETURA

### 1. **Missions Subsystem** (❌ NÃO DOCUMENTADO)

**Gravidade**: 🔴 **CRÍTICA** **Componentes**: MissionManager, WorkflowGenerator,
MissionStateManager, Templates **Linhas de Código**: ~1,400+ (3 arquivos principais) **Status**: ✅
Implementado, ❌ Não documentado **Impacto**: Arquitetura atual NÃO explica sistema mission-oriented

**Precisa**:

- Seção "Mission Layer" no ARCHITECTURE.md
- Diagrama de hierarquia (Mission → Workflow → Step → Task)
- Fluxo de criação/execução de missões
- Templates e expansão de workflows

---

### 2. **Orchestrator Subsystem** (❌ NÃO DOCUMENTADO)

**Gravidade**: 🔴 **CRÍTICA** **Componentes**: OrchestratorEngine, ValidationService,
ContextManager, CheckpointManager **Linhas de Código**: ~800+ (orchestrator/) **Status**: ✅
Implementado, ❌ Não documentado **Impacto**: Fluxo de task simplificado, não inclui orquestração
avançada

**Precisa**:

- Seção "Orchestration Layer" no ARCHITECTURE.md
- Explicação de 3 estratégias (SINGLE_SHOT, ITERATIVE, MULTI_STEP)
- Decision tree de validação (afterExecution)
- Fluxo de retry automático

---

### 3. **Validation System** (❌ NÃO DOCUMENTADO)

**Gravidade**: 🟡 **ALTA** **Componentes**: ValidationService, llm_judge, validators **Status**: ✅
Implementado, ❌ Não documentado **Impacto**: Sistema parece não ter controle de qualidade

**Precisa**:

- Seção "Validation Strategies" no ARCHITECTURE.md
- Explicação de 3 validators (schema, length, llm_judge)
- Critérios ponderados do LLM judge
- Quality thresholds e iteração automática

---

### 4. **Template System** (❌ NÃO DOCUMENTADO)

**Gravidade**: 🟡 **ALTA** **Componentes**: WorkflowGenerator, templates/, repeat_for_each
**Status**: ✅ Implementado (book_writing.json), ❌ Não documentado **Impacto**: Não explica como
workflows são criados

**Precisa**:

- Seção "Template System" no ARCHITECTURE.md
- Estrutura de template (params, workflow_template, success_criteria)
- Expansão de repeat_for_each
- Substituição de placeholders ({{param}})

---

### 5. **Feedback Loop** (❌ NÃO DOCUMENTADO)

**Gravidade**: 🟡 **ALTA** **Componentes**: FeedbackProcessor, ContextManager, endpoint
/missions/:id/feedback **Status**: ⚠️ Implementado (parcial - endpoint faltando), ❌ Não documentado
**Impacto**: Não explica como usuário guia IA

**Precisa**:

- Seção "Human-in-the-Loop" no ARCHITECTURE.md
- Fluxo de injeção de feedback
- Propagação de contexto entre iterações
- UI/UX de feedback no dashboard

---

### 6. **Checkpoint & Recovery** (❌ NÃO DOCUMENTADO)

**Gravidade**: 🟡 **MÉDIA** **Componentes**: CheckpointManager, MissionStateManager (checkpoints/)
**Status**: ✅ Implementado, ❌ Testado end-to-end **Impacto**: Sistema parece frágil a crashes

**Precisa**:

- Seção "Crash Recovery" no ARCHITECTURE.md
- Frequência de checkpoints (por step? por validação?)
- Processo de recovery (auto vs manual)
- Testes de recovery (simular crash)

---

### 7. **Authority Modes** (❌ NÃO DOCUMENTADO)

**Gravidade**: 🟢 **BAIXA** **Componentes**: Authority.js (STANDALONE vs DELEGATED) **Status**: ✅
Implementado, ❌ Não documentado **Impacto**: Não explica deploy modes

**Precisa**:

- Seção "Deployment Modes" no ARCHITECTURE.md
- STANDALONE: Processo único, gerencia lifecycle
- DELEGATED: Gerenciado por Maestro, suprime exit/signals
- Casos de uso (single-user vs multi-user)

---

## 📝 PRÓXIMOS PASSOS (RECOMENDAÇÕES)

### FASE 1: Atualizar ARCHITECTURE.md (URGENTE)

**Prazo**: 1-2 dias **Responsável**: AI Agent (com aprovação do usuário)

**Seções a Adicionar**:

1. **Mission-Oriented Design** (nova seção inicial)
   - Objetivo central redefinido
   - Hierarquia Mission → Workflow → Step → Task
   - Papel do usuário (orientador)
2. **Mission Layer** (nova camada)
   - MissionManager, WorkflowGenerator, MissionStateManager
   - Template system (book_writing.json)
   - Estados e persistência (missions/)
3. **Orchestration Layer** (nova camada)
   - OrchestratorEngine (3 estratégias)
   - ValidationService (3 validators)
   - ContextManager, CheckpointManager
4. **Validation Strategies** (nova seção)
   - schema, length, llm_judge
   - Decision tree (afterExecution)
   - Quality thresholds
5. **Human-in-the-Loop** (nova seção)
   - FeedbackProcessor, injectFeedback()
   - Endpoint /missions/:id/feedback
   - UI/UX de correção de rota
6. **Crash Recovery** (nova seção)
   - CheckpointManager (frequência, estrutura)
   - Recovery automático vs manual
7. **Deployment Modes** (nova seção)
   - STANDALONE vs DELEGATED
   - Casos de uso

**Atualizar Seções Existentes**:

- **Fluxo de Task**: Adicionar fluxo de missão end-to-end (6 fases)
- **C4 Diagrams**: Incluir Mission/Orchestrator layers
- **Métricas**: Adicionar métricas de missões (book_writing: 4-6h, $5-8)

**Documentos Relacionados a Criar**:

- `MISSIONS_GUIDE.md` - Guia completo para criar missões
- `TEMPLATES_REFERENCE.md` - Referência de templates
- `VALIDATION_STRATEGIES.md` - Deep dive em validação

---

### FASE 2: Implementar Endpoints Missions (ALTA PRIORIDADE)

**Prazo**: 2-3 dias **Responsável**: Desenvolvedor

**Endpoints a Implementar** (src/server/api/router.js):

```javascript
GET    /missions                 # Listar missões
POST   /missions                 # Criar missão
GET    /missions/:id             # Detalhes missão
PATCH  /missions/:id             # Atualizar (pause/resume)
DELETE /missions/:id             # Cancelar missão
POST   /missions/:id/feedback    # Injetar feedback
GET    /missions/:id/progress    # Progresso em tempo real
GET    /missions/:id/outputs     # Download outputs
GET    /missions/:id/checkpoints # Listar checkpoints
```

**WebSocket Events** (src/server/engine/socket.js):

```javascript
mission:created, mission:started, mission:step:started,
mission:step:completed, mission:step:failed, mission:paused,
mission:resumed, mission:completed, mission:failed, mission:progress
```

---

### FASE 3: Dashboard UI para Missions (MÉDIA PRIORIDADE)

**Prazo**: 3-5 dias **Responsável**: Frontend Developer

**UI Components Necessários**:

1. **Mission Creator**:
   - Template selector
   - Param editor (form dinâmico)
   - Preview de workflow gerado
2. **Mission Monitor**:
   - Progresso geral (7/15 capítulos)
   - Step atual em execução
   - Quality scores por step
   - Iterações por step
3. **Feedback Interface**:
   - Ler output de step
   - Escrever feedback
   - Ações: retry, skip, abort
4. **Outputs Explorer**:
   - Navegar outputs por step
   - Download individual ou ZIP
   - Metadata (quality_score, iterations)

---

### FASE 4: Testes End-to-End (ALTA PRIORIDADE)

**Prazo**: 1-2 dias **Responsável**: QA / AI Agent

**Testes Necessários**:

1. **test-mission-minimal.js**:
   - Template book_writing com num_chapters=2
   - Valida criação → execução → conclusão
2. **test-mission-iterative.js**:
   - Simula falha de validação → retry automático
3. **test-mission-feedback.js**:
   - Injeta feedback humano → retry com contexto
4. **test-mission-recovery.js**:
   - Simula crash durante execução → recovery automático
5. **test-template-expansion.js**:
   - Valida repeat_for_each e placeholders

---

### FASE 5: Melhorias de Qualidade (BAIXA PRIORIDADE)

**Prazo**: 1-2 semanas **Responsável**: Equipe completa

**Melhorias Sugeridas**:

1. **Multi-User Support**:
   - Autenticação (JWT tokens)
   - Isolamento de missões por usuário
   - Permissões (create, view, edit, delete)
2. **Advanced Templates**:
   - code_refactor.json (refatorar codebase)
   - research.json (pesquisa acadêmica)
   - content_creation.json (posts, artigos)
3. **LLM Judge Customization**:
   - Critérios customizados por template
   - Pesos ajustáveis pelo usuário
4. **Cost Tracking**:
   - Rastreamento de tokens por missão
   - Estimativas de custo antes de iniciar
   - Relatórios de custo por template
5. **Mission Analytics**:
   - Dashboards de métricas (avg quality, iterations, cost)
   - Comparação entre templates
   - Otimização de params

---

## 🎓 CONCLUSÃO DA INVESTIGAÇÃO

### Descobertas Principais

1. **Sistema É Mission-Oriented, Não Task-Oriented**:
   - Código implementa camadas Mission + Orchestration
   - ARCHITECTURE.md documenta apenas Execution Layer
   - GAP crítico: ~40% da arquitetura não documentada

2. **Complexidade Real É 100x Maior**:
   - Task simples (V4): 1 execução, ~2 min
   - Mission complexa (V5): 17 steps, 4-6 horas, 38 iterações
   - Usuário intervém ~2-5x em 4-6 horas (98% autonomia)

3. **Validação Automática É Core Feature**:
   - LLM-as-judge com critérios ponderados
   - Retry automático até max_iterations
   - Quality threshold enforcement (75%+)

4. **Templates São Blueprints Reutilizáveis**:
   - book_writing.json = 200+ linhas JSON
   - Params dinâmicos, workflow expansion, placeholders
   - Success criteria customizáveis

5. **Crash Recovery É Implementado**:
   - Checkpoints automáticos por step
   - Recovery de missions/001/checkpoints/
   - Testado? ❌ (precisa validação end-to-end)

6. **Dashboard É 60% Funcional**:
   - ✅ HTTP/WebSocket básico
   - ❌ Endpoints Missions faltando
   - ❌ UI de feedback não implementada

### Recomendação Final

**URGENTE**:

1. ✅ Atualizar ARCHITECTURE.md com camadas Mission + Orchestration
2. ✅ Documentar fluxo de missão end-to-end (6 fases)
3. ⚠️ Implementar endpoints /missions (8 endpoints)
4. ⚠️ Testar end-to-end (5 testes críticos)

**IMPORTANTE**:

- Criar MISSIONS_GUIDE.md (guia completo)
- Dashboard UI para missions
- Validar crash recovery

**OPCIONAL**:

- Multi-user support
- Advanced templates
- LLM judge customization

### Próximo Passo Imediato

**PROPOSTA**: Atualizar ARCHITECTURE.md com nova estrutura completa

- Adicionar 7 novas seções (Mission Layer, Orchestration, etc.)
- Atualizar 3 seções existentes (Fluxo, C4, Métricas)
- Criar 3 documentos relacionados (Guides, References)
- **Estimativa**: 1,500-2,000 linhas finais (vs 1,174 atuais)

**Aguardando aprovação do usuário** para prosseguir com atualização.
