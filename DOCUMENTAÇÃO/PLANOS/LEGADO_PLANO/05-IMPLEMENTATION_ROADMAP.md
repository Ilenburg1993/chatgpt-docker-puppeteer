# 05 - IMPLEMENTATION ROADMAP

## Visão Geral da Implementação

Este documento detalha o **plano de implementação completo** para transformar o sistema
chatgpt-docker-puppeteer em uma **plataforma de orquestração autônoma de LLMs de nível enterprise**.

**Duração Total**: 17 semanas (4.5 meses)

- **Parte 1**: Dashboard Enterprise (Semanas 1-5)
- **Parte 2**: Sistema de Orquestração Autônoma (Semanas 6-17)

**Estratégia**: Implementação incremental com entregas funcionais a cada fase.

---

## PARTE 1: DASHBOARD ENTERPRISE (Semanas 1-5)

### Semana 1: Infraestrutura Frontend

#### Objetivos

- Criar base do projeto Vue.js 3
- Configurar build tooling (Vite)
- Implementar layout e roteamento básico
- Conectar ao backend existente

#### Tarefas Detalhadas

**Dia 1-2: Setup Inicial**

```bash
# Criar diretório
mkdir -p src/dashboard-ui
cd src/dashboard-ui

# Inicializar projeto Vue.js 3 com Vite
npm create vite@latest . -- --template vue

# Instalar dependências core
npm install vue-router@4 pinia@2 socket.io-client@4 axios@1

# Instalar bibliotecas de visualização
npm install chart.js@4 vue-chartjs@5 cytoscape@3 vis-timeline@7 d3@7

# Instalar UI framework
npm install element-plus@2 # OU vuetify@3

# Instalar utilitários
npm install lodash-es@4 date-fns@3 uuid@10
```

**Dia 3: Configuração Vite**

- Editar `vite.config.js`:
  - Proxy para backend (http://localhost:3008)
  - Alias para paths (@/ → src/)
  - Build optimization
  - Source maps para dev

**Dia 4-5: Estrutura de Diretórios**

```
src/dashboard-ui/src/
├── main.js                 # Entry point
├── App.vue                 # Root component
├── router/
│   └── index.js           # Vue Router config
├── stores/                # Pinia stores (criar vazias)
│   ├── tasks.js
│   ├── telemetry.js
│   ├── system.js
│   ├── workflow.js
│   └── nerv.js
├── composables/           # Vue composition utilities (criar vazias)
│   ├── useSocket.js
│   ├── useRealtime.js
│   └── useTaskAPI.js
├── views/                 # Page components (criar placeholders)
│   ├── Dashboard.vue
│   ├── TaskQueue.vue
│   ├── TaskDetail.vue
│   ├── WorkflowEditor.vue
│   ├── PerformanceMetrics.vue
│   ├── EventCorrelation.vue
│   ├── SystemHealth.vue
│   └── Templates.vue
├── components/
│   └── layout/           # Layout components
│       ├── AppLayout.vue
│       ├── Header.vue
│       └── Sidebar.vue
└── assets/               # Static assets

# Criar todas as pastas
mkdir -p src/{router,stores,composables,views,components/{layout,task,workflow,charts,telemetry,health,common},services/{api,socket,mappers},utils,types,assets}
```

**Dia 5: Integração com Backend**

- Atualizar `src/server/engine/app.js`:

  ```javascript
  // Servir dashboard Vue.js
  app.use('/dashboard', express.static(path.join(__dirname, '../../dashboard-ui/dist')));

  // Fallback para SPA routing
  app.get('/dashboard/*', (req, res) => {
    res.sendFile(path.join(__dirname, '../../dashboard-ui/dist/index.html'));
  });
  ```

#### Entregáveis

- ✅ Projeto Vue.js 3 inicializado
- ✅ Estrutura de diretórios completa
- ✅ Layout básico renderizando
- ✅ Todas as rotas configuradas (vazias)
- ✅ Dashboard acessível em http://localhost:3008/dashboard

#### Critérios de Aceite

- [ ] `npm run dev` inicia dev server em http://localhost:5173
- [ ] `npm run build` gera build em dist/
- [ ] Navegação entre rotas funciona
- [ ] Layout responsivo (desktop + mobile)

---

### Semana 2: Backend APIs e Sincronização

#### Objetivos

- Implementar TaskSyncBridge (unificar Queue + Kernel)
- Implementar TelemetryAggregator
- Estender APIs REST
- Adicionar novos eventos Socket.io

#### Tarefas Detalhadas

**Dia 1-2: TaskSyncBridge**

```javascript
// src/infra/queue/task_sync_bridge.js

const { EventEmitter } = require('events');
const nervClient = require('@nerv/nerv_client');
const queueCache = require('./cache');
const { ActionCode } = require('@shared/nerv/constants');

class TaskSyncBridge extends EventEmitter {
  constructor() {
    super();
    this.kernelStateCache = new Map(); // task_id → kernel_state
    this._setupNervListeners();
  }

  /**
   * Get unified tasks (disk + kernel state)
   */
  async getUnifiedTasks() {
    const diskTasks = await queueCache.getQueue();

    return diskTasks.map((diskTask) => {
      const kernelState = this.kernelStateCache.get(diskTask.meta.id);

      return {
        ...diskTask,
        runtime_state: kernelState || null,
        unified_status: this._computeUnifiedStatus(diskTask, kernelState),
      };
    });
  }

  /**
   * Get single unified task
   */
  async getUnifiedTask(taskId) {
    const diskTask = await queueCache.loadTask(taskId);
    const kernelState = this.kernelStateCache.get(taskId);

    return {
      ...diskTask,
      runtime_state: kernelState,
      unified_status: this._computeUnifiedStatus(diskTask, kernelState),
    };
  }

  /**
   * Listen to NERV events to update kernel state cache
   */
  _setupNervListeners() {
    nervClient.on(ActionCode.TASK_STARTED, (envelope) => {
      const { task_id, worker_id } = envelope.payload;

      this.kernelStateCache.set(task_id, {
        status: 'RUNNING',
        worker_id,
        started_at: Date.now(),
      });

      this._notifyDashboards(task_id);
    });

    nervClient.on(ActionCode.TASK_COMPLETED, (envelope) => {
      const { task_id, result } = envelope.payload;

      this.kernelStateCache.set(task_id, {
        status: 'DONE',
        completed_at: Date.now(),
        result_preview: result?.substring(0, 200),
      });

      this._notifyDashboards(task_id);
    });

    nervClient.on(ActionCode.TASK_FAILED, (envelope) => {
      const { task_id, error } = envelope.payload;

      this.kernelStateCache.set(task_id, {
        status: 'FAILED',
        failed_at: Date.now(),
        error: error.message,
      });

      this._notifyDashboards(task_id);
    });

    nervClient.on(ActionCode.TASK_PROGRESS, (envelope) => {
      const { task_id, progress_percent, current_step } = envelope.payload;

      const existing = this.kernelStateCache.get(task_id) || {};
      this.kernelStateCache.set(task_id, {
        ...existing,
        progress_percent,
        current_step,
      });

      this._notifyDashboards(task_id);
    });
  }

  /**
   * Notify dashboards via Socket.io
   */
  _notifyDashboards(taskId) {
    const socketHub = require('@server/engine/socket');
    socketHub.broadcastTaskUpdate(taskId, this.kernelStateCache.get(taskId));
  }

  _computeUnifiedStatus(diskTask, kernelState) {
    if (!kernelState) return diskTask.state.status;

    // Kernel state takes precedence for RUNNING tasks
    if (kernelState.status === 'RUNNING') return 'RUNNING';
    if (kernelState.status === 'DONE') return 'DONE';
    if (kernelState.status === 'FAILED') return 'FAILED';

    return diskTask.state.status;
  }
}

module.exports = new TaskSyncBridge();
```

**Dia 2-3: TelemetryAggregator**

```javascript
// src/server/dashboard-api/telemetry_aggregator.js

const nervTelemetry = require('@nerv/telemetry/ipc_telemetry');
const hardware = require('@server/realtime/telemetry/hardware');
const queueCache = require('@infra/queue/cache');
const socketHub = require('@server/engine/socket');

class TelemetryAggregator {
  constructor() {
    // Ring buffers (3600 pontos = 1 hora @ 1Hz)
    this.cpuHistory = [];
    this.memoryHistory = [];
    this.nervLatencyHistory = [];
    this.throughputHistory = [];
    this.eventLoopLagHistory = [];

    this.maxBufferSize = 3600;
    this.collectionInterval = null;
  }

  /**
   * Start collection loop (1Hz)
   */
  start() {
    this.collectionInterval = setInterval(() => {
      this._collectAndBroadcast();
    }, 1000); // 1Hz
  }

  stop() {
    if (this.collectionInterval) {
      clearInterval(this.collectionInterval);
    }
  }

  async _collectAndBroadcast() {
    const metrics = await this._collectMetrics();

    // Add to ring buffers
    this._addToBuffer(this.cpuHistory, metrics.cpu.current);
    this._addToBuffer(this.memoryHistory, metrics.memory.percent);
    this._addToBuffer(this.nervLatencyHistory, metrics.nerv.latency);
    this._addToBuffer(this.throughputHistory, metrics.nerv.throughput);
    this._addToBuffer(this.eventLoopLagHistory, metrics.eventLoopLag);

    // Broadcast via Socket.io
    socketHub.notify('telemetry:metrics', metrics);
  }

  async _collectMetrics() {
    // NERV telemetry
    const nervStats = nervTelemetry.stats();

    // Hardware
    const heapStats = hardware.getHeapStats();
    const cpuUsage = await hardware.getCPUUsage();

    // Queue
    const queueMetrics = queueCache.getCacheMetrics();

    // Event loop lag (custom measurement)
    const eventLoopLag = await this._measureEventLoopLag();

    return {
      timestamp: Date.now(),
      cpu: {
        current: cpuUsage,
        avg: this._average(this.cpuHistory),
        max: Math.max(...this.cpuHistory, 0),
      },
      memory: {
        used: heapStats.used,
        total: heapStats.total,
        percent: (heapStats.used / heapStats.total) * 100,
      },
      nerv: {
        latency: nervStats.latency_ms || 0,
        throughput: nervStats.events_per_second || 0,
        eventCount: nervStats.total_events || 0,
      },
      eventLoopLag,
      queue: {
        size: queueMetrics.queue_size || 0,
        hitRate: queueMetrics.hit_rate || 0,
        corrupt: queueMetrics.corrupt_count || 0,
      },
    };
  }

  _addToBuffer(buffer, value) {
    buffer.push(value);
    if (buffer.length > this.maxBufferSize) {
      buffer.shift();
    }
  }

  _average(arr) {
    if (arr.length === 0) return 0;
    return arr.reduce((sum, val) => sum + val, 0) / arr.length;
  }

  async _measureEventLoopLag() {
    const start = Date.now();
    await new Promise((resolve) => setImmediate(resolve));
    return Date.now() - start;
  }

  /**
   * API endpoints
   */
  getCurrent() {
    return this._collectMetrics();
  }

  getHistory(metric, fromTimestamp, toTimestamp) {
    // Filter ring buffer by timestamp
    const buffer = this[`${metric}History`];
    // Implementation depends on storing timestamps with values
    return buffer;
  }
}

module.exports = new TelemetryAggregator();
```

**Dia 4: Estender APIs REST**

- Modificar `src/server/api/controllers/tasks.js`:

  ```javascript
  const taskSyncBridge = require('@infra/queue/task_sync_bridge');

  // GET /api/tasks
  router.get('/', async (req, res) => {
    const tasks = await taskSyncBridge.getUnifiedTasks();
    res.json({ tasks });
  });

  // GET /api/tasks/:id
  router.get('/:id', async (req, res) => {
    const task = await taskSyncBridge.getUnifiedTask(req.params.id);
    res.json({ task });
  });

  // GET /api/tasks/:id/dependencies (NOVO)
  router.get('/:id/dependencies', async (req, res) => {
    const task = await taskSyncBridge.getUnifiedTask(req.params.id);
    const dependencies = task.policy.dependencies || [];

    const depTasks = await Promise.all(dependencies.map((id) => taskSyncBridge.getUnifiedTask(id)));

    res.json({ task_id: req.params.id, dependencies: depTasks });
  });

  // GET /api/tasks/:id/history (NOVO)
  router.get('/:id/history', async (req, res) => {
    // Buscar eventos NERV por correlation_id
    const task = await taskSyncBridge.getUnifiedTask(req.params.id);
    const correlationId = task.meta.correlation_id;

    // Query NERV event store (implementar)
    const events = []; // await nervStore.getEventsByCorrelation(correlationId);

    res.json({ task_id: req.params.id, events });
  });
  ```

- Criar novos controllers:

  ```javascript
  // src/server/api/controllers/telemetry.js
  const telemetryAggregator = require('@server/dashboard-api/telemetry_aggregator');

  router.get('/metrics', async (req, res) => {
    const metrics = await telemetryAggregator.getCurrent();
    res.json(metrics);
  });

  router.get('/history', async (req, res) => {
    const { metric, from, to } = req.query;
    const history = telemetryAggregator.getHistory(metric, from, to);
    res.json({ metric, history });
  });
  ```

**Dia 5: Estender Socket.io**

- Modificar `src/server/engine/socket.js`:

  ```javascript
  // Adicionar novos eventos (já existe broadcastTaskUpdate)

  function broadcastTelemetryMetrics(metrics) {
    if (ioInstance) {
      ioInstance.to('dashboards').emit('telemetry:metrics', metrics);
    }
  }

  function broadcastHealthUpdate(component, data) {
    if (ioInstance) {
      ioInstance.to('dashboards').emit(`health:${component}`, data);
    }
  }

  function broadcastAlert(alert) {
    if (ioInstance) {
      ioInstance.to('dashboards').emit('alert:triggered', alert);
    }
  }

  module.exports = {
    // ... existing exports
    broadcastTelemetryMetrics,
    broadcastHealthUpdate,
    broadcastAlert,
  };
  ```

#### Entregáveis

- ✅ `task_sync_bridge.js` implementado
- ✅ `telemetry_aggregator.js` implementado
- ✅ APIs REST estendidas
- ✅ Novos eventos Socket.io configurados

#### Critérios de Aceite

- [ ] `GET /api/tasks` retorna unified tasks (disk + kernel)
- [ ] `GET /api/telemetry/metrics` retorna métricas atuais
- [ ] Socket.io emite `telemetry:metrics` a 1Hz
- [ ] TaskSyncBridge escuta eventos NERV e atualiza cache
- [ ] Dashboards recebem updates via Socket.io

---

### Semana 3: Frontend Core (Stores + Composables + Views Básicas)

#### Objetivos

- Implementar Pinia stores
- Criar composables para Socket.io e APIs
- Implementar Dashboard principal e Task Queue

#### Tarefas Detalhadas

**Dia 1: Pinia Stores - Tasks**

```javascript
// src/dashboard-ui/src/stores/tasks.js

import { defineStore } from 'pinia';
import axios from 'axios';

export const useTaskStore = defineStore('tasks', {
  state: () => ({
    tasks: [],
    filters: {
      status: null,
      priority: null,
      dateRange: null,
    },
    selectedTaskId: null,
    loading: false,
    error: null,
  }),

  getters: {
    filteredTasks: (state) => {
      let tasks = state.tasks;

      if (state.filters.status) {
        tasks = tasks.filter((t) => t.unified_status === state.filters.status);
      }

      if (state.filters.priority !== null) {
        tasks = tasks.filter((t) => t.meta.priority >= state.filters.priority);
      }

      return tasks;
    },

    runningTasks: (state) => state.tasks.filter((t) => t.unified_status === 'RUNNING'),
    pendingTasks: (state) => state.tasks.filter((t) => t.unified_status === 'PENDING'),

    taskById: (state) => (id) => state.tasks.find((t) => t.meta.id === id),
  },

  actions: {
    async fetchTasks() {
      this.loading = true;
      this.error = null;

      try {
        const response = await axios.get('/api/tasks');
        this.tasks = response.data.tasks;
      } catch (error) {
        this.error = error.message;
        console.error('Error fetching tasks:', error);
      } finally {
        this.loading = false;
      }
    },

    async createTask(payload) {
      try {
        const response = await axios.post('/api/tasks', payload);
        this.tasks.push(response.data.task);
        return response.data.task;
      } catch (error) {
        this.error = error.message;
        throw error;
      }
    },

    async updateTask(id, data) {
      try {
        const response = await axios.put(`/api/tasks/${id}`, data);
        const index = this.tasks.findIndex((t) => t.meta.id === id);
        if (index !== -1) {
          this.tasks[index] = response.data.task;
        }
      } catch (error) {
        this.error = error.message;
        throw error;
      }
    },

    async deleteTask(id) {
      try {
        await axios.delete(`/api/tasks/${id}`);
        this.tasks = this.tasks.filter((t) => t.meta.id !== id);
      } catch (error) {
        this.error = error.message;
        throw error;
      }
    },

    async retryTask(id) {
      try {
        const response = await axios.post(`/api/tasks/${id}/retry`);
        const index = this.tasks.findIndex((t) => t.meta.id === id);
        if (index !== -1) {
          this.tasks[index] = response.data.task;
        }
      } catch (error) {
        this.error = error.message;
        throw error;
      }
    },

    handleTaskUpdate(data) {
      // Real-time Socket.io update
      const { taskId, state } = data;
      const task = this.tasks.find((t) => t.meta.id === taskId);

      if (task && task.runtime_state) {
        task.runtime_state = { ...task.runtime_state, ...state };
        task.unified_status = state.status || task.unified_status;
      }
    },
  },
});
```

**Dia 2: Composables - useSocket**

```javascript
// src/dashboard-ui/src/composables/useSocket.js

import { ref, onMounted, onUnmounted } from 'vue';
import { io } from 'socket.io-client';

export function useSocket(url = '', options = {}) {
  const socket = ref(null);
  const isConnected = ref(false);
  const error = ref(null);

  const connect = () => {
    socket.value = io(url, {
      transports: ['websocket'],
      auth: options.auth || {},
      ...options,
    });

    socket.value.on('connect', () => {
      isConnected.value = true;
      console.log('[Socket.io] Connected');
    });

    socket.value.on('disconnect', () => {
      isConnected.value = false;
      console.log('[Socket.io] Disconnected');
    });

    socket.value.on('error', (err) => {
      error.value = err.message;
      console.error('[Socket.io] Error:', err);
    });
  };

  const disconnect = () => {
    if (socket.value) {
      socket.value.disconnect();
      socket.value = null;
    }
  };

  const subscribe = (event, handler) => {
    if (socket.value) {
      socket.value.on(event, handler);
    }
  };

  const unsubscribe = (event, handler) => {
    if (socket.value) {
      socket.value.off(event, handler);
    }
  };

  const emit = (event, data) => {
    if (socket.value && isConnected.value) {
      socket.value.emit(event, data);
    }
  };

  onMounted(() => {
    connect();
  });

  onUnmounted(() => {
    disconnect();
  });

  return {
    socket,
    isConnected,
    error,
    connect,
    disconnect,
    subscribe,
    unsubscribe,
    emit,
  };
}
```

**Dia 3: Views - Dashboard Principal**

```vue
<!-- src/dashboard-ui/src/views/Dashboard.vue -->

<template>
  <div class="dashboard">
    <h1>Mission Control Dashboard</h1>

    <!-- Metrics Grid -->
    <div class="metrics-grid">
      <metric-card
        title="CPU Usage"
        :value="metrics.cpu.current"
        suffix="%"
        icon="cpu"
        :color="getCpuColor(metrics.cpu.current)"
      />

      <metric-card
        title="Memory Usage"
        :value="metrics.memory.percent"
        suffix="%"
        icon="memory"
        :color="getMemoryColor(metrics.memory.percent)"
      />

      <metric-card title="NERV Latency" :value="metrics.nerv.latency" suffix="ms" icon="zap" />

      <metric-card
        title="Throughput"
        :value="metrics.nerv.throughput"
        suffix="events/s"
        icon="activity"
      />
    </div>

    <!-- Task Summary -->
    <div class="task-summary">
      <h2>Tasks Overview</h2>
      <div class="summary-cards">
        <summary-card label="Running" :count="taskCounts.running" color="yellow" />
        <summary-card label="Pending" :count="taskCounts.pending" color="gray" />
        <summary-card label="Done" :count="taskCounts.done" color="green" />
        <summary-card label="Failed" :count="taskCounts.failed" color="red" />
      </div>
    </div>

    <!-- Health Cards -->
    <div class="health-section">
      <h2>System Health</h2>
      <div class="health-grid">
        <health-card
          v-for="component in healthComponents"
          :key="component.name"
          :component="component"
        />
      </div>
    </div>
  </div>
</template>

<script>
import { computed, onMounted } from 'vue';
import { useTelemetryStore } from '@/stores/telemetry';
import { useTaskStore } from '@/stores/tasks';
import { useSystemStore } from '@/stores/system';
import { useRealtime } from '@/composables/useRealtime';

export default {
  setup() {
    const telemetryStore = useTelemetryStore();
    const taskStore = useTaskStore();
    const systemStore = useSystemStore();

    // Real-time subscriptions
    useRealtime();

    const metrics = computed(() => telemetryStore.current);

    const taskCounts = computed(() => ({
      running: taskStore.runningTasks.length,
      pending: taskStore.pendingTasks.length,
      done: taskStore.tasks.filter((t) => t.unified_status === 'DONE').length,
      failed: taskStore.tasks.filter((t) => t.unified_status === 'FAILED').length,
    }));

    const healthComponents = computed(() => Object.values(systemStore.components));

    const getCpuColor = (value) => {
      if (value > 90) return 'red';
      if (value > 70) return 'yellow';
      return 'green';
    };

    const getMemoryColor = (value) => {
      if (value > 95) return 'red';
      if (value > 80) return 'yellow';
      return 'green';
    };

    onMounted(async () => {
      await taskStore.fetchTasks();
      await systemStore.fetchHealth();
    });

    return {
      metrics,
      taskCounts,
      healthComponents,
      getCpuColor,
      getMemoryColor,
    };
  },
};
</script>
```

**Dia 4-5: Task Queue View**

```vue
<!-- src/dashboard-ui/src/views/TaskQueue.vue -->

<template>
  <div class="task-queue">
    <div class="header">
      <h1>Task Queue</h1>
      <button @click="createTask" class="btn-primary">Create Task</button>
    </div>

    <!-- Filters -->
    <div class="filters">
      <select v-model="filters.status">
        <option :value="null">All Status</option>
        <option value="PENDING">Pending</option>
        <option value="RUNNING">Running</option>
        <option value="DONE">Done</option>
        <option value="FAILED">Failed</option>
      </select>

      <input
        v-model="filters.priority"
        type="number"
        placeholder="Min Priority"
        min="0"
        max="100"
      />

      <button @click="clearFilters" class="btn-secondary">Clear Filters</button>
    </div>

    <!-- Task List -->
    <div v-if="loading" class="loading">Loading tasks...</div>

    <div v-else-if="error" class="error">Error: {{ error }}</div>

    <div v-else class="task-list">
      <task-card
        v-for="task in filteredTasks"
        :key="task.meta.id"
        :task="task"
        @edit="editTask"
        @delete="deleteTask"
        @retry="retryTask"
      />
    </div>

    <!-- Empty state -->
    <div v-if="!loading && filteredTasks.length === 0" class="empty-state">
      <p>No tasks found</p>
    </div>
  </div>
</template>

<script>
import { computed, reactive, onMounted } from 'vue';
import { useTaskStore } from '@/stores/tasks';
import { useRouter } from 'vue-router';

export default {
  setup() {
    const taskStore = useTaskStore();
    const router = useRouter();

    const filters = reactive({
      status: null,
      priority: null,
    });

    const loading = computed(() => taskStore.loading);
    const error = computed(() => taskStore.error);
    const filteredTasks = computed(() => taskStore.filteredTasks);

    const createTask = () => {
      router.push('/tasks/new');
    };

    const editTask = (taskId) => {
      router.push(`/tasks/${taskId}`);
    };

    const deleteTask = async (taskId) => {
      if (confirm('Delete this task?')) {
        await taskStore.deleteTask(taskId);
      }
    };

    const retryTask = async (taskId) => {
      await taskStore.retryTask(taskId);
    };

    const clearFilters = () => {
      filters.status = null;
      filters.priority = null;
    };

    onMounted(async () => {
      await taskStore.fetchTasks();
    });

    // Watch filters and update store
    watch(filters, (newFilters) => {
      taskStore.filters = { ...newFilters };
    });

    return {
      filters,
      loading,
      error,
      filteredTasks,
      createTask,
      editTask,
      deleteTask,
      retryTask,
      clearFilters,
    };
  },
};
</script>
```

#### Entregáveis

- ✅ 5 Pinia stores implementadas
- ✅ 3 composables implementados
- ✅ Dashboard principal funcional
- ✅ Task Queue funcional
- ✅ Real-time updates via Socket.io

#### Critérios de Aceite

- [ ] Dashboard carrega e exibe métricas em tempo real
- [ ] Task queue lista tarefas corretamente
- [ ] Filtros funcionam
- [ ] Real-time updates aparecem na UI sem refresh
- [ ] Navegação entre views funciona

---

### Semana 4: Visualizações Avançadas

#### Objetivos

- Implementar Performance Metrics (Charts)
- Implementar Workflow Editor (DAG)
- Implementar Event Correlation
- Implementar System Health

#### Tarefas Resumidas (detalhes no plano principal)

- **Dia 1-2**: Performance Metrics com Chart.js
- **Dia 3**: Workflow Editor com Cytoscape.js
- **Dia 4**: Event Correlation com Vis-Timeline
- **Dia 5**: System Health view

#### Entregáveis

- ✅ PerformanceMetrics.vue com charts real-time
- ✅ WorkflowEditor.vue com DAG canvas
- ✅ EventCorrelation.vue com timeline
- ✅ SystemHealth.vue com health cards

---

### Semana 5: Refinamento e Deploy

#### Objetivos

- Polimento de UI/UX
- Otimização de performance
- Testes E2E
- Documentação
- Rollout para produção

#### Tarefas Resumidas

- **Dia 1-2**: UI/UX polimento, loading states, error handling
- **Dia 3**: Performance optimization (lazy loading, virtual scrolling)
- **Dia 4**: Testes E2E com Playwright
- **Dia 5**: Documentação e deploy

#### Entregáveis

- ✅ UI polida e responsiva
- ✅ Performance otimizada
- ✅ Testes E2E passando
- ✅ Documentação completa
- ✅ Dashboard em produção

---

## PARTE 2: SISTEMA DE ORQUESTRAÇÃO AUTÔNOMA (Semanas 6-17)

### Semana 6: Task Schema V5

#### Objetivos

- Projetar e implementar Task Schema V5
- Adicionar suporte a MISSIONS, WORKFLOWS, STRATEGIES
- Criar migrador V4 → V5
- Garantir compatibilidade retroativa

#### Arquitetura do Schema V5

```javascript
// src/core/schemas/task_schema_v5.js

const TaskSchemaV5 = z.object({
  meta: z.object({
    id: z.string().uuid(),
    project_id: z.string().default('default'),
    parent_id: z.string().uuid().optional(), // NOVO: Hierarchical tasks
    mission_id: z.string().uuid().optional(), // NOVO: Mission grouping
    workflow_id: z.string().uuid().optional(), // NOVO: Workflow grouping
    correlation_id: z.string().uuid().optional(),
    version: z.literal('5.0'),
    created_at: z.string().datetime(),
    priority: z.number().int().min(0).max(100).default(50),
    tags: z.array(z.string()).default([]),
  }),

  spec: z.object({
    target: z.enum(['chatgpt', 'gemini', 'claude', 'ollama', 'auto']),
    model: z.string().default('AUTO'),

    payload: z.object({
      system_message: z.string().optional(),
      user_message: z.string(),
      context: z.any().optional(), // NOVO: Previous results, external data
    }),

    // NOVO: Execution strategy
    execution: z
      .object({
        strategy: z
          .enum([
            'SINGLE_SHOT', // Execute once
            'ITERATIVE', // Execute → Validate → Retry
            'MULTI_STEP', // Workflow with multiple steps
            'TREE_OF_THOUGHT', // Generate N solutions, pick best
            'CHAIN_OF_THOUGHT', // Step-by-step reasoning
          ])
          .default('SINGLE_SHOT'),

        // For ITERATIVE strategy
        iterative_config: z
          .object({
            max_iterations: z.number().int().positive().default(3),
            validation_criteria: z
              .object({
                validators: z.array(z.string()), // ['regex', 'schema', 'llm_judge']
                min_quality_score: z.number().min(0).max(100).default(70),
              })
              .optional(),
          })
          .optional(),

        // For MULTI_STEP strategy
        workflow_config: z
          .object({
            steps: z.array(
              z.object({
                id: z.string(),
                name: z.string(),
                action: z.enum(['execute_prompt', 'validate', 'branch', 'loop', 'spawn_subtask']),
                config: z.any(),
                dependencies: z.array(z.string()).default([]),
              }),
            ),
            max_subtasks: z.number().int().positive().default(50),
          })
          .optional(),
      })
      .default({ strategy: 'SINGLE_SHOT' }),

    // NOVO: Validation rules
    validation: z
      .object({
        validators: z
          .array(
            z.object({
              type: z.enum(['regex', 'schema', 'length', 'llm_judge', 'custom']),
              config: z.any(),
            }),
          )
          .default([]),
      })
      .optional(),

    // NOVO: Context management
    context_config: z
      .object({
        inject_previous_results: z.boolean().default(false),
        context_window_strategy: z.enum(['full', 'chunked', 'summarized']).default('full'),
        max_context_tokens: z.number().int().positive().optional(),
      })
      .optional(),
  }),

  state: z.object({
    status: z.enum(['PENDING', 'RUNNING', 'DONE', 'FAILED', 'SKIPPED', 'PAUSED']),

    // NOVO: Workflow state
    workflow_state: z
      .object({
        current_step_index: z.number().int().nonnegative().default(0),
        completed_steps: z.array(z.string()).default([]),
        accumulated_context: z.any().optional(),
      })
      .optional(),

    // NOVO: Quality metrics
    quality_metrics: z
      .object({
        overall_score: z.number().min(0).max(100).optional(),
        validation_passed: z.boolean().optional(),
      })
      .optional(),

    // NOVO: Cost tracking
    cost_tracking: z
      .object({
        input_tokens: z.number().int().nonnegative().default(0),
        output_tokens: z.number().int().nonnegative().default(0),
        cost_usd: z.number().nonnegative().default(0),
      })
      .optional(),
  }),
});
```

#### Tarefas Detalhadas

**Dia 1-2: Schema Design**

- Definir estrutura completa do V5
- Documentar todos os campos novos
- Criar exemplos de uso

**Dia 3-4: Implementação**

- Implementar `task_schema_v5.js` com Zod
- Implementar validadores
- Implementar `migrator_v4_to_v5.js`

**Dia 5: Testes**

- Testes unitários do schema
- Testes de migração V4 → V5
- Verificar compatibilidade retroativa

#### Entregáveis

- ✅ `src/core/schemas/task_schema_v5.js`
- ✅ `src/core/schemas/migrator_v4_to_v5.js`
- ✅ Testes passando
- ✅ Documentação

#### Critérios de Aceite

- [ ] Schema V5 valida corretamente
- [ ] Tasks V4 continuam funcionando
- [ ] Migração V4 → V5 preserva dados

---

### Semanas 7-8: Orchestrator Engine

#### Objetivos

- Implementar OrchestratorEngine (motor de execução)
- Implementar estratégias: SINGLE_SHOT, ITERATIVE, MULTI_STEP
- Integrar ao kernel loop

#### Arquitetura

```
Kernel Loop (20Hz)
    ↓
OrchestratorEngine.execute(task)
    ↓
Strategy Handler (based on task.spec.execution.strategy)
    ↓
    ├─ SINGLE_SHOT → Execute once
    ├─ ITERATIVE → Execute → Validate → Retry loop
    └─ MULTI_STEP → Execute workflow steps
```

#### Tarefas Detalhadas

**Semana 7, Dia 1-3: OrchestratorEngine Base**

```javascript
// src/orchestrator/orchestrator_engine.js

class OrchestratorEngine {
  constructor({ kernel, nervBridge, contextManager, validationService }) {
    this.kernel = kernel;
    this.nerv = nervBridge;
    this.contextManager = contextManager;
    this.validationService = validationService;

    // Strategy handlers
    this.strategyHandlers = {
      SINGLE_SHOT: this._handleSingleShot.bind(this),
      ITERATIVE: this._handleIterative.bind(this),
      MULTI_STEP: this._handleMultiStep.bind(this),
    };
  }

  async execute(task) {
    const strategy = task.spec.execution.strategy;
    const handler = this.strategyHandlers[strategy];

    if (!handler) {
      throw new Error(`Unknown strategy: ${strategy}`);
    }

    // Emit orchestration start
    this.nerv.emit({
      actionCode: 'ORCHESTRATION_STARTED',
      payload: { task_id: task.meta.id, strategy },
    });

    try {
      const result = await handler(task);

      this.nerv.emit({
        actionCode: 'ORCHESTRATION_COMPLETED',
        payload: { task_id: task.meta.id, quality_score: result.quality_score },
      });

      return result;
    } catch (error) {
      this.nerv.emit({
        actionCode: 'ORCHESTRATION_FAILED',
        payload: { task_id: task.meta.id, error: error.message },
      });
      throw error;
    }
  }

  async _handleSingleShot(task) {
    const driver = await this._getDriver(task.spec.target);
    return await driver.execute(task);
  }

  async _handleIterative(task) {
    const config = task.spec.execution.iterative_config;
    const maxIterations = config.max_iterations || 3;

    for (let i = 0; i < maxIterations; i++) {
      this.nerv.emit({
        actionCode: 'ITERATION_STARTED',
        payload: { task_id: task.meta.id, iteration: i + 1 },
      });

      const result = await this._getDriver(task.spec.target).execute(task);
      const validation = await this.validationService.validate(
        result.output,
        config.validation_criteria,
      );

      if (validation.passed) {
        return { ...result, iterations: i + 1, quality_score: validation.score };
      }

      // Inject feedback for next iteration
      task.spec.payload.context = {
        previous_output: result.output,
        validation_feedback: validation.feedback,
      };
    }

    throw new Error('Max iterations reached without passing validation');
  }

  async _getDriver(target) {
    const driverFactory = require('../driver/factory');
    return await driverFactory.createDriver(target);
  }
}
```

**Semana 7, Dia 4-5: MULTI_STEP Strategy**

- Implementar execução de workflow com steps
- Dependency resolution
- Context accumulation entre steps

**Semana 8: Integração**

- Integrar OrchestratorEngine ao kernel loop
- Testes de integração
- Performance tuning

#### Entregáveis

- ✅ `src/orchestrator/orchestrator_engine.js`
- ✅ Estratégias implementadas
- ✅ Integração com kernel
- ✅ Testes passando

---

### Semana 9: Validation Framework

#### Objetivos

- Implementar ValidationService
- Implementar validadores: regex, schema, llm_judge
- Integrar ao orchestrator

#### Validadores

1. **RegexValidator**: Verifica padrão regex
2. **SchemaValidator**: Valida JSON contra schema
3. **LengthValidator**: Verifica tamanho mín/máx
4. **LLMJudgeValidator**: LLM avalia qualidade

#### LLM-as-Judge Implementation

```javascript
// src/orchestrator/validation/llm_judge_validator.js

class LLMJudgeValidator {
  async validate(output, criteria) {
    const judgePrompt = `
Evaluate this output based on: ${criteria.join(', ')}

Output:
"""
${output}
"""

Return JSON:
{
  "overall_score": 0-100,
  "strengths": ["..."],
  "weaknesses": ["..."],
  "suggestions": ["..."]
}
`;

    const driver = await driverFactory.createDriver('chatgpt');
    const result = await driver.execute({
      spec: {
        model: 'gpt-4o',
        temperature: 0.2,
        response_format: { type: 'json_object' },
        payload: { user_message: judgePrompt },
      },
    });

    const evaluation = JSON.parse(result.output);

    return {
      passed: evaluation.overall_score >= criteria.min_score,
      score: evaluation.overall_score,
      feedback: evaluation.suggestions.join('; '),
    };
  }
}
```

#### Entregáveis

- ✅ ValidationService
- ✅ 4+ validadores
- ✅ LLM-as-judge funcional
- ✅ Testes

---

### Semanas 10-11: Multi-Driver Architecture

#### Objetivos

- Definir BaseDriverV2 interface
- Refatorar drivers existentes
- Implementar novos drivers (Gemini, Claude)
- Implementar auto-selection e fallback

#### BaseDriverV2 Interface

```javascript
class BaseDriverV2 {
  getCapabilities() {
    return {
      models: [],
      max_tokens: 4096,
      supports_json: false,
      cost_per_1k_input: 0,
      cost_per_1k_output: 0,
    };
  }

  async execute(task) {
    throw new Error('Must implement execute()');
  }

  estimateCost(task) {
    // Calculate estimated cost
  }
}
```

#### Driver Factory V2

- Auto-select best driver based on requirements
- Fallback strategy (primary → secondary)
- Cost optimization

#### Entregáveis

- ✅ BaseDriverV2
- ✅ ChatGPTDriverV2, GeminiDriverV2, ClaudeDriverV2
- ✅ DriverFactoryV2
- ✅ Auto-selection logic
- ✅ Fallback wrapper

---

### Semana 12: Context Management

#### Objetivos

- Implementar ContextManager
- Chunking de contexto grande
- Context injection entre steps
- Long-term memory

#### Features

- **Chunking**: Split large context into chunks
- **Injection**: Inject previous results into prompts
- **Summarization**: Summarize context to fit window
- **Memory**: Store and retrieve patterns

#### Entregáveis

- ✅ ContextManager
- ✅ MemoryStore
- ✅ Chunking strategies
- ✅ Testes

---

### Semana 13: Semantic Telemetry

#### Objetivos

- Estender NERV constants (30+ novos eventos)
- Implementar SemanticTelemetry
- Implementar CostTracker
- Dashboard integration

#### Novos Eventos NERV

```javascript
// Orchestration
'ORCHESTRATION_STARTED';
'ORCHESTRATION_COMPLETED';
'ORCHESTRATION_FAILED';

// Workflow
'WORKFLOW_STEP_STARTED';
'WORKFLOW_STEP_COMPLETED';

// Iteration
'ITERATION_STARTED';
'ITERATION_COMPLETED';
'ITERATION_CONVERGED';

// Validation
'VALIDATION_PASSED';
'VALIDATION_FAILED';

// Quality
'QUALITY_ASSESSED';
'QUALITY_IMPROVED';

// Cost
'TOKEN_USAGE_RECORDED';
'COST_CALCULATED';
'BUDGET_WARNING';
```

#### Entregáveis

- ✅ Novos ActionCode constants
- ✅ SemanticTelemetry service
- ✅ CostTracker service
- ✅ Dashboard widgets

---

### Semanas 14-15: Dashboard Orchestration UI

#### Objetivos

- Workflow Designer (visual editor)
- Quality Dashboard
- Cost Dashboard
- Reasoning Trace Viewer

#### Workflow Designer

- Visual DAG editor (Cytoscape.js)
- Drag-and-drop nodes
- Validate workflow
- Execute workflow

#### Quality Dashboard

- Quality scores over time
- Validation pass rate
- Iteration statistics
- Task quality table

#### Cost Dashboard

- Cost tracking (hoje, semana, mês)
- Cost by model
- Cost by mission
- Budget alerts

#### Entregáveis

- ✅ WorkflowDesigner.vue
- ✅ QualityDashboard.vue
- ✅ CostDashboard.vue
- ✅ ReasoningTraceViewer.vue

---

### Semana 16: Use Cases Implementation

#### Objetivos

- Criar templates para use cases principais
- Implementar workflows pré-configurados
- Testes E2E de cada use case

#### Use Cases

1. **Book Writing**
   - Template: "Write Book" workflow
   - Steps: Outline → Chapters → Review → Compile
   - Validation: Quality scoring, consistency checks

2. **Code Project**
   - Template: "Develop API" workflow
   - Steps: Design → Implement → Test → Document
   - Validation: Tests passing, linting

3. **Research Report**
   - Template: "Research Report" workflow
   - Steps: Fetch sources → Extract → Synthesize → Write
   - Validation: Citation checks, fact verification

4. **Translation**
   - Template: "Translate Document" workflow
   - Steps: Translate → Review → Consistency check
   - Validation: Terminology consistency

5. **Code Refactoring**
   - Template: "Refactor Codebase" workflow
   - Steps: Analyze → Refactor → Test → Document
   - Validation: Tests passing, complexity reduction

#### Entregáveis

- ✅ 5 templates pré-configurados
- ✅ Workflows funcionais
- ✅ Testes E2E passando
- ✅ Documentação de uso

---

### Semana 17: Production Hardening

#### Objetivos

- Testes de carga
- Performance optimization
- Security hardening
- Documentation
- Deploy

#### Tarefas

**Dia 1-2: Performance**

- Load testing (100+ concurrent missions)
- Memory leak detection
- Performance profiling
- Optimization

**Dia 3: Security**

- Input validation
- Authentication/authorization
- Rate limiting
- Audit logging

**Dia 4: Documentation**

- User guide
- Developer guide
- API reference
- Mission templates guide

**Dia 5: Deploy**

- Production deployment
- Monitoring setup
- Rollback plan
- Launch announcement

#### Entregáveis

- ✅ Performance benchmarks
- ✅ Security audit passed
- ✅ Documentation completa
- ✅ Sistema em produção

---

## MÉTRICAS DE SUCESSO

### Dashboard Enterprise (Semana 5)

- [ ] Dashboard carrega em < 2s
- [ ] Real-time updates < 50ms latency
- [ ] Suporta 1000+ tasks sem degradação
- [ ] Bundle size < 500KB gzipped
- [ ] 80%+ test coverage

### Sistema de Orquestração (Semana 17)

- [ ] Missão "Escrever Livro" executa autonomamente
- [ ] Iteração automática até qualidade 70/100
- [ ] Multi-driver fallback funciona
- [ ] Context management suporta 100+ steps
- [ ] Cost tracking com precisão de 99%+
- [ ] Checkpoint recovery < 5min
- [ ] 100+ subtasks por missão
- [ ] Validação automática 90%+ accuracy

---

## RISCOS E MITIGAÇÕES

| Risco                                | Probabilidade | Impacto | Mitigação                                 |
| ------------------------------------ | ------------- | ------- | ----------------------------------------- |
| Memory leaks em real-time            | Média         | Alto    | Ring buffers limitados, monitoring        |
| LLM-as-judge inconsistente           | Alta          | Médio   | Temperatura baixa (0.2), múltiplos judges |
| Context window overflow              | Alta          | Alto    | Chunking, summarization, memory store     |
| Budget overrun                       | Média         | Alto    | Budget limits, cost estimation, alerts    |
| Workflow deadlocks                   | Baixa         | Alto    | Dependency validation, timeout policies   |
| Driver API changes                   | Média         | Médio   | Adapter pattern, version pinning          |
| Performance degradation (100+ tasks) | Alta          | Médio   | Concurrency limits, lazy loading          |

---

## DEPENDÊNCIAS CRÍTICAS

### Externas

- **Node.js 20.19.2+**: Runtime
- **Chrome 130+**: Browser automation
- **Socket.io 4.8+**: Real-time communication
- **Vue.js 3.5+**: Frontend framework
- **Zod 4.3.5+**: Schema validation

### APIs Externas

- **ChatGPT API** (OpenAI)
- **Gemini API** (Google)
- **Claude API** (Anthropic)
- **Ollama** (local LLMs)

### Internas

- **NERV Event Bus**: Universal transport
- **Queue System**: Task persistence
- **Kernel Loop**: Execution engine
- **Browser Pool**: Chrome instances

---

## RECURSOS NECESSÁRIOS

### Desenvolvimento

- **2 Desenvolvedores Full-Stack**: Frontend + Backend
- **1 DevOps Engineer**: Deploy, monitoring
- **1 QA Engineer**: Testes, validação

### Infraestrutura

- **Servidor de Desenvolvimento**: 8 vCPUs, 16GB RAM
- **Servidor de Produção**: 16 vCPUs, 32GB RAM
- **Chrome Instances**: 3x containers (3GB RAM cada)
- **Storage**: 100GB SSD (tasks, results, logs)

### APIs

- **ChatGPT API**: $500/mês (estimativa)
- **Gemini API**: $200/mês
- **Claude API**: $300/mês
- **Total**: ~$1000/mês (varia com uso)

---

## PRÓXIMOS PASSOS IMEDIATOS

### Semana 1, Dia 1 (Amanhã)

```bash
# 1. Criar branch de desenvolvimento
git checkout -b feature/dashboard-enterprise

# 2. Criar diretório dashboard
mkdir -p src/dashboard-ui
cd src/dashboard-ui

# 3. Inicializar projeto Vue.js 3
npm create vite@latest . -- --template vue

# 4. Instalar dependências
npm install vue-router@4 pinia@2 socket.io-client@4 axios@1 \
  chart.js@4 vue-chartjs@5 cytoscape@3 vis-timeline@7 d3@7 \
  element-plus@2 lodash-es@4 date-fns@3 uuid@10

# 5. Configurar Vite
# Editar vite.config.js (proxy, alias, build config)

# 6. Criar estrutura de pastas
mkdir -p src/{router,stores,composables,views,components,services,utils}

# 7. Commit inicial
git add .
git commit -m "feat: initialize Vue.js 3 dashboard with Vite"
git push -u origin feature/dashboard-enterprise
```

### Checklist Primeira Semana

- [ ] Projeto Vue inicializado
- [ ] Dependências instaladas
- [ ] Estrutura de diretórios criada
- [ ] Layout básico implementado
- [ ] Roteamento configurado
- [ ] Dashboard carrega em /dashboard
- [ ] Commit e push para repositório

---

## CONCLUSÃO

Este roadmap detalha a implementação completa de uma **plataforma de orquestração autônoma de LLMs
de nível enterprise** em 17 semanas.

**Principais Entregas**:

1. **Dashboard Enterprise** (Vue.js 3) com telemetria profunda
2. **Sistema de Orquestração** capaz de executar missões complexas autonomamente
3. **Validação Automática** com LLM-as-judge
4. **Multi-Driver Architecture** com fallback
5. **Context Management** para missões de longa duração
6. **Semantic Telemetry** com 100+ eventos NERV
7. **Cost Tracking** e budget management

**Status**: ✅ Planejamento completo, pronto para execução

**Data de Início Sugerida**: Imediatamente **Data de Conclusão Estimada**: +17 semanas

---

**Documento criado**: 2026-01-27 **Versão**: 1.0 **Autor**: Claude AI Assistant (Plan Mode)
**Projeto**: chatgpt-docker-puppeteer v1.1.0 → v2.0.0
