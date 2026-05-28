#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    SqliteModelGatewayCatalogStore,
    comparableModelGatewayRuntimeHealthRecord,
    diffModelGatewayRuntimeHealthSnapshots,
    listByokProviderModelHealth,
    mergeByokProviderHealthRecords,
    summarizeModelGatewayRuntimeHealthRecords,
} from '../src/copilot/model-gateway/index.js';
import { setDbLogger } from '../src/copilot/db/sqlite.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_OUT_DIR = path.join(ROOT, 'artifacts/model-gateway-runtime-health');
const args = process.argv.slice(2);
const argSet = new Set(args);

if (argSet.has('--help') || argSet.has('-h')) {
    process.stdout.write(`Usage: node scripts/model-gateway-runtime-health-diff.mjs [--json] [--baseline FILE] [--write-snapshot] [--out-dir DIR] [--fail-on-regression]

Read already-observed BYOK runtime health from the file ledger and SQLite mirror, optionally persist a snapshot, and
diff it against a previous snapshot. This never calls providers and never runs probes.
`);
    process.exit(0);
}

function readArg(name, fallback = '') {
    const prefix = `${name}=`;
    for (let index = 0; index < args.length; index += 1) {
        const arg = args[index];
        if (arg.startsWith(prefix)) return arg.slice(prefix.length);
        if (arg === name) return args[index + 1] ?? fallback;
    }
    return fallback;
}

function nowStamp() {
    return new Date().toISOString().replace(/[:.]/gu, '-');
}

async function readBaseline(filePath) {
    if (!filePath) return null;
    const parsed = JSON.parse(await readFile(filePath, 'utf8'));
    return Array.isArray(parsed.records) ? parsed.records.map(comparableModelGatewayRuntimeHealthRecord) : [];
}

async function readCurrentHealth() {
    const fileRecords = listByokProviderModelHealth();
    let sqliteRecords = [];
    let sqliteRuntimeError = null;
    try {
        sqliteRecords = await new SqliteModelGatewayCatalogStore().listLatestRuntimeHealthRecords();
    } catch (error) {
        sqliteRuntimeError = error instanceof Error ? error.message : String(error);
    }
    const records = mergeByokProviderHealthRecords(fileRecords, sqliteRecords)
        .map(comparableModelGatewayRuntimeHealthRecord)
        .sort((left, right) => right.observedAt - left.observedAt || left.key.localeCompare(right.key));
    return { records, fileRecords: fileRecords.length, sqliteRecords: sqliteRecords.length, sqliteRuntimeError };
}

async function writeJsonPayload(payload, filePath, latestPath) {
    const serialized = `${JSON.stringify(payload, null, 2)}\n`;
    await writeFile(filePath, serialized, 'utf8');
    await writeFile(latestPath, serialized, 'utf8');
}

async function writeSnapshot(snapshot, outDir, stamp) {
    await mkdir(outDir, { recursive: true });
    const filePath = path.join(outDir, `${stamp}.json`);
    const latestPath = path.join(outDir, 'latest.json');
    await writeJsonPayload(snapshot, filePath, latestPath);
    return { filePath, latestPath };
}

async function writeDiffReport(report, outDir, stamp) {
    await mkdir(outDir, { recursive: true });
    const filePath = path.join(outDir, `${stamp}-diff.json`);
    const latestPath = path.join(outDir, 'latest-diff.json');
    await writeJsonPayload(report, filePath, latestPath);
    return { filePath, latestPath };
}

const json = argSet.has('--json');
const baselinePath = readArg('--baseline');
const outDir = readArg('--out-dir', DEFAULT_OUT_DIR);
const write = argSet.has('--write-snapshot') || argSet.has('--write');
const failOnRegression = argSet.has('--fail-on-regression');

if (json) {
    setDbLogger((level, message) => {
        if (level === 'WARN' || level === 'ERROR' || level === 'FATAL') {
            process.stderr.write(`[db][${level}] ${message}\n`);
        }
    });
}

const current = await readCurrentHealth();
const baseline = await readBaseline(baselinePath);
const snapshot = {
    schema: 'model-gateway-runtime-health-snapshot',
    generatedAt: new Date().toISOString(),
    runtimeExecuted: false,
    source: {
        fileRecords: current.fileRecords,
        sqliteRecords: current.sqliteRecords,
        sqliteRuntimeError: current.sqliteRuntimeError,
    },
    summary: summarizeModelGatewayRuntimeHealthRecords(current.records),
    records: current.records,
};
const diff = baseline
    ? diffModelGatewayRuntimeHealthSnapshots(baseline, current.records)
    : {
          added: [],
          removed: [],
          changed: [],
          regressions: [],
          newFailures: [],
          becameFailed: [],
          recovered: [],
          summary: { added: 0, removed: 0, changed: 0, regressions: 0, newFailures: 0, becameFailed: 0, recovered: 0 },
      };
const stamp = nowStamp();
const persistence = write ? await writeSnapshot(snapshot, outDir, stamp) : { filePath: null, latestPath: null };
const reportPersistence = write
    ? {
          filePath: path.join(outDir, `${stamp}-diff.json`),
          latestPath: path.join(outDir, 'latest-diff.json'),
      }
    : { filePath: null, latestPath: null };
const summary = {
    schema: 'model-gateway-runtime-health-diff',
    ok: !failOnRegression || diff.summary.regressions === 0,
    generatedAt: snapshot.generatedAt,
    runtimeExecuted: false,
    baselinePath: baselinePath || null,
    snapshotWritten: write,
    snapshotPath: persistence.filePath,
    latestPath: persistence.latestPath,
    reportWritten: write,
    reportPath: reportPersistence.filePath,
    latestReportPath: reportPersistence.latestPath,
    current: snapshot,
    diff,
};
if (write) await writeDiffReport(summary, outDir, stamp);

if (json) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
} else {
    process.stdout.write(
        `model-gateway runtime health diff: ok=${summary.ok ? 'yes' : 'no'} records=${snapshot.summary.total} baseline=${baselinePath || '-'}\n`,
    );
    process.stdout.write(
        `source: file=${current.fileRecords} sqlite=${current.sqliteRecords} sqliteError=${current.sqliteRuntimeError ?? '-'}\n`,
    );
    process.stdout.write(
        `diff: added=${diff.summary.added} removed=${diff.summary.removed} changed=${diff.summary.changed} regressions=${diff.summary.regressions} newFailures=${diff.summary.newFailures} becameFailed=${diff.summary.becameFailed} recovered=${diff.summary.recovered}\n`,
    );
    if (write) {
        process.stdout.write(`snapshot: ${persistence.filePath} latest=${persistence.latestPath}\n`);
        process.stdout.write(`diff-report: ${reportPersistence.filePath} latest=${reportPersistence.latestPath}\n`);
    }
}

if (failOnRegression && diff.summary.regressions > 0) process.exit(1);
