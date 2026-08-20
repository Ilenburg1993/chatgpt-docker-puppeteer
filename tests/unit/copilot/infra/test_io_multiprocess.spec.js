// @ts-check

import { spawn } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const IO_ENGINE_URL = new URL('../../../../src/copilot/infra/io-engine.js', import.meta.url).href;
const CHILD_SCRIPT = `
const { operation, args } = JSON.parse(process.env['COPILOT_IO_MULTIPROCESS_CASE']);
const io = await import(process.env['COPILOT_IO_ENGINE_URL']);
try {
    if (operation === 'create') {
        await io.createOrReplaceFileAtomic(args.target, args.content, { failIfExists: true, createParentDirs: true });
    } else if (operation === 'copy') {
        await io.copyFileLocked(args.source, args.destination, { overwrite: false });
    } else if (operation === 'move') {
        await io.moveFileLocked(args.source, args.destination, { overwrite: false });
    } else if (operation === 'write') {
        await io.writeFileAtomic(args.target, Buffer.alloc(args.size, args.fillByte));
    } else if (operation === 'lock-once') {
        await io.withIoResourceLock(args.target, async () => undefined);
    } else if (operation === 'lock-hold') {
        await io.withIoResourceLock(args.target, async () => {
            process.stdout.write(JSON.stringify({ acquired: true }) + '\\n');
            await new Promise(() => setInterval(() => {}, 1000));
        });
    } else {
        throw new Error('unknown operation');
    }
    process.stdout.write(JSON.stringify({ ok: true }) + '\\n');
} catch (error) {
    process.stdout.write(JSON.stringify({
        ok: false,
        code: error?.code ?? null,
        message: error instanceof Error ? error.message : String(error),
    }) + '\\n');
}
`;

/** @type {string[]} */
const tempDirs = [];

afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

/**
 * @param {string} lockDir
 * @param {string} operation
 * @param {Record<string, unknown>} args
 * @returns {Promise<{ ok: boolean; code: string | null; message?: string }>}
 */
function runChild(lockDir, operation, args) {
    return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, ['--input-type=module', '-e', CHILD_SCRIPT], {
            cwd: path.dirname(fileURLToPath(IO_ENGINE_URL)),
            env: {
                ...process.env,
                COPILOT_IO_ENGINE_URL: IO_ENGINE_URL,
                COPILOT_IO_FILE_LOCKS_ENABLED: '1',
                COPILOT_IO_FILE_LOCK_DIR: lockDir,
                COPILOT_IO_MULTIPROCESS_CASE: JSON.stringify({ operation, args }),
            },
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        let stdout = '';
        let stderr = '';
        child.stdout.setEncoding('utf8');
        child.stderr.setEncoding('utf8');
        child.stdout.on('data', (chunk) => {
            stdout += chunk;
        });
        child.stderr.on('data', (chunk) => {
            stderr += chunk;
        });
        child.once('error', reject);
        child.once('close', (code) => {
            if (code !== 0) {
                reject(new Error(`child exited ${code}: ${stderr}`));
                return;
            }
            const line = stdout
                .trim()
                .split('\n')
                .findLast((value) => value.startsWith('{'));
            if (!line) {
                reject(new Error(`child produced no result: ${stderr}`));
                return;
            }
            resolve(JSON.parse(line));
        });
    });
}

/**
 * @param {string} lockDir
 * @param {string} target
 * @returns {Promise<import('node:child_process').ChildProcess>}
 */
function startHoldingChild(lockDir, target) {
    return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, ['--input-type=module', '-e', CHILD_SCRIPT], {
            cwd: path.dirname(fileURLToPath(IO_ENGINE_URL)),
            env: {
                ...process.env,
                COPILOT_IO_ENGINE_URL: IO_ENGINE_URL,
                COPILOT_IO_FILE_LOCKS_ENABLED: '1',
                COPILOT_IO_FILE_LOCK_DIR: lockDir,
                COPILOT_IO_MULTIPROCESS_CASE: JSON.stringify({ operation: 'lock-hold', args: { target } }),
            },
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        let stdout = '';
        let stderr = '';
        child.stdout.setEncoding('utf8');
        child.stderr.setEncoding('utf8');
        child.stdout.on('data', (chunk) => {
            stdout += chunk;
            if (stdout.includes('"acquired":true')) resolve(child);
        });
        child.stderr.on('data', (chunk) => {
            stderr += chunk;
        });
        child.once('error', reject);
        child.once('close', (code) => {
            if (!stdout.includes('"acquired":true')) reject(new Error(`holder exited ${code}: ${stderr}`));
        });
    });
}

async function createTempDir() {
    const dir = await mkdtemp(path.join(tmpdir(), 'copilot-io-multiprocess-'));
    tempDirs.push(dir);
    return dir;
}

describe('infra/io multiprocess proofs', () => {
    it('preserva exclusividade e integridade em create/copy/move/write concorrentes', async () => {
        const dir = await createTempDir();
        const lockDir = path.join(dir, '.locks');

        const createTarget = path.join(dir, 'create.txt');
        const createResults = await Promise.all([
            runChild(lockDir, 'create', { target: createTarget, content: 'create-a' }),
            runChild(lockDir, 'create', { target: createTarget, content: 'create-b' }),
        ]);
        expect(createResults.filter((result) => result.ok)).toHaveLength(1);
        expect(createResults.find((result) => !result.ok)?.code).toBe('EEXIST');
        expect(['create-a', 'create-b']).toContain(await readFile(createTarget, 'utf8'));

        const copySourceA = path.join(dir, 'copy-a.txt');
        const copySourceB = path.join(dir, 'copy-b.txt');
        const copyTarget = path.join(dir, 'copy-target.txt');
        await Promise.all([writeFile(copySourceA, 'copy-a'), writeFile(copySourceB, 'copy-b')]);
        const copyResults = await Promise.all([
            runChild(lockDir, 'copy', { source: copySourceA, destination: copyTarget }),
            runChild(lockDir, 'copy', { source: copySourceB, destination: copyTarget }),
        ]);
        expect(copyResults.filter((result) => result.ok)).toHaveLength(1);
        expect(copyResults.find((result) => !result.ok)?.code).toBe('EEXIST');
        expect(['copy-a', 'copy-b']).toContain(await readFile(copyTarget, 'utf8'));

        const moveSourceA = path.join(dir, 'move-a.txt');
        const moveSourceB = path.join(dir, 'move-b.txt');
        const moveTarget = path.join(dir, 'move-target.txt');
        await Promise.all([writeFile(moveSourceA, 'move-a'), writeFile(moveSourceB, 'move-b')]);
        const moveResults = await Promise.all([
            runChild(lockDir, 'move', { source: moveSourceA, destination: moveTarget }),
            runChild(lockDir, 'move', { source: moveSourceB, destination: moveTarget }),
        ]);
        expect(moveResults.filter((result) => result.ok)).toHaveLength(1);
        expect(moveResults.find((result) => !result.ok)?.code).toBe('EEXIST');
        const moved = await readFile(moveTarget, 'utf8');
        expect(['move-a', 'move-b']).toContain(moved);
        const losingSource = moved === 'move-a' ? moveSourceB : moveSourceA;
        expect(await readFile(losingSource, 'utf8')).toBe(moved === 'move-a' ? 'move-b' : 'move-a');

        const writeTarget = path.join(dir, 'write-target.bin');
        const payloadA = Buffer.alloc(512 * 1024, 0x41);
        const payloadB = Buffer.alloc(512 * 1024, 0x42);
        const writeResults = await Promise.all([
            runChild(lockDir, 'write', { target: writeTarget, size: payloadA.byteLength, fillByte: 0x41 }),
            runChild(lockDir, 'write', { target: writeTarget, size: payloadB.byteLength, fillByte: 0x42 }),
        ]);
        expect(writeResults.every((result) => result.ok)).toBe(true);
        const written = await readFile(writeTarget);
        expect(written.equals(payloadA) || written.equals(payloadB)).toBe(true);
    }, 30_000);

    it('recupera lock L1 após crash do processo holder', async () => {
        const dir = await createTempDir();
        const lockDir = path.join(dir, '.locks');
        const target = path.join(dir, 'crash-recovery.txt');
        const holder = await startHoldingChild(lockDir, target);

        expect(await readdir(lockDir)).toHaveLength(1);
        holder.kill('SIGKILL');
        await new Promise((resolve) => holder.once('close', resolve));

        const recovered = await runChild(lockDir, 'lock-once', { target });
        expect(recovered.ok).toBe(true);
        expect(await readdir(lockDir)).toEqual([]);
    }, 30_000);
});
