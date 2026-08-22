#!/usr/bin/env node
// @ts-check
/**
 * Recompute nominal export snapshots and static-closure baselines for already-approved infra public APIs.
 *
 * Semantic descriptors are immutable input to this maintenance command. The manifest rewrite is AST-targeted to the
 * `exports` arrays only: audience, privilege, lifecycle, cost tier, path authority and any future semantic metadata are
 * preserved byte-for-byte before Prettier normalization. Adding/removing an alias or changing its package target is an
 * architectural decision and therefore a hard failure until the manifest is edited explicitly.
 *
 * @module scripts/audit/rebaseline-infra-public-api
 */

import { buildStaticImportClosure, INFRA_PUBLIC_API_MANIFEST } from '#copilot/infra/public/diagnostic/governance';
import { parse } from '@babel/parser';
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
const packageAliases = new Set(publicImports.map(([alias]) => alias));
const missingMetadata = publicImports.filter(([alias]) => !metadata.has(alias)).map(([alias]) => alias);
const staleMetadata = INFRA_PUBLIC_API_MANIFEST.filter((entry) => !packageAliases.has(entry.alias)).map(
    (entry) => entry.alias,
);
const targetDrift = publicImports.flatMap(([alias, target]) => {
    const approved = metadata.get(alias);
    return approved && approved.target !== target ? [`${alias}: manifest=${approved.target} package=${target}`] : [];
});
if (missingMetadata.length > 0) {
    throw new Error(`New public aliases require explicit architectural metadata: ${missingMetadata.join(', ')}`);
}
if (staleMetadata.length > 0) {
    throw new Error(`Removed public aliases require explicit manifest edits: ${staleMetadata.join(', ')}`);
}
if (targetDrift.length > 0) {
    throw new Error(`Public alias target changes require explicit manifest edits: ${targetDrift.join('; ')}`);
}

/** @typedef {{alias:string;target:string;costTier:(typeof INFRA_PUBLIC_API_MANIFEST)[number]['costTier'];exports:string[];moduleCount:number;sourceBytes:number;externalPackages:string[];unresolved:{specifier:string;importer:string}[]}} RebaselineRow */
/** @type {RebaselineRow[]} */
const rows = [];
for (const [alias, target] of publicImports) {
    const approved = metadata.get(alias);
    if (!approved) throw new Error(`Missing descriptor for ${alias}`);
    rows.push({
        alias,
        target: /** @type {string} */ (target),
        costTier: approved.costTier,
        exports: Object.keys(await import(alias)).sort(),
        moduleCount: 0,
        sourceBytes: 0,
        externalPackages: /** @type {string[]} */ ([]),
        unresolved: /** @type {{specifier:string;importer:string}[]} */ ([]),
    });
}

/** @param {import('@babel/types').ObjectProperty['key']} key */
function objectPropertyName(key) {
    if (key.type === 'Identifier') return key.name;
    if (key.type === 'StringLiteral') return key.value;
    return null;
}

/**
 * Rewrite only the nominal export arrays in the existing semantic manifest.
 * @param {string} source
 * @param {typeof rows} approvedRows
 */
function rewriteNominalExports(source, approvedRows) {
    const ast = parse(source, { sourceType: 'module' });
    const expected = new Map(approvedRows.map((row) => [row.alias, row.exports]));
    /** @type {{start:number;end:number;text:string;alias:string}[]} */
    const replacements = [];

    for (const statement of ast.program.body) {
        if (statement.type !== 'ExportNamedDeclaration' || statement.declaration?.type !== 'VariableDeclaration')
            continue;
        for (const declaration of statement.declaration.declarations) {
            if (declaration.id.type !== 'Identifier' || declaration.id.name !== 'INFRA_PUBLIC_API_MANIFEST') continue;
            if (declaration.init?.type !== 'CallExpression')
                throw new Error('INFRA_PUBLIC_API_MANIFEST must use Object.freeze([...]).');
            const arrayArgument = declaration.init.arguments[0];
            if (!arrayArgument || arrayArgument.type !== 'ArrayExpression') {
                throw new Error('INFRA_PUBLIC_API_MANIFEST must wrap an array literal.');
            }
            for (const element of arrayArgument.elements) {
                if (!element || element.type !== 'CallExpression') continue;
                const descriptor = element.arguments[0];
                if (!descriptor || descriptor.type !== 'ObjectExpression') continue;
                let alias = null;
                /** @type {import('@babel/types').ArrayExpression | null} */
                let exportsArray = null;
                for (const property of descriptor.properties) {
                    if (property.type !== 'ObjectProperty') continue;
                    const name = objectPropertyName(property.key);
                    if (name === 'alias' && property.value.type === 'StringLiteral') alias = property.value.value;
                    if (name === 'exports' && property.value.type === 'ArrayExpression') exportsArray = property.value;
                }
                if (!alias || !exportsArray) continue;
                const actualExports = expected.get(alias);
                if (!actualExports) throw new Error(`Manifest contains unapproved/stale descriptor: ${alias}`);
                if (typeof exportsArray.start !== 'number' || typeof exportsArray.end !== 'number') {
                    throw new Error(`Babel offsets unavailable for exports of ${alias}`);
                }
                replacements.push({
                    start: exportsArray.start,
                    end: exportsArray.end,
                    text: JSON.stringify(actualExports),
                    alias,
                });
            }
        }
    }

    const replacedAliases = new Set(replacements.map((entry) => entry.alias));
    const missing = [...expected.keys()].filter((alias) => !replacedAliases.has(alias));
    if (missing.length > 0) throw new Error(`Could not locate manifest exports arrays: ${missing.join(', ')}`);
    let rewritten = source;
    for (const replacement of replacements.sort((left, right) => right.start - left.start)) {
        rewritten = `${rewritten.slice(0, replacement.start)}${replacement.text}${rewritten.slice(replacement.end)}`;
    }
    return rewritten;
}

const AST_NON_SEMANTIC_KEYS = new Set([
    'start',
    'end',
    'loc',
    'extra',
    'leadingComments',
    'innerComments',
    'trailingComments',
    'comments',
    'tokens',
    'errors',
]);

/** @param {unknown} value @param {string|null} [parentProperty] @returns {unknown} */
function normalizeSemanticAst(value, parentProperty = null) {
    if (Array.isArray(value)) return value.map((entry) => normalizeSemanticAst(entry, parentProperty));
    if (!value || typeof value !== 'object') return value;
    const record = /** @type {Record<string, unknown>} */ (value);
    if (record['type'] === 'ObjectProperty') {
        const key = /** @type {Record<string, unknown>|undefined} */ (record['key']);
        const propertyName =
            key?.['type'] === 'Identifier' ? key['name'] : key?.['type'] === 'StringLiteral' ? key['value'] : null;
        if (
            propertyName === 'exports' &&
            /** @type {Record<string, unknown>|undefined} */ (record['value'])?.['type'] === 'ArrayExpression'
        ) {
            /** @type {Record<string, unknown>} */
            const output = {};
            for (const [name, child] of Object.entries(record)) {
                if (AST_NON_SEMANTIC_KEYS.has(name)) continue;
                output[name] =
                    name === 'value'
                        ? { type: 'ArrayExpression', elements: ['<nominal-exports>'] }
                        : normalizeSemanticAst(child, propertyName);
            }
            return output;
        }
    }
    /** @type {Record<string, unknown>} */
    const output = {};
    for (const [name, child] of Object.entries(record)) {
        if (AST_NON_SEMANTIC_KEYS.has(name)) continue;
        output[name] = normalizeSemanticAst(child, parentProperty);
    }
    return output;
}

/** @param {string} source */
function semanticManifestFingerprint(source) {
    return JSON.stringify(normalizeSemanticAst(parse(source, { sourceType: 'module' })));
}

const prettierConfig = (await resolveConfig(MANIFEST_FILE)) ?? {};
const oldManifest = await readFile(MANIFEST_FILE, 'utf8');
const oldBaseline = await readFile(BASELINE_FILE, 'utf8');
const manifestSource = await format(rewriteNominalExports(oldManifest, rows), {
    ...prettierConfig,
    filepath: MANIFEST_FILE,
});
const manifestChanged = oldManifest !== manifestSource;
const semanticFingerprintBefore = semanticManifestFingerprint(oldManifest);
const semanticFingerprintAfter = semanticManifestFingerprint(manifestSource);
if (semanticFingerprintBefore !== semanticFingerprintAfter) {
    throw new Error('Rebaseline attempted to modify semantic public API metadata outside nominal exports.');
}

// Publish the final nominal export snapshot before measuring closures: diagnostic governance legitimately imports the
// manifest, so its closure must be measured against the same generation that will be committed.
if (write && manifestChanged) await writeFile(MANIFEST_FILE, manifestSource, 'utf8');

for (const row of rows) {
    const closure = buildStaticImportClosure(row.target);
    row.moduleCount = closure.moduleCount;
    row.sourceBytes = closure.sourceBytes;
    row.externalPackages = [...closure.externalPackages];
    row.unresolved = closure.unresolved.map((entry) => ({ specifier: entry.specifier, importer: entry.importer }));
}
const unresolved = rows.flatMap((row) => row.unresolved.map((entry) => ({ alias: row.alias, ...entry })));
if (unresolved.length > 0) throw new Error(`Unresolved static imports: ${JSON.stringify(unresolved)}`);

/** @param {unknown} value */
function quote(value) {
    return JSON.stringify(value);
}

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
    semanticManifestPreserved: true,
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
