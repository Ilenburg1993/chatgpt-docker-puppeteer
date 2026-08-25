#!/usr/bin/env node
// @ts-check
/** Thin worker/CLI entrypoint for canonical Model Gateway readiness redaction audits. */

import '../bootstrap-sqlite.mjs';

import { runModelGatewayReadinessRedactionAudit } from '#copilot/model-gateway/readiness';
import process from 'node:process';
import { isMainThread, parentPort, workerData } from 'node:worker_threads';

/** @param {string} name @param {string} [fallback] */
function readArg(name, fallback = '') {
    const prefix = `${name}=`;
    const direct = process.argv.slice(2).find((arg) => arg.startsWith(prefix));
    return direct ? direct.slice(prefix.length) : fallback;
}

/** @param {unknown} value @param {number} fallback */
function readPositiveInteger(value, fallback) {
    const parsed = Number.parseInt(String(value ?? ''), 10);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function resolveInput() {
    if (!isMainThread && workerData && typeof workerData === 'object') {
        return {
            mode: typeof workerData.mode === 'string' ? workerData.mode : '',
            maxRowsPerTable: readPositiveInteger(workerData.maxRowsPerTable, 25),
        };
    }
    return {
        mode: readArg('--mode'),
        maxRowsPerTable: Math.max(
            1,
            Math.min(readPositiveInteger(readArg('--sqlite-redaction-max-rows-per-table'), 25), 1_000_000),
        ),
    };
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
                    const result = await runModelGatewayReadinessRedactionAudit({
                        mode: fixedMode,
                        maxRowsPerTable: message?.maxRowsPerTable,
                        env: process.env,
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
    runModelGatewayReadinessRedactionAudit({ ...resolveInput(), env: process.env })
        .then((result) => {
            if (!isMainThread && parentPort) return postWorkerResult(result);
            process.stdout.write(`${JSON.stringify(result)}\n`);
        })
        .catch((error) => {
            const result = { success: false, error: error instanceof Error ? error.message : String(error) };
            if (!isMainThread && parentPort) return postWorkerResult(result);
            process.stdout.write(`${JSON.stringify(result)}\n`);
            process.exitCode = 1;
        });
}
