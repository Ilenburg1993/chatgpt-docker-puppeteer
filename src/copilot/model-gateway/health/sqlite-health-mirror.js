// @ts-check
/**
 * Mirror operational BYOK health into the model-gateway SQLite runtime layer.
 *
 * The source of truth for runtime health remains probe/live execution. This helper only materializes the latest
 * operational health facts into SQLite so catalog explain/search layers can consult them without reading terminal files.
 *
 * @module copilot/model-gateway/health/sqlite-health-mirror
 */

import { listByokProviderModelHealth } from './provider-health.js';

/**
 * @param {object} input
 * @param {{ writeRuntimeHealthRecords(records: Record<string, unknown>[], options?: { runId?: string; observedAt?: string | number | Date }): Promise<{ runId: string; healthObservations: number; probeResults: number }> }} input.sqliteStore
 * @param {Record<string, unknown>[]} [input.records]
 * @param {string | number | Date} [input.observedAt]
 * @returns {Promise<{ runId: string; healthObservations: number; probeResults: number; records: number }>}
 */
export async function mirrorByokProviderHealthToSqlite(input) {
    const records = input.records ?? listByokProviderModelHealth();
    const options = input.observedAt === undefined ? {} : { observedAt: input.observedAt };
    const result = await input.sqliteStore.writeRuntimeHealthRecords(records, options);
    return {
        ...result,
        records: records.length,
    };
}
