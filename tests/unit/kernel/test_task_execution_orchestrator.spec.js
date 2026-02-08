import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import EventEmitter from 'node:events';
import { TaskExecutionOrchestrator } from '#kernel/task_execution_orchestrator';
import { ActionCode, MessageType } from '#shared/nerv/constants';

class MockNERV extends EventEmitter {
    constructor() {
        super();
        this.receiveHandlers = [];
    }

    onReceive(handler) {
        this.receiveHandlers.push(handler);
        return () => {
            const idx = this.receiveHandlers.indexOf(handler);
            if (idx >= 0) this.receiveHandlers.splice(idx, 1);
        };
    }

    receive(envelope) {
        this.receiveHandlers.forEach(h => h(envelope));
    }
}

describe('TaskExecutionOrchestrator', () => {
    let nerv;
    let nervBridge;
    let orchestrator;

    beforeEach(() => {
        nerv = new MockNERV();
        nervBridge = {
            beforeTaskExecution: (task) => task,
            emitCommandCalls: [],
            emitEventCalls: [],
            decisions: 0,
            emitCommand(cmd) {
                this.emitCommandCalls.push(cmd);
            },
            emitEvent(evt) {
                this.emitEventCalls.push(evt);
            },
            async afterTaskExecution(task) {
                this.decisions += 1;
                return { action: 'DONE', task, feedback: null };
            },
            async processOrchestrationDecision() {}
        };

        orchestrator = new TaskExecutionOrchestrator({ nerv, nervBridge });
    });

    it('should ignore duplicated completion events for same task', async () => {
        const task = {
            meta: { id: 'task-dup' },
            spec: { payload: { user_message: 'x' }, execution: { strategy: 'SINGLE_SHOT' } }
        };

        await orchestrator.executeTask(task, 'corr-dup');
        assert.strictEqual(nervBridge.emitCommandCalls.length, 1);

        const completion = {
            kind: MessageType.EVENT,
            actionCode: ActionCode.DRIVER_TASK_COMPLETED,
            payload: { taskId: 'task-dup', result: { output: 'ok' } },
            correlationId: 'corr-dup'
        };

        nerv.receive(completion);
        nerv.receive(completion);

        await new Promise(resolve => setTimeout(resolve, 20));

        assert.strictEqual(nervBridge.decisions, 1, 'afterTaskExecution deve rodar uma vez');
    });


    it('should forward driver failure metadata when emitting TASK_FAILED', async () => {
        const task = {
            meta: { id: 'task-fail-meta' },
            spec: { payload: { user_message: 'x' }, execution: { strategy: 'SINGLE_SHOT' } }
        };

        await orchestrator.executeTask(task, 'corr-fail-meta');

        nerv.receive({
            type: { message_type: MessageType.EVENT, action_code: ActionCode.DRIVER_TASK_FAILED },
            causality: { correlation_id: 'corr-fail-meta' },
            payload: {
                taskId: 'task-fail-meta',
                error: 'queue full',
                reason: 'QUEUE_FULL',
                retryable: true,
                next_action: 'RETRY_LATER',
                suggestedDelayMs: 750,
                errorType: 'OperationalError',
                operation: 'execute'
            }
        });

        await new Promise(resolve => setTimeout(resolve, 20));

        assert.strictEqual(nervBridge.emitEventCalls.length, 1);
        const eventPayload = nervBridge.emitEventCalls[0].payload;
        assert.strictEqual(eventPayload.actionCode, ActionCode.TASK_FAILED);
        assert.strictEqual(eventPayload.reason, 'QUEUE_FULL');
        assert.strictEqual(eventPayload.retryable, true);
        assert.strictEqual(eventPayload.next_action, 'RETRY_LATER');
        assert.strictEqual(eventPayload.suggestedDelayMs, 750);
    });

    it('should unsubscribe listener on cleanup', () => {
        assert.strictEqual(nerv.receiveHandlers.length, 1);
        orchestrator.cleanup();
        assert.strictEqual(nerv.receiveHandlers.length, 0);
    });
});
