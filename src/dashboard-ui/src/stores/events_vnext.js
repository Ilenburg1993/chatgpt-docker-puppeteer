import { defineStore } from 'pinia';
import { http, formatHttpError } from '@/lib/http';

export const useEventsVNextStore = defineStore('events_vnext', {
    state: () => ({
        items: /** @type {any[]} */ ([]),
        lastEventId: null,
        seenIds: /** @type {Set<string>} */ (new Set()),
        loading: false,
        error: null,
        filters: {
            entity_type: null,
            entity_id: '',
            event_type: '',
        },
        cursor: null,
        hasMore: false,
    }),
    actions: {
        pushBatch(payload) {
            const events = payload?.events || [];
            if (!Array.isArray(events) || events.length === 0) return;
            // Newest on top for UI
            for (let i = events.length - 1; i >= 0; i -= 1) {
                const e = events[i];
                if (!e?.id) continue;
                const id = String(e.id);
                if (this.seenIds.has(id)) continue;
                this.seenIds.add(id);
                this.items.unshift(e);
            }
            this.lastEventId = payload?.last_event_id ?? this.lastEventId;
            // keep bounded
            if (this.items.length > 3000) {
                const removed = this.items.splice(3000);
                for (const item of removed) {
                    if (item?.id) this.seenIds.delete(String(item.id));
                }
            }
        },

        resetHistory() {
            this.items = [];
            this.seenIds = new Set();
            this.cursor = null;
            this.hasMore = false;
            this.error = null;
        },

        pushControlCommandStatus(payload) {
            if (!payload || typeof payload !== 'object') return;
            const synthetic = {
                id: `control-${payload.operation_id || Date.now()}`,
                entity_type: 'control_operation',
                entity_id: payload.operation_id || null,
                ts_ms: Date.now(),
                actor_type: 'user',
                actor_id: payload?.actor?.id || null,
                event_type: 'CONTROL_COMMAND_STATUS',
                payload,
            };
            this.items.unshift(synthetic);
            this.seenIds.add(String(synthetic.id));
            if (this.items.length > 3000) {
                const removed = this.items.splice(3000);
                for (const item of removed) {
                    if (item?.id) this.seenIds.delete(String(item.id));
                }
            }
        },

        async fetchFirstPage({ limit = 200 } = {}) {
            this.loading = true;
            this.error = null;
            try {
                const params = { limit };
                if (this.filters.entity_type) params.entity_type = this.filters.entity_type;
                if (this.filters.entity_id) params.entity_id = this.filters.entity_id;
                if (this.filters.event_type) params.event_type = this.filters.event_type;

                const res = await http.get('/api/dashboard/events', { params });
                this.items = res.data?.data?.items || [];
                this.seenIds = new Set(this.items.map(item => String(item?.id || '')).filter(Boolean));
                const meta = res.data?.meta || {};
                this.cursor = meta.next_cursor || null;
                this.hasMore = Boolean(meta.has_more);
            } catch (err) {
                this.error = formatHttpError(err).message;
            } finally {
                this.loading = false;
            }
        },

        async fetchNextPage({ limit = 200 } = {}) {
            if (!this.hasMore || !this.cursor || this.loading) return;
            this.loading = true;
            try {
                const params = { limit, cursor: this.cursor };
                if (this.filters.entity_type) params.entity_type = this.filters.entity_type;
                if (this.filters.entity_id) params.entity_id = this.filters.entity_id;
                if (this.filters.event_type) params.event_type = this.filters.event_type;

                const res = await http.get('/api/dashboard/events', { params });
                const page = res.data?.data?.items || [];
                const meta = res.data?.meta || {};
                for (const item of page) {
                    const id = item?.id ? String(item.id) : null;
                    if (!id || this.seenIds.has(id)) continue;
                    this.seenIds.add(id);
                    this.items.push(item);
                }
                this.cursor = meta.next_cursor || null;
                this.hasMore = Boolean(meta.has_more);
            } catch (err) {
                this.error = formatHttpError(err).message;
            } finally {
                this.loading = false;
            }
        },
    },
});
