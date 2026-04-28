// @ts-check
import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import { checkOfficialSeams } from '../../../../scripts/check-copilot-official-seams.mjs';

describe('Block B — SDK boundary sovereignty contracts', () => {
    it('nenhum módulo fora de sdk/ faz deep-import do owner interno de SessionFs', () => {
        const findings = checkOfficialSeams().filter(
            (finding) => finding.rule === 'non-sdk-must-not-deep-import-session-fs',
        );
        assert.deepEqual(findings, []);
    });

    it('sdk barrel expõe a surface pública canônica de SessionFs', async () => {
        const sdk = await import('#copilot/sdk');

        for (const key of [
            'buildConfiguredClientSessionFsConfig',
            'createLocalSessionFsProvider',
            'createWorkspaceSessionFsHandler',
            'getConfiguredSessionFsHandler',
            'getConfiguredSessionIdleTimeoutSeconds',
        ]) {
            assert.ok(key in sdk, `sdk barrel deve expor '${key}'`);
        }
    });
});
