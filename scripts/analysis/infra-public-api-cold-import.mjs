#!/usr/bin/env node
// @ts-check
/**
 * Fresh-process cold-import governance for runtime/composition Infra public entrypoints.
 *
 * Static closure cost and runtime cold-load cost are deliberately separate invariants. This benchmark launches a new
 * Node process per sample, disables the Node compile cache, measures import time inside the child, measures full parent
 * spawn wall time, and records post-import RSS. Diagnostic/test APIs remain governed by static closure rather than the
 * runtime hot-path ratchet.
 *
 * Baselines are measurements, never inferred architectural metadata. Audience/costTier always come from the canonical
 * INFRA_PUBLIC_API_MANIFEST and are checked against the versioned baseline before comparisons are accepted.
 *
 * @module scripts/analysis/infra-public-api-cold-import
 */

import { INFRA_PUBLIC_API_MANIFEST } from '#copilot/infra/public/diagnostic/governance';
import { spawnSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const BASELINE_PATH = path.join(REPO_ROOT, 'config', 'architecture', 'infra-public-api-cold-import-baseline.json');
const SCHEMA_VERSION = 1;
const DEFAULT_BENCHMARK_SAMPLES = 5;
const DEFAULT_BASELINE_SAMPLES = 7;
const DEFAULT_CHECK_SAMPLES = 5;
const DEFAULT_WARMUPS = 1;
const CHILD_TIMEOUT_MS = 30_000;
const RESULT_PREFIX = '__INFRA_COLD_IMPORT__';
const HOT_PATH_AUDIENCES = new Set(['runtime', 'composition']);

const TIER_TOLERANCES = Object.freeze({
    micro: Object.freeze({
        import: Object.freeze({ percent: 0.3, absolute: 5 }),
        wall: Object.freeze({ percent: 0.2, absolute: 20 }),
        rss: Object.freeze({ percent: 0.08, absolute: 8 }),
    }),
    standard: Object.freeze({
        import: Object.freeze({ percent: 0.4, absolute: 10 }),
        wall: Object.freeze({ percent: 0.3, absolute: 25 }),
        rss: Object.freeze({ percent: 0.12, absolute: 10 }),
    }),
    heavy: Object.freeze({
        import: Object.freeze({ percent: 0.5, absolute: 20 }),
        wall: Object.freeze({ percent: 0.4, absolute: 35 }),
        rss: Object.freeze({ percent: 0.18, absolute: 16 }),
    }),
});

/** @typedef {'runtime'|'composition'} HotPathAudience */
/** @typedef {'micro'|'standard'|'heavy'} CostTier */
/** @typedef {{importMs:number;wallMs:number;rssMiB:number;rssDeltaMiB:number}} ColdImportMetrics */
/** @typedef {{alias:string;audience:HotPathAudience;costTier:CostTier;metrics:ColdImportMetrics}} ColdImportBaselineEntry */
/** @typedef {{schemaVersion:number;node:string;platform:string;arch:string;compileCache:string;samples:number;warmups:number;entries:ColdImportBaselineEntry[]}} ColdImportBaseline */

/** @param {number[]} values */
function median(values) {
    if (values.length === 0) throw new Error('Cannot compute median of an empty sample.');
    const sorted = [...values].sort((left, right) => left - right);
    const middle = Math.floor(sorted.length / 2);
    if (sorted.length % 2 === 1) return sorted[middle] ?? 0;
    return ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

/** @param {number} value */
function rounded(value) {
    return Number(value.toFixed(3));
}

/** @param {string} name @param {number} fallback @param {number} min @param {number} max */
function readIntegerArg(name, fallback, min, max) {
    const prefix = `--${name}=`;
    const raw = process.argv.find((entry) => entry.startsWith(prefix))?.slice(prefix.length);
    if (raw === undefined) return fallback;
    const value = Number(raw);
    if (!Number.isSafeInteger(value) || value < min || value > max) {
        throw new Error(`--${name} must be an integer in [${min}, ${max}].`);
    }
    return value;
}

/** @param {string} name */
function readRepeatedStringArgs(name) {
    const prefix = `--${name}=`;
    const values = process.argv
        .filter((entry) => entry.startsWith(prefix))
        .map((entry) => entry.slice(prefix.length).trim())
        .filter(Boolean);
    return Object.freeze([...new Set(values)]);
}

/** @param {readonly string[]} [selectedAliases] */
function hotPathDescriptors(selectedAliases = []) {
    const descriptors = INFRA_PUBLIC_API_MANIFEST.filter((entry) => HOT_PATH_AUDIENCES.has(entry.audience))
        .map((entry) => {
            if (!(entry.costTier in TIER_TOLERANCES)) throw new Error(`Unsupported cost tier: ${entry.costTier}`);
            return {
                alias: entry.alias,
                audience: /** @type {HotPathAudience} */ (entry.audience),
                costTier: /** @type {CostTier} */ (entry.costTier),
            };
        })
        .sort((left, right) => left.alias.localeCompare(right.alias));
    if (selectedAliases.length === 0) return descriptors;
    const requested = new Set(selectedAliases);
    const known = new Set(descriptors.map((entry) => entry.alias));
    const unknown = selectedAliases.filter((alias) => !known.has(alias));
    if (unknown.length > 0) throw new Error(`Unknown/non-hot public alias: ${unknown.join(', ')}`);
    return descriptors.filter((entry) => requested.has(entry.alias));
}

/** @param {string} alias */
function runFreshImport(alias) {
    const childCode = [
        "import { performance } from 'node:perf_hooks';",
        `const prefix = ${JSON.stringify(RESULT_PREFIX)};`,
        'const beforeRss = process.memoryUsage().rss;',
        'const started = performance.now();',
        `await import(${JSON.stringify(alias)});`,
        'const importMs = performance.now() - started;',
        'const rss = process.memoryUsage().rss;',
        'process.stdout.write(`${prefix}${JSON.stringify({ importMs, rss, rssDelta: Math.max(0, rss - beforeRss) })}\\n`);',
        'process.exit(0);',
    ].join('\n');
    /** @type {NodeJS.ProcessEnv} */
    const childEnv = { ...process.env, NODE_DISABLE_COMPILE_CACHE: '1' };
    delete childEnv['NODE_COMPILE_CACHE'];
    const wallStarted = performance.now();
    const child = spawnSync(process.execPath, ['--no-warnings', '--input-type=module', '-e', childCode], {
        cwd: REPO_ROOT,
        env: childEnv,
        encoding: 'utf8',
        timeout: CHILD_TIMEOUT_MS,
        maxBuffer: 1024 * 1024,
    });
    const wallMs = performance.now() - wallStarted;
    if (child.error) throw child.error;
    if (child.status !== 0) {
        throw new Error(
            `Cold import failed for ${alias}: status=${String(child.status)} signal=${String(child.signal)} stderr=${child.stderr.trim()}`,
        );
    }
    const payloadLine = child.stdout.split(/\r?\n/u).findLast((line) => line.startsWith(RESULT_PREFIX));
    if (!payloadLine) throw new Error(`Cold import for ${alias} did not emit a measurement payload.`);
    const payload = /** @type {{importMs:unknown;rss:unknown;rssDelta:unknown}} */ (
        JSON.parse(payloadLine.slice(RESULT_PREFIX.length))
    );
    const importMs = Number(payload.importMs);
    const rss = Number(payload.rss);
    const rssDelta = Number(payload.rssDelta);
    if (![importMs, rss, rssDelta].every(Number.isFinite)) {
        throw new Error(`Cold import for ${alias} emitted non-finite metrics.`);
    }
    return Object.freeze({
        importMs,
        wallMs,
        rssMiB: rss / 1024 / 1024,
        rssDeltaMiB: rssDelta / 1024 / 1024,
    });
}

/** @param {{alias:string;audience:HotPathAudience;costTier:CostTier}} descriptor @param {number} samples @param {number} warmups */
function measureDescriptor(descriptor, samples, warmups) {
    /** @type {ColdImportMetrics[]} */
    const rows = [];
    for (let index = 0; index < warmups + samples; index += 1) {
        const row = runFreshImport(descriptor.alias);
        if (index >= warmups) rows.push(row);
    }
    return Object.freeze({
        alias: descriptor.alias,
        audience: descriptor.audience,
        costTier: descriptor.costTier,
        metrics: Object.freeze({
            importMs: rounded(median(rows.map((entry) => entry.importMs))),
            wallMs: rounded(median(rows.map((entry) => entry.wallMs))),
            rssMiB: rounded(median(rows.map((entry) => entry.rssMiB))),
            rssDeltaMiB: rounded(median(rows.map((entry) => entry.rssDeltaMiB))),
        }),
    });
}

/** @param {number} samples @param {number} warmups @param {readonly string[]} [selectedAliases] */
function measureAll(samples, warmups, selectedAliases = []) {
    return hotPathDescriptors(selectedAliases).map((descriptor) => measureDescriptor(descriptor, samples, warmups));
}

/** @returns {Promise<ColdImportBaseline>} */
async function readBaseline() {
    const parsed = /** @type {ColdImportBaseline} */ (JSON.parse(await readFile(BASELINE_PATH, 'utf8')));
    return parsed;
}

/** @param {ColdImportBaseline} baseline */
function validateBaseline(baseline) {
    /** @type {string[]} */
    const violations = [];
    if (baseline.schemaVersion !== SCHEMA_VERSION)
        violations.push(`schema-version:${String(baseline.schemaVersion)}!=${SCHEMA_VERSION}`);
    if (baseline.node !== process.version) violations.push(`node:${String(baseline.node)}!=${process.version}`);
    if (baseline.platform !== process.platform)
        violations.push(`platform:${String(baseline.platform)}!=${process.platform}`);
    if (baseline.arch !== process.arch) violations.push(`arch:${String(baseline.arch)}!=${process.arch}`);
    if (baseline.compileCache !== 'disabled')
        violations.push(`compile-cache:${String(baseline.compileCache)}!=disabled`);

    const expected = hotPathDescriptors();
    const expectedByAlias = new Map(expected.map((entry) => [entry.alias, entry]));
    const baselineByAlias = new Map(baseline.entries.map((entry) => [entry.alias, entry]));
    for (const descriptor of expected) {
        const row = baselineByAlias.get(descriptor.alias);
        if (!row) {
            violations.push(`missing-alias:${descriptor.alias}`);
            continue;
        }
        if (row.audience !== descriptor.audience)
            violations.push(`audience:${descriptor.alias}:${row.audience}!=${descriptor.audience}`);
        if (row.costTier !== descriptor.costTier)
            violations.push(`cost-tier:${descriptor.alias}:${row.costTier}!=${descriptor.costTier}`);
        for (const [metric, value] of Object.entries(row.metrics)) {
            if (!Number.isFinite(value) || value < 0) violations.push(`invalid-metric:${descriptor.alias}:${metric}`);
        }
    }
    for (const row of baseline.entries) {
        if (!expectedByAlias.has(row.alias)) violations.push(`stale-alias:${row.alias}`);
    }
    return Object.freeze({ success: violations.length === 0, violations: Object.freeze(violations) });
}

/** @param {number} baseline @param {{percent:number;absolute:number}} tolerance */
function allowedValue(baseline, tolerance) {
    return baseline * (1 + tolerance.percent) + tolerance.absolute;
}

/** @param {ColdImportBaseline} baseline @param {ColdImportBaselineEntry[]} measured */
function compareAgainstBaseline(baseline, measured) {
    const baselineByAlias = new Map(baseline.entries.map((entry) => [entry.alias, entry]));
    const entries = measured.map((row) => {
        const reference = baselineByAlias.get(row.alias);
        if (!reference) {
            return Object.freeze({ alias: row.alias, passed: false, violations: Object.freeze(['missing-baseline']) });
        }
        const tolerance = TIER_TOLERANCES[row.costTier];
        const limits = Object.freeze({
            importMs: rounded(allowedValue(reference.metrics.importMs, tolerance.import)),
            wallMs: rounded(allowedValue(reference.metrics.wallMs, tolerance.wall)),
            rssMiB: rounded(allowedValue(reference.metrics.rssMiB, tolerance.rss)),
        });
        /** @type {string[]} */
        const violations = [];
        if (row.metrics.importMs > limits.importMs)
            violations.push(`import-ms:${row.metrics.importMs}>${limits.importMs}`);
        if (row.metrics.wallMs > limits.wallMs) violations.push(`wall-ms:${row.metrics.wallMs}>${limits.wallMs}`);
        if (row.metrics.rssMiB > limits.rssMiB) violations.push(`rss-mib:${row.metrics.rssMiB}>${limits.rssMiB}`);
        return Object.freeze({
            alias: row.alias,
            audience: row.audience,
            costTier: row.costTier,
            passed: violations.length === 0,
            baseline: reference.metrics,
            measured: row.metrics,
            limits,
            violations: Object.freeze(violations),
        });
    });
    const violations = entries.filter((entry) => !entry.passed);
    return Object.freeze({
        success: violations.length === 0,
        entries: Object.freeze(entries),
        violations: Object.freeze(violations),
    });
}

/** @param {ColdImportBaselineEntry[]} entries @param {number} samples @param {number} warmups */
function makeBaseline(entries, samples, warmups) {
    return Object.freeze({
        schemaVersion: SCHEMA_VERSION,
        node: process.version,
        platform: process.platform,
        arch: process.arch,
        compileCache: 'disabled',
        samples,
        warmups,
        entries: Object.freeze(entries),
    });
}

async function main() {
    const writeBaseline = process.argv.includes('--write-baseline');
    const check = process.argv.includes('--check');
    const validateOnly = process.argv.includes('--validate-baseline');
    const selectedAliases = readRepeatedStringArgs('alias');
    const modes = [writeBaseline, check, validateOnly].filter(Boolean).length;
    if (modes > 1) throw new Error('Choose only one of --write-baseline, --check, or --validate-baseline.');
    if (writeBaseline && selectedAliases.length > 0) {
        throw new Error('--write-baseline cannot be combined with --alias; versioned baselines must be complete.');
    }
    if (validateOnly && selectedAliases.length > 0) {
        throw new Error('--validate-baseline cannot be combined with --alias; baseline validation is exhaustive.');
    }

    if (validateOnly) {
        const baseline = await readBaseline();
        const validation = validateBaseline(baseline);
        process.stdout.write(`${JSON.stringify({ mode: 'validate-baseline', ...validation }, null, 2)}\n`);
        if (!validation.success) process.exitCode = 1;
        return;
    }

    const defaultSamples = writeBaseline
        ? DEFAULT_BASELINE_SAMPLES
        : check
          ? DEFAULT_CHECK_SAMPLES
          : DEFAULT_BENCHMARK_SAMPLES;
    const samples = readIntegerArg('samples', defaultSamples, check ? 3 : 1, 25);
    const warmups = readIntegerArg('warmups', DEFAULT_WARMUPS, 0, 5);
    const measured = measureAll(samples, warmups, selectedAliases);

    if (writeBaseline) {
        const baseline = makeBaseline(measured, samples, warmups);
        await writeFile(BASELINE_PATH, `${JSON.stringify(baseline, null, 2)}\n`, 'utf8');
        process.stdout.write(
            `${JSON.stringify({ mode: 'write-baseline', path: path.relative(REPO_ROOT, BASELINE_PATH), aliases: measured.length, samples, warmups }, null, 2)}\n`,
        );
        return;
    }

    if (check) {
        const baseline = await readBaseline();
        const validation = validateBaseline(baseline);
        if (!validation.success) {
            process.stdout.write(
                `${JSON.stringify({ mode: 'check', success: false, baselineValidation: validation }, null, 2)}\n`,
            );
            process.exitCode = 1;
            return;
        }
        const comparison = compareAgainstBaseline(baseline, measured);
        process.stdout.write(
            `${JSON.stringify({ mode: 'check', aliases: measured.length, samples, warmups, ...comparison }, null, 2)}\n`,
        );
        if (!comparison.success) process.exitCode = 1;
        return;
    }

    process.stdout.write(
        `${JSON.stringify({ mode: 'benchmark', node: process.version, aliases: measured.length, samples, warmups, entries: measured }, null, 2)}\n`,
    );
}

main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
    process.exitCode = 1;
});
