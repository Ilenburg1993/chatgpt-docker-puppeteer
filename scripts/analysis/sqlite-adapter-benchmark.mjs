// @ts-check
/**
 * Reproducible benchmark for the default better-sqlite3 runtime versus the experimental Node 24+ node:sqlite adapter.
 *
 * This script is diagnostic-only. It uses public composition boundaries and never changes the application default.
 * Each measured sample owns a fresh database and InfraRuntime; synthetic index input is shared but immutable.
 *
 * @module copilot/mcp/scripts/sqlite-adapter-benchmark
 */

import { createInfraRuntime } from '#copilot/infra/public/composition/runtime';
import {
    createBetterSqliteApplicationRuntime,
    createBetterSqliteProvider,
    createNodeSqliteApplicationRuntime,
} from '#copilot/infra/public/diagnostic/database/sqlite';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';

const DEFAULT_SAMPLES = 5;
const DEFAULT_WARMUPS = 1;
const DEFAULT_COLD_IMPORT_SAMPLES = 12;
const INDEX_FILES = 180;
const INDEX_SEARCHES = 240;
const L2_ROWS = 1_200;
const SQL_ROWS = 4_000;
const INVALIDATION_ROWS = 800;
const PAYLOAD = Buffer.alloc(4096, 0x61);

/** @param {unknown} value @param {number} fallback @param {number} min @param {number} max */
function boundedInteger(value, fallback, min, max) {
    const numeric = Number(value);
    return Number.isSafeInteger(numeric) && numeric >= min && numeric <= max ? numeric : fallback;
}

/** @param {number[]} values */
function summarize(values) {
    const sorted = [...values].sort((a, b) => a - b);
    /** @param {number} fraction */
    const at = (fraction) => sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * fraction))] ?? 0;
    return Object.freeze({
        samples: sorted.length,
        minMs: Number((sorted[0] ?? 0).toFixed(3)),
        medianMs: Number(at(0.5).toFixed(3)),
        p90Ms: Number(at(0.9).toFixed(3)),
        maxMs: Number((sorted.at(-1) ?? 0).toFixed(3)),
    });
}

/** @param {Record<string, number[]>} measurements */
function summarizeMeasurements(measurements) {
    return Object.freeze(
        Object.fromEntries(Object.entries(measurements).map(([name, values]) => [name, summarize(values)])),
    );
}

/** @param {string} moduleName @param {number} samples */
function benchmarkColdImport(moduleName, samples) {
    /** @type {number[]} */
    const durationMs = [];
    /** @type {number[]} */
    const rssMiB = [];
    for (let index = 0; index < samples; index += 1) {
        const code = `import {performance} from 'node:perf_hooks'; const started=performance.now(); await import(${JSON.stringify(moduleName)}); console.log(JSON.stringify({durationMs:performance.now()-started,rss:process.memoryUsage().rss}));`;
        const child = spawnSync(process.execPath, ['--input-type=module', '-e', code], {
            cwd: process.cwd(),
            encoding: 'utf8',
        });
        if (child.status !== 0) throw new Error(`Cold import failed for ${moduleName}: ${child.stderr}`);
        const row = /** @type {{durationMs:number;rss:number}} */ (JSON.parse(child.stdout.trim()));
        durationMs.push(row.durationMs);
        rssMiB.push(row.rss / 1024 / 1024);
    }
    const rss = summarize(rssMiB);
    return Object.freeze({
        durationMs: summarize(durationMs),
        rssMiB: Object.freeze({
            samples: rss.samples,
            minMiB: rss.minMs,
            medianMiB: rss.medianMs,
            p90MiB: rss.p90Ms,
            maxMiB: rss.maxMs,
        }),
    });
}

/** @param {string} fixtureRoot */
async function createIndexFixture(fixtureRoot) {
    await mkdir(fixtureRoot, { recursive: true });
    const writes = [];
    for (let index = 0; index < INDEX_FILES; index += 1) {
        const bucket = join(fixtureRoot, `bucket-${String(index % 9).padStart(2, '0')}`);
        await mkdir(bucket, { recursive: true });
        const content = [
            `# SQLite adapter benchmark ${index}`,
            '',
            `alpha beta gamma benchmark-token-${index % 17}`,
            'driver agnostic persistent index workload '.repeat(28),
            `tail-${index}`,
            '',
        ].join('\n');
        writes.push(writeFile(join(bucket, `fixture-${String(index).padStart(4, '0')}.md`), content, 'utf8'));
    }
    await Promise.all(writes);
}

/** @param {'better-sqlite3'|'node:sqlite'} adapter @param {string} dbPath */
function createApplicationResource(adapter, dbPath) {
    if (adapter === 'better-sqlite3') {
        const runtime = createBetterSqliteApplicationRuntime({ dbPath });
        const startedAt = performance.now();
        runtime.getDatabase();
        const openMs = performance.now() - startedAt;
        return {
            adapter,
            openMs,
            provider: createBetterSqliteProvider(runtime.getDatabase),
            database: runtime.getDatabase,
            close: runtime.close,
        };
    }
    const startedAt = performance.now();
    const runtime = createNodeSqliteApplicationRuntime({ dbPath });
    const openMs = performance.now() - startedAt;
    return {
        adapter,
        openMs,
        provider: () => runtime.port,
        database: () => runtime.port,
        close: runtime.close,
    };
}

/** @param {ReturnType<typeof createApplicationResource>} resource @param {string} fixtureRoot @param {string} runtimeId */
async function runRepresentativeWorkload(resource, fixtureRoot, runtimeId) {
    const runtime = createInfraRuntime({
        runtimeId,
        sqliteProvider: resource.provider,
        env: {
            IO_L2_CACHE_PROFILE: 'experimental',
            IO_INDEX_AUTO_REFRESH_ENABLED: '0',
            IO_INDEX_ENABLED: '1',
        },
    });
    /** @type {Record<string, number>} */
    const result = { openMs: resource.openMs };
    try {
        const db = resource.database();
        db.exec('DROP TABLE IF EXISTS copilot_adapter_benchmark_tx');
        db.exec('CREATE TABLE copilot_adapter_benchmark_tx(id INTEGER PRIMARY KEY, value TEXT NOT NULL) STRICT');
        const insert = db.prepare('INSERT INTO copilot_adapter_benchmark_tx(value) VALUES (?)');
        const sqlStarted = performance.now();
        if (typeof db.transaction !== 'function') throw new Error('Benchmark requires transaction support.');
        db.transaction(() => {
            for (let index = 0; index < SQL_ROWS; index += 1) insert.run(`value-${index}`);
        })();
        result['sqlTransactionMs'] = performance.now() - sqlStarted;

        const l2 = runtime.coherence.l2.get();
        if (!l2) throw new Error(`L2 failed to materialize for ${resource.adapter}.`);
        l2.clearAll();
        const l2WriteStarted = performance.now();
        for (let index = 0; index < L2_ROWS; index += 1) {
            l2.set({
                key: `benchmark:${index}`,
                path: `/workspace/benchmark/${index}.bin`,
                kind: 'bytes',
                payload: PAYLOAD,
                sizeBytes: PAYLOAD.byteLength,
            });
        }
        l2.flushPending();
        result['l2WriteMs'] = performance.now() - l2WriteStarted;

        const l2ReadStarted = performance.now();
        let hitBytes = 0;
        for (let index = 0; index < L2_ROWS; index += 1) {
            hitBytes += l2.get(`benchmark:${index}`)?.payload.byteLength ?? 0;
        }
        result['l2ReadMs'] = performance.now() - l2ReadStarted;
        if (hitBytes !== L2_ROWS * PAYLOAD.byteLength)
            throw new Error(`L2 hit verification failed for ${resource.adapter}.`);

        runtime.indexRegistry.clear();
        const indexBuildStarted = performance.now();
        const build = await runtime.indexRegistry.buildDirectory(fixtureRoot, {
            workspaceRoot: fixtureRoot,
            recursive: true,
            respectGitignore: false,
            maxFiles: INDEX_FILES + 20,
            concurrency: 8,
            pruneMissing: true,
            extensions: ['.md'],
        });
        result['indexBuildMs'] = performance.now() - indexBuildStarted;
        if (Number(build.indexed ?? 0) < INDEX_FILES) {
            throw new Error(
                `Index build indexed ${String(build.indexed)} of ${INDEX_FILES} files for ${resource.adapter}.`,
            );
        }

        const searchStarted = performance.now();
        let searchResults = 0;
        for (let index = 0; index < INDEX_SEARCHES; index += 1) {
            searchResults += runtime.indexRegistry.search(`benchmark-token-${index % 17}`, { maxResults: 20 }).length;
        }
        result['indexSearchMs'] = performance.now() - searchStarted;
        if (searchResults === 0) throw new Error(`Index search verification failed for ${resource.adapter}.`);

        const invalidationStarted = performance.now();
        let published = 0;
        for (let index = 0; index < INVALIDATION_ROWS; index += 1) {
            if (
                runtime.coherence.crossProcess.publish(`/workspace/benchmark/${index}.bin`, {
                    source: 'sqlite-benchmark',
                })
            ) {
                published += 1;
            }
        }
        result['invalidationPublishMs'] = performance.now() - invalidationStarted;
        if (published !== INVALIDATION_ROWS) {
            throw new Error(`Invalidation publish verified ${published}/${INVALIDATION_ROWS} for ${resource.adapter}.`);
        }

        runtime.coherence.l2.flushPending();
        return Object.freeze(result);
    } finally {
        await runtime.dispose();
    }
}

/** @param {'better-sqlite3'|'node:sqlite'} adapter @param {string} root @param {string} fixtureRoot @param {number} samples @param {number} warmups */
async function benchmarkAdapter(adapter, root, fixtureRoot, samples, warmups) {
    /** @type {string | null} */
    let sqliteVersion = null;
    /** @type {Record<string, number[]>} */
    const measurements = {
        openMs: [],
        sqlTransactionMs: [],
        l2WriteMs: [],
        l2ReadMs: [],
        indexBuildMs: [],
        indexSearchMs: [],
        invalidationPublishMs: [],
    };
    const totalRuns = warmups + samples;
    for (let index = 0; index < totalRuns; index += 1) {
        const dbPath = join(root, `${adapter.replace(':', '-')}-${index}.sqlite`);
        const resource = createApplicationResource(adapter, dbPath);
        try {
            if (sqliteVersion === null) {
                const versionRow = /** @type {{version?:unknown}|undefined} */ (
                    resource.database().prepare('SELECT sqlite_version() AS version').get()
                );
                sqliteVersion = String(versionRow?.version ?? 'unknown');
            }
            const row = await runRepresentativeWorkload(resource, fixtureRoot, `sqlite-benchmark:${adapter}:${index}`);
            if (index < warmups) continue;
            for (const [name, value] of Object.entries(row)) measurements[name]?.push(value);
        } finally {
            resource.close();
        }
    }
    return Object.freeze({ sqliteVersion, measurements: summarizeMeasurements(measurements) });
}

/** @param {Record<string, ReturnType<typeof summarize>>} better @param {Record<string, ReturnType<typeof summarize>>} native */
function compareMedians(better, native) {
    return Object.freeze(
        Object.fromEntries(
            Object.keys(better).map((name) => {
                const baseline = better[name]?.medianMs ?? 0;
                const candidate = native[name]?.medianMs ?? 0;
                return [
                    name,
                    Object.freeze({
                        betterMedianMs: baseline,
                        nodeMedianMs: candidate,
                        nodeVsBetterRatio: baseline > 0 ? Number((candidate / baseline).toFixed(3)) : null,
                        nodeDeltaPercent:
                            baseline > 0 ? Number((((candidate - baseline) / baseline) * 100).toFixed(2)) : null,
                    }),
                ];
            }),
        ),
    );
}

async function main() {
    const samples = boundedInteger(process.env['COPILOT_SQLITE_BENCHMARK_SAMPLES'], DEFAULT_SAMPLES, 3, 20);
    const warmups = boundedInteger(process.env['COPILOT_SQLITE_BENCHMARK_WARMUPS'], DEFAULT_WARMUPS, 0, 5);
    const coldImportSamples = boundedInteger(
        process.env['COPILOT_SQLITE_BENCHMARK_COLD_IMPORT_SAMPLES'],
        DEFAULT_COLD_IMPORT_SAMPLES,
        5,
        40,
    );
    const root = await mkdtemp(join(tmpdir(), 'copilot-sqlite-adapter-benchmark-'));
    const fixtureRoot = join(root, 'fixture');
    try {
        await createIndexFixture(fixtureRoot);
        const coldImport = Object.freeze({
            betterSqlite3: benchmarkColdImport('better-sqlite3', coldImportSamples),
            nodeSqlite: benchmarkColdImport('node:sqlite', coldImportSamples),
        });
        const better = await benchmarkAdapter('better-sqlite3', root, fixtureRoot, samples, warmups);
        const native = await benchmarkAdapter('node:sqlite', root, fixtureRoot, samples, warmups);
        const report = Object.freeze({
            schemaVersion: 1,
            node: process.version,
            nodeBundledSqlite: process.versions['sqlite'] ?? null,
            platform: process.platform,
            arch: process.arch,
            samples,
            warmups,
            coldImportSamples,
            workload: Object.freeze({
                INDEX_FILES,
                INDEX_SEARCHES,
                L2_ROWS,
                SQL_ROWS,
                INVALIDATION_ROWS,
                payloadBytes: PAYLOAD.byteLength,
            }),
            coldImport,
            adapters: Object.freeze({ betterSqlite3: better, nodeSqlite: native }),
            comparison: compareMedians(better.measurements, native.measurements),
        });
        process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    } finally {
        await rm(root, { recursive: true, force: true });
    }
}

await main();
