// @ts-check

import { spawn } from 'node:child_process';
import { access, mkdtemp, open, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const MOVE_URL = new URL('../../../../src/copilot/infra/io/fs/move.js', import.meta.url).href;
const CHILD_SCRIPT = `
const options = JSON.parse(process.env.COPILOT_MOVE_CRASH_CASE);
const { moveFileUnlocked } = await import(options.moveUrl);
const { open } = await import('node:fs/promises');
const path = await import('node:path');
const print = (value) => process.stdout.write(JSON.stringify(value) + '\\n');
setInterval(() => {}, 60_000);

const onPhase = async (phase, details) => {
    if (phase !== options.targetPhase) return;
    print({ reached: phase, details });
    await new Promise(() => {});
};

let syncCalls = 0;
const syncDirectory =
    options.targetPhase === 'inside-destination-directory-sync'
        ? async (target) => {
              syncCalls += 1;
              const handle = await open(path.dirname(target), 'r');
              try {
                  await handle.sync();
              } finally {
                  await handle.close();
              }
              if (syncCalls === 1) {
                  print({ reached: 'inside-destination-directory-sync', details: { target } });
                  await new Promise(() => {});
              }
              return { attempted: true, ok: true };
          }
        : undefined;

await moveFileUnlocked(options.source, options.destination, {
    overwrite: false,
    onPhase,
    ...(syncDirectory ? { syncDirectory } : {}),
});
print({ completed: true });
`;

/** @type {string[]} */
const tempDirs = [];
/** @type {import('node:child_process').ChildProcess[]} */
const liveChildren = [];

afterEach(async () => {
    for (const child of liveChildren.splice(0)) {
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    }
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function hasDistinctSharedMemoryDevice() {
    try {
        return (await stat('/dev/shm')).dev !== (await stat(tmpdir())).dev;
    } catch {
        return false;
    }
}

/**
 * @param {import('node:child_process').ChildProcess} child
 * @param {string} expectedPhase
 */
function waitForPhase(child, expectedPhase) {
    return new Promise((resolve, reject) => {
        let stdout = '';
        let stderr = '';
        const timer = setTimeout(() => reject(new Error(`phase timeout: ${expectedPhase}\n${stderr}`)), 10_000);

        child.stdout?.setEncoding('utf8');
        child.stderr?.setEncoding('utf8');
        child.stdout?.on('data', (chunk) => {
            stdout += chunk;
            const lines = stdout.split('\n');
            stdout = lines.pop() ?? '';
            for (const line of lines) {
                if (!line.startsWith('{')) continue;
                const value = JSON.parse(line);
                if (value.reached === expectedPhase) {
                    clearTimeout(timer);
                    resolve(value);
                    return;
                }
            }
        });
        child.stderr?.on('data', (chunk) => {
            stderr += chunk;
        });
        child.once('error', (error) => {
            clearTimeout(timer);
            reject(error);
        });
        child.once('close', (code, signal) => {
            clearTimeout(timer);
            reject(new Error(`child exited before ${expectedPhase}: code=${code} signal=${signal}\n${stderr}`));
        });
    });
}

/**
 * @param {{ source: string; destination: string; targetPhase: string }} options
 */
function startCrashCase(options) {
    const child = spawn(process.execPath, ['--input-type=module', '-e', CHILD_SCRIPT], {
        cwd: process.cwd(),
        env: {
            ...process.env,
            COPILOT_MOVE_CRASH_CASE: JSON.stringify({ moveUrl: MOVE_URL, ...options }),
        },
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    liveChildren.push(child);
    return child;
}

/**
 * @param {import('node:child_process').ChildProcess} child
 */
async function killAndWait(child) {
    const closed = new Promise((resolve) => child.once('close', resolve));
    child.kill('SIGKILL');
    await closed;
    expect(child.signalCode).toBe('SIGKILL');
}

async function expectMissing(filePath) {
    await expect(access(filePath)).rejects.toMatchObject({ code: 'ENOENT' });
}

/**
 * @param {string} directory
 */
async function moveTemps(directory) {
    return (await readdir(directory)).filter((entry) => entry.endsWith('.move.tmp'));
}

describe('move EXDEV real crash states', () => {
    it(
        'preserves recoverable physical states across internal EXDEV crash phases',
        async () => {
            if (!(await hasDistinctSharedMemoryDevice())) return;
            const sourceRoot = await mkdtemp(path.join(tmpdir(), 'copilot-move-crash-source-'));
            const destinationRoot = await mkdtemp('/dev/shm/copilot-move-crash-destination-');
            tempDirs.push(sourceRoot, destinationRoot);
            const payload = Buffer.alloc(256 * 1024, 0x5a);

            const cases = [
                {
                    id: 'temp-written',
                    sourceExpected: true,
                    destinationExpected: false,
                    tempExpected: true,
                },
                {
                    id: 'before-destination-directory-sync',
                    sourceExpected: true,
                    destinationExpected: true,
                    tempExpected: false,
                },
                {
                    id: 'inside-destination-directory-sync',
                    sourceExpected: true,
                    destinationExpected: true,
                    tempExpected: false,
                },
                {
                    id: 'after-source-unlink',
                    sourceExpected: false,
                    destinationExpected: true,
                    tempExpected: false,
                },
            ];

            for (const scenario of cases) {
                const source = path.join(sourceRoot, `${scenario.id}.bin`);
                const destinationDir = path.join(destinationRoot, scenario.id);
                const destination = path.join(destinationDir, 'destination.bin');
                await import('node:fs/promises').then(({ mkdir }) => mkdir(destinationDir, { recursive: true }));
                await writeFile(source, payload);

                const child = startCrashCase({ source, destination, targetPhase: scenario.id });
                const reached = /** @type {{ details?: { tmpDestination?: string } }} */ (
                    await waitForPhase(child, scenario.id)
                );
                await killAndWait(child);

                if (scenario.sourceExpected) expect(await readFile(source)).toEqual(payload);
                else await expectMissing(source);
                if (scenario.destinationExpected) expect(await readFile(destination)).toEqual(payload);
                else await expectMissing(destination);

                const temps = await moveTemps(destinationDir);
                expect(temps).toHaveLength(scenario.tempExpected ? 1 : 0);
                if (scenario.tempExpected) {
                    expect(reached.details?.tmpDestination).toBe(path.join(destinationDir, temps[0]));
                    expect(await readFile(path.join(destinationDir, temps[0]))).toEqual(payload);
                    const handle = await open(destinationDir, 'r');
                    await handle.sync();
                    await handle.close();
                    await rm(path.join(destinationDir, temps[0]), { force: true });
                }
            }
        },
        30_000,
    );
});
