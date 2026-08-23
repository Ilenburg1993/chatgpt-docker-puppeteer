// @ts-check

import { createEventBus } from '#copilot/events/runtime';
import { getWorkspacePathPolicyCacheStats } from '#copilot/infra/internal/filesystem/workspace';
import { getActiveIoSearchBudget } from '#copilot/infra/internal/policy';
import { createProcessInfra } from '#copilot/infra/public/composition/process';
import { createInfraRuntime } from '#copilot/infra/public/composition/runtime';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getSearchSubprocessProcessSnapshot } from '../../../../src/copilot/infra/indexing/search/subprocess/process/index.js';

/** @type {string[]} */
const tempRoots = [];
/** @type {Array<ReturnType<typeof createInfraRuntime>>} */
const runtimes = [];
/** @type {Array<ReturnType<typeof createProcessInfra>>} */
const processInfras = [];

async function createWorkspaceFixture() {
    const root = await mkdtemp(path.join(os.tmpdir(), 'infra-config-owner-'));
    tempRoots.push(root);
    for (let index = 0; index < 6; index += 1) {
        await writeFile(path.join(root, `file-${String(index)}.txt`), `value-${String(index)}\n`, 'utf8');
    }
    return root;
}

function installEnvA() {
    vi.stubEnv('IO_MAX_ACTIVE_SCOPES', '2');
    vi.stubEnv('IO_SCAN_BATCH_SIZE', '3');
    vi.stubEnv('IO_SCAN_HARD_MAX_ENTRIES', '2');
    vi.stubEnv('IO_INDEX_BUILD_MAX_FILES', '17');
    vi.stubEnv('IO_INDEX_REFRESH_CONCURRENCY', '3');
    vi.stubEnv('IO_EXTERNAL_WATCH_ENABLED', '0');
    vi.stubEnv('IO_PATH_POLICY_CACHE_TTL_MS', '111');
    vi.stubEnv('IO_PATH_POLICY_CACHE_MAX_ENTRIES', '222');
    vi.stubEnv('COPILOT_NODE_COMPILE_CACHE_DISABLED', '1');
    vi.stubEnv('IO_SEARCH_TIMEOUT_MS', '1234');
    vi.stubEnv('IO_SEARCH_MAX_BUFFER_BYTES', '4096');
    vi.stubEnv('COPILOT_EVENT_BUS_MAX_COUNTERS', '2');
    vi.stubEnv('PATH', '/generation-a/bin:/usr/bin');
}

function installEnvB() {
    process.env['IO_MAX_ACTIVE_SCOPES'] = '7';
    process.env['IO_SCAN_BATCH_SIZE'] = '11';
    process.env['IO_SCAN_HARD_MAX_ENTRIES'] = '20';
    process.env['IO_INDEX_BUILD_MAX_FILES'] = '41';
    process.env['IO_INDEX_REFRESH_CONCURRENCY'] = '9';
    process.env['IO_EXTERNAL_WATCH_ENABLED'] = '1';
    process.env['IO_PATH_POLICY_CACHE_TTL_MS'] = '777';
    process.env['IO_PATH_POLICY_CACHE_MAX_ENTRIES'] = '888';
    process.env['COPILOT_NODE_COMPILE_CACHE_DISABLED'] = '0';
    process.env['IO_SEARCH_TIMEOUT_MS'] = '5678';
    process.env['IO_SEARCH_MAX_BUFFER_BYTES'] = '8192';
    process.env['COPILOT_EVENT_BUS_MAX_COUNTERS'] = '4';
    process.env['PATH'] = '/generation-b/bin:/usr/bin';
}

afterEach(async () => {
    await Promise.allSettled(processInfras.splice(0).map((processInfra) => processInfra.dispose()));
    await Promise.allSettled(runtimes.splice(0).map((runtime) => runtime.dispose()));
    await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
    vi.unstubAllEnvs();
});

describe('Infra 2.1 configuration ownership', () => {
    it('keeps generation A immutable across lazy capability materialization after process.env changes', async () => {
        const root = await createWorkspaceFixture();
        installEnvA();
        const processA = createProcessInfra({ processId: 'config-owner-process-a' });
        processInfras.push(processA);
        const runtimeDefaultsA = processA.config.runtimeDefaults;
        expect(processA.config.eventBus).toEqual({ maxCounters: 2 });
        expect('network' in processA.config).toBe(false);
        expect(processA.config.pathPolicyCache).toEqual({ ttlMs: 111, maxEntries: 222 });
        expect(processA.config.compileCache.disabled).toBe(true);
        expect(processA.config.search.budget).toEqual({ timeoutMs: 1234, maxBufferBytes: 4096 });
        expect(processA.config.search.subprocess.environment['PATH']).toBe('/generation-a/bin:/usr/bin');

        // Change the live process environment before the runtime/workspace capabilities even exist.
        installEnvB();

        const runtimeA = processA.createRuntime({ runtimeId: 'config-owner-a' });
        expect(runtimeA.config).toBe(runtimeDefaultsA);
        expect(runtimeA.config.index).toMatchObject({
            scanner: { batchSize: 3, hardMaxEntries: 2 },
            build: { concurrency: 8, maxFiles: 17 },
            refresh: { concurrency: 3 },
        });
        expect(runtimeA.config.workspace).toMatchObject({
            externalWatch: { enabled: false },
            indexingContext: { maxActiveScopes: 2 },
        });

        const workspaceA = runtimeA.workspace(root);
        expect(workspaceA.lifecycleSnapshot().config).toMatchObject({
            externalWatch: { enabled: false },
            indexingContext: { maxActiveScopes: 2 },
        });
        expect(workspaceA.indexing.context.maxActiveScopes).toBe(2);
        expect(runtimeA.indexRegistry.status().config).toMatchObject({
            scanner: { batchSize: 3, hardMaxEntries: 2 },
            build: { maxFiles: 17 },
            refresh: { concurrency: 3 },
        });

        const scanA = await workspaceA.indexing.scanDirectory(root, {
            recursive: false,
            // A caller may ask for a wider window, but the workspace-owned hard cap remains generation A's value.
            maxEntries: 99,
            hardMaxEntries: 999,
            batchSize: 99,
        });
        expect(scanA.scannedEntries).toBe(2);
        expect(scanA.io.advisoryLimits).toMatchObject({
            hardLimitReached: true,
            hardMaxEntries: 2,
            batchSize: 99,
        });
        const scopeA = workspaceA.indexing.context.declareScope({
            sessionId: 'config-owner-scope-a',
            directory: root,
            extensions: ['.txt'],
            maxFiles: 99,
            parseSymbols: false,
            indexMode: 'off',
        });
        const scopeAStats = await scopeA.awaitReady();
        expect(scopeAStats.candidateFiles).toBe(2);
        expect(scopeAStats.selectedFiles).toBe(2);
        scopeA.close();

        // A newly-created process generation explicitly snapshots the current B environment and therefore sees B.
        const processB = createProcessInfra({ processId: 'config-owner-process-b' });
        processInfras.push(processB);
        expect(processB.config.eventBus).toEqual({ maxCounters: 4 });
        expect(processB.config.pathPolicyCache).toEqual({ ttlMs: 777, maxEntries: 888 });
        expect(processB.config.compileCache.disabled).toBe(false);
        expect(processB.config.search.budget).toEqual({ timeoutMs: 5678, maxBufferBytes: 8192 });
        expect(processB.config.search.subprocess.environment['PATH']).toBe('/generation-b/bin:/usr/bin');
        const runtimeB = processB.createRuntime({ runtimeId: 'config-owner-b' });
        expect(runtimeB.config).toBe(processB.config.runtimeDefaults);
        const workspaceB = runtimeB.workspace(root);
        expect(runtimeB.config.index).toMatchObject({
            scanner: { batchSize: 11, hardMaxEntries: 20 },
            build: { maxFiles: 41 },
            refresh: { concurrency: 9 },
        });
        expect(workspaceB.indexing.context.maxActiveScopes).toBe(7);
        expect(workspaceB.lifecycleSnapshot().config).toMatchObject({
            externalWatch: { enabled: true },
            indexingContext: { maxActiveScopes: 7 },
        });

        const scanB = await workspaceB.indexing.scanDirectory(root, { recursive: false, maxEntries: 99 });
        expect(scanB.scannedEntries).toBe(6);
        expect(scanB.io.advisoryLimits).toMatchObject({ hardMaxEntries: 20, batchSize: 11 });
        const scopeB = workspaceB.indexing.context.declareScope({
            sessionId: 'config-owner-scope-b',
            directory: root,
            extensions: ['.txt'],
            maxFiles: 99,
            parseSymbols: false,
            indexMode: 'off',
        });
        const scopeBStats = await scopeB.awaitReady();
        expect(scopeBStats.candidateFiles).toBe(6);
        expect(scopeBStats.selectedFiles).toBe(6);
        scopeB.close();
    });

    it('binds process policies explicitly to one owner without mutable Core globals', async () => {
        const processA = createProcessInfra({
            processId: 'path-policy-owner-a',
            env: {
                IO_PATH_POLICY_CACHE_TTL_MS: '123',
                IO_PATH_POLICY_CACHE_MAX_ENTRIES: '321',
                IO_SEARCH_TIMEOUT_MS: '4321',
                IO_SEARCH_MAX_BUFFER_BYTES: '16384',
                COPILOT_EVENT_BUS_MAX_COUNTERS: '2',
                PATH: '/owned-search/bin:/usr/bin',
            },
            activateProcessPolicies: true,
        });
        processInfras.push(processA);
        expect(processA.config.eventBus).toEqual({ maxCounters: 2 });
        expect('network' in processA.config).toBe(false);
        const eventBusA = createEventBus({ maxCounters: processA.config.eventBus.maxCounters });
        eventBusA.emit({ type: 'owner:a' });
        eventBusA.emit({ type: 'owner:b' });
        eventBusA.emit({ type: 'owner:c' });
        expect(Object.keys(eventBusA.stats())).toEqual(['owner:b', 'owner:c']);

        expect(getWorkspacePathPolicyCacheStats()).toMatchObject({
            ttlMs: 123,
            maxEntries: 321,
            ownerProcessId: 'path-policy-owner-a',
        });
        expect(getActiveIoSearchBudget()).toEqual({ timeoutMs: 4321, maxBufferBytes: 16384 });
        expect(getSearchSubprocessProcessSnapshot()).toMatchObject({
            active: true,
            processId: 'path-policy-owner-a',
            path: '/owned-search/bin:/usr/bin',
        });

        process.env['IO_PATH_POLICY_CACHE_TTL_MS'] = '999';
        process.env['IO_PATH_POLICY_CACHE_MAX_ENTRIES'] = '9999';
        process.env['IO_SEARCH_TIMEOUT_MS'] = '9999';
        process.env['IO_SEARCH_MAX_BUFFER_BYTES'] = '999999';
        process.env['COPILOT_EVENT_BUS_MAX_COUNTERS'] = '99';
        process.env['PATH'] = '/mutated-live/bin';
        expect(processA.config.eventBus).toEqual({ maxCounters: 2 });
        expect(getWorkspacePathPolicyCacheStats()).toMatchObject({ ttlMs: 123, maxEntries: 321 });
        expect(getActiveIoSearchBudget()).toEqual({ timeoutMs: 4321, maxBufferBytes: 16384 });
        expect(getSearchSubprocessProcessSnapshot().path).toBe('/owned-search/bin:/usr/bin');

        await processA.dispose();
        processInfras.splice(processInfras.indexOf(processA), 1);
        expect(processA.lifecycleSnapshot().state).toBe('disposed');
        eventBusA.emit({ type: 'owner:d' });
        expect(Object.keys(eventBusA.stats())).toEqual(['owner:c', 'owner:d']);
        eventBusA.dispose();

        expect(getWorkspacePathPolicyCacheStats()).toMatchObject({
            ttlMs: 250,
            maxEntries: 2048,
            ownerProcessId: null,
        });
        expect(getActiveIoSearchBudget()).toEqual({
            timeoutMs: 15_000,
            maxBufferBytes: 16 * 1024 * 1024,
        });
        expect(getSearchSubprocessProcessSnapshot()).toMatchObject({
            active: false,
            processId: 'standalone-default',
            path: null,
        });
    });

    it('binds one ParserProcessConfig by reference to ProcessInfra and every runtime child', async () => {
        vi.stubEnv('IO_PARSER_MAX_BYTES', '4096');
        vi.stubEnv('IO_PARSER_MAX_DURATION_MS', '25');
        vi.stubEnv('IO_PARSER_MAX_LINES', '11');
        vi.stubEnv('IO_PARSER_WORKER_ENABLED', '1');
        vi.stubEnv('IO_PARSER_WORKER_POOL_SIZE', '1');
        vi.stubEnv('IO_PARSER_WORKER_QUEUE_MAX', '2');
        vi.stubEnv('IO_PARSER_WORKER_REQUEST_TIMEOUT_MS', '75');
        vi.stubEnv('IO_PARSER_MAIN_THREAD_FALLBACK_MAX_BYTES', '512');

        const processA = createProcessInfra({ processId: 'parser-config-process-a' });
        processInfras.push(processA);
        const parserA = processA.config.parser;
        expect(parserA).toMatchObject({
            maxParseBytes: 4096,
            maxParseDurationMs: 25,
            maxParseLines: 11,
            workerEnabled: true,
            workerPoolPolicy: { size: 1, source: 'configured' },
            workerQueuePolicy: { max: 2, source: 'configured' },
            workerRequestTimeoutMs: 75,
            mainThreadFallbackMaxBytes: 512,
        });

        // Mutation after ProcessInfra creation cannot change children created later by that process generation.
        process.env['IO_PARSER_MAX_BYTES'] = '8192';
        process.env['IO_PARSER_MAX_DURATION_MS'] = '40';
        process.env['IO_PARSER_MAX_LINES'] = '33';
        process.env['IO_PARSER_WORKER_ENABLED'] = '0';
        process.env['IO_PARSER_WORKER_POOL_SIZE'] = '3';
        process.env['IO_PARSER_WORKER_QUEUE_MAX'] = '9';
        process.env['IO_PARSER_WORKER_REQUEST_TIMEOUT_MS'] = '125';
        process.env['IO_PARSER_MAIN_THREAD_FALLBACK_MAX_BYTES'] = '1024';

        const runtimeA = processA.createRuntime({ runtimeId: 'parser-config-runtime-a' });
        expect(runtimeA.processConfig.parser).toBe(parserA);
        expect(runtimeA.parserWorkers.config).toBe(parserA);
        expect(runtimeA.parserCache.parserConfig).toBe(parserA);
        expect(runtimeA.parserWorkers.status().config).toBe(parserA);
        expect(runtimeA.lifecycleSnapshot().processConfig.parser).toBe(parserA);

        const processB = createProcessInfra({ processId: 'parser-config-process-b' });
        processInfras.push(processB);
        const parserB = processB.config.parser;
        expect(parserB).not.toBe(parserA);
        expect(parserB).toMatchObject({
            maxParseBytes: 8192,
            maxParseDurationMs: 40,
            maxParseLines: 33,
            workerEnabled: false,
            workerPoolPolicy: { size: 3, source: 'configured' },
            workerQueuePolicy: { max: 9, source: 'configured' },
            workerRequestTimeoutMs: 125,
            mainThreadFallbackMaxBytes: 1024,
        });
        const runtimeB = processB.createRuntime({ runtimeId: 'parser-config-runtime-b' });
        expect(runtimeB.processConfig.parser).toBe(parserB);
        expect(runtimeB.parserWorkers.config).toBe(parserB);
        expect(runtimeB.parserCache.parserConfig).toBe(parserB);
    });
});
