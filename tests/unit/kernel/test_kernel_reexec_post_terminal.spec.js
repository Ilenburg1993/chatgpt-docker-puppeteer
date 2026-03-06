// @ts-check
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import EventEmitter from 'node:events';

import { createKernel } from '#kernel/kernel';

class MockNERV extends EventEmitter {
    constructor() {
        super();
        this.emittedCommands = [];
        this.emittedEvents = [];
        this.receiveHandlers = [];
    }

    onReceive(/** @type {any} */ handler) {
        this.receiveHandlers.push(handler);
        return () => {
            const index = this.receiveHandlers.indexOf(handler);
            if (index > -1) this.receiveHandlers.splice(index, 1);
        };
    }

    receive(/** @type {any} */ envelope) {
        this.receiveHandlers.forEach(h => h(envelope));
    }

    emitCommand(/** @type {any} */ envelope) {
        this.emittedCommands.push(envelope);
    }

    emitEvent(/** @type {any} */ envelope) {
        this.emittedEvents.push(envelope);
    }
}

describe('Kernel ssot_gateway (re-dispatch safe)', () => {
    /** @type {any} */ let nerv;
    /** @type {any} */ let kernel;

    beforeEach(() => {
        nerv = new MockNERV();
        kernel = createKernel({ nerv });
    });

    afterEach(() => {
        try {
            kernel?.stop?.();
        } catch (_) {}
    });

    it('permite re-dispatch da mesma taskId com correlationId novo', async () => {
        kernel.start();

        const taskId = 'task-reexec-1';
        const taskV5 = {
            meta: {
                id: taskId,
                version: '5.0',
                created_at: new Date().toISOString(),
                priority: 5,
                source: 'manual',
            },
            spec: {
                target: 'chatgpt',
                payload: { user_message: 'hello' },
                execution: { strategy: 'SINGLE_SHOT' },
                validation: { validators: [] },
            },
            state: { status: 'PENDING', created_at: new Date().toISOString(), history: [] },
            policy: { dependencies: [] },
        };

        assert.strictEqual(kernel.getStatus()?.mode, 'ssot_gateway', 'default kernel mode deve ser ssot_gateway');

        await kernel.executeTask(taskV5, 'corr-1');
        assert.strictEqual(nerv.emittedCommands.length, 1, 'primeiro dispatch emite um comando');

        await kernel.executeTask(taskV5, 'corr-2');
        assert.strictEqual(nerv.emittedCommands.length, 2, 'segundo dispatch (mesma taskId) emite novo comando');

        kernel.stop();
    });
});
