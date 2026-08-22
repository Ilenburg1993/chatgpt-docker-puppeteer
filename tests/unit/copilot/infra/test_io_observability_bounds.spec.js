// @ts-check

import { publishIoOperation } from '#copilot/infra/internal/telemetry';
import { createProcessInfra } from '#copilot/infra/public/composition/process';
import { readIoProcessHealthSnapshot } from '#copilot/infra/public/observability/process';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readIoRuntimeHealthSnapshot } from '../../../../src/copilot/infra/observability/health.js';

/** @type {ReturnType<typeof createProcessInfra>} */
let processInfra;
/** @type {ReturnType<ReturnType<typeof createProcessInfra>['createRuntime']>} */
let runtime;
beforeEach(() => {
    processInfra = createProcessInfra({
        processId: `observability-process-${Date.now()}-${Math.random()}`,
        activateProcessPolicies: true,
    });
    runtime = processInfra.createRuntime({ runtimeId: `observability-test-${Date.now()}-${Math.random()}` });
});
afterEach(async () => {
    await processInfra.dispose();
});

describe('infra/io-observability bounds', () => {
    it('limits diagnostic histogram cardinality for dynamic operation names', () => {
        for (let i = 0; i < 80; i++) {
            runtime.telemetry.latency.record(`dynamic-operation-${i}`, i + 1);
        }

        const stats = runtime.telemetry.latency.stats();
        expect(Object.keys(stats).length).toBeLessThanOrEqual(64);
        expect(stats['dynamic-operation-0']).toBeUndefined();
        expect(stats['dynamic-operation-79']?.count).toBe(1);
    });

    it('agrega metadata de durabilidade com cardinalidade fixa e projeta alerta de falha', () => {
        const before = runtime.telemetry.durability.stats();
        publishIoOperation(
            /** @type {import('../../../../src/copilot/core/io-contracts.js').IoMeta} */ ({
                operation: 'copy',
                target: '/tmp/source -> /tmp/destination',
                targetKind: 'file',
                cache: 'none',
                riskClass: 'high',
                policyVersion: 'test',
                advisoryLimits: {
                    fileSync: { attempted: true, ok: true },
                    destinationDirectorySync: { attempted: true, ok: false, errorCode: 'EIO' },
                    sourceDirectorySync: { attempted: true, ok: false, skippedReason: 'directory-sync-unsupported' },
                },
            }),
            { success: false, error: new Error('sync failed') },
            runtime.telemetry,
        );

        const after = runtime.telemetry.durability.stats();
        expect(after.operationsObserved).toBe(before.operationsObserved + 1);
        expect(after.operationsWithMetadata).toBe(before.operationsWithMetadata + 1);
        expect(after.fileSync.confirmed).toBe(before.fileSync.confirmed + 1);
        expect(after.directorySync.failed).toBe(before.directorySync.failed + 1);
        expect(after.directorySync.skipped).toBe(before.directorySync.skipped + 1);
        expect(after.lastFailure).toMatchObject({ kind: 'directory', operation: 'copy', errorCode: 'EIO' });
        expect(readIoRuntimeHealthSnapshot(runtime).alerts).toContainEqual(
            expect.objectContaining({ code: 'IO_DURABILITY_SYNC_FAILED', severity: 'high' }),
        );
    });

    it('projeta retry exhaustion do index como runtime degraded sem materializar outro owner', () => {
        const baseIndex = runtime.indexRegistry.status();
        const degradedRuntime = /** @type {typeof runtime} */ (
            /** @type {unknown} */ ({
                ...runtime,
                indexRegistry: Object.freeze({
                    ...runtime.indexRegistry,
                    status() {
                        return Object.freeze({
                            ...baseIndex,
                            autoRefresh: Object.freeze({ ...baseIndex.autoRefresh, exhausted: 2 }),
                        });
                    },
                }),
            })
        );

        const health = readIoRuntimeHealthSnapshot(degradedRuntime);
        expect(health.status).toBe('degraded');
        expect(health.alerts).toContainEqual(
            expect.objectContaining({ code: 'IO_INDEX_AUTO_REFRESH_EXHAUSTED', severity: 'medium' }),
        );
    });

    it('projeta pending persistentemente stale do index como runtime degraded sem expor paths', () => {
        const baseIndex = runtime.indexRegistry.status();
        const degradedRuntime = /** @type {typeof runtime} */ (
            /** @type {unknown} */ ({
                ...runtime,
                indexRegistry: Object.freeze({
                    ...runtime.indexRegistry,
                    status() {
                        return Object.freeze({
                            ...baseIndex,
                            autoRefresh: Object.freeze({
                                ...baseIndex.autoRefresh,
                                pending: 3,
                                stalePending: 2,
                                oldestPendingAgeMs: 45_000,
                                staleAfterMs: 30_000,
                            }),
                        });
                    },
                }),
            })
        );

        const health = readIoRuntimeHealthSnapshot(degradedRuntime);
        expect(health.status).toBe('degraded');
        expect(health.alerts).toContainEqual(
            expect.objectContaining({ code: 'IO_INDEX_AUTO_REFRESH_STALE_PENDING', severity: 'medium' }),
        );
        expect(JSON.stringify(health.alerts)).not.toContain('/tmp/');
    });

    it('projeta locks somente no process health, bounded e sem recursos em claro', () => {
        const runtimeHealth = readIoRuntimeHealthSnapshot(runtime);
        expect(runtimeHealth).not.toHaveProperty('locks');
        expect(runtimeHealth.cache).not.toHaveProperty('pathPolicy');
        expect(runtimeHealth.cache).not.toHaveProperty('validatedReadPath');
        expect(runtimeHealth.cache).not.toHaveProperty('validatedMutablePath');

        const processHealth = readIoProcessHealthSnapshot(processInfra);
        expect(processHealth.ownership).toMatchObject({ expected: true, complete: true });
        expect(processHealth.locks?.wait.maxOperationCardinality).toBe(32);
        expect(processHealth.locks?.wait.operationCardinality).toBeLessThanOrEqual(32);
        expect(processHealth.locks?.activeLeaseSample).toHaveLength(0);
        expect(processHealth.locks?.fileLocks.activeLeaseSample).toHaveLength(0);
        expect(processHealth.locks).not.toHaveProperty('resources');
        expect(processHealth.locks?.fileLocks).not.toHaveProperty('lockDir');
    });
});
