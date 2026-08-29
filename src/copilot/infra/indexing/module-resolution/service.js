// @ts-check
/**
 * Canonical local-module resolution for Copilot indexing consumers.
 *
 * This owner centralizes repository-local source classification, package.json#imports mapping and candidate generation.
 * It performs only the package-manifest read needed to materialize one immutable resolver. Callers remain responsible
 * for deciding whether candidates are visible/allowed and whether they exist in their own authority domain.
 *
 * @module copilot/infra/indexing/module-resolution/service
 */

import { readTextFileSnapshot } from '#copilot/infra/internal/filesystem/read';
import { sha256 } from '#copilot/infra/internal/platform/hash';
import { dirname, extname, join, resolve as resolvePath } from 'node:path';

export const LOCAL_MODULE_FILE_EXTENSIONS = Object.freeze([
    '.js',
    '.mjs',
    '.cjs',
    '.jsx',
    '.ts',
    '.mts',
    '.cts',
    '.tsx',
    '.json',
]);

const LOCAL_MODULE_INDEX_CANDIDATES = Object.freeze(
    LOCAL_MODULE_FILE_EXTENSIONS.map((extension) => `index${extension}`),
);
const TYPESCRIPT_SOURCE_FALLBACKS = Object.freeze({
    '.js': '.ts',
    '.mjs': '.mts',
    '.cjs': '.cts',
    '.jsx': '.tsx',
});

/** @typedef {{source:string;local:boolean;resolved:boolean;strategy:string;basePath:string|null;candidates:string[]}} LocalModuleResolution */
/** @typedef {{workspaceRoot:string;packageImportsHash:string|null;resolve:(importerPath:string, source:string)=>LocalModuleResolution}} LocalModuleResolver */

/** @param {unknown} value @returns {string | null} */
function selectPackageImportTarget(value) {
    if (typeof value === 'string') return value;
    if (Array.isArray(value)) {
        for (const candidate of value) {
            const target = selectPackageImportTarget(candidate);
            if (target) return target;
        }
        return null;
    }
    if (!value || typeof value !== 'object') return null;
    const record = /** @type {Record<string, unknown>} */ (value);
    for (const condition of ['import', 'node', 'default']) {
        const target = selectPackageImportTarget(record[condition]);
        if (target) return target;
    }
    for (const candidate of Object.values(record)) {
        const target = selectPackageImportTarget(candidate);
        if (target) return target;
    }
    return null;
}

/** @param {string} workspaceRoot @param {string} source @param {readonly [string, unknown][]} entries */
function resolvePackageImportBasePath(workspaceRoot, source, entries) {
    const exact = entries.find(([key]) => key === source);
    if (exact) {
        const target = selectPackageImportTarget(exact[1]);
        if (target?.startsWith('./')) {
            return { basePath: resolvePath(workspaceRoot, target), strategy: 'package-import-exact' };
        }
    }
    const wildcardMatches = entries
        .map(([key, value]) => ({ key, value, starIndex: key.indexOf('*') }))
        .filter(({ starIndex }) => starIndex >= 0)
        .sort((left, right) => right.key.length - left.key.length);
    for (const { key, value, starIndex } of wildcardMatches) {
        const prefix = key.slice(0, starIndex);
        const suffix = key.slice(starIndex + 1);
        if (!source.startsWith(prefix) || !source.endsWith(suffix)) continue;
        const wildcardValue = source.slice(prefix.length, source.length - suffix.length);
        const target = selectPackageImportTarget(value);
        if (!target?.startsWith('./')) continue;
        const substituted = target.includes('*') ? target.replaceAll('*', wildcardValue) : target;
        return { basePath: resolvePath(workspaceRoot, substituted), strategy: 'package-import-wildcard' };
    }
    return null;
}

/** @param {string} basePath */
export function buildLocalModuleCandidatePaths(basePath) {
    const candidates = new Set([basePath]);
    const extension = extname(basePath).toLowerCase();
    if (!extension) {
        for (const candidateExtension of LOCAL_MODULE_FILE_EXTENSIONS) candidates.add(`${basePath}${candidateExtension}`);
        for (const fileName of LOCAL_MODULE_INDEX_CANDIDATES) candidates.add(join(basePath, fileName));
    } else {
        const fallback = TYPESCRIPT_SOURCE_FALLBACKS[/** @type {keyof typeof TYPESCRIPT_SOURCE_FALLBACKS} */ (extension)];
        if (fallback) candidates.add(`${basePath.slice(0, -extension.length)}${fallback}`);
    }
    return [...candidates];
}

/** @param {string} source */
export function isLocalModuleSource(source) {
    const normalized = String(source ?? '').trim();
    return normalized.startsWith('.') || normalized.startsWith('#');
}

/** @param {string} workspaceRoot */
async function readPackageImportEntries(workspaceRoot) {
    try {
        const snapshot = await readTextFileSnapshot(join(workspaceRoot, 'package.json'));
        const parsed = JSON.parse(snapshot.content);
        const imports = parsed && typeof parsed === 'object' ? parsed.imports : null;
        return {
            entries: /** @type {readonly [string, unknown][]} */ (
                imports && typeof imports === 'object' ? Object.entries(imports) : []
            ),
            hash: sha256(snapshot.content),
        };
    } catch {
        return { entries: /** @type {readonly [string, unknown][]} */ ([]), hash: null };
    }
}

/**
 * Create one immutable resolver snapshot. Consumers doing many resolutions in one operation should create once and
 * reuse it, avoiding repeated package-manifest IO while also avoiding process-global stale alias caches.
 *
 * @param {{workspaceRoot:string}} input
 * @returns {Promise<LocalModuleResolver>}
 */
export async function createLocalModuleResolver({ workspaceRoot }) {
    const normalizedWorkspaceRoot = resolvePath(workspaceRoot);
    const packageImports = await readPackageImportEntries(normalizedWorkspaceRoot);

    /** @param {string} importerPath @param {string} rawSource @returns {LocalModuleResolution} */
    function resolve(importerPath, rawSource) {
        const source = String(rawSource ?? '').trim();
        if (!isLocalModuleSource(source)) {
            return { source, local: false, resolved: false, strategy: 'external-package', basePath: null, candidates: [] };
        }

        let mapped = source.startsWith('.')
            ? { basePath: resolvePath(dirname(importerPath), source), strategy: 'relative' }
            : resolvePackageImportBasePath(normalizedWorkspaceRoot, source, packageImports.entries);

        // Historical fallback remains centralized here only. It protects old #copilot imports if package.json cannot be
        // read during a degraded diagnostic, while package.json#imports remains the canonical successful strategy.
        if (!mapped && source === '#copilot') {
            mapped = { basePath: join(normalizedWorkspaceRoot, 'src/copilot'), strategy: 'legacy-copilot-alias' };
        } else if (!mapped && source.startsWith('#copilot/')) {
            mapped = {
                basePath: join(normalizedWorkspaceRoot, 'src/copilot', source.slice('#copilot/'.length)),
                strategy: 'legacy-copilot-alias',
            };
        }

        if (!mapped) {
            return {
                source,
                local: true,
                resolved: false,
                strategy: 'package-import-unmapped',
                basePath: null,
                candidates: [],
            };
        }
        return {
            source,
            local: true,
            resolved: true,
            strategy: mapped.strategy,
            basePath: mapped.basePath,
            candidates: buildLocalModuleCandidatePaths(mapped.basePath),
        };
    }

    return Object.freeze({
        workspaceRoot: normalizedWorkspaceRoot,
        packageImportsHash: packageImports.hash,
        resolve,
    });
}
