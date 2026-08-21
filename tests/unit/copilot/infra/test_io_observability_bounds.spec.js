// @ts-check

import { publishIoOperation } from '#copilot/infra/internal/telemetry';
import { createInfraRuntime } from '#copilot/infra/public/composition/runtime';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readIoRuntimeHealthSnapshot } from '../../../../src/copilot/infra/observability/health.js';

/** @type {ReturnType<typeof createInfraRuntime>} */
let runtime;
beforeEach(() => {
    runtime = createInfraRuntime({ runtimeId: `observability-test-${Date.now()}-${Math.random()}` });
});
afterEach(async () => {
    await runtime.dispose();
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

    it('projeta locks bounded no health sem recursos em claro', () => {
        const health = readIoRuntimeHealthSnapshot(runtime);
        expect(health.locks.wait.maxOperationCardinality).toBe(32);
        expect(health.locks.wait.operationCardinality).toBeLessThanOrEqual(32);
        expect(health.locks.activeLeaseSample).toHaveLength(0);
        expect(health.locks.fileLocks.activeLeaseSample).toHaveLength(0);
        expect(health.locks).not.toHaveProperty('resources');
        expect(health.locks.fileLocks).not.toHaveProperty('lockDir');
    });
});
