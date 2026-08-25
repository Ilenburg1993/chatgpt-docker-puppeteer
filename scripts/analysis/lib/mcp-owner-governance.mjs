// @ts-check
/**
 * Derived owner ontology for MCP architecture governance.
 *
 * Static owner dependencies are derived from real ESM import/re-export edges using the same resolver that powers
 * public import-closure cost accounting. Dynamic/computed/process edges remain governed by their dedicated manifest.
 */

import { createStaticImportClosureAnalyzer, listStaticModuleEdges } from '#copilot/infra/public/diagnostic/governance';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const MCP_ROOT = 'src/copilot/mcp';
const MODULE_EXTENSIONS = new Set(['.cjs', '.js', '.mjs']);

/** @param {string} value */
function normalizePath(value) {
    return value.replaceAll('\\', '/').replace(/^\.\//u, '');
}

/** @param {unknown} value */
function asRecord(value) {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? /** @type {Record<string, unknown>} */ (value)
        : {};
}

/** @param {unknown} raw */
function readOwners(raw) {
    const manifest = asRecord(raw);
    if (!Array.isArray(manifest.owners)) throw new Error('MCP owner manifest owners must be an array.');
    return manifest.owners
        .map((row, index) => {
            const record = asRecord(row);
            if (typeof record.ownerId !== 'string' || typeof record.path !== 'string') {
                throw new Error(`owners[${index}] is missing ownerId/path.`);
            }
            return Object.freeze({
                ownerId: record.ownerId,
                path: normalizePath(record.path),
                kind: typeof record.kind === 'string' ? record.kind : 'unknown',
                declaredAudiences: Array.isArray(record.audiences)
                    ? record.audiences.filter((value) => typeof value === 'string').sort()
                    : [],
                declaredAuthorityClasses: Array.isArray(record.authorityClasses)
                    ? record.authorityClasses.filter((value) => typeof value === 'string').sort()
                    : [],
                declaredPolicyHooks: Array.isArray(record.policyHooks)
                    ? record.policyHooks.filter((value) => typeof value === 'string').sort()
                    : [],
                declaredAllowedDependencies: Array.isArray(record.allowedDependencies)
                    ? record.allowedDependencies.filter((value) => typeof value === 'string').sort()
                    : [],
            });
        })
        .sort((left, right) => right.path.length - left.path.length || left.ownerId.localeCompare(right.ownerId));
}

/** @param {readonly {ownerId:string;path:string;kind?:string}[]} owners @param {string} target */
function resolveOwner(owners, target) {
    const normalizedTarget = normalizePath(target);
    return (
        owners.find((owner) => normalizedTarget === owner.path || normalizedTarget.startsWith(`${owner.path}/`)) ?? null
    );
}

/** @param {{ownerId:string;kind?:string} | null} owner */
function isSpecificConcreteOwner(owner) {
    return owner !== null && owner.ownerId !== 'mcp' && owner.kind === 'owner';
}

/** @param {{ownerId:string;kind?:string} | null} owner */
function isSpecificAuthorityOwner(owner) {
    return owner !== null && owner.ownerId !== 'mcp' && (owner.kind === 'owner' || owner.kind === 'entrypoint-space');
}

/** @param {string} root */
function collectModuleFiles(root) {
    /** @type {string[]} */
    const files = [];
    if (!existsSync(root)) return files;
    /** @param {string} current */
    function walk(current) {
        for (const entry of readdirSync(current, { withFileTypes: true })) {
            const target = path.join(current, entry.name);
            if (entry.isDirectory()) {
                walk(target);
                continue;
            }
            if (MODULE_EXTENSIONS.has(path.extname(entry.name))) files.push(target);
        }
    }
    walk(root);
    return files.sort();
}

/** @param {Map<string, Set<string>>} map @param {string} key @param {string} value */
function addToSetMap(map, key, value) {
    const values = map.get(key) ?? new Set();
    values.add(value);
    map.set(key, values);
}

/** @param {Map<string, Set<string>>} map @param {string} key */
function sortedValues(map, key) {
    return [...(map.get(key) ?? new Set())].sort();
}

/** @param {unknown} raw */
function listConfigAuthorityPaths(raw) {
    const authorities = asRecord(asRecord(raw).authorities);
    /** @type {string[]} */
    const paths = [];
    for (const rows of Object.values(authorities)) {
        if (!Array.isArray(rows)) continue;
        for (const row of rows) {
            const candidate = asRecord(row).path;
            if (typeof candidate === 'string') paths.push(normalizePath(candidate));
        }
    }
    return paths;
}

/** @param {unknown} raw */
function listStatePaths(raw) {
    const entries = asRecord(raw).entries;
    if (!Array.isArray(entries)) return [];
    return entries
        .map((entry) => asRecord(entry).path)
        .filter((value) => typeof value === 'string')
        .map((value) => normalizePath(/** @type {string} */ (value)));
}

/** @param {unknown} raw */
function listProcessAuthorityPaths(raw) {
    const rows = asRecord(raw).childProcessAuthorities;
    if (!Array.isArray(rows)) return [];
    return rows
        .map((entry) => asRecord(entry).path)
        .filter((value) => typeof value === 'string')
        .map((value) => normalizePath(/** @type {string} */ (value)));
}

/** @param {unknown} raw */
function listCostTargets(raw) {
    const entries = asRecord(raw).entries;
    if (!Array.isArray(entries)) return [];
    return entries
        .map((entry) => asRecord(entry).target)
        .filter((value) => typeof value === 'string')
        .map((value) => normalizePath(/** @type {string} */ (value)));
}

/** @param {unknown} raw */
function listPackageSurfaces(raw) {
    const imports = asRecord(asRecord(raw).imports);
    return Object.entries(imports)
        .filter(
            ([alias, target]) =>
                typeof target === 'string' &&
                (alias.startsWith('#copilot/mcp/public/') || alias.startsWith('#copilot/testing/mcp/')),
        )
        .map(([alias, target]) => ({
            alias,
            target: normalizePath(/** @type {string} */ (target)),
            audience: alias.startsWith('#copilot/mcp/public/') ? 'public' : 'testing',
        }))
        .sort((left, right) => left.alias.localeCompare(right.alias));
}

/** @param {readonly string[]} nodes @param {Map<string, Set<string>>} edges */
function stronglyConnectedComponents(nodes, edges) {
    let nextIndex = 0;
    /** @type {string[]} */
    const stack = [];
    const onStack = new Set();
    const indices = new Map();
    const lowLinks = new Map();
    /** @type {string[][]} */
    const components = [];

    /** @param {string} node */
    function visit(node) {
        indices.set(node, nextIndex);
        lowLinks.set(node, nextIndex);
        nextIndex += 1;
        stack.push(node);
        onStack.add(node);
        for (const target of edges.get(node) ?? []) {
            if (!indices.has(target)) {
                visit(target);
                lowLinks.set(node, Math.min(lowLinks.get(node) ?? 0, lowLinks.get(target) ?? 0));
            } else if (onStack.has(target)) {
                lowLinks.set(node, Math.min(lowLinks.get(node) ?? 0, indices.get(target) ?? 0));
            }
        }
        if (lowLinks.get(node) !== indices.get(node)) return;
        /** @type {string[]} */
        const component = [];
        let current;
        do {
            current = stack.pop();
            if (!current) break;
            onStack.delete(current);
            component.push(current);
        } while (current !== node);
        if (component.length > 1) components.push(component.sort());
    }

    for (const node of nodes) if (!indices.has(node)) visit(node);
    return components.sort((left, right) => left.join(':').localeCompare(right.join(':')));
}

/**
 * @param {{
 *   repoRoot:string;
 *   packageJson:unknown;
 *   ownerManifest:unknown;
 *   configAuthorityManifest:unknown;
 *   stateScopeManifest:unknown;
 *   dynamicGraphManifest:unknown;
 *   publicApiManifest:unknown;
 * }} options
 */
export function buildMcpOwnerGovernanceProjection(options) {
    const repoRoot = path.resolve(options.repoRoot);
    const owners = readOwners(options.ownerManifest);
    const ownerIds = new Set(owners.map((owner) => owner.ownerId));
    const analyzer = createStaticImportClosureAnalyzer({
        repoRoot,
        packageImports: asRecord(asRecord(options.packageJson).imports),
    });
    const audiencesByOwner = new Map();
    const hooksByOwner = new Map();
    const authoritiesByOwner = new Map();
    const dependenciesByOwner = new Map();
    /** @type {Map<string, {source:string;target:string;specifier:string;edgeKind:string}[]>} */
    const dependencyEvidence = new Map();
    /** @type {string[]} */
    const violations = [];

    for (const surface of listPackageSurfaces(options.packageJson)) {
        const owner = resolveOwner(owners, surface.target);
        if (!isSpecificConcreteOwner(owner)) {
            violations.push(`surface-without-specific-owner:${surface.alias}:${surface.target}`);
            continue;
        }
        addToSetMap(audiencesByOwner, owner.ownerId, surface.audience);
        addToSetMap(hooksByOwner, owner.ownerId, 'surface');
        addToSetMap(authoritiesByOwner, owner.ownerId, `${surface.audience}-surface`);
    }

    for (const target of listCostTargets(options.publicApiManifest)) {
        const owner = resolveOwner(owners, target);
        if (!isSpecificConcreteOwner(owner)) violations.push(`cost-target-without-specific-owner:${target}`);
        else addToSetMap(hooksByOwner, owner.ownerId, 'cost');
    }
    for (const target of listConfigAuthorityPaths(options.configAuthorityManifest)) {
        const owner = resolveOwner(owners, target);
        if (!isSpecificAuthorityOwner(owner)) violations.push(`config-authority-without-specific-owner:${target}`);
        else {
            addToSetMap(hooksByOwner, owner.ownerId, 'config');
            addToSetMap(authoritiesByOwner, owner.ownerId, 'config-authority');
        }
    }
    for (const target of listStatePaths(options.stateScopeManifest)) {
        const owner = resolveOwner(owners, target);
        if (!isSpecificConcreteOwner(owner)) violations.push(`state-scope-without-specific-owner:${target}`);
        else {
            addToSetMap(hooksByOwner, owner.ownerId, 'state');
            addToSetMap(authoritiesByOwner, owner.ownerId, 'mutable-state');
        }
    }
    for (const target of listProcessAuthorityPaths(options.dynamicGraphManifest)) {
        const owner = resolveOwner(owners, target);
        if (!isSpecificAuthorityOwner(owner)) violations.push(`process-authority-without-specific-owner:${target}`);
        else {
            addToSetMap(hooksByOwner, owner.ownerId, 'process');
            addToSetMap(authoritiesByOwner, owner.ownerId, 'process-launcher');
        }
    }

    let parsedFiles = 0;
    let localModuleEdges = 0;
    for (const absoluteFile of collectModuleFiles(path.join(repoRoot, MCP_ROOT))) {
        const sourcePath = normalizePath(path.relative(repoRoot, absoluteFile));
        const sourceOwner = resolveOwner(owners, sourcePath);
        if (!sourceOwner) {
            violations.push(`source-without-owner:${sourcePath}`);
            continue;
        }
        parsedFiles += 1;
        const source = readFileSync(absoluteFile, 'utf8');
        let moduleEdges;
        try {
            moduleEdges = listStaticModuleEdges(source);
        } catch (error) {
            violations.push(`parse-failed:${sourcePath}:${error instanceof Error ? error.message : String(error)}`);
            continue;
        }
        const uniqueEdges = new Map(moduleEdges.map((edge) => [`${edge.kind}:${edge.specifier}`, edge]));
        for (const edge of uniqueEdges.values()) {
            const resolution = analyzer.resolveStaticSpecifier(absoluteFile, edge.specifier);
            if (!resolution) {
                if (edge.specifier.startsWith('.') || edge.specifier.startsWith('#copilot/mcp/')) {
                    violations.push(`unresolved-internal-import:${sourcePath}:${edge.specifier}`);
                }
                continue;
            }
            if (resolution.kind !== 'local') continue;
            const targetPath = normalizePath(path.relative(repoRoot, resolution.path));
            if (targetPath !== MCP_ROOT && !targetPath.startsWith(`${MCP_ROOT}/`)) continue;
            const targetOwner = resolveOwner(owners, targetPath);
            if (!targetOwner) {
                violations.push(`target-without-owner:${sourcePath}:${edge.specifier}:${targetPath}`);
                continue;
            }
            localModuleEdges += 1;
            if (sourceOwner.ownerId !== targetOwner.ownerId) {
                addToSetMap(dependenciesByOwner, sourceOwner.ownerId, targetOwner.ownerId);
                const evidenceKey = `${sourceOwner.ownerId}->${targetOwner.ownerId}`;
                const evidence = dependencyEvidence.get(evidenceKey) ?? [];
                if (evidence.length < 8) {
                    evidence.push({
                        source: sourcePath,
                        target: targetPath,
                        specifier: edge.specifier,
                        edgeKind: edge.kind,
                    });
                    dependencyEvidence.set(evidenceKey, evidence);
                }
            }
        }
    }

    const rows = owners
        .map((owner) => {
            const audiences = sortedValues(audiencesByOwner, owner.ownerId);
            const authorityClasses = sortedValues(authoritiesByOwner, owner.ownerId);
            const policyHooks = sortedValues(hooksByOwner, owner.ownerId);
            const allowedDependencies = sortedValues(dependenciesByOwner, owner.ownerId);
            const mismatch = [];
            if (JSON.stringify(owner.declaredAudiences) !== JSON.stringify(audiences)) mismatch.push('audiences');
            if (JSON.stringify(owner.declaredAuthorityClasses) !== JSON.stringify(authorityClasses)) {
                mismatch.push('authorityClasses');
            }
            if (JSON.stringify(owner.declaredPolicyHooks) !== JSON.stringify(policyHooks)) mismatch.push('policyHooks');
            if (JSON.stringify(owner.declaredAllowedDependencies) !== JSON.stringify(allowedDependencies)) {
                mismatch.push('allowedDependencies');
            }
            return Object.freeze({
                ownerId: owner.ownerId,
                path: owner.path,
                kind: owner.kind,
                audiences,
                authorityClasses,
                policyHooks,
                allowedDependencies,
                declarationMismatch: Object.freeze(mismatch),
            });
        })
        .sort((left, right) => left.ownerId.localeCompare(right.ownerId));

    const graphNodes = [...ownerIds].sort();
    const stronglyConnected = stronglyConnectedComponents(graphNodes, dependenciesByOwner);
    const declarationMismatchCount = rows.reduce(
        (count, row) => count + (row.declarationMismatch.length > 0 ? 1 : 0),
        0,
    );
    return Object.freeze({
        success: violations.length === 0 && stronglyConnected.length === 0 && declarationMismatchCount === 0,
        parsedFiles,
        localModuleEdges,
        ownerCount: rows.length,
        directOwnerDependencyCount: [...dependenciesByOwner.values()].reduce((count, values) => count + values.size, 0),
        stronglyConnectedComponents: Object.freeze(stronglyConnected.map((component) => Object.freeze(component))),
        dependencyEvidence: Object.freeze(
            Object.fromEntries(
                [...dependencyEvidence.entries()]
                    .sort(([left], [right]) => left.localeCompare(right))
                    .map(([key, evidence]) => [key, Object.freeze(evidence.map((entry) => Object.freeze(entry)))]),
            ),
        ),
        declarationMismatchCount,
        violations: Object.freeze(violations.sort()),
        rows: Object.freeze(rows),
    });
}
