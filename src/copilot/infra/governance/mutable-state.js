// @ts-check
/**
 * Static detection/reporting for mutable module-scope infra state.
 * @module copilot/infra/governance/mutable-state
 */

import { parse } from '@babel/parser';
import traverseModule from '@babel/traverse';
import { readFileSync, readdirSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { INFRA_STATE_SCOPE_MANIFEST } from './state-scope-manifest.js';

const traverse = /** @type {typeof import('@babel/traverse').default} */ (traverseModule);
const MUTATING_METHODS = new Set([
    'set',
    'add',
    'delete',
    'clear',
    'push',
    'pop',
    'shift',
    'unshift',
    'splice',
    'sort',
    'reverse',
    'copyWithin',
    'fill',
]);
const STATEFUL_FACTORY_NAME = /^create[A-Z][A-Za-z0-9]*(?:Runtime|Registry|Cache|Store|Bus|Watcher|Writer)$/u;
const DEFAULT_INFRA_ROOT = fileURLToPath(new URL('../', import.meta.url));

/** @param {string} directory @returns {string[]} */
function listJavaScriptFiles(directory) {
    const out = [];
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const absolute = resolve(directory, entry.name);
        if (entry.isDirectory()) out.push(...listJavaScriptFiles(absolute));
        else if (entry.isFile() && entry.name.endsWith('.js')) out.push(absolute);
    }
    return out;
}

/** @typedef {{node:import('@babel/types').Node;parentPath:BabelPathLike|null}} BabelPathLike */
/** @typedef {{kind:string;constantViolations:readonly unknown[];referencePaths:readonly BabelPathLike[];path:{node:import('@babel/types').Node}}} BabelBindingLike */
/** @typedef {{scope:{bindings:Record<string,BabelBindingLike>};stop:()=>void}} BabelProgramPathLike */

/** @param {BabelPathLike} referencePath */
function referenceMutatesBinding(referencePath) {
    let member = referencePath.parentPath;
    if (member?.node.type !== 'MemberExpression') return false;
    while (member.parentPath?.node.type === 'MemberExpression' && member.parentPath.node.object === member.node) {
        member = member.parentPath;
    }
    const memberNode = member.node;
    if (memberNode.type !== 'MemberExpression') return false;
    const parent = member.parentPath;
    if (parent?.node.type === 'AssignmentExpression' && parent.node.left === memberNode) return true;
    if (parent?.node.type === 'UpdateExpression') return true;
    return Boolean(
        parent?.node.type === 'CallExpression' &&
        parent.node.callee === memberNode &&
        !memberNode.computed &&
        memberNode.property.type === 'Identifier' &&
        MUTATING_METHODS.has(memberNode.property.name),
    );
}

/** @param {{node:import('@babel/types').VariableDeclarator}} declaratorPath */
function initializerOwnsStatefulResource(declaratorPath) {
    const initializer = declaratorPath.node.init;
    if (!initializer || initializer.type !== 'CallExpression') return false;
    const callee = initializer.callee;
    return callee.type === 'Identifier' && STATEFUL_FACTORY_NAME.test(callee.name);
}

/**
 * @param {string} source
 * @returns {string[]}
 */
export function listMutableModuleBindings(source) {
    const ast = parse(source, { sourceType: 'module' });
    /** @type {string[]} */
    const mutable = [];
    traverse(ast, {
        Program(/** @type {BabelProgramPathLike} */ programPath) {
            for (const [name, binding] of Object.entries(programPath.scope.bindings)) {
                if (binding.path.node.type !== 'VariableDeclarator') continue;
                const changesBinding =
                    binding.kind === 'let' || binding.kind === 'var' || binding.constantViolations.length > 0;
                const mutatesContainer = binding.referencePaths.some(referenceMutatesBinding);
                const ownsStatefulResource = initializerOwnsStatefulResource(
                    /** @type {{node:import('@babel/types').VariableDeclarator}} */ (binding.path),
                );
                if (changesBinding || mutatesContainer || ownsStatefulResource) mutable.push(name);
            }
            programPath.stop();
        },
    });
    return mutable.sort();
}

/** @param {{ infraRoot?: string }} [options] */
export function findInfraMutableModuleState(options = {}) {
    const infraRoot = resolve(options.infraRoot ?? DEFAULT_INFRA_ROOT);
    return listJavaScriptFiles(infraRoot)
        .map((absolutePath) => ({
            path: relative(infraRoot, absolutePath).replace(/\\/gu, '/'),
            bindings: listMutableModuleBindings(readFileSync(absolutePath, 'utf8')),
        }))
        .filter((entry) => entry.bindings.length > 0)
        .sort((a, b) => a.path.localeCompare(b.path));
}

export function buildInfraMutableStateReport() {
    const detected = findInfraMutableModuleState();
    const detectedByPath = new Map(detected.map((entry) => [entry.path, entry]));
    const manifestByPath = new Map(INFRA_STATE_SCOPE_MANIFEST.map((entry) => [entry.path, entry]));
    const undeclared = detected.filter((entry) => !manifestByPath.has(entry.path));
    const stale = INFRA_STATE_SCOPE_MANIFEST.filter((entry) => !detectedByPath.has(entry.path));
    const invalidScopes = INFRA_STATE_SCOPE_MANIFEST.filter((entry) => entry.scope !== 'process');
    return Object.freeze({
        success: undeclared.length === 0 && stale.length === 0 && invalidScopes.length === 0,
        detected: Object.freeze(detected),
        declared: INFRA_STATE_SCOPE_MANIFEST,
        undeclared: Object.freeze(undeclared),
        stale: Object.freeze(stale),
        invalidScopes: Object.freeze(invalidScopes),
        byScope: Object.freeze({
            process: INFRA_STATE_SCOPE_MANIFEST.filter((entry) => entry.scope === 'process').length,
            runtime: INFRA_STATE_SCOPE_MANIFEST.filter((entry) => entry.scope === 'runtime').length,
            workspace: INFRA_STATE_SCOPE_MANIFEST.filter((entry) => entry.scope === 'workspace').length,
        }),
    });
}
