#!/usr/bin/env node
// @ts-check
/** Call-scoped worker/CLI entrypoint for canonical Model Gateway readiness redaction audits. */

import { runModelGatewayReadinessRedactionAudit } from '#copilot/model-gateway/readiness';
import process from 'node:process';
import { getHeapStatistics } from 'node:v8';
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

/** @param {unknown} value @returns {NodeJS.ProcessEnv} */
function requireExplicitWorkerEnvironment(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new TypeError('Model Gateway redaction worker requires explicit environment authority.');
    }
    /** @type {NodeJS.ProcessEnv} */
    const env = {};
    for (const [key, item] of Object.entries(value)) {
        if (typeof item !== 'string') {
            throw new TypeError(`Model Gateway redaction worker received a non-string environment value for ${key}.`);
        }
        env[key] = item;
    }
    return env;
}

/** @param {NodeJS.ProcessEnv} explicitEnv */
function assertProcessEnvironmentAuthority(explicitEnv) {
    const actualKeys = Object.keys(process.env)
        .filter((key) => process.env[key] !== undefined)
        .sort();
    const expectedKeys = Object.keys(explicitEnv)
        .filter((key) => explicitEnv[key] !== undefined)
        .sort();
    if (actualKeys.length !== expectedKeys.length || actualKeys.some((key, index) => key !== expectedKeys[index])) {
        throw new Error('Model Gateway redaction worker process.env does not match its explicit authority projection.');
    }
    for (const key of expectedKeys) {
        if (process.env[key] !== explicitEnv[key]) {
            throw new Error(`Model Gateway redaction worker environment authority mismatch for ${key}.`);
        }
    }
}

function resolveInput() {
    if (!isMainThread) {
        if (!workerData || typeof workerData !== 'object') {
            throw new TypeError('Model Gateway redaction worker requires workerData.');
        }
        const env = requireExplicitWorkerEnvironment(workerData.env);
        assertProcessEnvironmentAuthority(env);
        return {
            mode: typeof workerData.mode === 'string' ? workerData.mode : '',
            maxRowsPerTable: readPositiveInteger(workerData.maxRowsPerTable, 25),
            diagnostics: workerData.diagnostics === true,
            env,
        };
    }
    return {
        mode: readArg('--mode'),
        diagnostics: process.argv.includes('--diagnostics'),
        maxRowsPerTable: Math.max(
            1,
            Math.min(readPositiveInteger(readArg('--sqlite-redaction-max-rows-per-table'), 25), 1_000_000),
        ),
        env: process.env,
    };
}

/** @param {unknown} result */
function postWorkerResult(result) {
    if (!parentPort) return;
    parentPort.postMessage(result);
    parentPort.close();
}

try {
    const input = resolveInput();
    // Defer SQLite composition until worker environment authority has been proven.
    await import('../bootstrap-sqlite.mjs');
    const result = await runModelGatewayReadinessRedactionAudit(input);
    const output = input.diagnostics ? { ...result, heapStatistics: getHeapStatistics() } : result;
    if (!isMainThread) postWorkerResult(output);
    else process.stdout.write(`${JSON.stringify(output)}\n`);
} catch (error) {
    const result = { success: false, error: error instanceof Error ? error.message : String(error) };
    if (!isMainThread) postWorkerResult(result);
    else {
        process.stdout.write(`${JSON.stringify(result)}\n`);
        process.exitCode = 1;
    }
}
