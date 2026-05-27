#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    SqliteModelGatewayCatalogStore,
    byokProviderHealthRecordKey,
    byokProviderHealthRecordLastObservedAt,
    listByokProviderModelHealth,
    mergeByokProviderHealthRecords,
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

function optionalString(value) {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function statusOf(record) {
    return optionalString(record['lastStatus']) ?? optionalString(record['agentProbeStatus']) ?? 'unknown';
}

function failureKindOf(record) {
    return optionalString(record['lastFailureKind']) ?? optionalString(record['lastErrorContext']) ?? null;
}

function comparableRecord(record) {
    return {
        key: byokProviderHealthRecordKey(record) ?? optionalString(record['key']) ?? 'unknown',
        routeProfile: optionalString(record['routeProfile']) ?? optionalString(record['profile']),
        providerId: optionalString(record['providerId']) ?? optionalString(record['provider']),
        providerModel: optionalString(record['providerModel']) ?? optionalString(record['model']),
        lastStatus: optionalString(record['lastStatus']),
        failureKind: failureKindOf(record),
        lastFailureStatusCode: typeof record['lastFailureStatusCode'] === 'number' ? record['lastFailureStatusCode'] : null,
        lastRetryAfterSeconds: typeof record['lastRetryAfterSeconds'] === 'number' ? record['lastRetryAfterSeconds'] : null,
        lastResetAt: optionalString(record['lastResetAt']),
        agentProbeStatus: optionalString(record['agentProbeStatus']),
        observedAt: byokProviderHealthRecordLastObservedAt(record),
        status: statusOf(record),
    };
}

function summarize(records) {
    const byProvider = {};
    const byStatus = {};
    const byFailureKind = {};
    for (const record of records) {
        const providerId = record.providerId ?? 'unknown';
        const status = record.status ?? 'unknown';
        const failureKind = record.failureKind ?? 'none';
        byProvider[providerId] = (byProvider[providerId] ?? 0) + 1;
        byStatus[status] = (byStatus[status] ?? 0) + 1;
        byFailureKind[failureKind] = (byFailureKind[failureKind] ?? 0) + 1;
    }
    return {
        total: records.length,
        byProvider,
        byStatus,
        byFailureKind,
    };
}

function mapByKey(records) {
    return new Map(records.map((record) => [record.key, record]));
}

function diffSnapshots(beforeRecords, afterRecords) {
    const before = mapByKey(beforeRecords);
    const after = mapByKey(afterRecords);
    const added = [];
    const removed = [];
    const changed = [];
    for (const [key, record] of after) {
        const previous = before.get(key);
        if (!previous) {
            added.push(record);
            continue;
        }
        const fields = ['status', 'failureKind', 'lastFailureStatusCode', 'lastRetryAfterSeconds', 'lastResetAt', 'agentProbeStatus'];
        const changedFields = fields.filter((field) => previous[field] !== record[field]);
        if (changedFields.length > 0) changed.push({ key, before: previous, after: record, changedFields });
    }
    for (const [key, record] of before) {
        if (!after.has(key)) removed.push(record);
    }
    const regressions = changed.filter((item) => item.before.status === 'ok' && item.after.status === 'failed');
    return {
        added,
        removed,
        changed,
        regressions,
        summary: {
            added: added.length,
            removed: removed.length,
            changed: changed.length,
            regressions: regressions.length,
        },
    };
}

async function readBaseline(filePath) {
    if (!filePath) return null;
    const parsed = JSON.parse(await readFile(filePath, 'utf8'));
    return Array.isArray(parsed.records) ? parsed.records.map(comparableRecord) : [];
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
        .map(comparableRecord)
        .sort((left, right) => right.observedAt - left.observedAt || left.key.localeCompare(right.key));
    return { records, fileRecords: fileRecords.length, sqliteRecords: sqliteRecords.length, sqliteRuntimeError };
}

async function writeSnapshot(snapshot, outDir) {
    const stamp = nowStamp();
    await mkdir(outDir, { recursive: true });
    const filePath = path.join(outDir, `${stamp}.json`);
    const latestPath = path.join(outDir, 'latest.json');
    const payload = `${JSON.stringify(snapshot, null, 2)}\n`;
    await writeFile(filePath, payload, 'utf8');
    await writeFile(latestPath, payload, 'utf8');
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
    summary: summarize(current.records),
    records: current.records,
};
const diff = baseline
    ? diffSnapshots(baseline, current.records)
    : { added: [], removed: [], changed: [], regressions: [], summary: { added: 0, removed: 0, changed: 0, regressions: 0 } };
const persistence = write ? await writeSnapshot(snapshot, outDir) : { filePath: null, latestPath: null };
const summary = {
    schema: 'model-gateway-runtime-health-diff',
    ok: !failOnRegression || diff.summary.regressions === 0,
    generatedAt: snapshot.generatedAt,
    runtimeExecuted: false,
    baselinePath: baselinePath || null,
    snapshotWritten: write,
    snapshotPath: persistence.filePath,
    latestPath: persistence.latestPath,
    current: snapshot,
    diff,
};

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
        `diff: added=${diff.summary.added} removed=${diff.summary.removed} changed=${diff.summary.changed} regressions=${diff.summary.regressions}\n`,
    );
    if (write) process.stdout.write(`snapshot: ${persistence.filePath} latest=${persistence.latestPath}\n`);
}

if (failOnRegression && diff.summary.regressions > 0) process.exit(1);
