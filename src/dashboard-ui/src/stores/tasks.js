/**
 * Pinia Store: Tasks
 *
 * Gerencia estado de tarefas no dashboard.
 * - Carrega tasks da API
 * - Mantém filtros ativos
 * - Recebe updates em tempo real via Socket.io
 */

import { defineStore } from 'pinia';
import { formatHttpError, http } from '@/lib/http';

export const useTaskStore = defineStore('tasks', {
    state: () => ({
        // Lista de tasks
        tasks: [],

        // Task selecionada para detalhes
        selectedTaskId: null,

        // Filtros ativos
        filters: {
            status: null,
            priority: null,
            search: ''
        },

        // Estados de loading
        loading: false,
        loadingTask: false,

        // Erro
        error: null,

        // Estatísticas
        stats: {
            total: 0,
            by_status: {},
            by_priority: {}
        },

        // Última atualização
        lastUpdate: null
    }),

    getters: {
        /**
         * Tasks filtradas conforme filtros ativos
         */
        filteredTasks: (state) => {
            let filtered = state.tasks;

            // Filtro por status
            if (state.filters.status) {
                filtered = filtered.filter(t => t.unified_status === state.filters.status);
            }

            // Filtro por prioridade mínima
            if (state.filters.priority !== null) {
                filtered = filtered.filter(t => (t.meta?.priority || 0) >= state.filters.priority);
            }

            // Filtro por busca (ID ou prompt)
            if (state.filters.search) {
                const search = state.filters.search.toLowerCase();
                filtered = filtered.filter(t =>
                    t.meta?.id?.toLowerCase().includes(search) ||
                    t.spec?.payload?.user_message?.toLowerCase().includes(search)
                );
            }

            return filtered;
        },

        /**
         * Tasks em execução
         */
        runningTasks: (state) =>
            state.tasks.filter(t => t.unified_status === 'RUNNING'),

        /**
         * Tasks pendentes
         */
        pendingTasks: (state) =>
            state.tasks.filter(t => t.unified_status === 'PENDING'),

        /**
         * Tasks concluídas
         */
        completedTasks: (state) =>
            state.tasks.filter(t => t.unified_status === 'DONE'),

        /**
         * Tasks com erro
         */
        failedTasks: (state) =>
            state.tasks.filter(t => t.unified_status === 'FAILED'),

        /**
         * Busca task por ID
         */
        taskById: (state) => (id) =>
            state.tasks.find(t => t.meta?.id === id || t.id === id),

        /**
         * Task selecionada
         */
        selectedTask: (state) =>
            state.tasks.find(t => t.meta?.id === state.selectedTaskId),

        /**
         * Contadores por status
         */
        statusCounts: (state) => ({
            RUNNING: state.tasks.filter(t => t.unified_status === 'RUNNING').length,
            PENDING: state.tasks.filter(t => t.unified_status === 'PENDING').length,
            DONE: state.tasks.filter(t => t.unified_status === 'DONE').length,
            FAILED: state.tasks.filter(t => t.unified_status === 'FAILED').length,
            PAUSED: state.tasks.filter(t => t.unified_status === 'PAUSED').length,
            CANCELLED: state.tasks.filter(t => t.unified_status === 'CANCELLED').length
        })
    },

    actions: {
        /**
         * Carrega todas as tasks da API
         */
        async fetchTasks() {
            this.loading = true;
            this.error = null;

            try {
                const response = await http.get('/api/dashboard/tasks');
                this.tasks = response.data.tasks || [];
                this.lastUpdate = Date.now();
            } catch (error) {
                this.error = formatHttpError(error).message;
                console.error('[TaskStore] Erro ao carregar tasks:', error);
            } finally {
                this.loading = false;
            }
        },

        /**
         * Carrega uma task específica
         */
        async fetchTask(taskId) {
            this.loadingTask = true;

            try {
                const response = await http.get(`/api/dashboard/tasks/${taskId}`);
                const task = response.data.task;

                // Atualiza na lista local
                const index = this.tasks.findIndex(t => t.meta?.id === taskId);
                if (index !== -1) {
                    this.tasks[index] = task;
                } else {
                    this.tasks.push(task);
                }

                return task;
            } catch (error) {
                this.error = formatHttpError(error).message;
                throw error;
            } finally {
                this.loadingTask = false;
            }
        },

        /**
         * Carrega estatísticas de tasks
         */
        async fetchStats() {
            try {
                const response = await http.get('/api/dashboard/tasks-stats');
                this.stats = response.data.stats || this.stats;
            } catch (error) {
                console.error('[TaskStore] Erro ao carregar stats:', error);
            }
        },

        /**
         * Cria uma nova task
         */
        async createTask(taskData) {
            try {
                const response = await http.post('/api/tasks', taskData);
                // Recarrega lista
                await this.fetchTasks();
                return response.data;
            } catch (error) {
                this.error = formatHttpError(error).message;
                throw error;
            }
        },

        /**
         * Atualiza uma task
         */
        async updateTask(taskId, taskData) {
            try {
                const response = await http.put(`/api/tasks/${taskId}`, taskData);

                // Atualiza na lista local
                const index = this.tasks.findIndex(t => t.meta?.id === taskId);
                if (index !== -1) {
                    this.tasks[index] = { ...this.tasks[index], ...taskData };
                }

                return response.data;
            } catch (error) {
                this.error = formatHttpError(error).message;
                throw error;
            }
        },

        /**
         * Remove uma task
         */
        async deleteTask(taskId) {
            try {
                await http.delete(`/api/tasks/${taskId}`);
                this.tasks = this.tasks.filter(t => t.meta?.id !== taskId);
            } catch (error) {
                this.error = formatHttpError(error).message;
                throw error;
            }
        },

        /**
         * Retry de tasks com falha
         */
        async retryFailed() {
            try {
                const response = await http.post('/api/tasks/retry-failed');
                // Recarrega lista
                await this.fetchTasks();
                return response.data;
            } catch (error) {
                this.error = formatHttpError(error).message;
                throw error;
            }
        },

        /**
         * Limpa a fila
         */
        async clearQueue() {
            try {
                const response = await http.post('/api/tasks/clear');
                // Recarrega lista
                await this.fetchTasks();
                return response.data;
            } catch (error) {
                this.error = formatHttpError(error).message;
                throw error;
            }
        },

        /**
         * Handler para updates em tempo real via Socket.io
         */
        handleTaskUpdate(data) {
            const { taskId, state } = data;

            const index = this.tasks.findIndex(t => t.meta?.id === taskId);

            if (index !== -1) {
                // Atualiza task existente
                this.tasks[index] = {
                    ...this.tasks[index],
                    runtime_state: state,
                    unified_status: state.status || this.tasks[index].unified_status,
                    has_runtime_data: true
                };
            }

            this.lastUpdate = Date.now();
        },

        /**
         * Handler para batch de updates
         */
        handleTaskUpdatesBatch(data) {
            const { updates } = data;

            for (const update of updates) {
                this.handleTaskUpdate(update);
            }
        },

        /**
         * Define task selecionada
         */
        selectTask(taskId) {
            this.selectedTaskId = taskId;
        },

        /**
         * Atualiza filtros
         */
        setFilters(filters) {
            this.filters = { ...this.filters, ...filters };
        },

        /**
         * Limpa filtros
         */
        clearFilters() {
            this.filters = {
                status: null,
                priority: null,
                search: ''
            };
        },

        /**
         * Limpa erro
         */
        clearError() {
            this.error = null;
        }
    }
});
