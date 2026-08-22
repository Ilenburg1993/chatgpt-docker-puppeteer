// @ts-check

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'vitest';

const SCRIPT = fileURLToPath(new URL('../../../../scripts/analysis/infra-public-api-cold-import.mjs', import.meta.url));

/** @param {string[]} args */
function runCli(args) {
    return spawnSync(process.execPath, [SCRIPT, ...args], {
        cwd: process.cwd(),
        encoding: 'utf8',
        timeout: 30_000,
        maxBuffer: 1024 * 1024,
    });
}

describe('Infra cold-import localized CLI governance', () => {
    it('rejects partial baseline writes before measuring or mutating the versioned baseline', () => {
        const result = runCli(['--write-baseline', '--alias=#copilot/infra/public/composition/database/sqlite']);
        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /--write-baseline cannot be combined with --alias/u);
    });

    it('keeps baseline validation exhaustive instead of accepting a selected alias', () => {
        const result = runCli(['--validate-baseline', '--alias=#copilot/infra/public/composition/database/sqlite']);
        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /--validate-baseline cannot be combined with --alias/u);
    });

    it('rejects diagnostic/non-hot aliases from dynamic cold-import selection', () => {
        const result = runCli([
            '--alias=#copilot/infra/public/diagnostic/database/sqlite',
            '--samples=1',
            '--warmups=0',
        ]);
        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /Unknown\/non-hot public alias/u);
    });

    it('measures exactly one requested hot alias', () => {
        const alias = '#copilot/infra/public/composition/database/sqlite';
        const result = runCli([`--alias=${alias}`, '--samples=1', '--warmups=0']);
        assert.equal(result.status, 0, result.stderr);
        const report = /** @type {{mode?:unknown;aliases?:unknown;entries?:Array<{alias?:unknown}>}} */ (
            JSON.parse(result.stdout)
        );
        assert.equal(report.mode, 'benchmark');
        assert.equal(report.aliases, 1);
        assert.deepEqual(
            report.entries?.map((entry) => entry.alias),
            [alias],
        );
    });
});
