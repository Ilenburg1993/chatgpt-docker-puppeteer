// @ts-check
import { onMounted, onUnmounted } from 'vue';
import { useSocket } from '@/composables/useSocket';
import { useTasksVNextStore } from '@/stores/tasks_vnext';
import { useMissionsVNextStore } from '@/stores/missions_vnext';
import { useEventsVNextStore } from '@/stores/events_vnext';

const REALTIME_FLUSH_MS = 80;
const MAX_SEEN_EVENT_IDS = 5000;

/** @type {any[]} */
let pendingTaskBatches = [];
/** @type {any[]} */
let pendingMissionBatches = [];
/** @type {any[]} */
let pendingEventBatches = [];
/** @type {any[]} */
let pendingControlStatuses = [];
/** @type {Set<string>} */
const seenEventIds = new Set();
/** @type {Set<string>} */
const seenCommandStatuses = new Set();
let flushTimer = null;

function _coerceEventCursor(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
}

function _compactTaskUpdates(batches) {
    const byId = new Map();
    for (const payload of batches) {
        const updates = payload?.updates || [];
        for (const item of updates) {
            const task = item?.task || null;
            const id = task?.id ? String(task.id) : null;
            if (!id) continue;
            byId.set(id, item);
        }
    }
    return Array.from(byId.values());
}

function _compactMissionUpdates(batches) {
    const byId = new Map();
    for (const payload of batches) {
        const updates = payload?.updates || [];
        for (const item of updates) {
            const mission = item?.mission || null;
            const id = mission?.id ? String(mission.id) : null;
            if (!id) continue;
            byId.set(id, item);
        }
    }
    return Array.from(byId.values());
}

function _compactEvents(batches) {
    const merged = [];
    let lastEventId = null;
    for (const payload of batches) {
        lastEventId = payload?.last_event_id ?? lastEventId;
        const events = payload?.events || [];
        for (const event of events) {
            const id = event?.id ? String(event.id) : null;
            if (!id) continue;
            if (seenEventIds.has(id)) continue;
            seenEventIds.add(id);
            merged.push(event);
        }
    }

    if (seenEventIds.size > MAX_SEEN_EVENT_IDS) {
        const toDrop = seenEventIds.size - MAX_SEEN_EVENT_IDS;
        const ids = Array.from(seenEventIds).slice(0, toDrop);
        for (const id of ids) seenEventIds.delete(id);
    }

    return {
        events: merged,
        last_event_id: lastEventId,
    };
}

function _compactCommandStatuses(items) {
    const out = [];
    for (const payload of items) {
        const key = `${payload?.operation_id || 'unknown'}:${payload?.status || 'unknown'}`;
        if (seenCommandStatuses.has(key)) continue;
        seenCommandStatuses.add(key);
        out.push(payload);
    }
    if (seenCommandStatuses.size > 2000) {
        const ids = Array.from(seenCommandStatuses).slice(0, seenCommandStatuses.size - 2000);
        for (const id of ids) seenCommandStatuses.delete(id);
    }
    return out;
}

/**
 * Função exportada: useSsotRealtime.
 * @returns {void}
 */
export function useSsotRealtime() {
    const tasks = useTasksVNextStore();
    const missions = useMissionsVNextStore();
    const events = useEventsVNextStore();

    const { subscribe, unsubscribe } = useSocket();

    const flushRealtimeBatch = () => {
        flushTimer = null;

        if (pendingTaskBatches.length > 0) {
            const updates = _compactTaskUpdates(pendingTaskBatches);
            pendingTaskBatches = [];
            if (updates.length > 0) {
                tasks.applyRealtimeUpdatesBatch({ updates });
            }
        }

        if (pendingMissionBatches.length > 0) {
            const updates = _compactMissionUpdates(pendingMissionBatches);
            pendingMissionBatches = [];
            if (updates.length > 0) {
                missions.applyRealtimeUpdatesBatch({ updates });
            }
        }

        if (pendingEventBatches.length > 0) {
            const compacted = _compactEvents(pendingEventBatches);
            pendingEventBatches = [];
            const lastCursor = _coerceEventCursor(events.lastEventId);
            const incomingCursor = _coerceEventCursor(compacted.last_event_id);
            if (incomingCursor !== null && lastCursor !== null && incomingCursor < lastCursor) {
                // Evita regressão de cursor quando chegar batch antigo fora de ordem.
            } else if ((compacted.events || []).length > 0 || compacted.last_event_id !== null) {
                events.pushBatch(compacted);
            }
        }

        if (pendingControlStatuses.length > 0) {
            const statuses = _compactCommandStatuses(pendingControlStatuses);
            pendingControlStatuses = [];
            for (const status of statuses) {
                events.pushControlCommandStatus(status);
            }
        }
    };

    const scheduleFlush = () => {
        if (flushTimer) return;
        flushTimer = setTimeout(flushRealtimeBatch, REALTIME_FLUSH_MS);
    };

    const onTasksBatch = payload => {
        pendingTaskBatches.push(payload);
        scheduleFlush();
    };
    const onMissionsBatch = payload => {
        pendingMissionBatches.push(payload);
        scheduleFlush();
    };
    const onEventsBatch = payload => {
        pendingEventBatches.push(payload);
        scheduleFlush();
    };
    const onControlCommandStatus = payload => {
        pendingControlStatuses.push(payload);
        scheduleFlush();
    };

    onMounted(() => {
        subscribe('task:updates_batch', onTasksBatch);
        subscribe('mission:updates_batch', onMissionsBatch);
        subscribe('ssot:events_batch', onEventsBatch);
        subscribe('control:command_status', onControlCommandStatus);
    });

    onUnmounted(() => {
        unsubscribe('task:updates_batch', onTasksBatch);
        unsubscribe('mission:updates_batch', onMissionsBatch);
        unsubscribe('ssot:events_batch', onEventsBatch);
        unsubscribe('control:command_status', onControlCommandStatus);
        if (flushTimer) {
            clearTimeout(flushTimer);
            flushTimer = null;
        }
    });
}
