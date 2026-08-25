// @ts-check
/**
 * Consumer/owner governance for exact MCP public and testing package-import surfaces.
 *
 * The scan is intentionally one-pass: every candidate source file is read once, exact MCP aliases are extracted with
 * one regex, and then consumers/owners are classified. This keeps M.2 cheap enough to be a routine architecture
 * invariant rather than a manual audit.
 *
 * @module scripts/analysis/lib/mcp-surface-governance
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

export const MCP_PUBLIC_ALIAS_PREFIX = '#copilot/mcp/public/';
export const MCP_TESTING_ALIAS_PREFIX = '#copilot/testing/mcp/';
const MCP_MODULE_REFERENCE_PATTERN =
    /(?:\bfrom\s+|\bimport\s*\(\s*|\brequire\s*\(\s*|\bimport\s+)(['"])(#copilot\/(?:mcp\/public|testing\/mcp)\/[A-Za-z0-9._/-]+)\1/gu;
const SOURCE_EXTENSIONS = new Set(['.cjs', '.cts', '.js', '.mjs', '.mts', '.ts']);
const EXCLUDED_DIRECTORIES = new Set(['.ai', 'coverage', 'dist', 'node_modules']);

/** @param {string} value */
function normalizePath(value) {
    return value.replaceAll('\\', '/').replace(/^\.\//u, '');
}

/** @param {string} file */
function classifyConsumer(file) {
    if (file.startsWith('tests/')) return 'test';
    if (file.startsWith('scripts/')) return 'tooling';
    if (file.startsWith('src/copilot/mcp/scripts/')) return 'entrypoint';
    if (file.includes('/testing/')) return 'testing-support';
    if (file.startsWith('src/copilot/')) return 'runtime';
    return 'other';
}

/** @param {string} root @returns {string[]} */
function collectCandidateFiles(root) {
    /** @type {string[]} */
    const files = [];
    if (!existsSync(root)) return files;
    /** @param {string} current */
    function walk(current) {
        for (const entry of readdirSync(current, { withFileTypes: true })) {
            if (entry.isDirectory() && EXCLUDED_DIRECTORIES.has(entry.name)) continue;
            const target = path.join(current, entry.name);
            if (entry.isDirectory()) {
                walk(target);
                continue;
            }
            if (SOURCE_EXTENSIONS.has(path.extname(entry.name))) files.push(target);
        }
    }
    walk(root);
    return files;
}

/**
 * @param {readonly {ownerId:string;path:string;kind:string}[]} owners
 * @param {string} target
 */
function resolveMostSpecificOwner(owners, target) {
    const normalizedTarget = normalizePath(target);
    let selected = null;
    for (const owner of owners) {
        const ownerPath = normalizePath(owner.path);
        if (normalizedTarget !== ownerPath && !normalizedTarget.startsWith(`${ownerPath}/`)) continue;
        if (!selected || ownerPath.length > normalizePath(selected.path).length) selected = owner;
    }
    return selected;
}

/**
 * @param {unknown} raw
 * @returns {readonly {ownerId:string;path:string;kind:string}[]}
 */
function readOwners(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('MCP owner manifest must be an object.');
    const rows = /** @type {Record<string, unknown>} */ (raw).owners;
    if (!Array.isArray(rows)) throw new Error('MCP owner manifest owners must be an array.');
    return Object.freeze(
        rows.map((row, index) => {
            if (!row || typeof row !== 'object' || Array.isArray(row))
                throw new Error(`owners[${index}] must be object.`);
            const record = /** @type {Record<string, unknown>} */ (row);
            if (
                typeof record.ownerId !== 'string' ||
                typeof record.path !== 'string' ||
                typeof record.kind !== 'string'
            ) {
                throw new Error(`owners[${index}] is missing ownerId/path/kind.`);
            }
            return Object.freeze({ ownerId: record.ownerId, path: normalizePath(record.path), kind: record.kind });
        }),
    );
}

/**
 * @param {unknown} raw
 * @returns {readonly {alias:string;target:string;surface:'public'|'testing'}[]}
 */
function readExactMcpAliases(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('package.json must be an object.');
    const imports = /** @type {Record<string, unknown>} */ (raw).imports;
    if (!imports || typeof imports !== 'object' || Array.isArray(imports))
        throw new Error('package.json#imports missing.');
    return Object.freeze(
        Object.entries(imports)
            .filter(
                ([alias]) => alias.startsWith(MCP_PUBLIC_ALIAS_PREFIX) || alias.startsWith(MCP_TESTING_ALIAS_PREFIX),
            )
            .map(([alias, target]) => {
                if (alias.includes('*')) throw new Error(`MCP surface alias must be exact: ${alias}`);
                if (typeof target !== 'string') throw new Error(`MCP surface alias target must be a string: ${alias}`);
                return Object.freeze({
                    alias,
                    target: normalizePath(target),
                    surface: /** @type {'public'|'testing'} */ (
                        alias.startsWith(MCP_PUBLIC_ALIAS_PREFIX) ? 'public' : 'testing'
                    ),
                });
            })
            .sort((left, right) => left.alias.localeCompare(right.alias)),
    );
}

/**
 * @param {{repoRoot:string; packageJson:unknown; ownerManifest:unknown; scanRoots?:readonly string[]}} options
 */
export function buildMcpSurfaceGovernanceReport(options) {
    const aliases = readExactMcpAliases(options.packageJson);
    const aliasSet = new Set(aliases.map((entry) => entry.alias));
    const owners = readOwners(options.ownerManifest);
    /** @type {Map<string, Map<string,string>>} */
    const consumersByAlias = new Map(aliases.map((entry) => [entry.alias, new Map()]));
    let filesScanned = 0;

    for (const relativeRoot of options.scanRoots ?? ['src/copilot', 'tests', 'scripts']) {
        const absoluteRoot = path.resolve(options.repoRoot, relativeRoot);
        for (const absoluteFile of collectCandidateFiles(absoluteRoot)) {
            filesScanned += 1;
            const relativeFile = normalizePath(path.relative(options.repoRoot, absoluteFile));
            const source = readFileSync(absoluteFile, 'utf8');
            MCP_MODULE_REFERENCE_PATTERN.lastIndex = 0;
            /** @type {RegExpExecArray | null} */
            let match;
            while ((match = MCP_MODULE_REFERENCE_PATTERN.exec(source)) !== null) {
                const alias = match[2];
                if (!alias || !aliasSet.has(alias)) continue;
                consumersByAlias.get(alias)?.set(relativeFile, classifyConsumer(relativeFile));
            }
        }
    }

    /** @type {string[]} */
    const violations = [];
    const rows = aliases.map((entry) => {
        const consumers = consumersByAlias.get(entry.alias) ?? new Map();
        const consumerRows = [...consumers.entries()]
            .map(([file, kind]) => Object.freeze({ file, kind }))
            .sort((left, right) => left.file.localeCompare(right.file));
        const runtimeConsumers = consumerRows.filter((row) => row.kind === 'runtime');
        const operationalConsumers = consumerRows.filter((row) => ['runtime', 'entrypoint'].includes(row.kind));
        const testOrToolingConsumers = consumerRows.filter((row) =>
            ['test', 'tooling', 'testing-support', 'entrypoint'].includes(row.kind),
        );
        const owner = resolveMostSpecificOwner(owners, entry.target);
        const targetIsMcp = entry.target === 'src/copilot/mcp' || entry.target.startsWith('src/copilot/mcp/');
        const targetHasExpectedMembrane =
            entry.surface === 'public' ? entry.target.includes('/public/') : entry.target.includes('/testing/');

        if (!targetIsMcp) violations.push(`${entry.alias}:target-outside-mcp:${entry.target}`);
        if (!targetHasExpectedMembrane)
            violations.push(`${entry.alias}:target-outside-${entry.surface}-membrane:${entry.target}`);
        if (!owner || owner.ownerId === 'mcp') violations.push(`${entry.alias}:missing-specific-owner:${entry.target}`);
        if (owner && owner.kind === 'taxonomy') violations.push(`${entry.alias}:owned-by-taxonomy:${owner.ownerId}`);
        if (consumerRows.length === 0) violations.push(`${entry.alias}:no-consumers`);
        if (entry.surface === 'public' && operationalConsumers.length === 0)
            violations.push(`${entry.alias}:public-without-operational-consumer`);
        if (entry.surface === 'testing' && testOrToolingConsumers.length === 0)
            violations.push(`${entry.alias}:testing-without-test-or-tooling-consumer`);
        if (entry.surface === 'testing' && runtimeConsumers.length > 0)
            violations.push(
                `${entry.alias}:testing-leaks-into-runtime:${runtimeConsumers.map((row) => row.file).join(',')}`,
            );

        return Object.freeze({
            ...entry,
            ownerId: owner?.ownerId ?? null,
            ownerKind: owner?.kind ?? null,
            consumerCount: consumerRows.length,
            runtimeConsumerCount: runtimeConsumers.length,
            testOrToolingConsumerCount: testOrToolingConsumers.length,
            consumers: Object.freeze(consumerRows),
        });
    });

    const publicRows = rows.filter((entry) => entry.surface === 'public');
    const testingRows = rows.filter((entry) => entry.surface === 'testing');
    return Object.freeze({
        success: violations.length === 0,
        filesScanned,
        publicAliasCount: publicRows.length,
        testingAliasCount: testingRows.length,
        violationCount: violations.length,
        violations: Object.freeze(violations.sort()),
        rows: Object.freeze(rows),
    });
}
