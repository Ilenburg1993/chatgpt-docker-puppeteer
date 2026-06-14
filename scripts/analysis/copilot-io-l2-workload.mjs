#!/usr/bin/env node
// @ts-check

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const DEFAULT_ROOT = 'src/copilot';
const DEFAULT_MAX_FILES = 2_000;
const DEFAULT_CONCURRENCY = 8;
const DEFAULT_INCLUDE = '**/*.{js,ts,mjs,cjs}';

/**
 * @typedef {{ path: string; relativePath: string; sizeBytes: number }} WorkloadFile
 * @typedef {{
 *     phase: string;
 *     profile: string;
 *     files: number;
 *     bytes: number;
 *     errors: number;
 *     cacheCounts: Record<string, number>;
 *     wallMs: number;
 *     throughputMiBPerSecond: number;
 *     latencyMs: { p50: number; p95: number; p99: number; max: number; average: number };
 *     l1Stats: Record<string, unknown> | null;
 *     l2Stats: Record<string, unknown>;
 * }} WorkloadPhase
 */

/**
 * @param {string} name
 * @returns {string | null}
 */
function optionValue(name) {
    const prefix = `${name}=`;
    const inline = process.argv.find((arg) => arg.startsWith(prefix));
    if (inline) return inline.slice(prefix.length);
    const index = process.argv.indexOf(name);
    return index >= 0 ? (process.argv[index + 1] ?? null) : null;
}

/**
 * @param {string | null} value
 * @param {number} fallback
 * @param {number} maximum
 */
function positiveInteger(value, fallback, maximum) {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, maximum) : fallback;
}

/**
 * @param {number} value
 */
function rounded(value) {
    return Number(value.toFixed(3));
}

/**
 * @param {number[]} sorted
 * @param {number} percentile
 */
function percentileValue(sorted, percentile) {
    if (sorted.length === 0) return 0;
    const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * percentile) - 1));
    return sorted[index] ?? 0;
}

/**
 * @param {number[]} values
 */
function summarizeLatency(values) {
    const sorted = [...values].sort((left, right) => left - right);
    const total = sorted.reduce((sum, value) => sum + value, 0);
    return {
        p50: rounded(percentileValue(sorted, 0.5)),
        p95: rounded(percentileValue(sorted, 0.95)),
        p99: rounded(percentileValue(sorted, 0.99)),
        max: rounded(sorted.at(-1) ?? 0),
        average: rounded(sorted.length > 0 ? total / sorted.length : 0),
    };
}

/**
 * @param {number} sizeBytes
 */
function sizeBucket(sizeBytes) {
    if (sizeBytes < 4 * 1024) return '<4KiB';
    if (sizeBytes < 16 * 1024) return '4-16KiB';
    if (sizeBytes < 64 * 1024) return '16-64KiB';
    if (sizeBytes < 256 * 1024) return '64-256KiB';
    if (sizeBytes < 1024 * 1024) return '256KiB-1MiB';
    return '>=1MiB';
}

/**
 * @param {WorkloadFile[]} files
 */
function summarizePayloads(files) {
    /** @type {Record<string, { files: number; bytes: number }>} */
    const buckets = {};
    for (const file of files) {
        const bucket = sizeBucket(file.sizeBytes);
        const current = buckets[bucket] ?? { files: 0, bytes: 0 };
        current.files += 1;
        current.bytes += file.sizeBytes;
        buckets[bucket] = current;
    }
    return buckets;
}

/**
 * @param {import('../../src/copilot/infra/io-scanner.js').IoScanEntry[]} entries
 * @param {WorkloadFile[]} output
 */
function collectFiles(entries, output) {
    for (const entry of entries) {
        if (entry.type === 'file') {
            output.push({
                path: entry.absolutePath,
                relativePath: entry.path.replace(/\\/g, '/'),
                sizeBytes: Number(entry.size ?? 0),
            });
        }
        if (entry.children) collectFiles(entry.children, output);
    }
}

/**
 * @param {WorkloadFile[]} files
 * @param {number} maxFiles
 */
function selectEvenly(files, maxFiles) {
    if (files.length <= maxFiles) return files;
    if (maxFiles === 1) {
        const first = files[0];
        return first ? [first] : [];
    }
    /** @type {WorkloadFile[]} */
    const selected = [];
    for (let index = 0; index < maxFiles; index += 1) {
        const sourceIndex = Math.round((index * (files.length - 1)) / (maxFiles - 1));
        const file = files[sourceIndex];
        if (file) selected.push(file);
    }
    return selected;
}

/**
 * @param {'seed' | 'baseline' | 'read'} phase
 * @param {string} manifestPath
 * @param {string} dbPath
 * @param {number} concurrency
 * @param {number | null} minBytes
 * @returns {WorkloadPhase}
 */
function runChild(phase, manifestPath, dbPath, concurrency, minBytes) {
    /** @type {NodeJS.ProcessEnv} */
    const env = {
        ...process.env,
        COPILOT_DB_PATH: dbPath,
        IO_L1_CACHE_MAX_ENTRIES: '5000',
        IO_L1_CACHE_MAX_BYTES: String(256 * 1024 * 1024),
    };
    delete env['IO_L2_CACHE_ENABLED'];
    delete env['IO_L2_CACHE_TTL_MS'];
    delete env['IO_L2_CACHE_MAX_ENTRIES'];
    delete env['IO_L2_CACHE_PRUNE_MS'];
    delete env['IO_L2_CACHE_MIN_BYTES'];
    env['IO_L2_CACHE_PROFILE'] = phase === 'baseline' ? 'off' : 'experimental';
    if (minBytes !== null) env['IO_L2_CACHE_MIN_BYTES'] = String(minBytes);

    const result = spawnSync(
        process.execPath,
        [
            SCRIPT_PATH,
            `--phase=${phase}`,
            `--manifest=${manifestPath}`,
            `--db=${dbPath}`,
            `--concurrency=${concurrency}`,
        ],
        {
            cwd: process.cwd(),
            env,
            encoding: 'utf8',
            maxBuffer: 8 * 1024 * 1024,
        },
    );
    if (result.status !== 0) {
        const detail = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
        throw new Error(`L2 workload phase ${phase} failed with status ${result.status}: ${detail}`);
    }
    const output = String(result.stdout ?? '').trim();
    assert.ok(output, `L2 workload phase ${phase} returned no JSON`);
    return /** @type {WorkloadPhase} */ (JSON.parse(output.split('\n').at(-1) ?? '{}'));
}

/**
 * @param {'seed' | 'baseline' | 'read'} phase
 * @param {string} manifestPath
 * @param {number} concurrency
 */
async function executePhase(phase, manifestPath, concurrency) {
    const files = /** @type {WorkloadFile[]} */ (JSON.parse(await readFile(manifestPath, 'utf8')));
    const [{ readBytes }, l1, l2, db] = await Promise.all([
        import('../../src/copilot/infra/io-engine.js'),
        import('../../src/copilot/infra/io-cache.js'),
        import('../../src/copilot/infra/io-cache-l2-registry.js'),
        import('../../src/copilot/db/sqlite.js'),
    ]);
    const l2Cache = l2.getIoL2Cache();
    if (phase === 'seed') {
        assert.ok(l2Cache, 'seed phase requires the experimental L2 cache');
        l2Cache.clearAll();
    }
    if (phase === 'baseline') {
        assert.equal(l2Cache, null, 'baseline phase must keep L2 off');
    }

    let cursor = 0;
    let bytes = 0;
    let errors = 0;
    /** @type {number[]} */
    const latencies = [];
    /** @type {Record<string, number>} */
    const cacheCounts = {};
    /** @type {string[]} */
    const errorSamples = [];
    const startedAt = performance.now();

    async function worker() {
        while (true) {
            const index = cursor;
            cursor += 1;
            const file = files[index];
            if (!file) return;
            const readStartedAt = performance.now();
            try {
                const result = await readBytes(file.path);
                bytes += result.bytesRead;
                const cache = String(result.io.cache ?? 'none');
                cacheCounts[cache] = (cacheCounts[cache] ?? 0) + 1;
            } catch (error) {
                errors += 1;
                if (errorSamples.length < 5) {
                    errorSamples.push(
                        `${file.relativePath}: ${error instanceof Error ? error.name : 'Error'}`,
                    );
                }
            } finally {
                latencies.push(performance.now() - readStartedAt);
            }
        }
    }

    try {
        await Promise.all(Array.from({ length: Math.min(concurrency, files.length) }, () => worker()));
        const wallMs = performance.now() - startedAt;
        if (errors > 0) {
            throw new Error(`workload phase ${phase} had ${errors} read errors: ${errorSamples.join(', ')}`);
        }
        const throughputMiBPerSecond =
            wallMs > 0 ? (bytes / (1024 * 1024)) / (wallMs / 1000) : 0;
        const result = {
            phase,
            profile: l2.getIoL2CacheConfiguration().profile,
            files: files.length,
            bytes,
            errors,
            cacheCounts,
            wallMs: rounded(wallMs),
            throughputMiBPerSecond: rounded(throughputMiBPerSecond),
            latencyMs: summarizeLatency(latencies),
            l1Stats: /** @type {Record<string, unknown> | null} */ (l1.getIoCacheStats()),
            l2Stats: /** @type {Record<string, unknown>} */ (l2.getIoL2CacheStats()),
        };
        process.stdout.write(`${JSON.stringify(result)}\n`);
    } finally {
        l1.resetIoL1CacheForTest();
        l2.resetIoL2CacheForTest();
        db.closeCopilotDb();
    }
}

/**
 * @param {string} rootPath
 * @param {string} include
 * @param {number} maxFiles
 */
async function discoverFiles(rootPath, include, maxFiles) {
    const { scanDirectory } = await import('../../src/copilot/infra/io-scanner.js');
    const workspaceRoot = process.cwd();
    const scan = await scanDirectory(rootPath, {
        workspaceRoot,
        recursive: true,
        depth: 64,
        showHidden: false,
        include: [include],
        respectDenylist: true,
        respectGitignore: true,
        fingerprint: false,
        maxEntries: 20_000,
    });
    /** @type {WorkloadFile[]} */
    const files = [];
    collectFiles(scan.entries, files);
    files.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
    return {
        discoveredFiles: files.length,
        blockedEntries: scan.blockedEntries,
        selected: selectEvenly(files, maxFiles),
    };
}

async function main() {
    const phase = optionValue('--phase');
    const manifestPath = optionValue('--manifest');
    const dbPath = optionValue('--db');
    const concurrency = positiveInteger(optionValue('--concurrency'), DEFAULT_CONCURRENCY, 64);
    if (phase) {
        assert.ok(phase === 'seed' || phase === 'baseline' || phase === 'read', `invalid phase: ${phase}`);
        assert.ok(manifestPath, '--manifest is required for workload phases');
        assert.ok(dbPath, '--db is required for workload phases');
        await executePhase(phase, manifestPath, concurrency);
        return;
    }

    const rootPath = path.resolve(optionValue('--root') ?? DEFAULT_ROOT);
    const include = optionValue('--include') ?? DEFAULT_INCLUDE;
    const maxFiles = positiveInteger(optionValue('--max-files'), DEFAULT_MAX_FILES, 10_000);
    const outputPath = optionValue('--output');
    const rawMinBytes = optionValue('--min-bytes');
    const minBytes = rawMinBytes === null ? null : Number(rawMinBytes);
    assert.ok(
        minBytes === null || (Number.isInteger(minBytes) && minBytes >= 0),
        '--min-bytes must be a non-negative integer',
    );
    const directory = await mkdtemp(path.join(tmpdir(), 'copilot-io-l2-workload-'));
    const isolatedDbPath = path.join(directory, 'copilot-l2-workload.sqlite');
    const isolatedManifestPath = path.join(directory, 'manifest.json');
    try {
        const discovery = await discoverFiles(rootPath, include, maxFiles);
        assert.ok(discovery.selected.length > 0, `no workload files found under ${rootPath}`);
        await writeFile(isolatedManifestPath, JSON.stringify(discovery.selected), 'utf8');

        const seed = runChild('seed', isolatedManifestPath, isolatedDbPath, concurrency, minBytes);
        const baseline = runChild('baseline', isolatedManifestPath, isolatedDbPath, concurrency, minBytes);
        const read = runChild('read', isolatedManifestPath, isolatedDbPath, concurrency, minBytes);
        const l2Hits = Number(read.cacheCounts['l2-hit'] ?? 0);
        const hitRatio = read.files > 0 ? l2Hits / read.files : 0;
        const warmFsVsL2 = read.wallMs > 0 ? baseline.wallMs / read.wallMs : 0;
        const seedOverhead = baseline.wallMs > 0 ? seed.wallMs / baseline.wallMs : 0;
        const seedPremiumMs = Math.max(0, seed.wallMs - baseline.wallMs);
        const savingsPerReuseMs = baseline.wallMs - read.wallMs;
        const breakEvenReusePasses =
            savingsPerReuseMs > 0 ? Math.ceil(seedPremiumMs / savingsPerReuseMs) : null;
        const recommendation =
            hitRatio >= 0.95 &&
            warmFsVsL2 >= 1.25 &&
            breakEvenReusePasses !== null &&
            breakEvenReusePasses <= 3
                ? 'collect-more-before-promotion'
                : 'keep-default-off';
        const summary = {
            ok: true,
            rootPath,
            include,
            concurrency,
            configuredMinBytes: seed.l2Stats['minBytes'],
            discoveredFiles: discovery.discoveredFiles,
            selectedFiles: discovery.selected.length,
            blockedEntries: discovery.blockedEntries,
            payloads: {
                totalBytes: discovery.selected.reduce((sum, file) => sum + file.sizeBytes, 0),
                buckets: summarizePayloads(discovery.selected),
            },
            phases: { seed, baseline, read },
            comparison: {
                l2Hits,
                hitRatio: rounded(hitRatio),
                warmFsVsL2: rounded(warmFsVsL2),
                seedOverhead: rounded(seedOverhead),
                seedPremiumMs: rounded(seedPremiumMs),
                savingsPerReuseMs: rounded(savingsPerReuseMs),
                breakEvenReusePasses,
                recommendation,
            },
        };
        const serialized = `${JSON.stringify(summary, null, 2)}\n`;
        if (outputPath) await writeFile(path.resolve(outputPath), serialized, 'utf8');
        process.stdout.write(serialized);
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
}

main().catch((error) => {
    console.error(error instanceof Error ? error.stack : String(error));
    process.exitCode = 1;
});
