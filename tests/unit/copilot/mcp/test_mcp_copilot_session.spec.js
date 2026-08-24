// @ts-check
/**
 * Tests for Copilot session MCP tools.
 */

import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'vitest';

import { copilotSessionTools } from '#copilot/testing/mcp/tools/copilot-session';
import {
    clearActiveSdkSessions,
    registerActiveSdkSession,
} from '../../../../src/copilot/sdk/session/session-registry.js';

const listTool = copilotSessionTools.find((tool) => tool.name === 'copilot_sessions_list');
const getTool = copilotSessionTools.find((tool) => tool.name === 'copilot_session_get');

describe('copilot MCP session tools', () => {
    afterEach(() => {
        clearActiveSdkSessions();
    });

    it('lists active SDK sessions without exposing live session objects', async () => {
        assert.ok(listTool);
        registerActiveSdkSession(/** @type {any} */ ({ sessionId: 'sdk-1' }), {
            model: 'auto',
            createdAt: 123,
            messagesCount: 4,
        });

        const result = await listTool.handler({});

        assert.equal(result.isError, undefined);
        assert.deepEqual(result.structuredContent['sessions'], [
            { sessionId: 'sdk-1', model: 'auto', createdAt: 123, messagesCount: 4 },
        ]);
        const first = /** @type {Record<string, unknown>[]} */ (result.structuredContent['sessions'])[0];
        assert.equal(Object.prototype.hasOwnProperty.call(first, 'session'), false);
    });

    it('returns one active SDK session summary by id', async () => {
        assert.ok(getTool);
        registerActiveSdkSession(/** @type {any} */ ({ sessionId: 'sdk-2' }), {
            model: 'gpt-test',
            createdAt: 456,
            messagesCount: 7,
        });

        const result = await getTool.handler({ sessionId: 'sdk-2' });

        assert.equal(result.isError, undefined);
        assert.deepEqual(result.structuredContent['session'], {
            sessionId: 'sdk-2',
            model: 'gpt-test',
            createdAt: 456,
            messagesCount: 7,
        });
    });

    it('does not create sessions when the requested id is unknown', async () => {
        assert.ok(getTool);

        const result = await getTool.handler({ sessionId: 'missing' });

        assert.equal(result.isError, true);
        assert.equal(result.structuredContent['success'], false);
    });
});
