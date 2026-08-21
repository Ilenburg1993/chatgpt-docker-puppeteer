// @ts-check
/**
 * Shared Babel AST primitives for Copilot filesystem boundary guards.
 *
 * This module intentionally understands only how node:fs capabilities are bound and invoked. Policy (read vs mutation,
 * low-level roots, exact exceptions and debt) belongs to the individual guards.
 */

import { parse as babelParse } from '@babel/parser';
import * as t from '@babel/types';

import { formatBabelParserError, resolveBabelParserOptions } from '#copilot/infra/public/diagnostic/code-analysis';

export const FS_MODULES = new Set(['node:fs', 'node:fs/promises', 'fs', 'fs/promises']);

/** @param {string} value */
export function slash(value) {
    return value.replace(/\\/gu, '/');
}

/** @param {string} filePath */
function parserLanguage(filePath) {
    return /\.(?:ts|mts|cts|tsx)$/iu.test(filePath) ? /** @type {const} */ ('ts') : /** @type {const} */ ('js');
}

/** @param {t.Node} root @param {(node: t.Node) => void} visitor */
export function walkAst(root, visitor) {
    /** @type {t.Node[]} */
    const stack = [root];
    const seen = new WeakSet();
    while (stack.length > 0) {
        const node = stack.pop();
        if (!node || seen.has(node)) continue;
        seen.add(node);
        visitor(node);
        for (const [key, value] of Object.entries(
            /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (node)),
        )) {
            if (
                key === 'loc' ||
                key === 'start' ||
                key === 'end' ||
                key === 'extra' ||
                key === 'errors' ||
                key.endsWith('Comments')
            ) {
                continue;
            }
            if (Array.isArray(value)) {
                for (const child of value) if (t.isNode(child)) stack.push(child);
            } else if (t.isNode(value)) {
                stack.push(value);
            }
        }
    }
}

/**
 * @param {t.Expression
 *     | t.V8IntrinsicIdentifier
 *     | t.JSXNamespacedName
 *     | t.ArgumentPlaceholder
 *     | t.SpreadElement
 *     | null
 *     | undefined} value
 */
export function unwrapExpression(value) {
    let current = value;
    while (current) {
        if (t.isAwaitExpression(current)) {
            current = current.argument;
            continue;
        }
        if (t.isTSAsExpression(current) || t.isTSTypeAssertion(current)) {
            current = current.expression;
            continue;
        }
        break;
    }
    return current;
}

/** @param {t.CallExpression} call */
function requireFsModule(call) {
    if (!t.isIdentifier(call.callee, { name: 'require' })) return null;
    const first = call.arguments[0];
    return t.isStringLiteral(first) && FS_MODULES.has(first.value) ? first.value : null;
}

/**
 * @param {string} source
 * @param {string} filePath workspace-relative path
 */
export function parseCopilotFsSource(source, filePath) {
    const normalizedFile = slash(filePath);
    const ast = babelParse(
        source,
        resolveBabelParserOptions(normalizedFile, parserLanguage(normalizedFile), { profile: 'structure' }),
    );
    const parseErrors = (ast.errors ?? []).map((error) => formatBabelParserError(error));
    /** @type {Map<string, string>} */
    const directBindings = new Map();
    /** @type {Set<string>} */
    const namespaceBindings = new Set();

    for (const statement of ast.program.body) {
        if (!t.isImportDeclaration(statement) || !FS_MODULES.has(statement.source.value)) continue;
        for (const specifier of statement.specifiers) {
            if (t.isImportDefaultSpecifier(specifier) || t.isImportNamespaceSpecifier(specifier)) {
                namespaceBindings.add(specifier.local.name);
                continue;
            }
            if (!t.isImportSpecifier(specifier)) continue;
            const imported = t.isIdentifier(specifier.imported) ? specifier.imported.name : specifier.imported.value;
            // `import { promises as fs } from 'node:fs'` creates a promises namespace, not a direct operation.
            if (imported === 'promises') namespaceBindings.add(specifier.local.name);
            else directBindings.set(specifier.local.name, imported);
        }
    }

    // Handle CJS islands, including both `const fs = require('node:fs')` and destructuring aliases.
    walkAst(ast.program, (node) => {
        if (!t.isVariableDeclarator(node) || node.init === null) return;
        const init = unwrapExpression(/** @type {t.Expression} */ (node.init));
        if (t.isCallExpression(init) && requireFsModule(init)) {
            if (t.isIdentifier(node.id)) namespaceBindings.add(node.id.name);
            if (!t.isObjectPattern(node.id)) return;
            for (const property of node.id.properties) {
                if (!t.isObjectProperty(property) || property.computed || !t.isIdentifier(property.key)) continue;
                if (t.isIdentifier(property.value)) directBindings.set(property.value.name, property.key.name);
                else if (t.isAssignmentPattern(property.value) && t.isIdentifier(property.value.left)) {
                    directBindings.set(property.value.left.name, property.key.name);
                }
            }
            return;
        }
        if (
            t.isMemberExpression(init) &&
            !init.computed &&
            t.isIdentifier(init.property, { name: 'promises' }) &&
            t.isCallExpression(init.object) &&
            requireFsModule(init.object) &&
            t.isIdentifier(node.id)
        ) {
            namespaceBindings.add(node.id.name);
        }
    });

    return { ast, normalizedFile, directBindings, namespaceBindings, parseErrors };
}

/** @param {t.CallExpression} call @param {Map<string, string>} directBindings @param {Set<string>} namespaceBindings */
export function fsOperationForCall(call, directBindings, namespaceBindings) {
    const callee = call.callee;
    if (t.isIdentifier(callee)) return directBindings.get(callee.name) ?? null;
    if (
        !t.isMemberExpression(callee) ||
        callee.computed ||
        !t.isIdentifier(callee.object) ||
        !t.isIdentifier(callee.property)
    ) {
        return null;
    }
    return namespaceBindings.has(callee.object.name) ? callee.property.name : null;
}
