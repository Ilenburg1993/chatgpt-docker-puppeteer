// @ts-check

import { createInfraOperationContext } from '#copilot/infra/public/composition/operation';
import { createProcessInfra } from '#copilot/infra/public/composition/process';
import { createInfraRuntime } from '#copilot/infra/public/composition/runtime';
import { createWorkspaceInfra } from '#copilot/infra/public/composition/workspace/instance';
import { markMutationAppliedError } from '#copilot/infra/public/policy';
import Database from 'better-sqlite3';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ensureIoIndexSchema } from '../../../../src/copilot/db/io-index-schema.js';

/** @type {{ dispose:() => Promise<void> }[]} */
const disposables = [];
/** @type {string[]} */
const tempDirs = [];

afterEach(async () => {
    for (const value of disposables.splice(0).reverse()) await value.dispose().catch(() => {});
    for (const directory of tempDirs.splice(0).reverse()) await rm(directory, { recursive: true, force: true });
});

/** @param {() => boolean} predicate */
async function waitUntil(predicate) {
    const deadline = Date.now() + 3_000;
    while (Date.now() < deadline) {
        if (predicate()) return;
        await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error('timeout waiting for composition condition');
}

describe('infra 2.0 composition scopes', () => {
    it('WorkspaceInfra binds one authority and memoizes capability facets lazily', async () => {
        const workspace = createWorkspaceInfra({ workspaceRoot: process.cwd(), workspaceId: 'unit-workspace' });
        disposables.push(workspace);

        expect(workspace.workspaceRoot).toBe(process.cwd());
        expect(workspace.lifecycleSnapshot()).toMatchObject({ state: 'active', registered: [] });
        expect(workspace.readIo).toBe(workspace.readIo);
        expect(workspace.mutationIo).toBe(workspace.mutationIo);
        expect(workspace.io).toBe(workspace.io);
        expect(workspace.indexing).toBe(workspace.indexing);

        const token = await workspace.authority.authorizeRead('package.json');
        await expect(workspace.readIo.readTextValidated(token)).resolves.toMatchObject({ content: expect.any(String) });
    });

    it('InfraRuntime captures one deeply immutable config snapshot from the supplied environment', () => {
        const env = {
            NODE_ENV: 'test',
            IO_L1_CACHE_MAX_ENTRIES: '17',
            IO_L2_CACHE_PROFILE: 'off',
            IO_CAPACITY_PREFLIGHT_MIN_BYTES: '4096',
            IO_CAPACITY_PREFLIGHT_RESERVE_BYTES: '512',
            IO_CAPACITY_PREFLIGHT_CACHE_TTL_MS: '250',
            COPILOT_IO_ROLLBACK_ENABLED: 'true',
            COPILOT_IO_ROLLBACK_DIR: '/tmp/infra-runtime-rollback-a',
            COPILOT_IO_ROLLBACK_TTL_MS: '12345',
            COPILOT_IO_MUTATION_AUDIT_LOG_PATH: '/tmp/infra-runtime-audit-a.jsonl',
        };
        const first = createInfraRuntime({ runtimeId: 'config-runtime-a', env });
        disposables.push(first);

        expect(first.config).toMatchObject({
            l1: { maxEntries: 17 },
            capacityPreflight: { enabled: true, minBytes: 4096, reserveBytes: 512, cacheTtlMs: 250 },
            rollback: {
                enabled: true,
                directory: '/tmp/infra-runtime-rollback-a',
                ttlMs: 12345,
            },
            mutationAudit: { filePath: '/tmp/infra-runtime-audit-a.jsonl' },
        });
        expect(Object.isFrozen(first.config)).toBe(true);
        expect(Object.isFrozen(first.config.l1)).toBe(true);
        expect(Object.isFrozen(first.config.rollback)).toBe(true);
        expect(Object.isFrozen(first.config.capacityPreflight)).toBe(true);

        env.IO_L1_CACHE_MAX_ENTRIES = '99';
        env.COPILOT_IO_ROLLBACK_ENABLED = 'false';
        env.COPILOT_IO_ROLLBACK_DIR = '/tmp/infra-runtime-rollback-b';
        expect(first.config.l1.maxEntries).toBe(17);
        expect(first.config.rollback).toMatchObject({
            enabled: true,
            directory: '/tmp/infra-runtime-rollback-a',
        });

        const second = createInfraRuntime({ runtimeId: 'config-runtime-b', env });
        disposables.push(second);
        expect(second.config.l1.maxEntries).toBe(99);
        expect(second.config.rollback).toMatchObject({
            enabled: false,
            directory: '/tmp/infra-runtime-rollback-b',
        });
    });

    it('InfraRuntime memoizes by canonical root but isolates equal roots across runtimes', () => {
        const first = createInfraRuntime({ runtimeId: 'runtime-a' });
        const second = createInfraRuntime({ runtimeId: 'runtime-b' });
        disposables.push(first, second);

        const a1 = first.workspace(process.cwd());
        const a2 = first.workspace(`${process.cwd()}/.`);
        const b = second.workspace(process.cwd());
        expect(a1).toBe(a2);
        expect(a1).not.toBe(b);
        expect(a1.authority).not.toBe(b.authority);
        expect(first.lifecycleSnapshot()).toMatchObject({ state: 'active', workspaces: 1 });
    });

    it('isolates L1 cache and invalidation hooks across runtimes sharing one workspace root', async () => {
        const root = await mkdtemp(join(tmpdir(), 'infra-coherence-runtime-'));
        tempDirs.push(root);
        const filePath = join(root, 'coherence.txt');
        await writeFile(filePath, 'one', 'utf8');

        const first = createInfraRuntime({ runtimeId: 'coherence-runtime-a' });
        const second = createInfraRuntime({ runtimeId: 'coherence-runtime-b' });
        disposables.push(first, second);
        const firstWorkspace = first.workspace(root);
        const secondWorkspace = second.workspace(root);
        let firstInvalidations = 0;
        let secondInvalidations = 0;
        const unregisterFirst = first.coherence.invalidation.registerHook(() => {
            firstInvalidations += 1;
        });
        const unregisterSecond = second.coherence.invalidation.registerHook(() => {
            secondInvalidations += 1;
        });

        try {
            await Promise.all([firstWorkspace.readIo.readText(filePath), secondWorkspace.readIo.readText(filePath)]);
            expect(first.coherence.l1.stats()?.size).toBe(1);
            expect(second.coherence.l1.stats()?.size).toBe(1);

            await firstWorkspace.mutationIo.writeFileAtomic(filePath, 'two');

            expect(first.coherence.l1.stats()?.size).toBe(0);
            expect(second.coherence.l1.stats()?.size).toBe(1);
            expect(firstInvalidations).toBe(1);
            expect(secondInvalidations).toBe(0);
            await expect(firstWorkspace.readIo.readText(filePath)).resolves.toMatchObject({ content: 'two' });
        } finally {
            unregisterFirst();
            unregisterSecond();
        }
    });

    it('isolates derived read caches and hash counters across runtimes', async () => {
        const root = await mkdtemp(join(tmpdir(), 'infra-read-runtime-'));
        tempDirs.push(root);
        const filePath = join(root, 'derived-read.txt');
        const originalLines = Array.from({ length: 300 }, (_, index) => `line-${index + 1}`);
        await writeFile(filePath, originalLines.join('\n'), 'utf8');

        const first = createInfraRuntime({ runtimeId: 'derived-read-a' });
        const second = createInfraRuntime({ runtimeId: 'derived-read-b' });
        disposables.push(first, second);
        const firstWorkspace = first.workspace(root);
        const secondWorkspace = second.workspace(root);

        await Promise.all([
            firstWorkspace.readIo.readText(filePath, { startLine: 2, endLine: 4 }),
            secondWorkspace.readIo.readText(filePath, { startLine: 2, endLine: 4 }),
        ]);
        expect(first.coherence.read.hashes.stats().reads).toBe(1);
        expect(second.coherence.read.hashes.stats().reads).toBe(1);
        expect(first.coherence.read.lineOffsets.stats().size).toBe(1);
        expect(second.coherence.read.lineOffsets.stats().size).toBe(1);

        await Promise.all([
            firstWorkspace.readIo.readTextChunks(filePath, { startLine: 20, endLine: 30, chunkLines: 11 }),
            secondWorkspace.readIo.readTextChunks(filePath, { startLine: 20, endLine: 30, chunkLines: 11 }),
        ]);
        expect(first.coherence.read.byteLineIndex.stats().size).toBe(1);
        expect(second.coherence.read.byteLineIndex.stats().size).toBe(1);

        await firstWorkspace.mutationIo.writeFileAtomic(
            filePath,
            originalLines.map((line) => `new-${line}`).join('\n'),
        );

        expect(first.coherence.read.lineOffsets.stats()).toMatchObject({ size: 0, busInvalidations: 1, clears: 1 });
        expect(first.coherence.read.byteLineIndex.stats()).toMatchObject({ size: 0, busInvalidations: 1, clears: 1 });
        expect(second.coherence.read.lineOffsets.stats()).toMatchObject({ size: 1, busInvalidations: 0, clears: 0 });
        expect(second.coherence.read.byteLineIndex.stats()).toMatchObject({ size: 1, busInvalidations: 0, clears: 0 });

        await firstWorkspace.readIo.readText(filePath, { startLine: 2, endLine: 4 });
        expect(first.coherence.read.hashes.stats().reads).toBe(2);
        expect(second.coherence.read.hashes.stats().reads).toBe(1);
    });

    it('isolates operation telemetry and advisory pressure across runtimes sharing one workspace root', async () => {
        const root = await mkdtemp(join(tmpdir(), 'infra-telemetry-runtime-'));
        tempDirs.push(root);
        const filePath = join(root, 'telemetry.txt');
        await writeFile(filePath, 'one', 'utf8');

        const first = createInfraRuntime({ runtimeId: 'telemetry-runtime-a' });
        const second = createInfraRuntime({ runtimeId: 'telemetry-runtime-b' });
        disposables.push(first, second);
        const firstWorkspace = first.workspace(root);
        const secondWorkspace = second.workspace(root);

        await Promise.all([firstWorkspace.readIo.readText(filePath), secondWorkspace.readIo.readText(filePath)]);

        expect(first.telemetry.snapshot()).toMatchObject({
            runtimeId: 'telemetry-runtime-a:telemetry',
            advisoryBudget: { operations: 0, active: 0 },
            durability: { operationsObserved: 1 },
            latency: { read: { count: 1 } },
            mutationState: { appliedButUnconfirmed: 0 },
        });
        expect(second.telemetry.snapshot()).toMatchObject({
            runtimeId: 'telemetry-runtime-b:telemetry',
            advisoryBudget: { operations: 0, active: 0 },
            durability: { operationsObserved: 1 },
            latency: { read: { count: 1 } },
            mutationState: { appliedButUnconfirmed: 0 },
        });

        await firstWorkspace.mutationIo.writeFileAtomic(filePath, 'two');

        const firstAfterWrite = first.telemetry.snapshot();
        const secondAfterWrite = second.telemetry.snapshot();
        expect(firstAfterWrite.advisoryBudget).toMatchObject({ operations: 1, active: 0 });
        expect(firstAfterWrite.durability.operationsObserved).toBe(2);
        expect(firstAfterWrite.durability.operationsWithMetadata).toBe(1);
        expect(firstAfterWrite.latency.write?.count).toBe(1);
        expect(secondAfterWrite).toMatchObject({
            advisoryBudget: { operations: 0, active: 0 },
            durability: { operationsObserved: 1, operationsWithMetadata: 0 },
            latency: { read: { count: 1 } },
        });
        expect(secondAfterWrite.latency).not.toHaveProperty('write');

        const appliedError = markMutationAppliedError(new Error('post-publish telemetry probe'), {
            phase: 'post-publish',
            paths: [filePath],
        });
        first.telemetry.recordOperation(
            /** @type {import('../../../../src/copilot/core/io-contracts.js').IoMeta} */ ({
                operation: 'write',
                target: filePath,
                targetKind: 'file',
                cache: 'none',
                riskClass: 'high',
                policyVersion: 'test',
                durationMs: 1,
            }),
            { success: false, error: appliedError },
        );
        expect(first.telemetry.mutationState.stats()).toMatchObject({
            appliedButUnconfirmed: 1,
            byOperation: { write: 1 },
            last: { operation: 'write', phase: 'post-publish', pathCount: 1 },
        });
        expect(second.telemetry.mutationState.stats()).toMatchObject({ appliedButUnconfirmed: 0, byOperation: {} });
    });

    it('isolates parser symbol and file-context caches across runtimes', async () => {
        const root = await mkdtemp(join(tmpdir(), 'infra-parser-runtime-'));
        tempDirs.push(root);
        const filePath = join(root, 'parser-runtime.js');
        const originalContent = 'export const parserRuntimeSymbol = 1;\n';
        await writeFile(filePath, originalContent, 'utf8');

        const first = createInfraRuntime({ runtimeId: 'parser-runtime-a' });
        const second = createInfraRuntime({ runtimeId: 'parser-runtime-b' });
        disposables.push(first, second);
        const firstWorkspace = first.workspace(root);
        const secondWorkspace = second.workspace(root);

        await Promise.all([
            firstWorkspace.indexing.parseFileForContext(filePath, originalContent),
            secondWorkspace.indexing.parseFileForContext(filePath, originalContent),
        ]);
        expect(first.parserCache.snapshot().fileContext).toMatchObject({ size: 1, misses: 1, hits: 0 });
        expect(second.parserCache.snapshot().fileContext).toMatchObject({ size: 1, misses: 1, hits: 0 });

        await firstWorkspace.indexing.parseFileForContext(filePath, originalContent);
        expect(first.parserCache.snapshot().fileContext.hits).toBe(1);
        expect(second.parserCache.snapshot().fileContext.hits).toBe(0);

        await Promise.all([
            firstWorkspace.indexing.warmReadThroughContext(filePath, {
                workspaceRoot: root,
                index: false,
                relatedImports: true,
                cacheBytes: false,
            }),
            secondWorkspace.indexing.warmReadThroughContext(filePath, {
                workspaceRoot: root,
                index: false,
                relatedImports: true,
                cacheBytes: false,
            }),
        ]);
        expect(first.parserCache.snapshot().symbol.size).toBe(1);
        expect(second.parserCache.snapshot().symbol.size).toBe(1);

        await firstWorkspace.mutationIo.writeFileAtomic(filePath, 'export const parserRuntimeSymbol = 2;\n');

        expect(first.parserCache.snapshot()).toMatchObject({
            symbol: { size: 0 },
            fileContext: { size: 0, clears: 1 },
        });
        expect(second.parserCache.snapshot()).toMatchObject({
            symbol: { size: 1 },
            fileContext: { size: 1, clears: 0 },
        });
    });

    it('InfraRuntime isolates SQLite index stores, queries and clear lifecycle across concurrent runtimes', async () => {
        const rootA = await mkdtemp(join(tmpdir(), 'infra-index-runtime-a-'));
        const rootB = await mkdtemp(join(tmpdir(), 'infra-index-runtime-b-'));
        tempDirs.push(rootA, rootB);
        const fileA = join(rootA, 'runtime-a.js');
        const fileB = join(rootB, 'runtime-b.js');
        await Promise.all([
            writeFile(fileA, 'export const isolatedRuntimeSymbol = "runtime-a";\n', 'utf8'),
            writeFile(fileB, 'export const isolatedRuntimeSymbol = "runtime-b";\n', 'utf8'),
        ]);
        const dbA = new Database(':memory:');
        const dbB = new Database(':memory:');
        ensureIoIndexSchema(dbA);
        ensureIoIndexSchema(dbB);
        const first = createInfraRuntime({ runtimeId: 'index-runtime-a', sqliteProvider: () => dbA });
        const second = createInfraRuntime({ runtimeId: 'index-runtime-b', sqliteProvider: () => dbB });
        disposables.push(first, second);
        try {
            const [indexedA, indexedB] = await Promise.all([
                first.indexRegistry.refreshPaths([fileA], { workspaceRoot: rootA }),
                second.indexRegistry.refreshPaths([fileB], { workspaceRoot: rootB }),
            ]);
            expect(indexedA).toMatchObject({ indexed: 1, failed: 0 });
            expect(indexedB).toMatchObject({ indexed: 1, failed: 0 });

            const rowsA = first.indexRegistry.findSymbol('isolatedRuntimeSymbol', { exactMatch: true });
            const rowsB = second.indexRegistry.findSymbol('isolatedRuntimeSymbol', { exactMatch: true });
            expect(rowsA).toHaveLength(1);
            expect(rowsB).toHaveLength(1);
            expect(rowsA[0]?.filePath).toBe(fileA);
            expect(rowsB[0]?.filePath).toBe(fileB);
            expect(first.indexRegistry.snapshot()).toMatchObject({ database: { configured: true }, queries: 1 });
            expect(second.indexRegistry.snapshot()).toMatchObject({ database: { configured: true }, queries: 1 });

            expect(first.indexRegistry.clear()).toBe(true);
            expect(first.indexRegistry.findSymbol('isolatedRuntimeSymbol', { exactMatch: true })).toEqual([]);
            expect(second.indexRegistry.findSymbol('isolatedRuntimeSymbol', { exactMatch: true })).toHaveLength(1);
        } finally {
            dbA.close();
            dbB.close();
        }
    });

    it('teardown is reverse-ordered, idempotent and closes child scopes', async () => {
        const processInfra = createProcessInfra({ processId: 'unit-process' });
        disposables.push(processInfra);
        const runtime = processInfra.createRuntime({ runtimeId: 'unit-runtime' });
        const workspace = runtime.workspace(process.cwd());
        /** @type {string[]} */
        const order = [];
        processInfra.registerDisposable('process-hook', () => order.push('process'));
        runtime.registerDisposable('runtime-hook', () => order.push('runtime'));
        workspace.registerDisposable('workspace-first', () => order.push('workspace-first'));
        workspace.registerDisposable('workspace-last', () => order.push('workspace-last'));

        const firstDispose = processInfra.dispose();
        const secondDispose = processInfra.dispose();
        expect(firstDispose).toBe(secondDispose);
        await firstDispose;

        expect(order).toEqual(['workspace-last', 'workspace-first', 'runtime', 'process']);
        expect(processInfra.lifecycleSnapshot().state).toBe('disposed');
        expect(runtime.lifecycleSnapshot().state).toBe('disposed');
        expect(workspace.lifecycleSnapshot().state).toBe('disposed');
        expect(() => runtime.workspace(process.cwd())).toThrow(/disposed/u);
    });

    it('workspace scope runtimes isolate equal session IDs and dispose independently', async () => {
        const root = await mkdtemp(join(tmpdir(), 'infra-scope-runtime-'));
        tempDirs.push(root);
        const filePath = join(root, 'scope.js');
        await writeFile(filePath, 'export const isolated = true;\n', 'utf8');
        const firstRuntime = createInfraRuntime({ runtimeId: 'scope-runtime-a' });
        const secondRuntime = createInfraRuntime({ runtimeId: 'scope-runtime-b' });
        disposables.push(firstRuntime, secondRuntime);
        const first = firstRuntime.workspace(root);
        const second = secondRuntime.workspace(root);
        const firstContext = first.indexing.context;
        const secondContext = second.indexing.context;

        await Promise.all([
            firstContext
                .declareScope({ sessionId: 'same-id', paths: [filePath], parseSymbols: false, indexMode: 'off' })
                .awaitReady(),
            secondContext
                .declareScope({ sessionId: 'same-id', paths: [filePath], parseSymbols: false, indexMode: 'off' })
                .awaitReady(),
        ]);
        expect(firstContext.getScopeStats('same-id')).not.toBeNull();
        expect(secondContext.getScopeStats('same-id')).not.toBeNull();

        firstContext.closeScope('same-id');
        expect(firstContext.getScopeStats('same-id')).toBeNull();
        expect(secondContext.getScopeStats('same-id')).not.toBeNull();
        await first.dispose();
        expect(firstContext.state).toBe('disposed');
        expect(secondContext.getScopeStats('same-id')).not.toBeNull();
    });

    it('external watchers coexist across workspaces and child teardown does not stop siblings', async () => {
        const rootA = await mkdtemp(join(tmpdir(), 'infra-watch-a-'));
        const rootB = await mkdtemp(join(tmpdir(), 'infra-watch-b-'));
        tempDirs.push(rootA, rootB);
        const firstRuntime = createInfraRuntime({ runtimeId: 'watch-runtime-a' });
        const secondRuntime = createInfraRuntime({ runtimeId: 'watch-runtime-b' });
        disposables.push(firstRuntime, secondRuntime);
        const first = firstRuntime.workspace(rootA);
        const second = secondRuntime.workspace(rootB);
        /** @type {string[]} */ const eventsA = [];
        /** @type {string[]} */ const eventsB = [];
        await first.startExternalWatch(rootA, {
            enabled: true,
            debounceMs: 20,
            onInvalidate: (filePath) => eventsA.push(filePath),
        });
        await second.startExternalWatch(rootB, {
            enabled: true,
            debounceMs: 20,
            onInvalidate: (filePath) => eventsB.push(filePath),
        });

        const firstFile = join(rootA, 'a.js');
        const secondFile = join(rootB, 'b.js');
        await Promise.all([
            writeFile(firstFile, 'export const a = 1;\n'),
            writeFile(secondFile, 'export const b = 1;\n'),
        ]);
        await waitUntil(() => eventsA.includes(firstFile) && eventsB.includes(secondFile));
        expect(first.externalWatchStats()).toHaveLength(1);
        expect(second.externalWatchStats()).toHaveLength(1);

        await first.dispose();
        const eventCountA = eventsA.length;
        const secondFile2 = join(rootB, 'b2.js');
        await Promise.all([
            writeFile(join(rootA, 'a2.js'), 'export const a2 = 2;\n'),
            writeFile(secondFile2, 'export const b2 = 2;\n'),
        ]);
        await waitUntil(() => eventsB.includes(secondFile2));
        await new Promise((resolve) => setTimeout(resolve, 80));
        expect(eventsA).toHaveLength(eventCountA);
        expect(second.externalWatchStats()[0]).toMatchObject({ watching: true });
    });

    it('OperationContext is frozen correlation data and carries no implicit authorization', () => {
        const controller = new AbortController();
        const context = createInfraOperationContext({
            traceId: 'trace-test',
            runtimeId: 'runtime-test',
            workspaceId: 'workspace-test',
            caller: 'unit-test',
            signal: controller.signal,
            deadlineAt: 1234,
        });
        expect(context).toEqual(
            expect.objectContaining({
                traceId: 'trace-test',
                runtimeId: 'runtime-test',
                workspaceId: 'workspace-test',
                caller: 'unit-test',
                signal: controller.signal,
                deadlineAt: 1234,
            }),
        );
        expect(Object.isFrozen(context)).toBe(true);
        expect(context).not.toHaveProperty('authority');
        expect(context).not.toHaveProperty('workspaceRoot');
    });

    it('composition/import does not materialize the persistent index', () => {
        const runtime = createInfraRuntime({ runtimeId: 'no-activation-runtime' });
        disposables.push(runtime);
        const before = runtime.indexRegistry.status();
        const workspace = runtime.workspace(process.cwd());
        void workspace.indexing;
        const after = runtime.indexRegistry.status();
        expect(after.lifecycle.materialized).toBe(before.lifecycle.materialized);
        expect(after.lifecycle.materializations).toBe(before.lifecycle.materializations);
    });
});
