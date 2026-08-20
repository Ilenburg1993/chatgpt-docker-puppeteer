// @ts-check

import { describe, expect, it } from 'vitest';
import { analyzeCopilotFsReadSource } from '../../../scripts/ci/check-copilot-fs-read-boundaries.mjs';

/** @param {string} source @param {string} [file] */
function operations(source, file = 'src/copilot/example.js') {
    return analyzeCopilotFsReadSource(source, file)
        .sites.map((site) => ({ operation: site.operation, lowLevelAllowed: site.lowLevelAllowed }))
        .sort((left, right) => left.operation.localeCompare(right.operation));
}

describe('Copilot filesystem read boundary guard', () => {
    it('detects named, namespace and promises-namespace reads through aliases', () => {
        expect(
            operations(`
                import { readFile as load } from 'node:fs/promises';
                import fs from 'node:fs/promises';
                import { promises as fsp } from 'node:fs';
                await load('/tmp/a');
                await fs.stat('/tmp/a');
                await fsp.readdir('/tmp');
            `),
        ).toEqual([
            { operation: 'readdir', lowLevelAllowed: false },
            { operation: 'readFile', lowLevelAllowed: false },
            { operation: 'stat', lowLevelAllowed: false },
        ]);
    });

    it('classifies read-only open but leaves mutating open to the mutation guard', () => {
        expect(
            operations(`
                import { open } from 'node:fs/promises';
                await open('/tmp/a');
                await open('/tmp/b', 'r');
                await open('/tmp/c', 'w');
                await open('/tmp/d', 'r+');
            `),
        ).toEqual([
            { operation: 'open:read', lowLevelAllowed: false },
            { operation: 'open:read', lowLevelAllowed: false },
        ]);
    });

    it('does not confuse unrelated object methods with filesystem reads', () => {
        expect(operations(`const repo = { readFile() {}, stat() {} }; repo.readFile('x'); repo.stat('x');`)).toEqual(
            [],
        );
    });

    it('marks the canonical low-level filesystem implementation root as allowed', () => {
        expect(
            operations(
                `import { readFile } from 'node:fs/promises'; await readFile('/tmp/a');`,
                'src/copilot/infra/io/fs/example-primitive.js',
            ),
        ).toEqual([{ operation: 'readFile', lowLevelAllowed: true }]);
    });
});
