// @ts-check
/** Canonical loader/validator for MCP public API cost-governance configuration. */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
export const MCP_PUBLIC_API_MANIFEST_PATH = path.join(
    REPO_ROOT,
    'config',
    'architecture',
    'copilot-mcp-public-api-manifest.json',
);
export const MCP_PUBLIC_API_COST_BASELINE_PATH = path.join(
    REPO_ROOT,
    'config',
    'architecture',
    'copilot-mcp-public-api-cost-baseline.json',
);
export const MCP_PUBLIC_PREFIX = '#copilot/mcp/public/';
export const MCP_PUBLIC_API_COST_SCHEMA_VERSION = 1;

/** @param {string} file */
async function readJson(file) {
    return JSON.parse(await readFile(file, 'utf8'));
}

/** @param {unknown} value @param {string} [label] */
export function requireConfigObject(value, label = 'configuration') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object.`);
    return /** @type {Record<string, unknown>} */ (value);
}

/** @param {unknown} value */
function requireManifestEntries(value) {
    if (!Array.isArray(value)) throw new Error('manifest.entries must be an array.');
    return value.map((entry, index) => {
        const row = requireConfigObject(entry, `manifest.entries[${index}]`);
        if (typeof row.alias !== 'string' || typeof row.target !== 'string' || typeof row.costTier !== 'string') {
            throw new Error(`manifest.entries[${index}] is missing alias/target/costTier.`);
        }
        return Object.freeze({
            alias: row.alias,
            target: row.target,
            costTier: row.costTier,
            coldImport: row.coldImport === true,
        });
    });
}

/** @param {unknown} value */
function requireBaselineEntries(value) {
    if (!Array.isArray(value)) throw new Error('baseline.entries must be an array.');
    return value.map((entry, index) => {
        const row = requireConfigObject(entry, `baseline.entries[${index}]`);
        if (
            typeof row.alias !== 'string' ||
            !Number.isSafeInteger(row.moduleCount) ||
            !Number.isSafeInteger(row.maxModuleCount) ||
            !Number.isSafeInteger(row.sourceBytes) ||
            !Number.isSafeInteger(row.maxSourceBytes) ||
            !Array.isArray(row.externalPackages) ||
            !row.externalPackages.every((item) => typeof item === 'string')
        ) {
            throw new Error(`baseline.entries[${index}] is invalid.`);
        }
        return Object.freeze({
            alias: row.alias,
            moduleCount: Number(row.moduleCount),
            maxModuleCount: Number(row.maxModuleCount),
            sourceBytes: Number(row.sourceBytes),
            maxSourceBytes: Number(row.maxSourceBytes),
            externalPackages: Object.freeze(/** @type {string[]} */ ([...row.externalPackages])),
        });
    });
}

/** @param {Record<string, unknown>} raw */
function requireTierLimits(raw) {
    /** @type {Record<string, {maxModules:number|null;maxSourceBytes:number|null}>} */
    const result = {};
    for (const [name, rawTier] of Object.entries(raw)) {
        const tier = requireConfigObject(rawTier, `tierLimits.${name}`);
        const maxModules = tier.maxModules === null ? null : Number(tier.maxModules);
        const maxSourceBytes = tier.maxSourceBytes === null ? null : Number(tier.maxSourceBytes);
        if (
            (maxModules !== null && (!Number.isSafeInteger(maxModules) || maxModules < 1)) ||
            (maxSourceBytes !== null && (!Number.isSafeInteger(maxSourceBytes) || maxSourceBytes < 1))
        ) {
            throw new Error(`Invalid MCP public API cost tier: ${name}`);
        }
        result[name] = Object.freeze({ maxModules, maxSourceBytes });
    }
    return Object.freeze(result);
}

export async function loadMcpPublicApiCostConfiguration() {
    const [packageJsonRaw, manifestRaw, baselineRaw] = await Promise.all([
        readJson(path.join(REPO_ROOT, 'package.json')),
        readJson(MCP_PUBLIC_API_MANIFEST_PATH),
        readJson(MCP_PUBLIC_API_COST_BASELINE_PATH),
    ]);
    const packageJson = requireConfigObject(packageJsonRaw, 'package.json');
    const manifestObject = requireConfigObject(manifestRaw, 'manifest');
    const baselineObject = requireConfigObject(baselineRaw, 'baseline');
    if (
        manifestObject.schemaVersion !== MCP_PUBLIC_API_COST_SCHEMA_VERSION ||
        manifestObject.kind !== 'copilot-mcp-public-api-cost-manifest'
    ) {
        throw new Error('Unsupported MCP public API manifest schema/kind.');
    }
    if (
        baselineObject.schemaVersion !== MCP_PUBLIC_API_COST_SCHEMA_VERSION ||
        baselineObject.kind !== 'copilot-mcp-public-api-cost-baseline'
    ) {
        throw new Error('Unsupported MCP public API baseline schema/kind.');
    }
    return Object.freeze({
        packageJson,
        manifest: Object.freeze(requireManifestEntries(manifestObject.entries)),
        baseline: Object.freeze(requireBaselineEntries(baselineObject.entries)),
        tierLimits: requireTierLimits(requireConfigObject(manifestObject.tierLimits, 'manifest.tierLimits')),
        baselineObject,
    });
}

/** @param {Record<string, unknown>} packageJson */
export function packageMcpPublicAliases(packageJson) {
    const imports = requireConfigObject(packageJson.imports, 'package.json#imports');
    return Object.freeze(
        Object.entries(imports)
            .filter(([alias]) => alias.startsWith(MCP_PUBLIC_PREFIX))
            .map(([alias, target]) => {
                if (typeof target !== 'string')
                    throw new Error(`MCP public alias must resolve to one string target: ${alias}`);
                return Object.freeze({ alias, target });
            })
            .sort((left, right) => left.alias.localeCompare(right.alias)),
    );
}

/**
 * @param {readonly {alias:string;target:string}[]} packageAliases
 * @param {readonly {alias:string;target:string}[]} manifest
 */
export function validateMcpPublicApiManifestBijection(packageAliases, manifest) {
    /** @type {string[]} */
    const violations = [];
    const packageByAlias = new Map(packageAliases.map((entry) => [entry.alias, entry.target]));
    const manifestByAlias = new Map();
    for (const descriptor of manifest) {
        if (manifestByAlias.has(descriptor.alias)) violations.push(`duplicate-manifest-alias:${descriptor.alias}`);
        manifestByAlias.set(descriptor.alias, descriptor.target);
        const actualTarget = packageByAlias.get(descriptor.alias);
        if (!actualTarget) violations.push(`manifest-alias-not-in-package:${descriptor.alias}`);
        else if (actualTarget !== descriptor.target)
            violations.push(`target-drift:${descriptor.alias}:${descriptor.target}!=${actualTarget}`);
    }
    for (const entry of packageAliases) {
        if (!manifestByAlias.has(entry.alias)) violations.push(`package-alias-not-in-manifest:${entry.alias}`);
    }
    return Object.freeze(violations.sort());
}
