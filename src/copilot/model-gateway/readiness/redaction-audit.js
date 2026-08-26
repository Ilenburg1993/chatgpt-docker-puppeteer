// @ts-check
/** Canonical redaction-audit service used by Model Gateway live readiness workers. */

import { performance } from 'node:perf_hooks';

const serviceStartedAt = performance.now();

/** @param {unknown} value @param {number} fallback */
function readPositiveInteger(value, fallback) {
    const parsed = Number.parseInt(String(value ?? ''), 10);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * @param {{
 *     ok?: unknown;
 *     leakCount?: unknown;
 *     scannedStringCount?: unknown;
 *     sampleCount?: unknown;
 *     tableCount?: unknown;
 *     rowCount?: unknown;
 *     payloadBytes?: unknown;
 *     maxRowsPerTable?: unknown;
 *     fingerprint?: unknown;
 * }} audit
 */
function compactAudit(audit) {
    return {
        ok: audit.ok === true,
        leakCount: Number(audit.leakCount ?? 0),
        scannedStringCount: Number(audit.scannedStringCount ?? 0),
        sampleCount: Number(audit.sampleCount ?? 0),
        ...('tableCount' in audit ? { tableCount: Number(audit.tableCount ?? 0) } : {}),
        ...('rowCount' in audit ? { rowCount: Number(audit.rowCount ?? 0) } : {}),
        ...('payloadBytes' in audit ? { payloadBytes: Number(audit.payloadBytes ?? 0) } : {}),
        ...('maxRowsPerTable' in audit ? { maxRowsPerTable: Number(audit.maxRowsPerTable ?? 0) } : {}),
        ...(typeof audit.fingerprint === 'string' ? { fingerprint: audit.fingerprint } : {}),
    };
}

/** @param {'catalog' | 'sqlite'} mode @returns {Promise<Record<string, any>>} */
async function loadModeContext(mode) {
    const redactionModule = await import('../secrets/redaction-audit.js');
    if (mode === 'catalog') {
        const { DEFAULT_MODEL_GATEWAY_CATALOG_PATH, JsonModelGatewayCatalogStore } =
            await import('../catalog/json-catalog-store.js');
        return {
            redactionModule,
            store: new JsonModelGatewayCatalogStore({ filePath: DEFAULT_MODEL_GATEWAY_CATALOG_PATH }),
        };
    }
    const { SqliteModelGatewayCatalogStore } = await import('../catalog/sqlite-catalog-store.js');
    return {
        redactionModule,
        store: new SqliteModelGatewayCatalogStore(),
    };
}

/**
 * Execute one redaction audit against the canonical JSON or SQLite Model Gateway store.
 * SQLite bootstrap is intentionally owned by the calling composition/worker entrypoint.
 *
 * @param {{ mode?: unknown; maxRowsPerTable?: unknown; env?: NodeJS.ProcessEnv }} input
 */
export async function runModelGatewayReadinessRedactionAudit(input) {
    const mode = typeof input?.mode === 'string' ? input.mode : '';
    const maxRowsPerTable = readPositiveInteger(input?.maxRowsPerTable, 25);
    const env = input?.env ?? process.env;
    if (mode !== 'catalog' && mode !== 'sqlite') throw new Error('redaction worker mode must be catalog or sqlite');
    const boundedMaxRowsPerTable = Math.max(1, Math.min(maxRowsPerTable, 1_000_000));
    const requestStartedAt = performance.now();
    const context = await loadModeContext(mode);
    const additionalSecrets = context['redactionModule'].collectModelGatewaySecretAuditEnvValues(env);
    let audit;
    let sourceSnapshotId = null;
    if (mode === 'catalog') {
        const catalogSource = await context['store'].readSnapshotWithContentFingerprint();
        const snapshot = catalogSource.snapshot;
        sourceSnapshotId = snapshot.snapshotId ?? null;
        audit = {
            ...context['redactionModule'].auditModelGatewayValueRedaction(snapshot, {
                surface: 'json:catalog',
                rootPath: 'catalog',
                additionalSecrets,
            }),
            fingerprint: catalogSource.contentFingerprint,
            payloadBytes: catalogSource.payloadBytes,
        };
    } else {
        audit = await context['store'].auditStoredPayloadRedaction({
            additionalSecrets,
            maxRowsPerTable: boundedMaxRowsPerTable,
        });
    }
    return {
        success: true,
        mode,
        sourceSnapshotId,
        durationMs: Number((performance.now() - requestStartedAt).toFixed(3)),
        serviceUptimeMs: Number((performance.now() - serviceStartedAt).toFixed(3)),
        audit: compactAudit(audit),
    };
}
