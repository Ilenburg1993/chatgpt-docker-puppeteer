#!/usr/bin/env node
// @ts-check
/**
 * Benchmark A.13 — I/O Read Performance
 *
 * Mede e compara:
 *
 * 1. fs.readFile vs stream (ReadStream) para arquivos de tamanhos variados
 * 2. Cache L1 hit vs miss (io-cache)
 * 3. io-engine vs fs.readFile direto
 *
 * Saída: resultados versionáveis em JSON + tabela legível
 *
 * Uso: node benchmarks/io-read-benchmark.mjs [--json] [--size small|medium|large]
 */

import * as fs from 'node:fs';
import * as fsPromises from 'node:fs/promises';
import * as os from 'node:os';
import * as nodePath from 'node:path';
import { performance } from 'node:perf_hooks';
import { Bench } from 'tinybench';
// note: Readable imported for future stream-reads-to-buffer use
import {
    getIoL1Cache,
    makeBytesKey,
    normalizeIoCacheKey,
    resetIoL1CacheForTest,
} from '../src/copilot/infra/io-cache.js';
import { readBytes } from '../src/copilot/infra/io-engine.js';

// --- CLI args ---
const args = process.argv.slice(2);
const jsonOutput = args.includes('--json');
const sizeArg = args.find((a) => a.startsWith('--size='))?.split('=')[1] ?? 'all';
const outPathArg = args.find((a) => a.startsWith('--out='))?.slice('--out='.length) ?? null;

/**
 * @type {(new (...args: any[]) => { set: (k: string, v: Buffer) => void; get: (k: string) => Buffer | undefined })
 *     | null}
 */
let lruCacheCtor = null;

try {
    /** @type {any} */
    const lruModule = await import('lru-cache');
    lruCacheCtor = lruModule.LRUCache ?? (typeof lruModule.default === 'function' ? lruModule.default : null);
} catch {
    lruCacheCtor = null;
}

// --- Criar arquivo temporário para o benchmark ---
const TMP_DIR = os.tmpdir();

/** @param {number} bytes @returns {string} */
function makeTmpFile(bytes) {
    const path = nodePath.join(TMP_DIR, `io-bench-${bytes}.bin`);
    if (!fs.existsSync(path)) {
        fs.writeFileSync(path, Buffer.allocUnsafe(bytes).fill(0x41));
    }
    return path;
}

/** @type {Record<string, number>} */
const SIZES = {
    small: 4 * 1024, // 4 KB
    medium: 256 * 1024, // 256 KB
    large: 2 * 1024 * 1024, // 2 MB
};

const sizesToRun = sizeArg === 'all' ? Object.keys(SIZES) : [sizeArg];

/** @param {string} label @param {string} filePath */
async function runSuitForSize(label, filePath) {
    const bench = new Bench({ time: 500, warmupTime: 100 });

    // --- readFile direto ---
    bench.add(`fs.readFile [${label}]`, async () => {
        await fsPromises.readFile(filePath);
    });

    // --- Stream (consume completo) ---
    bench.add(`stream.read [${label}]`, async () => {
        await new Promise((resolve, reject) => {
            const chunks = [];
            const rs = fs.createReadStream(filePath);
            rs.on('data', (c) => chunks.push(c));
            rs.on('end', resolve);
            rs.on('error', reject);
        });
    });

    // --- io-engine readBytes (cache miss — cold) ---
    bench.add(`io-engine.readBytes miss [${label}]`, async () => {
        resetIoL1CacheForTest();
        await readBytes(filePath);
    });

    // --- io-engine readBytes (cache hit — warm) ---
    // Pre-warm cache fora do benchmark
    resetIoL1CacheForTest();
    await readBytes(filePath); // popula o cache
    bench.add(`io-engine.readBytes hit [${label}]`, async () => {
        await readBytes(filePath);
    });

    // --- L1 cache direto (get já aquecido) ---
    const cache = getIoL1Cache();
    const normalized = normalizeIoCacheKey(filePath);
    const key = makeBytesKey(normalized);
    // garante entry presente
    if (cache.get(key) === null) {
        await readBytes(filePath);
    }

    await bench.warmup();
    await bench.run();

    // Re-popular cache após o bench (o bench de miss pode ter limpo o singleton)
    resetIoL1CacheForTest();
    await readBytes(filePath);
    const cacheAfterBench = getIoL1Cache();
    const normalizedAfter = normalizeIoCacheKey(filePath);
    const keyAfter = makeBytesKey(normalizedAfter);

    // --- Medir l1-cache.get manualmente (op ~ns, abaixo da resolução do tinybench) ---
    const ITERATIONS = 100_000;
    const t0 = performance.now();
    for (let i = 0; i < ITERATIONS; i++) {
        const r = cacheAfterBench.get(keyAfter);
        if (r === null) throw new Error('cache miss inesperado');
    }
    const elapsed_ms = performance.now() - t0;
    const l1_hz = (ITERATIONS / elapsed_ms) * 1000;
    const l1_mean_ms = elapsed_ms / ITERATIONS;

    const l1SyntheticTask = {
        name: `l1-cache.get [${label}]`,
        result: { hz: l1_hz, mean: l1_mean_ms / 1000, p99: (l1_mean_ms * 3) / 1000, samples: { length: ITERATIONS } },
    };

    // --- Baseline sintético: Map.get puro (sem TTL, sem eviction, sem wrapper) ---
    const mapBaseline = new Map();
    mapBaseline.set(keyAfter, Buffer.alloc(16));
    const mapT0 = performance.now();
    for (let i = 0; i < ITERATIONS; i++) {
        const r = mapBaseline.get(keyAfter);
        if (!r) throw new Error('map baseline miss inesperado');
    }
    const mapElapsedMs = performance.now() - mapT0;
    const mapHz = (ITERATIONS / mapElapsedMs) * 1000;
    const mapMeanMs = mapElapsedMs / ITERATIONS;

    const mapSyntheticTask = {
        name: `map.get baseline [${label}]`,
        result: { hz: mapHz, mean: mapMeanMs / 1000, p99: (mapMeanMs * 3) / 1000, samples: { length: ITERATIONS } },
    };

    /**
     * @type {{
     *     name: string;
     *     result: { hz: number; mean: number; p99: number; samples: { length: number } };
     * } | null}
     */
    let lruSyntheticTask = null;
    if (lruCacheCtor) {
        const lru = new lruCacheCtor({ max: 2000 });
        lru.set(keyAfter, Buffer.alloc(16));

        const lruT0 = performance.now();
        for (let i = 0; i < ITERATIONS; i++) {
            const r = lru.get(keyAfter);
            if (!r) throw new Error('lru-cache miss inesperado');
        }
        const lruElapsedMs = performance.now() - lruT0;
        const lruHz = (ITERATIONS / lruElapsedMs) * 1000;
        const lruMeanMs = lruElapsedMs / ITERATIONS;

        lruSyntheticTask = {
            name: `lru-cache.get [${label}]`,
            result: { hz: lruHz, mean: lruMeanMs / 1000, p99: (lruMeanMs * 3) / 1000, samples: { length: ITERATIONS } },
        };
    }

    return lruSyntheticTask
        ? [...bench.tasks, l1SyntheticTask, mapSyntheticTask, lruSyntheticTask]
        : [...bench.tasks, l1SyntheticTask, mapSyntheticTask];
}

// --- Executar ---
console.log(`\n=== io-read-benchmark A.13 — ${new Date().toISOString()} ===\n`);

/** @type {{ name: string; hz: number; mean_ms: number; p99_ms: number; samples: number; size_label: string }[]} */
const allResults = [];

for (const sizeKey of sizesToRun) {
    const bytes = SIZES[sizeKey];
    if (!bytes) {
        console.error(`Tamanho desconhecido: ${sizeKey}`);
        process.exit(1);
    }
    const filePath = makeTmpFile(bytes);

    const tasks = await runSuitForSize(sizeKey, filePath);

    if (!jsonOutput) {
        console.log(`--- ${sizeKey.toUpperCase()} (${(bytes / 1024).toFixed(0)} KB) ---`);
        console.log(
            `${'Nome'.padEnd(44)} ${'ops/s'.padStart(12)} ${'mean(μs)'.padStart(10)} ${'p99(μs)'.padStart(10)}`,
        );
        console.log('-'.repeat(80));
    }

    for (const task of tasks) {
        const stats = task.result;
        if (!stats) continue;
        const hz = stats.hz ?? 0;
        const mean_ms = (stats.mean ?? 0) * 1000;
        const p99_ms = (stats.p99 ?? 0) * 1000;
        const samples = stats.samples?.length ?? 0;

        allResults.push({ name: task.name, hz, mean_ms, p99_ms, samples, size_label: sizeKey });

        if (!jsonOutput) {
            const meanUs = (mean_ms * 1000).toFixed(1);
            const p99Us = (p99_ms * 1000).toFixed(1);
            console.log(
                `${task.name.padEnd(44)} ${hz.toFixed(0).padStart(12)} ${meanUs.padStart(10)} ${p99Us.padStart(10)}`,
            );
        }
    }
    if (!jsonOutput) console.log();
}

// --- Análise de thresholds ---
const thresholds = {
    l1_speedup_vs_fs_min: 10, // L1 hit deve ser >= 10x mais rápido que fs.readFile (small)
    stream_overhead_factor: 1.5, // stream pode ser até 1.5x mais lento que readFile para arquivos pequenos
};

if (!jsonOutput) {
    console.log('=== ANÁLISE DE THRESHOLDS ===\n');

    for (const sizeKey of sizesToRun) {
        const fs_task = allResults.find((r) => r.name.startsWith('fs.readFile') && r.size_label === sizeKey);
        const l1_task = allResults.find((r) => r.name.startsWith('l1-cache.get') && r.size_label === sizeKey);
        const miss_task = allResults.find(
            (r) => r.name.startsWith('io-engine.readBytes miss') && r.size_label === sizeKey,
        );
        const hit_task = allResults.find(
            (r) => r.name.startsWith('io-engine.readBytes hit') && r.size_label === sizeKey,
        );

        if (fs_task && l1_task) {
            const speedup = l1_task.hz / fs_task.hz;
            const ok = speedup >= thresholds.l1_speedup_vs_fs_min;
            console.log(
                `[${sizeKey}] L1 speedup vs fs.readFile: ${speedup.toFixed(1)}x ${ok ? '✅' : '⚠️'} (min: ${thresholds.l1_speedup_vs_fs_min}x)`,
            );
        }
        if (miss_task && hit_task) {
            const hitSpeedup = hit_task.hz / miss_task.hz;
            console.log(`[${sizeKey}] io-engine hit/miss ratio: ${hitSpeedup.toFixed(1)}x`);
        }
    }
    console.log();
}

const payload = {
    timestamp: new Date().toISOString(),
    thresholds,
    environment: {
        node: process.version,
        lruCacheAvailable: Boolean(lruCacheCtor),
    },
    results: allResults,
};

if (outPathArg) {
    const resolvedOut = nodePath.resolve(process.cwd(), outPathArg);
    fs.mkdirSync(nodePath.dirname(resolvedOut), { recursive: true });
    fs.writeFileSync(resolvedOut, JSON.stringify(payload, null, 2));
    if (!jsonOutput) {
        console.log(`Resultados JSON salvos em: ${resolvedOut}`);
    }
}

if (jsonOutput) {
    console.log(JSON.stringify(payload, null, 2));
}

// --- Cleanup ---
for (const sizeKey of sizesToRun) {
    const bytes = SIZES[sizeKey];
    if (bytes) {
        const p = nodePath.join(TMP_DIR, `io-bench-${bytes}.bin`);
        try {
            fs.unlinkSync(p);
        } catch {
            /* ignore */
        }
    }
}
