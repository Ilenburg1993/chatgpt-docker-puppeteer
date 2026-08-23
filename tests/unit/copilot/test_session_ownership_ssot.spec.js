import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import { createAgentSessionBindingRuntime } from '../../../src/copilot/agent/session/state/binding-runtime.js';
import {
    clearActiveSdkSessionOwnership,
    clearActiveSdkSessionOwnershipWithPolicy,
    syncActiveSessionOwnership,
    syncActiveSessionOwnershipWithPolicy,
} from '../../../src/copilot/agent/session/state/ownership.js';

describe('session ownership SSOT', () => {
    it('sincroniza sdkSessionId no binding do runtime e persiste vínculo no store quando houver hub ativo', () => {
        const sessionBinding = createAgentSessionBindingRuntime({ hubSessionId: 'hub-1' });
        /** @type {{ calls: {hubSessionId:string;sdkSessionId:string}[] }} */
        const tracker = { calls: [] };

        const result = syncActiveSessionOwnership('sdk-1', {
            sessionBinding,
            conversationStore: {
                updateSdkSession(hubSessionId, sdkSessionId) {
                    tracker.calls.push({ hubSessionId, sdkSessionId });
                },
            },
        });

        assert.deepEqual(sessionBinding.snapshot(), {
            hubSessionId: 'hub-1',
            sdkSessionId: 'sdk-1',
            revision: 1,
            disposed: false,
        });
        assert.deepEqual(tracker.calls, [{ hubSessionId: 'hub-1', sdkSessionId: 'sdk-1' }]);
        assert.equal(result.persistedToStore, true);
    });

    it('limpa apenas sdkSessionId preservando hubSessionId do mesmo runtime', () => {
        const sessionBinding = createAgentSessionBindingRuntime({ hubSessionId: 'hub-2', sdkSessionId: 'sdk-2' });

        const result = clearActiveSdkSessionOwnership({ sessionBinding });

        assert.deepEqual(result, { hubSessionId: 'hub-2', sdkSessionId: null });
        assert.equal(sessionBinding.snapshot().hubSessionId, 'hub-2');
        assert.equal(sessionBinding.snapshot().sdkSessionId, null);
    });

    it('bindings de runtimes distintos não contaminam ownership entre si', () => {
        const first = createAgentSessionBindingRuntime({ hubSessionId: 'hub-a' });
        const second = createAgentSessionBindingRuntime({ hubSessionId: 'hub-b', sdkSessionId: 'sdk-b' });

        syncActiveSessionOwnership('sdk-a', { sessionBinding: first });

        assert.equal(first.snapshot().sdkSessionId, 'sdk-a');
        assert.deepEqual(second.snapshot(), {
            hubSessionId: 'hub-b',
            sdkSessionId: 'sdk-b',
            revision: 0,
            disposed: false,
        });
    });

    it('syncActiveSessionOwnershipWithPolicy retorna sucesso explícito quando o vínculo é persistido', async () => {
        const sessionBinding = createAgentSessionBindingRuntime({ hubSessionId: 'hub-3' });
        const result = await syncActiveSessionOwnershipWithPolicy(
            'sdk-3',
            {
                sessionBinding,
                conversationStore: { updateSdkSession() {} },
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
        const sessionBinding = createAgentSessionBindingRuntime({ hubSessionId: 'hub-4' });
        const result = await syncActiveSessionOwnershipWithPolicy(
            'sdk-4',
            {
                sessionBinding,
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
        const sessionBinding = createAgentSessionBindingRuntime({ hubSessionId: 'hub-5', sdkSessionId: 'sdk-5' });
        const result = await clearActiveSdkSessionOwnershipWithPolicy(
            { sessionBinding },
            { label: 'test.ownership.clear' },
        );

        assert.equal(result.ok, true);
        if (result.ok) assert.deepEqual(result.value, { hubSessionId: 'hub-5', sdkSessionId: null });
    });
});
