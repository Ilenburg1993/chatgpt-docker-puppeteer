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

        assert.match(src, /runtime-state\/copilot-api-dialog\.js/);
        assert.match(src, /const runtimeKey = deps\.runtimeId \?\? ['"]default['"]/);
        assert.match(src, /hasDialogTurnInFlight\(runtimeKey\)/);
        assert.match(src, /markDialogTurnInFlight\(runtimeKey\)/);
        assert.match(src, /clearDialogTurnInFlight\(runtimeKey\)/);
        assert.doesNotMatch(src, /^\s*(?:const|let)\s+\w+\s*=\s*new Map\(/m);
        assert.doesNotMatch(src, /\b_turnInFlight\b/);
    });

    it('copilot-api stream mantém pools por runtimeId resolvido', () => {
        const src = readSrc('server/routes/copilot-api/stream.js');

        assert.match(src, /runtime-state\/copilot-api-stream\.js/);
        assert.match(src, /const runtimeKey = deps\.runtimeId/);
        assert.match(src, /getCopilotApiStreamState\(runtimeKey\)/);
        assert.match(src, /setCopilotApiStreamState\(runtimeKey, state\)/);
        assert.match(src, /deleteCopilotApiStreamState\(state\.runtimeId\)/);
        assert.doesNotMatch(src, /^\s*(?:const|let)\s+\w+\s*=\s*new Map\(/m);
    });

    it('sdk agent/hooks/session streams não colidem entre runtimes', () => {
        const agentSrc = readSrc('server/routes/sdk/agent.js');
        const hooksSrc = readSrc('server/routes/sdk/hooks.js');
        const sessionSrc = readSrc('server/routes/sdk/session-messaging.js');
        const sessionStreamSrc = readSrc('server/routes/sdk/session-stream-state.js');

        assert.match(agentSrc, /const key = routeDeps\.runtimeId \?\? ['"]default['"]/);
        assert.match(agentSrc, /runtime-state\/sdk-agent-stream\.js/);
        assert.match(agentSrc, /getSdkAgentStreamState\(key\)/);
        assert.match(agentSrc, /setSdkAgentStreamState\(key, state\)/);
        assert.doesNotMatch(agentSrc, /^\s*(?:const|let)\s+\w+\s*=\s*new Map\(/m);

        assert.match(hooksSrc, /const runtimeKey = routeDeps\.runtimeId \|\| ['"]default['"]/);
        assert.match(hooksSrc, /runtime-state\/sdk-hooks-stream\.js/);
        assert.match(hooksSrc, /getSdkHooksRuntimeState\(runtimeKey\)/);
        assert.match(hooksSrc, /setSdkHooksRuntimeState\(runtimeKey, state\)/);
        assert.doesNotMatch(hooksSrc, /^\s*(?:const|let)\s+\w+\s*=\s*new Map\(/m);

        assert.match(sessionSrc, /session-stream-state\.js/);
        assert.match(sessionStreamSrc, /const runtimeId = routeDeps\.runtimeId \|\| ['"]default['"]/);
        assert.match(sessionStreamSrc, /runtime-state\/sdk-session-stream\.js/);
        assert.match(sessionStreamSrc, /const key = buildSdkSessionStreamKey\(runtimeId, id\)/);
        assert.match(sessionStreamSrc, /getSdkSessionStreamState\(key\)/);
        assert.match(sessionStreamSrc, /setSdkSessionStreamState\(key, state\)/);
        assert.doesNotMatch(sessionSrc, /^\s*(?:const|let)\s+\w+\s*=\s*new Map\(/m);
        assert.doesNotMatch(sessionStreamSrc, /^\s*(?:const|let)\s+\w+\s*=\s*new Map\(/m);
    });
});
