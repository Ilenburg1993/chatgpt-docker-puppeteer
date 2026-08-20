#!/usr/bin/env node
import { setDbLogger } from '../../../src/copilot/db/sqlite.js';
import {
    DEFAULT_MODEL_GATEWAY_CATALOG_PATH,
    JsonModelGatewayCatalogStore,
    SqliteModelGatewayCatalogStore,
    auditModelGatewayValueRedaction,
    collectModelGatewaySecretAuditEnvValues,
    summarizeModelGatewayRedactionAudits,
} from '../../../src/copilot/model-gateway/index.js';

const args = new Set(process.argv.slice(2));
const json = args.has('--json');
const fail = args.has('--fail');
const repair = args.has('--repair');

if (json) {
    setDbLogger((level, msg) => {
        if (level === 'WARN' || level === 'ERROR' || level === 'FATAL') {
            process.stderr.write(`[db][${level}] ${msg}\n`);
        }
    });
}

if (args.has('--help') || args.has('-h')) {
    process.stdout
        .write(`Usage: node scripts/model-gateway/commands/model-gateway-redaction-audit.mjs [--json] [--fail] [--repair]

Audit persisted model-gateway JSON and SQLite payload surfaces for unredacted secret-looking strings.
Default mode does not fetch providers, run models, mutate stores or print raw secret values.
--repair rewrites only SQLite payload_json blobs by redacting exact env secrets and high-confidence token patterns.
`);
    process.exit(0);
}

const additionalSecrets = collectModelGatewaySecretAuditEnvValues(process.env);
const catalogStore = new JsonModelGatewayCatalogStore({ filePath: DEFAULT_MODEL_GATEWAY_CATALOG_PATH });
const catalogSnapshot = await catalogStore.readSnapshot();
const catalogAudit = auditModelGatewayValueRedaction(catalogSnapshot, {
    surface: 'json:catalog',
    rootPath: 'catalog',
    additionalSecrets,
    maxSamples: 20,
});

const sqliteStore = new SqliteModelGatewayCatalogStore();
let sqliteRepair = null;
if (repair) {
    sqliteRepair = await sqliteStore.redactStoredPayloadLeaks({
        additionalSecrets,
    });
}

/**
 * @type {Awaited<ReturnType<SqliteModelGatewayCatalogStore['auditStoredPayloadRedaction']>>
 *     | {
 *           schema: string;
 *           ok: boolean;
 *           tableCount: number;
 *           leakCount: number;
 *           scannedStringCount: number;
 *           sampleCount: number;
 *           error: string;
 *           tables: Record<string, { samples: { path: string; redactedSnippet: string }[] }>;
 *       }}
 */
let sqliteAudit;
try {
    sqliteAudit = await sqliteStore.auditStoredPayloadRedaction({
        additionalSecrets,
        maxSamples: 20,
    });
} catch (error) {
    sqliteAudit = {
        schema: 'model-gateway-sqlite-redaction-audit',
        ok: false,
        tableCount: 0,
        leakCount: 1,
        scannedStringCount: 0,
        sampleCount: 1,
        error: error instanceof Error ? error.message : String(error),
        tables: {},
    };
}

const summary = summarizeModelGatewayRedactionAudits([catalogAudit, sqliteAudit]);
const report = {
    schema: 'model-gateway-redaction-audit',
    ok: summary.ok,
    envSecretCandidateCount: additionalSecrets.length,
    leakCount: summary.leakCount,
    scannedStringCount: summary.scannedStringCount,
    sampleCount: summary.sampleCount,
    surfaces: {
        catalog: {
            storePath: catalogStore.filePath,
            snapshotId: catalogSnapshot.snapshotId,
            generatedAt: catalogSnapshot.generatedAt,
            ok: catalogAudit.ok,
            leakCount: catalogAudit.leakCount,
            scannedStringCount: catalogAudit.scannedStringCount,
            sampleCount: catalogAudit.sampleCount,
            samples: catalogAudit.samples,
        },
        sqlite: sqliteAudit,
    },
    repair: sqliteRepair,
};

if (json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} else {
    process.stdout.write(
        `model-gateway redaction audit: ok=${report.ok ? 'yes' : 'no'} leaks=${report.leakCount} scannedStrings=${report.scannedStringCount} envSecrets=${report.envSecretCandidateCount}\n`,
    );
    process.stdout.write(
        `  catalog: ok=${report.surfaces.catalog.ok ? 'yes' : 'no'} leaks=${report.surfaces.catalog.leakCount} path=${report.surfaces.catalog.storePath}\n`,
    );
    process.stdout.write(
        `  sqlite: ok=${report.surfaces.sqlite.ok ? 'yes' : 'no'} leaks=${report.surfaces.sqlite.leakCount} tables=${report.surfaces.sqlite.tableCount}\n`,
    );
    for (const sample of [
        ...report.surfaces.catalog.samples,
        ...Object.values(report.surfaces.sqlite.tables).flatMap((table) => table.samples),
    ].slice(0, 12)) {
        process.stdout.write(`  leak ${sample.path}: ${sample.redactedSnippet}\n`);
    }
}

if (fail && !report.ok) process.exit(1);
