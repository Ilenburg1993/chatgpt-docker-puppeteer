#!/usr/bin/env node
import { setDbLogger } from '../../src/copilot/db/sqlite.js';
import { SqliteModelGatewayCatalogStore } from '../../src/copilot/model-gateway/index.js';

const args = new Set(process.argv.slice(2));
if (args.has('--json')) {
    setDbLogger((level, msg) => {
        if (level === 'WARN' || level === 'ERROR' || level === 'FATAL') {
            process.stderr.write(`[db][${level}] ${msg}\n`);
        }
    });
}

if (args.has('--help') || args.has('-h')) {
    process.stdout.write(`Usage: node scripts/model-gateway/model-gateway-sqlite-diagnostics.mjs [--json]

Inspect the current model-gateway SQLite store without mirroring JSON, fetching providers or running models.
`);
    process.exit(0);
}

const diagnostics = await new SqliteModelGatewayCatalogStore().readStorageDiagnostics();

if (args.has('--json')) {
    process.stdout.write(`${JSON.stringify({ schema: 'model-gateway-sqlite-diagnostics', ...diagnostics }, null, 2)}\n`);
} else {
    process.stdout.write(`model-gateway SQLite diagnostics\n`);
    process.stdout.write(
        `schema=${diagnostics.schemaVersion} userVersion=${diagnostics.userVersion} active=${diagnostics.activeSnapshot.exists ? 'yes' : 'no'} source=${diagnostics.activeSnapshot.source ?? '-'}\n`,
    );
    process.stdout.write(
        `rows: catalog=${diagnostics.catalogRows} accountHistory=${diagnostics.accountHistoryRows} runtime=${diagnostics.runtimeRows} routeDecisions=${diagnostics.routeDecisionRows} automationDecisions=${diagnostics.automationDecisionRows} policySnapshots=${diagnostics.automationPolicySnapshotRows} sdkConfirmations=${diagnostics.sdkSessionConfirmationRows}\n`,
    );
    process.stdout.write(
        `automation: latestAction=${diagnostics.latestAutomationDecision.action ?? '-'} latestStatus=${diagnostics.latestAutomationDecision.status ?? '-'} latestRoute=${diagnostics.latestAutomationDecision.selectedRouteKey ?? '-'}\n`,
    );
    process.stdout.write(
        `runtime: probeRuns=${diagnostics.runtime.probeRuns} probeResults=${diagnostics.runtime.probeResults} health=${diagnostics.runtime.healthObservations} latestHealth=${diagnostics.runtime.latestHealthObservedAtMs ?? '-'} latestProbe=${diagnostics.runtime.latestProbeResultObservedAtMs ?? '-'}\n`,
    );
    for (const [table, count] of Object.entries(diagnostics.tableCounts)) {
        process.stdout.write(`  ${table}: ${count}\n`);
    }
}
