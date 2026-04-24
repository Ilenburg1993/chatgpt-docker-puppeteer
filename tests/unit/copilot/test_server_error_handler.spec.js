// @ts-check

import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'vitest';

import { sanitizeHttpErrorMessage } from '../../../src/copilot/server/middleware/error-handler.js';

describe('server error-handler', () => {
    const originalNodeEnv = process.env['NODE_ENV'];

    afterEach(() => {
        if (originalNodeEnv === undefined) {
            delete process.env['NODE_ENV'];
        } else {
            process.env['NODE_ENV'] = originalNodeEnv;
        }
    });

    it('remove stack trace e paths absolutos em respostas de erro', () => {
        process.env['NODE_ENV'] = 'development';

        const sanitized = sanitizeHttpErrorMessage(
            'boom at /workspaces/chatgpt-docker-puppeteer/src/file.js\n    at stack line',
            500,
        );

        assert.equal(sanitized, 'boom at <workspace>');
    });

    it('oculta mensagem de erro 5xx em produção', () => {
        process.env['NODE_ENV'] = 'production';

        assert.equal(sanitizeHttpErrorMessage('database password leaked', 500), 'Internal server error');
    });
});
