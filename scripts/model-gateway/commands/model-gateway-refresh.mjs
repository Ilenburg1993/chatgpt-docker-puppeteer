#!/usr/bin/env node
import { config as loadDotenv } from 'dotenv';
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import {
    createDefaultModelGatewayCatalogImporters,
    createEnvSecretRegistry,
    DEFAULT_MODEL_GATEWAY_CATALOG_PATH,
    JsonModelGatewayCatalogStore,
    mirrorModelGatewayCatalogSnapshotToSqlite,
    planModelGatewayCatalogRefresh,
    refreshModelGatewayCatalog,
    SqliteModelGatewayCatalogStore,
} from '../../../src/copilot/model-gateway/index.js';
import '../bootstrap-sqlite.mjs';

loadDotenv({ path: '.env.local', override: false, quiet: true });
loadDotenv({ path: '.env', override: false, quiet: true });

const args = process.argv.slice(2);
/** @param {string} name */
const hasFlag = (name) => args.includes(name);
/** @param {string} name */
const valuesFor = (name) =>
    args
        .filter((arg) => arg.startsWith(`${name}=`))
        .flatMap((arg) => arg.slice(name.length + 1).split(','))
        .map((value) => value.trim())
        .filter(Boolean);

const providers = new Set(
    [...valuesFor('--provider'), ...valuesFor('--providers')].map((value) => value.toLowerCase()),
);
const importerIds = new Set([...valuesFor('--importer'), ...valuesFor('--source')].map((value) => value.toLowerCase()));
const sourceIds = valuesFor('--source-id');
const preview = hasFlag('--preview');
const commit = hasFlag('--commit') || !preview;
const planOnly = hasFlag('--plan') || hasFlag('--dry-run');
const incremental = !hasFlag('--all');
const force = hasFlag('--force') || hasFlag('--all');
const json = hasFlag('--json');
const logPath = resolve(
    valuesFor('--log')[0] ?? `logs/model-gateway-refresh/${new Date().toISOString().replace(/[:.]/gu, '-')}.jsonl`,
);

if (hasFlag('--help') || hasFlag('-h')) {
    process.stdout.write(`Usage: node scripts/model-gateway/commands/model-gateway-refresh.mjs [options]

Refresh the model-gateway catalog without a full build.

Options:
  --provider=<id>       Refresh importers for one provider, e.g. openrouter.
  --providers=a,b       Refresh multiple providers.
  --importer=<id>       Refresh one importer id.
  --source=<id>         Alias for --importer.
  --source-id=<id>      Force a refresh-plan source id match.
  --plan, --dry-run     Print selected/skipped sources without fetching providers.
  --force               Ignore TTL for selected incremental sources.
  --all                 Run all selected importers instead of TTL incremental planning.
  --preview             Do not write the catalog snapshot.
  --commit              Write the catalog snapshot and its SQLite mirror (default unless --preview is used).
  --json                Emit only the final JSON summary on stdout.
  --log=<path>          Write full JSONL progress log to a custom path.

Examples:
  npm run model-gateway:refresh:preview -- --provider=openrouter --force
  npm run model-gateway:refresh -- --provider=openrouter --force
  make model-gateway-refresh-provider PROVIDER=openrouter ARGS=--force
`);
    process.exit(0);
}

mkdirSync(dirname(logPath), { recursive: true });

const allImporters = createDefaultModelGatewayCatalogImporters({ env: process.env });
const importers = allImporters.filter((importer) => {
    const providerMatches = providers.size === 0 || providers.has(importer.providerId.toLowerCase());
    const importerMatches = importerIds.size === 0 || importerIds.has(importer.id.toLowerCase());
    return providerMatches && importerMatches;
});

/**
 * @param {string} value
 * @returns {string}
 */
function label(value) {
    return value || '-';
}

/**
 * @param {Record<string, any>} event
 * @returns {string}
 */
function formatProgressLine(event) {
    const pct = typeof event['progressPct'] === 'number' ? `${String(event['progressPct']).padStart(3)}%` : ' --%';
    const elapsed = typeof event['elapsedMs'] === 'number' ? `${event['elapsedMs']}ms` : '-';
    const importer =
        event['importer'] && typeof event['importer'] === 'object'
            ? /** @type {Record<string, any>} */ (event['importer'])['importerId']
            : event['importerId'];
    const counts = [
        typeof event['selectedCount'] === 'number' ? `selected=${event['selectedCount']}` : '',
        typeof event['skippedCount'] === 'number' ? `skipped=${event['skippedCount']}` : '',
        typeof event['rowCount'] === 'number' ? `rows=${event['rowCount']}` : '',
        typeof event['evidenceCount'] === 'number' ? `evidence=${event['evidenceCount']}` : '',
        typeof event['projectionCount'] === 'number' ? `projections=${event['projectionCount']}` : '',
        typeof event['addedCount'] === 'number' ? `added=${event['addedCount']}` : '',
        typeof event['removedCount'] === 'number' ? `removed=${event['removedCount']}` : '',
        typeof event['changedCount'] === 'number' ? `changed=${event['changedCount']}` : '',
    ]
        .filter(Boolean)
        .join(' ');
    const failed = Array.isArray(event['errors']) && event['errors'].length > 0 ? ` error=${event['errors'][0]}` : '';
    return `[model-gateway:refresh] ${pct} ${event['phase']} importer=${label(String(importer ?? ''))} elapsed=${elapsed}${counts ? ` ${counts}` : ''}${failed}`;
}

/**
 * @param {Record<string, any>} event
 * @returns {void}
 */
function recordProgress(event) {
    const entry = { ts: new Date().toISOString(), schema: 'model-gateway-refresh-progress', ...event };
    appendFileSync(logPath, `${JSON.stringify(entry)}\n`, 'utf8');
    if (!json) process.stdout.write(`${formatProgressLine(entry)}\n`);
}

if (importers.length === 0) {
    const requestedProviders = providers.size > 0 ? [...providers].join(',') : '-';
    const requestedImporters = importerIds.size > 0 ? [...importerIds].join(',') : '-';
    const message = `No model-gateway importers matched provider=${requestedProviders} importer=${requestedImporters}`;
    recordProgress({ phase: 'refresh_failed_no_importers', elapsedMs: 0, progressPct: 100, errors: [message] });
    const failure = {
        schema: 'model-gateway-refresh-summary',
        ok: false,
        logPath,
        committed: false,
        error: message,
    };
    if (json) process.stdout.write(`${JSON.stringify(failure, null, 2)}\n`);
    else process.stderr.write(`${message}\nfull log: ${logPath}\n`);
    process.exit(2);
}

const store = new JsonModelGatewayCatalogStore({ filePath: DEFAULT_MODEL_GATEWAY_CATALOG_PATH });
if (planOnly) {
    const previous = await store.readSnapshot();
    const plan = planModelGatewayCatalogRefresh({
        importers,
        sources: previous.sources,
        force,
        ...(sourceIds.length > 0 ? { sourceIds } : {}),
    });
    const summary = {
        schema: 'model-gateway-refresh-plan',
        logPath,
        storePath: store.filePath,
        incremental: true,
        force,
        importers: importers.map((importer) => importer.id),
        selected: plan.selected,
        skipped: plan.skipped,
    };
    appendFileSync(logPath, `${JSON.stringify({ ts: new Date().toISOString(), ...summary })}\n`, 'utf8');
    if (json) {
        process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    } else {
        process.stdout.write(
            `model-gateway refresh plan: selected=${summary.selected.length} skipped=${summary.skipped.length}\n`,
        );
        for (const item of summary.selected) process.stdout.write(`  run ${item.sourceId}: ${item.reason}\n`);
        for (const item of summary.skipped.slice(0, 20))
            process.stdout.write(`  skip ${item.sourceId}: ${item.reason}\n`);
        process.stdout.write(`full log: ${summary.logPath}\n`);
    }
    process.exit(0);
}
const result = await refreshModelGatewayCatalog({
    store,
    importers,
    incremental,
    force,
    ...(sourceIds.length > 0 ? { sourceIds } : {}),
    refreshAccountOverlays: true,
    eligibility: {
        enabled: true,
        secretRegistry: createEnvSecretRegistry(),
        policy: {
            unknownAccessPolicy: 'allow_probe',
            policyProfile: 'refresh-default',
        },
    },
    writePolicy: commit ? 'commit' : 'preview',
    lockKey: store.filePath,
    retentionPolicy: {
        maxImportRuns: 500,
        maxRawPayloadRefs: 500,
        maxConflicts: 1000,
        maxModelEligibilityRuns: 200,
    },
    onProgress: recordProgress,
});
const mirror = commit
    ? await mirrorModelGatewayCatalogSnapshotToSqlite({
          sourceStore: store,
          sqliteStore: new SqliteModelGatewayCatalogStore(),
      })
    : null;

const summary = {
    schema: 'model-gateway-refresh-summary',
    logPath,
    storePath: store.filePath,
    committed: result.writePolicy.committed,
    incremental,
    force,
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
    sqlite: mirror
        ? {
              mirrored: true,
              parityOk: mirror.parity.ok,
              counts: mirror.sqliteCounts,
          }
        : { mirrored: false, parityOk: null, counts: null },
};
appendFileSync(logPath, `${JSON.stringify({ ts: new Date().toISOString(), ...summary })}\n`, 'utf8');

if (json) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
} else {
    process.stdout.write(
        `\nmodel-gateway refresh complete: committed=${summary.committed ? 'yes' : 'no'} projections=${summary.projections} openai=${summary.openai} added=${summary.diff.added} removed=${summary.diff.removed} changed=${summary.diff.changed}\n`,
    );
    process.stdout.write(`full log: ${summary.logPath}\n`);
}
if (mirror && !mirror.parity.ok) process.exitCode = 1;
