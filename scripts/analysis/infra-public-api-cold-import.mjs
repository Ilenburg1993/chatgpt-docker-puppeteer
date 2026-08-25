#!/usr/bin/env node
// @ts-check
/** Fresh-process cold-import governance for runtime/composition Infra public entrypoints. */

import { INFRA_PUBLIC_API_MANIFEST } from '#copilot/infra/public/diagnostic/governance';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import {
    comparePublicImportsAgainstBaseline,
    makePublicImportBaseline,
    measurePublicImports,
    validatePublicImportBaseline,
} from './lib/public-api-cold-import.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const BASELINE_PATH = path.join(REPO_ROOT, 'config', 'architecture', 'infra-public-api-cold-import-baseline.json');
const SCHEMA_VERSION = 1;
const DEFAULT_BENCHMARK_SAMPLES = 5;
const DEFAULT_BASELINE_SAMPLES = 7;
const DEFAULT_CHECK_SAMPLES = 5;
const DEFAULT_WARMUPS = 1;
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
    return Object.freeze([
        ...new Set(
            process.argv
                .filter((entry) => entry.startsWith(prefix))
                .map((entry) => entry.slice(prefix.length).trim())
                .filter(Boolean),
        ),
    ]);
}

/** @param {readonly string[]} [selectedAliases] */
function hotPathDescriptors(selectedAliases = []) {
    const descriptors = INFRA_PUBLIC_API_MANIFEST.filter((entry) => HOT_PATH_AUDIENCES.has(entry.audience))
        .map((entry) => {
            if (!(entry.costTier in TIER_TOLERANCES)) throw new Error(`Unsupported cost tier: ${entry.costTier}`);
            return Object.freeze({
                alias: entry.alias,
                audience: /** @type {HotPathAudience} */ (entry.audience),
                costTier: /** @type {CostTier} */ (entry.costTier),
            });
        })
        .sort((left, right) => left.alias.localeCompare(right.alias));
    if (selectedAliases.length === 0) return descriptors;
    const requested = new Set(selectedAliases);
    const known = new Set(descriptors.map((entry) => entry.alias));
    const unknown = selectedAliases.filter((alias) => !known.has(alias));
    if (unknown.length > 0) throw new Error(`Unknown/non-hot public alias: ${unknown.join(', ')}`);
    return descriptors.filter((entry) => requested.has(entry.alias));
}

/** @returns {Promise<Record<string, unknown>>} */
async function readBaseline() {
    return JSON.parse(await readFile(BASELINE_PATH, 'utf8'));
}

/** @param {Record<string, unknown>} baseline */
function validateBaseline(baseline) {
    return validatePublicImportBaseline(baseline, hotPathDescriptors(), {
        schemaVersion: SCHEMA_VERSION,
        identityFields: ['audience', 'costTier'],
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
        const validation = validateBaseline(await readBaseline());
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
    const descriptors = hotPathDescriptors(selectedAliases);
    const measured = measurePublicImports(descriptors, { repoRoot: REPO_ROOT, samples, warmups });

    if (writeBaseline) {
        const baseline = makePublicImportBaseline(measured, {
            schemaVersion: SCHEMA_VERSION,
            samples,
            warmups,
        });
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
        const comparison = comparePublicImportsAgainstBaseline(baseline, measured, {
            tierField: 'costTier',
            tierTolerances: TIER_TOLERANCES,
        });
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
