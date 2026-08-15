#!/usr/bin/env node

import { performance } from 'node:perf_hooks';
import process from 'node:process';
import { isMainThread, parentPort, workerData } from 'node:worker_threads';

const DEFAULT_SQLITE_PATH = 'data/copilot.sqlite';
const MODES = new Set(['catalog', 'sqlite']);
const workerStartedAt = performance.now();

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

function resolveInput() {
    if (!isMainThread && workerData && typeof workerData === 'object') {
        const mode = typeof workerData.mode === 'string' ? workerData.mode : '';
        const maxRowsPerTable = readPositiveInteger(workerData.maxRowsPerTable, 25);
        return { mode, maxRowsPerTable };
    }
    return {
        mode: readArg('--mode'),
        maxRowsPerTable: Math.max(
            1,
            Math.min(readPositiveInteger(readArg('--sqlite-redaction-max-rows-per-table'), 25), 1_000_000),
        ),
    };
}

async function main() {
    const { mode, maxRowsPerTable } = resolveInput();
    if (!MODES.has(mode)) throw new Error('redaction worker mode must be catalog or sqlite');
    const boundedMaxRowsPerTable = Math.max(1, Math.min(maxRowsPerTable, 1_000_000));
    const modeLoadStartedAt = performance.now();
    const redactionModulePromise = import('../../../src/copilot/model-gateway/secrets/redaction-audit.js');
    let audit;
    let sourceSnapshotId = null;
    if (mode === 'catalog') {
        const [{ DEFAULT_MODEL_GATEWAY_CATALOG_PATH, JsonModelGatewayCatalogStore }, redactionModule] =
            await Promise.all([
                import('../../../src/copilot/model-gateway/catalog/json-catalog-store.js'),
                redactionModulePromise,
            ]);
        const additionalSecrets = redactionModule.collectModelGatewaySecretAuditEnvValues(process.env);
        const store = new JsonModelGatewayCatalogStore({ filePath: DEFAULT_MODEL_GATEWAY_CATALOG_PATH });
        const snapshot = await store.readSnapshot();
        sourceSnapshotId = snapshot.snapshotId ?? null;
        audit = redactionModule.auditModelGatewayValueRedaction(snapshot, {
            surface: 'json:catalog',
            rootPath: 'catalog',
            additionalSecrets,
        });
    } else {
        const [{ SqliteModelGatewayCatalogStore }, redactionModule, dbModule] = await Promise.all([
            import('../../../src/copilot/model-gateway/catalog/sqlite-catalog-store.js'),
            redactionModulePromise,
            import('../../../src/copilot/db/sqlite.js'),
        ]);
        dbModule.setDbLogger(() => {});
        const additionalSecrets = redactionModule.collectModelGatewaySecretAuditEnvValues(process.env);
        const store = new SqliteModelGatewayCatalogStore({ dbPath: DEFAULT_SQLITE_PATH });
        audit = await store.auditStoredPayloadRedaction({
            additionalSecrets,
            maxRowsPerTable: boundedMaxRowsPerTable,
        });
    }
    return {
        success: true,
        mode,
        sourceSnapshotId,
        moduleLoadAndAuditMs: Number((performance.now() - modeLoadStartedAt).toFixed(3)),
        durationMs: Number((performance.now() - workerStartedAt).toFixed(3)),
        audit: compactAudit(audit),
    };
}

main()
    .then((result) => {
        if (!isMainThread && parentPort) {
            parentPort.postMessage(result);
            return;
        }
        process.stdout.write(`${JSON.stringify(result)}\n`);
    })
    .catch((error) => {
        const result = {
            success: false,
            error: error instanceof Error ? error.message : String(error),
        };
        if (!isMainThread && parentPort) {
            parentPort.postMessage(result);
            return;
        }
        process.stdout.write(`${JSON.stringify(result)}\n`);
        process.exitCode = 1;
    });
