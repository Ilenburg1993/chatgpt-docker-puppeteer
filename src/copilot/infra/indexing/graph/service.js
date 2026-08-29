// @ts-check
/**
 * Pure module-graph construction and graph algorithms over indexed repository facts.
 *
 * Physical IO and parsing are intentionally absent here. Callers provide index rows plus one canonical local-module
 * resolver snapshot. The resulting graph is deterministic for that input snapshot and can be reused by dependencies,
 * dependents, cycle, reachability and change-impact projections.
 *
 * @module copilot/infra/indexing/graph/service
 */

import { relative, resolve as resolvePath } from 'node:path';

/**
 * @typedef {{filePath:string;extension?:string;metadataJson?:string|null}} IndexedFileRow
 * @typedef {{filePath:string;relativePath?:string;source:string;specifiersJson?:string;isDynamic?:number;line?:number}} IndexedImportRow
 * @typedef {{source:string;target:string;sourceSpecifier:string;line:number;dynamic:boolean;strategy:string}} ModuleGraphEdge
 * @typedef {{source:string;sourceSpecifier:string;line:number;dynamic:boolean;strategy:string;candidates:string[]}} UnresolvedModuleGraphEdge
 * @typedef {{
 *   workspaceRoot:string;
 *   scopeRoot:string;
 *   packageImportsHash:string|null;
 *   nodes:readonly string[];
 *   nodeSet:ReadonlySet<string>;
 *   relativeByPath:ReadonlyMap<string,string>;
 *   outgoing:ReadonlyMap<string,readonly ModuleGraphEdge[]>;
 *   incoming:ReadonlyMap<string,readonly ModuleGraphEdge[]>;
 *   unresolvedLocal:readonly UnresolvedModuleGraphEdge[];
 *   externalImportCount:number;
 *   dynamicEdgeCount:number;
 *   importRowCount:number;
 * }} IndexedModuleGraph
 */

/** @param {string} root @param {string} candidate */
function isInside(root, candidate) {
    const rel = relative(root, candidate).replace(/\\/gu, '/');
    return rel === '' || (!rel.startsWith('../') && rel !== '..');
}

/** @param {string} workspaceRoot @param {string} absolutePath */
function projectRelativePath(workspaceRoot, absolutePath) {
    const rel = relative(workspaceRoot, absolutePath).replace(/\\/gu, '/');
    return rel || '.';
}

/**
 * @param {{
 *   workspaceRoot:string;
 *   scopeRoot:string;
 *   fileRows:readonly IndexedFileRow[];
 *   importRows:readonly IndexedImportRow[];
 *   moduleResolver:Awaited<ReturnType<typeof import('../module-resolution/index.js').createLocalModuleResolver>>;
 * }} input
 * @returns {IndexedModuleGraph}
 */
export function buildIndexedModuleGraph({ workspaceRoot, scopeRoot, fileRows, importRows, moduleResolver }) {
    const normalizedWorkspaceRoot = resolvePath(workspaceRoot);
    const normalizedScopeRoot = resolvePath(scopeRoot);
    const nodes = [...new Set(fileRows.map((row) => resolvePath(row.filePath)).filter((path) => isInside(normalizedScopeRoot, path)))].sort();
    const nodeSet = new Set(nodes);
    /** @type {Map<string,string>} */
    const relativeByPath = new Map(nodes.map((path) => [path, projectRelativePath(normalizedWorkspaceRoot, path)]));
    /** @type {Map<string,ModuleGraphEdge[]>} */
    const outgoing = new Map(nodes.map((path) => [path, []]));
    /** @type {Map<string,ModuleGraphEdge[]>} */
    const incoming = new Map(nodes.map((path) => [path, []]));
    /** @type {UnresolvedModuleGraphEdge[]} */
    const unresolvedLocal = [];
    let externalImportCount = 0;
    let dynamicEdgeCount = 0;
    let importRowCount = 0;

    for (const row of importRows) {
        const sourcePath = resolvePath(String(row.filePath ?? ''));
        if (!nodeSet.has(sourcePath)) continue;
        importRowCount += 1;
        const sourceSpecifier = String(row.source ?? '').trim();
        const dynamic = Number(row.isDynamic ?? 0) === 1;
        const resolution = moduleResolver.resolve(sourcePath, sourceSpecifier);
        if (!resolution.local) {
            externalImportCount += 1;
            continue;
        }
        if (!resolution.resolved) {
            unresolvedLocal.push({
                source: sourcePath,
                sourceSpecifier,
                line: Number(row.line ?? 0),
                dynamic,
                strategy: resolution.strategy,
                candidates: [],
            });
            continue;
        }
        const target = resolution.candidates.find((candidate) => nodeSet.has(resolvePath(candidate)));
        if (!target) {
            unresolvedLocal.push({
                source: sourcePath,
                sourceSpecifier,
                line: Number(row.line ?? 0),
                dynamic,
                strategy: resolution.strategy,
                candidates: resolution.candidates,
            });
            continue;
        }
        const normalizedTarget = resolvePath(target);
        const edge = {
            source: sourcePath,
            target: normalizedTarget,
            sourceSpecifier,
            line: Number(row.line ?? 0),
            dynamic,
            strategy: resolution.strategy,
        };
        outgoing.get(sourcePath)?.push(edge);
        incoming.get(normalizedTarget)?.push(edge);
        if (dynamic) dynamicEdgeCount += 1;
    }

    for (const edges of outgoing.values()) {
        edges.sort((left, right) => left.target.localeCompare(right.target) || left.line - right.line);
    }
    for (const edges of incoming.values()) {
        edges.sort((left, right) => left.source.localeCompare(right.source) || left.line - right.line);
    }

    return Object.freeze({
        workspaceRoot: normalizedWorkspaceRoot,
        scopeRoot: normalizedScopeRoot,
        packageImportsHash: moduleResolver.packageImportsHash,
        nodes: Object.freeze(nodes),
        nodeSet,
        relativeByPath,
        outgoing,
        incoming,
        unresolvedLocal: Object.freeze(unresolvedLocal),
        externalImportCount,
        dynamicEdgeCount,
        importRowCount,
    });
}

/** @param {IndexedModuleGraph} graph @param {string} absolutePath */
export function graphRelativePath(graph, absolutePath) {
    return graph.relativeByPath.get(absolutePath) ?? projectRelativePath(graph.workspaceRoot, absolutePath);
}

/**
 * @param {IndexedModuleGraph} graph
 * @param {string} startPath
 * @param {'dependencies'|'dependents'} direction
 * @param {{maxDepth?:number;includeStart?:boolean}} [options]
 */
export function traverseModuleGraph(graph, startPath, direction, options = {}) {
    const normalizedStart = resolvePath(startPath);
    if (!graph.nodeSet.has(normalizedStart)) return [];
    const maxDepth = Math.max(1, Math.min(1000, Math.floor(options.maxDepth ?? 1)));
    const adjacency = direction === 'dependencies' ? graph.outgoing : graph.incoming;
    /** @type {{path:string;distance:number}[]} */
    const rows = options.includeStart === true ? [{ path: normalizedStart, distance: 0 }] : [];
    const visited = new Set([normalizedStart]);
    const queue = [{ path: normalizedStart, distance: 0 }];
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
        const current = queue[cursor];
        if (!current || current.distance >= maxDepth) continue;
        const edges = adjacency.get(current.path) ?? [];
        for (const edge of edges) {
            const candidate = direction === 'dependencies' ? edge.target : edge.source;
            if (visited.has(candidate)) continue;
            visited.add(candidate);
            const distance = current.distance + 1;
            queue.push({ path: candidate, distance });
            rows.push({ path: candidate, distance });
        }
    }
    return rows.sort((left, right) => left.distance - right.distance || left.path.localeCompare(right.path));
}

/**
 * Tarjan strongly-connected components. Only SCCs that are true cycles are returned: size > 1 or one self-loop.
 *
 * @param {IndexedModuleGraph} graph
 * @returns {string[][]}
 */
export function findModuleGraphCycles(graph) {
    let nextIndex = 0;
    /** @type {Map<string,number>} */
    const indexByNode = new Map();
    /** @type {Map<string,number>} */
    const lowLinkByNode = new Map();
    /** @type {string[]} */
    const stack = [];
    const onStack = new Set();
    /** @type {string[][]} */
    const components = [];

    /** @param {string} node */
    function strongConnect(node) {
        const index = nextIndex;
        nextIndex += 1;
        indexByNode.set(node, index);
        lowLinkByNode.set(node, index);
        stack.push(node);
        onStack.add(node);

        for (const edge of graph.outgoing.get(node) ?? []) {
            const target = edge.target;
            if (!indexByNode.has(target)) {
                strongConnect(target);
                lowLinkByNode.set(node, Math.min(lowLinkByNode.get(node) ?? index, lowLinkByNode.get(target) ?? index));
            } else if (onStack.has(target)) {
                lowLinkByNode.set(node, Math.min(lowLinkByNode.get(node) ?? index, indexByNode.get(target) ?? index));
            }
        }

        if ((lowLinkByNode.get(node) ?? -1) !== (indexByNode.get(node) ?? -2)) return;
        /** @type {string[]} */
        const component = [];
        while (stack.length > 0) {
            const member = stack.pop();
            if (!member) break;
            onStack.delete(member);
            component.push(member);
            if (member === node) break;
        }
        const selfLoop = component.length === 1 && (graph.outgoing.get(component[0] ?? '') ?? []).some((edge) => edge.target === component[0]);
        if (component.length > 1 || selfLoop) components.push(component.sort());
    }

    for (const node of graph.nodes) {
        if (!indexByNode.has(node)) strongConnect(node);
    }
    return components.sort((left, right) => right.length - left.length || (left[0] ?? '').localeCompare(right[0] ?? ''));
}

/**
 * Find one shortest dependency path from `fromPath` to `toPath` using BFS.
 *
 * @param {IndexedModuleGraph} graph
 * @param {string} fromPath
 * @param {string} toPath
 * @param {{maxDepth?:number}} [options]
 * @returns {string[] | null}
 */
export function findModuleGraphPath(graph, fromPath, toPath, options = {}) {
    const from = resolvePath(fromPath);
    const to = resolvePath(toPath);
    if (!graph.nodeSet.has(from) || !graph.nodeSet.has(to)) return null;
    if (from === to) return [from];
    const maxDepth = Math.max(1, Math.min(1000, Math.floor(options.maxDepth ?? 50)));
    const queue = [{ path: from, depth: 0 }];
    const visited = new Set([from]);
    /** @type {Map<string,string>} */
    const previous = new Map();
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
        const current = queue[cursor];
        if (!current || current.depth >= maxDepth) continue;
        for (const edge of graph.outgoing.get(current.path) ?? []) {
            if (visited.has(edge.target)) continue;
            visited.add(edge.target);
            previous.set(edge.target, current.path);
            if (edge.target === to) {
                const path = [to];
                let step = to;
                while (previous.has(step)) {
                    const prior = previous.get(step);
                    if (!prior) break;
                    path.push(prior);
                    step = prior;
                }
                return path.reverse();
            }
            queue.push({ path: edge.target, depth: current.depth + 1 });
        }
    }
    return null;
}

/** @param {IndexedModuleGraph} graph */
export function summarizeModuleGraph(graph) {
    const cycles = findModuleGraphCycles(graph);
    const degrees = graph.nodes.map((path) => ({
        path,
        outDegree: (graph.outgoing.get(path) ?? []).length,
        inDegree: (graph.incoming.get(path) ?? []).length,
    }));
    const edgeCount = degrees.reduce((sum, row) => sum + row.outDegree, 0);
    const topDependencies = [...degrees]
        .sort((left, right) => right.outDegree - left.outDegree || left.path.localeCompare(right.path))
        .slice(0, 20);
    const topDependents = [...degrees]
        .sort((left, right) => right.inDegree - left.inDegree || left.path.localeCompare(right.path))
        .slice(0, 20);
    return {
        nodeCount: graph.nodes.length,
        edgeCount,
        importRowCount: graph.importRowCount,
        externalImportCount: graph.externalImportCount,
        unresolvedLocalCount: graph.unresolvedLocal.length,
        dynamicEdgeCount: graph.dynamicEdgeCount,
        cycleComponentCount: cycles.length,
        cyclicNodeCount: cycles.reduce((sum, component) => sum + component.length, 0),
        topDependencies,
        topDependents,
    };
}

/**
 * Reverse dependency closure for one or more changed files. Distances use the nearest seed.
 *
 * @param {IndexedModuleGraph} graph
 * @param {readonly string[]} seedPaths
 * @param {{maxDepth?:number;includeSeeds?:boolean}} [options]
 */
export function computeModuleChangeImpact(graph, seedPaths, options = {}) {
    const maxDepth = Math.max(1, Math.min(1000, Math.floor(options.maxDepth ?? 1000)));
    const seeds = [...new Set(seedPaths.map((path) => resolvePath(path)).filter((path) => graph.nodeSet.has(path)))].sort();
    /** @type {Map<string,number>} */
    const distanceByPath = new Map(seeds.map((path) => [path, 0]));
    const queue = seeds.map((path) => ({ path, distance: 0 }));
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
        const current = queue[cursor];
        if (!current || current.distance >= maxDepth) continue;
        for (const edge of graph.incoming.get(current.path) ?? []) {
            const nextDistance = current.distance + 1;
            const previousDistance = distanceByPath.get(edge.source);
            if (previousDistance !== undefined && previousDistance <= nextDistance) continue;
            distanceByPath.set(edge.source, nextDistance);
            queue.push({ path: edge.source, distance: nextDistance });
        }
    }
    return [...distanceByPath.entries()]
        .filter(([, distance]) => options.includeSeeds === true || distance > 0)
        .map(([path, distance]) => ({ path, distance, seed: distance === 0 }))
        .sort((left, right) => left.distance - right.distance || left.path.localeCompare(right.path));
}
