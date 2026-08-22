#!/usr/bin/env node
import { SqliteModelGatewayCatalogStore } from '../../../src/copilot/model-gateway/index.js';
import '../bootstrap-sqlite.mjs';

import { createArgReader } from '../cli-args.mjs';

const args = process.argv.slice(2);
const readArg = createArgReader(args);
const argSet = new Set(args);

if (argSet.has('--help') || argSet.has('-h')) {
    process.stdout.write(`Usage: node scripts/model-gateway/commands/model-gateway-live-runs.mjs [--json] [--limit N]

Read persisted model-gateway terminal live scenario run summaries. This command is read-only and does not call providers.
`);
    process.exit(0);
}

const limit = Math.max(1, Math.min(Number(readArg('--limit', '20')) || 20, 100));
const rows = await new SqliteModelGatewayCatalogStore().readLiveScenarioRunRecords({ limit });
const summary = {
    schema: 'model-gateway-live-runs',
    ok: true,
    limit,
    count: rows.length,
    rows,
};

if (argSet.has('--json')) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
} else {
    process.stdout.write(`model-gateway live runs: count=${rows.length} limit=${limit}\n`);
    rows.forEach((row, index) => {
        process.stdout.write(
            `  ${index + 1}. status=${row['status'] ?? '-'} kind=${row['scenarioKind'] ?? row['kind'] ?? '-'} ok=${row['ok'] === true ? 'yes' : 'no'} criteria=${row['criteriaFailed'] ?? '-'}/${row['criteriaTotal'] ?? '-'} summary=${row['summaryPath'] ?? '-'}\n`,
        );
    });
}
