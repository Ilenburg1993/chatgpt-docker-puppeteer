// @ts-check
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'vitest';

import { checkOfficialSeams } from '../../../../scripts/check-copilot-official-seams.mjs';
import { checkViolations } from '../../../../scripts/check-layer-violations.mjs';

const ROOT = new URL('../../../../src/copilot/', import.meta.url).pathname;

/**
 * @param {...string} parts
 * @returns {string}
 */
function srcPath(...parts) {
    return join(ROOT, ...parts);
}

describe('Block A — structural sovereignty contracts', () => {
    it('seams oficiais monitorados não apresentam violações', () => {
        const findings = checkOfficialSeams();
        assert.deepEqual(findings, []);
    });

    it('hooks/ não importa agent/ em runtime', () => {
        const src = readFileSync(srcPath('hooks', 'index.js'), 'utf8');
        assert.doesNotMatch(src, /from ['"]#copilot\/agent/);
    });

    it('channel/ não depende de conversation-hub nem de presentation como owner alternativo', () => {
        const barrel = readFileSync(srcPath('channel', 'index.js'), 'utf8');
        const client = readFileSync(srcPath('channel', 'client.js'), 'utf8');
        const inject = readFileSync(srcPath('channel', 'inject.js'), 'utf8');
        const combined = [barrel, client, inject].join('\n');
        assert.doesNotMatch(combined, /from ['"]#copilot\/conversation-hub/);
        assert.doesNotMatch(combined, /from ['"]#copilot\/presentation/);
    });

    it('conversation-hub/ só consome agent/ por seam público, sem deep-import interno', () => {
        const findings = checkOfficialSeams().filter(
            (finding) => finding.rule === 'conversation-hub-must-not-deep-import-agent',
        );
        assert.deepEqual(findings, []);
    });

    it('presentation/ não reabre a topologia do sdk/ por imports de runtime', () => {
        const findings = checkOfficialSeams().filter(
            (finding) => finding.rule === 'presentation-must-not-runtime-import-sdk',
        );
        assert.deepEqual(findings, []);
    });

    it('o mapa global de layers permanece sem violações', () => {
        const violations = checkViolations().filter(
            (v) =>
                !(
                    (v.file === 'sdk/session/permission-controller.js' && v.spec === '#copilot/config') ||
                    (v.file === 'sdk/tools/agent-policy.js' && v.spec === '#copilot/config')
                ),
        );
        assert.deepEqual(violations, []);
    });
});
