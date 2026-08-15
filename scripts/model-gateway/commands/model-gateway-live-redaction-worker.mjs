#!/usr/bin/env node

import process from 'node:process';

import {
    DEFAULT_MODEL_GATEWAY_CATALOG_PATH,
    JsonModelGatewayCatalogStore,
    SqliteModelGatewayCatalogStore,
    auditModelGatewayValueRedaction,
    collectModelGatewaySecretAuditEnvValues,
} from '../../../src/copilot/model-gateway/index.js';
import { setDbLogger } from '../../../src/copilot/db/index.js';

const DEFAULT_SQLITE_PATH = 'data/copilot.sqlite';
const MODES = new Set(['catalog', 'sqlite']);

setDbLogger(() => {});

function readArg(name, fallback = '') {
    const prefix = `${name}=`;
    const direct = process.argv.slice(2).find((arg) => arg.startsWith(prefix));
    return direct ? direct.slice(prefix.length) : fallback;
}

function readPositiveInteger(value, fallback) {
    const parsed = Number.parseInt(String(value ?? ''), 10);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function compactAudit(audit) {
    return {
        ok: audit.ok === true,
        leakCount: Number(audit.leakCount ?? 0),
        scannedStringCount: Number(audit.scannedStringCount ?? 0),
        sampleCount: Number(audit.sampleCount ?? 0),
        ...('tableCount' in audit ? { tableCount: Number(audit.tableCount ?? 0) } : {}),
    };
}

async function main() {
    const mode = readArg('--mode');
    if (!MODES.has(mode)) throw new Error('redaction worker mode must be catalog or sqlite');
    const maxRowsPerTable = Math.max(
        1,
        Math.min(readPositiveInteger(readArg('--sqlite-redaction-max-rows-per-table'), 25), 1_000_000),
    );
    const additionalSecrets = collectModelGatewaySecretAuditEnvValues(process.env);
    const startedAt = performance.now();
    let audit;
    let sourceSnapshotId = null;
    if (mode === 'catalog') {
        const store = new JsonModelGatewayCatalogStore({ filePath: DEFAULT_MODEL_GATEWAY_CATALOG_PATH });
        const snapshot = await store.readSnapshot();
        sourceSnapshotId = snapshot.snapshotId ?? null;
        audit = auditModelGatewayValueRedaction(snapshot, {
            surface: 'json:catalog',
            rootPath: 'catalog',
            additionalSecrets,
        });
    } else {
        const store = new SqliteModelGatewayCatalogStore({ dbPath: DEFAULT_SQLITE_PATH });
        audit = await store.auditStoredPayloadRedaction({
            additionalSecrets,
            maxRowsPerTable,
        });
    }
    process.stdout.write(
        `${JSON.stringify({
            success: true,
            mode,
            sourceSnapshotId,
            durationMs: Number((performance.now() - startedAt).toFixed(3)),
            audit: compactAudit(audit),
        })}\n`,
    );
}

main().catch((error) => {
    process.stdout.write(
        `${JSON.stringify({
            success: false,
            error: error instanceof Error ? error.message : String(error),
        })}\n`,
    );
    process.exitCode = 1;
});
