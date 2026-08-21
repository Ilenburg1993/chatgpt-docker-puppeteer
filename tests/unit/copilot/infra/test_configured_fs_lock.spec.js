// @ts-check

import {
    getConfiguredResourceLockState,
    withConfiguredResourceLocks,
} from '#copilot/infra/internal/concurrency/locks/configured';
import { describe, expect, it } from 'vitest';

const nextTurn = () => new Promise((resolve) => setImmediate(resolve));

describe('configured filesystem resource lock', () => {
    it('serializa contendedores do mesmo recurso e limpa a fila ao final', async () => {
        const resource = '/tmp/configured-lock-serialized';
        const firstEntered = Promise.withResolvers();
        const releaseFirst = Promise.withResolvers();
        /** @type {string[]} */
        const order = [];

        const first = withConfiguredResourceLocks([resource], async () => {
            order.push('first-enter');
            firstEntered.resolve(undefined);
            await releaseFirst.promise;
            order.push('first-exit');
        });
        await firstEntered.promise;

        const second = withConfiguredResourceLocks([resource], async () => {
            order.push('second-enter');
            order.push('second-exit');
        });
        await nextTurn();
        expect(order).toEqual(['first-enter']);

        releaseFirst.resolve(undefined);
        await Promise.all([first, second]);
        expect(order).toEqual(['first-enter', 'first-exit', 'second-enter', 'second-exit']);
        expect(getConfiguredResourceLockState()).toEqual({ pendingResources: 0 });
    });

    it('é reentrante no mesmo async context sem deadlock', async () => {
        const resource = '/tmp/configured-lock-reentrant';
        /** @type {string[]} */
        const order = [];
        await withConfiguredResourceLocks([resource], async () => {
            order.push('outer-enter');
            await withConfiguredResourceLocks([resource], async () => {
                order.push('inner');
            });
            order.push('outer-exit');
        });
        expect(order).toEqual(['outer-enter', 'inner', 'outer-exit']);
        expect(getConfiguredResourceLockState()).toEqual({ pendingResources: 0 });
    });

    it('libera o recurso mesmo quando a operação protegida falha', async () => {
        const resource = '/tmp/configured-lock-failure-release';
        await expect(
            withConfiguredResourceLocks([resource], async () => {
                throw new Error('injected-configured-lock-failure');
            }),
        ).rejects.toThrow('injected-configured-lock-failure');

        let reacquired = false;
        await withConfiguredResourceLocks([resource], async () => {
            reacquired = true;
        });
        expect(reacquired).toBe(true);
        expect(getConfiguredResourceLockState()).toEqual({ pendingResources: 0 });
    });
});
