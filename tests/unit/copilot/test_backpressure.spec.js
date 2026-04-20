// @ts-check
/**
 * tests/unit/copilot/test_backpressure.spec.js
 *
 * F59.4: Testes unitários para TurnQueue (backpressure.js)
 */
import { describe, expect, it } from 'vitest';
import { TurnQueue } from '../../../src/copilot/agent/dialog/backpressure.js';

describe('TurnQueue', () => {
    it('deve inicializar com depth 0 e full=false', () => {
        const q = new TurnQueue({ maxSize: 3 });
        expect(q.depth).toBe(0);
        expect(q.full).toBe(false);
    });

    it('deve serializar execuções via mutex', async () => {
        const q = new TurnQueue({ maxSize: 5 });
        /** @type {string[]} */
        const order = [];
        const p1 = q.enqueue(async () => {
            order.push('a-start');
            await new Promise((r) => setTimeout(r, 20));
            order.push('a-end');
            return 'a';
        });
        const p2 = q.enqueue(async () => {
            order.push('b-start');
            return 'b';
        });
        const [r1, r2] = await Promise.all([p1, p2]);
        expect(r1).toBe('a');
        expect(r2).toBe('b');
        expect(order).toEqual(['a-start', 'a-end', 'b-start']);
    });

    it('deve rejeitar com DIALOG_QUEUE_FULL quando fila está cheia', async () => {
        const q = new TurnQueue({ maxSize: 1 });
        /** @type {((v: any) => void) | undefined} */
        let resolve1;
        const p1 = q.enqueue(
            () =>
                new Promise((r) => {
                    resolve1 = r;
                }),
        );
        await new Promise((r) => setTimeout(r, 0));
        // Agora a fila está em depth=1 (maxSize=1)
        await expect(q.enqueue(async () => 'overflow')).rejects.toThrow('Fila cheia');
        resolve1?.('done');
        await p1;
    });

    it('deve retornar full=true quando depth >= maxSize', async () => {
        const q = new TurnQueue({ maxSize: 1 });
        /** @type {((v: any) => void) | undefined} */
        let resolve1;
        // Não usar await aqui — p1 ficará pendente até resolve1 ser chamado
        const p1 = q.enqueue(
            () =>
                new Promise((r) => {
                    resolve1 = r;
                }),
        );
        // Esperar microtask para closure atribuir resolve1
        await new Promise((r) => setTimeout(r, 0));
        expect(q.full).toBe(true);
        expect(q.depth).toBe(1);
        resolve1?.('ok');
        await p1;
    });

    it('reset() deve zerar depth e permitir novas enqueues', async () => {
        const q = new TurnQueue({ maxSize: 2 });
        let resolve1;
        q.enqueue(
            () =>
                new Promise((r) => {
                    resolve1 = r;
                }),
        );
        expect(q.depth).toBe(1);
        q.reset();
        expect(q.depth).toBe(0);
        expect(q.full).toBe(false);
        // Deve funcionar normalmente após reset
        const result = await q.enqueue(async () => 42);
        expect(result).toBe(42);
    });

    it('drain() deve resolver quando a fila esvaziar', async () => {
        const q = new TurnQueue({ maxSize: 3 });
        await q.enqueue(async () => 'x');
        // Após completar, drain deve resolver imediatamente
        await q.drain();
        expect(q.depth).toBe(0);
    });
});
