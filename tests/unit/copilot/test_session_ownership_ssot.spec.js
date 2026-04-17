import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
    clearActiveSdkSessionOwnership,
    syncActiveSessionOwnership,
} from '../../../src/copilot/agent/session/ownership.js';
import {
    clearSharedSessionBinding,
    getHubSessionId,
    getSharedSdkSessionId,
    getSharedSessionBinding,
    setSharedHubSessionId,
    setSharedSdkSessionId,
} from '../../../src/copilot/core/index.js';

describe('session ownership SSOT', () => {
    it('sincroniza sdkSessionId compartilhado e persiste vínculo no store quando houver hub ativo', () => {
        clearSharedSessionBinding();
        setSharedHubSessionId('hub-1');

        /** @type {{ calls: any[] }} */
        const tracker = { calls: [] };
        const result = syncActiveSessionOwnership('sdk-1', {
            getHubSessionId,
            setSharedSdkSessionId,
            conversationStore: {
                updateSdkSession(hubSessionId, sdkSessionId) {
                    tracker.calls.push({ hubSessionId, sdkSessionId });
                },
            },
        });

        assert.equal(getSharedSdkSessionId(), 'sdk-1');
        assert.deepEqual(getSharedSessionBinding(), { hubSessionId: 'hub-1', sdkSessionId: 'sdk-1' });
        assert.deepEqual(tracker.calls, [{ hubSessionId: 'hub-1', sdkSessionId: 'sdk-1' }]);
        assert.equal(result.persistedToStore, true);
    });

    it('limpa apenas sdkSessionId preservando hubSessionId', () => {
        clearSharedSessionBinding();
        setSharedHubSessionId('hub-2');
        setSharedSdkSessionId('sdk-2');

        const result = clearActiveSdkSessionOwnership({ getHubSessionId, setSharedSdkSessionId });

        assert.deepEqual(result, { hubSessionId: 'hub-2', sdkSessionId: null });
        assert.equal(getHubSessionId(), 'hub-2');
        assert.equal(getSharedSdkSessionId(), null);
    });
});
