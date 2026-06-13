// @ts-check

import { describe, expect, it } from 'vitest';
import {
    getIoDurabilityStats,
    getIoLatencyStats,
    publishIoOperation,
    recordIoLatency,
} from '../../../../src/copilot/infra/io-observability.js';
import { readIoRuntimeHealthSnapshot } from '../../../../src/copilot/infra/io-health.js';

describe('infra/io-observability bounds', () => {
    it('limits diagnostic histogram cardinality for dynamic operation names', () => {
        for (let i = 0; i < 80; i++) {
            recordIoLatency(`dynamic-operation-${i}`, i + 1);
        }

        const stats = getIoLatencyStats();
        expect(Object.keys(stats).length).toBeLessThanOrEqual(64);
        expect(stats['dynamic-operation-0']).toBeUndefined();
        expect(stats['dynamic-operation-79']?.count).toBe(1);
    });

    it('agrega metadata de durabilidade com cardinalidade fixa e projeta alerta de falha', () => {
        const before = getIoDurabilityStats();
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
        );

        const after = getIoDurabilityStats();
        expect(after.operationsObserved).toBe(before.operationsObserved + 1);
        expect(after.operationsWithMetadata).toBe(before.operationsWithMetadata + 1);
        expect(after.fileSync.confirmed).toBe(before.fileSync.confirmed + 1);
        expect(after.directorySync.failed).toBe(before.directorySync.failed + 1);
        expect(after.directorySync.skipped).toBe(before.directorySync.skipped + 1);
        expect(after.lastFailure).toMatchObject({ kind: 'directory', operation: 'copy', errorCode: 'EIO' });
        expect(readIoRuntimeHealthSnapshot().alerts).toContainEqual(
            expect.objectContaining({ code: 'IO_DURABILITY_SYNC_FAILED', severity: 'high' }),
        );
    });
});
