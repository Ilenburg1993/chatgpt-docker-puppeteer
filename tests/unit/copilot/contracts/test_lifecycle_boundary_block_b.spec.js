// @ts-check
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'vitest';

import { checkOfficialSeams } from '../../../../scripts/check-copilot-official-seams.mjs';

const ROOT = new URL('../../../../src/copilot/', import.meta.url).pathname;

/**
 * @param {...string} parts
 * @returns {string}
 */
function srcPath(...parts) {
    return join(ROOT, ...parts);
}

describe('Block B — lifecycle ownership contracts', () => {
    it('agent/lifecycle não chama start/stop/ping/create/resume crus no CopilotClient', () => {
        const findings = checkOfficialSeams().filter(
            (finding) => finding.rule === 'agent-lifecycle-must-not-call-raw-sdk-client-lifecycle',
        );
        assert.deepEqual(findings, []);
    });

    it('agent/session não chama createSession/resumeSession crus no client SDK', () => {
        const findings = checkOfficialSeams().filter(
            (finding) => finding.rule === 'agent-session-must-not-call-raw-sdk-session-create-resume',
        );
        assert.deepEqual(findings, []);
    });

    it('initializer continua dependendo da façade do agent para o lifecycle vanilla do SDK', () => {
        const src = readFileSync(srcPath('agent', 'session', 'initializer.js'), 'utf8');
        assert.match(src, /resumeOrCreateAgentSdkSession/);
        assert.match(src, /createAgentSdkSessionByClient/);
        assert.doesNotMatch(src, /\bclient\.(?:createSession|resumeSession)\(/);
    });
});
