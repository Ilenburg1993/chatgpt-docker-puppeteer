#!/usr/bin/env node
import { readdir, readFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { setDbLogger } from '../../../src/copilot/db/sqlite.js';
import { SqliteModelGatewayCatalogStore, summarizeModelGatewayRefreshLogText } from '../../../src/copilot/model-gateway/index.js';

const args = process.argv.slice(2);
const hasFlag = (name) => args.includes(name);
const valueFor = (name) => {
    const prefix = `${name}=`;
    const found = args.find((arg) => arg.startsWith(prefix));
    return found ? found.slice(prefix.length).trim() : null;
};
if (hasFlag('--json')) {
    setDbLogger((level, msg) => {
        if (level === 'WARN' || level === 'ERROR' || level === 'FATAL') {
            process.stderr.write(`[db][${level}] ${msg}\n`);
        }
    });
}

if (hasFlag('--help') || hasFlag('-h')) {
    process.stdout.write(`Usage: node scripts/model-gateway/commands/model-gateway-refresh-log.mjs [options]

Summarize a model-gateway refresh JSONL log without touching the catalog.

Options:
  --log=<path>          Read an explicit JSONL log.
  --dir=<path>          Directory for --latest lookup (default logs/model-gateway-refresh).
  --latest             Read the newest JSONL log in the directory (default).
  --sqlite              Mirror the parsed log events into the operational SQLite store.
  --run-id=<id>         Optional stable run id for --sqlite (default: log path).
  --json               Emit machine-readable JSON.

Examples:
  npm run model-gateway:refresh:log
  npm run model-gateway:refresh:log -- --json
  npm run model-gateway:refresh:log:sqlite -- --json
  npm run model-gateway:refresh:log -- --log=logs/model-gateway-refresh/run.jsonl
`);
    process.exit(0);
}

/**
 * @param {string} dirPath
 * @returns {Promise<string | null>}
 */
async function findLatestLog(dirPath) {
    let entries;
    try {
        entries = await readdir(dirPath);
    } catch {
        return null;
    }
    const candidates = [];
    for (const entry of entries.filter((item) => item.endsWith('.jsonl'))) {
        const filePath = join(dirPath, entry);
        try {
            const metadata = await stat(filePath);
            if (metadata.isFile()) candidates.push({ filePath, mtimeMs: metadata.mtimeMs });
        } catch {
            // Ignore entries that disappeared during lookup.
        }
    }
    candidates.sort((left, right) => right.mtimeMs - left.mtimeMs);
    return candidates[0]?.filePath ?? null;
}

const logPath = valueFor('--log')
    ? resolve(/** @type {string} */ (valueFor('--log')))
    : await findLatestLog(resolve(valueFor('--dir') ?? 'logs/model-gateway-refresh'));

if (!logPath) {
    const failure = {
        schema: 'model-gateway-refresh-log-summary',
        ok: false,
        error: 'No model-gateway refresh JSONL log found.',
    };
    if (hasFlag('--json')) process.stdout.write(`${JSON.stringify(failure, null, 2)}\n`);
    else process.stderr.write(`${failure.error}\nRun npm run model-gateway:refresh first, or pass --log=<path>.\n`);
    process.exit(2);
}

const text = await readFile(logPath, 'utf8');
const summary = summarizeModelGatewayRefreshLogText(text, { logPath });
const sqlite = hasFlag('--sqlite')
    ? await new SqliteModelGatewayCatalogStore().writeRefreshLogText(text, {
          logPath,
          runId: valueFor('--run-id') ?? logPath,
      })
    : null;
const output = { ok: summary.failures.length === 0, ...summary, ...(sqlite ? { sqlite } : {}) };

if (hasFlag('--json')) {
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
} else {
    process.stdout.write(`model-gateway refresh log: ${logPath}\n`);
    process.stdout.write(
        `events=${summary.eventCount} invalid=${summary.invalidLineCount} completed=${summary.completed ? 'yes' : 'no'} committed=${summary.committed ? 'yes' : 'no'} elapsed=${summary.elapsedMs ?? '-'}ms\n`,
    );
    process.stdout.write(
        `totals: projections=${summary.totals.projections ?? '-'} openai=${summary.totals.openai ?? '-'} overlays=${summary.totals.overlays ?? '-'} added=${summary.totals.added ?? '-'} removed=${summary.totals.removed ?? '-'} changed=${summary.totals.changed ?? '-'}\n`,
    );
    const importerEntries = Object.entries(summary.importers);
    process.stdout.write(`importers=${importerEntries.length} failures=${summary.failures.length}\n`);
    for (const [importerId, importer] of importerEntries.slice(0, 20)) {
        process.stdout.write(
            `  ${importerId}: started=${importer.started} completed=${importer.completed} failed=${importer.failed} rows=${importer.rowCount} evidence=${importer.evidenceCount}\n`,
        );
    }
    for (const failure of summary.failures.slice(0, 10)) {
        process.stdout.write(`  failure ${failure.phase} importer=${failure.importerId ?? '-'} error=${failure.errors.join('; ')}\n`);
    }
    if (sqlite) {
        process.stdout.write(`sqlite: mirrored=${sqlite.refreshLogEvents} runId=${sqlite.runId}\n`);
    }
}
