// @ts-check
/**
 * Testes unitários para a política central de erros do subsistema agent (K3 incremental).
 */

import * as assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import {
    classifyAgentError,
    shouldRetryAgentError,
    withAgentErrorPolicy,
} from '../../../src/copilot/agent/error-policy.js';

describe('agent/error-policy', () => {
    it('classifica AbortError como ignore', () => {
        const err = new DOMException('aborted', 'AbortError');
        assert.equal(classifyAgentError(err), 'ignore');
        assert.equal(shouldRetryAgentError(err), false);
    });

    it('classifica SESSION_FATAL como fatal', () => {
        const err = Object.assign(new Error('fatal'), { code: 'SESSION_FATAL' });
        assert.equal(classifyAgentError(err), 'fatal');
        assert.equal(shouldRetryAgentError(err), false);
    });

    it('classifica erro genérico como retry', () => {
        const err = new Error('network-ish unknown');
        assert.equal(classifyAgentError(err), 'retry');
        assert.equal(shouldRetryAgentError(err), true);
    });

    it('withAgentErrorPolicy retorna sucesso explícito quando a operação resolve', async () => {
        const result = await withAgentErrorPolicy(async () => 'ok');

        assert.equal(result.ok, true);
        if (result.ok) {
            assert.equal(result.value, 'ok');
        }
    });

    it('withAgentErrorPolicy aceita operações síncronas sem boilerplate artificial', async () => {
        const result = await withAgentErrorPolicy(() => 42);

        assert.equal(result.ok, true);
        if (result.ok) {
            assert.equal(result.value, 42);
        }
    });

    it('withAgentErrorPolicy normaliza erro e expõe a disposição classificada', async () => {
        /** @type {{ error: string; disposition: string }[]} */
        const observed = [];

        const result = await withAgentErrorPolicy(
            async () => {
                throw new DOMException('aborted', 'AbortError');
            },
            {
                onError: (error, disposition) => {
                    observed.push({ error: error.message, disposition });
                },
            },
        );

        assert.equal(result.ok, false);
        if (!result.ok) {
            assert.equal(result.disposition, 'ignore');
            assert.equal(result.error.name, 'AbortError');
        }
        assert.deepEqual(observed, [{ error: 'aborted', disposition: 'ignore' }]);
    });
});
