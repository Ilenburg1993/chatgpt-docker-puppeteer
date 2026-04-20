// @ts-check

import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import { BackgroundTasks } from '../../../src/copilot/agent/background-tasks.js';

describe('BackgroundTasks', () => {
    it('track() contabiliza pendingCount e emite completed/idle em sucesso', async () => {
        /** @type {Record<string, unknown>[]} */
        const completed = [];
        /** @type {Record<string, unknown>[]} */
        const idle = [];
        const tracker = new BackgroundTasks({
            onCompleted: (evt) => completed.push(/** @type {Record<string, unknown>} */ (evt)),
            onIdle: (evt) => idle.push(/** @type {Record<string, unknown>} */ (evt)),
        });

        const tracked = tracker.track(Promise.resolve('ok'), {
            label: 'task.success',
            description: 'Task de sucesso',
        });

        assert.equal(tracker.pendingCount, 1);
        await tracked;
        assert.equal(tracker.pendingCount, 0);
        assert.equal(completed.length, 1);
        assert.equal(completed[0]?.status, 'success');
        assert.equal(idle.length, 1);
    });

    it('track() não rejeita para callers fire-and-forget e reporta erro no evento', async () => {
        /** @type {Record<string, unknown>[]} */
        const completed = [];
        const tracker = new BackgroundTasks({
            onCompleted: (evt) => completed.push(/** @type {Record<string, unknown>} */ (evt)),
        });

        await assert.doesNotReject(() =>
            tracker.track(Promise.reject(new Error('boom')), {
                label: 'task.error',
                description: 'Task com erro',
            }),
        );

        assert.equal(completed.length, 1);
        assert.equal(completed[0]?.status, 'error');
        assert.equal(completed[0]?.error, 'boom');
    });

    it('drain() aguarda tarefas pendentes até esvaziar', async () => {
        /** @type {(value?: unknown) => void} */
        let release = () => {};
        const pending = new Promise((resolve) => {
            release = resolve;
        });
        const tracker = new BackgroundTasks();

        void tracker.track(pending, {
            label: 'task.pending',
            description: 'Task pendente',
        });

        const drainPromise = tracker.drain(1000);
        release(undefined);
        const drained = await drainPromise;

        assert.equal(drained, true);
        assert.equal(tracker.pendingCount, 0);
    });
});
