import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'vitest';

import {
    clearActiveSdkSessions,
    getActiveSdkSession,
    getActiveSdkSessionCount,
    incrementActiveSdkSessionMessageCount,
    listActiveSdkSessions,
    registerActiveSdkSession,
    removeActiveSdkSession,
} from '../../../../src/copilot/sdk/session/session-registry.js';

describe('D1 — sdk session registry externalization', () => {
    it('client.js delega o registry para sdk/session/session-registry.js', async () => {
        const src = await readFile(new URL('../../../../src/copilot/sdk/session/client.js', import.meta.url), 'utf8');

        assert.match(src, /session-registry\.js/);
        assert.doesNotMatch(src, /infra\/sdk-session-registry\.js/);
        assert.doesNotMatch(src, /const _sessions = new Map\(/);
    });

    it('registry externo registra, lista, incrementa e remove sessões ativas', () => {
        clearActiveSdkSessions();

        const session = /** @type {any} */ ({ sessionId: 'sdk-d1-session' });
        registerActiveSdkSession(session, { model: 'gpt-4.1', createdAt: 123, messagesCount: 0 });

        assert.equal(getActiveSdkSessionCount(), 1);
        assert.equal(getActiveSdkSession('sdk-d1-session')?.session, session);
        assert.equal(incrementActiveSdkSessionMessageCount('sdk-d1-session'), 1);
        assert.equal(listActiveSdkSessions()[0]?.sessionId, 'sdk-d1-session');

        assert.equal(removeActiveSdkSession('sdk-d1-session'), true);
        assert.equal(getActiveSdkSessionCount(), 0);
    });
});
