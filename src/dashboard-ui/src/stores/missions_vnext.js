import { defineStore } from 'pinia';
import { http, formatHttpError } from '@/lib/http';

function _normalizeUpper(value) {
    return value ? String(value).toUpperCase().trim() : null;
}

function _buildListParams(filters, cursor, limit) {
    const params = { limit: limit || 100 };
    if (cursor) params.cursor = cursor;
    const status = _normalizeUpper(filters?.status);
    const autonomy = _normalizeUpper(filters?.autonomy_mode);
    const search = filters?.search ? String(filters.search) : null;
    if (status) params.status = status;
    if (autonomy) params.autonomy_mode = autonomy;
    if (search) params.search = search;
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
    const idx = list.findIndex(m => m.id === id);
    const merged = { ...existing, ...item };
    byId.set(id, merged);
    if (idx >= 0) list[idx] = merged;
}

export const useMissionsVNextStore = defineStore('missions_vnext', {
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
            autonomy_mode: null,
            search: '',
        },
        selected: null,
        selectedTasks: [],
        selectedProposals: [],
        selectedGraph: null,
        selectedEvents: [],
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

        async fetchFirstPage({ limit = 100 } = {}) {
            this.loading = true;
            this.error = null;
            try {
                const res = await http.get('/api/dashboard/missions', {
                    params: _buildListParams(this.filters, null, limit),
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

        async fetchNextPage({ limit = 100 } = {}) {
            if (!this.hasMore || !this.cursor || this.loadingMore) return;
            this.loadingMore = true;
            try {
                const res = await http.get('/api/dashboard/missions', {
                    params: _buildListParams(this.filters, this.cursor, limit),
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
                const mission = u?.mission || null;
                if (!mission?.id) continue;
                _upsertById(this.items, this.byId, mission);
            }
        },

        async fetchDetail(missionId) {
            const res = await http.get(`/api/dashboard/missions/${missionId}`);
            this.selected = res.data?.data?.mission || null;
            return this.selected;
        },

        async fetchMissionTasks(missionId, { stage = null, status = null, limit = 200, cursor = null } = {}) {
            const params = { limit };
            if (cursor) params.cursor = cursor;
            if (stage) params.stage = stage;
            if (status) params.status = status;
            const res = await http.get(`/api/dashboard/missions/${missionId}/tasks`, { params });
            this.selectedTasks = res.data?.data?.items || [];
            return res.data;
        },

        async fetchMissionProposals(missionId, { limit = 200, cursor = null } = {}) {
            const params = { limit };
            if (cursor) params.cursor = cursor;
            const res = await http.get(`/api/dashboard/missions/${missionId}/proposals`, { params });
            this.selectedProposals = res.data?.data?.items || [];
            return res.data;
        },

        async fetchMissionGraph(missionId) {
            const res = await http.get(`/api/dashboard/missions/${missionId}/graph`);
            this.selectedGraph = res.data?.data || null;
            return this.selectedGraph;
        },

        async fetchMissionEvents(missionId, { limit = 200, cursor = null } = {}) {
            const params = { limit };
            if (cursor) params.cursor = cursor;
            const res = await http.get(`/api/dashboard/missions/${missionId}/events`, { params });
            this.selectedEvents = res.data?.data?.items || [];
            return res.data;
        },

        // Mutations (mission domain)
        async createMission(payload) {
            const res = await http.post('/api/missions', payload);
            return res.data;
        },
        async patchMission(missionId, payload) {
            const res = await http.patch(`/api/missions/${missionId}`, payload);
            return res.data;
        },
        async executeMission(missionId) {
            const res = await http.post(`/api/missions/${missionId}/execute`);
            return res.data;
        },
        async pauseMission(missionId) {
            const res = await http.post(`/api/missions/${missionId}/pause`);
            return res.data;
        },
        async resumeMission(missionId) {
            const res = await http.post(`/api/missions/${missionId}/resume`);
            return res.data;
        },
        async cancelMission(missionId) {
            const res = await http.delete(`/api/missions/${missionId}`);
            return res.data;
        },
        async updatePolicy(missionId, { autonomy_mode, policy }) {
            const res = await http.post(`/api/missions/${missionId}/policy`, { autonomy_mode, policy });
            return res.data;
        },
        async addFeedback(missionId, feedback) {
            const res = await http.post(`/api/missions/${missionId}/feedback`, { feedback });
            return res.data;
        },
        async suggestTasks(missionId, payload = {}) {
            const res = await http.post(`/api/missions/${missionId}/suggest-tasks`, payload);
            return res.data;
        },
        async rejectProposals(missionId, payload) {
            const res = await http.post(`/api/missions/${missionId}/proposals/reject`, payload);
            return res.data;
        },
    },
});

