// @ts-check
/**
 * Testes unitários para a política central de erros do subsistema agent (K3 incremental).
 */

import * as assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { classifyAgentError, shouldRetryAgentError } from '../../../src/copilot/agent/error-policy.js';

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
});
