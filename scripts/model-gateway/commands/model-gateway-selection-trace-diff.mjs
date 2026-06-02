#!/usr/bin/env node
import {
    DEFAULT_MODEL_GATEWAY_SELECTION_TRACE_DIR,
    compareModelGatewaySelectionDecisionTraces,
    listModelGatewaySelectionDecisionTraceFiles,
    readModelGatewaySelectionDecisionTrace,
} from '../../../src/copilot/model-gateway/index.js';

const args = process.argv.slice(2);
const argSet = new Set(args);

function readArg(name, fallback = '') {
    const prefix = `${name}=`;
    for (let index = 0; index < args.length; index += 1) {
        const arg = args[index];
        if (arg.startsWith(prefix)) return arg.slice(prefix.length);
        if (arg === name) return args[index + 1] ?? fallback;
    }
    return fallback;
}

if (argSet.has('--help') || argSet.has('-h')) {
    process.stdout.write(`Usage: node scripts/model-gateway/commands/model-gateway-selection-trace-diff.mjs [--json] [--trace-dir <path>] [--left <path>] [--right <path>]

Compare two persisted model-gateway selection decision traces. If left/right are omitted, compare the two newest
historical traces in the trace directory. latest.json is intentionally ignored for automatic pair discovery.
`);
    process.exit(0);
}

const json = argSet.has('--json');
const traceDir = readArg('--trace-dir', DEFAULT_MODEL_GATEWAY_SELECTION_TRACE_DIR);
const discovered = await listModelGatewaySelectionDecisionTraceFiles({ directory: traceDir, limit: 2 });
const rightPath = readArg('--right') || discovered[0]?.filePath || '';
const leftPath = readArg('--left') || discovered[1]?.filePath || '';

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

const leftTrace = await readModelGatewaySelectionDecisionTrace(leftPath);
const rightTrace = await readModelGatewaySelectionDecisionTrace(rightPath);
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
