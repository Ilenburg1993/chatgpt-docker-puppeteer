#!/usr/bin/env node
import { setDbLogger } from '../../src/copilot/db/sqlite.js';
import {
    DEFAULT_MODEL_GATEWAY_SQLITE_OPERATIONAL_RETENTION,
    SqliteModelGatewayCatalogStore,
} from '../../src/copilot/model-gateway/index.js';

const args = process.argv.slice(2);
const hasFlag = (name) => args.includes(name);
const valueFor = (name) => {
    const prefix = `${name}=`;
    const found = args.find((arg) => arg.startsWith(prefix));
    return found ? found.slice(prefix.length).trim() : null;
};
const numberFor = (name, fallback) => {
    const raw = valueFor(name);
    if (raw === null) return fallback;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : fallback;
};

if (hasFlag('--json')) {
    setDbLogger((level, msg) => {
        if (level === 'WARN' || level === 'ERROR' || level === 'FATAL') {
            process.stderr.write(`[db][${level}] ${msg}\n`);
        }
    });
}

if (hasFlag('--help') || hasFlag('-h')) {
    process.stdout.write(`Usage: node scripts/model-gateway/model-gateway-sqlite-retention.mjs [options]

Apply operational SQLite retention for model-gateway account/key history, route decisions, refresh logs and runtime health.
By default this is a dry run. Pass --apply to delete rows beyond the configured limits.

Options:
  --apply                              Mutate SQLite by deleting rows beyond retention limits.
  --account-history-max-rows=<n>       Legacy fallback rows to keep per account history table.
  --account-quota-max-rows=<n>         Account quota snapshot rows to keep.
  --account-rate-limit-max-rows=<n>    Account rate-limit snapshot rows to keep.
  --account-spending-max-rows=<n>      Account spending snapshot rows to keep.
  --route-decision-max-rows=<n>        Route decision rows to keep.
  --refresh-log-max-rows=<n>           Refresh log rows to keep.
  --runtime-probe-run-max-rows=<n>     Runtime probe run rows to keep.
  --runtime-probe-result-max-rows=<n>  Runtime probe result rows to keep.
  --health-observation-max-rows=<n>    Runtime health observation rows to keep.
  --json                               Emit machine-readable JSON.

Examples:
  npm run model-gateway:sqlite:retention -- --json
  npm run model-gateway:sqlite:retention:apply -- --json
`);
    process.exit(0);
}

const policy = {
    ...(valueFor('--account-history-max-rows') === null
        ? {}
        : {
              accountHistoryMaxRowsPerTable: numberFor(
                  '--account-history-max-rows',
                  DEFAULT_MODEL_GATEWAY_SQLITE_OPERATIONAL_RETENTION.accountHistoryMaxRowsPerTable,
              ),
          }),
    accountQuotaSnapshotMaxRows: numberFor(
        '--account-quota-max-rows',
        DEFAULT_MODEL_GATEWAY_SQLITE_OPERATIONAL_RETENTION.accountQuotaSnapshotMaxRows,
    ),
    accountRateLimitSnapshotMaxRows: numberFor(
        '--account-rate-limit-max-rows',
        DEFAULT_MODEL_GATEWAY_SQLITE_OPERATIONAL_RETENTION.accountRateLimitSnapshotMaxRows,
    ),
    accountSpendingSnapshotMaxRows: numberFor(
        '--account-spending-max-rows',
        DEFAULT_MODEL_GATEWAY_SQLITE_OPERATIONAL_RETENTION.accountSpendingSnapshotMaxRows,
    ),
    routeDecisionMaxRows: numberFor(
        '--route-decision-max-rows',
        DEFAULT_MODEL_GATEWAY_SQLITE_OPERATIONAL_RETENTION.routeDecisionMaxRows,
    ),
    refreshLogMaxRows: numberFor('--refresh-log-max-rows', DEFAULT_MODEL_GATEWAY_SQLITE_OPERATIONAL_RETENTION.refreshLogMaxRows),
    runtimeProbeRunMaxRows: numberFor(
        '--runtime-probe-run-max-rows',
        DEFAULT_MODEL_GATEWAY_SQLITE_OPERATIONAL_RETENTION.runtimeProbeRunMaxRows,
    ),
    runtimeProbeResultMaxRows: numberFor(
        '--runtime-probe-result-max-rows',
        DEFAULT_MODEL_GATEWAY_SQLITE_OPERATIONAL_RETENTION.runtimeProbeResultMaxRows,
    ),
    healthObservationMaxRows: numberFor(
        '--health-observation-max-rows',
        DEFAULT_MODEL_GATEWAY_SQLITE_OPERATIONAL_RETENTION.healthObservationMaxRows,
    ),
};
const store = new SqliteModelGatewayCatalogStore();
const before = await store.readStorageDiagnostics();
const result = hasFlag('--apply') ? await store.applyOperationalRetention(policy) : null;
const after = hasFlag('--apply') ? await store.readStorageDiagnostics() : before;
const output = {
    schema: 'model-gateway-sqlite-retention',
    applied: hasFlag('--apply'),
    policy,
    before,
    after,
    result,
};

if (hasFlag('--json')) {
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
} else {
    process.stdout.write(`model-gateway SQLite operational retention\n`);
    process.stdout.write(`mode=${hasFlag('--apply') ? 'apply' : 'dry-run'}\n`);
    process.stdout.write(
        `policy: quota=${policy.accountQuotaSnapshotMaxRows} rateLimit=${policy.accountRateLimitSnapshotMaxRows} spending=${policy.accountSpendingSnapshotMaxRows} routeDecisionMaxRows=${policy.routeDecisionMaxRows} refreshLogMaxRows=${policy.refreshLogMaxRows} runtimeProbeRunMaxRows=${policy.runtimeProbeRunMaxRows} runtimeProbeResultMaxRows=${policy.runtimeProbeResultMaxRows} healthObservationMaxRows=${policy.healthObservationMaxRows}\n`,
    );
    process.stdout.write(
        `before: accountHistory=${before.accountHistoryRows} routeDecisions=${before.routeDecisionRows} refreshLogs=${before.refreshLogRows} runtime=${before.runtimeRows}\n`,
    );
    process.stdout.write(
        `after: accountHistory=${after.accountHistoryRows} routeDecisions=${after.routeDecisionRows} refreshLogs=${after.refreshLogRows} runtime=${after.runtimeRows}\n`,
    );
    if (result) process.stdout.write(`deleted=${result.deletedRows}\n`);
}
