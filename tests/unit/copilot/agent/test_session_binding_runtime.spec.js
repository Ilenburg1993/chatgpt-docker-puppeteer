// @ts-check
import { AlwaysAliveAgent } from '#copilot/agent/always-alive';
import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

describe('agent runtime session binding ownership', () => {
    it('keeps two live runtimes isolated in the same process', () => {
        const a = new AlwaysAliveAgent();
        const b = new AlwaysAliveAgent();
        a.setHubSessionId('hub-a');
        a.setSdkSessionId('sdk-a');
        b.setHubSessionId('hub-b');
        b.setSdkSessionId('sdk-b');
        assert.deepEqual(a.getSessionBindingSnapshot(), {
            hubSessionId: 'hub-a',
            sdkSessionId: 'sdk-a',
            revision: 2,
            disposed: false,
        });
        assert.deepEqual(b.getSessionBindingSnapshot(), {
            hubSessionId: 'hub-b',
            sdkSessionId: 'sdk-b',
            revision: 2,
            disposed: false,
        });
        a.clearSessionBinding();
        assert.equal(a.getSessionBindingSnapshot().hubSessionId, null);
        assert.equal(b.getSessionBindingSnapshot().hubSessionId, 'hub-b');
    });

    it('normalizes blank identities and revisions only on semantic changes', () => {
        const agent = new AlwaysAliveAgent();
        agent.setHubSessionId('  hub  ');
        agent.setHubSessionId('hub');
        agent.setSdkSessionId('   ');
        const snapshot = agent.getSessionBindingSnapshot();
        assert.equal(snapshot.hubSessionId, 'hub');
        assert.equal(snapshot.sdkSessionId, null);
        assert.equal(snapshot.revision, 1);
    });
});
