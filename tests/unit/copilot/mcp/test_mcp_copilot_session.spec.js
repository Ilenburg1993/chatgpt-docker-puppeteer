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

const sessionsTool = copilotSessionTools.find((tool) => tool.name === 'copilot_sessions');

describe('copilot MCP session tools', () => {
    afterEach(() => {
        clearActiveSdkSessions();
    });

    it('lists active SDK sessions without exposing live session objects', async () => {
        assert.ok(sessionsTool);
        registerActiveSdkSession(/** @type {any} */ ({ sessionId: 'sdk-1' }), {
            model: 'auto',
            createdAt: 123,
            messagesCount: 4,
        });

        const result = await sessionsTool.handler({ action: 'list' });

        assert.equal(result.isError, undefined);
        assert.deepEqual(result.structuredContent['sessions'], [
            { sessionId: 'sdk-1', model: 'auto', createdAt: 123, messagesCount: 4 },
        ]);
        const first = /** @type {Record<string, unknown>[]} */ (result.structuredContent['sessions'])[0];
        assert.equal(Object.prototype.hasOwnProperty.call(first, 'session'), false);
    });

    it('returns one active SDK session summary by id', async () => {
        assert.ok(sessionsTool);
        registerActiveSdkSession(/** @type {any} */ ({ sessionId: 'sdk-2' }), {
            model: 'gpt-test',
            createdAt: 456,
            messagesCount: 7,
        });

        const result = await sessionsTool.handler({ action: 'get', sessionId: 'sdk-2' });

        assert.equal(result.isError, undefined);
        assert.deepEqual(result.structuredContent['session'], {
            sessionId: 'sdk-2',
            model: 'gpt-test',
            createdAt: 456,
            messagesCount: 7,
        });
    });

    it('does not create sessions when the requested id is unknown', async () => {
        assert.ok(sessionsTool);

        const result = await sessionsTool.handler({ action: 'get', sessionId: 'missing' });

        assert.equal(result.isError, true);
        assert.equal(result.structuredContent['success'], false);
    });
    it('rejects fields that belong to the other session projection', async () => {
        assert.ok(sessionsTool);
        const listConflict = await sessionsTool.handler({ action: 'list', sessionId: 'sdk-1' });
        assert.equal(listConflict.isError, true);
        assert.equal(listConflict.structuredContent['code'], 'ERR_COPILOT_SESSIONS_INACTIVE_FIELDS');

        const getConflict = await sessionsTool.handler({ action: 'get', sessionId: 'sdk-1', limit: 1 });
        assert.equal(getConflict.isError, true);
        assert.equal(getConflict.structuredContent['code'], 'ERR_COPILOT_SESSIONS_INACTIVE_FIELDS');
    });

});
