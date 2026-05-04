// @ts-check

import { describe, expect, it, vi } from 'vitest';
import { createQueuedElicitationHandler } from '../../../../src/copilot/hooks/elicitation.js';

describe('hooks/elicitation', () => {
    it('enfileira, lista e resolve elicitation pendente', async () => {
        const onPending = vi.fn();
        const onCompleted = vi.fn();
        const queued = createQueuedElicitationHandler({ onPending, onCompleted });

        const promise = queued.handler({
            sessionId: 's1',
            message: 'Escolha o ambiente',
            requestedSchema: { type: 'object', properties: { env: { type: 'string' } } },
            mode: 'form',
            elicitationSource: 'mcp-server',
        });

        const pending = queued.listPending();
        expect(pending).toHaveLength(1);
        expect(onPending).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 's1' }));

        const ok = queued.resolvePending(pending[0]?.id ?? '', { action: 'accept', content: { env: 'dev' } });
        await expect(promise).resolves.toEqual({ action: 'accept', content: { env: 'dev' } });
        expect(ok).toBe(true);
        expect(onCompleted).toHaveBeenCalledWith(
            expect.objectContaining({ result: { action: 'accept', content: { env: 'dev' } } }),
        );
        expect(queued.pendingCount()).toBe(0);
    });

    it('cancela automaticamente quando a fila enche', async () => {
        const queued = createQueuedElicitationHandler({ maxSize: 0 });
        await expect(queued.handler({ sessionId: 's1', message: 'Pergunta' })).resolves.toEqual({ action: 'cancel' });
    });

    it('aplica defaults e valida arrays enum/anyOf ao resolver pendência', async () => {
        const queued = createQueuedElicitationHandler();

        const promise = queued.handler({
            sessionId: 's1',
            message: 'Escolha ambiente e tags',
            requestedSchema: {
                type: 'object',
                properties: {
                    env: { type: 'string', default: 'dev', enum: ['dev', 'prod'] },
                    tags: {
                        type: 'array',
                        items: {
                            anyOf: [
                                { const: 'fast', title: 'fast' },
                                { const: 'safe', title: 'safe' },
                            ],
                        },
                    },
                },
                required: ['env'],
            },
        });

        const pending = queued.listPending()[0];
        expect(pending).toBeTruthy();

        expect(() =>
            queued.resolvePending(pending?.id ?? '', {
                action: 'accept',
                content: { tags: ['fast', 'noisy'] },
            }),
        ).toThrow(/fast \| safe/);

        const ok = queued.resolvePending(pending?.id ?? '', {
            action: 'accept',
            content: { tags: ['fast', 'safe'] },
        });
        expect(ok).toBe(true);
        await expect(promise).resolves.toEqual({
            action: 'accept',
            content: { env: 'dev', tags: ['fast', 'safe'] },
        });
    });
});
