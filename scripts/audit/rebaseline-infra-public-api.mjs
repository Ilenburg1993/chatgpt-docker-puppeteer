#!/usr/bin/env node
// @ts-check
/**
 * Recompute nominal export snapshots and static-closure baselines for already-approved infra public APIs.
 *
 * This command is deliberately conservative: semantic metadata and cost tiers are never inferred or promoted. A new
 * package alias without an existing architectural descriptor is a hard failure and requires a human design decision.
 */

import { buildStaticImportClosure, INFRA_PUBLIC_API_MANIFEST } from '#copilot/infra/public/diagnostic/governance';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { format, resolveConfig } from 'prettier';

const ROOT = process.cwd();
const PACKAGE_JSON = resolve(ROOT, 'package.json');
const MANIFEST_FILE = resolve(ROOT, 'src/copilot/infra/governance/public-api-manifest.js');
const BASELINE_FILE = resolve(ROOT, 'src/copilot/infra/governance/public-api-cost-baseline.js');
const write = process.argv.includes('--write');

const pkg = JSON.parse(await readFile(PACKAGE_JSON, 'utf8'));
const publicImports = Object.entries(pkg.imports ?? {})
    .filter(([alias, target]) => alias.startsWith('#copilot/infra/public/') && typeof target === 'string')
    .sort(([left], [right]) => left.localeCompare(right));
const metadata = new Map(INFRA_PUBLIC_API_MANIFEST.map((entry) => [entry.alias, entry]));
const missingMetadata = publicImports.filter(([alias]) => !metadata.has(alias)).map(([alias]) => alias);
if (missingMetadata.length > 0) {
    throw new Error(`New public aliases require explicit architectural metadata: ${missingMetadata.join(', ')}`);
}

const rows = [];
for (const [alias, target] of publicImports) {
    const approved = metadata.get(alias);
    if (!approved) throw new Error(`Missing descriptor for ${alias}`);
    const actualExports = Object.keys(await import(alias)).sort();
    rows.push({
        alias,
        target,
        audience: approved.audience,
        privilege: approved.privilege,
        stability: approved.stability,
        lifecycle: approved.lifecycle,
        costTier: approved.costTier,
        exports: actualExports,
    });
}

function quote(value) {
    return JSON.stringify(value);
}

const manifestLines = [
    '// @ts-check',
    '/**',
    ' * Public API contract for infra 2.0.',
    ' *',
    ' * Semantic metadata is reviewed manually. Nominal exports are regenerated only for already-approved aliases by',
    ' * `node scripts/audit/rebaseline-infra-public-api.mjs --write`.',
    ' *',
    ' * @module copilot/infra/governance/public-api-manifest',
    ' */',
    '',
    '/**',
    " * @typedef {'runtime' | 'composition' | 'diagnostic' | 'test'} PublicApiAudience",
    " * @typedef {'pure' | 'read' | 'mutate' | 'read-write' | 'authority' | 'lifecycle'} PublicApiPrivilege",
    " * @typedef {'stable' | 'experimental' | 'deprecated'} PublicApiStability",
    " * @typedef {'none' | 'process' | 'runtime' | 'workspace'} PublicApiLifecycle",
    " * @typedef {'micro' | 'standard' | 'heavy'} PublicApiCostTier",
    ' * @typedef {{ alias:string; target:string; audience:PublicApiAudience; privilege:PublicApiPrivilege; stability:PublicApiStability; lifecycle:PublicApiLifecycle; costTier:PublicApiCostTier; exports:readonly string[] }} PublicApiDescriptor',
    ' */',
    '',
    '/** @param {PublicApiDescriptor} entry @returns {PublicApiDescriptor} */',
    'function definePublicApi(entry) {',
    '    return Object.freeze({ ...entry, exports: Object.freeze([...entry.exports]) });',
    '}',
    '',
    'export const INFRA_PUBLIC_API_COST_TIER_LIMITS = Object.freeze({',
    '    micro: Object.freeze({ maxModules: 38, maxSourceBytes: 225 * 1024 }),',
    '    standard: Object.freeze({ maxModules: 120, maxSourceBytes: 600 * 1024 }),',
    '    heavy: Object.freeze({ maxModules: null, maxSourceBytes: null }),',
    '});',
    '',
    'export const INFRA_PUBLIC_API_MANIFEST = Object.freeze([',
];
for (const row of rows) {
    manifestLines.push(
        '    definePublicApi({',
        `        alias: ${quote(row.alias)},`,
        `        target: ${quote(row.target)},`,
        `        audience: ${quote(row.audience)},`,
        `        privilege: ${quote(row.privilege)},`,
        `        stability: ${quote(row.stability)},`,
        `        lifecycle: ${quote(row.lifecycle)},`,
        `        costTier: ${quote(row.costTier)},`,
        '        exports: [',
        ...row.exports.map((name) => `            ${quote(name)},`),
        '        ],',
        '    }),',
    );
}
manifestLines.push(
    ']);',
    '',
    '/** @param {string} alias @returns {PublicApiDescriptor | undefined} */',
    'export function getInfraPublicApiDescriptor(alias) {',
    '    return INFRA_PUBLIC_API_MANIFEST.find((entry) => entry.alias === alias);',
    '}',
    '',
    '/** @param {PublicApiAudience} audience @returns {PublicApiDescriptor[]} */',
    'export function listInfraPublicApisByAudience(audience) {',
    '    return INFRA_PUBLIC_API_MANIFEST.filter((entry) => entry.audience === audience);',
    '}',
    '',
);

const prettierConfig = (await resolveConfig(MANIFEST_FILE)) ?? {};
const manifestSource = await format(`${manifestLines.join('\n')}\n`, { ...prettierConfig, filepath: MANIFEST_FILE });
const oldManifest = await readFile(MANIFEST_FILE, 'utf8');
const oldBaseline = await readFile(BASELINE_FILE, 'utf8');
const manifestChanged = oldManifest !== manifestSource;

// In write mode, publish the final nominal manifest before measuring closures. Some diagnostic entrypoints legitimately
// import this manifest; measuring first would make the cost baseline depend on the previous generation's byte size.
if (write && manifestChanged) await writeFile(MANIFEST_FILE, manifestSource, 'utf8');

for (const row of rows) {
    const closure = buildStaticImportClosure(row.target);
    row.moduleCount = closure.moduleCount;
    row.sourceBytes = closure.sourceBytes;
    row.externalPackages = closure.externalPackages;
    row.unresolved = closure.unresolved;
}
const unresolved = rows.flatMap((row) => row.unresolved.map((entry) => ({ alias: row.alias, ...entry })));
if (unresolved.length > 0) throw new Error(`Unresolved static imports: ${JSON.stringify(unresolved)}`);

const baselineLines = [
    '// @ts-check',
    '/**',
    ' * Versioned static-import closure baseline for infra public entrypoints.',
    ' * @module copilot/infra/governance/public-api-cost-baseline',
    ' */',
    '/** @typedef {{ alias:string; moduleCount:number; maxModuleCount:number; sourceBytes:number; maxSourceBytes:number; externalPackages:readonly string[] }} PublicApiCostBaselineEntry */',
    '/** @param {PublicApiCostBaselineEntry} entry */',
    'function defineBaseline(entry) {',
    '    return Object.freeze({ ...entry, externalPackages: Object.freeze([...entry.externalPackages]) });',
    '}',
    '',
    'export const INFRA_PUBLIC_API_COST_BASELINE = Object.freeze([',
];
for (const row of rows) {
    const maxModuleCount = Math.max(row.moduleCount, Math.ceil(row.moduleCount * 1.5));
    const maxSourceBytes = Math.max(row.sourceBytes, Math.ceil(row.sourceBytes * 1.5));
    baselineLines.push(
        '    defineBaseline({',
        `        alias: ${quote(row.alias)},`,
        `        moduleCount: ${row.moduleCount},`,
        `        maxModuleCount: ${maxModuleCount},`,
        `        sourceBytes: ${row.sourceBytes},`,
        `        maxSourceBytes: ${maxSourceBytes},`,
        `        externalPackages: ${quote(row.externalPackages)},`,
        '    }),',
    );
}
baselineLines.push(']);', '');

const baselineSource = await format(`${baselineLines.join('\n')}\n`, { ...prettierConfig, filepath: BASELINE_FILE });
const changed = { manifest: manifestChanged, baseline: oldBaseline !== baselineSource };

const summary = {
    success: true,
    write,
    aliases: rows.length,
    changed,
    removedAliases: INFRA_PUBLIC_API_MANIFEST.filter(
        (entry) => !publicImports.some(([alias]) => alias === entry.alias),
    ).map((entry) => entry.alias),
    costs: rows.map(({ alias, costTier, moduleCount, sourceBytes, externalPackages }) => ({
        alias,
        costTier,
        moduleCount,
        sourceBytes,
        externalPackages,
    })),
};

if (write && changed.baseline) await writeFile(BASELINE_FILE, baselineSource, 'utf8');
process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
