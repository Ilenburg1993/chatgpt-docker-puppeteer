// @ts-check

import { readIoRuntimeHealthSnapshot } from '#copilot/infra/internal/observability';
import { createInfraRuntime } from '#copilot/infra/public/composition/runtime';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

/** @type {Array<ReturnType<typeof createInfraRuntime>>} */
const runtimes = [];
/** @type {string[]} */
const tempRoots = [];

afterEach(async () => {
    await Promise.allSettled(runtimes.splice(0).map((runtime) => runtime.dispose()));
    await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

/** @param {ReturnType<typeof createInfraRuntime>} runtime */
function stableRuntimeHealth(runtime) {
    const snapshot = JSON.parse(JSON.stringify(readIoRuntimeHealthSnapshot(runtime)));
    delete snapshot.generatedAt;
    return snapshot;
}

describe('IO health owner-bound scope probes', () => {
    it('runtime A never snapshots scopes owned by runtime B', async () => {
        const rootA = await mkdtemp(join(tmpdir(), 'health-owner-a-'));
        const rootB = await mkdtemp(join(tmpdir(), 'health-owner-b-'));
        tempRoots.push(rootA, rootB);
        const fileA = join(rootA, 'a.js');
        const fileB = join(rootB, 'b.js');
        await Promise.all([
            writeFile(fileA, 'export const a = 1;\n', 'utf8'),
            writeFile(fileB, 'export const b = 2;\n', 'utf8'),
        ]);

        const runtimeA = createInfraRuntime({ runtimeId: 'health-owner-runtime-a' });
        const runtimeB = createInfraRuntime({ runtimeId: 'health-owner-runtime-b' });
        runtimes.push(runtimeA, runtimeB);
        const workspaceA = runtimeA.workspace(rootA);
        const workspaceB = runtimeB.workspace(rootB);

        expect(readIoRuntimeHealthSnapshot(runtimeA).scopes).toMatchObject({ active: 0 });
        expect(readIoRuntimeHealthSnapshot(runtimeB).scopes).toMatchObject({ active: 0 });

        const handleB = workspaceB.indexing.context.declareScope({
            sessionId: 'health-owned-scope-b',
            paths: [fileB],
            parseSymbols: false,
            indexMode: 'off',
        });
        await handleB.awaitReady();

        const healthA = readIoRuntimeHealthSnapshot(runtimeA);
        const healthB = readIoRuntimeHealthSnapshot(runtimeB);
        expect(healthA.scopes).toMatchObject({ active: 0, ids: [] });
        expect(healthB.scopes.active).toBe(1);
        expect(healthB.scopes.ids).toEqual(['health-owned-scope-b']);
        expect(healthB.scopes.recent).toHaveLength(1);

        workspaceB.indexing.context.closeScope('health-owned-scope-b');
        expect(readIoRuntimeHealthSnapshot(runtimeA).scopes).toMatchObject({ active: 0, ids: [] });
        expect(readIoRuntimeHealthSnapshot(runtimeB).scopes).toMatchObject({ active: 0, ids: [] });

        // Materializing A's workspace did not itself create a scope or register a probe.
        expect(workspaceA.indexing.context.listScopes()).toEqual([]);
        expect(readIoRuntimeHealthSnapshot(runtimeA).scopes).toMatchObject({ active: 0, ids: [] });
    });

    it('snapshot inteiro de runtime A permanece estável quando somente runtime B trabalha', async () => {
        const rootA = await mkdtemp(join(tmpdir(), 'health-isolation-a-'));
        const rootB = await mkdtemp(join(tmpdir(), 'health-isolation-b-'));
        tempRoots.push(rootA, rootB);
        const fileA = join(rootA, 'a.js');
        const fileB = join(rootB, 'b.js');
        const sourceA = 'export const isolatedA = 1;\n';
        const sourceB = 'export function isolatedB() { return 2; }\n';
        await Promise.all([writeFile(fileA, sourceA, 'utf8'), writeFile(fileB, sourceB, 'utf8')]);

        const runtimeA = createInfraRuntime({ runtimeId: 'health-isolation-runtime-a' });
        const runtimeB = createInfraRuntime({ runtimeId: 'health-isolation-runtime-b' });
        runtimes.push(runtimeA, runtimeB);
        runtimeA.workspace(rootA);
        const workspaceB = runtimeB.workspace(rootB);

        const beforeA = stableRuntimeHealth(runtimeA);

        await workspaceB.authority.authorizeRead(fileB, 'read');
        runtimeB.telemetry.latency.record('runtime-b-only-operation', 17);
        await workspaceB.indexing.parseFileForContext(fileB, sourceB);
        const scopeB = workspaceB.indexing.context.declareScope({
            sessionId: 'health-isolation-scope-b',
            paths: [fileB],
            parseSymbols: true,
            indexMode: 'off',
        });
        await scopeB.awaitReady();

        const afterA = stableRuntimeHealth(runtimeA);
        expect(afterA).toEqual(beforeA);

        const healthB = readIoRuntimeHealthSnapshot(runtimeB);
        expect(healthB.scopes).toMatchObject({ active: 1, ids: ['health-isolation-scope-b'] });
        expect(healthB.latency).toHaveProperty('runtime-b-only-operation');
        expect(healthB.workspaces.authorities.sample[0]?.read.issued).toBeGreaterThan(0);
    });
});
