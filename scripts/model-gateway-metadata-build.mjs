#!/usr/bin/env node
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { setDbLogger } from '../src/copilot/db/sqlite.js';
import {
    createDefaultModelGatewayCatalogImporters,
    createEnvSecretRegistry,
    DEFAULT_MODEL_GATEWAY_CATALOG_PATH,
    JsonModelGatewayCatalogStore,
    auditModelGatewayCatalogSnapshotIntegrity,
    classifyModelGatewayCatalogImporterFailure,
    mirrorModelGatewayCatalogSnapshotToSqlite,
    planModelGatewayCatalogRefresh,
    refreshModelGatewayCatalog,
    SqliteModelGatewayCatalogStore,
} from '../src/copilot/model-gateway/index.js';

loadDotenv({ path: '.env.local', override: false, quiet: true });
loadDotenv({ path: '.env', override: false, quiet: true });

const args = process.argv.slice(2);
const hasFlag = (name) => args.includes(name);
const valuesFor = (name) => args
    .filter((arg) => arg.startsWith(`${name}=`))
    .flatMap((arg) => arg.slice(name.length + 1).split(','))
    .map((value) => value.trim())
    .filter(Boolean);
const numberFor = (name, fallback) => {
    const value = valuesFor(name)[0];
    if (!value) return fallback;
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(0, Math.floor(number)) : fallback;
};

const json = hasFlag('--json');
if (json) {
    setDbLogger((level, msg) => {
        if (level === 'WARN' || level === 'ERROR' || level === 'FATAL') {
            process.stderr.write(`[db][${level}] ${msg}\n`);
        }
    });
}

if (hasFlag('--help') || hasFlag('-h')) {
    process.stdout.write(`Usage: node scripts/model-gateway-metadata-build.mjs [options]

Build/materialize the model-gateway metadata database. This is not the application/dist build.

The default path is a full metadata build: refresh all configured catalog importers, commit the JSON
catalog snapshot, mirror it into SQLite, replay the refresh JSONL into SQLite and apply operational retention.

Options:
  --plan, --dry-run             Plan selected importers without fetching providers or writing stores.
  --preview                     Run the refresh without committing JSON or SQLite.
  --commit                      Commit JSON and mirror to SQLite (default unless --preview is used).
  --incremental                 Use TTL/source planning instead of full all-importer metadata build.
  --all                         Full all-importer metadata build (default).
  --force                       Ignore TTL for selected incremental sources.
  --provider=<id>               Limit build to one provider.
  --providers=a,b               Limit build to multiple providers.
  --importer=<id>               Limit build to one importer id.
  --source=<id>                 Alias for --importer.
  --source-id=<id>              Force a refresh-plan source id match.
  --skip-refresh-log-sqlite     Do not replay JSONL progress into SQLite.
  --skip-retention              Do not apply SQLite operational retention.
  --allow-importer-failures     Return ok=true when SQLite parity passes even if some importers failed.
  --fail-on-account-importer-failures
                                Treat configured account/key importer failures as build-blocking.
  --fail-on-local-importer-failures
                                Treat configured local daemon failures as build-blocking.
  --account-history-max-rows=<n> SQLite account/key history rows to keep per table.
  --route-decision-max-rows=<n> SQLite route decision rows to keep.
  --refresh-log-max-rows=<n>    SQLite refresh log rows to keep.
  --log=<path>                  Write full JSONL progress log to a custom path.
  --json                        Emit only the final JSON summary on stdout.

Examples:
  npm run model-gateway:metadata:build:plan
  npm run model-gateway:metadata:build:preview
  npm run model-gateway:metadata:build
  make model-gateway-build
`);
    process.exit(0);
}

const providers = new Set([...valuesFor('--provider'), ...valuesFor('--providers')].map((value) => value.toLowerCase()));
const importerIds = new Set([...valuesFor('--importer'), ...valuesFor('--source')].map((value) => value.toLowerCase()));
const sourceIds = valuesFor('--source-id');
const preview = hasFlag('--preview');
const commit = hasFlag('--commit') || !preview;
const planOnly = hasFlag('--plan') || hasFlag('--dry-run');
const incremental = hasFlag('--incremental') && !hasFlag('--all');
const force = hasFlag('--force') || !incremental;
const logPath = resolve(valuesFor('--log')[0] ?? `logs/model-gateway-metadata-build/${new Date().toISOString().replace(/[:.]/gu, '-')}.jsonl`);
mkdirSync(dirname(logPath), { recursive: true });

const allImporters = createDefaultModelGatewayCatalogImporters({ env: process.env });
const importers = allImporters.filter((importer) => {
    const providerMatches = providers.size === 0 || providers.has(importer.providerId.toLowerCase());
    const importerMatches = importerIds.size === 0 || importerIds.has(importer.id.toLowerCase());
    return providerMatches && importerMatches;
});
const importerById = new Map(importers.map((importer) => [importer.id, importer]));
/** @type {Record<string, any>[]} */
const progressEvents = [];

/**
 * @param {Record<string, any>} event
 * @returns {void}
 */
function recordProgress(event) {
    const entry = { ts: new Date().toISOString(), schema: 'model-gateway-metadata-build-progress', ...event };
    progressEvents.push(entry);
    appendFileSync(logPath, `${JSON.stringify(entry)}\n`, 'utf8');
    if (!json) {
        const pct = typeof entry['progressPct'] === 'number' ? `${String(entry['progressPct']).padStart(3)}%` : ' --%';
        const importer = entry['importer'] && typeof entry['importer'] === 'object' ? entry['importer']['importerId'] : entry['importerId'];
        const elapsed = typeof entry['elapsedMs'] === 'number' ? `${entry['elapsedMs']}ms` : '-';
        process.stdout.write(`[model-gateway:metadata-build] ${pct} ${entry['phase']} importer=${importer ?? '-'} elapsed=${elapsed}\n`);
    }
}

if (importers.length === 0) {
    const requestedProviders = providers.size > 0 ? [...providers].join(',') : '-';
    const requestedImporters = importerIds.size > 0 ? [...importerIds].join(',') : '-';
    const failure = {
        schema: 'model-gateway-metadata-build-summary',
        ok: false,
        committed: false,
        logPath,
        error: `No model-gateway importers matched provider=${requestedProviders} importer=${requestedImporters}`,
    };
    appendFileSync(logPath, `${JSON.stringify({ ts: new Date().toISOString(), ...failure })}\n`, 'utf8');
    if (json) process.stdout.write(`${JSON.stringify(failure, null, 2)}\n`);
    else process.stderr.write(`${failure.error}\nfull log: ${logPath}\n`);
    process.exit(2);
}

const jsonStore = new JsonModelGatewayCatalogStore({ filePath: DEFAULT_MODEL_GATEWAY_CATALOG_PATH });

if (planOnly) {
    const previous = await jsonStore.readSnapshot();
    const plan = planModelGatewayCatalogRefresh({
        importers,
        sources: previous.sources,
        force,
        sourceIds: sourceIds.length > 0 ? sourceIds : undefined,
    });
    const summary = {
        schema: 'model-gateway-metadata-build-plan',
        ok: true,
        logPath,
        storePath: jsonStore.filePath,
        mode: incremental ? 'incremental' : 'full',
        force,
        selected: plan.selected,
        skipped: plan.skipped,
        importers: importers.map((importer) => importer.id),
    };
    appendFileSync(logPath, `${JSON.stringify({ ts: new Date().toISOString(), ...summary })}\n`, 'utf8');
    if (json) {
        process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    } else {
        process.stdout.write(`model-gateway metadata build plan: selected=${summary.selected.length} skipped=${summary.skipped.length}\n`);
        for (const item of summary.selected) process.stdout.write(`  run ${item.sourceId}: ${item.reason}\n`);
        for (const item of summary.skipped.slice(0, 20)) process.stdout.write(`  skip ${item.sourceId}: ${item.reason}\n`);
        process.stdout.write(`full log: ${summary.logPath}\n`);
    }
    process.exit(0);
}

const result = await refreshModelGatewayCatalog({
    store: jsonStore,
    importers,
    incremental,
    force,
    sourceIds: sourceIds.length > 0 ? sourceIds : undefined,
    refreshAccountOverlays: true,
    eligibility: {
        enabled: true,
        secretRegistry: createEnvSecretRegistry(),
        policy: {
            unknownAccessPolicy: 'allow_probe',
            policyProfile: 'build-default',
        },
    },
    writePolicy: commit ? 'commit' : 'preview',
    lockKey: jsonStore.filePath,
    retentionPolicy: {
        maxImportRuns: 1_000,
        maxRawPayloadRefs: 1_000,
        maxConflicts: 2_000,
        maxModelEligibilityRuns: 500,
    },
    onProgress: recordProgress,
});
const integrity = auditModelGatewayCatalogSnapshotIntegrity(result.snapshot);

/** @type {Awaited<ReturnType<typeof mirrorModelGatewayCatalogSnapshotToSqlite>> | null} */
let mirrored = null;
/** @type {Awaited<ReturnType<SqliteModelGatewayCatalogStore['writeRefreshLogText']>> | null} */
let refreshLogSqlite = null;
/** @type {Awaited<ReturnType<SqliteModelGatewayCatalogStore['applyOperationalRetention']>> | null} */
let sqliteRetention = null;
/** @type {Awaited<ReturnType<SqliteModelGatewayCatalogStore['readStorageDiagnostics']>> | null} */
let sqliteDiagnostics = null;

if (result.writePolicy.committed) {
    const sqliteStore = new SqliteModelGatewayCatalogStore();
    mirrored = await mirrorModelGatewayCatalogSnapshotToSqlite({
        sourceStore: jsonStore,
        sqliteStore,
    });
    if (!hasFlag('--skip-refresh-log-sqlite')) {
        refreshLogSqlite = await sqliteStore.writeRefreshLogText(readFileSync(logPath, 'utf8'), {
            logPath,
            runId: logPath,
        });
    }
    if (!hasFlag('--skip-retention')) {
        sqliteRetention = await sqliteStore.applyOperationalRetention({
            accountHistoryMaxRowsPerTable: numberFor('--account-history-max-rows', 10_000),
            routeDecisionMaxRows: numberFor('--route-decision-max-rows', 50_000),
            refreshLogMaxRows: numberFor('--refresh-log-max-rows', 200_000),
        });
    }
    sqliteDiagnostics = await sqliteStore.readStorageDiagnostics();
}

const importerFailures = progressEvents
    .filter((event) => event['phase'] === 'importer:importer_failed')
    .map((event) => ({
        importerId: String(event['importer'] && typeof event['importer'] === 'object' ? event['importer']['importerId'] : event['importerId']),
        providerId: String(event['providerId'] ?? ''),
        sourceId: String(event['sourceId'] ?? ''),
        sourceKind: String(event['sourceKind'] ?? ''),
        errors: Array.isArray(event['errors']) ? event['errors'] : [],
    }))
    .map((failure) => {
        const importer = importerById.get(failure.importerId);
        return classifyModelGatewayCatalogImporterFailure(
            {
                ...failure,
                providerId: failure.providerId || importer?.providerId,
                sourceKind: failure.sourceKind || importer?.sourceKind,
                requiresAuth: importer?.requiresAuth,
            },
            {
                allowAllImporterFailures: hasFlag('--allow-importer-failures'),
                failOnAccountImporterFailures: hasFlag('--fail-on-account-importer-failures'),
                failOnLocalImporterFailures: hasFlag('--fail-on-local-importer-failures'),
            },
        );
    });
const importerFailuresAllowed = hasFlag('--allow-importer-failures');
const blockingImporterFailures = importerFailures.filter((failure) => failure.buildBlocking);
const nonBlockingImporterFailures = importerFailures.filter((failure) => !failure.buildBlocking);
const accountImporterFailures = importerFailures.filter((failure) => failure.disposition === 'account_state_unavailable');
const optionalImporterFailures = importerFailures.filter((failure) => failure.disposition === 'optional_local_source_unavailable');
const sqliteParityOk = result.writePolicy.committed ? Boolean(mirrored?.parity.ok) : true;
const summary = {
    schema: 'model-gateway-metadata-build-summary',
    ok: sqliteParityOk && integrity.ok && blockingImporterFailures.length === 0,
    logPath,
    storePath: jsonStore.filePath,
    mode: incremental ? 'incremental' : 'full',
    committed: result.writePolicy.committed,
    importerFailuresAllowed,
    importerFailures,
    blockingImporterFailures,
    nonBlockingImporterFailures,
    accountImporterFailures,
    optionalImporterFailures,
    integrity,
    importers: importers.map((importer) => importer.id),
    selected: result.refreshPlan?.selected.map((item) => item.sourceId) ?? importers.map((importer) => importer.id),
    skipped: result.refreshPlan?.skipped.map((item) => item.sourceId) ?? [],
    projections: result.snapshot.projections.length,
    openai: result.openai.data.length,
    overlays: result.overlayRefresh.total,
    eligibility: result.eligibilityRefresh,
    diff: {
        added: result.diff.added.length,
        removed: result.diff.removed.length,
        changed: result.diff.changed.length,
    },
    sqlite: mirrored
        ? {
              parity: mirrored.parity,
              diagnostics: sqliteDiagnostics,
              refreshLogEvents: refreshLogSqlite?.refreshLogEvents ?? null,
              retention: sqliteRetention,
          }
        : null,
};
appendFileSync(logPath, `${JSON.stringify({ ts: new Date().toISOString(), ...summary })}\n`, 'utf8');

if (json) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
} else {
    process.stdout.write(
        `\nmodel-gateway metadata build complete: committed=${summary.committed ? 'yes' : 'no'} parity=${summary.sqlite?.parity.ok ?? '-'} projections=${summary.projections} openai=${summary.openai} overlays=${summary.overlays}\n`,
    );
    process.stdout.write(`full log: ${summary.logPath}\n`);
}

if (!summary.ok) process.exit(1);
