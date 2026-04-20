import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import {
    clearActiveSdkSessionOwnership,
    clearActiveSdkSessionOwnershipWithPolicy,
    syncActiveSessionOwnership,
    syncActiveSessionOwnershipWithPolicy,
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

    it('syncActiveSessionOwnershipWithPolicy retorna sucesso explícito quando o vínculo é persistido', async () => {
        clearSharedSessionBinding();
        setSharedHubSessionId('hub-3');

        const result = await syncActiveSessionOwnershipWithPolicy(
            'sdk-3',
            {
                getHubSessionId,
                setSharedSdkSessionId,
                conversationStore: {
                    updateSdkSession() {},
                },
            },
            { label: 'test.ownership.sync' },
        );

        assert.equal(result.ok, true);
        if (result.ok) {
            assert.equal(result.value.persistedToStore, true);
            assert.equal(result.value.sdkSessionId, 'sdk-3');
        }
    });

    it('syncActiveSessionOwnershipWithPolicy classifica falha do store sem quebrar o contrato do wrapper', async () => {
        clearSharedSessionBinding();
        setSharedHubSessionId('hub-4');

        const result = await syncActiveSessionOwnershipWithPolicy(
            'sdk-4',
            {
                getHubSessionId,
                setSharedSdkSessionId,
                conversationStore: {
                    updateSdkSession() {
                        throw new Error('db down');
                    },
                },
            },
            { label: 'test.ownership.sync.error' },
        );

        assert.equal(result.ok, false);
        if (!result.ok) {
            assert.equal(result.disposition, 'retry');
            assert.match(result.error.message, /db down/);
        }
    });

    it('clearActiveSdkSessionOwnershipWithPolicy retorna sucesso explícito ao limpar o binding', async () => {
        clearSharedSessionBinding();
        setSharedHubSessionId('hub-5');
        setSharedSdkSessionId('sdk-5');

        const result = await clearActiveSdkSessionOwnershipWithPolicy(
            { getHubSessionId, setSharedSdkSessionId },
            {
                label: 'test.ownership.clear',
            },
        );

        assert.equal(result.ok, true);
        if (result.ok) {
            assert.deepEqual(result.value, { hubSessionId: 'hub-5', sdkSessionId: null });
        }
    });
});
