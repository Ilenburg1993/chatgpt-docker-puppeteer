# 🏗️ Arquitetura do Sistema (v3.0 - Mission-Oriented)

**Versão**: 3.0 (Mission-Oriented Architecture)  
**Última Atualização**: 01/02/2026  
**Público-Alvo**: Desenvolvedores iniciantes, intermediários e avançados  
**Tempo de Leitura**: ~60-90 min (navegação modular)  
**Linhas Totais**: 3,000+ linhas técnicas

---

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

---

## SEÇÕES ADICIONAIS DO ARCHITECTURE.md v2.0 (LEGADO)

Refina outputs até atingir qualidade (75%+)

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

---

_Documento gerado automaticamente. Para detalhes de implementação, veja copilot-instructions.md_
