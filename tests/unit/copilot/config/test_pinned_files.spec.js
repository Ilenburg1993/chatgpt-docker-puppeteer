// @ts-check

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { PinnedFilesLoader } from '../../../../src/copilot/config/pinned-files.js';

/** @type {string[]} */
const TEMP_DIRS = [];

async function createTempDir() {
    const dir = await mkdtemp(join(tmpdir(), 'copilot-pinned-files-'));
    TEMP_DIRS.push(dir);
    return dir;
}

/**
 * @param {PinnedFilesLoader} loader
 * @param {string} file
 * @param {'added' | 'changed' | 'removed'} type
 */
function waitForChange(loader, file, type) {
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            loader.off('changed', onChanged);
            reject(new Error(`timeout waiting for ${type}: ${file}`));
        }, 4_000);
        /** @param {{ file: string; type: string }} event */
        const onChanged = (event) => {
            if (event.file !== file || event.type !== type) return;
            clearTimeout(timeout);
            loader.off('changed', onChanged);
            resolve(event);
        };
        loader.on('changed', onChanged);
    });
}

afterEach(async () => {
    while (TEMP_DIRS.length > 0) {
        const dir = TEMP_DIRS.pop();
        if (dir) await rm(dir, { recursive: true, force: true });
    }
});

describe('config/PinnedFilesLoader', () => {
    it('detecta hot-reload em arquivo nested com recursive watch ou fallback bounded', async () => {
        const root = await createTempDir();
        const nested = join(root, 'nested');
        const file = join(nested, 'context.md');
        await mkdir(nested, { recursive: true });

        const loader = new PinnedFilesLoader([root]);
        await loader.start();
        try {
            const added = waitForChange(loader, file, 'added');
            await writeFile(file, '# first\n', 'utf8');
            await added;
            expect(loader.getFiles().find((entry) => entry.path === file)?.content).toBe('# first\n');

            const changed = waitForChange(loader, file, 'changed');
            await writeFile(file, '# second\n', 'utf8');
            await changed;
            expect(loader.getFiles().find((entry) => entry.path === file)?.content).toBe('# second\n');
        } finally {
            loader.stop();
        }
    });
});
