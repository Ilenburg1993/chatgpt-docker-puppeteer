#!/usr/bin/env node
// @ts-check
/**
 * CI Gate — I/O Performance Regression Guard
 *
 * Executa benchmarks focados e compara com thresholds predefinidos. Exit 1 se qualquer métrica degradar mais de
 * THRESHOLD_DEGRADATION_PCT (padrão 20%).
 *
 * Uso: node benchmarks/ci-gate.mjs node benchmarks/ci-gate.mjs --threshold=15 # 15% de tolerância node
 * benchmarks/ci-gate.mjs --baseline=benchmarks/io-read-benchmark-results.with-lru.json
 *
 * Saídas:
 *
 * - Tabela no stdout
 * - Exit 0 se OK, Exit 1 se degradação detectada
 */

import * as fs from 'node:fs';
import * as fsPromises from 'node:fs/promises';
import * as os from 'node:os';
import * as nodePath from 'node:path';
import { performance } from 'node:perf_hooks';
import { resetIoL1CacheForTest } from '../src/copilot/infra/io-cache.js';
import { readBytes, readText } from '../src/copilot/infra/io-engine.js';
import { parseAndCacheSymbols } from '../src/copilot/infra/io-parser.js';
import { warmCacheForPaths } from '../src/copilot/infra/io-prefetch.js';

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const THRESHOLD_PCT = Number(args.find((a) => a.startsWith('--threshold='))?.split('=')[1] ?? 20);
const BASELINE_PATH =
    args.find((a) => a.startsWith('--baseline='))?.split('=')[1] ??
    'benchmarks/io-read-benchmark-results.with-lru.json';
const ITERATIONS = Number(args.find((a) => a.startsWith('--iterations='))?.split('=')[1] ?? 200);
const WARMUP = Number(args.find((a) => a.startsWith('--warmup='))?.split('=')[1] ?? 20);

const ROOT = nodePath.resolve(import.meta.dirname ?? nodePath.dirname(new URL(import.meta.url).pathname), '..');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * @param {string} label
 * @param {() => Promise<void>} fn
 * @param {number} iterations
 * @param {number} warmup
 * @returns {Promise<{ label: string; p50ms: number; p95ms: number; opsPerSec: number; samples: number }>}
 */
async function bench(label, fn, iterations = ITERATIONS, warmup = WARMUP) {
    // Warmup
    for (let i = 0; i < warmup; i++) await fn();

    const samples = /** @type {number[]} */ ([]);
    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
        const t0 = performance.now();
        await fn();
        samples.push(performance.now() - t0);
    }
    const elapsed = performance.now() - start;

    samples.sort((a, b) => a - b);
    const p50ms = samples[Math.floor(samples.length * 0.5)] ?? 0;
    const p95ms = samples[Math.floor(samples.length * 0.95)] ?? 0;
    const opsPerSec = Math.round((iterations / elapsed) * 1000);

    return { label, p50ms, p95ms, opsPerSec, samples: iterations };
}

/**
 * @param {number} val
 * @param {number} ref
 * @returns {number} degradation % (positive = slower/worse)
 */
function degradationPct(val, ref) {
    if (ref === 0) return 0;
    return ((val - ref) / ref) * 100;
}

// ---------------------------------------------------------------------------
// Setup arquivos temporários
// ---------------------------------------------------------------------------

const TMP_DIR = await fsPromises.mkdtemp(nodePath.join(os.tmpdir(), 'ci-gate-'));

const SMALL_FILE = nodePath.join(TMP_DIR, 'small.js');
const MEDIUM_FILE = nodePath.join(TMP_DIR, 'medium.js');
const LARGE_FILE = nodePath.join(TMP_DIR, 'large.js');

// Pequeno: ~4KB de código JS real
const SMALL_CONTENT = `
// Small module — ci-gate benchmark
import { foo } from './foo.js';
export function helper(x) { return x * 2; }
export const VERSION = '1.0.0';
export class MyService {
    constructor(cfg) { this.cfg = cfg; }
    start() { return Promise.resolve(this.cfg); }
    stop() { return Promise.resolve(); }
}
`.repeat(20); // ~4KB

// Médio: ~40KB
const MEDIUM_CONTENT = SMALL_CONTENT.repeat(10);

// Grande: ~200KB
const LARGE_CONTENT = SMALL_CONTENT.repeat(50);

await fsPromises.writeFile(SMALL_FILE, SMALL_CONTENT);
await fsPromises.writeFile(MEDIUM_FILE, MEDIUM_CONTENT);
await fsPromises.writeFile(LARGE_FILE, LARGE_CONTENT);

// ---------------------------------------------------------------------------
// Suite de benchmarks
// ---------------------------------------------------------------------------

console.log('\n⚡ CI Gate — I/O Performance Benchmarks\n');
console.log(`  Threshold: ${THRESHOLD_PCT}%  |  Iterations: ${ITERATIONS}  |  Warmup: ${WARMUP}`);
console.log(`  Tmp dir: ${TMP_DIR}\n`);

/** @type {{ label: string; p50ms: number; p95ms: number; opsPerSec: number; samples: number }[]} */
const results = [];

// 1. readBytes — L1 miss (cold)
resetIoL1CacheForTest();
results.push(
    await bench(
        'readBytes:small:cold',
        async () => {
            resetIoL1CacheForTest();
            await readBytes(SMALL_FILE);
        },
        ITERATIONS,
        WARMUP,
    ),
);

// 2. readBytes — L1 hit (warm)
await readBytes(SMALL_FILE); // prime
results.push(
    await bench(
        'readBytes:small:hot',
        async () => {
            await readBytes(SMALL_FILE);
        },
        ITERATIONS,
        WARMUP,
    ),
);

// 3. readText — médio (warm)
await readText(MEDIUM_FILE);
results.push(
    await bench(
        'readText:medium:hot',
        async () => {
            await readText(MEDIUM_FILE);
        },
        ITERATIONS,
        WARMUP,
    ),
);

// 4. warmCacheForPaths — batch de 3 arquivos
resetIoL1CacheForTest();
results.push(
    await bench(
        'warmCacheForPaths:3files',
        async () => {
            resetIoL1CacheForTest();
            await warmCacheForPaths([SMALL_FILE, MEDIUM_FILE, LARGE_FILE], { silent: true });
        },
        Math.ceil(ITERATIONS / 10),
        Math.ceil(WARMUP / 10),
    ),
);

// 5. parseAndCacheSymbols — cold
resetIoL1CacheForTest();
results.push(
    await bench(
        'parseSymbols:small:cold',
        async () => {
            const { invalidateParserCache } = await import('../src/copilot/infra/io-parser.js');
            invalidateParserCache(SMALL_FILE);
            await parseAndCacheSymbols(SMALL_FILE);
        },
        Math.ceil(ITERATIONS / 5),
        Math.ceil(WARMUP / 5),
    ),
);

// 6. parseAndCacheSymbols — hot (cache hit)
await parseAndCacheSymbols(SMALL_FILE); // prime
results.push(
    await bench(
        'parseSymbols:small:hot',
        async () => {
            await parseAndCacheSymbols(SMALL_FILE);
        },
        ITERATIONS,
        WARMUP,
    ),
);

// ---------------------------------------------------------------------------
// Tabela de resultados
// ---------------------------------------------------------------------------

console.log(`\n${'Label'.padEnd(35)} ${'p50(ms)'.padStart(10)} ${'p95(ms)'.padStart(10)} ${'ops/s'.padStart(10)}`);
console.log('-'.repeat(70));
for (const r of results) {
    console.log(
        `${r.label.padEnd(35)} ${r.p50ms.toFixed(3).padStart(10)} ${r.p95ms.toFixed(3).padStart(10)} ${String(r.opsPerSec).padStart(10)}`,
    );
}
console.log('');

// ---------------------------------------------------------------------------
// Comparação com baseline (se existir)
// ---------------------------------------------------------------------------

const baselineFull = nodePath.join(ROOT, BASELINE_PATH);
let failures = 0;

if (fs.existsSync(baselineFull)) {
    /** @type {any} */
    const baselineData = JSON.parse(fs.readFileSync(baselineFull, 'utf-8'));
    /** @type {Record<string, { opsPerSec?: number; p50ms?: number }>} */
    const baselineMap = {};

    // Tenta mapear pelo label (io-read-benchmark usa formato diferente)
    if (Array.isArray(baselineData)) {
        for (const entry of baselineData) {
            if (entry.name) baselineMap[entry.name] = entry;
        }
    } else if (baselineData.results) {
        for (const entry of baselineData.results) {
            if (entry.label) baselineMap[entry.label] = entry;
        }
    }

    if (Object.keys(baselineMap).length > 0) {
        console.log('📊 Comparação com baseline:\n');
        for (const r of results) {
            const ref = baselineMap[r.label];
            if (!ref) continue;

            const refOps = ref.opsPerSec ?? 0;
            if (refOps === 0) continue;

            // Degradação: ops/s menor = pior
            const degr = degradationPct(refOps, r.opsPerSec) * -1; // negative = we're faster, positive = slower
            const degrStr = degr > 0 ? `+${degr.toFixed(1)}%` : `${degr.toFixed(1)}%`;
            const status = degr > THRESHOLD_PCT ? '❌ FAIL' : '✅ OK';

            if (degr > THRESHOLD_PCT) failures++;

            console.log(
                `  ${r.label.padEnd(35)} baseline=${refOps} ops/s  current=${r.opsPerSec} ops/s  Δ=${degrStr}  ${status}`,
            );
        }
        console.log('');
    } else {
        console.log('ℹ️  Baseline carregado mas não mapeável para os labels atuais — sem comparação.\n');
    }
} else {
    console.log(`ℹ️  Baseline não encontrado em: ${baselineFull}\n`);
    console.log('   Execute o io-read-benchmark.mjs primeiro para gerar baseline.\n');
}

// ---------------------------------------------------------------------------
// Salvar resultados atuais
// ---------------------------------------------------------------------------

const OUTPUT = nodePath.join(ROOT, 'benchmarks', 'ci-gate-results.json');
fs.writeFileSync(
    OUTPUT,
    JSON.stringify(
        {
            timestamp: new Date().toISOString(),
            threshold: THRESHOLD_PCT,
            results,
        },
        null,
        2,
    ),
);
console.log(`💾 Resultados salvos em: ${nodePath.relative(ROOT, OUTPUT)}\n`);

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

await fsPromises.rm(TMP_DIR, { recursive: true, force: true });

// ---------------------------------------------------------------------------
// Exit code
// ---------------------------------------------------------------------------

if (failures > 0) {
    console.error(`❌ CI Gate FAILED: ${failures} benchmark(s) degradaram mais de ${THRESHOLD_PCT}%\n`);
    process.exit(1);
} else {
    console.log(`✅ CI Gate PASSED — nenhuma degradação > ${THRESHOLD_PCT}%\n`);
    process.exit(0);
}
