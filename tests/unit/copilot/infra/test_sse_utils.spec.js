// @ts-check

import { createSseWriter, SseConnectionTracker } from '#copilot/presentation/realtime';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';

function createRequestResponse() {
    const req = new EventEmitter();
    Object.assign(req, { headers: { 'accept-encoding': 'gzip' } });
    const res = new PassThrough();
    Object.assign(res, {
        setHeader: vi.fn(),
        flushHeaders: vi.fn(),
    });
    return {
        req: /** @type {any} */ (req),
        res: /** @type {any} */ (res),
    };
}

describe('presentation/realtime/sse/utils', () => {
    it('libera tracker e stream gzip quando request fecha', () => {
        const { req, res } = createRequestResponse();
        const tracker = new SseConnectionTracker('test', 2, null);
        const writer = createSseWriter(req, res, { compress: true, heartbeatMs: 0, tracker });

        expect(tracker.count).toBe(1);
        writer.send('update', { ok: true });
        req.emit('close');

        expect(tracker.count).toBe(0);
        expect(res.listenerCount('finish')).toBeGreaterThan(0);
    });
});
