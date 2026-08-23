// @ts-check
import { resolveBabelParserOptions } from '#copilot/infra/public/diagnostic/code-analysis';
import { parse } from '@babel/parser';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, extname, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { listSourceFilesSync } from '../lib/source-tree.mjs';

/** @typedef {'runtime'|'test'|'script'|'tooling'|'config'} CoreDependencyAudience */
/** @typedef {{file:string;kind:string;specifier:string;audience:CoreDependencyAudience}} CoreDependency */
/** @typedef {{schemaVersion:number;policy:string;generatedFromHead:string|null;corePath:string;packageAliases:string[];dependencies:CoreDependency[];summary?:unknown}} CoreExtinctionBaseline */
/** @typedef {{module:string;disposition:string;owner:string}} CoreTargetModule */
/** @typedef {{schemaVersion:number;policy:string;objective:string;modules:CoreTargetModule[]}} CoreExtinctionTargets */
/** @typedef {Record<string, unknown>} AstNode */
/** @typedef {Record<string, string>} PackageImports */

const REPO_ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const CORE_ROOT = resolve(REPO_ROOT, 'src/copilot/core');
export const CORE_EXTINCTION_BASELINE_PATH = resolve(
    REPO_ROOT,
    'config/architecture/copilot-core-extinction-baseline.json',
);
export const CORE_EXTINCTION_TARGETS_PATH = resolve(
    REPO_ROOT,
    'config/architecture/copilot-core-extinction-targets.json',
);
const SCAN_ROOTS = ['src', 'tests', 'scripts', 'tools', 'config'];
const SOURCE_EXTENSIONS = ['.js', '.mjs', '.cjs', '.ts', '.mts', '.cts', '.tsx', '.jsx'];

/** @param {unknown} value @returns {value is AstNode} */
function isRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** @param {unknown} value @returns {string|null} */
function stringValue(value) {
    return typeof value === 'string' ? value : null;
}

/** @param {string} path */
function isSourceFile(path) {
    return SOURCE_EXTENSIONS.includes(extname(path));
}

/** @param {string} path */
function normalizeRepoPath(path) {
    return relative(REPO_ROOT, path).split(sep).join('/');
}

/** @param {string} file @returns {CoreDependencyAudience} */
function sourceKind(file) {
    const rel = normalizeRepoPath(file);
    if (rel.startsWith('tests/')) return 'test';
    if (rel.startsWith('scripts/')) return 'script';
    if (rel.startsWith('tools/')) return 'tooling';
    if (rel.startsWith('config/')) return 'config';
    return 'runtime';
}

/** @param {string} specifier @param {PackageImports} imports */
function resolvePackageTarget(specifier, imports) {
    const target = imports[specifier];
    return typeof target === 'string' ? resolve(REPO_ROOT, target.replace(/^\.\//u, '')) : null;
}

/** @param {string} file @param {string} specifier @param {PackageImports} imports */
function resolveSpecifier(file, specifier, imports) {
    if (specifier === '#copilot/core' || specifier.startsWith('#copilot/core/')) {
        return resolvePackageTarget(specifier, imports) ?? CORE_ROOT;
    }
    if (!specifier.startsWith('.')) return null;
    const base = resolve(dirname(file), specifier);
    const candidates = [base, `${base}.js`, resolve(base, 'index.js')];
    return candidates.find((candidate) => existsSync(candidate) && statSync(candidate).isFile()) ?? base;
}

/** @param {string} file @param {string} specifier @param {PackageImports} imports */
function targetsCore(file, specifier, imports) {
    if (specifier === '#copilot/core' || specifier.startsWith('#copilot/core/')) return true;
    const target = resolveSpecifier(file, specifier, imports);
    return target === CORE_ROOT || Boolean(target?.startsWith(`${CORE_ROOT}${sep}`));
}

/** @param {CoreDependency} entry */
function dependencyKey(entry) {
    return `${entry.file}|${entry.kind}|${entry.specifier}`;
}

/** @param {unknown} node @param {(node: AstNode) => void} visit */
function walkAst(node, visit) {
    if (!node || typeof node !== 'object') return;
    if (isRecord(node) && typeof node['type'] === 'string') visit(node);
    for (const value of Object.values(node)) {
        if (!value || typeof value !== 'object') continue;
        if (Array.isArray(value)) {
            for (const item of value) walkAst(item, visit);
        } else {
            walkAst(value, visit);
        }
    }
}

/** @returns {PackageImports} */
function readPackageImports() {
    const parsed = /** @type {unknown} */ (JSON.parse(readFileSync(resolve(REPO_ROOT, 'package.json'), 'utf8')));
    if (!isRecord(parsed) || !isRecord(parsed['imports'])) return {};
    /** @type {PackageImports} */
    const imports = {};
    for (const [key, value] of Object.entries(parsed['imports'])) {
        if (typeof value === 'string') imports[key] = value;
    }
    return imports;
}

/** @param {AstNode|undefined} node */
function nodeStringLiteralValue(node) {
    return node?.['type'] === 'StringLiteral' ? stringValue(node['value']) : null;
}

/** @param {string} file @param {PackageImports} imports @returns {CoreDependency[]} */
function collectFileDependencies(file, imports) {
    const source = readFileSync(file, 'utf8');
    /** @type {Map<string, CoreDependency>} */
    const found = new Map();
    const rel = normalizeRepoPath(file);
    const audience = sourceKind(file);
    /** @param {string} kind @param {unknown} rawSpecifier */
    const add = (kind, rawSpecifier) => {
        const specifier = stringValue(rawSpecifier);
        if (!specifier || !targetsCore(file, specifier, imports)) return;
        /** @type {CoreDependency} */
        const entry = { file: rel, kind, specifier, audience };
        found.set(dependencyKey(entry), entry);
    };

    let ast;
    try {
        ast = parse(
            source,
            resolveBabelParserOptions(file, /\.[mc]?tsx?$/u.test(file) ? 'ts' : 'js', { profile: 'documentation' }),
        );
    } catch (error) {
        throw new Error(`Core extinction scanner failed to parse ${rel}`, { cause: error });
    }

    walkAst(ast.program, (node) => {
        const type = node['type'];
        const sourceNode = isRecord(node['source']) ? node['source'] : undefined;
        if (type === 'ImportDeclaration') {
            add(node['importKind'] === 'type' ? 'type-import' : 'static-import', sourceNode?.['value']);
        } else if (type === 'ExportNamedDeclaration' || type === 'ExportAllDeclaration') {
            add(node['exportKind'] === 'type' ? 'type-export' : 'static-export', sourceNode?.['value']);
        } else if (type === 'ImportExpression') {
            add('dynamic-import', sourceNode?.['value']);
        } else if (type === 'CallExpression') {
            const callee = isRecord(node['callee']) ? node['callee'] : undefined;
            const args = Array.isArray(node['arguments']) ? node['arguments'] : [];
            const first = isRecord(args[0]) ? args[0] : undefined;
            const value = nodeStringLiteralValue(first);
            if (callee?.['type'] === 'Import') add('dynamic-import', value);
            if (callee?.['type'] === 'Identifier' && callee['name'] === 'require') add('require', value);
            if (callee?.['type'] === 'MemberExpression') {
                const object = isRecord(callee['object']) ? callee['object'] : undefined;
                const property = isRecord(callee['property']) ? callee['property'] : undefined;
                if (
                    object?.['type'] === 'Identifier' &&
                    object['name'] === 'vi' &&
                    property?.['type'] === 'Identifier'
                ) {
                    const propertyName = property['name'];
                    if (propertyName === 'mock' || propertyName === 'importActual') add('mock', value);
                }
            }
        }
    });

    for (const comment of ast.comments ?? []) {
        for (const match of comment.value.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/gu))
            add('jsdoc-type', match[1]);
        for (const match of comment.value.matchAll(/\bmodule:((?:\.\.\/|\.\/|#copilot\/core)[^\s*}`'";,)]+)/gu))
            add('jsdoc-module', match[1]);
    }
    return [...found.values()];
}

/** @returns {CoreDependency[]} */
export function collectCoreDependencies() {
    const imports = readPackageImports();
    const files = SCAN_ROOTS.flatMap((root) => {
        const absolute = resolve(REPO_ROOT, root);
        return existsSync(absolute) ? listSourceFilesSync(absolute, { extensions: SOURCE_EXTENSIONS }) : [];
    }).filter(isSourceFile);
    return files
        .flatMap((file) => collectFileDependencies(file, imports))
        .sort((a, b) => dependencyKey(a).localeCompare(dependencyKey(b)));
}

/** @param {CoreDependency[]} entries */
export function summarizeCoreDependencies(entries) {
    /** @type {Record<string, number>} */
    const byAudience = {};
    /** @type {Record<string, number>} */
    const byOwner = {};
    /** @type {Record<string, number>} */
    const bySpecifier = {};
    for (const entry of entries) {
        byAudience[entry.audience] = (byAudience[entry.audience] ?? 0) + 1;
        const segments = entry.file.split('/');
        const owner = entry.file.startsWith('src/copilot/')
            ? (segments[2] ?? 'src/copilot')
            : (segments[0] ?? 'unknown');
        byOwner[owner] = (byOwner[owner] ?? 0) + 1;
        bySpecifier[entry.specifier] = (bySpecifier[entry.specifier] ?? 0) + 1;
    }
    return { total: entries.length, byAudience, byOwner, bySpecifier };
}

/** @returns {CoreExtinctionBaseline} */
export function readCoreExtinctionBaseline() {
    return /** @type {CoreExtinctionBaseline} */ (JSON.parse(readFileSync(CORE_EXTINCTION_BASELINE_PATH, 'utf8')));
}

/** @returns {CoreExtinctionTargets} */
export function readCoreExtinctionTargets() {
    return /** @type {CoreExtinctionTargets} */ (JSON.parse(readFileSync(CORE_EXTINCTION_TARGETS_PATH, 'utf8')));
}

export function validateCoreExtinctionRatchet() {
    const current = collectCoreDependencies();
    const baseline = readCoreExtinctionBaseline();
    const allowed = new Set((baseline.dependencies ?? []).map(dependencyKey));
    const additions = current.filter((entry) => !allowed.has(dependencyKey(entry)));
    const targetManifest = readCoreExtinctionTargets();
    const packageAliases = Object.keys(readPackageImports())
        .filter((alias) => alias === '#copilot/core' || alias.startsWith('#copilot/core/'))
        .sort();
    const targetModules = new Set((targetManifest.modules ?? []).map((entry) => entry.module));
    const physicalModules = existsSync(CORE_ROOT)
        ? listSourceFilesSync(CORE_ROOT, { extensions: ['.js'] }).map((file) =>
              normalizeRepoPath(file).replace(/^src\/copilot\/core\//u, ''),
          )
        : [];
    const unclassifiedModules = physicalModules.filter((module) => !targetModules.has(module));
    const allowedAliases = new Set(baseline.packageAliases ?? []);
    const newAliases = packageAliases.filter((alias) => !allowedAliases.has(alias));
    const extinctionComplete = current.length === 0 && packageAliases.length === 0 && physicalModules.length === 0;
    return {
        current,
        baseline,
        additions,
        unclassifiedModules,
        newAliases,
        packageAliases,
        physicalModules,
        extinctionComplete,
        summary: summarizeCoreDependencies(current),
    };
}

function writeBaseline() {
    const dependencies = collectCoreDependencies();
    const payload = {
        schemaVersion: 1,
        policy: 'copilot-core-extinction-monotonic-ratchet',
        generatedFromHead: process.env['GIT_COMMIT'] ?? null,
        corePath: 'src/copilot/core',
        packageAliases: Object.keys(readPackageImports())
            .filter((alias) => alias === '#copilot/core' || alias.startsWith('#copilot/core/'))
            .sort(),
        dependencies,
        summary: summarizeCoreDependencies(dependencies),
    };
    writeFileSync(CORE_EXTINCTION_BASELINE_PATH, `${JSON.stringify(payload, null, 2)}\n`);
    return payload;
}

function main() {
    if (process.argv.includes('--write-baseline')) {
        const baseline = writeBaseline();
        console.log(`[core-extinction] baseline written: ${baseline.dependencies.length} dependencies`);
        return;
    }
    const result = validateCoreExtinctionRatchet();
    if (
        !result.extinctionComplete ||
        result.additions.length ||
        result.unclassifiedModules.length ||
        result.newAliases.length
    ) {
        console.error('[core-extinction] extinction invariant failed');
        if (result.current.length) console.error(JSON.stringify({ currentDependencies: result.current }, null, 2));
        if (result.packageAliases.length)
            console.error(JSON.stringify({ packageAliases: result.packageAliases }, null, 2));
        if (result.physicalModules.length)
            console.error(JSON.stringify({ physicalModules: result.physicalModules }, null, 2));
        if (result.additions.length) console.error(JSON.stringify({ newDependencies: result.additions }, null, 2));
        if (result.unclassifiedModules.length)
            console.error(JSON.stringify({ unclassifiedModules: result.unclassifiedModules }, null, 2));
        if (result.newAliases.length) console.error(JSON.stringify({ newAliases: result.newAliases }, null, 2));
        process.exitCode = 1;
        return;
    }
    console.log('[core-extinction] green: Core absent; 0 dependencies; 0 package aliases');
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main();
