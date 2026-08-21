// @ts-check

import { execFile, spawn } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

import { patchTextLocked } from '#copilot/infra/internal/filesystem/mutation';

const REPLACE_TEXT_CHILD = `
import { rename, writeFile } from 'node:fs/promises';
process.on('message', async (message) => {
    try {
        const tempPath = message.filePath + '.editor-save';
        await writeFile(tempPath, message.content, 'utf8');
        await rename(tempPath, message.filePath);
        process.send?.({ ok: true });
        process.exit(0);
    } catch (error) {
        process.send?.({ ok: false, message: error instanceof Error ? error.message : String(error) });
        process.exit(1);
    }
});
`;
const execFileAsync = promisify(execFile);

/** @type {string[]} */
const tempDirs = [];

afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function createTempDir() {
    const dir = await mkdtemp(join(tmpdir(), 'copilot-io-patch-external-'));
    tempDirs.push(dir);
    return dir;
}

/**
 * @param {string} filePath
 * @param {string} content
 */
async function replaceTextFromChild(filePath, content) {
    const child = spawn(process.execPath, ['--input-type=module', '-e', REPLACE_TEXT_CHILD], {
        stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
    });
    await new Promise((resolve, reject) => {
        child.once('error', reject);
        child.once('message', (message) => {
            const result = /** @type {{ ok?: boolean; message?: string }} */ (message);
            if (result.ok) resolve(undefined);
            else reject(new Error(result.message ?? 'external editor replacement failed'));
        });
        child.send({ filePath, content });
    });
}

/**
 * @param {string} cwd
 * @param {string[]} args
 */
async function git(cwd, args) {
    return execFileAsync('git', ['-C', cwd, ...args], { encoding: 'utf8' });
}

describe('patchTextLocked external writer precondition', () => {
    it('não sobrescreve save externo ocorrido depois do snapshot e antes do publish', async () => {
        const dir = await createTempDir();
        const file = join(dir, 'shared.txt');
        await writeFile(file, 'base value\n', 'utf8');
        let replaced = false;

        await expect(
            patchTextLocked(file, {
                oldString: 'value',
                newString: 'patched',
                onPhase: async (phase) => {
                    if (phase !== 'before-publish' || replaced) return;
                    replaced = true;
                    await replaceTextFromChild(file, 'editor value\n');
                },
            }),
        ).rejects.toMatchObject({ code: 'EEXPECTEDHASH' });

        await expect(readFile(file, 'utf8')).resolves.toBe('editor value\n');
        expect(await readdir(dir)).toEqual(['shared.txt']);
    });

    it('não sobrescreve git checkout ocorrido depois do snapshot e antes do publish', async () => {
        const dir = await createTempDir();
        const file = join(dir, 'shared.txt');
        await git(dir, ['init', '--quiet']);
        await git(dir, ['config', 'user.email', 'io-test@example.invalid']);
        await git(dir, ['config', 'user.name', 'IO Test']);
        await writeFile(file, 'base value\n', 'utf8');
        await git(dir, ['add', 'shared.txt']);
        await git(dir, ['commit', '--quiet', '-m', 'base']);
        await writeFile(file, 'git value\n', 'utf8');
        await git(dir, ['add', 'shared.txt']);
        await git(dir, ['commit', '--quiet', '-m', 'external']);
        const { stdout: externalCommit } = await git(dir, ['rev-parse', 'HEAD']);
        await git(dir, ['checkout', '--quiet', 'HEAD~1', '--', 'shared.txt']);
        let replaced = false;

        await expect(
            patchTextLocked(file, {
                oldString: 'value',
                newString: 'patched',
                onPhase: async (phase) => {
                    if (phase !== 'before-publish' || replaced) return;
                    replaced = true;
                    await git(dir, ['checkout', '--quiet', externalCommit.trim(), '--', 'shared.txt']);
                },
            }),
        ).rejects.toMatchObject({ code: 'EEXPECTEDHASH' });

        await expect(readFile(file, 'utf8')).resolves.toBe('git value\n');
        expect((await git(dir, ['status', '--porcelain=v1', '--untracked-files=no'])).stdout).toBe('');
    });

    it('descarta sidecar de rollback grande quando o writer externo vence', async () => {
        const dir = await createTempDir();
        const rollbackDir = join(dir, 'rollback');
        const file = join(dir, 'shared.txt');
        const originalRollbackDir = process.env['COPILOT_IO_ROLLBACK_DIR'];
        const originalRollbackEnabled = process.env['COPILOT_IO_ROLLBACK_ENABLED'];
        process.env['COPILOT_IO_ROLLBACK_DIR'] = rollbackDir;
        process.env['COPILOT_IO_ROLLBACK_ENABLED'] = 'true';
        await writeFile(file, `${'x'.repeat(300_000)} value\n`, 'utf8');
        let replaced = false;

        try {
            await expect(
                patchTextLocked(file, {
                    oldString: 'value',
                    newString: 'patched',
                    onPhase: async (phase) => {
                        if (phase !== 'before-publish' || replaced) return;
                        replaced = true;
                        await replaceTextFromChild(file, 'editor value\n');
                    },
                }),
            ).rejects.toMatchObject({ code: 'EEXPECTEDHASH' });

            await expect(readFile(file, 'utf8')).resolves.toBe('editor value\n');
            const rollbackEntries = await readdir(rollbackDir).catch((error) => {
                if (/** @type {{ code?: unknown }} */ (error)?.code === 'ENOENT') return [];
                throw error;
            });
            expect(rollbackEntries.filter((entry) => entry.endsWith('.rollback'))).toEqual([]);
        } finally {
            if (originalRollbackDir === undefined) delete process.env['COPILOT_IO_ROLLBACK_DIR'];
            else process.env['COPILOT_IO_ROLLBACK_DIR'] = originalRollbackDir;
            if (originalRollbackEnabled === undefined) delete process.env['COPILOT_IO_ROLLBACK_ENABLED'];
            else process.env['COPILOT_IO_ROLLBACK_ENABLED'] = originalRollbackEnabled;
        }
    });
});
