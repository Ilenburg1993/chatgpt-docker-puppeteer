// @ts-check

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { afterEach, describe, it } from 'vitest';
import { listSourceFilesSync, shouldIgnoreSourceDirectory } from '../../../../scripts/lib/source-tree.mjs';

/** @type {string[]} */
const roots = [];

afterEach(() => {
    while (roots.length > 0) {
        const root = roots.pop();
        if (root) rmSync(root, { recursive: true, force: true });
    }
});

function createFixtureRoot() {
    const root = mkdtempSync(join(tmpdir(), 'copilot-source-tree-'));
    roots.push(root);
    return root;
}

describe('architecture source-tree scanner policy', () => {
    it('excludes hidden operational trees and returns deterministic source ordering', () => {
        const root = createFixtureRoot();
        mkdirSync(join(root, 'z'), { recursive: true });
        mkdirSync(join(root, 'a'), { recursive: true });
        mkdirSync(join(root, '.ai', 'jobs'), { recursive: true });
        mkdirSync(join(root, 'logs'), { recursive: true });
        writeFileSync(join(root, 'z', 'b.js'), 'export const b = 1;\n');
        writeFileSync(join(root, 'a', 'a.mjs'), 'export const a = 1;\n');
        writeFileSync(join(root, 'a', 'ignored.json'), '{}\n');
        writeFileSync(join(root, '.ai', 'jobs', 'transient.js'), 'throw new Error();\n');
        writeFileSync(join(root, 'logs', 'runtime.js'), 'throw new Error();\n');

        const files = listSourceFilesSync(root, { extensions: ['.js', '.mjs'] }).map((file) =>
            relative(root, file).replaceAll('\\', '/'),
        );

        assert.deepEqual(files, ['a/a.mjs', 'z/b.js']);
        assert.equal(shouldIgnoreSourceDirectory('.ai'), true);
        assert.equal(shouldIgnoreSourceDirectory('logs'), true);
        assert.equal(shouldIgnoreSourceDirectory('src'), false);
    });

    it('treats a concurrently disappeared directory as an empty source slice', () => {
        const root = createFixtureRoot();
        const missing = join(root, 'already-gone');
        assert.deepEqual(listSourceFilesSync(missing, { extensions: ['.js'] }), []);
    });

    it('fails closed for filesystem errors other than ENOENT', () => {
        const root = createFixtureRoot();
        const file = join(root, 'not-a-directory.js');
        writeFileSync(file, 'export {};\n');
        assert.throws(
            () => listSourceFilesSync(file, { extensions: ['.js'] }),
            (error) => {
                const code =
                    error && typeof error === 'object' && 'code' in error
                        ? /** @type {{code?:unknown}} */ (error).code
                        : null;
                return code === 'ENOTDIR';
            },
        );
    });
});
