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

function _msToIso(ms) {
    const n = Number(ms);
    if (!Number.isFinite(n) || n <= 0) return null;
    try {
        return new Date(n).toISOString();
    } catch {
        return null;
    }
}

function _listItemToLegacyTask(item) {
    if (!item || typeof item !== 'object') return null;

    const createdAtIso = _msToIso(item.timestamps?.created_at_ms);
    const updatedAtIso = _msToIso(item.timestamps?.updated_at_ms);

    return {
        __source: 'list',
        id: item.id,
        stage: item.stage,
        unified_status: item.unified_status || item.status,
        latest_attempt_id: item.latest_attempt_id || null,
        runtime_state: null,
        has_runtime_data: false,
        meta: {
            id: item.id,
            priority: item.priority ?? 0,
            created_at: createdAtIso,
            updated_at: updatedAtIso,
            agent: item.target || null,
            mission_id: item.mission_id || null,
            parent_id: item.parent_id || null,
            workflow_id: item.workflow_id || null,
        },
        spec: {
            target: item.target || 'auto',
            model: item.model || null,
            payload: {
                system_message: item.spec_system_message_preview || '',
                user_message: item.spec_user_message_preview || '',
            },
        },
        state: {
            status: item.unified_status || item.status || 'UNKNOWN',
            blocked_reason: item.blocked_reason || null,
            blocked_at: _msToIso(item.blocked_at_ms),
        },
    };
}

function _mergeTask(existing, incoming) {
    if (!existing) return incoming;
    if (!incoming) return existing;

    // If we already have a full detail, avoid overwriting prompt/content with previews.
    const keepDetail = existing.__source === 'detail' && incoming.__source === 'list';

    const merged = {
        ...existing,
        ...incoming,
        meta: { ...(existing.meta || {}), ...(incoming.meta || {}) },
        state: { ...(existing.state || {}), ...(incoming.state || {}) },
    };

    if (!keepDetail) {
        merged.spec = {
            ...(existing.spec || {}),
            ...(incoming.spec || {}),
            payload: { ...(existing.spec?.payload || {}), ...(incoming.spec?.payload || {}) },
        };
    } else {
        // Preserve full spec; still mirror target/model from list for consistency.
        merged.spec = {
            ...(existing.spec || {}),
            target: incoming.spec?.target || existing.spec?.target,
            model: incoming.spec?.model || existing.spec?.model,
            payload: { ...(existing.spec?.payload || {}) },
        };
    }

    // Unified status should always be updated.
    merged.unified_status = incoming.unified_status || incoming.status || existing.unified_status;
    merged.state = merged.state || {};
    merged.state.status = merged.unified_status;

    return merged;
}

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
        lastUpdate: null,

        // Cursor de paginação do snapshot
        nextCursor: null,
        hasMore: false,
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
                // Cursor-based SSOT feed (fetch pages until exhausted; capped defensively).
                const limit = 200;
                let cursor = null;
                const all = [];
                let pages = 0;

                while (pages < 50) {
                    const response = await http.get('/api/dashboard/tasks', {
                        params: {
                            limit,
                            cursor: cursor || undefined,
                        },
                    });

                    const items = response.data?.data?.items || [];
                    for (const item of items) {
                        const t = _listItemToLegacyTask(item);
                        if (t) all.push(t);
                    }

                    const meta = response.data?.meta || {};
                    cursor = meta.next_cursor || null;
                    pages += 1;

                    if (!meta.has_more) {
                        this.nextCursor = null;
                        this.hasMore = false;
                        break;
                    }

                    this.nextCursor = cursor;
                    this.hasMore = true;
                    if (!cursor) break;
                }

                this.tasks = all;
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
                const response = await http.get(`/api/dashboard/tasks/${taskId}`, {
                    params: { include: 'attempts,events,dependencies,children,workflow,artifacts' },
                });
                const task = response.data?.data?.task;
                if (task) {
                    task.__source = 'detail';
                }

                // Atualiza na lista local
                const index = this.tasks.findIndex(t => t.meta?.id === taskId);
                if (index !== -1) {
                    this.tasks[index] = _mergeTask(this.tasks[index], task);
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
                const data = response.data?.data || null;
                if (data && typeof data === 'object') {
                    this.stats = {
                        total: data.total ?? 0,
                        by_status: data.by_status ?? {},
                        by_priority: this.stats.by_priority,
                    };
                }
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
            const taskId = data?.taskId || data?.task?.id || data?.id || null;
            const state = data?.state || null;
            const taskListItem = data?.task || null;

            if (!taskId) return;

            const index = this.tasks.findIndex(t => t.meta?.id === taskId || t.id === taskId);

            if (index !== -1) {
                let incoming = null;
                if (taskListItem) {
                    incoming = _listItemToLegacyTask(taskListItem);
                }
                const merged = _mergeTask(this.tasks[index], incoming);

                if (state && typeof state === 'object') {
                    merged.runtime_state = state;
                    merged.unified_status = state.status || merged.unified_status;
                    merged.has_runtime_data = true;
                    merged.state = merged.state || {};
                    merged.state.status = merged.unified_status;
                }

                this.tasks[index] = merged;
            } else if (taskListItem) {
                const t = _listItemToLegacyTask(taskListItem);
                if (t) this.tasks.push(t);
            }

            this.lastUpdate = Date.now();
        },

        /**
         * Handler para batch de updates
         */
        handleTaskUpdatesBatch(data) {
            const updates = data?.updates || [];

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
