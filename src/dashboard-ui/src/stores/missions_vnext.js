// @ts-check
import { defineStore } from 'pinia';
import { http, formatHttpError } from '@/lib/http';
import { useTasksVNextStore } from '@/stores/tasks_vnext';

function _normalizeUpper(/** @type {any} */ value) {
    return value ? String(value).toUpperCase().trim() : null;
}

function _buildListParams(/** @type {any} */ filters, /** @type {any} */ cursor, /** @type {any} */ limit) {
    const params = /** @type {any} */ ({ limit: limit || 100 });
    if (cursor) params.cursor = cursor;
    const status = _normalizeUpper(filters?.status);
    const autonomy = _normalizeUpper(filters?.autonomy_mode);
    const search = filters?.search ? String(filters.search) : null;
    if (status) params.status = status;
    if (autonomy) params.autonomy_mode = autonomy;
    if (search) params.search = search;
    return params;
}

function _upsertById(/** @type {any} */ list, /** @type {any} */ byId, /** @type {any} */ item) {
    if (!item?.id) return;
    const id = String(item.id);
    const existing = byId.get(id);
    if (!existing) {
        byId.set(id, item);
        list.unshift(item);
        return;
    }
    const idx = list.findIndex((/** @type {any} */ m) => m.id === id);
    const merged = { ...existing, ...item };
    byId.set(id, merged);
    if (idx >= 0) list[idx] = merged;
}

async function _dispatchControlCommand(/** @type {any} */ command, /** @type {any} */ payload) {
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

async function _refreshTasksSliceForMission(/** @type {any} */ missionId) {
    try {
        const tasks = useTasksVNextStore();
        const selectedMissionFilter = tasks.filters?.mission_id ? String(tasks.filters.mission_id) : null;
        if (!selectedMissionFilter || selectedMissionFilter === String(missionId)) {
            await tasks.fetchFirstPage({ limit: 200 });
        }
    } catch (/** @type {any} */ _) {
        // best effort para manter stores sincronizadas sem travar fluxo principal
    }
}

async function _refreshMissionSlice() {
    try {
        const missions = useMissionsVNextStore();
        await missions.fetchFirstPage({ limit: 100 });
    } catch (/** @type {any} */ _) {
        // best effort
    }
}

async function _syncMissionAndTasksContext(/** @type {any} */ missionId) {
    await Promise.allSettled([_refreshTasksSliceForMission(missionId), _refreshMissionSlice()]);
}

/**
 * @typedef {object} ResolveIfVersionMission
 * @property {*} _ Propriedades definidas em runtime.
 */
/**
 * Deriva o ifVersion do objeto de missão retornado pela API.
 * A API retorna `updated_at` como ISO string; convertemos para ms via Date.parse
 * para enviar ao control plane (que compara com updated_at_ms no DB).
 * @param {ResolveIfVersionMission} mission
 * @returns {number|null}
 */
function _resolveIfVersion(/** @type {any} */ mission) {
    if (!mission) return null;
    // Prefer explicit ms field (some API shapes include both)
    if (typeof mission.updated_at_ms === 'number' && mission.updated_at_ms > 0) {
        return mission.updated_at_ms;
    }
    // Fallback: parse ISO string returned by mission_repo._rowToMission
    const iso = mission.updated_at;
    if (!iso) return null;
    const ms = Date.parse(String(iso));
    return Number.isFinite(ms) ? ms : null;
}

/** Constante/valor exportado: useMissionsVNextStore. */
export const useMissionsVNextStore = defineStore('missions_vnext', {
    state: () => ({
        items: /** @type {unknown[]} */ ([]),
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
        selectedProgress: /** @type {unknown} */ (null),
        selectedTasks: [],
        selectedProposals: [],
        selectedGraph: null,
        selectedEvents: [],
    }),
    getters: {
        getById: state => (/** @type {any} */ id) => state.byId.get(String(/** @type {any} */ id)) || null,
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
            } catch (/** @type {any} */ _rawErr) {
    const err = /** @type {any} */ (_rawErr);
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
            } catch (/** @type {any} */ _rawErr) {
    const err = /** @type {any} */ (_rawErr);
                this.error = formatHttpError(err).message;
            } finally {
                this.loadingMore = false;
            }
        },

        applyRealtimeUpdatesBatch(/** @type {any} */ payload) {
            const updates = payload?.updates || [];
            for (const u of updates) {
                const mission = u?.mission || null;
                if (!mission?.id) continue;
                _upsertById(this.items, this.byId, mission);
            }
        },

        async fetchDetail(/** @type {any} */ missionId) {
            const res = await http.get(`/api/dashboard/missions/${missionId}`);
            this.selected = res.data?.data?.mission || null;
            return this.selected;
        },

        async fetchMissionProgress(/** @type {any} */ missionId) {
            try {
                const res = await http.get(`/api/missions/${missionId}/progress`);
                this.selectedProgress = {
                    progress: res.data?.progress || null,
                    live_counts: res.data?.live_counts || null,
                };
                return this.selectedProgress;
            } catch (/** @type {any} */ _) {
                this.selectedProgress = null;
                return null;
            }
        },

        async fetchMissionTasks(/** @type {any} */ missionId, { stage = null, status = null, limit = 200, cursor = null } = {}) {
            const params = /** @type {any} */ ({ limit });
            if (cursor) params.cursor = cursor;
            if (stage) params.stage = stage;
            if (status) params.status = status;
            const res = await http.get(`/api/dashboard/missions/${missionId}/tasks`, { params });
            this.selectedTasks = res.data?.data?.items || [];
            return res.data;
        },

        async fetchMissionProposals(/** @type {any} */ missionId, { limit = 200, cursor = null } = {}) {
            const params = /** @type {any} */ ({ limit });
            if (cursor) params.cursor = cursor;
            const res = await http.get(`/api/dashboard/missions/${missionId}/proposals`, { params });
            this.selectedProposals = res.data?.data?.items || [];
            return res.data;
        },

        async fetchMissionGraph(/** @type {any} */ missionId) {
            const res = await http.get(`/api/dashboard/missions/${missionId}/graph`);
            this.selectedGraph = res.data?.data || null;
            return this.selectedGraph;
        },

        async fetchMissionEvents(/** @type {any} */ missionId, { limit = 200, cursor = null } = {}) {
            const params = /** @type {any} */ ({ limit });
            if (cursor) params.cursor = cursor;
            const res = await http.get(`/api/dashboard/missions/${missionId}/events`, { params });
            this.selectedEvents = res.data?.data?.items || [];
            return res.data;
        },

        // Mutations (mission domain)
        async createMission(/** @type {any} */ payload, reason = 'Criação de missão via control plane') {
            const result = await _dispatchControlCommand('MISSION_CREATE', {
                mission: payload || {},
                reason,
            });
            await _refreshMissionSlice();
            return result;
        },
        async patchMission(/** @type {any} */ missionId, /** @type {any} */ payload) {
            const mission = this.getById(missionId) || this.selected || null;
            // BUG-UI-1 fix: mission_repo returns `updated_at` (ISO string), not `updated_at_ms`.
            // Use _resolveIfVersion to correctly derive the ms timestamp for optimistic locking.
            const ifVersion = _resolveIfVersion(mission);
            const result = await _dispatchControlCommand('MISSION_PATCH', {
                mission_id: missionId,
                if_version: ifVersion,
                reason: payload?.reason || 'Atualização manual da missão no dashboard',
                patch: payload,
            });
            await _syncMissionAndTasksContext(missionId);
            return result;
        },
        async executeMission(/** @type {any} */ missionId, { reason = 'Execução manual da missão' } = {}) {
            const result = await _dispatchControlCommand('MISSION_EXECUTE', {
                mission_id: missionId,
                reason,
            });
            await _syncMissionAndTasksContext(missionId);
            return result;
        },
        async pauseMission(/** @type {any} */ missionId, { reason = 'Pausa manual da missão' } = {}) {
            const result = await _dispatchControlCommand('MISSION_PAUSE', {
                mission_id: missionId,
                reason,
            });
            await _syncMissionAndTasksContext(missionId);
            return result;
        },
        async resumeMission(/** @type {any} */ missionId, { reason = 'Retomada manual da missão' } = {}) {
            const result = await _dispatchControlCommand('MISSION_RESUME', {
                mission_id: missionId,
                reason,
            });
            await _syncMissionAndTasksContext(missionId);
            return result;
        },
        async cancelMission(/** @type {any} */ missionId, { reason = 'Cancelamento manual da missão' } = {}) {
            const result = await _dispatchControlCommand('MISSION_CANCEL', {
                mission_id: missionId,
                reason,
            });
            await _syncMissionAndTasksContext(missionId);
            return result;
        },
        async updatePolicy(/** @type {any} */ missionId, /** @type {any} */ { autonomy_mode, policy, reason = 'Atualização de policy/autonomia da missão' }) {
            const mission = this.getById(missionId) || this.selected || null;
            // BUG-UI-1 fix: use _resolveIfVersion for correct optimistic locking
            const ifVersion = _resolveIfVersion(mission);
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
        async ensureMissionContext(/** @type {any} */ missionId) {
            await this.fetchDetail(missionId);
            await this.fetchMissionTasks(missionId, { limit: 100 });
            return {
                mission: this.selected,
                tasks: this.selectedTasks,
            };
        },

        /**
         * Adiciona feedback textual a uma missão via REST (não passa pelo control plane).
         * @param {string} missionId
         * @param {string} feedback
         */
        async addFeedback(missionId, feedback) {
            const res = await http.post(`/api/missions/${missionId}/feedback`, { feedback });
            return res.data;
        },

        /**
         * Solicita sugestão de tasks via LLM (planner task).
         * Requer missão RUNNING e autonomy_mode ≠ USER_ONLY.
         * @param {string} missionId
         * @param {{ max_proposals?: number, target?: string }} [payload]
         */
        async suggestTasks(missionId, payload = {}) {
            const res = await http.post(`/api/missions/${missionId}/suggest-tasks`, payload);
            return res.data;
        },

        /**
         * Rejeita proposals (tasks em stage=PROPOSED) de uma missão.
         * @param {string} missionId
         * @param {{ all?: boolean, task_ids?: string[] }} payload
         */
        async rejectProposals(missionId, payload) {
            const res = await http.post(`/api/missions/${missionId}/proposals/reject`, payload);
            await _syncMissionAndTasksContext(missionId);
            return res.data;
        },

        /**
         * Aceita proposals como tasks READY via REST (não passa pelo control plane).
         * @param {string} missionId
         * @param {{ proposals: unknown[] }} payload
         */
        async acceptProposals(missionId, payload) {
            const res = await http.post(`/api/missions/${missionId}/proposals/accept`, payload);
            await _syncMissionAndTasksContext(missionId);
            return res.data;
        },
    },
});
