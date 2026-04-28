// @ts-check

import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
    buildConfiguredClientSessionFsConfig,
    createLocalSessionFsProvider,
    createWorkspaceSessionFsHandler,
    getConfiguredSessionFsHandler,
    getConfiguredSessionIdleTimeoutSeconds,
} from '../../../../src/copilot/sdk/session/session-fs.js';
import { setSdkMetricEmitter } from '../../../../src/copilot/sdk/telemetry/operation-metrics.js';

/** @type {string[]} */
const TEMP_DIRS = [];

/** @type {import('../../../../src/copilot/sdk/types.js').SdkOperationMetric[]} */
let metrics = [];

afterEach(async () => {
    while (TEMP_DIRS.length > 0) {
        const dir = TEMP_DIRS.pop();
        if (dir) await rm(dir, { recursive: true, force: true });
    }
    delete process.env.COPILOT_SDK_SESSION_FS_ENABLED;
    delete process.env.COPILOT_SDK_SESSION_STATE_PATH;
    delete process.env.COPILOT_SDK_SESSION_FS_CONVENTIONS;
    delete process.env.COPILOT_SDK_SESSION_FS_ROOT;
    delete process.env.COPILOT_SDK_SESSION_IDLE_TIMEOUT_SECONDS;
    metrics = [];
    setSdkMetricEmitter(null);
});

async function createTempDir() {
    const dir = await mkdtemp(join(tmpdir(), 'copilot-session-fs-'));
    TEMP_DIRS.push(dir);
    return dir;
}

describe('sdk/session-fs', () => {
    beforeEach(() => {
        metrics = [];
        setSdkMetricEmitter((metric) => metrics.push(metric));
    });

    it('createLocalSessionFsProvider faz roundtrip de escrita/leitura/listagem', async () => {
        const rootDir = await createTempDir();
        const provider = createLocalSessionFsProvider(rootDir);

        await provider.writeFile('notes/a.txt', 'hello');
        await provider.appendFile('notes/a.txt', ' world');

        await expect(provider.readFile('notes/a.txt')).resolves.toBe('hello world');
        await expect(provider.exists('notes/a.txt')).resolves.toBe(true);
        await expect(provider.readdir('notes')).resolves.toEqual(['a.txt']);
        await expect(provider.readdirWithTypes('notes')).resolves.toEqual([{ name: 'a.txt', type: 'file' }]);

        const stat = await provider.stat('notes/a.txt');
        expect(stat.isFile).toBe(true);
        expect(stat.isDirectory).toBe(false);
        expect(stat.size).toBe(11);
        expect(metrics.map((metric) => `${metric.operation}:${metric.status}`)).toEqual(
            expect.arrayContaining([
                'session.fs.writeFile:started',
                'session.fs.writeFile:succeeded',
                'session.fs.appendFile:started',
                'session.fs.appendFile:succeeded',
                'session.fs.readFile:started',
                'session.fs.readFile:succeeded',
                'session.fs.exists:started',
                'session.fs.exists:succeeded',
                'session.fs.readdir:started',
                'session.fs.readdir:succeeded',
                'session.fs.readdirWithTypes:started',
                'session.fs.readdirWithTypes:succeeded',
                'session.fs.stat:started',
                'session.fs.stat:succeeded',
            ]),
        );
    });

    it('createLocalSessionFsProvider bloqueia path traversal', async () => {
        const rootDir = await createTempDir();
        const provider = createLocalSessionFsProvider(rootDir);
        await expect(provider.writeFile('../escape.txt', 'nope')).rejects.toThrow(/path traversal/i);
        expect(metrics.map((metric) => `${metric.operation}:${metric.status}`)).toEqual(
            expect.arrayContaining(['session.fs.writeFile:started', 'session.fs.writeFile:failed']),
        );
    });

    it('createWorkspaceSessionFsHandler isola por sessionId', async () => {
        const storageRootDir = await createTempDir();
        const handler = createWorkspaceSessionFsHandler({ storageRootDir });

        const providerA = handler(/** @type {any} */ ({ sessionId: 'sess-A' }));
        const providerB = handler(/** @type {any} */ ({ sessionId: 'sess-B' }));

        await providerA.writeFile('file.txt', 'A');
        await providerB.writeFile('file.txt', 'B');

        await expect(providerA.readFile('file.txt')).resolves.toBe('A');
        await expect(providerB.readFile('file.txt')).resolves.toBe('B');
        await expect(readFile(join(storageRootDir, 'sess-A', 'file.txt'), 'utf8')).resolves.toBe('A');
        await expect(readFile(join(storageRootDir, 'sess-B', 'file.txt'), 'utf8')).resolves.toBe('B');
        expect(metrics.map((metric) => `${metric.operation}:${metric.status}`)).toEqual(
            expect.arrayContaining([
                'session.fs.handler.create:started',
                'session.fs.handler.create:succeeded',
                'session.fs.writeFile:started',
                'session.fs.writeFile:succeeded',
            ]),
        );
        expect(metrics.some((metric) => metric.sessionId === 'sess-A')).toBe(true);
        expect(metrics.some((metric) => metric.sessionId === 'sess-B')).toBe(true);
    });

    it('buildConfiguredClientSessionFsConfig lê env/boot quando habilitado', () => {
        process.env.COPILOT_SDK_SESSION_FS_ENABLED = 'true';
        process.env.COPILOT_SDK_SESSION_STATE_PATH = '.copilot/custom-session-state';
        process.env.COPILOT_SDK_SESSION_FS_CONVENTIONS = 'posix';
        process.env.COPILOT_SDK_SESSION_IDLE_TIMEOUT_SECONDS = '900';

        expect(buildConfiguredClientSessionFsConfig()).toMatchObject({
            initialCwd: expect.any(String),
            sessionStatePath: '.copilot/custom-session-state',
            conventions: 'posix',
        });
        expect(getConfiguredSessionIdleTimeoutSeconds()).toBe(900);
        expect(typeof getConfiguredSessionFsHandler()).toBe('function');
    });

    it('não expõe config quando SessionFs está desabilitado', () => {
        delete process.env.COPILOT_SDK_SESSION_FS_ENABLED;
        expect(buildConfiguredClientSessionFsConfig()).toBeUndefined();
        expect(getConfiguredSessionFsHandler()).toBeUndefined();
        expect(getConfiguredSessionIdleTimeoutSeconds()).toBeUndefined();
    });
});
