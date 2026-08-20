// @ts-check

import { describe, expect, it } from 'vitest';
import { analyzeCopilotFsMutationSource } from '../../../scripts/ci/check-copilot-fs-mutation-boundaries.mjs';

/** @param {string} source @param {string} [file] */
function operations(source, file = 'src/copilot/example.js') {
    return analyzeCopilotFsMutationSource(source, file)
        .sites.map((site) => ({ operation: site.operation, allowed: site.allowed }))
        .sort((left, right) => left.operation.localeCompare(right.operation));
}

describe('Copilot filesystem mutation boundary guard', () => {
    it('detects named and namespace node:fs mutations through aliases', () => {
        expect(
            operations(`
                import { writeFile as persist } from 'node:fs/promises';
                import fs from 'node:fs/promises';
                await persist('/tmp/a', 'x');
                await fs.rm('/tmp/b');
            `),
        ).toEqual([
            { operation: 'rm', allowed: false },
            { operation: 'writeFile', allowed: false },
        ]);
    });

    it('tracks FileHandle mutations and mutating open flags', () => {
        expect(
            operations(`
                import { open } from 'node:fs/promises';
                let handle = null;
                handle = await open('/tmp/a', 'r+');
                await handle.truncate(4);
            `),
        ).toEqual([
            { operation: 'fileHandle.truncate', allowed: false },
            { operation: 'open:mutating', allowed: false },
        ]);
    });

    it('does not confuse unrelated object methods with filesystem mutations', () => {
        expect(
            operations(`
                const store = { async writeFile() {}, async rm() {} };
                await store.writeFile('x');
                await store.rm('x');
            `),
        ).toEqual([]);
    });

    it('allows direct mutation only inside the canonical low-level fs implementation root', () => {
        expect(
            operations(
                `import { unlink } from 'node:fs/promises'; await unlink('/tmp/a');`,
                'src/copilot/infra/io/fs/example-primitive.js',
            ),
        ).toEqual([{ operation: 'unlink', allowed: true }]);
    });
});
