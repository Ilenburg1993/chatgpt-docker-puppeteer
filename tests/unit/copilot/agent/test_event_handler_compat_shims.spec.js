// @ts-check

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

describe('agent › event-handler compat shims', () => {
    it('mantém session-lifecycle legado apontando para o export canônico', async () => {
        const legacy = await import('#copilot/agent/session/event-handlers/session-lifecycle');
        const canonical = await import('#copilot/event-handlers/session-lifecycle');

        assert.strictEqual(legacy.wireSessionLifecycleEvents, canonical.wireSessionLifecycleEvents);
    });

    it('mantém mode-and-tools legado apontando para o export canônico', async () => {
        const legacy = await import('#copilot/agent/session/event-handlers/mode-and-tools');
        const canonical = await import('#copilot/event-handlers/mode-and-tools');

        assert.strictEqual(legacy.wireModeAndToolEvents, canonical.wireModeAndToolEvents);
    });
});
