// @ts-check
/**
 * Domain-neutral fresh-process public-entrypoint import measurement.
 *
 * Callers own descriptor semantics, baseline location and tolerance policy. This module owns only process
 * measurement, medians, baseline structural validation and comparison mechanics.
 *
 * @module scripts/analysis/lib/public-api-cold-import
 */

import { spawnSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import process from 'node:process';

const DEFAULT_CHILD_TIMEOUT_MS = 30_000;
const RESULT_PREFIX = '__PUBLIC_API_COLD_IMPORT__';

/** @typedef {{importMs:number;wallMs:number;rssMiB:number;rssDeltaMiB:number}} ColdImportMetrics */

/** @param {number[]} values */
export function median(values) {
    if (values.length === 0) throw new Error('Cannot compute median of an empty sample.');
    const sorted = [...values].sort((left, right) => left - right);
    const middle = Math.floor(sorted.length / 2);
    if (sorted.length % 2 === 1) return sorted[middle] ?? 0;
    return ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

/** @param {number} value */
export function rounded(value) {
    return Number(value.toFixed(3));
}

/**
 * @param {string} alias
 * @param {{ repoRoot:string; timeoutMs?:number }} options
 * @returns {ColdImportMetrics}
 */
export function runFreshPublicImport(alias, options) {
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
        cwd: options.repoRoot,
        env: childEnv,
        encoding: 'utf8',
        timeout: options.timeoutMs ?? DEFAULT_CHILD_TIMEOUT_MS,
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
    return Object.freeze({ importMs, wallMs, rssMiB: rss / 1024 / 1024, rssDeltaMiB: rssDelta / 1024 / 1024 });
}

/**
 * @template {{alias:string}} T
 * @param {T} descriptor
 * @param {{ repoRoot:string; samples:number; warmups:number; timeoutMs?:number }} options
 * @returns {Readonly<T & {metrics:ColdImportMetrics}>}
 */
export function measurePublicImportDescriptor(descriptor, options) {
    /** @type {ColdImportMetrics[]} */
    const rows = [];
    for (let index = 0; index < options.warmups + options.samples; index += 1) {
        const row = runFreshPublicImport(descriptor.alias, options);
        if (index >= options.warmups) rows.push(row);
    }
    return Object.freeze({
        ...descriptor,
        metrics: Object.freeze({
            importMs: rounded(median(rows.map((entry) => entry.importMs))),
            wallMs: rounded(median(rows.map((entry) => entry.wallMs))),
            rssMiB: rounded(median(rows.map((entry) => entry.rssMiB))),
            rssDeltaMiB: rounded(median(rows.map((entry) => entry.rssDeltaMiB))),
        }),
    });
}

/**
 * @template {{alias:string}} T
 * @param {readonly T[]} descriptors
 * @param {{ repoRoot:string; samples:number; warmups:number; timeoutMs?:number }} options
 */
export function measurePublicImports(descriptors, options) {
    return descriptors.map((descriptor) => measurePublicImportDescriptor(descriptor, options));
}

/**
 * @template {{alias:string;metrics:ColdImportMetrics}} T
 * @param {readonly T[]} entries
 * @param {{ schemaVersion:number; samples:number; warmups:number; metadata?:Record<string, unknown> }} options
 */
export function makePublicImportBaseline(entries, options) {
    return Object.freeze({
        schemaVersion: options.schemaVersion,
        node: process.version,
        platform: process.platform,
        arch: process.arch,
        compileCache: 'disabled',
        samples: options.samples,
        warmups: options.warmups,
        ...(options.metadata ?? {}),
        entries: Object.freeze(entries),
    });
}

/**
 * @param {Record<string, unknown>} baseline
 * @param {readonly Record<string, unknown>[]} descriptors
 * @param {{ schemaVersion:number; identityFields?:readonly string[] }} options
 */
export function validatePublicImportBaseline(baseline, descriptors, options) {
    /** @type {string[]} */
    const violations = [];
    if (baseline.schemaVersion !== options.schemaVersion)
        violations.push(`schema-version:${String(baseline.schemaVersion)}!=${options.schemaVersion}`);
    if (baseline.node !== process.version) violations.push(`node:${String(baseline.node)}!=${process.version}`);
    if (baseline.platform !== process.platform)
        violations.push(`platform:${String(baseline.platform)}!=${process.platform}`);
    if (baseline.arch !== process.arch) violations.push(`arch:${String(baseline.arch)}!=${process.arch}`);
    if (baseline.compileCache !== 'disabled')
        violations.push(`compile-cache:${String(baseline.compileCache)}!=disabled`);
    if (!Array.isArray(baseline.entries)) {
        violations.push('entries:not-array');
        return Object.freeze({ success: false, violations: Object.freeze(violations) });
    }

    const descriptorByAlias = new Map(descriptors.map((entry) => [String(entry.alias), entry]));
    const baselineByAlias = new Map(
        baseline.entries
            .filter((entry) => entry && typeof entry === 'object' && !Array.isArray(entry))
            .map((entry) => [
                String(/** @type {Record<string, unknown>} */ (entry).alias),
                /** @type {Record<string, unknown>} */ (entry),
            ]),
    );
    for (const descriptor of descriptors) {
        const alias = String(descriptor.alias);
        const row = baselineByAlias.get(alias);
        if (!row) {
            violations.push(`missing-alias:${alias}`);
            continue;
        }
        for (const field of options.identityFields ?? []) {
            if (row[field] !== descriptor[field])
                violations.push(`${field}:${alias}:${String(row[field])}!=${String(descriptor[field])}`);
        }
        const metrics = row.metrics;
        if (!metrics || typeof metrics !== 'object' || Array.isArray(metrics)) {
            violations.push(`missing-metrics:${alias}`);
            continue;
        }
        for (const [metric, value] of Object.entries(metrics)) {
            if (!Number.isFinite(value) || Number(value) < 0) violations.push(`invalid-metric:${alias}:${metric}`);
        }
    }
    for (const alias of baselineByAlias.keys()) {
        if (!descriptorByAlias.has(alias)) violations.push(`stale-alias:${alias}`);
    }
    return Object.freeze({ success: violations.length === 0, violations: Object.freeze(violations) });
}

/** @param {number} baseline @param {{percent:number;absolute:number}} tolerance */
function allowedValue(baseline, tolerance) {
    return baseline * (1 + tolerance.percent) + tolerance.absolute;
}

/**
 * @param {Record<string, unknown>} baseline
 * @param {readonly Record<string, unknown>[]} measured
 * @param {{ tierField?:string; tierTolerances:Readonly<Record<string,{import:{percent:number;absolute:number};wall:{percent:number;absolute:number};rss:{percent:number;absolute:number}}>> }} options
 */
export function comparePublicImportsAgainstBaseline(baseline, measured, options) {
    const baselineEntries = Array.isArray(baseline.entries) ? baseline.entries : [];
    const baselineByAlias = new Map(
        baselineEntries
            .filter((entry) => entry && typeof entry === 'object' && !Array.isArray(entry))
            .map((entry) => [
                String(/** @type {Record<string, unknown>} */ (entry).alias),
                /** @type {Record<string, unknown>} */ (entry),
            ]),
    );
    const tierField = options.tierField ?? 'costTier';
    const entries = measured.map((row) => {
        const alias = String(row.alias);
        const reference = baselineByAlias.get(alias);
        if (!reference) return Object.freeze({ alias, passed: false, violations: Object.freeze(['missing-baseline']) });
        const tier = String(row[tierField]);
        const tolerance = options.tierTolerances[tier];
        if (!tolerance)
            return Object.freeze({ alias, passed: false, violations: Object.freeze([`unknown-cost-tier:${tier}`]) });
        const referenceMetrics = /** @type {Record<string, unknown>} */ (reference.metrics ?? {});
        const measuredMetrics = /** @type {Record<string, unknown>} */ (row.metrics ?? {});
        const baselineImport = Number(referenceMetrics.importMs);
        const baselineWall = Number(referenceMetrics.wallMs);
        const baselineRss = Number(referenceMetrics.rssMiB);
        const measuredImport = Number(measuredMetrics.importMs);
        const measuredWall = Number(measuredMetrics.wallMs);
        const measuredRss = Number(measuredMetrics.rssMiB);
        const limits = Object.freeze({
            importMs: rounded(allowedValue(baselineImport, tolerance.import)),
            wallMs: rounded(allowedValue(baselineWall, tolerance.wall)),
            rssMiB: rounded(allowedValue(baselineRss, tolerance.rss)),
        });
        /** @type {string[]} */
        const violations = [];
        if (measuredImport > limits.importMs) violations.push(`import-ms:${measuredImport}>${limits.importMs}`);
        if (measuredWall > limits.wallMs) violations.push(`wall-ms:${measuredWall}>${limits.wallMs}`);
        if (measuredRss > limits.rssMiB) violations.push(`rss-mib:${measuredRss}>${limits.rssMiB}`);
        return Object.freeze({
            alias,
            passed: violations.length === 0,
            baseline: referenceMetrics,
            measured: measuredMetrics,
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
