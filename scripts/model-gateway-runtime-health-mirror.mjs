#!/usr/bin/env node
import { setDbLogger } from '../src/copilot/db/sqlite.js';
import { SqliteModelGatewayCatalogStore, mirrorByokProviderHealthToSqlite } from '../src/copilot/model-gateway/index.js';

const args = process.argv.slice(2);
const argSet = new Set(args);

if (argSet.has('--help') || argSet.has('-h')) {
    process.stdout.write(`Usage: node scripts/model-gateway-runtime-health-mirror.mjs [--json]

Mirror already-observed BYOK provider/model health into the model-gateway SQLite runtime layer.
This does not fetch providers, execute models, run probes or mutate canonical catalog metadata.
`);
    process.exit(0);
}

const json = argSet.has('--json');
if (json) {
    setDbLogger((level, msg) => {
        if (level === 'WARN' || level === 'ERROR' || level === 'FATAL') {
            process.stderr.write(`[db][${level}] ${msg}\n`);
        }
    });
}
const sqliteStore = new SqliteModelGatewayCatalogStore();
const result = await mirrorByokProviderHealthToSqlite({ sqliteStore });
const diagnostics = await sqliteStore.readStorageDiagnostics();
const summary = {
    schema: 'model-gateway-runtime-health-mirror',
    ok: true,
    runtimeExecuted: false,
    providerFetched: false,
    catalogMutated: false,
    ...result,
    sqlite: {
        runtimeRows: diagnostics.runtimeRows,
        tableCounts: {
            healthObservations: diagnostics.tableCounts.copilot_model_gateway_health_observations,
            runtimeProbeRuns: diagnostics.tableCounts.copilot_model_gateway_runtime_probe_runs,
            runtimeProbeResults: diagnostics.tableCounts.copilot_model_gateway_runtime_probe_results,
        },
    },
};

if (json) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
} else {
    process.stdout.write(
        `model-gateway runtime health mirror: records=${summary.records} observations=${summary.healthObservations} probes=${summary.probeResults} runtimeRows=${summary.sqlite.runtimeRows}\n`,
    );
    process.stdout.write(`run=${summary.runId}\n`);
}
