#!/usr/bin/env node
// @ts-check
/** Selective fresh-process cold-import governance for MCP hot public entrypoints. */

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import {
    loadMcpPublicApiCostConfiguration,
    MCP_PUBLIC_API_COST_SCHEMA_VERSION,
    REPO_ROOT,
} from './lib/mcp-public-api-cost-config.mjs';
import {
    comparePublicImportsAgainstBaseline,
    makePublicImportBaseline,
    measurePublicImports,
    validatePublicImportBaseline,
} from './lib/public-api-cold-import.mjs';

const BASELINE_PATH = path.join(
    REPO_ROOT,
    'config',
    'architecture',
    'copilot-mcp-public-api-cold-import-baseline.json',
);
const DEFAULT_SAMPLES = 1;
const DEFAULT_BASELINE_SAMPLES = 2;
const DEFAULT_WARMUPS = 0;

const TIER_TOLERANCES = Object.freeze({
    micro: Object.freeze({
        import: Object.freeze({ percent: 0.5, absolute: 10 }),
        wall: Object.freeze({ percent: 0.35, absolute: 30 }),
        rss: Object.freeze({ percent: 0.15, absolute: 12 }),
    }),
    standard: Object.freeze({
        import: Object.freeze({ percent: 0.6, absolute: 20 }),
        wall: Object.freeze({ percent: 0.45, absolute: 40 }),
        rss: Object.freeze({ percent: 0.18, absolute: 16 }),
    }),
    heavy: Object.freeze({
        import: Object.freeze({ percent: 0.75, absolute: 50 }),
        wall: Object.freeze({ percent: 0.6, absolute: 75 }),
        rss: Object.freeze({ percent: 0.25, absolute: 32 }),
    }),
});

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

/** @param {Awaited<ReturnType<typeof loadMcpPublicApiCostConfiguration>>['manifest']} manifest @param {readonly string[]} selected */
function hotDescriptors(manifest, selected) {
    const descriptors = manifest
        .filter((entry) => entry.coldImport)
        .map((entry) => Object.freeze({ alias: entry.alias, costTier: entry.costTier }))
        .sort((left, right) => left.alias.localeCompare(right.alias));
    if (selected.length === 0) return descriptors;
    const known = new Set(descriptors.map((entry) => entry.alias));
    const unknown = selected.filter((alias) => !known.has(alias));
    if (unknown.length > 0) throw new Error(`Unknown/non-hot MCP public alias: ${unknown.join(', ')}`);
    const requested = new Set(selected);
    return descriptors.filter((entry) => requested.has(entry.alias));
}

/** @returns {Promise<Record<string, unknown>>} */
async function readBaseline() {
    return JSON.parse(await readFile(BASELINE_PATH, 'utf8'));
}

/** @param {Record<string, unknown>} baseline @param {readonly {alias:string;costTier:string}[]} descriptors */
function validateBaseline(baseline, descriptors) {
    return validatePublicImportBaseline(baseline, descriptors, {
        schemaVersion: MCP_PUBLIC_API_COST_SCHEMA_VERSION,
        identityFields: ['costTier'],
    });
}

async function main() {
    const writeBaseline = process.argv.includes('--write-baseline');
    const check = process.argv.includes('--check');
    const validateOnly = process.argv.includes('--validate-baseline');
    const selectedAliases = readRepeatedStringArgs('alias');
    if ([writeBaseline, check, validateOnly].filter(Boolean).length > 1) {
        throw new Error('Choose only one of --write-baseline, --check, or --validate-baseline.');
    }
    if ((writeBaseline || validateOnly) && selectedAliases.length > 0) {
        throw new Error(
            `${writeBaseline ? '--write-baseline' : '--validate-baseline'} cannot be combined with --alias.`,
        );
    }

    const configuration = await loadMcpPublicApiCostConfiguration();
    const completeDescriptors = hotDescriptors(configuration.manifest, []);
    if (validateOnly) {
        const validation = validateBaseline(await readBaseline(), completeDescriptors);
        process.stdout.write(
            `${JSON.stringify({ mode: 'validate-baseline', aliases: completeDescriptors.length, ...validation }, null, 2)}\n`,
        );
        if (!validation.success) process.exitCode = 1;
        return;
    }

    const descriptors = hotDescriptors(configuration.manifest, selectedAliases);
    const samples = readIntegerArg('samples', writeBaseline ? DEFAULT_BASELINE_SAMPLES : DEFAULT_SAMPLES, 1, 9);
    const warmups = readIntegerArg('warmups', DEFAULT_WARMUPS, 0, 3);
    const measured = measurePublicImports(descriptors, { repoRoot: REPO_ROOT, samples, warmups });

    if (writeBaseline) {
        const baseline = makePublicImportBaseline(measured, {
            schemaVersion: MCP_PUBLIC_API_COST_SCHEMA_VERSION,
            samples,
            warmups,
            metadata: { kind: 'copilot-mcp-public-api-cold-import-baseline' },
        });
        await writeFile(BASELINE_PATH, `${JSON.stringify(baseline, null, 2)}\n`, 'utf8');
        process.stdout.write(
            `${JSON.stringify({ mode: 'write-baseline', aliases: measured.length, samples, warmups, path: path.relative(REPO_ROOT, BASELINE_PATH) }, null, 2)}\n`,
        );
        return;
    }

    if (check) {
        const baseline = await readBaseline();
        const validation = validateBaseline(baseline, completeDescriptors);
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
        `${JSON.stringify({ mode: 'benchmark', aliases: measured.length, samples, warmups, entries: measured }, null, 2)}\n`,
    );
}

main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
    process.exitCode = 1;
});
