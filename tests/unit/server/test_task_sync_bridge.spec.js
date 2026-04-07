// @ts-check
import { TaskSyncBridge, UnifiedStatus } from '#server/dashboard-api/task_sync_bridge';
import { ActionCode } from '#shared/nerv/constants';
import assert from 'node:assert';

class MockNerv {
    constructor() {
        this.handlers = /** @type {any[]} */ ([]);
        this.unsubCalls = 0;
    }

    onReceive(/** @type {any} */ handler) {
        this.handlers.push(handler);
        return () => {
            this.unsubCalls += 1;
            const idx = this.handlers.indexOf(handler);
            if (idx >= 0) {
                this.handlers.splice(idx, 1);
            }
        };
    }

    emitEnvelope(/** @type {any} */ envelope) {
        for (const handler of this.handlers) {
            handler(envelope);
        }
    }
}

describe('TaskSyncBridge', () => {
    it('should register one listener per action code and cleanup unsubscribers', () => {
        const nerv = new MockNerv();
        const bridge = new TaskSyncBridge();

        bridge.initialize({ nervClient: nerv });

        assert.strictEqual(bridge._nervUnsubscribers.length, 7);

        bridge.clearAll();

        assert.strictEqual(nerv.unsubCalls, 7);
        assert.strictEqual(bridge._nervUnsubscribers.length, 0);
    });

    it('should track queued task state from DRIVER_TASK_QUEUED event', () => {
        const nerv = new MockNerv();
        const bridge = new TaskSyncBridge();

        bridge.initialize({ nervClient: nerv });

        nerv.emitEnvelope({
            actionCode: ActionCode.DRIVER_TASK_QUEUED,
            payload: {
                taskId: 'task-queued-1',
                queuePosition: 3,
                queueSize: 10,
                activeDrivers: 2,
                next_action: 'RETRY_LATER',
            },
        });

        const state = bridge.kernelStateCache.get('task-queued-1');
        assert.ok(state);
        assert.strictEqual(state.status, UnifiedStatus.PENDING);
        assert.strictEqual(state.queue_position, 3);
        assert.strictEqual(state.queue_size, 10);
        assert.strictEqual(state.active_drivers, 2);
    });

    it('should persist correlation id and ignore stale event timestamps', () => {
        const nerv = new MockNerv();
        const bridge = new TaskSyncBridge();

        bridge.initialize({ nervClient: nerv });

        nerv.emitEnvelope({
            protocol: { timestamp: 2000 },
            actionCode: ActionCode.DRIVER_TASK_QUEUED,
            correlationId: 'corr-new',
            payload: {
                taskId: 'task-stale-1',
                queuePosition: 1,
                queueSize: 2,
            },
        });

        nerv.emitEnvelope({
            protocol: { timestamp: 1000 },
            actionCode: ActionCode.DRIVER_TASK_QUEUED,
            correlationId: 'corr-old',
            payload: {
                taskId: 'task-stale-1',
                queuePosition: 99,
                queueSize: 999,
            },
        });

        const state = bridge.kernelStateCache.get('task-stale-1');
        assert.ok(state);
        assert.strictEqual(state.queue_position, 1, 'evento stale não deve sobrescrever estado atual');
        assert.strictEqual(state.last_correlation_id, 'corr-new');
        assert.strictEqual(state.event_timestamp, 2000);
    });
});
