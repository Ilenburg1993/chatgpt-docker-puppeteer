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

export const useTasksVNextStore = defineStore('tasks_vnext', {
    state: () => ({
        items: /** @type {any[]} */ ([]),
        byId: /** @type {Map<string, any>} */ (new Map()),
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
    },
    actions: {
        reset() {
            this.items = [];
            this.byId = new Map();
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
        },

        async bulkAction({ ids, action, params = {} }) {
            const res = await http.post('/api/tasks/bulk', { ids, action, params });
            return res.data;
        },
    },
});

