#!/usr/bin/env node
// @ts-check

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const CANARY_KEY = 'ci:copilot-io-l2:cross-process';
const PAYLOAD = Buffer.from(`copilot-io-l2-canary\n${'x'.repeat(64 * 1024)}`, 'utf8');
const PAYLOAD_HASH = createHash('sha256').update(PAYLOAD).digest('hex');

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
 * @param {unknown} value
 */
function printJson(value) {
    process.stdout.write(`${JSON.stringify(value)}\n`);
}

async function loadL2Modules() {
    const [registry, db] = await Promise.all([
        import('../../src/copilot/infra/io-cache-l2-registry.js'),
        import('../../src/copilot/db/sqlite.js'),
    ]);
    return { registry, db };
}

async function runDefaultPhase() {
    const { registry } = await loadL2Modules();
    const configuration = registry.getIoL2CacheConfiguration();
    assert.deepEqual(
        {
            enabled: configuration.enabled,
            profile: configuration.profile,
            profileSource: configuration.profileSource,
        },
        { enabled: false, profile: 'off', profileSource: 'default' },
    );
    assert.equal(registry.getIoL2Cache(), null);
    printJson({ phase: 'default', profile: configuration.profile, enabled: configuration.enabled });
}

/**
 * @param {string} dbPath
 */
async function runSeedPhase(dbPath) {
    assert.equal(process.env['COPILOT_DB_PATH'], dbPath);
    const { registry, db } = await loadL2Modules();
    try {
        const configuration = registry.getIoL2CacheConfiguration();
        assert.deepEqual(
            {
                enabled: configuration.enabled,
                profile: configuration.profile,
                profileSource: configuration.profileSource,
                ttlMs: configuration.ttlMs,
                maxEntries: configuration.maxEntries,
                pruneMs: configuration.pruneMs,
                minBytes: configuration.minBytes,
            },
            {
                enabled: true,
                profile: 'experimental',
                profileSource: 'IO_L2_CACHE_PROFILE',
                ttlMs: 60_000,
                maxEntries: 10_000,
                pruneMs: 60_000,
                minBytes: 0,
            },
        );

        const cache = registry.getIoL2Cache();
        assert.ok(cache, 'experimental profile must initialize the L2 cache');
        cache.clearAll();
        assert.equal(
            cache.set({
                key: CANARY_KEY,
                path: '/ci/copilot-io-l2/canary.bin',
                kind: 'bytes',
                payload: PAYLOAD,
                sizeBytes: PAYLOAD.byteLength,
                metaJson: JSON.stringify({ payloadHash: PAYLOAD_HASH, producer: 'seed-process' }),
            }),
            true,
        );
        const row = cache.get(CANARY_KEY);
        assert.ok(row, 'seed process must read its freshly persisted entry');
        assert.equal(createHash('sha256').update(row.payload).digest('hex'), PAYLOAD_HASH);
        const stats = registry.getIoL2CacheStats();
        assert.equal(stats.enabled, true);
        if (!('hits' in stats)) throw new Error('experimental L2 stats unavailable after seed');
        printJson({
            phase: 'seed',
            profile: configuration.profile,
            payloadBytes: PAYLOAD.byteLength,
            payloadHash: PAYLOAD_HASH,
            stats,
        });
    } finally {
        registry.resetIoL2CacheForTest();
        db.closeCopilotDb();
    }
}

/**
 * @param {string} dbPath
 */
async function runReadPhase(dbPath) {
    assert.equal(process.env['COPILOT_DB_PATH'], dbPath);
    const { registry, db } = await loadL2Modules();
    try {
        const cache = registry.getIoL2Cache();
        assert.ok(cache, 'read process must initialize the experimental L2 cache');
        const row = cache.get(CANARY_KEY);
        assert.ok(row, 'entry seeded by the previous process must persist');
        assert.equal(row.payload.byteLength, PAYLOAD.byteLength);
        assert.equal(createHash('sha256').update(row.payload).digest('hex'), PAYLOAD_HASH);
        assert.deepEqual(JSON.parse(row.metaJson ?? '{}'), {
            payloadHash: PAYLOAD_HASH,
            producer: 'seed-process',
        });
        const stats = registry.getIoL2CacheStats();
        assert.equal(stats.enabled, true);
        if (!('hits' in stats)) throw new Error('experimental L2 stats unavailable after cross-process read');
        assert.equal(stats.hits, 1);
        assert.equal(cache.clearAll(), true);
        printJson({
            phase: 'read',
            profile: registry.getIoL2CacheConfiguration().profile,
            persistedAcrossProcesses: true,
            payloadBytes: row.payload.byteLength,
            payloadHash: PAYLOAD_HASH,
            stats,
        });
    } finally {
        registry.resetIoL2CacheForTest();
        db.closeCopilotDb();
    }
}

/**
 * @param {'default' | 'seed' | 'read'} phase
 * @param {string} dbPath
 */
function runChild(phase, dbPath) {
    /** @type {NodeJS.ProcessEnv} */
    const env = { ...process.env, COPILOT_DB_PATH: dbPath };
    delete env['IO_L2_CACHE_ENABLED'];
    delete env['IO_L2_CACHE_TTL_MS'];
    delete env['IO_L2_CACHE_MAX_ENTRIES'];
    delete env['IO_L2_CACHE_PRUNE_MS'];
    delete env['IO_L2_CACHE_MIN_BYTES'];
    if (phase === 'default') {
        delete env['IO_L2_CACHE_PROFILE'];
    } else {
        env['IO_L2_CACHE_PROFILE'] = 'experimental';
    }

    const startedAt = performance.now();
    const result = spawnSync(process.execPath, [SCRIPT_PATH, `--phase=${phase}`, `--db=${dbPath}`], {
        cwd: process.cwd(),
        env,
        encoding: 'utf8',
        maxBuffer: 4 * 1024 * 1024,
    });
    const durationMs = Number((performance.now() - startedAt).toFixed(3));
    if (result.status !== 0) {
        const detail = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
        throw new Error(`L2 canary phase ${phase} failed with status ${result.status}: ${detail}`);
    }
    const output = String(result.stdout ?? '').trim();
    assert.ok(output, `L2 canary phase ${phase} returned no JSON`);
    return { ...JSON.parse(output.split('\n').at(-1) ?? '{}'), durationMs };
}

/**
 * @param {Record<string, unknown>} summary
 */
async function appendGithubSummary(summary) {
    const summaryPath = String(process.env['GITHUB_STEP_SUMMARY'] ?? '').trim();
    if (!summaryPath) return;
    const seedLatency = /** @type {any} */ (summary.seed)?.stats?.latency;
    const readLatency = /** @type {any} */ (summary.read)?.stats?.latency;
    const markdown = [
        '### Copilot IO L2 experimental canary',
        '',
        `- Default profile: \`${String(/** @type {any} */ (summary.default)?.profile)}\``,
        `- Experimental persistence across processes: **${String(/** @type {any} */ (summary.read)?.persistedAcrossProcesses)}**`,
        `- Payload: ${String(/** @type {any} */ (summary.read)?.payloadBytes)} bytes`,
        `- Seed set max latency: ${String(seedLatency?.set?.maxMs ?? 'n/a')} ms`,
        `- Seed flush max latency: ${String(seedLatency?.flush?.maxMs ?? 'n/a')} ms`,
        `- Read get max latency: ${String(readLatency?.get?.maxMs ?? 'n/a')} ms`,
        '',
    ].join('\n');
    await appendFile(summaryPath, markdown, 'utf8');
}

async function main() {
    const phase = optionValue('--phase');
    const dbPath = optionValue('--db');
    if (phase) {
        assert.ok(dbPath, '--db is required for child phases');
        if (phase === 'default') return runDefaultPhase();
        if (phase === 'seed') return runSeedPhase(dbPath);
        if (phase === 'read') return runReadPhase(dbPath);
        throw new Error(`Unknown L2 canary phase: ${phase}`);
    }

    const directory = await mkdtemp(path.join(tmpdir(), 'copilot-io-l2-ci-'));
    const isolatedDbPath = path.join(directory, 'copilot-l2-canary.sqlite');
    try {
        const summary = {
            ok: true,
            isolatedDb: true,
            default: runChild('default', isolatedDbPath),
            seed: runChild('seed', isolatedDbPath),
            read: runChild('read', isolatedDbPath),
        };
        assert.equal(summary.default.profile, 'off');
        assert.equal(summary.seed.profile, 'experimental');
        assert.equal(summary.read.persistedAcrossProcesses, true);
        await appendGithubSummary(summary);
        printJson(summary);
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
}

main().catch((error) => {
    console.error(error instanceof Error ? error.stack : String(error));
    process.exitCode = 1;
});
