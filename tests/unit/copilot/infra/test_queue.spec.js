// @ts-check

import { describe, expect, it } from 'vitest';

import { AsyncQueue } from '../../../../src/copilot/infra/queue.js';

describe('infra/queue AsyncQueue', () => {
    it('normaliza concorrência fracionária para inteiro positivo', async () => {
        const queue = new AsyncQueue({ concurrency: 1.8 });
        const result = await queue.add(async () => 'ok');

        expect(result).toBe('ok');
        expect(queue.pending).toBe(0);
        expect(queue.running).toBe(0);
    });

    it('não deixa tarefas penduradas quando concurrency é inválida', async () => {
        const queue = new AsyncQueue({ concurrency: 0 });
        const result = await queue.add(async () => 42);

        expect(result).toBe(42);
        expect(queue.pending).toBe(0);
        expect(queue.running).toBe(0);
    });

    it('clear rejeita tarefas pendentes sem cancelar a tarefa em execução', async () => {
        const queue = new AsyncQueue({ concurrency: 1 });
        /** @type {() => void} */
        let release = () => {};
        const running = queue.add(
            () =>
                new Promise((resolve) => {
                    release = () => resolve('done');
                }),
        );
        const pending = queue.add(async () => 'pending');

        queue.clear();
        release();

        await expect(running).resolves.toBe('done');
        await expect(pending).rejects.toThrow('Queue cleared');
    });
});
