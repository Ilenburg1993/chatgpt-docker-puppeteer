import { onMounted, onUnmounted } from 'vue';
import { useSocket } from '@/composables/useSocket';
import { useTasksVNextStore } from '@/stores/tasks_vnext';
import { useMissionsVNextStore } from '@/stores/missions_vnext';
import { useEventsVNextStore } from '@/stores/events_vnext';

export function useSsotRealtime() {
    const tasks = useTasksVNextStore();
    const missions = useMissionsVNextStore();
    const events = useEventsVNextStore();

    const { subscribe, unsubscribe } = useSocket();

    const onTasksBatch = payload => {
        tasks.applyRealtimeUpdatesBatch(payload);
    };
    const onMissionsBatch = payload => {
        missions.applyRealtimeUpdatesBatch(payload);
    };
    const onEventsBatch = payload => {
        events.pushBatch(payload);
    };

    onMounted(() => {
        subscribe('task:updates_batch', onTasksBatch);
        subscribe('mission:updates_batch', onMissionsBatch);
        subscribe('ssot:events_batch', onEventsBatch);
    });

    onUnmounted(() => {
        unsubscribe('task:updates_batch', onTasksBatch);
        unsubscribe('mission:updates_batch', onMissionsBatch);
        unsubscribe('ssot:events_batch', onEventsBatch);
    });
}

