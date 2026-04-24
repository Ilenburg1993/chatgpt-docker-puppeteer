import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import { projectAgentHttpError } from '../../../src/copilot/presentation/agent-http-errors.js';

describe('agent-http-errors', () => {
    it('mapeia AbortError para 504 / ignore', () => {
        const projection = projectAgentHttpError(new DOMException('Aborted', 'AbortError'), {
            timeoutMessage: 'Timeout customizado',
        });

        assert.equal(projection.status, 504);
        assert.equal(projection.body.disposition, 'ignore');
        assert.equal(projection.body.retryable, false);
        assert.equal(projection.body.error, 'Timeout customizado');
    });

    it('mapeia QUEUE_FULL para 429', () => {
        const error = Object.assign(new Error('Fila cheia'), { code: 'QUEUE_FULL' });
        const projection = projectAgentHttpError(error);

        assert.equal(projection.status, 429);
        assert.equal(projection.body.code, 'QUEUE_FULL');
        assert.equal(projection.body.disposition, 'retry');
        assert.equal(projection.body.retryable, true);
    });

    it('mapeia circuit breaker de boot para 503 retryable', () => {
        const error = Object.assign(new Error('Circuit aberto'), { code: 'DIALOG_BOOT_CIRCUIT_OPEN' });
        const projection = projectAgentHttpError(error);

        assert.equal(projection.status, 503);
        assert.equal(projection.body.code, 'DIALOG_BOOT_CIRCUIT_OPEN');
        assert.equal(projection.body.retryable, true);
    });

    it('mapeia erros fatais para 503', () => {
        const error = Object.assign(new Error('Sessão fatal'), { code: 'SESSION_FATAL' });
        const projection = projectAgentHttpError(error);

        assert.equal(projection.status, 503);
        assert.equal(projection.body.disposition, 'fatal');
        assert.equal(projection.body.retryable, false);
    });

    it('permite override por código', () => {
        const error = Object.assign(new Error('Sem sessão'), { code: 'NO_SESSION' });
        const projection = projectAgentHttpError(error, {
            statusByCode: { NO_SESSION: 409 },
        });

        assert.equal(projection.status, 409);
        assert.equal(projection.body.code, 'NO_SESSION');
    });
});
