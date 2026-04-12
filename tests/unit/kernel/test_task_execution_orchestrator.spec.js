// @ts-check
import { TaskExecutionOrchestrator } from '#kernel/task_execution_orchestrator';
import { ActionCode, MessageType } from '#shared/nerv/constants';
import assert from 'node:assert';
import EventEmitter from 'node:events';
import { describe, it, beforeEach } from 'node:test';

class MockNERV extends EventEmitter {
    constructor() {
        super();
        this.receiveHandlers = /** @type {any[]} */ ([]);
    }

    onReceive(/** @type {any} */ handler) {
        this.receiveHandlers.push(handler);
        return () => {
            const idx = this.receiveHandlers.indexOf(handler);
            if (idx >= 0) this.receiveHandlers.splice(idx, 1);
        };
    }

    receive(/** @type {any} */ envelope) {
        this.receiveHandlers.forEach((h) => h(envelope));
    }
}

describe('TaskExecutionOrchestrator', () => {
    /** @type {any} */ let nerv;
    /** @type {any} */ let nervBridge;
    /** @type {any} */ let orchestrator;

    beforeEach(() => {
        nerv = new MockNERV();

        nervBridge = {
            beforeTaskExecution: async (/** @type {any} */ task) => task,
            emitCommandCalls: [],
            emitEventCalls: [],
            decisions: 0,
            emitCommand(/** @type {any} */ cmd) {
                this.emitCommandCalls.push(cmd);
            },
            emitEvent(/** @type {any} */ evt) {
                this.emitEventCalls.push(evt);
            },
            async afterTaskExecution(/** @type {any} */ task) {
                this.decisions += 1;
                return { action: 'DONE', task, feedback: null };
            },
            async processOrchestrationDecision() {},
        };

        orchestrator = new TaskExecutionOrchestrator({ nerv, nervBridge });
    });

    it('should ignore duplicated completion events for same task', async () => {
        const task = {
            meta: { id: 'task-dup' },
            spec: { payload: { user_message: 'x' }, execution: { strategy: 'SINGLE_SHOT' } },
        };

        await orchestrator.executeTask(task, 'corr-dup');
        assert.strictEqual(nervBridge.emitCommandCalls.length, 1);

        const completion = {
            messageType: MessageType.EVENT,
            actionCode: ActionCode.DRIVER_TASK_COMPLETED,
            payload: { taskId: 'task-dup', result: { output: 'ok' } },
            correlationId: 'corr-dup',
        };

        nerv.receive(completion);
        nerv.receive(completion);

        await new Promise((resolve) => setTimeout(resolve, 20));

        assert.strictEqual(nervBridge.decisions, 1, 'afterTaskExecution deve rodar uma vez');
    });

    it('should forward driver failure metadata when emitting TASK_FAILED', async () => {
        const task = {
            meta: { id: 'task-fail-meta' },
            spec: { payload: { user_message: 'x' }, execution: { strategy: 'SINGLE_SHOT' } },
        };

        await orchestrator.executeTask(task, 'corr-fail-meta');

        // Envelope no formato "novo" (messageType/correlationId), alinhado com os outros testes
        nerv.receive({
            messageType: MessageType.EVENT,
            actionCode: ActionCode.DRIVER_TASK_FAILED,
            correlationId: 'corr-fail-meta',
            payload: {
                taskId: 'task-fail-meta',
                error: 'queue full',
                reason: 'QUEUE_FULL',
                retryable: true,
                next_action: 'RETRY_LATER',
                suggestedDelayMs: 750,
                errorType: 'OperationalError',
                operation: 'execute',
                isTimeout: false,
                errorClassification: 'TRANSIENT',
                retriesAttempted: 0,
            },
        });

        await new Promise((resolve) => setTimeout(resolve, 20));

        assert.strictEqual(nervBridge.emitEventCalls.length, 1);
        const emitted = nervBridge.emitEventCalls[0];
        assert.ok(emitted && emitted.payload, 'emitEvent deve receber payload');

        const eventPayload = emitted.payload;
        assert.strictEqual(eventPayload.actionCode, ActionCode.TASK_FAILED);
        assert.strictEqual(eventPayload.taskId, 'task-fail-meta');
        assert.strictEqual(eventPayload.reason, 'QUEUE_FULL');
        assert.strictEqual(eventPayload.retryable, true);
        assert.strictEqual(eventPayload.next_action, 'RETRY_LATER');
        assert.strictEqual(eventPayload.suggestedDelayMs, 750);

        // Metadata preservada (observabilidade)
        assert.strictEqual(eventPayload.errorType, 'OperationalError');
        assert.strictEqual(eventPayload.operation, 'execute');
        assert.strictEqual(eventPayload.isTimeout, false);
        assert.strictEqual(eventPayload.errorClassification, 'TRANSIENT');
        assert.strictEqual(eventPayload.retriesAttempted, 0);
    });

    it('should ignore completed event when correlationId is missing for active execution', async () => {
        const task = {
            meta: { id: 'task-missing-corr' },
            spec: { payload: { user_message: 'x' }, execution: { strategy: 'SINGLE_SHOT' } },
        };

        await orchestrator.executeTask(task, 'corr-required');

        nerv.receive({
            messageType: MessageType.EVENT,
            actionCode: ActionCode.DRIVER_TASK_COMPLETED,
            payload: { taskId: 'task-missing-corr', result: { output: 'ok' } },
        });

        await new Promise((resolve) => setTimeout(resolve, 20));

        assert.strictEqual(nervBridge.decisions, 0, 'evento sem correlationId deve ser descartado');
    });

    it('should ignore failed event when correlationId mismatches active execution', async () => {
        const task = {
            meta: { id: 'task-stale-fail' },
            spec: { payload: { user_message: 'x' }, execution: { strategy: 'SINGLE_SHOT' } },
        };

        await orchestrator.executeTask(task, 'corr-current');

        nerv.receive({
            messageType: MessageType.EVENT,
            actionCode: ActionCode.DRIVER_TASK_FAILED,
            correlationId: 'corr-stale',
            payload: { taskId: 'task-stale-fail', reason: 'STALE', error: 'stale event' },
        });

        await new Promise((resolve) => setTimeout(resolve, 20));

        assert.strictEqual(nervBridge.emitEventCalls.length, 0, 'falha stale não deve emitir TASK_FAILED');
    });

    it('should unsubscribe listener on cleanup', () => {
        assert.strictEqual(nerv.receiveHandlers.length, 1);
        orchestrator.cleanup();
        assert.strictEqual(nerv.receiveHandlers.length, 0);
    });
});
