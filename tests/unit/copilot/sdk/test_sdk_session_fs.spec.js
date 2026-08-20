// @ts-check

import { createSessionFsAdapter } from '@github/copilot-sdk';
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
    buildConfiguredClientSessionFsConfig,
    createLocalSessionFsProvider,
    createWorkspaceSessionFsHandler,
    describeConfiguredSessionFs,
    getConfiguredSessionFsHandler,
    getConfiguredSessionIdleTimeoutSeconds,
    readConfiguredSessionFsState,
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
    delete process.env['COPILOT_SDK_SESSION_FS_ENABLED'];
    delete process.env['COPILOT_SDK_SESSION_STATE_PATH'];
    delete process.env['COPILOT_SDK_SESSION_FS_CONVENTIONS'];
    delete process.env['COPILOT_SDK_SESSION_FS_ROOT'];
    delete process.env['COPILOT_SDK_SESSION_IDLE_TIMEOUT_SECONDS'];
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

    it('createLocalSessionFsProvider cria diretórios pela engine canônica e mantém compatibilidade com o adapter do SDK', async () => {
        const rootDir = await createTempDir();
        const provider = createLocalSessionFsProvider(rootDir);
        const adapter = createSessionFsAdapter(provider);

        await expect(
            adapter.mkdir({ sessionId: 'test-session', path: 'nested/deep', recursive: true }),
        ).resolves.toBeUndefined();
        await expect(provider.writeFile('nested/deep/file.txt', 'ok')).resolves.toBeUndefined();

        await expect(provider.stat('nested/deep')).resolves.toMatchObject({
            isFile: false,
            isDirectory: true,
        });
        await expect(readFile(join(rootDir, 'nested/deep/file.txt'), 'utf8')).resolves.toBe('ok');
        expect(metrics.map((metric) => `${metric.operation}:${metric.status}`)).toEqual(
            expect.arrayContaining([
                'session.fs.mkdir:started',
                'session.fs.mkdir:succeeded',
                'session.fs.writeFile:started',
                'session.fs.writeFile:succeeded',
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

    it('createLocalSessionFsProvider bloqueia symlink que escapa do root isolado', async () => {
        const rootDir = await createTempDir();
        const outsideDir = await createTempDir();
        const outsideFile = join(outsideDir, 'outside.txt');
        await writeFile(outsideFile, 'outside', 'utf8');
        await symlink(outsideFile, join(rootDir, 'link.txt'));
        const provider = createLocalSessionFsProvider(rootDir);

        await expect(provider.readFile('link.txt')).rejects.toThrow(/symlink/i);
        expect(metrics.map((metric) => `${metric.operation}:${metric.status}`)).toEqual(
            expect.arrayContaining(['session.fs.readFile:started', 'session.fs.readFile:failed']),
        );
    });

    it('provider.exists propaga erro de policy enquanto o adapter do SDK preserva contrato exists=false', async () => {
        const rootDir = await createTempDir();
        const outsideDir = await createTempDir();
        const outsideFile = join(outsideDir, 'outside.txt');
        await writeFile(outsideFile, 'outside', 'utf8');
        await symlink(outsideFile, join(rootDir, 'link.txt'));
        const provider = createLocalSessionFsProvider(rootDir);
        const adapter = createSessionFsAdapter(provider);

        await expect(provider.exists('link.txt')).rejects.toThrow(/symlink/i);
        await expect(adapter.exists({ sessionId: 'test-session', path: 'link.txt' })).resolves.toEqual({
            exists: false,
        });
        expect(metrics.map((metric) => `${metric.operation}:${metric.status}`)).toEqual(
            expect.arrayContaining([
                'session.fs.exists:started',
                'session.fs.exists:failed',
                'session.fs.exists:started',
                'session.fs.exists:failed',
            ]),
        );
    });

    it('readdirWithTypes não converte symlink em arquivo no contrato do SDK', async () => {
        const rootDir = await createTempDir();
        const provider = createLocalSessionFsProvider(rootDir);
        await provider.writeFile('notes/a.txt', 'hello');
        await symlink(join(rootDir, 'notes/a.txt'), join(rootDir, 'notes/link.txt'));

        await expect(provider.readdir('notes')).resolves.toEqual(['a.txt', 'link.txt']);
        await expect(provider.readdirWithTypes('notes')).resolves.toEqual([{ name: 'a.txt', type: 'file' }]);
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
        process.env['COPILOT_SDK_SESSION_FS_ENABLED'] = 'true';
        process.env['COPILOT_SDK_SESSION_STATE_PATH'] = '.copilot/custom-session-state';
        process.env['COPILOT_SDK_SESSION_FS_CONVENTIONS'] = 'posix';
        process.env['COPILOT_SDK_SESSION_IDLE_TIMEOUT_SECONDS'] = '900';

        expect(buildConfiguredClientSessionFsConfig()).toMatchObject({
            initialCwd: expect.any(String),
            sessionStatePath: '.copilot/custom-session-state',
            conventions: 'posix',
        });
        expect(getConfiguredSessionIdleTimeoutSeconds()).toBe(900);
        expect(typeof getConfiguredSessionFsHandler()).toBe('function');
    });

    it('describeConfiguredSessionFs e readConfiguredSessionFsState expõem paths seguros e estado por sessão', async () => {
        const storageRootDir = await createTempDir();
        process.env['COPILOT_SDK_SESSION_FS_ENABLED'] = 'true';
        process.env['COPILOT_SDK_SESSION_FS_ROOT'] = storageRootDir;

        const descriptor = describeConfiguredSessionFs('sess-A');
        expect(descriptor.enabled).toBe(true);
        expect(descriptor.storageRoot.display).toBe(`external:${storageRootDir.split('/').pop()}`);
        expect(descriptor.storageRoot.withinWorkspace).toBe(false);
        expect(descriptor.session?.key).toBe('sess-A');
        expect(descriptor.session?.display).toBe('external:sess-A');

        const stateBefore = await readConfiguredSessionFsState('sess-A');
        expect(stateBefore.storageRoot.exists).toBe(true);
        expect(stateBefore.session?.exists).toBe(false);

        const handler = createWorkspaceSessionFsHandler({ storageRootDir });
        const provider = handler(/** @type {any} */ ({ sessionId: 'sess-A' }));
        await provider.writeFile('state.txt', 'ok');

        const stateAfter = await readConfiguredSessionFsState('sess-A');
        expect(stateAfter.session?.exists).toBe(true);
    });

    it('não expõe config quando SessionFs está desabilitado', () => {
        delete process.env['COPILOT_SDK_SESSION_FS_ENABLED'];
        expect(buildConfiguredClientSessionFsConfig()).toBeUndefined();
        expect(getConfiguredSessionFsHandler()).toBeUndefined();
        expect(getConfiguredSessionIdleTimeoutSeconds()).toBeUndefined();
    });
});
