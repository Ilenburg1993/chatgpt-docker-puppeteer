#!/usr/bin/env node
import { setDbLogger } from '../../../src/copilot/db/sqlite.js';
import { SqliteModelGatewayCatalogStore } from '../../../src/copilot/model-gateway/index.js';

import { createArgReader } from '../cli-args.mjs';

const args = process.argv.slice(2);
const readArg = createArgReader(args);
const argSet = new Set(args);

if (argSet.has('--json')) {
    setDbLogger((level, msg) => {
        if (level === 'WARN' || level === 'ERROR' || level === 'FATAL') {
            process.stderr.write(`[db][${level}] ${msg}\n`);
        }
    });
}

if (argSet.has('--help') || argSet.has('-h')) {
    process.stdout.write(`Usage: node scripts/model-gateway/commands/model-gateway-auto-handoffs.mjs [--json] [--limit N]

Read persisted model-gateway SDK session handoffs. This command is read-only and does not call providers.
`);
    process.exit(0);
}


const limit = Math.max(1, Math.min(Number(readArg('--limit', '20')) || 20, 100));
const rows = await new SqliteModelGatewayCatalogStore().readSdkSessionHandoffRecords({ limit });
const summary = {
    schema: 'model-gateway-auto-handoffs',
    ok: true,
    limit,
    count: rows.length,
    rows,
};

if (argSet.has('--json')) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
} else {
    process.stdout.write(`model-gateway auto handoffs: count=${rows.length} limit=${limit}\n`);
    rows.forEach((row, index) => {
        process.stdout.write(
            `  ${index + 1}. status=${row['status'] ?? '-'} route=${row['selectedRouteKey'] ?? '-'} model=${row['targetModel'] ?? row['model'] ?? '-'} requested=${row['requestedAt'] ?? row['timestamp'] ?? '-'}\n`,
        );
    });
}
