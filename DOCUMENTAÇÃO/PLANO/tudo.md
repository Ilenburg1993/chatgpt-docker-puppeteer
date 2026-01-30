Documentação Completa Criada
Agora você tem 5 documentos exaustivos e robustos na pasta /home/node/.claude/plans/:

01-MISSION_ARCHITECTURE.md (8 seções)

Arquitetura hierárquica: Mission → Workflow → Tasks
Lifecycle de missões
Criação e supervisão de missões
02-AUTONOMOUS_EXECUTION.md (8 seções)

Decomposição automática
Execução iterativa com auto-correção
Sistema de validação
Context management e memória
Checkpoint recovery
03-FEEDBACK_LOOPS.md (7 seções)

LLM→LLM feedback (LLM-as-judge)
Human→LLM feedback
System→LLM feedback
Contextual learning
04-MISSION_EXAMPLES.md (5 exemplos completos)

Book Writing (25h, 87 tasks, $42.50)
API Development (11h, test-driven)
Research Report (7h 45min, 38 citations)
Translation (5 languages)
Code Refactoring (jQuery → React)
05-IMPLEMENTATION_ROADMAP.md (17 semanas detalhadas) ✨ NOVO

Parte 1: Dashboard Enterprise (Semanas 1-5)
Parte 2: Sistema de Orquestração (Semanas 6-17)
Tarefas dia-a-dia para Semana 1
Entregáveis e critérios de aceite
Riscos, mitigações, recursos necessários
Sistema Completo
Você agora possui o planejamento completo para transformar o chatgpt-docker-puppeteer em uma plataforma de orquestração autônoma de LLMs de nível enterprise, capaz de:

✅ Escrever livros completos com supervisão mínima
✅ Desenvolver projetos de software com testes automáticos
✅ Conduzir pesquisas extensas com fact-checking
✅ Executar missões complexas de longa duração
✅ Dashboard profissional com telemetria profunda
✅ Controle granular de LLMs via interface gráfica
✅ Auto-correção e refinamento iterativo
✅ Feedback loops automáticos

Duração: 17 semanas
Status: ✅ Planejamento completo, pronto para implementação

Claude’s Plan
Plano: Dashboard Enterprise com Telemetria Profunda e Gerenciamento Avançado de Tarefas
Status: ✅ PRONTO PARA IMPLEMENTAÇÃO
Decisões do Usuário
Frontend: Vue.js 3 + Vite (substituição completa)
Complexidade: Profissional/Enterprise
Visualizações Prioritárias: Todas (DAG, métricas real-time, event flow, health dashboard)
1. VISÃO GERAL DA ARQUITETURA
Stack Tecnológica Aprovada
Frontend (Novo):

Vue.js 3.5+ (Composition API)
Vite 6.0+ (build tooling)
Pinia 2.3+ (state management)
Vue Router 4.5+ (SPA routing)
Socket.io Client 4.8+ (real-time)
Axios 1.7+ (HTTP client)
Visualizações:

Chart.js 4.4+ + vue-chartjs (métricas de performance)
Cytoscape.js 3.31+ (DAG de dependências)
Vis-Timeline 7.7+ (event correlation timeline)
D3.js 7.9+ (visualizações customizadas)
UI Components:

Element Plus 2.9+ OU Vuetify 3.7+ (a escolher durante implementação)
Tailwind CSS 4.1+ (utility-first styling - opcional)
Backend (Extensões):

Express 4.22+ (mantido)
Socket.io 4.8+ (mantido, estendido)
Novas APIs RESTful (workflows, templates, telemetria agregada)
graphlib 2.1+ (validação de DAG)
2. ESTRUTURA DE DIRETÓRIOS COMPLETA

/workspaces/chatgpt-docker-puppeteer/
├── src/
│   ├── dashboard-ui/                          # NOVO: Aplicação Vue.js 3
│   │   ├── src/
│   │   │   ├── main.js                        # Entry point
│   │   │   ├── App.vue                        # Root component
│   │   │   ├── router/index.js                # Vue Router config
│   │   │   ├── stores/                        # Pinia stores
│   │   │   │   ├── tasks.js                   # Task management state
│   │   │   │   ├── telemetry.js               # Real-time metrics
│   │   │   │   ├── system.js                  # System health
│   │   │   │   ├── workflow.js                # DAG workflows
│   │   │   │   └── nerv.js                    # Event correlation
│   │   │   ├── composables/                   # Vue composition utilities
│   │   │   │   ├── useSocket.js               # Socket.io hook
│   │   │   │   ├── useRealtime.js             # Real-time subscriptions
│   │   │   │   ├── useTaskAPI.js              # Task CRUD
│   │   │   │   └── useNotifications.js        # Toast system
│   │   │   ├── views/                         # Page components
│   │   │   │   ├── Dashboard.vue              # Main overview
│   │   │   │   ├── TaskQueue.vue              # Task list + filters
│   │   │   │   ├── TaskDetail.vue             # Task editor
│   │   │   │   ├── WorkflowEditor.vue         # DAG visual editor
│   │   │   │   ├── PerformanceMetrics.vue     # Charts + gauges
│   │   │   │   ├── EventCorrelation.vue       # NERV timeline
│   │   │   │   ├── SystemHealth.vue           # Component health
│   │   │   │   └── Templates.vue              # Task templates
│   │   │   ├── components/                    # Reusable UI
│   │   │   │   ├── layout/                    # Layout wrappers
│   │   │   │   ├── task/                      # Task components
│   │   │   │   ├── workflow/                  # DAG components
│   │   │   │   ├── charts/                    # Chart wrappers
│   │   │   │   ├── telemetry/                 # Telemetry UI
│   │   │   │   ├── health/                    # Health cards
│   │   │   │   └── common/                    # Generic UI
│   │   │   ├── services/                      # API + business logic
│   │   │   │   ├── api/                       # REST clients
│   │   │   │   ├── socket/                    # Socket.io client
│   │   │   │   └── mappers/                   # Data transforms
│   │   │   ├── utils/                         # Utilities
│   │   │   ├── types/                         # JSDoc type defs
│   │   │   └── assets/                        # Static assets
│   │   ├── vite.config.js                     # Vite config
│   │   └── package.json                       # Frontend deps
│   │
│   ├── server/
│   │   ├── api/controllers/
│   │   │   ├── tasks.js                       # EXISTENTE (estender)
│   │   │   ├── workflows.js                   # NOVO: Workflow CRUD
│   │   │   ├── templates.js                   # NOVO: Templates CRUD
│   │   │   ├── telemetry.js                   # NOVO: Metrics API
│   │   │   └── health.js                      # NOVO: Health aggregation
│   │   ├── dashboard-api/                     # NOVO: Dashboard backend
│   │   │   ├── telemetry_aggregator.js        # Metrics aggregation
│   │   │   ├── event_correlator.js            # NERV correlation
│   │   │   ├── task_synchronizer.js           # Queue ↔ Kernel sync
│   │   │   ├── workflow_engine.js             # DAG validation
│   │   │   └── template_manager.js            # Template storage
│   │   ├── realtime/
│   │   │   ├── telemetry/metrics_stream.js    # NOVO: Streaming metrics
│   │   │   └── events/nerv_stream.js          # NOVO: NERV streaming
│   │   └── engine/
│   │       └── socket.js                      # EXISTENTE (estender)
│   │
│   ├── infra/queue/
│   │   └── task_sync_bridge.js                # NOVO: Bridge Queue↔Kernel
│   │
│   └── shared/
│       ├── types/
│       │   ├── workflow.js                    # NOVO: Workflow schema
│       │   └── template.js                    # NOVO: Template schema
│       └── constants/
│           └── dashboard.js                   # NOVO: Dashboard constants
│
└── public/                                     # LEGADO (manter temporariamente)
3. COMPONENTES PRINCIPAIS DO DASHBOARD
3.1 Hierarquia de Componentes Vue

App.vue
└── AppLayout.vue
    ├── Header.vue (user menu, notifications, theme toggle)
    ├── Sidebar.vue (navigation links)
    └── <router-view>
        ├── Dashboard.vue                      # Rota: /
        │   ├── MetricsGrid (CPU, RAM, NERV, throughput)
        │   ├── TaskSummary (quick stats)
        │   └── HealthCard[] (Kernel, Driver, Browser)
        │
        ├── TaskQueue.vue                      # Rota: /tasks
        │   ├── TaskFilters (status, priority, date)
        │   ├── TaskList → TaskCard[] (v-for)
        │   └── BulkActions (retry all, delete all)
        │
        ├── TaskDetail.vue                     # Rota: /tasks/:id
        │   ├── TaskForm (edit form)
        │   ├── TaskJSON (raw editor)
        │   └── ExecutionHistory (NERV events)
        │
        ├── WorkflowEditor.vue                 # Rota: /workflows
        │   ├── DAGCanvas (Cytoscape.js)
        │   ├── WorkflowToolbar
        │   └── DependencyGraph (minimap)
        │
        ├── PerformanceMetrics.vue             # Rota: /metrics
        │   ├── LineChart[] (CPU, memory, latency)
        │   ├── GaugeChart[] (event loop lag)
        │   └── MetricsTable (detailed stats)
        │
        ├── EventCorrelation.vue               # Rota: /events
        │   ├── EventTimeline (Vis-Timeline)
        │   ├── GanttChart (task execution)
        │   └── CorrelationViewer (tree)
        │
        ├── SystemHealth.vue                   # Rota: /health
        │   ├── HealthCard[] (per component)
        │   └── AlertPanel (system alerts)
        │
        └── Templates.vue                      # Rota: /templates
            ├── TemplateGrid → TemplateCard[]
            └── TemplateForm (create/edit)
3.2 Pinia State Stores
stores/tasks.js - Gerenciamento de Tarefas

state: {
  tasks: [],              // Unified view (disk + kernel)
  filters: {},            // Current filters
  selectedTaskId: null,
  loading: false,
  error: null
}

getters: {
  filteredTasks,          // Apply filters
  runningTasks,           // Status == RUNNING
  pendingTasks,           // Status == PENDING
  taskById(id)            // Lookup by ID
}

actions: {
  fetchTasks(),           // GET /api/tasks
  createTask(payload),    // POST /api/tasks
  updateTask(id, data),   // PUT /api/tasks/:id
  deleteTask(id),         // DELETE /api/tasks/:id
  retryTask(id),          // POST /api/tasks/:id/retry
  handleTaskUpdate(data)  // Real-time Socket.io update
}
stores/telemetry.js - Telemetria Real-time

state: {
  cpuHistory: [],         // Ring buffer (last 1000 points)
  memoryHistory: [],
  nervLatency: [],
  throughput: [],
  eventLoopLag: [],
  current: {              // Current snapshot
    cpu: 0,
    memory: 0,
    nervLatency: 0,
    throughput: 0
  },
  stats: {                // Aggregated stats
    totalEvents: 0,
    eventsPerSecond: 0,
    avgLatency: 0
  }
}

actions: {
  fetchMetrics(),         // GET /api/telemetry/metrics
  addDataPoint(metric, value),  // Add to ring buffer
  handleTelemetryUpdate(data)   // Socket.io update
}
stores/system.js - System Health

state: {
  components: {
    kernel: { status, uptime, errors },
    driver: { status, uptime, errors },
    browserPool: { status, instances },
    nerv: { status, latency },
    queue: { status, size, corrupt }
  },
  alerts: []              // Active alerts
}

actions: {
  fetchHealth(),          // GET /api/health/aggregate
  handleHealthUpdate(component, data)
}
stores/workflow.js - Workflows e DAG

state: {
  workflows: [],          // All workflows
  currentWorkflow: null,  // DAG editor state
  templates: []           // Task templates
}

actions: {
  fetchWorkflows(),       // GET /api/workflows
  saveWorkflow(workflow), // POST /api/workflows
  validateDAG(nodes, edges)  // Client-side validation
}
stores/nerv.js - Event Correlation

state: {
  events: [],             // Recent events (ring buffer)
  correlationMap: {},     // correlationId → Event[]
  filters: {
    actor: null,
    actionCode: null,
    timeRange: null
  }
}

actions: {
  handleNervEvent(envelope),  // Socket.io event
  getCorrelationChain(correlationId)
}
4. BACKEND: NOVAS APIS E SERVIÇOS
4.1 APIs REST (Novas)
Workflows:


GET    /api/workflows           # List all
POST   /api/workflows           # Create
GET    /api/workflows/:id       # Get details
PUT    /api/workflows/:id       # Update
DELETE /api/workflows/:id       # Delete
POST   /api/workflows/:id/validate     # Validate DAG
POST   /api/workflows/:id/execute      # Execute workflow
Templates:


GET    /api/templates           # List all
POST   /api/templates           # Create
GET    /api/templates/:id       # Get template
PUT    /api/templates/:id       # Update
DELETE /api/templates/:id       # Delete
POST   /api/templates/:id/instantiate  # Create task from template
Telemetria:


GET    /api/telemetry/metrics          # Current snapshot
GET    /api/telemetry/history          # Time-series data
      ?metric=cpu&from=<ts>&to=<ts>
GET    /api/telemetry/stats            # Aggregated stats
Health:


GET    /api/health/aggregate    # All components health
GET    /api/health/alerts       # Active alerts
Tasks (Estender Existente):


GET    /api/tasks/:id/dependencies     # NOVO: Get dependency graph
GET    /api/tasks/:id/history          # NOVO: Execution history (NERV events)
POST   /api/tasks?template_id=<id>     # NOVO: Create from template
4.2 WebSocket Events (Socket.io)
Novos Eventos Server → Client:


'task:updates_batch'            // Batch task updates (50ms debounce - JÁ IMPLEMENTADO)
'telemetry:metrics'             // Metrics snapshot (1Hz)
'nerv:event'                    // Individual NERV event
'health:kernel'                 // Kernel health update
'health:driver'                 // Driver health update
'health:browser_pool'           // Browser pool health
'health:nerv'                   // NERV bus health
'health:queue'                  // Queue health
'alert:triggered'               # System alert
Eventos Legados (Manter):


'update'                        // DEPRECADO (usar task:updates_batch)
'status_change'                 // DEPRECADO (usar health:*)
'log_update'                    // MANTER (terminal logs)
'maestro:telemetry'             // MANTER (IPC 2.0)
'hub:agent_online'              // MANTER
'hub:agent_offline'             // MANTER
4.3 Serviços Backend Críticos
src/server/dashboard-api/telemetry_aggregator.js (NOVO)
Responsabilidades:

Coletar métricas de múltiplas fontes (NERV, Kernel, Hardware, Queue)
Armazenar em ring buffers (3600 pontos = 1 hora @ 1Hz)
Streamar via Socket.io (1Hz) para dashboards
Calcular estatísticas agregadas (avg, p95, p99)
Fontes de Dados:

nerv.telemetry.stats() - NERV IPC telemetry
hardware.getHeapStats() - Memory stats
hardware.getCPUUsage() - CPU usage
queueCache.getCacheMetrics() - Queue metrics
Event loop lag measurement (custom)
Estrutura de Dados:


{
  timestamp: Date.now(),
  cpu: { current, avg, max },
  memory: { used, total, percent },
  nerv: { latency, throughput, eventCount },
  eventLoopLag: number,
  queue: { size, hitRate, corrupt }
}
src/infra/queue/task_sync_bridge.js (NOVO)
Responsabilidades:

Unificar visão de tarefas: Disk Queue + Kernel Runtime
Escutar eventos NERV para atualizações de estado do Kernel
Merge disk state + kernel state → unified task view
Notificar dashboards via Socket.io
Mapeamento de Eventos NERV:


ActionCode.TASK_STARTED   → status: 'RUNNING', startedAt
ActionCode.TASK_COMPLETED → status: 'DONE', completedAt, result
ActionCode.TASK_FAILED    → status: 'FAILED', failedAt, error
ActionCode.TASK_PROGRESS  → progress, currentStep
API Pública:


getUnifiedTasks()           // Disk tasks + kernel state
getUnifiedTask(taskId)      // Single task merged
_setupNervListeners()       // Subscribe to NERV events
_notifyDashboards(taskId)   // Broadcast via Socket.io
src/server/dashboard-api/workflow_engine.js (NOVO)
Responsabilidades:

Validar DAG (Directed Acyclic Graph)
Detectar ciclos usando graphlib
Validar dependências (todas as tasks existem?)
Executar workflow (criar tarefas em ordem topológica)
Validações:

Estrutura: nodes válidos, edges válidos
Ciclos: usar graphlib.alg.isAcyclic()
Dependências: verificar se parent tasks existem
Órfãos: detectar nodes sem conexões
src/server/dashboard-api/template_manager.js (NOVO)
Responsabilidades:

CRUD de templates de tarefas
Storage em disco (templates/ directory)
Instantiate: criar task a partir de template
Validação: verificar schema do template
5. INTEGRAÇÃO QUEUE ↔ KERNEL
Problema Atual
Queue (Disk-based): src/infra/queue/ - Persistência em JSON
Kernel (In-memory): src/kernel/ - Task runtime lógico
Gap: Sistemas desacoplados, sem sincronização bidirecional
Solução: Task Sync Bridge
Fluxo de Dados:


Dashboard → GET /api/tasks
    ↓
TaskSyncBridge.getUnifiedTasks()
    ↓
1. queueCache.getQueue() → Disk tasks
2. kernelStateCache.get(taskId) → Kernel state
3. Merge: { ...diskTask, state: kernelState }
    ↓
Return unified view to dashboard
Real-time Updates:


NERV Event: TASK_STARTED
    ↓
TaskSyncBridge._setupNervListeners()
    ↓
Update kernelStateCache (status: 'RUNNING')
    ↓
_notifyDashboards(taskId)
    ↓
Socket.io: broadcastTaskUpdate()
    ↓
Dashboard: taskStore.handleTaskUpdate()
Integração com APIs Existentes:

src/server/api/controllers/tasks.js (ESTENDER):
Trocar io.getQueue() por taskSyncBridge.getUnifiedTasks()
Trocar io.loadTask(id) por taskSyncBridge.getUnifiedTask(id)
6. TELEMETRIA E ALERTAS
6.1 Sistema de Alertas
Alert Manager (src/server/dashboard-api/alert_manager.js):

Monitorar métricas contra thresholds
Trigger alertas: warning, critical
Broadcast via Socket.io: alert:triggered
Tracking de alertas ativos
Acknowledge alerts
Thresholds:


cpu: { warning: 70%, critical: 90% }
memory: { warning: 80%, critical: 95% }
nervLatency: { warning: 10ms, critical: 50ms }
eventLoopLag: { warning: 10ms, critical: 100ms }
queueSize: { warning: 100, critical: 500 }
6.2 Métricas Coletadas
Hardware:

CPU usage (%)
Memory used/total/percent
Disk usage (implementar se necessário)
NERV:

Latency (tempo entre emit e ACK)
Throughput (events/second)
Event count total
Buffer sizes (inbound/outbound)
Kernel:

Task counts (PENDING, RUNNING, DONE, FAILED)
Observation count
Policy alerts
Loop frequency (Hz)
Queue:

Queue size
Cache hit rate
Corrupt tasks count
Last scan timestamp
7. MIGRAÇÃO GRADUAL (5 SEMANAS)
Fase 1: Infraestrutura (Semana 1)
Objetivos:

Criar diretório src/dashboard-ui/
Configurar Vite + Vue.js 3
Instalar dependências (Pinia, Router, Socket.io, Chart.js, Cytoscape)
Criar layout básico (AppLayout, Header, Sidebar)
Configurar Vue Router com todas as rotas
Entregáveis:

src/dashboard-ui/vite.config.js
src/dashboard-ui/src/main.js
src/dashboard-ui/src/App.vue
src/dashboard-ui/src/router/index.js
Componentes de layout básicos
Servidor:

Atualizar src/server/engine/app.js para servir Vue app em /dashboard
Manter dashboard legado funcionando em /
Fase 2: Backend APIs (Semana 2)
Objetivos:

Implementar task_sync_bridge.js
Implementar telemetry_aggregator.js
Estender src/server/api/controllers/tasks.js
Criar novos controllers: workflows, templates, telemetry, health
Adicionar novos eventos Socket.io
Entregáveis:

src/infra/queue/task_sync_bridge.js
src/server/dashboard-api/telemetry_aggregator.js
src/server/dashboard-api/alert_manager.js
src/server/api/controllers/workflows.js
src/server/api/controllers/templates.js
Novos eventos Socket.io configurados
Testes:

Verificar unified tasks via /api/tasks
Verificar telemetry streaming via Socket.io
Testar alertas
Fase 3: Frontend Core (Semana 3)
Objetivos:

Implementar Pinia stores (tasks, telemetry, system)
Criar composables (useSocket, useRealtime, useTaskAPI)
Implementar Task Queue view (lista, filtros, cards)
Implementar Dashboard principal (métricas, health cards)
Conectar Socket.io client
Entregáveis:

stores/tasks.js, stores/telemetry.js, stores/system.js
composables/useSocket.js, composables/useRealtime.js
views/Dashboard.vue
views/TaskQueue.vue
components/task/TaskCard.vue, components/task/TaskList.vue
Real-time updates funcionando
Testes:

Dashboard carrega e exibe dados
Lista de tarefas renderiza corretamente
Real-time updates aparecem na UI
Filtros funcionam
Fase 4: Visualizações Avançadas (Semana 4)
Objetivos:

Implementar Performance Metrics view (Chart.js)
Implementar Workflow Editor (Cytoscape.js DAG)
Implementar Event Correlation view (Vis-Timeline)
Implementar System Health view (health cards)
Implementar Templates view
Entregáveis:

views/PerformanceMetrics.vue com charts funcionais
views/WorkflowEditor.vue com DAG editor
views/EventCorrelation.vue com timeline
views/SystemHealth.vue com health cards
views/Templates.vue com CRUD
Testes:

Charts atualizam em tempo real (1Hz)
DAG editor valida dependências
Timeline mostra eventos NERV
Health cards refletem status real
Fase 5: Refinamento e Migração (Semana 5)
Objetivos:

Polimento de UI/UX
Performance optimization (lazy loading, virtual scrolling)
Testes E2E (Playwright)
Documentação de usuário
Trocar dashboard padrão (/ → /dashboard)
Adicionar banner de deprecação no dashboard legado
Entregáveis:

UI polida e responsiva
Lazy loading de componentes pesados
Virtual scrolling na task list (1000+ tasks)
Testes E2E passando
Documentação completa
Dashboard novo como padrão
Rollout:

Semana 5.1: /dashboard vira rota padrão
Semana 5.2: Dashboard legado em /legacy com banner
v2.1 (futuro): Remover completamente dashboard legado
8. ARQUIVOS CRÍTICOS PARA IMPLEMENTAÇÃO
Prioridade CRÍTICA (Implementar Primeiro)
src/infra/queue/task_sync_bridge.js (NOVO)

Bridge entre Queue (disk) e Kernel (in-memory)
Merge de estados para unified view
Listeners de NERV events
Notificação de dashboards
src/server/dashboard-api/telemetry_aggregator.js (NOVO)

Agregação de métricas de todas as fontes
Ring buffers para time-series (1 hora @ 1Hz)
Streaming via Socket.io
Cálculo de estatísticas (avg, p95, p99)
src/dashboard-ui/src/stores/tasks.js (NOVO)

Pinia store para gerenciamento de tarefas
State: tasks[], filters, selectedTaskId
Actions: CRUD + handleTaskUpdate
Getters: filteredTasks, runningTasks, etc.
src/dashboard-ui/src/composables/useSocket.js (NOVO)

Socket.io client wrapper
Connection management
Event subscriptions
Reconnection logic
src/server/api/controllers/tasks.js (ESTENDER)

Trocar io.getQueue() → taskSyncBridge.getUnifiedTasks()
Adicionar novos endpoints: dependencies, history
Suportar template_id em POST
Prioridade ALTA (Implementar em Seguida)
src/dashboard-ui/src/views/Dashboard.vue (NOVO)

Dashboard principal overview
Métricas em cards (CPU, RAM, NERV)
Health indicators por componente
Task summary (counts por status)
src/dashboard-ui/src/views/TaskQueue.vue (NOVO)

Lista de tarefas com filtros
TaskCard components
Bulk operations
Real-time updates
src/server/engine/socket.js (ESTENDER)

Adicionar novos eventos: telemetry:metrics, health:*, alert:triggered
Manter eventos legados
Documentar protocol
src/dashboard-ui/src/stores/telemetry.js (NOVO)

Ring buffers para métricas (cpuHistory, memoryHistory, etc.)
Current snapshot
Aggregated stats
handleTelemetryUpdate action
src/server/dashboard-api/alert_manager.js (NOVO)

Monitor thresholds
Trigger alerts (warning, critical)
Broadcast via Socket.io
Alert acknowledgment
Prioridade MÉDIA (Visualizações Avançadas)
src/dashboard-ui/src/views/PerformanceMetrics.vue (NOVO)

LineChart para CPU, memory, latency (Chart.js)
GaugeChart para event loop lag
Metrics table com stats detalhadas
src/dashboard-ui/src/views/WorkflowEditor.vue (NOVO)

DAGCanvas component (Cytoscape.js)
Node editor (modal)
Toolbar (add, validate, save)
Dependency graph minimap
src/dashboard-ui/src/views/EventCorrelation.vue (NOVO)

EventTimeline (Vis-Timeline)
GanttChart de task execution
CorrelationViewer (tree view)
Event filters
src/server/api/controllers/workflows.js (NOVO)

CRUD para workflows
Validate endpoint (DAG validation)
Execute endpoint (topology sort + create tasks)
src/server/api/controllers/templates.js (NOVO)

CRUD para templates
Instantiate endpoint (create task from template)
Validation
9. PADRÕES DE COMUNICAÇÃO REAL-TIME
Frontend → Backend (User Action)

1. User cria task (TaskForm.vue)
   ↓
2. taskStore.createTask(payload)
   ↓
3. POST /api/tasks (Axios)
   ↓
4. Server: tasks.js controller
   ↓
5. taskSyncBridge → io.saveTask() → disk
   ↓
6. fs_watcher detecta novo arquivo
   ↓
7. queueCache.markDirty()
   ↓
8. Socket.io: broadcastTaskUpdate()
   ↓
9. Dashboard: taskStore.handleTaskUpdate()
   ↓
10. Vue reactivity → UI updates
Backend → Frontend (Telemetry Streaming)

1. TelemetryAggregator loop (1Hz)
   ↓
2. Coleta métricas:
   - NERV: nerv.telemetry.stats()
   - Hardware: hardware.getHeapStats(), getCPUUsage()
   - Queue: queueCache.getCacheMetrics()
   - Event loop: medição customizada
   ↓
3. Armazena em ring buffers (last 3600 points)
   ↓
4. Calcula stats (avg, max)
   ↓
5. Socket.io: emit('telemetry:metrics', data)
   ↓
6. Dashboard: useRealtime composable recebe
   ↓
7. telemetryStore.handleTelemetryUpdate(data)
   ↓
8. Adiciona a cpuHistory[], memoryHistory[], etc.
   ↓
9. Chart.js re-renders com novos pontos
NERV → Dashboard (Event Flow)

1. Kernel emite NERV event: TASK_STARTED
   ↓
2. NERV broadcasts to all listeners
   ↓
3. TaskSyncBridge._setupNervListeners() recebe
   ↓
4. Atualiza kernelStateCache (status: 'RUNNING')
   ↓
5. taskSyncBridge._notifyDashboards(taskId)
   ↓
6. Socket.io: broadcastTaskUpdate() (50ms debounce)
   ↓
7. Dashboard: socket.on('task:updates_batch')
   ↓
8. taskStore.handleTaskUpdate() → merge state
   ↓
9. TaskCard.vue re-renders (status badge updates)
10. VERIFICAÇÃO E TESTES
Testes End-to-End (Playwright)
Cenário 1: Criar e Executar Tarefa


1. Abrir dashboard (/dashboard)
2. Navegar para /tasks
3. Clicar "Create Task"
4. Preencher form (target, model, prompts)
5. Submit
6. Verificar task aparece na lista (status: PENDING)
7. Aguardar kernel pegar task
8. Verificar status muda para RUNNING
9. Aguardar execução completar
10. Verificar status muda para DONE
11. Clicar "View Result"
12. Verificar conteúdo do resultado
Cenário 2: Visualizar Métricas Real-time


1. Abrir /metrics
2. Verificar charts renderizam (CPU, memory, latency)
3. Aguardar 5 segundos
4. Verificar charts atualizam (novos data points)
5. Verificar animações são suaves (no jank)
6. Verificar gauges atualizam
Cenário 3: Criar Workflow com DAG


1. Abrir /workflows
2. Clicar "Create Workflow"
3. Adicionar 3 nodes (tasks A, B, C)
4. Conectar edges: A → B, A → C
5. Clicar "Validate"
6. Verificar validação passa (sem ciclos)
7. Salvar workflow
8. Verificar aparece na lista
9. Executar workflow
10. Verificar tasks criadas na ordem correta
Cenário 4: Filtros e Busca


1. Abrir /tasks com 100+ tarefas
2. Aplicar filtro: status = RUNNING
3. Verificar apenas tasks RUNNING exibidas
4. Aplicar filtro adicional: priority > 50
5. Verificar lista atualiza corretamente
6. Limpar filtros
7. Verificar todas tasks retornam
Cenário 5: Bulk Operations


1. Abrir /tasks
2. Criar 5 tasks com payload errado (falharão)
3. Aguardar todas falharem (status: FAILED)
4. Clicar "Retry All Failed"
5. Verificar modal de confirmação
6. Confirmar
7. Verificar todas 5 tasks voltam para PENDING
8. Verificar re-execução
Testes de Performance
Teste 1: Large Task List


Objetivo: Verificar performance com 1000+ tasks
Método:
1. Popular queue com 1000 tasks (script)
2. Abrir /tasks
3. Medir Time to Interactive (TTI)
Target: < 2s
4. Scroll pela lista
5. Verificar smooth scrolling (60fps)
6. Aplicar filtros
7. Medir tempo de resposta
Target: < 100ms
Teste 2: Real-time Update Storm


Objetivo: Verificar dashboard sob alta carga de updates
Método:
1. Criar 50 tasks simultâneas
2. Aguardar todas executarem (paralelo)
3. Observar dashboard durante execução
4. Medir:
   - CPU usage do browser
   - Memory usage
   - Frame rate (fps)
   - Socket.io latency
Target:
- CPU < 50%
- Memory growth < 100MB
- FPS > 30
- Latency < 100ms
Teste 3: Chart Rendering


Objetivo: Verificar performance de charts
Método:
1. Abrir /metrics
2. Deixar rodando por 1 hora (3600 data points)
3. Verificar:
   - Charts atualizam sem lag
   - Memory não vaza (stable growth)
   - Animations são suaves
4. Zoom in/out nos charts
5. Verificar responsiveness
Testes de Integração
Teste 1: Queue ↔ Kernel Sync


Objetivo: Verificar sincronização disk ↔ memory
Método:
1. Criar task via API: POST /api/tasks
2. Verificar arquivo criado: fila/<id>.json
3. Verificar cache invalida: queueCache.markDirty()
4. Verificar kernel detecta task
5. Kernel emite TASK_STARTED via NERV
6. Verificar taskSyncBridge recebe evento
7. Verificar kernelStateCache atualiza
8. Verificar dashboard recebe update via Socket.io
9. Comparar estado: disk vs cache vs kernel vs dashboard
Expectativa: Todos consistentes
Teste 2: NERV Event Flow


Objetivo: Verificar propagação de eventos
Método:
1. Instrumentar NERV com logging
2. Executar task
3. Rastrear todos eventos:
   - TASK_STARTED (Kernel → NERV)
   - DRIVER_EXECUTE_TASK (NERV → Driver)
   - DRIVER_TASK_STARTED (Driver → NERV)
   - TASK_PROGRESS (Driver → NERV, periódico)
   - DRIVER_TASK_COMPLETED (Driver → NERV)
   - TASK_COMPLETED (NERV → Kernel)
4. Verificar todos eventos têm correlation_id correto
5. Verificar timeline faz sentido (ordem, timestamps)
6. Verificar dashboard exibe todos eventos
Teste 3: Telemetry Aggregation


Objetivo: Verificar coleta e agregação de métricas
Método:
1. Iniciar telemetryAggregator
2. Verificar coleta a 1Hz
3. Gerar carga (executar tasks)
4. Verificar métricas refletem carga:
   - CPU aumenta
   - Memory aumenta
   - NERV throughput aumenta
5. Parar carga
6. Verificar métricas normalizam
7. Verificar ring buffers não vazam memory
8. Verificar stats agregadas corretas (avg, max)
11. PERFORMANCE TARGETS
Métrica	Target	Medição
Initial Load (Dashboard)	< 2s	Time to Interactive (Lighthouse)
Task List Render (1000 tasks)	< 100ms	React DevTools Profiler
Real-time Update Latency	< 50ms	Socket.io emit → UI update
Chart Update (1Hz)	Smooth	60fps, no jank (Performance API)
Memory Footprint	< 100MB	Chrome DevTools Memory
Bundle Size (Gzipped)	< 500KB	webpack-bundle-analyzer
API Response Time	< 100ms	GET /api/tasks (p95)
Socket.io Connection	< 200ms	Initial handshake
12. SEGURANÇA
Autenticação e Autorização
Dashboard Password (opcional):

Variável de ambiente: DASHBOARD_PASSWORD
Socket.io: verificar em handshake auth.password
Já implementado em src/server/engine/socket.js:90-102
CORS:

Configurar origins permitidas em produção
socket.js:71-74 - atualmente origin: '*' (dev only)
Mudar para whitelist em prod
Input Validation:

Frontend: Zod schemas
Backend: Zod schemas (já implementado em task_schema.js)
Sanitização de IDs: safeId.replace(/[^a-zA-Z0-9._-]/g, '')
XSS Protection:

Vue.js auto-escapa content (v-html evitado)
Content-Security-Policy header (adicionar)
CSRF Protection:

Socket.io usa session tokens únicos
REST APIs: adicionar CSRF token se necessário
Rate Limiting:

Já implementado: apiLimiter em router.js
Atual: 100 req/min por IP
Manter ou ajustar conforme necessário
13. OBSERVABILIDADE E DEBUGGING
Ferramentas de Debug
Vue DevTools (Browser Extension):

Inspecionar components tree
Ver props, data, computed
Time-travel debugging
Pinia DevTools (integrado):

Ver state de todas stores
Inspecionar mutations/actions
Time-travel para estados anteriores
Network Inspector:

Monitor Socket.io events (WS tab)
Ver REST API calls
Inspecionar payloads
NERV Correlation IDs:

Todo evento tem correlation_id
Rastrear flow completo: Kernel → Driver → Results
Usar EventCorrelation view
Error Boundaries (Vue):

app.config.errorHandler
Capturar erros de components
Log para telemetria
Logging:

Frontend: console.log (filtrar por nível em prod)
Backend: logger.log(level, message, context)
Structured logging (JSON)
14. CHECKLIST DE IMPLEMENTAÇÃO
Fase 1: Infraestrutura (Semana 1)
 Criar src/dashboard-ui/ directory
 npm init e instalar dependências (Vue, Vite, Pinia, Router, Socket.io, Chart.js, Cytoscape)
 Configurar vite.config.js (proxy para API backend)
 Criar main.js, App.vue, router/index.js
 Criar componentes de layout: AppLayout, Header, Sidebar
 Configurar rotas: Dashboard, TaskQueue, TaskDetail, WorkflowEditor, PerformanceMetrics, EventCorrelation, SystemHealth, Templates
 Atualizar src/server/engine/app.js para servir Vue app em /dashboard
 Testar: Dashboard vazio carrega em /dashboard
Fase 2: Backend APIs (Semana 2)
 Implementar src/infra/queue/task_sync_bridge.js
 Constructor + kernelStateCache Map
 getUnifiedTasks(), getUnifiedTask(id)
 _setupNervListeners() (TASK_STARTED, TASK_COMPLETED, TASK_FAILED, TASK_PROGRESS)
 _notifyDashboards(taskId)
 Implementar src/server/dashboard-api/telemetry_aggregator.js
 Ring buffers (cpuHistory, memoryHistory, nervLatency, throughput, eventLoopLag)
 _collectMetrics() (NERV, hardware, queue, event loop lag)
 _startCollectionLoop() (1Hz)
 _broadcastMetrics(metrics) via Socket.io
 getHistory(metric, from, to), getCurrent()
 Implementar src/server/dashboard-api/alert_manager.js
 Thresholds config (cpu, memory, nervLatency, eventLoopLag, queueSize)
 _startMonitoring() (check every 5s)
 _checkThresholds(metrics)
 _triggerAlert(level, component, message)
 getActiveAlerts(), acknowledgeAlert(alertId)
 Estender src/server/api/controllers/tasks.js
 GET / → usar taskSyncBridge.getUnifiedTasks()
 GET /:id → usar taskSyncBridge.getUnifiedTask(id)
 POST /?template_id → suporte a templates
 GET /:id/dependencies → retornar dependency graph
 GET /:id/history → retornar NERV events por correlation_id
 Criar src/server/api/controllers/workflows.js
 GET / (list), POST / (create), GET /:id, PUT /:id, DELETE /:id
 POST /:id/validate (DAG validation)
 POST /:id/execute (topology sort + create tasks)
 Criar src/server/api/controllers/templates.js
 GET / (list), POST / (create), GET /:id, PUT /:id, DELETE /:id
 POST /:id/instantiate (create task from template)
 Criar src/server/api/controllers/telemetry.js
 GET /metrics (current snapshot)
 GET /history?metric=cpu&from=&to= (time-series)
 GET /stats (aggregated stats)
 Criar src/server/api/controllers/health.js
 GET /aggregate (all components health)
 GET /alerts (active alerts)
 Estender src/server/engine/socket.js
 Adicionar novos eventos: telemetry:metrics, health:kernel, health:driver, health:browser_pool, health:nerv, health:queue, alert:triggered
 Manter broadcastTaskUpdate() (já existe com 50ms debounce)
 Testar: APIs retornam dados corretos, Socket.io emite eventos
Fase 3: Frontend Core (Semana 3)
 Implementar stores/tasks.js (Pinia)
 State: tasks[], filters, selectedTaskId, loading, error
 Getters: filteredTasks, runningTasks, pendingTasks, taskById
 Actions: fetchTasks, createTask, updateTask, deleteTask, retryTask, handleTaskUpdate
 Implementar stores/telemetry.js (Pinia)
 State: ring buffers (cpuHistory, memoryHistory, etc.), current, stats
 Actions: fetchMetrics, addDataPoint, handleTelemetryUpdate
 Implementar stores/system.js (Pinia)
 State: components (kernel, driver, browserPool, nerv, queue), alerts
 Actions: fetchHealth, handleHealthUpdate
 Implementar stores/workflow.js (Pinia)
 State: workflows, currentWorkflow, templates
 Actions: fetchWorkflows, saveWorkflow, validateDAG
 Implementar stores/nerv.js (Pinia)
 State: events (ring buffer), correlationMap, filters
 Actions: handleNervEvent, getCorrelationChain
 Implementar composables/useSocket.js
 Socket.io client connection
 Event subscriptions: task:updates_batch, telemetry:metrics, health:*, alert:triggered, nerv:event
 Connection management (connect, disconnect, reconnect)
 Return { socket, isConnected, subscribe, unsubscribe }
 Implementar composables/useRealtime.js
 Usar useSocket()
 Subscribe aos eventos relevantes
 Dispatch para stores apropriadas
 Implementar composables/useTaskAPI.js
 Wrapper para axios calls (GET /api/tasks, POST, PUT, DELETE)
 Error handling
 Loading states
 Implementar views/Dashboard.vue
 MetricsGrid (GaugeChart para CPU, RAM, NERV latency, throughput)
 TaskSummary (counts por status)
 HealthCard[] (Kernel, Driver, Browser Pool, NERV, Queue)
 Implementar views/TaskQueue.vue
 TaskFilters (status, priority, date range)
 TaskList → TaskCard[] (v-for)
 BulkActions (retry all, delete all)
 Implementar components/task/TaskCard.vue
 Display: ID, status badge, user message, model, schedule, priority
 Actions: Edit, Delete, Retry, View Result
 Status colors: PENDING (gray), RUNNING (yellow), DONE (green), FAILED (red)
 Implementar components/task/TaskList.vue
 Renderizar TaskCard[] com v-for
 Virtual scrolling se > 100 tasks (vue-virtual-scroller)
 Testar: Dashboard carrega, task list renderiza, real-time updates funcionam, filtros aplicam
Fase 4: Visualizações Avançadas (Semana 4)
 Implementar views/PerformanceMetrics.vue
 LineChart (CPU history) - Chart.js
 LineChart (Memory history) - Chart.js
 LineChart (NERV latency) - Chart.js
 BarChart (Event throughput) - Chart.js
 GaugeChart (Event loop lag) - Chart.js
 MetricsTable (detailed stats)
 Implementar components/charts/LineChart.vue
 Wrapper para Chart.js Line
 Props: data, labels, options
 Real-time updates (watch data)
 Implementar components/charts/GaugeChart.vue
 Wrapper para Chart.js Doughnut (gauge style)
 Props: value, max, thresholds (warning, critical)
 Implementar views/WorkflowEditor.vue
 DAGCanvas (Cytoscape.js wrapper)
 WorkflowToolbar (add node, validate, save)
 NodeEditor modal (edit node properties)
 DependencyGraph minimap
 Implementar components/workflow/DAGCanvas.vue
 Cytoscape.js initialization
 Render nodes + edges
 Interactive: add node, add edge, delete, drag
 Layout: dagre (hierarchical)
 Implementar views/EventCorrelation.vue
 EventTimeline (Vis-Timeline wrapper)
 GanttChart (task execution timeline)
 CorrelationViewer (tree view)
 EventFilters (actor, actionCode, time range)
 Implementar components/telemetry/EventTimeline.vue
 Wrapper para Vis-Timeline
 Render NERV events com timestamps
 Group por correlation_id ou actor
 Implementar views/SystemHealth.vue
 HealthCard[] (per component: Kernel, Driver, Browser Pool, NERV, Queue)
 AlertPanel (active alerts)
 StatusIndicator (LED-style)
 Implementar components/health/HealthCard.vue
 Display: component name, status, uptime, errors
 StatusIndicator (green/yellow/red LED)
 Metrics (specific per component)
 Implementar views/Templates.vue
 TemplateGrid → TemplateCard[] (v-for)
 TemplateForm (create/edit modal)
 TemplatePreview
 Testar: Todas visualizações renderizam, charts atualizam real-time, DAG editor valida, timeline mostra eventos
Fase 5: Refinamento e Migração (Semana 5)
 UI/UX Polimento
 Ajustar cores, espaçamentos, typography
 Adicionar loading states em todos lugares
 Adicionar error states com mensagens claras
 Toast notifications para ações (create, update, delete)
 Confirmação para ações destrutivas (delete, bulk delete)
 Performance Optimization
 Lazy loading: import() dinâmico para views pesadas
 Virtual scrolling na TaskList (vue-virtual-scroller)
 Debounce em filtros (lodash.debounce)
 Memoização de getters caros (computed)
 Code splitting por rota (Vite faz automaticamente)
 Testes E2E (Playwright)
 Criar test suite: tests/e2e/dashboard.spec.js
 Cenário 1: Criar e executar tarefa
 Cenário 2: Visualizar métricas real-time
 Cenário 3: Criar workflow com DAG
 Cenário 4: Filtros e busca
 Cenário 5: Bulk operations
 Documentação
 User guide: DOCUMENTAÇÃO/DASHBOARD_USER_GUIDE.md
 Developer guide: DOCUMENTAÇÃO/DASHBOARD_DEV_GUIDE.md
 API reference: DOCUMENTAÇÃO/DASHBOARD_API.md
 Atualizar README.md com link para dashboard
 Migração
 Trocar rota padrão: / → redirect para /dashboard
 Mover dashboard legado para /legacy
 Adicionar banner de deprecação em /legacy
 Atualizar scripts npm (npm start deve buildar dashboard novo)
 Rollout
 Deploy em staging
 Testar por 1 semana
 Coletar feedback
 Fix bugs críticos
 Deploy em produção
 Anunciar novo dashboard
15. CRITÉRIOS DE SUCESSO
Funcionalidade
✅ Dashboard carrega e exibe dados em < 2s
✅ Real-time updates funcionam sem lag perceptível
✅ CRUD de tarefas funciona 100% via UI
✅ Telemetria é exibida em tempo real (1Hz)
✅ Filtros e buscas retornam resultados corretos
✅ DAG editor valida e cria workflows
✅ Bulk operations funcionam
✅ Templates podem ser criados e usados
Performance
✅ Dashboard suporta 1000+ tarefas sem degradação
✅ Real-time updates não causam memory leaks
✅ Charts renderizam a 60fps
✅ Bundle size < 500KB gzipped
✅ API response time < 100ms (p95)
Integração
✅ Queue ↔ Kernel sincronizam corretamente
✅ NERV events chegam ao dashboard
✅ Comandos do dashboard executam no kernel/driver
✅ Telemetria agregada reflete estado real
Qualidade
✅ Todos testes E2E passam
✅ Nenhum erro no console em uso normal
✅ Código segue padrões (ESLint passa)
✅ Documentação completa
16. RISCOS E MITIGAÇÕES
Risco	Probabilidade	Impacto	Mitigação
Memory leaks em real-time updates	Média	Alto	- Ring buffers com limite fixo<br>- Unsubscribe de listeners ao desmontar componentes<br>- Testes de longa duração
Performance com 1000+ tasks	Alta	Médio	- Virtual scrolling<br>- Lazy loading<br>- Pagination (opcional)
Complexidade de Cytoscape.js	Média	Médio	- Usar exemplos da documentação<br>- Limitar features iniciais<br>- Adicionar incrementalmente
Sincronização Queue ↔ Kernel	Baixa	Alto	- Testes de integração rigorosos<br>- Logging detalhado<br>- Rollback plan
Compatibilidade com dashboard legado	Baixa	Baixo	- Migração gradual (parallel deployment)<br>- Manter legado por 1-2 versões
Browser compatibility	Baixa	Baixo	- Testar em Chrome, Firefox, Safari<br>- Polyfills via Vite se necessário
17. PRÓXIMOS PASSOS IMEDIATOS
Semana 1 - Dia 1
Criar branch: git checkout -b feature/enterprise-dashboard
Criar diretório: mkdir -p src/dashboard-ui/src
Inicializar projeto Vue: cd src/dashboard-ui && npm create vite@latest . -- --template vue
Instalar dependências: npm install vue-router pinia socket.io-client axios chart.js vue-chartjs cytoscape vis-timeline d3 element-plus
Configurar Vite: editar vite.config.js (proxy para http://localhost:3008)
Criar estrutura de diretórios: stores/, composables/, views/, components/, services/
Commit: git commit -m "feat: initialize Vue.js 3 dashboard with Vite"
Semana 1 - Dia 2
Implementar src/main.js (Pinia + Router + App mount)
Implementar App.vue (root component)
Implementar router/index.js (todas as rotas)
Implementar components/layout/AppLayout.vue
Implementar components/layout/Header.vue
Implementar components/layout/Sidebar.vue
Testar: Dashboard vazio carrega em http://localhost:5173
Commit: git commit -m "feat: add layout components and routing"
Semana 1 - Dia 3-5
Configurar integração servidor → servir Vue app
Implementar build scripts no package.json raiz
Implementar views básicas (placeholders)
Implementar navegação entre views
Deploy de teste em staging
Commit: git commit -m "feat: complete dashboard infrastructure"
18. REFERÊNCIAS E RECURSOS
Documentação Oficial
Vue.js 3: https://vuejs.org/guide/
Vite: https://vite.dev/guide/
Pinia: https://pinia.vuejs.org/
Vue Router: https://router.vuejs.org/
Socket.io: https://socket.io/docs/v4/
Chart.js: https://www.chartjs.org/docs/latest/
Cytoscape.js: https://js.cytoscape.org/
Vis-Timeline: https://visjs.github.io/vis-timeline/docs/timeline/
Código Existente (Ler antes de implementar)
src/server/engine/socket.js - Socket.io Hub (IPC 2.0)
src/server/api/controllers/tasks.js - REST API de tarefas
src/infra/queue/cache.js - Queue cache system
src/kernel/kernel.js - Kernel factory e composição
src/nerv/nerv.js - NERV event bus
src/nerv/telemetry/ipc_telemetry.js - Telemetria
src/core/schemas/task_schema.js - Task schema V4
Padrões de Código
Indentação: 4 espaços
Line Length: 120 caracteres
Quotes: Single quotes
Semicolons: Obrigatórios
Naming: camelCase (variáveis), PascalCase (componentes)
Comments: JSDoc para APIs públicas
RESUMO EXECUTIVO
Este plano detalha a transformação completa do sistema chatgpt-docker-puppeteer em uma plataforma de orquestração autônoma de LLMs de nível enterprise, com dashboard profissional e capacidades de execução autônoma para tarefas complexas de longa duração (livros, programas, pesquisas).

Principais Entregas:

PARTE 1: Dashboard Enterprise (5 semanas)
Dashboard Moderno: Vue.js 3 com Composition API, Pinia state management, Vue Router
Visualizações Avançadas: DAG editor (Cytoscape.js), métricas real-time (Chart.js), event correlation (Vis-Timeline), health monitoring
Telemetria Vasta: 73+ eventos NERV, agregação de métricas, alertas configuráveis, streaming 1Hz via Socket.io
Gerenciamento Profundo de Tarefas: CRUD completo, templates, workflows, bulk operations, dependency management
Integração Queue ↔ Kernel: TaskSyncBridge para unificar visões disk-based + in-memory
PARTE 2: Sistema de Orquestração Autônoma (12 semanas)
Orchestrator Engine: Multi-step workflows, branching, looping, iterative execution
Validation Framework: LLM-as-judge, quality scoring, self-correction
Context Management: Intelligent chunking, context injection, long-term memory
Multi-Driver Architecture: ChatGPT, Gemini, Claude, local LLMs (Ollama), com fallback
Semantic Telemetry: Quality metrics, progress tracking, reasoning traces, cost tracking
Feedback Loops: LLM outputs feed back as inputs for refinement
Capacidades Autônomas
✅ Escrever livros completos: Multi-capítulos, auto-revisão, consistência narrativa
✅ Escrever programas complexos: Multi-file, testes automáticos, iteração até passar
✅ Projetos de pesquisa: Multi-source, síntese, relatórios com citações
✅ Supervisão mínima: Usuário define objetivo, sistema executa autonomamente
Duração Total: 17 semanas (Dashboard: 5 semanas + Orquestração: 12 semanas)

Arquitetura: Zero-coupling via NERV event bus (todos componentes se comunicam via NERV), modular (plug-and-play drivers/validators), observável (telemetria em cada decisão)

Performance Targets: < 2s load time, 1000+ tasks concorrentes, < 50ms real-time latency, 60fps charts, 100+ subtasks por workflow

Status: ✅ Pronto para implementação com arquitetura completa aprovada

PARTE 2: SISTEMA DE ORQUESTRAÇÃO AUTÔNOMA
19. VISÃO GERAL DA ORQUESTRAÇÃO
19.1 Objetivos da Orquestração
O sistema deve ser capaz de executar tarefas complexas de forma autônoma:

Exemplo 1: Escrever um Livro Técnico


Input do usuário:
- Tópico: "Advanced Rust Programming"
- Público-alvo: "Desenvolvedores experientes"
- Tamanho: "300 páginas, 15 capítulos"
- Estilo: "Técnico, com exemplos de código"

Execução autônoma:
1. Gerar outline (títulos de capítulos, tópicos)
2. Para cada capítulo (sequencial):
   a. Fase de pesquisa (query knowledge, code examples)
   b. Fase de escrita (gerar draft)
   c. Fase de revisão (LLM-as-judge avalia coerência, precisão)
   d. Fase de revisão (incorporar feedback, melhorar)
   e. Validação de código (se aplicável)
3. Checagem de consistência entre capítulos
4. Revisão final e compilação

Dashboard mostra:
- Progresso: 7/15 capítulos completados
- Quality scores por capítulo (0-100)
- Token usage, custo total ($)
- Tempo estimado para conclusão
- Botões: Pausar, Continuar, Revisar Capítulo X
Exemplo 2: Escrever Projeto de Software


Input do usuário:
- Projeto: "REST API para gerenciamento de tarefas"
- Tech stack: "Node.js, Express, PostgreSQL"
- Features: [autenticação, CRUD de tasks, filtros, export]

Execução autônoma:
1. Gerar estrutura do projeto
2. Para cada arquivo (paralelo com concurrency: 3):
   a. Gerar código
   b. Rodar linter (check syntax)
   c. Gerar testes
   d. Rodar testes
   e. Se testes falham: analisar erros → regenerar → retry
   f. Repetir até testes passarem (max 3 iterações)
3. Testes de integração
4. Geração de documentação

Dashboard mostra:
- Árvore de arquivos com status (✓ done, ⚠ in progress, ✗ failed)
- Resultados de testes em tempo real
- Métricas de qualidade de código (coverage, complexity)
- Retry count por arquivo
- Logs de erros e correções
Exemplo 3: Projeto de Pesquisa


Input do usuário:
- Tópico: "Impacto da IA na saúde"
- Fontes: [lista de URLs, papers, APIs]
- Output: "Relatório de 20 páginas com citações"

Execução autônoma:
1. Fetch e parse de fontes (paralelo)
2. Extrair informações relevantes por fonte
3. Sintetizar achados (identificar temas, padrões)
4. Gerar outline do relatório
5. Escrever seções com citações
6. Fact-check (cross-reference entre fontes)
7. Formatar e compilar

Dashboard mostra:
- Fontes processadas (12/20)
- Key findings extraídos (lista)
- Seções completadas (3/7)
- Contagem de citações (45)
- Confidence score por finding
19.2 Estratégias de Execução
SINGLE_SHOT (Execução única):

Tarefa simples, resposta direta
Ex: "Resuma este artigo"
Sem iteração, sem validação
ITERATIVE (Iteração até critério):

Executa → Valida → Se falha, refina → Repeat
Ex: "Escreva código que passe nestes testes"
Max 3-5 iterações
Validação: testes passam? quality_score > threshold?
MULTI_STEP (Workflow sequencial):

Lista de steps definidos pelo usuário ou sistema
Cada step pode ser SINGLE_SHOT ou ITERATIVE
Context acumula entre steps
Ex: Outline → Write Chapter 1 → Write Chapter 2 → ...
TREE_OF_THOUGHT (Exploração de múltiplas alternativas):

Gera N soluções alternativas
Avalia cada uma
Escolhe melhor ou combina
Ex: "Gere 3 abordagens para este problema, escolha a melhor"
CHAIN_OF_THOUGHT (Raciocínio passo-a-passo):

LLM explicita raciocínio antes de responder
Melhora qualidade para problemas complexos
Ex: "Resolva este problema matemático, mostrando cada passo"
20. TASK SCHEMA V5 (Estendido)
20.1 Estrutura Completa

// src/core/schemas/task_schema_v5.js

const TaskSchemaV5 = z.object({
  meta: z.object({
    id: z.string().uuid(),
    project_id: z.string().default('default'),
    parent_id: z.string().uuid().optional(),       // Hierarchical tasks
    workflow_id: z.string().uuid().optional(),     // Workflow grouping
    correlation_id: z.string().uuid().optional(),
    version: z.literal('5.0'),
    created_at: z.string().datetime(),
    priority: z.number().int().min(0).max(100).default(50),
    source: z.string().default('system'),
    tags: z.array(z.string()).default([])
  }),

  spec: z.object({
    target: z.enum(['chatgpt', 'gemini', 'claude', 'ollama', 'auto']),
    model: z.string().default('AUTO'),
    payload: z.object({
      system_message: z.string().optional(),
      user_message: z.string(),
      context: z.any().optional()              // Previous results, external data
    }),
    parameters: z.object({
      temperature: z.number().min(0).max(2).default(0.7),
      max_tokens: z.number().int().positive().optional(),
      top_p: z.number().min(0).max(1).optional(),
      frequency_penalty: z.number().min(-2).max(2).optional(),
      presence_penalty: z.number().min(-2).max(2).optional(),
      stop_sequences: z.array(z.string()).optional()
    }).optional(),

    // NOVO: Execution configuration
    execution: z.object({
      strategy: z.enum(['SINGLE_SHOT', 'ITERATIVE', 'MULTI_STEP', 'TREE_OF_THOUGHT', 'CHAIN_OF_THOUGHT']).default('SINGLE_SHOT'),

      // For ITERATIVE strategy
      iterative_config: z.object({
        max_iterations: z.number().int().positive().default(3),
        validation_criteria: z.object({
          validators: z.array(z.string()),      // ['regex', 'schema', 'llm_judge']
          min_quality_score: z.number().min(0).max(100).default(70),
          custom_validator: z.any().optional()
        }).optional(),
        convergence_detection: z.boolean().default(true)
      }).optional(),

      // For MULTI_STEP strategy
      workflow_config: z.object({
        steps: z.array(z.object({
          id: z.string(),
          name: z.string(),
          description: z.string().optional(),
          action: z.enum(['execute_prompt', 'validate', 'branch', 'loop', 'spawn_subtask']),
          config: z.any(),                     // Step-specific config
          dependencies: z.array(z.string()).default([]),  // Step IDs that must complete first
          on_failure: z.enum(['retry', 'skip', 'abort']).default('abort')
        })),
        max_subtasks: z.number().int().positive().default(50),
        subtask_concurrency: z.number().int().positive().default(3)
      }).optional(),

      // For TREE_OF_THOUGHT strategy
      tree_config: z.object({
        num_branches: z.number().int().min(2).max(10).default(3),
        evaluation_criteria: z.string(),
        selection_strategy: z.enum(['best', 'combine', 'vote']).default('best')
      }).optional()
    }).default({ strategy: 'SINGLE_SHOT' }),

    // NOVO: Validation rules
    validation: z.object({
      validators: z.array(z.object({
        type: z.enum(['regex', 'schema', 'length', 'format', 'llm_judge', 'custom']),
        config: z.any()
      })).default([]),
      on_validation_failure: z.enum(['retry', 'abort', 'manual_review']).default('retry')
    }).optional(),

    // NOVO: Context management
    context_config: z.object({
      inject_previous_results: z.boolean().default(false),
      context_window_strategy: z.enum(['full', 'chunked', 'summarized']).default('full'),
      max_context_tokens: z.number().int().positive().optional(),
      memory_keys: z.array(z.string()).default([])  // Keys to fetch from long-term memory
    }).optional(),

    // Existing fields (mantidos)
    config: z.object({
      reset_context: z.boolean().default(false),
      require_history: z.boolean().default(false),
      output_format: z.enum(['text', 'json', 'markdown']).default('text')
    }).default({})
  }),

  policy: z.object({
    max_attempts: z.number().int().positive().default(3),
    timeout_ms: z.number().int().positive().optional(),
    dependencies: z.array(z.string().uuid()).default([]),
    execute_after: z.string().datetime().nullable().default(null),
    priority_weight: z.number().default(1.0),

    // NOVO: Workflow policies
    workflow_policy: z.object({
      max_execution_time_ms: z.number().int().positive().optional(),
      budget_limit_usd: z.number().positive().optional(),
      quality_threshold: z.number().min(0).max(100).optional()
    }).optional()
  }),

  state: z.object({
    status: z.enum(['PENDING', 'RUNNING', 'DONE', 'FAILED', 'SKIPPED', 'PAUSED']),
    progress_estimate: z.number().min(0).max(100).default(0),
    worker_id: z.string().optional(),
    attempts: z.number().int().nonnegative().default(0),
    started_at: z.string().datetime().nullable().default(null),
    completed_at: z.string().datetime().nullable().default(null),
    paused_at: z.string().datetime().nullable().optional(),
    last_error: z.string().optional(),

    // NOVO: Workflow state
    workflow_state: z.object({
      current_step_index: z.number().int().nonnegative().default(0),
      completed_steps: z.array(z.string()).default([]),
      failed_steps: z.array(z.string()).default([]),
      accumulated_context: z.any().optional()     // Results from previous steps
    }).optional(),

    // NOVO: Iteration state
    iteration_state: z.object({
      current_iteration: z.number().int().nonnegative().default(0),
      iterations_history: z.array(z.object({
        iteration: z.number(),
        output: z.string(),
        quality_score: z.number().optional(),
        validation_result: z.any().optional()
      })).default([])
    }).optional(),

    // NOVO: Quality metrics
    quality_metrics: z.object({
      overall_score: z.number().min(0).max(100).optional(),
      coherence_score: z.number().min(0).max(100).optional(),
      accuracy_score: z.number().min(0).max(100).optional(),
      goal_alignment_score: z.number().min(0).max(100).optional(),
      validation_passed: z.boolean().optional()
    }).optional(),

    // NOVO: Cost tracking
    cost_tracking: z.object({
      input_tokens: z.number().int().nonnegative().default(0),
      output_tokens: z.number().int().nonnegative().default(0),
      total_tokens: z.number().int().nonnegative().default(0),
      cost_usd: z.number().nonnegative().default(0),
      model_used: z.string().optional()
    }).optional(),

    metrics: z.object({
      duration_ms: z.number().int().nonnegative().optional(),
      token_estimate: z.number().int().nonnegative().optional(),
      event_loop_lag_ms: z.number().nonnegative().optional()
    }).default({}),
    history: z.array(z.object({
      type: z.string(),
      at: z.string().datetime(),
      data: z.any().optional(),
      evidence: z.string().optional()
    })).default([])
  }),

  result: z.object({
    file_path: z.string().optional(),
    session_url: z.string().url().optional(),
    finish_reason: z.enum(['stop', 'length', 'content_filter', 'error', 'manual', 'unknown']).default('unknown'),
    raw_output_preview: z.string().optional(),

    // NOVO: Subtask results
    subtask_results: z.array(z.object({
      subtask_id: z.string().uuid(),
      status: z.string(),
      output: z.string().optional(),
      quality_score: z.number().optional()
    })).default([]),

    // NOVO: Validation results
    validation_results: z.array(z.object({
      validator_type: z.string(),
      passed: z.boolean(),
      score: z.number().optional(),
      feedback: z.string().optional()
    })).default([])
  })
});
20.2 Exemplo de Task V5 (Book Writing)

{
  "meta": {
    "id": "task-book-001",
    "project_id": "rust-book",
    "workflow_id": "workflow-rust-book",
    "version": "5.0",
    "created_at": "2026-01-27T10:00:00Z",
    "priority": 80,
    "tags": ["book", "rust", "long-running"]
  },
  "spec": {
    "target": "chatgpt",
    "model": "gpt-4o",
    "execution": {
      "strategy": "MULTI_STEP",
      "workflow_config": {
        "steps": [
          {
            "id": "step-outline",
            "name": "Generate Outline",
            "action": "execute_prompt",
            "config": {
              "prompt": "Generate outline for book: Advanced Rust Programming, 15 chapters"
            }
          },
          {
            "id": "step-chapter-1",
            "name": "Write Chapter 1",
            "action": "execute_prompt",
            "config": {
              "prompt": "Write Chapter 1 based on outline. Context: {outline}",
              "iterative": true,
              "max_iterations": 3,
              "validation": { "type": "llm_judge", "criteria": "coherence, accuracy, code examples" }
            },
            "dependencies": ["step-outline"]
          },
          // ... mais 13 chapters
          {
            "id": "step-consistency",
            "name": "Cross-Chapter Consistency Check",
            "action": "execute_prompt",
            "config": {
              "prompt": "Review all chapters for consistency",
              "context": "all_chapters"
            },
            "dependencies": ["step-chapter-1", "step-chapter-2", /*...*/]
          }
        ],
        "max_subtasks": 20,
        "subtask_concurrency": 1  // Sequential chapters
      }
    },
    "validation": {
      "validators": [
        { "type": "llm_judge", "config": { "criteria": ["coherence", "accuracy", "readability"], "min_score": 75 } }
      ]
    },
    "context_config": {
      "inject_previous_results": true,
      "context_window_strategy": "chunked",
      "max_context_tokens": 8000
    }
  },
  "policy": {
    "max_attempts": 1,
    "workflow_policy": {
      "max_execution_time_ms": 36000000,  // 10 hours
      "budget_limit_usd": 50,
      "quality_threshold": 75
    }
  },
  "state": {
    "status": "RUNNING",
    "workflow_state": {
      "current_step_index": 8,
      "completed_steps": ["step-outline", "step-chapter-1", /*...*/, "step-chapter-7"],
      "accumulated_context": {
        "outline": "...",
        "chapters": {
          "1": "...",
          "2": "...",
          // ...
          "7": "..."
        }
      }
    },
    "quality_metrics": {
      "overall_score": 82,
      "chapters_scores": [85, 78, 90, /*...*/]
    },
    "cost_tracking": {
      "total_tokens": 450000,
      "cost_usd": 12.50
    }
  },
  "result": {
    "file_path": "respostas/rust-book.md",
    "subtask_results": [
      { "subtask_id": "step-chapter-1", "status": "DONE", "quality_score": 85 },
      // ...
    ]
  }
}
21. ORCHESTRATOR ENGINE
21.1 Arquitetura

// src/orchestrator/orchestrator_engine.js

class OrchestratorEngine {
  constructor({ kernel, nervBridge, contextManager, validationService, costTracker }) {
    this.kernel = kernel;
    this.nerv = nervBridge;
    this.contextManager = contextManager;
    this.validationService = validationService;
    this.costTracker = costTracker;

    // In-memory workflow states
    this.workflowStates = new Map(); // workflow_id → WorkflowState

    // Strategy handlers
    this.strategyHandlers = {
      SINGLE_SHOT: this._handleSingleShot.bind(this),
      ITERATIVE: this._handleIterative.bind(this),
      MULTI_STEP: this._handleMultiStep.bind(this),
      TREE_OF_THOUGHT: this._handleTreeOfThought.bind(this),
      CHAIN_OF_THOUGHT: this._handleChainOfThought.bind(this)
    };
  }

  /**
   * Execute task based on strategy
   */
  async execute(task) {
    const strategy = task.spec.execution.strategy;
    const handler = this.strategyHandlers[strategy];

    if (!handler) {
      throw new Error(`Unknown execution strategy: ${strategy}`);
    }

    // Emit orchestration start
    this.nerv.emitEvent({
      actionCode: 'ORCHESTRATION_STARTED',
      payload: {
        task_id: task.meta.id,
        strategy,
        workflow_id: task.meta.workflow_id
      }
    });

    try {
      const result = await handler(task);

      // Track cost
      await this.costTracker.record(task.meta.id, result.cost_tracking);

      // Emit orchestration complete
      this.nerv.emitEvent({
        actionCode: 'ORCHESTRATION_COMPLETED',
        payload: {
          task_id: task.meta.id,
          result_preview: result.output.substring(0, 200),
          quality_score: result.quality_score
        }
      });

      return result;
    } catch (error) {
      this.nerv.emitEvent({
        actionCode: 'ORCHESTRATION_FAILED',
        payload: {
          task_id: task.meta.id,
          error: error.message
        }
      });
      throw error;
    }
  }

  /**
   * SINGLE_SHOT: Execute once, no validation
   */
  async _handleSingleShot(task) {
    const driver = await this._getDriver(task.spec.target);
    const result = await driver.execute(task);

    return {
      output: result.output,
      cost_tracking: result.cost_tracking,
      quality_score: null  // No validation
    };
  }

  /**
   * ITERATIVE: Execute → Validate → Refine → Repeat
   */
  async _handleIterative(task) {
    const config = task.spec.execution.iterative_config;
    const maxIterations = config.max_iterations || 3;

    let currentIteration = 0;
    let bestResult = null;
    let bestScore = 0;

    while (currentIteration < maxIterations) {
      currentIteration++;

      // Emit iteration start
      this.nerv.emitEvent({
        actionCode: 'ITERATION_STARTED',
        payload: {
          task_id: task.meta.id,
          iteration: currentIteration,
          max_iterations: maxIterations
        }
      });

      // Execute LLM
      const driver = await this._getDriver(task.spec.target);
      const result = await driver.execute(task);

      // Validate
      const validationResult = await this.validationService.validate(result.output, {
        validators: config.validation_criteria.validators,
        criteria: config.validation_criteria
      });

      const qualityScore = validationResult.overall_score;

      // Emit iteration complete
      this.nerv.emitEvent({
        actionCode: 'ITERATION_COMPLETED',
        payload: {
          task_id: task.meta.id,
          iteration: currentIteration,
          quality_score: qualityScore,
          validation_passed: validationResult.passed
        }
      });

      // Track best result
      if (qualityScore > bestScore) {
        bestResult = result;
        bestScore = qualityScore;
      }

      // Check if passed
      if (validationResult.passed && qualityScore >= config.validation_criteria.min_quality_score) {
        return {
          output: result.output,
          cost_tracking: result.cost_tracking,
          quality_score: qualityScore,
          iterations: currentIteration
        };
      }

      // Prepare feedback for next iteration
      if (currentIteration < maxIterations) {
        task.spec.payload.context = {
          previous_attempts: currentIteration,
          previous_output: result.output,
          validation_feedback: validationResult.feedback,
          issues: validationResult.issues
        };

        task.spec.payload.user_message += `\n\n[Feedback from iteration ${currentIteration}]: ${validationResult.feedback}`;
      }
    }

    // Max iterations reached, return best
    return {
      output: bestResult.output,
      cost_tracking: bestResult.cost_tracking,
      quality_score: bestScore,
      iterations: currentIteration,
      converged: false
    };
  }

  /**
   * MULTI_STEP: Execute workflow with multiple steps
   */
  async _handleMultiStep(task) {
    const workflowConfig = task.spec.execution.workflow_config;
    const steps = workflowConfig.steps;

    // Initialize workflow state
    const workflowState = {
      workflow_id: task.meta.workflow_id,
      task_id: task.meta.id,
      steps: steps,
      current_step_index: 0,
      completed_steps: [],
      failed_steps: [],
      accumulated_context: {},
      results: []
    };

    this.workflowStates.set(task.meta.workflow_id, workflowState);

    // Execute steps
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      workflowState.current_step_index = i;

      // Check dependencies
      const dependenciesMet = step.dependencies.every(depId =>
        workflowState.completed_steps.includes(depId)
      );

      if (!dependenciesMet) {
        throw new Error(`Step ${step.id} dependencies not met: ${step.dependencies.join(', ')}`);
      }

      // Emit step start
      this.nerv.emitEvent({
        actionCode: 'WORKFLOW_STEP_STARTED',
        payload: {
          workflow_id: task.meta.workflow_id,
          step_id: step.id,
          step_index: i,
          total_steps: steps.length
        }
      });

      try {
        // Execute step based on action type
        let stepResult;
        switch (step.action) {
          case 'execute_prompt':
            stepResult = await this._executeStepPrompt(step, workflowState, task);
            break;
          case 'validate':
            stepResult = await this._executeStepValidate(step, workflowState);
            break;
          case 'branch':
            stepResult = await this._executeStepBranch(step, workflowState);
            break;
          case 'spawn_subtask':
            stepResult = await this._executeStepSpawnSubtask(step, workflowState, task);
            break;
          default:
            throw new Error(`Unknown step action: ${step.action}`);
        }

        // Store result in accumulated context
        workflowState.accumulated_context[step.id] = stepResult.output;
        workflowState.results.push(stepResult);
        workflowState.completed_steps.push(step.id);

        // Emit step complete
        this.nerv.emitEvent({
          actionCode: 'WORKFLOW_STEP_COMPLETED',
          payload: {
            workflow_id: task.meta.workflow_id,
            step_id: step.id,
            result_preview: stepResult.output?.substring(0, 200),
            quality_score: stepResult.quality_score
          }
        });

      } catch (error) {
        workflowState.failed_steps.push(step.id);

        // Emit step failed
        this.nerv.emitEvent({
          actionCode: 'WORKFLOW_STEP_FAILED',
          payload: {
            workflow_id: task.meta.workflow_id,
            step_id: step.id,
            error: error.message
          }
        });

        // Handle failure based on policy
        if (step.on_failure === 'abort') {
          throw error;
        } else if (step.on_failure === 'skip') {
          continue;
        } else if (step.on_failure === 'retry') {
          // Retry logic (implement if needed)
        }
      }
    }

    // Aggregate results
    const finalOutput = this._aggregateWorkflowResults(workflowState);
    const totalCost = workflowState.results.reduce((sum, r) => sum + (r.cost_tracking?.cost_usd || 0), 0);
    const avgQualityScore = workflowState.results.reduce((sum, r) => sum + (r.quality_score || 0), 0) / workflowState.results.length;

    return {
      output: finalOutput,
      cost_tracking: {
        cost_usd: totalCost,
        total_tokens: workflowState.results.reduce((sum, r) => sum + (r.cost_tracking?.total_tokens || 0), 0)
      },
      quality_score: avgQualityScore,
      workflow_state: workflowState
    };
  }

  /**
   * Execute step: execute_prompt
   */
  async _executeStepPrompt(step, workflowState, parentTask) {
    // Inject context from previous steps
    let prompt = step.config.prompt;

    // Replace placeholders with accumulated context
    Object.keys(workflowState.accumulated_context).forEach(key => {
      const value = workflowState.accumulated_context[key];
      prompt = prompt.replace(`{${key}}`, value);
    });

    // Create subtask
    const subtask = {
      ...parentTask,
      meta: {
        ...parentTask.meta,
        id: `${parentTask.meta.id}-${step.id}`,
        parent_id: parentTask.meta.id
      },
      spec: {
        ...parentTask.spec,
        payload: {
          user_message: prompt,
          context: workflowState.accumulated_context
        }
      }
    };

    // Execute
    if (step.config.iterative) {
      subtask.spec.execution = {
        strategy: 'ITERATIVE',
        iterative_config: {
          max_iterations: step.config.max_iterations || 3,
          validation_criteria: step.config.validation || {}
        }
      };
    } else {
      subtask.spec.execution = { strategy: 'SINGLE_SHOT' };
    }

    return await this.execute(subtask);
  }

  /**
   * Get driver instance based on target
   */
  async _getDriver(target) {
    const driverFactory = require('../driver/factory');
    return await driverFactory.createDriver(target);
  }

  /**
   * Aggregate workflow results into final output
   */
  _aggregateWorkflowResults(workflowState) {
    // Simple concatenation for now
    // Could be more sophisticated (e.g., structured JSON, markdown sections)
    return workflowState.results.map(r => r.output).join('\n\n---\n\n');
  }

  /**
   * Get workflow state (for dashboard queries)
   */
  getWorkflowState(workflowId) {
    return this.workflowStates.get(workflowId);
  }
}

module.exports = { OrchestratorEngine };
22. VALIDATION FRAMEWORK
22.1 Validation Service

// src/orchestrator/validation/validation_service.js

class ValidationService {
  constructor({ nerv }) {
    this.nerv = nerv;

    // Built-in validators
    this.validators = {
      regex: new RegexValidator(),
      schema: new SchemaValidator(),
      length: new LengthValidator(),
      format: new FormatValidator(),
      llm_judge: new LLMJudgeValidator(),
      custom: new CustomValidator()
    };
  }

  /**
   * Validate output against criteria
   */
  async validate(output, criteria) {
    const { validators, min_score } = criteria;
    const results = [];

    for (const validatorConfig of validators) {
      const validator = this.validators[validatorConfig.type];

      if (!validator) {
        throw new Error(`Unknown validator: ${validatorConfig.type}`);
      }

      const result = await validator.validate(output, validatorConfig.config);
      results.push(result);

      // Emit validation event
      this.nerv.emitEvent({
        actionCode: 'VALIDATION_EXECUTED',
        payload: {
          validator_type: validatorConfig.type,
          passed: result.passed,
          score: result.score
        }
      });
    }

    // Aggregate results
    const overallScore = results.reduce((sum, r) => sum + r.score, 0) / results.length;
    const allPassed = results.every(r => r.passed);
    const passed = allPassed && overallScore >= (min_score || 0);

    return {
      passed,
      overall_score: overallScore,
      results,
      feedback: this._generateFeedback(results),
      issues: results.filter(r => !r.passed).map(r => r.feedback)
    };
  }

  _generateFeedback(results) {
    const issues = results.filter(r => !r.passed);
    if (issues.length === 0) {
      return "All validations passed. Output meets quality criteria.";
    }

    return `Found ${issues.length} issue(s):\n` + issues.map(r => `- ${r.feedback}`).join('\n');
  }
}

/**
 * LLM-as-Judge Validator
 * Uses an LLM to evaluate output quality
 */
class LLMJudgeValidator {
  async validate(output, config) {
    const { model, criteria, min_score } = config;

    // Construct judge prompt
    const judgePrompt = `
You are an expert quality evaluator. Evaluate the following output based on these criteria:
${Array.isArray(criteria) ? criteria.join(', ') : criteria}

Output to evaluate:
"""
${output}
"""

Provide your evaluation as JSON:
{
  "overall_score": 0-100,
  "criteria_scores": { "criterion": score, ... },
  "strengths": ["list of strengths"],
  "weaknesses": ["list of weaknesses"],
  "suggestions": ["list of improvement suggestions"]
}
`;

    // Call LLM (use driver)
    const driverFactory = require('../../driver/factory');
    const driver = await driverFactory.createDriver('chatgpt');  // Or specified model

    const result = await driver.execute({
      spec: {
        target: 'chatgpt',
        model: model || 'gpt-4o',
        payload: {
          user_message: judgePrompt
        },
        parameters: {
          temperature: 0.2,  // Lower temp for consistent evaluation
          response_format: { type: 'json_object' }
        }
      }
    });

    const evaluation = JSON.parse(result.output);

    return {
      passed: evaluation.overall_score >= (min_score || 70),
      score: evaluation.overall_score,
      feedback: `Score: ${evaluation.overall_score}/100. Weaknesses: ${evaluation.weaknesses.join(', ')}`,
      details: evaluation
    };
  }
}

module.exports = { ValidationService, LLMJudgeValidator };
23. MULTI-DRIVER ARCHITECTURE
23.1 Base Driver Interface

// src/driver/base_driver_v2.js

class BaseDriverV2 {
  /**
   * Get driver capabilities
   */
  getCapabilities() {
    return {
      models: [],              // Supported models
      max_tokens: 4096,        // Max output tokens
      supports_json: false,    // JSON mode support
      supports_vision: false,  // Image input support
      supports_function_calling: false,
      cost_per_1k_input: 0,    // Cost in USD
      cost_per_1k_output: 0
    };
  }

  /**
   * Execute task
   * @returns { output, cost_tracking }
   */
  async execute(task) {
    throw new Error('execute() must be implemented by subclass');
  }

  /**
   * Validate task can be executed by this driver
   */
  async validate(task) {
    return { valid: true, issues: [] };
  }

  /**
   * Estimate cost for task
   */
  estimateCost(task) {
    const capabilities = this.getCapabilities();
    const estimatedInputTokens = this._estimateTokens(task.spec.payload.user_message);
    const estimatedOutputTokens = task.spec.parameters.max_tokens || 1000;

    return {
      input_tokens: estimatedInputTokens,
      output_tokens: estimatedOutputTokens,
      cost_usd: (estimatedInputTokens / 1000) * capabilities.cost_per_1k_input +
                (estimatedOutputTokens / 1000) * capabilities.cost_per_1k_output
    };
  }

  _estimateTokens(text) {
    // Rough estimation: 1 token ≈ 4 characters
    return Math.ceil(text.length / 4);
  }
}

module.exports = { BaseDriverV2 };
23.2 Driver Factory V2

// src/driver/driver_factory_v2.js

const { ChatGPTDriverV2 } = require('./chatgpt_driver_v2');
const { GeminiDriverV2 } = require('./gemini_driver_v2');
const { ClaudeDriverV2 } = require('./claude_driver_v2');
const { OllamaDriverV2 } = require('./ollama_driver_v2');

class DriverFactoryV2 {
  constructor() {
    this.drivers = {
      chatgpt: ChatGPTDriverV2,
      gemini: GeminiDriverV2,
      claude: ClaudeDriverV2,
      ollama: OllamaDriverV2
    };
  }

  /**
   * Create driver instance based on target
   * If target is 'auto', select best driver based on task requirements
   */
  async createDriver(target, task = null) {
    if (target === 'auto') {
      return await this._selectBestDriver(task);
    }

    const DriverClass = this.drivers[target];
    if (!DriverClass) {
      throw new Error(`Unknown driver target: ${target}`);
    }

    return new DriverClass();
  }

  /**
   * Select best driver based on task requirements
   */
  async _selectBestDriver(task) {
    const requirements = this._extractRequirements(task);

    // Score each driver
    const scores = await Promise.all(
      Object.entries(this.drivers).map(async ([name, DriverClass]) => {
        const driver = new DriverClass();
        const capabilities = driver.getCapabilities();
        const score = this._scoreDriver(capabilities, requirements);

        return { name, driver, score, capabilities };
      })
    );

    // Sort by score (descending)
    scores.sort((a, b) => b.score - a.score);

    // Return best driver
    const best = scores[0];
    console.log(`Auto-selected driver: ${best.name} (score: ${best.score})`);

    return best.driver;
  }

  /**
   * Extract requirements from task
   */
  _extractRequirements(task) {
    return {
      max_tokens: task.spec.parameters?.max_tokens || 4096,
      needs_json: task.spec.parameters?.response_format?.type === 'json_object',
      needs_vision: task.spec.payload.images?.length > 0,
      budget_limit: task.policy?.workflow_policy?.budget_limit_usd
    };
  }

  /**
   * Score driver against requirements
   */
  _scoreDriver(capabilities, requirements) {
    let score = 100;

    // Check hard requirements
    if (requirements.needs_json && !capabilities.supports_json) {
      score -= 50;
    }

    if (requirements.needs_vision && !capabilities.supports_vision) {
      score -= 50;
    }

    if (requirements.max_tokens > capabilities.max_tokens) {
      score -= 30;
    }

    // Prefer cheaper models if budget limited
    if (requirements.budget_limit) {
      const costScore = Math.max(0, 20 - (capabilities.cost_per_1k_output * 10));
      score += costScore;
    }

    return score;
  }

  /**
   * Create driver with fallback strategy
   * If primary fails, try secondary
   */
  async createDriverWithFallback(primaryTarget, fallbackTarget) {
    const primaryDriver = await this.createDriver(primaryTarget);
    const fallbackDriver = await this.createDriver(fallbackTarget);

    return new FallbackDriver(primaryDriver, fallbackDriver);
  }
}

/**
 * Fallback Driver Wrapper
 */
class FallbackDriver {
  constructor(primaryDriver, fallbackDriver) {
    this.primary = primaryDriver;
    this.fallback = fallbackDriver;
  }

  async execute(task) {
    try {
      return await this.primary.execute(task);
    } catch (error) {
      console.warn(`Primary driver failed: ${error.message}. Falling back...`);
      return await this.fallback.execute(task);
    }
  }

  getCapabilities() {
    return this.primary.getCapabilities();
  }
}

module.exports = { DriverFactoryV2, FallbackDriver };
24. DASHBOARD ENHANCEMENTS (Orchestration UI)
24.1 Workflow Designer Component

<!-- src/dashboard-ui/src/views/WorkflowDesigner.vue -->

<template>
  <div class="workflow-designer">
    <div class="toolbar">
      <button @click="addStep('execute_prompt')">Add Prompt Step</button>
      <button @click="addStep('validate')">Add Validation Step</button>
      <button @click="addStep('branch')">Add Branch</button>
      <button @click="validateWorkflow">Validate Workflow</button>
      <button @click="saveWorkflow" :disabled="!isValid">Save Workflow</button>
      <button @click="executeWorkflow" :disabled="!isValid" class="primary">Execute</button>
    </div>

    <div class="canvas-area">
      <!-- Cytoscape.js canvas for visual DAG -->
      <cytoscape
        ref="cytoscapeRef"
        :config="cytoscapeConfig"
        :elements="workflowSteps"
        @node-click="editStep"
        @edge-click="editDependency"
      />
    </div>

    <div class="step-editor" v-if="selectedStep">
      <h3>Edit Step: {{ selectedStep.name }}</h3>
      <form @submit.prevent="saveStep">
        <div class="form-group">
          <label>Step Name</label>
          <input v-model="selectedStep.name" required />
        </div>

        <div class="form-group">
          <label>Action Type</label>
          <select v-model="selectedStep.action">
            <option value="execute_prompt">Execute Prompt</option>
            <option value="validate">Validate</option>
            <option value="branch">Branch</option>
            <option value="spawn_subtask">Spawn Subtask</option>
          </select>
        </div>

        <div class="form-group" v-if="selectedStep.action === 'execute_prompt'">
          <label>Prompt Template</label>
          <textarea v-model="selectedStep.config.prompt" rows="10"></textarea>
          <small>Use {step_id} to reference previous step results</small>
        </div>

        <div class="form-group">
          <label>Dependencies</label>
          <multiselect
            v-model="selectedStep.dependencies"
            :options="availableSteps"
            multiple
            label="name"
            track-by="id"
          />
        </div>

        <div class="form-group">
          <label>On Failure</label>
          <select v-model="selectedStep.on_failure">
            <option value="abort">Abort Workflow</option>
            <option value="retry">Retry Step</option>
            <option value="skip">Skip and Continue</option>
          </select>
        </div>

        <div class="form-actions">
          <button type="submit" class="primary">Save Step</button>
          <button type="button" @click="deleteStep">Delete Step</button>
        </div>
      </form>
    </div>
  </div>
</template>

<script>
import { ref, computed } from 'vue';
import { useWorkflowStore } from '@/stores/workflow';

export default {
  setup() {
    const workflowStore = useWorkflowStore();

    const selectedStep = ref(null);
    const workflowSteps = computed(() => workflowStore.currentWorkflow?.steps || []);
    const isValid = computed(() => workflowStore.workflowValidation?.valid || false);

    const addStep = (actionType) => {
      const newStep = {
        id: `step-${Date.now()}`,
        name: `New ${actionType} Step`,
        action: actionType,
        config: {},
        dependencies: [],
        on_failure: 'abort'
      };

      workflowStore.addStep(newStep);
    };

    const editStep = (stepId) => {
      selectedStep.value = workflowStore.getStep(stepId);
    };

    const saveStep = () => {
      workflowStore.updateStep(selectedStep.value);
      selectedStep.value = null;
    };

    const deleteStep = () => {
      workflowStore.deleteStep(selectedStep.value.id);
      selectedStep.value = null;
    };

    const validateWorkflow = async () => {
      await workflowStore.validateWorkflow();
    };

    const saveWorkflow = async () => {
      await workflowStore.saveWorkflow();
    };

    const executeWorkflow = async () => {
      await workflowStore.executeWorkflow();
    };

    return {
      selectedStep,
      workflowSteps,
      isValid,
      addStep,
      editStep,
      saveStep,
      deleteStep,
      validateWorkflow,
      saveWorkflow,
      executeWorkflow
    };
  }
};
</script>
24.2 Quality Dashboard

<!-- src/dashboard-ui/src/views/QualityDashboard.vue -->

<template>
  <div class="quality-dashboard">
    <h1>Quality Metrics</h1>

    <div class="metrics-grid">
      <!-- Overall Quality Score -->
      <metric-card
        title="Overall Quality Score"
        :value="metrics.overall_score"
        suffix="/100"
        :trend="metrics.score_trend"
        icon="star"
      />

      <!-- Validation Pass Rate -->
      <metric-card
        title="Validation Pass Rate"
        :value="metrics.pass_rate"
        suffix="%"
        :trend="metrics.pass_rate_trend"
        icon="check-circle"
      />

      <!-- Average Iterations -->
      <metric-card
        title="Avg Iterations to Pass"
        :value="metrics.avg_iterations"
        :trend="metrics.iterations_trend"
        icon="refresh"
      />

      <!-- Cost Efficiency -->
      <metric-card
        title="Cost per Passed Task"
        :value="metrics.cost_per_task"
        prefix="$"
        :trend="metrics.cost_trend"
        icon="dollar-sign"
      />
    </div>

    <div class="charts-row">
      <!-- Quality Score Over Time -->
      <chart-card title="Quality Score Over Time">
        <line-chart
          :data="qualityScoreHistory"
          :labels="timestamps"
          :options="{ min: 0, max: 100 }"
        />
      </chart-card>

      <!-- Validation Results Distribution -->
      <chart-card title="Validation Results">
        <bar-chart
          :data="validationDistribution"
          :labels="['Pass', 'Fail', 'Retry']"
        />
      </chart-card>
    </div>

    <div class="tasks-table">
      <h2>Recent Tasks with Quality Scores</h2>
      <data-table
        :columns="['Task ID', 'Strategy', 'Quality Score', 'Iterations', 'Cost', 'Status']"
        :rows="recentTasks"
        :sortable="true"
      >
        <template #quality_score="{ row }">
          <quality-badge :score="row.quality_score" />
        </template>
      </data-table>
    </div>
  </div>
</template>

<script>
import { computed } from 'vue';
import { useTelemetryStore } from '@/stores/telemetry';

export default {
  setup() {
    const telemetryStore = useTelemetryStore();

    const metrics = computed(() => telemetryStore.qualityMetrics);
    const qualityScoreHistory = computed(() => telemetryStore.qualityScoreHistory);
    const validationDistribution = computed(() => telemetryStore.validationDistribution);
    const recentTasks = computed(() => telemetryStore.recentTasksWithQuality);

    return {
      metrics,
      qualityScoreHistory,
      validationDistribution,
      recentTasks
    };
  }
};
</script>
25. SEMANTIC TELEMETRY (Extended NERV Events)
25.1 New Action Codes

// src/shared/nerv/constants_v2.js

const ActionCodeV2 = {
  // ... existing action codes ...

  // Orchestration events
  ORCHESTRATION_STARTED: 'ORCHESTRATION_STARTED',
  ORCHESTRATION_COMPLETED: 'ORCHESTRATION_COMPLETED',
  ORCHESTRATION_FAILED: 'ORCHESTRATION_FAILED',
  ORCHESTRATION_PAUSED: 'ORCHESTRATION_PAUSED',
  ORCHESTRATION_RESUMED: 'ORCHESTRATION_RESUMED',

  // Workflow events
  WORKFLOW_STEP_STARTED: 'WORKFLOW_STEP_STARTED',
  WORKFLOW_STEP_COMPLETED: 'WORKFLOW_STEP_COMPLETED',
  WORKFLOW_STEP_FAILED: 'WORKFLOW_STEP_FAILED',
  WORKFLOW_STEP_SKIPPED: 'WORKFLOW_STEP_SKIPPED',
  SUBTASK_SPAWNED: 'SUBTASK_SPAWNED',
  SUBTASK_COMPLETED: 'SUBTASK_COMPLETED',

  // Iteration events
  ITERATION_STARTED: 'ITERATION_STARTED',
  ITERATION_COMPLETED: 'ITERATION_COMPLETED',
  ITERATION_CONVERGED: 'ITERATION_CONVERGED',
  ITERATION_DIVERGED: 'ITERATION_DIVERGED',

  // Validation events
  VALIDATION_STARTED: 'VALIDATION_STARTED',
  VALIDATION_COMPLETED: 'VALIDATION_COMPLETED',
  VALIDATION_PASSED: 'VALIDATION_PASSED',
  VALIDATION_FAILED: 'VALIDATION_FAILED',

  // Quality events
  QUALITY_ASSESSED: 'QUALITY_ASSESSED',
  QUALITY_THRESHOLD_MET: 'QUALITY_THRESHOLD_MET',
  QUALITY_THRESHOLD_MISSED: 'QUALITY_THRESHOLD_MISSED',
  QUALITY_IMPROVED: 'QUALITY_IMPROVED',
  QUALITY_DEGRADED: 'QUALITY_DEGRADED',

  // Context events
  CONTEXT_INJECTED: 'CONTEXT_INJECTED',
  CONTEXT_CHUNKED: 'CONTEXT_CHUNKED',
  CONTEXT_SUMMARIZED: 'CONTEXT_SUMMARIZED',
  MEMORY_STORED: 'MEMORY_STORED',
  MEMORY_RETRIEVED: 'MEMORY_RETRIEVED',

  // Cost events
  TOKEN_USAGE_RECORDED: 'TOKEN_USAGE_RECORDED',
  COST_CALCULATED: 'COST_CALCULATED',
  BUDGET_WARNING: 'BUDGET_WARNING',
  BUDGET_EXCEEDED: 'BUDGET_EXCEEDED',

  // Progress events
  PROGRESS_MILESTONE: 'PROGRESS_MILESTONE',      // e.g., "Chapter 5/15 completed"
  PROGRESS_ESTIMATE_UPDATED: 'PROGRESS_ESTIMATE_UPDATED',
  TIME_REMAINING_UPDATED: 'TIME_REMAINING_UPDATED',

  // Driver events
  DRIVER_SELECTED: 'DRIVER_SELECTED',
  DRIVER_FALLBACK: 'DRIVER_FALLBACK',
  DRIVER_CAPABILITY_CHECK: 'DRIVER_CAPABILITY_CHECK',

  // Self-correction events
  SELF_CORRECTION_INITIATED: 'SELF_CORRECTION_INITIATED',
  SELF_CORRECTION_COMPLETED: 'SELF_CORRECTION_COMPLETED',
  ERROR_ANALYZED: 'ERROR_ANALYZED',
  FIX_APPLIED: 'FIX_APPLIED'
};
25.2 Semantic Telemetry Store

// src/orchestrator/semantic_telemetry.js

class SemanticTelemetry {
  constructor({ nerv }) {
    this.nerv = nerv;

    // Aggregate metrics by task
    this.taskMetrics = new Map(); // task_id → Metrics

    // Listen to semantic events
    this._setupListeners();
  }

  _setupListeners() {
    // Quality events
    this.nerv.on('QUALITY_ASSESSED', (envelope) => {
      const { task_id, overall_score, criteria_scores } = envelope.payload;

      const metrics = this._getOrCreateMetrics(task_id);
      metrics.quality = {
        overall_score,
        criteria_scores,
        assessed_at: Date.now()
      };
    });

    // Iteration events
    this.nerv.on('ITERATION_COMPLETED', (envelope) => {
      const { task_id, iteration, quality_score } = envelope.payload;

      const metrics = this._getOrCreateMetrics(task_id);
      if (!metrics.iterations) metrics.iterations = [];

      metrics.iterations.push({
        iteration,
        quality_score,
        completed_at: Date.now()
      });
    });

    // Cost events
    this.nerv.on('TOKEN_USAGE_RECORDED', (envelope) => {
      const { task_id, input_tokens, output_tokens, cost_usd, model } = envelope.payload;

      const metrics = this._getOrCreateMetrics(task_id);
      metrics.cost = {
        input_tokens: (metrics.cost?.input_tokens || 0) + input_tokens,
        output_tokens: (metrics.cost?.output_tokens || 0) + output_tokens,
        total_cost_usd: (metrics.cost?.total_cost_usd || 0) + cost_usd,
        model
      };
    });

    // Progress events
    this.nerv.on('PROGRESS_MILESTONE', (envelope) => {
      const { task_id, milestone, progress_percent } = envelope.payload;

      const metrics = this._getOrCreateMetrics(task_id);
      if (!metrics.milestones) metrics.milestones = [];

      metrics.milestones.push({
        milestone,
        progress_percent,
        reached_at: Date.now()
      });
    });
  }

  _getOrCreateMetrics(taskId) {
    if (!this.taskMetrics.has(taskId)) {
      this.taskMetrics.set(taskId, {
        task_id: taskId,
        created_at: Date.now()
      });
    }
    return this.taskMetrics.get(taskId);
  }

  /**
   * Get metrics for specific task
   */
  getTaskMetrics(taskId) {
    return this.taskMetrics.get(taskId) || null;
  }

  /**
   * Get aggregated metrics across all tasks
   */
  getAggregatedMetrics() {
    const allMetrics = Array.from(this.taskMetrics.values());

    return {
      total_tasks: allMetrics.length,
      avg_quality_score: this._average(allMetrics.map(m => m.quality?.overall_score).filter(Boolean)),
      avg_iterations: this._average(allMetrics.map(m => m.iterations?.length).filter(Boolean)),
      total_cost_usd: allMetrics.reduce((sum, m) => sum + (m.cost?.total_cost_usd || 0), 0),
      total_tokens: allMetrics.reduce((sum, m) => sum + (m.cost?.input_tokens || 0) + (m.cost?.output_tokens || 0), 0)
    };
  }

  _average(arr) {
    return arr.length > 0 ? arr.reduce((sum, val) => sum + val, 0) / arr.length : 0;
  }
}

module.exports = { SemanticTelemetry };
26. COST TRACKER

// src/orchestrator/cost_tracker.js

class CostTracker {
  constructor({ storage }) {
    this.storage = storage;

    // In-memory cache
    this.costRecords = []; // [ { task_id, timestamp, model, tokens, cost_usd } ]
  }

  /**
   * Record cost for task execution
   */
  async record(taskId, costData) {
    const record = {
      task_id: taskId,
      timestamp: Date.now(),
      model: costData.model_used,
      input_tokens: costData.input_tokens,
      output_tokens: costData.output_tokens,
      total_tokens: costData.total_tokens,
      cost_usd: costData.cost_usd
    };

    // Add to cache
    this.costRecords.push(record);

    // Persist to disk (async)
    await this.storage.appendCostRecord(record);

    return record;
  }

  /**
   * Get costs by date range
   */
  async getCostsByDateRange(startTimestamp, endTimestamp) {
    const filtered = this.costRecords.filter(r =>
      r.timestamp >= startTimestamp && r.timestamp <= endTimestamp
    );

    return {
      total: filtered.reduce((sum, r) => sum + r.cost_usd, 0),
      tokens: filtered.reduce((sum, r) => sum + r.total_tokens, 0),
      input_tokens: filtered.reduce((sum, r) => sum + r.input_tokens, 0),
      output_tokens: filtered.reduce((sum, r) => sum + r.output_tokens, 0),
      task_count: filtered.length,
      by_task: this._groupBy(filtered, 'task_id'),
      by_model: this._groupBy(filtered, 'model')
    };
  }

  /**
   * Get today's costs
   */
  async getTodayCosts() {
    const today = new Date().setHours(0, 0, 0, 0);
    return await this.getCostsByDateRange(today, Date.now());
  }

  _groupBy(arr, key) {
    return arr.reduce((acc, obj) => {
      const groupKey = obj[key];
      if (!acc[groupKey]) {
        acc[groupKey] = { count: 0, total_cost: 0, total_tokens: 0 };
      }
      acc[groupKey].count++;
      acc[groupKey].total_cost += obj.cost_usd;
      acc[groupKey].total_tokens += obj.total_tokens;
      return acc;
    }, {});
  }
}

module.exports = { CostTracker };
27. MIGRAÇÃO COMPLETA (17 SEMANAS)
Fase 1-5: Dashboard Enterprise (Semanas 1-5)
[Já detalhado anteriormente no plano]

Fase 6: Task Schema V5 (Semana 6)
Objetivos:

Implementar Task Schema V5 com extensões
Criar migrador V4 → V5
Testes de compatibilidade retroativa
Entregáveis:

src/core/schemas/task_schema_v5.js
src/core/schemas/migrator_v4_to_v5.js
Testes: V4 tasks continuam funcionando
Fase 7-8: Orchestrator Engine (Semanas 7-8)
Objetivos:

Implementar OrchestratorEngine
Implementar estratégias: SINGLE_SHOT, ITERATIVE, MULTI_STEP
Integrar ao kernel loop
Entregáveis:

src/orchestrator/orchestrator_engine.js
src/orchestrator/strategies/ (single_shot, iterative, multi_step)
Testes: Task simples executa via orchestrator
Fase 9: Validation Framework (Semana 9)
Objetivos:

Implementar ValidationService
Implementar validadores: regex, schema, length, llm_judge
Integrar validação ao orchestrator
Entregáveis:

src/orchestrator/validation/validation_service.js
src/orchestrator/validation/validators/ (regex, schema, llm_judge, etc.)
Testes: Tasks validam e retry em falha
Fase 10-11: Multi-Driver Architecture (Semanas 10-11)
Objetivos:

Implementar BaseDriverV2 interface
Refatorar ChatGPTDriver → ChatGPTDriverV2
Implementar GeminiDriverV2, ClaudeDriverV2
Implementar DriverFactoryV2 com auto-selection
Implementar FallbackDriver
Entregáveis:

src/driver/base_driver_v2.js
src/driver/chatgpt_driver_v2.js
src/driver/gemini_driver_v2.js
src/driver/claude_driver_v2.js
src/driver/driver_factory_v2.js
Testes: Tasks executam em múltiplos drivers
Fase 12: Context Management (Semana 12)
Objetivos:

Implementar Context Manager
Chunking de contexto grande
Context injection entre steps
Long-term memory storage
Entregáveis:

src/orchestrator/context_manager.js
src/orchestrator/memory_store.js
Testes: Context acumula entre workflow steps
Fase 13: Semantic Telemetry (Semana 13)
Objetivos:

Estender NERV constants (30+ novos action codes)
Implementar SemanticTelemetry
Implementar CostTracker
Adicionar novos eventos Socket.io
Entregáveis:

src/shared/nerv/constants_v2.js
src/orchestrator/semantic_telemetry.js
src/orchestrator/cost_tracker.js
Eventos Socket.io estendidos
Fase 14-15: Dashboard Orchestration UI (Semanas 14-15)
Objetivos:

Implementar Workflow Designer (Vue component)
Implementar Quality Dashboard
Implementar Cost Dashboard
Implementar Reasoning Trace Viewer
Entregáveis:

src/dashboard-ui/src/views/WorkflowDesigner.vue
src/dashboard-ui/src/views/QualityDashboard.vue
src/dashboard-ui/src/views/CostDashboard.vue
src/dashboard-ui/src/views/ReasoningTraceViewer.vue
Testes: Workflows criados via UI executam corretamente
Fase 16: Use Cases Implementation (Semana 16)
Objetivos:

Implementar templates para use cases:
Book writing workflow
Code project workflow
Research report workflow
Testes end-to-end de cada use case
Entregáveis:

Templates pré-configurados
Documentação de uso
Vídeos/tutorials
Fase 17: Production Hardening (Semana 17)
Objetivos:

Testes de carga (100+ tasks concorrentes)
Otimização de performance
Documentação completa
Deploy em produção
Entregáveis:

Testes E2E passando (Playwright)
Performance benchmarks
User guide + Developer guide
Deployment scripts
RESUMO FINAL
Sistema Completo
Plataforma de Orquestração Autônoma de LLMs de Nível Enterprise

Capacidades:

✅ Dashboard profissional (Vue.js 3 + Vite)
✅ Telemetria vasta (73+ eventos técnicos + 30+ eventos semânticos)
✅ Execução autônoma de tarefas complexas (livros, programas, pesquisas)
✅ Multi-step workflows com branching, looping, iteração
✅ Validação automática e self-correction (LLM-as-judge)
✅ Multi-driver support (ChatGPT, Gemini, Claude, Ollama) com fallback
✅ Context management inteligente (chunking, injection, memory)
✅ Cost tracking e budget management
✅ Quality scoring e progress tracking
✅ Controle granular de LLMs via dashboard
Arquitetura:

Zero-coupling via NERV (todos componentes se comunicam via event bus)
Modular (plug-and-play drivers, validators, strategies)
Observable (telemetria em cada decisão, reasoning traces)
Fault-tolerant (retries, fallbacks, graceful degradation)
Scalable (100+ tasks concorrentes, 50+ subtasks por workflow)
Duração Total: 17 semanas

Dashboard Enterprise: 5 semanas
Sistema de Orquestração: 12 semanas
Status: ✅ Planejamento completo, arquitetura definida, pronto para implementação

Stayed in plan mode
O usuário rejeitou o ExitPlanMode porque quer ter acesso à pasta com todos os documentos. Isso faz sentido - ele quer ver os arquivos criados antes de aprovar o plano.

Deixe-me listar os arquivos na pasta de plans para mostrar o que foi criado.

Entendido! Vou mostrar todos os documentos criados na pasta de plans.

Bash Listar todos os documentos MD na pasta de plans
IN
ls -lh /home/node/.claude/plans/*.md

OUT
-rw-r--r-- 1 node node  29K jan 27 15:49 /home/node/.claude/plans/01-MISSION_ARCHITECTURE.md
-rw-r--r-- 1 node node  34K jan 27 15:52 /home/node/.claude/plans/02-AUTONOMOUS_EXECUTION.md
-rw-r--r-- 1 node node  35K jan 27 15:55 /home/node/.claude/plans/03-FEEDBACK_LOOPS.md
-rw-r--r-- 1 node node  29K jan 27 15:58 /home/node/.claude/plans/04-MISSION_EXAMPLES.md
-rw-r--r-- 1 node node  44K jan 27 16:04 /home/node/.claude/plans/05-IMPLEMENTATION_ROADMAP.md
-rw-r--r-- 1 node node 100K jan 27 15:33 /home/node/.claude/plans/hashed-riding-dove.md
Perfeito! Agora vou mostrar um resumo do conteúdo de cada arquivo para o usuário ter uma visão geral do que foi criado.

Bash Mostrar resumo de todos os documentos criados
IN
echo "=== RESUMO DOS DOCUMENTOS CRIADOS ===" && echo && for file in /home/node/.claude/plans/*.md; do echo "📄 $(basename "$file")" && echo "   Tamanho: $(ls -lh "$file" | awk '{print $5}')" && echo "   Linhas: $(wc -l < "$file")" && head -n 3 "$file" | tail -n 1 && echo; done

OUT
=== RESUMO DOS DOCUMENTOS CRIADOS ===

📄 01-MISSION_ARCHITECTURE.md
   Tamanho: 29K
   Linhas: 920
## 1. HIERARQUIA CONCEITUAL

📄 02-AUTONOMOUS_EXECUTION.md
   Tamanho: 34K
   Linhas: 1102
## 1. VISÃO GERAL

📄 03-FEEDBACK_LOOPS.md
   Tamanho: 35K
   Linhas: 1294
## 1. VISÃO GERAL

📄 04-MISSION_EXAMPLES.md
   Tamanho: 29K
   Linhas: 904
## EXEMPLO 1: ESCREVER LIVRO TÉCNICO ("Advanced Rust Programming")

📄 05-IMPLEMENTATION_ROADMAP.md
   Tamanho: 44K
   Linhas: 1743
## Visão Geral da Implementação

📄 hashed-riding-dove.md
   Tamanho: 100K
   Linhas: 3220
## Status: ✅ PRONTO PARA IMPLEMENTAÇÃO
Excelente! Agora o usuário pode ver todos os documentos criados. Tenho:

01-MISSION_ARCHITECTURE.md - 29K, 920 linhas - Arquitetura de missões
02-AUTONOMOUS_EXECUTION.md - 34K, 1102 linhas - Execução autônoma
03-FEEDBACK_LOOPS.md - 35K, 1294 linhas - Loops de feedback
04-MISSION_EXAMPLES.md - 29K, 904 linhas - Exemplos práticos
05-IMPLEMENTATION_ROADMAP.md - 44K, 1743 linhas - Roadmap de implementação
hashed-riding-dove.md - 100K, 3220 linhas - Plano principal consolidado
Total: 271K de documentação, 9183 linhas de planejamento exaustivo e robusto!

O usuário agora tem acesso visual à pasta. Vou informar que todos os arquivos estão disponíveis no caminho /home/node/.claude/plans/ e podem ser acessados diretamente.

Perfeito! Aqui está o inventário completo da documentação criada:

📁 Localização dos Documentos
Caminho: /home/node/.claude/plans/

📊 Estatísticas Totais
6 arquivos criados
~271 KB de documentação
9.183 linhas de planejamento detalhado
📄 Documentos Criados
1. 01-MISSION_ARCHITECTURE.md (29 KB, 920 linhas)
Arquitetura hierárquica do sistema de missões:

Mission → Workflow → Tasks
Lifecycle completo
User supervision flows
Mission state schema
2. 02-AUTONOMOUS_EXECUTION.md (34 KB, 1.102 linhas)
Detalhes técnicos de execução autônoma:

Decomposição automática
Iterative execution pattern
Validation framework
Context management
Checkpoint recovery system
3. 03-FEEDBACK_LOOPS.md (35 KB, 1.294 linhas)
Mecanismos de feedback contínuo:

LLM→LLM (LLM-as-judge, self-critique)
Human→LLM (ratings, edits)
System→LLM (tests, linting)
Contextual learning
4. 04-MISSION_EXAMPLES.md (29 KB, 904 linhas)
5 exemplos práticos completos:

Book Writing (25h, $42.50)
API Development (11h)
Research Report (7h 45min)
Translation (5 languages)
Code Refactoring (jQuery → React)
5. 05-IMPLEMENTATION_ROADMAP.md (44 KB, 1.743 linhas) ✨
Roadmap de implementação de 17 semanas:

Semanas 1-5: Dashboard Enterprise
Semanas 6-17: Sistema de Orquestração
Tarefas dia-a-dia detalhadas
Entregáveis e critérios de aceite
Riscos e mitigações
6. hashed-riding-dove.md (100 KB, 3.220 linhas)
Plano principal consolidado:

Todas as seções integradas
Arquitetura completa
Directory structure
APIs e componentes
🔍 Como Acessar
Os documentos estão disponíveis no sistema de arquivos em:


/home/node/.claude/plans/
Você pode:

Ler diretamente no VS Code
Copiar para outro local
Gerar PDFs ou outros formatos
Compartilhar com a equipe
Todos os arquivos estão prontos e completos! Quer que eu prossiga para ExitPlanMode agora ou deseja alguma modificação adicional?
