# 🎯 Dashboard Architecture - Análise Completa e Proposta

**Data**: Fevereiro 2026 **Status**: ANÁLISE COMPLETA + PROPOSTA DE REBUILDING **Versão**: 1.0
(Analysis + Recommendations)

---

## 📋 Índice

1. [Resumo Executivo](#resumo-executivo)
2. [Estado Atual](#estado-atual)
3. [Arquitetura Existente](#arquitetura-existente)
4. [Análise Crítica](#análise-crítica)
5. [Proposta de Arquitetura](#proposta-de-arquitetura)
6. [Dark Theme Design System](#dark-theme-design-system)
7. [Roadmap de Implementação](#roadmap-de-implementação)
8. [Conclusões](#conclusões)

---

## 🎯 Resumo Executivo

### Situação Atual

O dashboard existe em **estado primitivo** com infraestrutura backend completa mas interface
frontend básica e não-funcional. Há **separação clara** entre frontend (Vue 3 app) e backend
(Express server), mas design light theme incompatível com requisito de "futuristic dark theme".

### Objetivo

**Rebuild completo** do dashboard mantendo arquitetura de separação existente, mas com:

- ✅ **Dark Theme Futurista** (sóbrio, não exagerado)
- ✅ **Task CRUD** como feature inicial
- ✅ **Indicadores Básicos** (métricas, health, alertas)
- ✅ **Comunicação NERV** via Socket.io + REST
- ✅ **Separação clara** Dashboard (UI) vs Server (Backend)

### Decisões Chave

| Aspecto           | Decisão                              | Justificativa                                  |
| ----------------- | ------------------------------------ | ---------------------------------------------- |
| **Node Folder**   | ✅ Manter separado                   | Isolamento de dependências, build independente |
| **Tech Stack**    | ✅ Vue 3 + Vite + Pinia              | Stack moderna, já configurado                  |
| **UI Library**    | 🔄 Element Plus → Shadcn/TailwindCSS | Mais controle sobre dark theme                 |
| **Communication** | ✅ Socket.io + REST                  | Realtime + CRUD operations                     |
| **Transport**     | ✅ NERV IPC → Adapter → Socket       | Já implementado, funcional                     |
| **Theme**         | ⚠️ Rebuilding Required               | Light → Dark theme completo                    |

---

## 📦 Estado Atual

### Estrutura de Pastas

```
src/
├── dashboard-ui/                  # Frontend (Vue 3 app) - SEPARADO
│   ├── public/                    # Static assets
│   ├── src/
│   │   ├── components/            # Vue components
│   │   │   ├── layout/           # AppLayout, Header, Sidebar
│   │   │   └── charts/           # GaugeChart, TimeSeriesChart
│   │   ├── views/                # Rotas principais
│   │   │   ├── Dashboard.vue     # ⚠️ PRIMITIVO - Metrics grid básico
│   │   │   ├── MissionDetail.vue
│   │   │   ├── WorkflowEditor.vue
│   │   │   └── SystemHealth.vue
│   │   ├── stores/               # Pinia stores
│   │   │   ├── tasks.js          # ✅ Task state management
│   │   │   ├── telemetry.js      # ✅ Metrics state
│   │   │   └── system.js         # ✅ System state
│   │   ├── composables/          # Composition API
│   │   │   ├── useSocket.js      # ✅ Socket.io client
│   │   │   └── useRealtime.js    # ✅ Realtime updates
│   │   ├── router/               # Vue Router
│   │   └── App.vue               # Root component
│   ├── package.json              # Separate npm project
│   ├── vite.config.js            # Vite config
│   └── index.html
│
└── server/                        # Backend (Express) - SEPARADO
    ├── main.js                    # ✅ Canonical bootstrap
    ├── api/
    │   ├── router.js              # ✅ API Gateway V700 (7 namespaces)
    │   └── controllers/
    │       ├── dashboard.js       # ✅ /api/dashboard/* (9+ endpoints)
    │       ├── tasks.js           # ✅ /api/tasks/*
    │       ├── missions.js        # ✅ /api/missions/*
    │       ├── system.js          # ✅ /api/system/*
    │       ├── health.js          # ✅ /api/health/*
    │       └── metrics.js         # ✅ /api/metrics/*
    ├── dashboard-api/             # Dashboard-specific bridges
    │   ├── task_sync_bridge.js    # ✅ Unified tasks (disk + kernel)
    │   └── telemetry_aggregator.js # ✅ Metrics aggregation (1Hz)
    ├── engine/
    │   ├── http_engine.js         # ✅ Express server
    │   └── socket.js              # ✅ Socket.io hub
    ├── nerv_adapter/
    │   └── server_nerv_adapter.js # ✅ Anti-corruption layer (IPC ↔ Socket)
    └── realtime/
        └── event_broadcaster.js   # ✅ NERV events → Socket broadcasts
```

### Tech Stack Atual

#### Frontend (dashboard-ui)

```json
{
  "dependencies": {
    "vue": "^3.5.24", // ✅ Framework
    "vue-router": "^4.5.0", // ✅ Routing
    "pinia": "^2.3.1", // ✅ State management
    "element-plus": "^2.13.1", // ⚠️ UI library (light theme bias)
    "socket.io-client": "^4.8.3", // ✅ Realtime communication
    "axios": "^1.7.9", // ✅ HTTP client
    "chart.js": "^4.4.8", // ✅ Charts
    "cytoscape": "^3.31.3", // ⚠️ Graph visualization (heavy)
    "d3": "^7.9.0", // ⚠️ Visualization (heavy)
    "vis-timeline": "^7.7.3" // ⚠️ Timeline (heavy)
  },
  "devDependencies": {
    "vite": "^7.2.4", // ✅ Build tool
    "@vitejs/plugin-vue": "^6.0.1" // ✅ Vue plugin
  }
}
```

**Análise**:

- ✅ **Stack sólido**: Vue 3 + Vite + Pinia é moderno e performático
- ⚠️ **Element Plus**: Boa biblioteca, mas difícil customizar dark theme
- ⚠️ **Libs pesadas**: cytoscape, d3, vis-timeline (>5MB bundle) - não usados na MVP
- 💡 **Recomendação**: Manter Vue/Vite/Pinia, considerar TailwindCSS + Shadcn para dark theme

#### Backend (server)

```javascript
// Dependências principais (do package.json raiz)
{
  "express": "^4.21.2",            // ✅ HTTP server
  "socket.io": "^4.8.1",            // ✅ WebSocket server
  "puppeteer": "^24.2.0",           // ✅ Browser automation
  "puppeteer-core": "^24.2.0"       // ✅ Lightweight puppeteer
}
```

**Análise**:

- ✅ **Stack estável**: Express + Socket.io é padrão de mercado
- ✅ **Separação limpa**: Backend não mistura com frontend
- ✅ **NERV integration**: Adapter pattern isolando IPC

---

## 🏗️ Arquitetura Existente

### Camadas e Responsabilidades

```
┌─────────────────────────────────────────────────────────────┐
│  CAMADA 1: DASHBOARD UI (Frontend - Vue 3 App)             │
├─────────────────────────────────────────────────────────────┤
│  • Views: Dashboard.vue, MissionDetail.vue, etc.           │
│  • Components: Layout, Charts, Forms                        │
│  • Stores (Pinia): tasks, telemetry, system                │
│  • Composables: useSocket, useRealtime                      │
│  • Router: Vue Router (SPA navigation)                      │
│  • Estado: Primitivo, light theme, layout básico           │
└─────────────────────────────────────────────────────────────┘
                             ↕
                    HTTP/WebSocket
                             ↕
┌─────────────────────────────────────────────────────────────┐
│  CAMADA 2: SERVER (Backend - Express + Socket.io)          │
├─────────────────────────────────────────────────────────────┤
│  • HTTP Engine: Express server (porta 2998)                │
│  • Socket Hub: Socket.io server (realtime)                 │
│  • API Gateway: router.js (7 namespaces)                   │
│  • Controllers: dashboard, tasks, missions, system, etc.   │
│  • Dashboard Bridges:                                       │
│    - task_sync_bridge.js (disk + kernel unification)       │
│    - telemetry_aggregator.js (metrics @ 1Hz)               │
│  • NERV Adapter: Anti-corruption layer                     │
└─────────────────────────────────────────────────────────────┘
                             ↕
                       NERV Events
                             ↕
┌─────────────────────────────────────────────────────────────┐
│  CAMADA 3: CORE SYSTEM (Kernel + Drivers + DNA)            │
├─────────────────────────────────────────────────────────────┤
│  • Kernel: execution_engine.js, kernel_loop.js             │
│  • Drivers: chatgpt/, gemini/                              │
│  • Queue: fila/ (JSON files)                               │
│  • DNA System: dynamic_rules.json, adaptive.js             │
│  • NERV: core.js (IPC backbone)                            │
└─────────────────────────────────────────────────────────────┘
```

### Fluxo de Comunicação

#### REST API (CRUD Operations)

```
Dashboard UI          →  HTTP Request  →  Server API Router
                                             ↓
                                       Controller (e.g., dashboard.js)
                                             ↓
                                       Bridges (task_sync_bridge)
                                             ↓
                                       Queue Cache (disk)
                                             ↓
                                       HTTP Response  →  Dashboard UI
```

**Endpoints Disponíveis** (`/api/dashboard/*`):

| Método | Endpoint                            | Descrição                       | Implementado |
| ------ | ----------------------------------- | ------------------------------- | ------------ |
| GET    | `/dashboard/tasks`                  | Lista unificada (disk + kernel) | ✅           |
| GET    | `/dashboard/tasks/:id`              | Task específica                 | ✅           |
| GET    | `/dashboard/tasks/:id/dependencies` | Dependencies graph              | ✅           |
| GET    | `/dashboard/tasks-stats`            | Estatísticas agregadas          | ✅           |
| GET    | `/dashboard/telemetry/current`      | Métricas atuais                 | ✅           |
| GET    | `/dashboard/telemetry/history`      | Histórico (1 hora)              | ✅           |
| GET    | `/dashboard/alerts`                 | Alertas ativos                  | ✅           |
| GET    | `/dashboard/system/health`          | Health checks (4 subsystems)    | ✅           |
| GET    | `/dashboard/system/info`            | System info                     | ✅           |

#### Realtime (WebSocket)

```
NERV Event Bus        →  NERV Adapter  →  Socket.io Broadcast
                                             ↓
                                       Dashboard UI (subscribes)
                                             ↓
                                       Pinia Store (updates)
                                             ↓
                                       Vue Reactivity (re-render)
```

**Eventos Socket.io**:

| Evento               | Origem     | Payload                        | Frequência    |
| -------------------- | ---------- | ------------------------------ | ------------- |
| `task:created`       | NERV       | `{ taskId, spec }`             | Por task      |
| `task:updated`       | NERV       | `{ taskId, status, progress }` | Por update    |
| `task:completed`     | NERV       | `{ taskId, result }`           | Por conclusão |
| `telemetry:snapshot` | Aggregator | `{ cpu, memory, heap, ... }`   | 1Hz (1/seg)   |
| `alert:raised`       | DNA System | `{ type, severity, message }`  | Por alerta    |
| `kernel:status`      | Kernel     | `{ idle, busy, queue_size }`   | Por mudança   |

### Componentes Chave

#### 1. TaskSyncBridge (Backend)

**Arquivo**: `src/server/dashboard-api/task_sync_bridge.js` (406 linhas)

**Responsabilidade**: Unificar duas fontes de verdade

- **Queue Cache (disco)**: Tarefas persistidas em JSON (`fila/`)
- **Kernel Runtime (memória)**: Estado de execução em tempo real

**Métodos Principais**:

```javascript
class TaskSyncBridge extends EventEmitter {
    // Inicialização
    initialize({ socketHub, nervClient })

    // API Principal
    async getUnifiedTasks()          // Lista unificada
    async getTaskById(taskId)        // Task específica
    getKernelStateCache()            // Estado runtime do Kernel

    // Updates em tempo real
    _handleNervTaskUpdate(event)     // Escuta NERV events
    _broadcastTaskUpdate(taskId)     // Notifica dashboards via Socket
}
```

**Estados Unificados**:

```javascript
const UnifiedStatus = {
  PENDING: 'PENDING', // Na fila, aguardando
  RUNNING: 'RUNNING', // Em execução
  PAUSED: 'PAUSED', // Suspenso
  DONE: 'DONE', // Concluído
  FAILED: 'FAILED', // Falhou
  CANCELLED: 'CANCELLED', // Cancelado
};
```

**Arquitetura**:

- ✅ **Singleton pattern** para acesso global
- ✅ **Event-driven** para updates em tempo real
- ✅ **Cache local** para performance
- ✅ **Debounced broadcasts** para evitar spam

#### 2. TelemetryAggregator (Backend)

**Arquivo**: `src/server/dashboard-api/telemetry_aggregator.js` (531 linhas)

**Responsabilidade**: Coletar e agregar métricas de sistema

**Ring Buffers** (3600 amostras = 1 hora @ 1Hz):

- `cpuHistory`: CPU usage (%)
- `memoryHistory`: Memory usage (MB)
- `heapHistory`: Heap usage (MB)
- `eventLoopLagHistory`: Event loop lag (ms)
- `nervLatencyHistory`: NERV latency (ms)
- `nervThroughputHistory`: NERV throughput (events/s)

**Coleta**:

```javascript
// Coleta a 1Hz (1 amostra/segundo)
setInterval(() => {
  // Hardware
  const cpu = hardware.getCPU();
  const memory = hardware.getMemory();
  const heap = hardware.getHeapUsage();

  // NERV
  const nervStats = nervClient.getStats();

  // Queue
  const queueStats = queueCache.getStats();

  // Agregação
  aggregator.collect({ cpu, memory, heap, nervStats, queueStats });
}, 1000);
```

**Alertas**:

```javascript
// Thresholds configuráveis
const ALERT_THRESHOLDS = {
  CPU_HIGH: 80, // CPU > 80%
  MEMORY_HIGH: 4096, // Memory > 4GB
  HEAP_HIGH: 1536, // Heap > 1.5GB
  EVENT_LOOP_LAG: 100, // Lag > 100ms
  NERV_LATENCY: 500, // Latency > 500ms
};
```

#### 3. NERV Adapter (Backend)

**Arquivo**: `src/server/nerv_adapter/server_nerv_adapter.js` (383 linhas)

**Responsabilidade**: Anti-corruption layer entre NERV (IPC) e Socket.io (WebSocket)

**Invariantes** (Audit Level 900):

- ❌ NO business logic
- ❌ NO Kernel/Driver imports
- ❌ NO filesystem access
- ✅ Pure routing: NERV events → Socket broadcasts
- ✅ Security: Filter private events (`KERNEL_INTERNAL_ERROR`, `SECURITY_VIOLATION`)

**Tradução de Eventos**:

```javascript
// NERV → Socket
nerv.on('TASK_UPDATED', event => {
  // Anti-corruption: translate event structure
  const socketPayload = {
    taskId: event.payload.taskId,
    status: event.payload.status,
    progress: event.payload.progress,
    timestamp: event.timestamp,
  };

  // Broadcast via Socket.io
  socketHub.broadcast('task:updated', socketPayload);
});

// Socket → NERV
socket.on('dashboard:execute_task', payload => {
  // Anti-corruption: translate to NERV action
  nerv.emit({
    type: 'DRIVER_EXECUTE',
    action: 'EXECUTE',
    payload: {
      taskId: payload.taskId,
      // ... translation
    },
  });
});
```

#### 4. Task Store (Frontend)

**Arquivo**: `src/dashboard-ui/src/stores/tasks.js` (325 linhas)

**Responsabilidade**: State management de tasks no dashboard

**State**:

```javascript
state: () => ({
  tasks: [], // Lista de tasks
  selectedTaskId: null, // Task selecionada
  filters: {
    // Filtros ativos
    status: null,
    priority: null,
    search: '',
  },
  loading: false, // Loading state
  error: null, // Error state
  stats: {
    // Estatísticas
    total: 0,
    by_status: {},
    by_priority: {},
  },
  lastUpdate: null, // Última atualização
});
```

**Getters**:

```javascript
getters: {
    // Tasks filtradas conforme filtros ativos
    filteredTasks: (state) => { /* ... */ },

    // Tasks em execução
    runningTasks: (state) =>
        state.tasks.filter(t => t.unified_status === 'RUNNING'),

    // Tasks pendentes
    pendingTasks: (state) =>
        state.tasks.filter(t => t.unified_status === 'PENDING'),

    // Task selecionada
    selectedTask: (state) =>
        state.tasks.find(t => t.meta?.id === state.selectedTaskId)
}
```

**Actions**:

```javascript
actions: {
    // Carregar tasks da API
    async fetchTasks() {
        this.loading = true;
        try {
            const response = await axios.get('/api/dashboard/tasks', {
                params: this.filters
            });
            this.tasks = response.data.tasks;
            this.stats = response.data.stats || {};
            this.lastUpdate = Date.now();
        } catch (error) {
            this.error = error.message;
        } finally {
            this.loading = false;
        }
    },

    // Aplicar filtros
    setFilter(key, value) {
        this.filters[key] = value;
        this.fetchTasks(); // Recarregar com filtros novos
    },

    // Selecionar task
    selectTask(taskId) {
        this.selectedTaskId = taskId;
    },

    // Update via Socket.io
    handleRealtimeUpdate(payload) {
        // Atualizar task no state
        const index = this.tasks.findIndex(t => t.meta?.id === payload.taskId);
        if (index !== -1) {
            this.tasks[index] = {
                ...this.tasks[index],
                ...payload
            };
        }
    }
}
```

#### 5. useSocket Composable (Frontend)

**Arquivo**: `src/dashboard-ui/src/composables/useSocket.js` (145 linhas)

**Responsabilidade**: Gerenciar conexão Socket.io com backend

**Singleton Pattern**:

```javascript
// Singleton da conexão Socket.io
let socketInstance = null;
let connectionCount = 0;

function getSocketInstance(url = '', options = {}) {
  if (!socketInstance) {
    socketInstance = io(url, {
      transports: ['websocket'],
      autoConnect: false,
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
      ...options,
    });
  }
  return socketInstance;
}
```

**API do Composable**:

```javascript
export function useSocket(options = {}) {
  const socket = getSocketInstance(options.url || '', options);
  const isConnected = ref(false);
  const error = ref(null);
  const reconnectAttempts = ref(0);

  return {
    // Estado reativo
    isConnected,
    error,
    reconnectAttempts,

    // Métodos
    connect: () => {
      /* ... */
    },
    disconnect: () => {
      /* ... */
    },
    subscribe: (event, handler) => {
      /* ... */
    },
    unsubscribe: (event, handler) => {
      /* ... */
    },
    emit: (event, data) => {
      /* ... */
    },
  };
}
```

**Uso em Components**:

```vue
<script setup>
import { onMounted, onUnmounted } from 'vue';
import { useSocket } from '@/composables/useSocket';
import { useTaskStore } from '@/stores/tasks';

const { isConnected, subscribe, unsubscribe, connect, disconnect } = useSocket();
const taskStore = useTaskStore();

// Handler para updates de task
const handleTaskUpdate = payload => {
  taskStore.handleRealtimeUpdate(payload);
};

onMounted(() => {
  connect();
  subscribe('task:updated', handleTaskUpdate);
});

onUnmounted(() => {
  unsubscribe('task:updated', handleTaskUpdate);
  disconnect();
});
</script>

<template>
  <div v-if="isConnected" class="online-indicator">🟢 Connected</div>
  <div v-else class="offline-indicator">🔴 Disconnected</div>
</template>
```

---

## 🔍 Análise Crítica

### ✅ Pontos Fortes

#### 1. Separação de Concerns (EXCELENTE)

- ✅ **Frontend isolado**: `dashboard-ui/` como Vue app separado
- ✅ **Backend isolado**: `server/` com API, controllers, bridges
- ✅ **Zero acoplamento direto**: Comunicação via HTTP/WebSocket apenas
- ✅ **Builds independentes**: Frontend (Vite) e Backend (Node) separados

#### 2. Arquitetura Backend (SÓLIDA)

- ✅ **API Gateway**: Router.js com 7 namespaces organizados
- ✅ **Controllers**: Separação por domínio (dashboard, tasks, missions, etc.)
- ✅ **Bridges**: task_sync_bridge e telemetry_aggregator implementados
- ✅ **NERV Adapter**: Anti-corruption layer limpa (Audit 900)
- ✅ **Socket Hub**: Realtime funcionando via Socket.io

#### 3. Infraestrutura de Dados (ROBUSTA)

- ✅ **Unified State**: task_sync_bridge unifica disk + kernel
- ✅ **Ring Buffers**: 1 hora de histórico @ 1Hz (eficiente)
- ✅ **Alertas**: Thresholds configuráveis
- ✅ **Debounced Broadcasts**: Evita spam de eventos

#### 4. Tech Stack Moderno (ADEQUADO)

- ✅ **Vue 3**: Framework moderno e performático
- ✅ **Vite**: Build rápido e eficiente
- ✅ **Pinia**: State management simples e type-safe
- ✅ **Socket.io**: Realtime estável e confiável

### ⚠️ Problemas Identificados

#### 1. Interface Primitiva (CRÍTICO)

- ❌ **Layout básico**: Dashboard.vue é grade simples de métricas
- ❌ **Light theme**: Background #f5f5f5 (contrasta com requisito "dark theme")
- ❌ **Não-funcional**: Várias views vazias ou incompletas
- ❌ **Poor UX**: Sem navegação intuitiva, sem hierarquia visual

**Exemplo de código primitivo** (Dashboard.vue):

```vue
<!-- Current primitive implementation -->
<div class="metrics-grid">
    <div class="metric-card">
        <h3>Heap Usage</h3>
        <div>{{ metrics.heap }}MB</div>
    </div>
    <div class="metric-card">
        <h3>Memory</h3>
        <div>{{ metrics.memory }}MB</div>
    </div>
    <!-- Repetido 4x... -->
</div>

<style scoped>
.metrics-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 16px; /* Layout genérico */
}

.metric-card {
    background: white; /* ❌ Light theme */
    padding: 20px;
    border-radius: 8px;
}
</style>
```

#### 2. Element Plus Dependency (LIMITAÇÃO)

- ⚠️ **Dark theme limitado**: Element Plus tem suporte, mas não futurista
- ⚠️ **Customização difícil**: Precisa override de variáveis CSS complexas
- ⚠️ **Bundle size**: 500KB+ (componentes não tree-shakeable)

#### 3. Libs Pesadas Não Usadas (INEFICIÊNCIA)

- ❌ **cytoscape** (700KB): Não usado em MVP
- ❌ **d3** (300KB): Não usado em MVP
- ❌ **vis-timeline** (200KB): Não usado em MVP
- 💡 Total de ~1.2MB de código não utilizado

#### 4. Falta de Design System (INCONSISTÊNCIA)

- ❌ **Cores hardcoded**: `#f5f5f5`, `#ffffff`, `#34495e` espalhados
- ❌ **Spacing arbitrário**: `padding: 20px`, `gap: 16px` sem padrão
- ❌ **Sem tokens**: Cores, fontes, spacing não centralizados
- ❌ **Tipografia básica**: Sem hierarquia, sem scales

#### 5. Responsividade Ausente (PROBLEMA)

- ❌ **Grid fixo**: `repeat(4, 1fr)` quebra em mobile
- ❌ **Sem breakpoints**: Nenhum media query
- ❌ **Sidebar não responsiva**: Sempre visível, não collapsa

### 🎯 Gaps vs Requisitos

| Requisito                      | Estado Atual                 | Gap                                       |
| ------------------------------ | ---------------------------- | ----------------------------------------- |
| **Dark Theme Futurista**       | ❌ Light theme (#f5f5f5)     | **CRÍTICO** - Rebuild completo necessário |
| **Task CRUD**                  | 🟡 API pronta, UI incompleta | **ALTO** - Criar forms, modals, actions   |
| **Indicadores Básicos**        | 🟡 Métricas brutas mostradas | **MÉDIO** - Melhorar visualização         |
| **Comunicação NERV**           | ✅ Implementado via adapter  | **ZERO** - Funcional                      |
| **Separação Dashboard/Server** | ✅ Arquitetura limpa         | **ZERO** - Funcional                      |
| **Sóbrio mas Futurista**       | ❌ Primitivo e light         | **CRÍTICO** - Design system necessário    |

---

## 🎨 Proposta de Arquitetura

### Decisões Estratégicas

#### 1. Manter Node Folder Separado ✅

**Justificativa**:

- ✅ **Isolamento**: Dependencies do dashboard não poluem backend
- ✅ **Build independente**: Vite build roda separado de PM2
- ✅ **Deploy flexível**: Frontend pode ir para CDN, backend para server
- ✅ **Dev experience**: `npm run dev` no dashboard não interfere com backend

**Estrutura Proposta**:

```
src/
├── dashboard-ui/              # Frontend (Vue 3 app) - SEPARADO
│   ├── package.json           # Separate dependencies
│   ├── vite.config.js
│   ├── src/
│   └── dist/                  # Build output
│
└── server/                    # Backend (Express) - SEPARADO
    ├── main.js
    ├── api/
    └── dashboard-api/
```

**Build Process**:

```bash
# 1. Build frontend (production)
cd src/dashboard-ui
npm run build                   # Output: dist/

# 2. Server serve arquivos estáticos
# src/server/main.js
app.use('/dashboard', express.static(path.join(__dirname, '../dashboard-ui/dist')));

# 3. PM2 gerencia apenas backend
pm2 start ecosystem.config.js   # Server process
```

#### 2. Substituir Element Plus por TailwindCSS + Shadcn-Vue 🔄

**Justificativa**:

- ✅ **Dark theme nativo**: Tailwind tem excelente suporte (dark:)
- ✅ **Customização total**: Utility-first, sem overrides complexos
- ✅ **Bundle menor**: Tree-shaking agressivo (~50KB vs 500KB)
- ✅ **Design system**: Tokens centralizados (tailwind.config.js)
- ✅ **Shadcn-Vue**: Componentes headless, 100% customizáveis

**Migration Path**:

```bash
# 1. Instalar Tailwind + Shadcn-Vue
npm install -D tailwindcss postcss autoprefixer
npm install @shadcn/vue

# 2. Remover Element Plus
npm uninstall element-plus

# 3. Configurar tailwind.config.js (Dark theme)
module.exports = {
    darkMode: 'class',
    theme: {
        extend: {
            colors: {
                // Dark theme palette
                background: '#0a0e1a',
                foreground: '#e2e8f0',
                // ... design system
            }
        }
    }
}

# 4. Migrar componentes (gradual)
# AppLayout.vue: <el-container> → <div class="flex ...">
# Dashboard.vue: <el-card> → <Card> (Shadcn)
```

#### 3. Remover Libs Pesadas Não Usadas ❌

**Justificativa**:

- ❌ cytoscape: Não usado em MVP (graph viz para futuro)
- ❌ d3: Não usado em MVP (use Chart.js apenas)
- ❌ vis-timeline: Não usado em MVP (timeline para futuro)
- 💡 **Economia**: ~1.2MB menos no bundle

**Package.json Limpo**:

```json
{
  "dependencies": {
    "vue": "^3.5.24", // ✅ Keep
    "vue-router": "^4.5.0", // ✅ Keep
    "pinia": "^2.3.1", // ✅ Keep
    "socket.io-client": "^4.8.3", // ✅ Keep
    "axios": "^1.7.9", // ✅ Keep
    "chart.js": "^4.4.8", // ✅ Keep (para graphs)
    "@shadcn/vue": "^1.0.0", // ✅ Add (componentes)
    "tailwindcss": "^3.4.0" // ✅ Add (styling)

    // ❌ Remover
    // "element-plus": "^2.13.1",   // → Substituído por Shadcn
    // "cytoscape": "^3.31.3",      // → Remover (não usado)
    // "d3": "^7.9.0",              // → Remover (não usado)
    // "vis-timeline": "^7.7.3"     // → Remover (não usado)
  }
}
```

#### 4. Manter Vue 3 + Vite + Pinia ✅

**Justificativa**:

- ✅ **Stack moderna**: Vue 3 com Composition API é performático
- ✅ **Vite rápido**: HMR instantâneo, build eficiente
- ✅ **Pinia simples**: State management sem boilerplate
- ✅ **Já configurado**: Não há razão para trocar

#### 5. Manter Socket.io + REST ✅

**Justificativa**:

- ✅ **REST para CRUD**: GET/POST/PATCH/DELETE tasks
- ✅ **Socket para Realtime**: Métricas @ 1Hz, task updates
- ✅ **NERV integration**: Adapter funcional
- ✅ **Fallback**: REST sempre disponível se Socket cair

### Nova Estrutura de Componentes

```
src/dashboard-ui/src/
├── components/
│   ├── ui/                        # Shadcn components (design system)
│   │   ├── Button.vue
│   │   ├── Card.vue
│   │   ├── Input.vue
│   │   ├── Modal.vue
│   │   ├── Badge.vue
│   │   └── Alert.vue
│   ├── layout/                    # Layout components
│   │   ├── AppLayout.vue          # ✅ Rebuild (dark theme)
│   │   ├── Header.vue             # ✅ Rebuild (nav + actions)
│   │   ├── Sidebar.vue            # ✅ Rebuild (collapsible)
│   │   └── Footer.vue             # ✅ New
│   ├── tasks/                     # Task-specific components
│   │   ├── TaskList.vue           # ✅ Rebuild (table + filters)
│   │   ├── TaskCard.vue           # ✅ New (card view)
│   │   ├── TaskDetail.vue         # ✅ New (modal/panel)
│   │   ├── TaskForm.vue           # ✅ New (create/edit)
│   │   └── TaskFilters.vue        # ✅ New (status, priority, search)
│   ├── metrics/                   # Metrics components
│   │   ├── MetricsGrid.vue        # ✅ Rebuild (gauges + sparklines)
│   │   ├── MetricCard.vue         # ✅ New (reusable card)
│   │   ├── GaugeChart.vue         # ✅ Keep (melhorar)
│   │   └── SparklineChart.vue     # ✅ New (mini charts)
│   └── alerts/                    # Alerts components
│       ├── AlertBanner.vue        # ✅ New (top banner)
│       └── AlertList.vue          # ✅ New (alert center)
│
├── views/                         # Route views
│   ├── Dashboard.vue              # ✅ Rebuild (MVP: Tasks + Metrics)
│   ├── TasksView.vue              # ✅ New (full task management)
│   ├── MetricsView.vue            # ✅ New (full metrics dashboard)
│   ├── SystemHealthView.vue       # 🔜 Futuro (health checks)
│   └── NotFound.vue               # ✅ New (404 page)
│
├── stores/                        # Pinia stores (keep)
│   ├── tasks.js                   # ✅ Manter (já funcional)
│   ├── telemetry.js               # ✅ Manter (já funcional)
│   └── system.js                  # ✅ Manter (já funcional)
│
├── composables/                   # Composition API (keep)
│   ├── useSocket.js               # ✅ Manter (já funcional)
│   └── useRealtime.js             # ✅ Manter (já funcional)
│
├── router/                        # Vue Router
│   └── index.js                   # ✅ Rebuild (rotas MVP)
│
├── assets/                        # Static assets
│   ├── styles/
│   │   ├── tailwind.css           # ✅ New (Tailwind base)
│   │   └── dark-theme.css         # ✅ New (custom dark tokens)
│   └── icons/                     # ✅ New (SVG icons)
│
├── App.vue                        # ✅ Rebuild (dark theme wrapper)
└── main.js                        # ✅ Update (Tailwind import)
```

### Rotas MVP

```javascript
// src/dashboard-ui/src/router/index.js
import { createRouter, createWebHistory } from 'vue-router';

const routes = [
  {
    path: '/dashboard',
    component: AppLayout,
    children: [
      {
        path: '',
        name: 'Dashboard',
        component: () => import('@/views/Dashboard.vue'),
        meta: { title: 'Dashboard - Mission Control' },
      },
      {
        path: 'tasks',
        name: 'Tasks',
        component: () => import('@/views/TasksView.vue'),
        meta: { title: 'Tasks - Mission Control' },
      },
      {
        path: 'tasks/:id',
        name: 'TaskDetail',
        component: () => import('@/components/tasks/TaskDetail.vue'),
        meta: { title: 'Task Detail - Mission Control' },
      },
      {
        path: 'metrics',
        name: 'Metrics',
        component: () => import('@/views/MetricsView.vue'),
        meta: { title: 'Metrics - Mission Control' },
      },
    ],
  },
  {
    path: '/:pathMatch(.*)*',
    name: 'NotFound',
    component: () => import('@/views/NotFound.vue'),
  },
];

const router = createRouter({
  history: createWebHistory('/'),
  routes,
});

// Navigation guards
router.beforeEach((to, from, next) => {
  document.title = to.meta.title || 'Mission Control';
  next();
});

export default router;
```

---

## 🎨 Dark Theme Design System

### Color Palette (Futuristic + Sober)

```javascript
// tailwind.config.js
module.exports = {
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Background layers
        background: {
          DEFAULT: '#0a0e1a', // Deep navy (fundo principal)
          secondary: '#111827', // Slate darker (cards)
          tertiary: '#1e293b', // Slate dark (hover states)
        },

        // Foreground (text)
        foreground: {
          DEFAULT: '#e2e8f0', // Slate 200 (texto principal)
          muted: '#94a3b8', // Slate 400 (texto secundário)
          subtle: '#64748b', // Slate 500 (texto terciário)
        },

        // Primary (accent)
        primary: {
          DEFAULT: '#3b82f6', // Blue 500 (ações principais)
          hover: '#2563eb', // Blue 600 (hover)
          active: '#1d4ed8', // Blue 700 (active)
          muted: '#1e3a8a', // Blue 900 (backgrounds)
        },

        // Status colors
        success: {
          DEFAULT: '#10b981', // Green 500
          muted: '#065f46', // Green 900
        },
        warning: {
          DEFAULT: '#f59e0b', // Amber 500
          muted: '#78350f', // Amber 900
        },
        error: {
          DEFAULT: '#ef4444', // Red 500
          muted: '#7f1d1d', // Red 900
        },
        info: {
          DEFAULT: '#06b6d4', // Cyan 500
          muted: '#164e63', // Cyan 900
        },

        // Borders
        border: {
          DEFAULT: '#334155', // Slate 700 (borders padrão)
          subtle: '#1e293b', // Slate 800 (borders sutis)
        },

        // Chart colors (accessibility-friendly)
        chart: {
          1: '#3b82f6', // Blue
          2: '#10b981', // Green
          3: '#f59e0b', // Amber
          4: '#ef4444', // Red
          5: '#8b5cf6', // Purple
          6: '#06b6d4', // Cyan
        },
      },

      // Typography
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['Fira Code', 'Courier New', 'monospace'],
      },

      // Spacing (8px base)
      spacing: {
        18: '4.5rem', // 72px
        88: '22rem', // 352px
        112: '28rem', // 448px
      },

      // Border radius
      borderRadius: {
        lg: '0.75rem', // 12px
        xl: '1rem', // 16px
        '2xl': '1.5rem', // 24px
      },

      // Box shadows (dark theme)
      boxShadow: {
        sm: '0 1px 2px 0 rgba(0, 0, 0, 0.5)',
        DEFAULT: '0 1px 3px 0 rgba(0, 0, 0, 0.5), 0 1px 2px -1px rgba(0, 0, 0, 0.5)',
        md: '0 4px 6px -1px rgba(0, 0, 0, 0.5), 0 2px 4px -2px rgba(0, 0, 0, 0.5)',
        lg: '0 10px 15px -3px rgba(0, 0, 0, 0.5), 0 4px 6px -4px rgba(0, 0, 0, 0.5)',
        xl: '0 20px 25px -5px rgba(0, 0, 0, 0.5), 0 8px 10px -6px rgba(0, 0, 0, 0.5)',
        glow: '0 0 20px rgba(59, 130, 246, 0.3)', // Blue glow
      },

      // Animations
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'bounce-slow': 'bounce 2s infinite',
        'fade-in': 'fadeIn 0.3s ease-in-out',
      },

      keyframes: {
        fadeIn: {
          '0%': { opacity: '0', transform: 'translateY(-10px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
    },
  },
  plugins: [
    require('@tailwindcss/forms'), // Form styling
    require('@tailwindcss/typography'), // Prose classes
  ],
};
```

### Typography Scale

```css
/* src/dashboard-ui/src/assets/styles/dark-theme.css */

/* Base typography */
:root {
  /* Font sizes (1.250 ratio - Major Third) */
  --text-xs: 0.75rem; /* 12px */
  --text-sm: 0.875rem; /* 14px */
  --text-base: 1rem; /* 16px */
  --text-lg: 1.25rem; /* 20px */
  --text-xl: 1.5rem; /* 24px */
  --text-2xl: 1.875rem; /* 30px */
  --text-3xl: 2.25rem; /* 36px */

  /* Line heights */
  --leading-tight: 1.25;
  --leading-normal: 1.5;
  --leading-relaxed: 1.75;

  /* Font weights */
  --font-normal: 400;
  --font-medium: 500;
  --font-semibold: 600;
  --font-bold: 700;
}

/* Heading classes */
.h1 {
  font-size: var(--text-3xl);
  font-weight: var(--font-bold);
  line-height: var(--leading-tight);
  color: theme('colors.foreground.DEFAULT');
}

.h2 {
  font-size: var(--text-2xl);
  font-weight: var(--font-semibold);
  line-height: var(--leading-tight);
  color: theme('colors.foreground.DEFAULT');
}

.h3 {
  font-size: var(--text-xl);
  font-weight: var(--font-semibold);
  line-height: var(--leading-normal);
  color: theme('colors.foreground.DEFAULT');
}

/* Body classes */
.body-lg {
  font-size: var(--text-lg);
  line-height: var(--leading-relaxed);
  color: theme('colors.foreground.DEFAULT');
}

.body {
  font-size: var(--text-base);
  line-height: var(--leading-normal);
  color: theme('colors.foreground.DEFAULT');
}

.body-sm {
  font-size: var(--text-sm);
  line-height: var(--leading-normal);
  color: theme('colors.foreground.muted');
}

/* Monospace (código) */
.mono {
  font-family: theme('fontFamily.mono');
  font-size: var(--text-sm);
  color: theme('colors.foreground.DEFAULT');
  background-color: theme('colors.background.tertiary');
  padding: 0.125rem 0.375rem;
  border-radius: 0.25rem;
}
```

### Component Tokens

```css
/* Component-specific styling */

/* Cards */
.card {
  background-color: theme('colors.background.secondary');
  border: 1px solid theme('colors.border.DEFAULT');
  border-radius: theme('borderRadius.lg');
  box-shadow: theme('boxShadow.md');
  padding: theme('spacing.6');
}

.card:hover {
  border-color: theme('colors.primary.DEFAULT');
  box-shadow: theme('boxShadow.glow');
  transition: all 0.2s ease;
}

/* Buttons */
.btn-primary {
  background-color: theme('colors.primary.DEFAULT');
  color: white;
  padding: theme('spacing.2') theme('spacing.4');
  border-radius: theme('borderRadius.DEFAULT');
  font-weight: theme('fontWeight.medium');
  transition: background-color 0.2s ease;
}

.btn-primary:hover {
  background-color: theme('colors.primary.hover');
}

.btn-primary:active {
  background-color: theme('colors.primary.active');
}

/* Badges */
.badge {
  display: inline-block;
  padding: theme('spacing.1') theme('spacing.2');
  font-size: var(--text-xs);
  font-weight: theme('fontWeight.medium');
  border-radius: theme('borderRadius.DEFAULT');
}

.badge-success {
  background-color: theme('colors.success.muted');
  color: theme('colors.success.DEFAULT');
}

.badge-warning {
  background-color: theme('colors.warning.muted');
  color: theme('colors.warning.DEFAULT');
}

.badge-error {
  background-color: theme('colors.error.muted');
  color: theme('colors.error.DEFAULT');
}

/* Inputs */
.input {
  background-color: theme('colors.background.tertiary');
  border: 1px solid theme('colors.border.DEFAULT');
  color: theme('colors.foreground.DEFAULT');
  padding: theme('spacing.2') theme('spacing.3');
  border-radius: theme('borderRadius.DEFAULT');
  font-size: var(--text-sm);
  transition: border-color 0.2s ease;
}

.input:focus {
  border-color: theme('colors.primary.DEFAULT');
  outline: none;
  box-shadow: 0 0 0 3px theme('colors.primary.muted');
}

.input::placeholder {
  color: theme('colors.foreground.subtle');
}
```

### Layout Mockup (ASCII)

```
╔═══════════════════════════════════════════════════════════════════════╗
║ [☰] Mission Control             [🔍] Search     [🔔] Alerts  [@] User ║
╠═══════════════════════════════════════════════════════════════════════╣
║          │                                                             ║
║  MENU    │  ┌──────────────────────────────────────────────────────┐  ║
║          │  │ Dashboard                                     [+ New] │  ║
║  [📊]    │  ├──────────────────────────────────────────────────────┤  ║
║  Tasks   │  │ ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐        │  ║
║          │  │ │  CPU   │ │ Memory │ │  Heap  │ │  Tasks │        │  ║
║  [📈]    │  │ │  24%   │ │ 1.2GB  │ │ 512MB  │ │   12   │        │  ║
║  Metrics │  │ │ ━━━━━  │ │ ━━━━━  │ │ ━━━━━  │ │ ━━━━━  │        │  ║
║          │  │ └────────┘ └────────┘ └────────┘ └────────┘        │  ║
║  [🏥]    │  │                                                       │  ║
║  Health  │  │ ┌────────────────────────────────────────────────┐  │  ║
║          │  │ │ Tasks                    [Filter ▾] [Search🔍] │  │  ║
║  [⚙️]    │  │ ├────────────────────────────────────────────────┤  │  ║
║  System  │  │ │ [●] Task #123          RUNNING    HIGH         │  │  ║
║          │  │ │     Generate report...                         │  │  ║
║          │  │ │                                                 │  │  ║
║          │  │ │ [○] Task #122          PENDING    MEDIUM       │  │  ║
║          │  │ │     Analyze data...                            │  │  ║
║          │  │ │                                                 │  │  ║
║          │  │ │ [✓] Task #121          DONE      HIGH          │  │  ║
║          │  │ │     Export results...                          │  │  ║
║          │  │ └────────────────────────────────────────────────┘  │  ║
║          │  └──────────────────────────────────────────────────────┘  ║
║          │                                                             ║
╠══════════╧═════════════════════════════════════════════════════════════╣
║ v2.0 | Connected 🟢 | Last update: 2s ago                             ║
╚═══════════════════════════════════════════════════════════════════════╝

Cores:
- Background: #0a0e1a (deep navy)
- Cards: #111827 (slate darker)
- Text: #e2e8f0 (slate 200)
- Accent: #3b82f6 (blue 500)
- Borders: #334155 (slate 700)
```

### Component Examples (Shadcn-Vue + Tailwind)

#### Button Component

```vue
<!-- src/dashboard-ui/src/components/ui/Button.vue -->
<template>
  <button
    :class="[
      'btn',
      variantClasses[variant],
      sizeClasses[size],
      disabled && 'opacity-50 cursor-not-allowed',
    ]"
    :disabled="disabled"
    @click="$emit('click', $event)"
  >
    <slot />
  </button>
</template>

<script setup>
const props = defineProps({
  variant: {
    type: String,
    default: 'primary',
    validator: v => ['primary', 'secondary', 'ghost', 'danger'].includes(v),
  },
  size: {
    type: String,
    default: 'md',
    validator: v => ['sm', 'md', 'lg'].includes(v),
  },
  disabled: {
    type: Boolean,
    default: false,
  },
});

const variantClasses = {
  primary: 'bg-primary hover:bg-primary-hover text-white',
  secondary:
    'bg-background-secondary hover:bg-background-tertiary text-foreground border border-border',
  ghost: 'hover:bg-background-secondary text-foreground-muted hover:text-foreground',
  danger: 'bg-error hover:bg-error/90 text-white',
};

const sizeClasses = {
  sm: 'px-3 py-1.5 text-sm',
  md: 'px-4 py-2 text-base',
  lg: 'px-6 py-3 text-lg',
};
</script>

<style scoped>
.btn {
  @apply rounded-lg font-medium transition-all duration-200;
  @apply focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 focus:ring-offset-background;
}
</style>
```

#### Card Component

```vue
<!-- src/dashboard-ui/src/components/ui/Card.vue -->
<template>
  <div
    :class="[
      'card',
      hoverable && 'hover:border-primary hover:shadow-glow cursor-pointer',
      className,
    ]"
  >
    <div v-if="$slots.header" class="card-header">
      <slot name="header" />
    </div>

    <div class="card-body">
      <slot />
    </div>

    <div v-if="$slots.footer" class="card-footer">
      <slot name="footer" />
    </div>
  </div>
</template>

<script setup>
defineProps({
  hoverable: {
    type: Boolean,
    default: false,
  },
  className: {
    type: String,
    default: '',
  },
});
</script>

<style scoped>
.card {
  @apply bg-background-secondary border border-border rounded-lg shadow-md;
  @apply transition-all duration-200;
}

.card-header {
  @apply px-6 py-4 border-b border-border;
}

.card-body {
  @apply px-6 py-4;
}

.card-footer {
  @apply px-6 py-4 border-t border-border;
}
</style>
```

#### Badge Component

```vue
<!-- src/dashboard-ui/src/components/ui/Badge.vue -->
<template>
  <span :class="['badge', variantClasses[variant], sizeClasses[size]]">
    <slot />
  </span>
</template>

<script setup>
defineProps({
  variant: {
    type: String,
    default: 'default',
    validator: v => ['default', 'success', 'warning', 'error', 'info'].includes(v),
  },
  size: {
    type: String,
    default: 'md',
    validator: v => ['sm', 'md', 'lg'].includes(v),
  },
});

const variantClasses = {
  default: 'bg-background-tertiary text-foreground-muted',
  success: 'bg-success-muted text-success',
  warning: 'bg-warning-muted text-warning',
  error: 'bg-error-muted text-error',
  info: 'bg-info-muted text-info',
};

const sizeClasses = {
  sm: 'px-2 py-0.5 text-xs',
  md: 'px-2.5 py-1 text-sm',
  lg: 'px-3 py-1.5 text-base',
};
</script>

<style scoped>
.badge {
  @apply inline-flex items-center justify-center rounded-md font-medium;
}
</style>
```

---

## 🚀 Roadmap de Implementação

### Fase 1: Setup & Cleanup (2-3 dias)

#### 1.1 Remove Libs Pesadas

```bash
cd src/dashboard-ui
npm uninstall element-plus cytoscape d3 vis-timeline
```

#### 1.2 Instalar Tailwind + Shadcn

```bash
npm install -D tailwindcss postcss autoprefixer
npx tailwindcss init -p

# Shadcn-Vue (componentes headless)
npm install @shadcn/vue
npx shadcn-vue@latest init
```

#### 1.3 Configurar tailwind.config.js

- Copiar paleta de cores (dark theme)
- Adicionar custom shadows, animations
- Configurar plugins (forms, typography)

#### 1.4 Criar Design System Base

- `src/assets/styles/tailwind.css` (base imports)
- `src/assets/styles/dark-theme.css` (custom tokens)
- Configurar `main.js` com imports

### Fase 2: Componentes Base (3-4 dias)

#### 2.1 UI Components (Shadcn)

```bash
# Instalar componentes necessários
npx shadcn-vue@latest add button
npx shadcn-vue@latest add card
npx shadcn-vue@latest add input
npx shadcn-vue@latest add badge
npx shadcn-vue@latest add alert
npx shadcn-vue@latest add modal
```

#### 2.2 Layout Components (Rebuild)

- `AppLayout.vue`: Header + Sidebar + Main (dark theme)
- `Header.vue`: Logo + Search + Actions + User menu
- `Sidebar.vue`: Collapsible navigation menu
- `Footer.vue`: Status bar (connected, version, uptime)

**Checklist AppLayout**:

- ✅ Flexbox 3-column layout (sidebar | main | panel)
- ✅ Sidebar collapse (desktop + mobile)
- ✅ Dark background (#0a0e1a)
- ✅ Borders (#334155)
- ✅ Responsive breakpoints (md, lg, xl)

### Fase 3: Task Management (5-6 dias)

#### 3.1 Task Components

- `TaskList.vue`: Table com filtros + sort + paginação
- `TaskCard.vue`: Card view (grid layout)
- `TaskDetail.vue`: Modal com detalhes completos
- `TaskForm.vue`: Form create/edit (validation)
- `TaskFilters.vue`: Filters bar (status, priority, search)

**Checklist TaskList**:

- ✅ Tabela com headers sortable
- ✅ Status badges (RUNNING, PENDING, DONE, etc.)
- ✅ Priority indicators (HIGH, MEDIUM, LOW)
- ✅ Actions dropdown (edit, cancel, delete)
- ✅ Paginação (10/25/50 per page)
- ✅ Skeleton loading state
- ✅ Empty state (nenhuma task)

#### 3.2 Task CRUD Integration

- Connect TaskList → API GET `/api/dashboard/tasks`
- Connect TaskForm → API POST `/api/tasks`
- Connect TaskDetail → API PATCH `/api/tasks/:id`
- Connect Delete action → API DELETE `/api/tasks/:id`
- Realtime updates via Socket.io (`task:updated`)

### Fase 4: Metrics Dashboard (4-5 dias)

#### 4.1 Metrics Components

- `MetricsGrid.vue`: Grid com 4-6 metric cards
- `MetricCard.vue`: Reusable card (gauge + sparkline)
- `GaugeChart.vue`: Circular gauge (Chart.js)
- `SparklineChart.vue`: Mini line chart (Chart.js)

**Checklist MetricsGrid**:

- ✅ Grid responsivo (4 cols → 2 cols → 1 col)
- ✅ Métricas: CPU, Memory, Heap, Event Loop Lag
- ✅ Thresholds coloridos (green < 60%, yellow < 80%, red >= 80%)
- ✅ Sparklines com histórico (último 1 min)
- ✅ Tooltip com valores exatos
- ✅ Loading state (skeleton)

#### 4.2 Telemetry Integration

- Connect MetricsGrid → API GET `/api/dashboard/telemetry/current`
- Connect Sparklines → API GET `/api/dashboard/telemetry/history?period=1m`
- Realtime updates via Socket.io (`telemetry:snapshot` @ 1Hz)
- Store updates via Pinia (telemetry.js store)

### Fase 5: Dashboard View (3-4 dias)

#### 5.1 Dashboard.vue (Rebuild)

```vue
<template>
  <div class="dashboard">
    <!-- Header with actions -->
    <div class="dashboard-header">
      <h1 class="h1">Dashboard</h1>
      <div class="actions">
        <Button variant="primary" @click="createTask"> + New Task </Button>
        <Button variant="ghost" @click="refreshData"> 🔄 Refresh </Button>
      </div>
    </div>

    <!-- Alerts banner -->
    <AlertBanner v-if="alerts.length > 0" :alerts="alerts" />

    <!-- Metrics grid -->
    <MetricsGrid :metrics="telemetryStore.current" />

    <!-- Tasks overview -->
    <Card>
      <template #header>
        <div class="flex items-center justify-between">
          <h2 class="h2">Tasks</h2>
          <router-link to="/dashboard/tasks"> View all → </router-link>
        </div>
      </template>
      <TaskList :tasks="taskStore.tasks.slice(0, 10)" :compact="true" />
    </Card>
  </div>
</template>
```

**Checklist Dashboard.vue**:

- ✅ Header com título + actions
- ✅ Alert banner (se houver alertas)
- ✅ Metrics grid (4-6 cards)
- ✅ Tasks overview (últimas 10 tasks)
- ✅ Link para "View all tasks"
- ✅ Realtime updates (Socket.io)
- ✅ Loading states
- ✅ Error handling

#### 5.2 TasksView.vue (Full Page)

- Task list completo (tabela + filtros)
- Filtros: status, priority, search, date range
- Actions: create, edit, cancel, delete
- Paginação + infinite scroll (opção)
- Export CSV/JSON (futuro)

#### 5.3 MetricsView.vue (Full Page)

- Métricas expandidas (mais detalhes)
- Gráficos maiores (line charts, bar charts)
- Histórico configurável (1h, 6h, 24h, 7d)
- Comparação de períodos (futuro)

### Fase 6: Polishing (2-3 dias)

#### 6.1 Responsiveness

- Testar breakpoints (mobile, tablet, desktop)
- Ajustar sidebar (collapse em mobile)
- Ajustar grids (4 cols → 2 cols → 1 col)
- Ajustar tabelas (scroll horizontal em mobile)

#### 6.2 Animations & Transitions

- Fade in/out (modals, alerts)
- Slide in/out (sidebar, panels)
- Skeleton loading (smooth transitions)
- Hover states (cards, buttons)

#### 6.3 Error States

- Empty states (nenhuma task, nenhuma métrica)
- Error boundaries (API failures)
- Retry buttons (quando API falha)
- Toasts para feedback (task criada, erro, etc.)

#### 6.4 Accessibility

- Focus states (keyboard navigation)
- ARIA labels (screen readers)
- Color contrast (WCAG AA compliance)
- Skip links (skip to content)

### Fase 7: Testing & Deploy (2-3 dias)

#### 7.1 Unit Tests (Vitest)

- Components: Button, Card, Badge (render tests)
- Stores: tasks.js, telemetry.js (actions, getters)
- Composables: useSocket, useRealtime (mock tests)

#### 7.2 Integration Tests

- Task CRUD flow (create → read → update → delete)
- Realtime updates (Socket.io mock)
- Filters e paginação (TaskList)

#### 7.3 E2E Tests (Playwright)

- Login flow (se houver auth)
- Create task flow
- Dashboard page load
- Metrics update realtime

#### 7.4 Build & Deploy

```bash
# Build frontend
cd src/dashboard-ui
npm run build                     # Output: dist/

# Server serve static files
# src/server/main.js
app.use('/dashboard', express.static(path.join(__dirname, '../dashboard-ui/dist')));

# PM2 restart
pm2 restart ecosystem.config.js
```

---

## 📊 Estimativa de Esforço

| Fase      | Descrição         | Dias             | Complexidade |
| --------- | ----------------- | ---------------- | ------------ |
| **1**     | Setup & Cleanup   | 2-3              | Baixa        |
| **2**     | Componentes Base  | 3-4              | Média        |
| **3**     | Task Management   | 5-6              | Alta         |
| **4**     | Metrics Dashboard | 4-5              | Média        |
| **5**     | Dashboard View    | 3-4              | Média        |
| **6**     | Polishing         | 2-3              | Baixa        |
| **7**     | Testing & Deploy  | 2-3              | Média        |
| **TOTAL** | **21-28 dias**    | **~4-5 semanas** | **Sprint 1** |

**Velocidade**: 1 desenvolvedor full-time, 6h/dia de trabalho efetivo

---

## 🎯 Conclusões

### Situação Atual: PRIMITIVA mas ARQUITETURA SÓLIDA

O dashboard atual está em **estado embrionário** com:

- ❌ **UI não funcional**: Light theme, layout básico, componentes genéricos
- ✅ **Backend completo**: API, controllers, bridges, NERV adapter funcionais
- ✅ **Infraestrutura pronta**: Socket.io, REST, stores, composables

### Decisões Estratégicas: MANTER SEPARAÇÃO, REBUILD UI

1. ✅ **Manter node folder separado** (dashboard-ui/ independente)
2. ✅ **Manter stack Vue 3 + Vite + Pinia** (moderno e performático)
3. 🔄 **Substituir Element Plus** por TailwindCSS + Shadcn-Vue (dark theme nativo)
4. ❌ **Remover libs pesadas** (cytoscape, d3, vis-timeline) não usadas
5. ✅ **Manter Socket.io + REST** (realtime + CRUD funcional)
6. ✅ **Manter NERV adapter** (IPC ↔ Socket bridge limpo)

### Próximos Passos: REBUILD COMPLETO (4-5 semanas)

**MVP (Sprint 1)**:

- ✅ Dark theme futurista (sóbrio, não exagerado)
- ✅ Task CRUD (create, read, update, delete)
- ✅ Indicadores básicos (CPU, Memory, Heap, Event Loop)
- ✅ Realtime updates (Socket.io @ 1Hz)
- ✅ Filtros e busca (tasks)
- ✅ Layout responsivo (mobile, tablet, desktop)

**Futuro (Sprint 2+)**:

- 🔜 System Health view (health checks, logs)
- 🔜 Mission orchestration UI (multi-step workflows)
- 🔜 Workflow editor (visual drag-and-drop)
- 🔜 Advanced charts (cytoscape para graph viz)
- 🔜 Timeline view (vis-timeline para histórico)

### Princípios Arquiteturais: MANTIDOS

1. ✅ **Separation of Concerns**: Dashboard (UI) ↔ Server (Backend)
2. ✅ **NERV-First Communication**: IPC → Adapter → Socket
3. ✅ **Anti-Corruption Layer**: NERV adapter sem business logic
4. ✅ **Event-Driven**: Realtime via Socket.io broadcasts
5. ✅ **Stateless API**: REST endpoints para CRUD
6. ✅ **Unified State**: task_sync_bridge unifica disk + kernel

---

**Data de Criação**: Fevereiro 2026 **Versão do Sistema**: v2.0 (Mission Control) **Status**: ✅
ANÁLISE COMPLETA - PRONTO PARA IMPLEMENTAÇÃO **Próxima Ação**: Iniciar Fase 1 (Setup & Cleanup)
