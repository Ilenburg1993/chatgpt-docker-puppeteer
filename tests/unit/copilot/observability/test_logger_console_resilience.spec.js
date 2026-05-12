// @ts-check

import assert from 'node:assert/strict';
import { afterEach, describe, it, vi } from 'vitest';

describe('observability/logger.js — console resilience', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        vi.resetModules();
    });

    it('não lança quando stdout falha com EIO', async () => {
        const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => {
            const error = /** @type {NodeJS.ErrnoException} */ (new Error('write EIO'));
            error.code = 'EIO';
            throw error;
        });

        const { log } = await import('../../../../src/copilot/observability/logger.js');
        log.setLevel('INFO');
        log.setConsoleLevel('INFO');

        assert.doesNotThrow(() => {
            log('INFO', '[test] stdout should not crash runtime');
        });

        assert.ok(write.mock.calls.length >= 1);
    });

    it('não lança quando stderr falha com EPIPE', async () => {
        const write = vi.spyOn(process.stderr, 'write').mockImplementation(() => {
            const error = /** @type {NodeJS.ErrnoException} */ (new Error('broken pipe'));
            error.code = 'EPIPE';
            throw error;
        });

        const { log } = await import('../../../../src/copilot/observability/logger.js');
        log.setLevel('ERROR');
        log.setConsoleLevel('ERROR');

        assert.doesNotThrow(() => {
            log('ERROR', '[test] stderr should not crash runtime');
        });

        assert.ok(write.mock.calls.length >= 1);
    });
});
