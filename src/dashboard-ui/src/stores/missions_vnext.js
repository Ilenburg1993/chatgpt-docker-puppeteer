import { defineStore } from 'pinia';
import { http, formatHttpError } from '@/lib/http';
import { useTasksVNextStore } from '@/stores/tasks_vnext';

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

async function _dispatchControlCommand(command, payload) {
    const idempotencyKey = payload?.idempotency_key || `ui:${Date.now()}:${Math.random().toString(16).slice(2)}`;
    const response = await http.post('/api/control/commands', {
        command,
        payload: {
            ...payload,
            idempotency_key: idempotencyKey,
        },
    });
    return response.data;
}

async function _refreshTasksSliceForMission(missionId) {
    try {
        const tasks = useTasksVNextStore();
        const selectedMissionFilter = tasks.filters?.mission_id ? String(tasks.filters.mission_id) : null;
        if (!selectedMissionFilter || selectedMissionFilter === String(missionId)) {
            await tasks.fetchFirstPage({ limit: 200 });
        }
    } catch (_) {
        // best effort para manter stores sincronizadas sem travar fluxo principal
    }
}

async function _refreshMissionSlice() {
    try {
        const missions = useMissionsVNextStore();
        await missions.fetchFirstPage({ limit: 100 });
    } catch (_) {
        // best effort
    }
}

async function _syncMissionAndTasksContext(missionId) {
    await Promise.allSettled([_refreshTasksSliceForMission(missionId), _refreshMissionSlice()]);
}

/** Constante/valor exportado: useMissionsVNextStore. */
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
        async createMission(payload, reason = 'Criação de missão via control plane') {
            const result = await _dispatchControlCommand('MISSION_CREATE', {
                mission: payload || {},
                reason,
            });
            await _refreshMissionSlice();
            return result;
        },
        async patchMission(missionId, payload) {
            const mission = this.getById(missionId) || this.selected || null;
            const ifVersion = mission?.updated_at_ms || null;
            const result = await _dispatchControlCommand('MISSION_PATCH', {
                mission_id: missionId,
                if_version: ifVersion,
                reason: payload?.reason || 'Atualização manual da missão no dashboard',
                patch: payload,
            });
            await _syncMissionAndTasksContext(missionId);
            return result;
        },
        async executeMission(missionId, { reason = 'Execução manual da missão' } = {}) {
            const result = await _dispatchControlCommand('MISSION_EXECUTE', {
                mission_id: missionId,
                reason,
            });
            await _syncMissionAndTasksContext(missionId);
            return result;
        },
        async pauseMission(missionId, { reason = 'Pausa manual da missão' } = {}) {
            const result = await _dispatchControlCommand('MISSION_PAUSE', {
                mission_id: missionId,
                reason,
            });
            await _syncMissionAndTasksContext(missionId);
            return result;
        },
        async resumeMission(missionId, { reason = 'Retomada manual da missão' } = {}) {
            const result = await _dispatchControlCommand('MISSION_RESUME', {
                mission_id: missionId,
                reason,
            });
            await _syncMissionAndTasksContext(missionId);
            return result;
        },
        async cancelMission(missionId, { reason = 'Cancelamento manual da missão' } = {}) {
            const result = await _dispatchControlCommand('MISSION_CANCEL', {
                mission_id: missionId,
                reason,
            });
            await _syncMissionAndTasksContext(missionId);
            return result;
        },
        async updatePolicy(missionId, { autonomy_mode, policy, reason = 'Atualização de policy/autonomia da missão' }) {
            const mission = this.getById(missionId) || this.selected || null;
            const ifVersion = mission?.updated_at_ms || null;
            const result = await _dispatchControlCommand('MISSION_SET_POLICY', {
                mission_id: missionId,
                if_version: ifVersion,
                autonomy_mode,
                policy,
                reason,
            });
            await _syncMissionAndTasksContext(missionId);
            return result;
        },
        async ensureMissionContext(missionId) {
            await this.fetchDetail(missionId);
            await this.fetchMissionTasks(missionId, { limit: 100 });
            return {
                mission: this.selected,
                tasks: this.selectedTasks,
            };
        },
        async addFeedback(missionId, feedback) {
            throw new Error(
                `Operação desativada no hard cutover vNext: addFeedback(${missionId}). Use command flow/control plane.`
            );
        },
        async suggestTasks(missionId, payload = {}) {
            throw new Error(
                `Operação desativada no hard cutover vNext: suggestTasks(${missionId}). Use command flow/control plane.`
            );
        },
        async rejectProposals(missionId, payload) {
            throw new Error(
                `Operação desativada no hard cutover vNext: rejectProposals(${missionId}). Use command flow/control plane.`
            );
        },
    },
});
