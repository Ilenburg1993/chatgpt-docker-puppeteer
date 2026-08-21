// @ts-check
/**
 * Grafo de dependências canônico do workspace, independente da API do TypeScript.
 *
 * Usa o mesmo parser Babel adotado pelo runtime de I/O do Copilot e a resolução de módulos do Node. Isso evita manter
 * uma segunda pilha AST apenas para análise arquitetural e permite que o baseline de compilação permaneça TS7+.
 */

import { parse as babelParse } from '@babel/parser';
import { globSync } from 'glob';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import {
    extractBabelFileSymbols,
    formatBabelParserError,
    resolveBabelParserOptions,
} from '#copilot/infra/public/code-analysis';

const SOURCE_GLOB = '**/*.{js,mjs,cjs,jsx,ts,mts,cts,tsx}';
const DEFAULT_IGNORES = Object.freeze([
    '**/node_modules/**',
    '**/.git/**',
    '**/dist/**',
    '**/build/**',
    '**/coverage/**',
    '**/.ai/**',
    '**/.cache/**',
]);

/** @param {string} value */
function slash(value) {
    return value.replace(/\\/gu, '/');
}

/** @param {string} root @param {string} file */
function relativeTo(root, file) {
    return slash(path.relative(root, file));
}

/** @param {string} file */
function parserLanguage(file) {
    return /\.(?:ts|mts|cts|tsx)$/iu.test(file) ? /** @type {const} */ ('ts') : /** @type {const} */ ('js');
}

/** @param {unknown[]} values */
function uniqueStrings(values) {
    return [...new Set(values.filter((value) => typeof value === 'string').map((value) => String(value)))];
}

/** @param {any} ast @returns {{ emits: string[]; listens: string[] }} */
function collectNervEvents(ast) {
    const events = { emits: /** @type {string[]} */ ([]), listens: /** @type {string[]} */ ([]) };
    const seen = new WeakSet();
    /** @type {any[]} */
    const stack = [ast?.program];
    while (stack.length > 0) {
        const node = stack.pop();
        if (!node || typeof node !== 'object' || seen.has(node)) continue;
        seen.add(node);
        if (node.type === 'CallExpression' && node.callee?.type === 'MemberExpression' && !node.callee.computed) {
            const method = node.callee.property?.name;
            const first = node.arguments?.[0];
            const value =
                first?.type === 'StringLiteral' ? first.value : first?.type === 'Literal' ? first.value : null;
            if (typeof value === 'string') {
                if (method === 'emit') events.emits.push(value);
                if (method === 'on') events.listens.push(value);
            }
        }
        for (const [key, value] of Object.entries(node)) {
            if (key === 'loc' || key === 'start' || key === 'end' || key === 'extra' || key.endsWith('Comments'))
                continue;
            if (Array.isArray(value)) stack.push(...value);
            else if (value && typeof value === 'object') stack.push(value);
        }
    }
    return { emits: uniqueStrings(events.emits), listens: uniqueStrings(events.listens) };
}

/** @param {string} fromFile @param {string} specifier @param {string} scopeRoot @param {Set<string>} absoluteFiles */
function resolveInternalImport(fromFile, specifier, scopeRoot, absoluteFiles) {
    if (!specifier || specifier.startsWith('node:')) return { dependency: null, unresolved: false };
    try {
        const requireFromFile = createRequire(pathToFileURL(fromFile));
        const resolved = requireFromFile.resolve(specifier);
        if (!path.isAbsolute(resolved)) return { dependency: null, unresolved: false };
        const normalizedResolved = path.resolve(resolved);
        return {
            dependency: absoluteFiles.has(normalizedResolved) ? relativeTo(scopeRoot, normalizedResolved) : null,
            unresolved: false,
        };
    } catch {
        return { dependency: null, unresolved: specifier.startsWith('.') || specifier.startsWith('#') };
    }
}

/** @param {Record<string, string[]>} graph @returns {string[][]} */
export function findCircularComponents(graph) {
    let index = 0;
    const indexes = new Map();
    const lowLinks = new Map();
    /** @type {string[]} */
    const stack = [];
    const onStack = new Set();
    /** @type {string[][]} */
    const components = [];

    /** @param {string} node */
    function strongConnect(node) {
        indexes.set(node, index);
        lowLinks.set(node, index);
        index += 1;
        stack.push(node);
        onStack.add(node);
        for (const dep of graph[node] ?? []) {
            if (!Object.hasOwn(graph, dep)) continue;
            if (!indexes.has(dep)) {
                strongConnect(dep);
                lowLinks.set(node, Math.min(lowLinks.get(node) ?? 0, lowLinks.get(dep) ?? 0));
            } else if (onStack.has(dep)) {
                lowLinks.set(node, Math.min(lowLinks.get(node) ?? 0, indexes.get(dep) ?? 0));
            }
        }
        if (lowLinks.get(node) !== indexes.get(node)) return;
        /** @type {string[]} */
        const component = [];
        while (stack.length > 0) {
            const current = stack.pop();
            if (typeof current !== 'string') break;
            onStack.delete(current);
            component.push(current);
            if (current === node) break;
        }
        const only = component[0];
        const selfLoop = component.length === 1 && typeof only === 'string' && (graph[only] ?? []).includes(only);
        if (component.length > 1 || selfLoop) components.push(component.sort());
    }

    for (const node of Object.keys(graph).sort()) if (!indexes.has(node)) strongConnect(node);
    return components.sort((left, right) => (left[0] ?? '').localeCompare(right[0] ?? ''));
}

/** @param {Record<string, string[]>} graph */
export function buildReverseDependencyGraph(graph) {
    /** @type {Record<string, string[]>} */
    const reverse = Object.fromEntries(Object.keys(graph).map((file) => [file, []]));
    for (const [from, deps] of Object.entries(graph)) {
        for (const dep of deps) {
            const dependents = reverse[dep];
            if (dependents) dependents.push(from);
        }
    }
    for (const deps of Object.values(reverse)) deps.sort();
    return reverse;
}

/**
 * @typedef {{ file: string; message: string }} GraphParseError
 *
 * @typedef {{ file: string; specifier: string }} UnresolvedLocalImport
 *
 * @typedef {{ emitters: Record<string, string[]>; listeners: Record<string, string[]> }} NervEventMap
 *
 * @typedef {{
 *     scopeRoot: string;
 *     files: string[];
 *     graph: Record<string, string[]>;
 *     reverseGraph: Record<string, string[]>;
 *     cycles: string[][];
 *     orphans: string[];
 *     parseErrors: GraphParseError[];
 *     unresolvedLocalImports: UnresolvedLocalImport[];
 *     nervEvents: NervEventMap;
 * }} DependencyGraphReport
 */

/**
 * @param {string} scope @param {{ workspaceRoot?: string; ignore?: readonly string[] }} [options] @returns
 *   {DependencyGraphReport}
 */
export function buildDependencyGraph(scope = 'src', { workspaceRoot = process.cwd(), ignore = DEFAULT_IGNORES } = {}) {
    const absoluteWorkspaceRoot = path.resolve(workspaceRoot);
    const absoluteScopeRoot = path.resolve(absoluteWorkspaceRoot, scope);
    if (!fs.existsSync(absoluteScopeRoot)) throw new Error(`Dependency graph scope does not exist: ${scope}`);

    const relativeFiles = globSync(SOURCE_GLOB, {
        cwd: absoluteScopeRoot,
        nodir: true,
        dot: false,
        ignore: [...ignore],
    })
        .map(slash)
        .filter((file) => !/\.d\.(?:ts|mts|cts)$/iu.test(file))
        .sort();
    const absoluteFiles = new Set(relativeFiles.map((file) => path.resolve(absoluteScopeRoot, file)));
    /** @type {Record<string, string[]>} */
    const graph = {};
    /** @type {GraphParseError[]} */
    const parseErrors = [];
    /** @type {UnresolvedLocalImport[]} */
    const unresolvedLocalImports = [];
    /** @type {NervEventMap} */
    const nervEvents = { emitters: {}, listeners: {} };

    for (const file of relativeFiles) {
        const absoluteFile = path.resolve(absoluteScopeRoot, file);
        graph[file] = [];
        try {
            const source = fs.readFileSync(absoluteFile, 'utf8');
            const parserOptions = resolveBabelParserOptions(absoluteFile, parserLanguage(file), {
                profile: 'structure',
            });
            const ast = babelParse(source, /** @type {any} */ (parserOptions));
            for (const error of ast.errors ?? []) parseErrors.push({ file, message: formatBabelParserError(error) });
            const extracted = extractBabelFileSymbols(ast);
            const specifiers = uniqueStrings(extracted.imports.map((entry) => entry.source));
            for (const specifier of specifiers) {
                const resolution = resolveInternalImport(absoluteFile, specifier, absoluteScopeRoot, absoluteFiles);
                if (resolution.dependency) graph[file].push(resolution.dependency);
                else if (resolution.unresolved) unresolvedLocalImports.push({ file, specifier });
            }
            graph[file] = uniqueStrings(graph[file]).sort();
            const events = collectNervEvents(ast);
            for (const event of events.emits) (nervEvents.emitters[event] ??= []).push(file);
            for (const event of events.listens) (nervEvents.listeners[event] ??= []).push(file);
        } catch (error) {
            parseErrors.push({ file, message: error instanceof Error ? error.message : String(error) });
        }
    }

    for (const files of Object.values(nervEvents.emitters)) files.sort();
    for (const files of Object.values(nervEvents.listeners)) files.sort();
    const reverseGraph = buildReverseDependencyGraph(graph);
    const cycles = findCircularComponents(graph);
    const orphans = Object.entries(reverseGraph)
        .filter(([, dependents]) => dependents.length === 0)
        .map(([file]) => file)
        .sort();
    return {
        scopeRoot: slash(path.relative(absoluteWorkspaceRoot, absoluteScopeRoot) || '.'),
        files: relativeFiles,
        graph,
        reverseGraph,
        cycles,
        orphans,
        parseErrors,
        unresolvedLocalImports,
        nervEvents,
    };
}
