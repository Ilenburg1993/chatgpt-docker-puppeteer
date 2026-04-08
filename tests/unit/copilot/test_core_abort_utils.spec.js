// @ts-check
/**
 * tests/unit/copilot/test_core_abort_utils.spec.js
 *
 * Testes unitários — core/abort-utils.js: withTimeout com AbortController.
 */

import assert from 'node:assert/strict';

import { withTimeout } from '../../../src/copilot/core/abort-utils.js';
import { TimeoutError } from '../../../src/copilot/core/errors.js';

describe('core/abort-utils.js › withTimeout', () => {
    it('retorna resultado se fn completa antes do timeout', async () => {
        const result = await withTimeout((_signal) => Promise.resolve('ok'), 1000);
        assert.equal(result, 'ok');
    });

    it('lança TimeoutError se fn excede o timeout', async () => {
        await assert.rejects(
            () => withTimeout((_signal) => new Promise((resolve) => setTimeout(resolve, 500)), 10, 'test-op'),
            (/** @type {unknown} */ err) => {
                assert.ok(err instanceof TimeoutError, 'deve ser TimeoutError');
                assert.ok(/** @type {Error} */ (err).message.includes('test-op'), 'mensagem deve conter label');
                return true;
            },
        );
    });

    it('propaga erros da fn (não timeout)', async () => {
        await assert.rejects(() => withTimeout(() => Promise.reject(new Error('inner error')), 1000), {
            message: 'inner error',
        });
    });

    it('passa AbortSignal para fn', async () => {
        /** @type {AbortSignal | null} */
        let capturedSignal = null;
        await withTimeout((signal) => {
            capturedSignal = signal;
            return Promise.resolve('done');
        }, 1000);
        assert.ok(capturedSignal, 'signal deve ser passado para fn');
        assert.ok(!(/** @type {AbortSignal} */ (capturedSignal).aborted), 'signal não deve estar aborted');
    });

    it('usa label default "operation" quando não especificado', async () => {
        await assert.rejects(
            () => withTimeout(() => new Promise((r) => setTimeout(r, 500)), 10),
            (/** @type {unknown} */ err) => {
                assert.ok(/** @type {Error} */ (err).message.includes('operation'));
                return true;
            },
        );
    });
});
