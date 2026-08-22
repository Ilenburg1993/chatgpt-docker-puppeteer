#!/usr/bin/env node
import { createConfiguredFsGrant, createConfiguredFsIo } from '#copilot/infra/public/composition/filesystem/configured';
import { basename, dirname, resolve } from 'node:path';
import {
    DEFAULT_MODEL_GATEWAY_SELECTION_TRACE_DIR,
    compareModelGatewaySelectionDecisionTraces,
    createModelGatewaySelectionTraceStore,
} from '../../../src/copilot/model-gateway/index.js';

import { createArgReader } from '../cli-args.mjs';

const args = process.argv.slice(2);
const readArg = createArgReader(args);
const argSet = new Set(args);

if (argSet.has('--help') || argSet.has('-h')) {
    process.stdout
        .write(`Usage: node scripts/model-gateway/commands/model-gateway-selection-trace-diff.mjs [--json] [--trace-dir <path>] [--left <path>] [--right <path>]

Compare two persisted model-gateway selection decision traces. If left/right are omitted, compare the two newest
historical traces in the trace directory. latest.json is intentionally ignored for automatic pair discovery.
`);
    process.exit(0);
}

const json = argSet.has('--json');
const traceDir = resolve(readArg('--trace-dir', DEFAULT_MODEL_GATEWAY_SELECTION_TRACE_DIR));
const traceStore = createModelGatewaySelectionTraceStore({
    directory: traceDir,
    io: createConfiguredFsIo(
        createConfiguredFsGrant({
            id: 'scripts.model-gateway.selection-trace-diff.trace-store',
            roots: [traceDir],
            operations: ['list', 'read', 'stat'],
            symlinkPolicy: 'deny',
        }),
    ),
});
const discovered = await traceStore.list({ limit: 2 });

/** @param {string} requested */
function resolveRequestedTrace(requested) {
    if (!requested) return null;
    const name = basename(requested);
    if (name !== requested && dirname(resolve(requested)) !== traceDir) {
        throw new Error(`Selection trace must be inside configured trace directory: ${traceDir}`);
    }
    return { name, filePath: resolve(traceDir, name) };
}

const right = resolveRequestedTrace(readArg('--right')) ?? discovered[0] ?? null;
const left = resolveRequestedTrace(readArg('--left')) ?? discovered[1] ?? null;
const rightPath = right?.filePath ?? '';
const leftPath = left?.filePath ?? '';

if (!leftPath || !rightPath) {
    const payload = {
        schema: 'model-gateway-selection-trace-diff',
        ok: false,
        error: 'missing_trace_pair',
        traceDir,
        discoveredCount: discovered.length,
        leftPath: leftPath || null,
        rightPath: rightPath || null,
    };
    if (json) process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    else process.stdout.write(`model-gateway selection trace diff: ok=no error=missing_trace_pair dir=${traceDir}\n`);
    process.exit(1);
}

const leftTrace = await traceStore.read(/** @type {NonNullable<typeof left>} */ (left).name);
const rightTrace = await traceStore.read(/** @type {NonNullable<typeof right>} */ (right).name);
const diff = {
    ...compareModelGatewaySelectionDecisionTraces(leftTrace, rightTrace),
    leftPath,
    rightPath,
};

if (json) {
    process.stdout.write(`${JSON.stringify(diff, null, 2)}\n`);
} else {
    process.stdout.write(
        `model-gateway selection trace diff: ok=${diff.ok ? 'yes' : 'no'} profiles=${diff.summary.profileCount} changed=${diff.summary.changedProfileCount} added=${diff.summary.addedProfileCount} removed=${diff.summary.removedProfileCount}\n`,
    );
    process.stdout.write(`left: ${diff.left.traceId ?? '-'} ${leftPath}\n`);
    process.stdout.write(`right: ${diff.right.traceId ?? '-'} ${rightPath}\n`);
    for (const row of diff.rows.filter((item) => item.status !== 'unchanged').slice(0, 20)) {
        const leftSelected = row.left?.['selectedRouteKey'] ?? 'none';
        const rightSelected = row.right?.['selectedRouteKey'] ?? 'none';
        process.stdout.write(
            `  ${row.status} ${row.profileId}: ${leftSelected} -> ${rightSelected} sourceChanged=${row.sourceChanged ? 'yes' : 'no'} proofChanged=${row.runtimeProofChanged ? 'yes' : 'no'}\n`,
        );
    }
}
