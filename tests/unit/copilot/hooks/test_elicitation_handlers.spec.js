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
});
