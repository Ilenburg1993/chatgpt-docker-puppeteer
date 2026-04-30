// @ts-check

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'vitest';

const ROOT = new URL('../../../../src/copilot/', import.meta.url).pathname;

/**
 * @param {string} relPath
 * @returns {string}
 */
function readSrc(relPath) {
    return readFileSync(join(ROOT, relPath), 'utf8');
}

describe('contracts/runtime-state-governance — estado vivo multi-runtime é explicitamente chaveado', () => {
    it('copilot-api dialog serializa turnos por runtimeId, não por processo', () => {
        const src = readSrc('server/routes/copilot-api/dialog.js');

        assert.match(src, /const turnInFlightByRuntime = new Map\(\)/);
        assert.match(src, /const runtimeKey = deps\.runtimeId \?\? ['"]default['"]/);
        assert.match(src, /turnInFlightByRuntime\.has\(runtimeKey\)/);
        assert.match(src, /turnInFlightByRuntime\.set\(runtimeKey, true\)/);
        assert.match(src, /turnInFlightByRuntime\.delete\(runtimeKey\)/);
        assert.doesNotMatch(src, /\b_turnInFlight\b/);
    });

    it('copilot-api stream mantém pools por runtimeId resolvido', () => {
        const src = readSrc('server/routes/copilot-api/stream.js');

        assert.match(src, /const runtimeStates = new Map\(\)/);
        assert.match(src, /const runtimeKey = deps\.runtimeId/);
        assert.match(src, /runtimeStates\.get\(runtimeKey\)/);
        assert.match(src, /runtimeStates\.set\(runtimeKey, state\)/);
        assert.match(src, /runtimeStates\.delete\(state\.runtimeId\)/);
    });

    it('sdk agent/hooks/session streams não colidem entre runtimes', () => {
        const agentSrc = readSrc('server/routes/sdk/agent.js');
        const hooksSrc = readSrc('server/routes/sdk/hooks.js');
        const sessionSrc = readSrc('server/routes/sdk/session-messaging.js');

        assert.match(agentSrc, /const key = routeDeps\.runtimeId \?\? ['"]default['"]/);
        assert.match(agentSrc, /streamStates\.get\(key\)/);
        assert.match(agentSrc, /streamStates\.set\(key, state\)/);

        assert.match(hooksSrc, /const runtimeKey = routeDeps\.runtimeId \|\| ['"]default['"]/);
        assert.match(hooksSrc, /_hookRuntimeStates\.get\(runtimeKey\)/);
        assert.match(hooksSrc, /_hookRuntimeStates\.set\(runtimeKey, state\)/);

        assert.match(sessionSrc, /const runtimeId = routeDeps\.runtimeId \|\| ['"]default['"]/);
        assert.match(sessionSrc, /const key = `\$\{runtimeId\}:\$\{id\}`/);
        assert.match(sessionSrc, /_sessionStreamStates\.get\(key\)/);
        assert.match(sessionSrc, /_sessionStreamStates\.set\(key, state\)/);
    });
});
