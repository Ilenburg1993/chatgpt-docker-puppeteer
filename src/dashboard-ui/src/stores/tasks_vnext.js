import { defineStore } from 'pinia';
import { http } from '@/lib/http';
import { formatHttpError } from '@/lib/http';

function _normalizeUpper(value) {
    return value ? String(value).toUpperCase().trim() : null;
}

function _normalizeLower(value) {
    return value ? String(value).toLowerCase().trim() : null;
}

function _buildQueryParams(filters, cursor, limit) {
    const params = { limit: limit || 200 };
    if (cursor) params.cursor = cursor;

    const status = _normalizeUpper(filters?.status);
    const stage = _normalizeUpper(filters?.stage);
    const missionId = filters?.mission_id ? String(filters.mission_id).trim() : null;
    const target = _normalizeLower(filters?.target);
    const blocked = filters?.blocked;
    const search = filters?.search ? String(filters.search) : null;
    const priorityGte = filters?.priority_gte;

    if (status) params.status = status;
    if (stage) params.stage = stage;
    if (missionId) params.mission_id = missionId;
    if (target) params.target = target;
    if (search) params.search = search;
    if (blocked === true) params.blocked = true;
    if (blocked === false) params.blocked = false;
    if (priorityGte !== null && priorityGte !== undefined && String(priorityGte) !== '') params.priority_gte = priorityGte;

    return params;
}

function _upsertById(list, byId, item) {
    if (!item?.id) return;
    const id = String(item.id);
    const existing = byId.get(id);
    if (!existing) {
        byId.set(id, item);
        list.unshift(item);
        return;
    }
    const idx = list.findIndex(t => t.id === id);
    const merged = { ...existing, ...item };
    byId.set(id, merged);
    if (idx >= 0) {
        list[idx] = merged;
    }
}

function _newIdempotencyKey(prefix = 'ui') {
    return `${prefix}:${Date.now()}:${Math.random().toString(16).slice(2)}`;
}

async function _dispatchControlCommand(command, payload) {
    const idempotencyKey = payload?.idempotency_key || _newIdempotencyKey('ui');
    const res = await http.post('/api/control/commands', {
        command,
        payload: {
            ...payload,
            idempotency_key: idempotencyKey,
        },
    });
    return res.data;
}

export const useTasksVNextStore = defineStore('tasks_vnext', {
    state: () => ({
        items: /** @type {any[]} */ ([]),
        byId: /** @type {Map<string, any>} */ (new Map()),
        taskIdsByMissionId: /** @type {Map<string, string[]>} */ (new Map()),
        cursor: null,
        hasMore: false,
        loading: false,
        loadingMore: false,
        error: null,
        filters: {
            status: null,
            stage: null,
            mission_id: null,
            target: null,
            blocked: null, // true|false|null
            search: '',
            priority_gte: null,
        },
    }),
    getters: {
        getById: state => id => state.byId.get(String(id)) || null,
        getTaskIdsByMissionId: state => missionId => state.taskIdsByMissionId.get(String(missionId || '')) || [],
        getTasksByMissionId: state => missionId => {
            const ids = state.taskIdsByMissionId.get(String(missionId || '')) || [];
            return ids.map(id => state.byId.get(id)).filter(Boolean);
        },
    },
    actions: {
        rebuildMissionIndex() {
            const next = new Map();
            for (const task of this.items) {
                const missionId = task?.mission_ref?.id || task?.mission_id || task?.meta?.mission_id || null;
                if (!missionId) continue;
                const key = String(missionId);
                const list = next.get(key) || [];
                list.push(String(task.id));
                next.set(key, list);
            }
            this.taskIdsByMissionId = next;
        },

        reset() {
            this.items = [];
            this.byId = new Map();
            this.taskIdsByMissionId = new Map();
            this.cursor = null;
            this.hasMore = false;
            this.error = null;
        },

        async fetchFirstPage({ limit = 200 } = {}) {
            this.loading = true;
            this.error = null;
            try {
                const res = await http.get('/api/dashboard/tasks', {
                    params: _buildQueryParams(this.filters, null, limit),
                });
                const items = res.data?.data?.items || [];
                const meta = res.data?.meta || {};

                this.items = [];
                this.byId = new Map();
                for (const it of items) {
                    if (!it?.id) continue;
                    this.byId.set(String(it.id), it);
                    this.items.push(it);
                }
                this.rebuildMissionIndex();

                this.cursor = meta.next_cursor || null;
                this.hasMore = Boolean(meta.has_more);
            } catch (err) {
                this.error = formatHttpError(err).message;
            } finally {
                this.loading = false;
            }
        },

        async fetchNextPage({ limit = 200 } = {}) {
            if (!this.hasMore || !this.cursor || this.loadingMore) return;
            this.loadingMore = true;
            try {
                const res = await http.get('/api/dashboard/tasks', {
                    params: _buildQueryParams(this.filters, this.cursor, limit),
                });
                const items = res.data?.data?.items || [];
                const meta = res.data?.meta || {};

                for (const it of items) {
                    if (!it?.id) continue;
                    this.byId.set(String(it.id), it);
                    this.items.push(it);
                }
                this.rebuildMissionIndex();

                this.cursor = meta.next_cursor || null;
                this.hasMore = Boolean(meta.has_more);
            } catch (err) {
                this.error = formatHttpError(err).message;
            } finally {
                this.loadingMore = false;
            }
        },

        applyRealtimeUpdatesBatch(payload) {
            const updates = payload?.updates || [];
            for (const u of updates) {
                const task = u?.task || null;
                if (!task?.id) continue;
                _upsertById(this.items, this.byId, task);
            }
            this.rebuildMissionIndex();
        },

        async createTask(payload, reason = 'Criação de task via control plane') {
            return _dispatchControlCommand('TASK_CREATE', {
                task: payload || {},
                reason,
            });
        },

        async patchTask(taskId, patch, reason = 'Edição de task via control plane', ifVersion = null) {
            const current = this.getById(taskId);
            const version = ifVersion ?? current?.timestamps?.updated_at_ms ?? current?.updated_at_ms ?? null;
            if (version === null || version === undefined) {
                throw new Error('if_version ausente para TASK_PATCH. Recarregue a task e tente novamente.');
            }
            return _dispatchControlCommand('TASK_PATCH', {
                task_id: String(taskId),
                patch: patch || {},
                reason,
                if_version: version,
            });
        },

        async reassignTaskMission(taskId, missionId, reason = 'Reatribuição de missão da task', ifVersion = null) {
            const current = this.getById(taskId);
            const version = ifVersion ?? current?.timestamps?.updated_at_ms ?? current?.updated_at_ms ?? null;
            if (version === null || version === undefined) {
                throw new Error('if_version ausente para TASK_REASSIGN_MISSION. Recarregue a task e tente novamente.');
            }
            return _dispatchControlCommand('TASK_REASSIGN_MISSION', {
                task_id: String(taskId),
                mission_id: missionId ? String(missionId) : null,
                reason,
                if_version: version,
            });
        },

        async setDependencies(taskId, dependencies, reason = 'Atualização de dependências da task', ifVersion = null) {
            return this.patchTask(
                taskId,
                { dependencies: Array.isArray(dependencies) ? dependencies : [] },
                reason,
                ifVersion
            );
        },

        async taskAction(taskId, action, reason = null, ifVersion = null) {
            const normalizedAction = String(action || '')
                .trim()
                .toUpperCase();
            const command = `TASK_${normalizedAction}`;
            if (!['TASK_PAUSE', 'TASK_RESUME', 'TASK_UNBLOCK', 'TASK_RETRY', 'TASK_CANCEL'].includes(command)) {
                throw new Error(`Ação de task não suportada: ${action}`);
            }
            const payload = {
                task_id: String(taskId),
                reason: reason || `Ação ${normalizedAction} na task`,
            };
            if (ifVersion !== null && ifVersion !== undefined) payload.if_version = ifVersion;
            return _dispatchControlCommand(command, payload);
        },

        async bulkAction({ ids, action, params = {}, reason = null }) {
            const normalizedAction = String(action || '')
                .trim()
                .toUpperCase();
            if (ids.length === 1 && ['PAUSE', 'RESUME', 'UNBLOCK', 'RETRY', 'CANCEL'].includes(normalizedAction)) {
                return this.taskAction(ids[0], normalizedAction, reason || `Ação ${normalizedAction} no dashboard`);
            }

            let bulkAction = normalizedAction;
            const bulkParams = /** @type {Record<string, any>} */ ({ ...(params || {}) });

            if (normalizedAction === 'APPROVE') {
                bulkAction = 'PATCH';
                bulkParams.stage = 'READY';
                bulkParams.status = 'PENDING';
            } else if (normalizedAction === 'REJECT') {
                bulkAction = 'PATCH';
                bulkParams.stage = 'REJECTED';
            } else if (normalizedAction === 'SET_STAGE') {
                bulkAction = 'SET_STAGE';
            } else if (normalizedAction === 'SET_TARGET') {
                bulkAction = 'SET_TARGET';
            } else if (normalizedAction === 'SET_PRIORITY') {
                bulkAction = 'SET_PRIORITY';
            } else if (normalizedAction === 'SET_EXECUTE_AFTER') {
                bulkAction = 'SET_EXECUTE_AFTER';
            } else if (normalizedAction === 'SET_DEPENDENCIES') {
                bulkAction = 'SET_DEPENDENCIES';
            } else if (normalizedAction === 'REASSIGN_MISSION') {
                bulkAction = 'REASSIGN_MISSION';
            }

            return _dispatchControlCommand('TASK_BULK_ACTION', {
                ids,
                action: bulkAction,
                params: bulkParams,
                reason: reason || `Ação em lote ${normalizedAction} no dashboard`,
            });
        },
    },
});
