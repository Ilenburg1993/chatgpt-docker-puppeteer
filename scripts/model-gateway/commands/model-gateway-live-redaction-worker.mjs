#!/usr/bin/env node
import '../bootstrap-sqlite.mjs';

import { performance } from 'node:perf_hooks';
import process from 'node:process';
import { isMainThread, parentPort, workerData } from 'node:worker_threads';

const MODES = new Set(['catalog', 'sqlite']);
const workerStartedAt = performance.now();
/** @type {Map<string, Promise<Record<string, any>>>} */
const modeContexts = new Map();

/**
 * @param {string} name
 * @param {string} [fallback]
 */
function readArg(name, fallback = '') {
    const prefix = `${name}=`;
    const direct = process.argv.slice(2).find((arg) => arg.startsWith(prefix));
    return direct ? direct.slice(prefix.length) : fallback;
}

/**
 * @param {unknown} value
 * @param {number} fallback
 */
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
 * }} audit
 */
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

/** @param {string} mode */
async function loadModeContext(mode) {
    let contextPromise = modeContexts.get(mode);
    if (contextPromise) return contextPromise;
    contextPromise = (async () => {
        const redactionModule = await import('../../../src/copilot/model-gateway/secrets/redaction-audit.js');
        if (mode === 'catalog') {
            const { DEFAULT_MODEL_GATEWAY_CATALOG_PATH, JsonModelGatewayCatalogStore } =
                await import('../../../src/copilot/model-gateway/catalog/json-catalog-store.js');
            return {
                redactionModule,
                store: new JsonModelGatewayCatalogStore({ filePath: DEFAULT_MODEL_GATEWAY_CATALOG_PATH }),
            };
        }
        const { SqliteModelGatewayCatalogStore } =
            await import('../../../src/copilot/model-gateway/catalog/sqlite-catalog-store.js');
        return {
            redactionModule,
            store: new SqliteModelGatewayCatalogStore(),
        };
    })();
    modeContexts.set(mode, contextPromise);
    try {
        return await contextPromise;
    } catch (error) {
        modeContexts.delete(mode);
        throw error;
    }
}

/** @param {{ mode?: unknown; maxRowsPerTable?: unknown }} input */
async function runAudit(input) {
    const mode = typeof input?.mode === 'string' ? input.mode : '';
    const maxRowsPerTable = readPositiveInteger(input?.maxRowsPerTable, 25);
    if (!MODES.has(mode)) throw new Error('redaction worker mode must be catalog or sqlite');
    const boundedMaxRowsPerTable = Math.max(1, Math.min(maxRowsPerTable, 1_000_000));
    const requestStartedAt = performance.now();
    const context = await loadModeContext(mode);
    const additionalSecrets = context['redactionModule'].collectModelGatewaySecretAuditEnvValues(process.env);
    let audit;
    let sourceSnapshotId = null;
    if (mode === 'catalog') {
        const snapshot = await context['store'].readSnapshot();
        sourceSnapshotId = snapshot.snapshotId ?? null;
        audit = context['redactionModule'].auditModelGatewayValueRedaction(snapshot, {
            surface: 'json:catalog',
            rootPath: 'catalog',
            additionalSecrets,
        });
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
        workerUptimeMs: Number((performance.now() - workerStartedAt).toFixed(3)),
        audit: compactAudit(audit),
    };
}

async function runOneShot() {
    return runAudit(resolveInput());
}

/** @param {unknown} result */
function postWorkerResult(result) {
    if (parentPort) parentPort.postMessage(result);
}

if (!isMainThread && workerData?.persistent === true && parentPort) {
    const fixedMode = typeof workerData.mode === 'string' ? workerData.mode : '';
    let queue = Promise.resolve();
    parentPort.on('message', (message) => {
        const requestId = typeof message?.requestId === 'string' ? message.requestId : '';
        queue = queue
            .then(async () => {
                try {
                    const result = await runAudit({
                        mode: fixedMode,
                        maxRowsPerTable: message?.maxRowsPerTable,
                    });
                    postWorkerResult({ requestId, ...result });
                } catch (error) {
                    postWorkerResult({
                        requestId,
                        success: false,
                        error: error instanceof Error ? error.message : String(error),
                    });
                }
            })
            .catch(() => {});
    });
} else {
    runOneShot()
        .then((result) => {
            if (!isMainThread && parentPort) {
                postWorkerResult(result);
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
                postWorkerResult(result);
                return;
            }
            process.stdout.write(`${JSON.stringify(result)}\n`);
            process.exitCode = 1;
        });
}
