#!/usr/bin/env node
// @ts-check

import { resolveBabelParserOptions } from '#copilot/infra/public/diagnostic/code-analysis';
import { parse } from '@babel/parser';
import traverseModule from '@babel/traverse';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { listSourceFilesSync } from './lib/source-tree.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const TARGET = path.join(ROOT, 'src', 'copilot');
const CANONICAL_READER = path.join('src', 'copilot', 'infra', 'platform', 'http-response', 'service.js');
const RESPONSE_METHODS = new Set(['arrayBuffer', 'blob', 'formData', 'json', 'text']);
const RESPONSE_CONSUMER_HINT =
    /(?:\.(?:arrayBuffer|blob|formData|json|text)\s*\(|\[\s*['"](?:arrayBuffer|blob|formData|json|text)['"]\s*\]\s*\()/u;
const traverse = traverseModule;

/** @typedef {{ file: string; line: number; method: string; text: string }} Finding */

/** @param {string} dir */
function walk(dir) {
    return listSourceFilesSync(dir, { extensions: ['.js', '.mjs', '.cjs'] });
}

/**
 * @param {unknown} node
 * @returns {any}
 */
function unwrapExpression(node) {
    let current = node;
    while (
        current &&
        typeof current === 'object' &&
        [
            'AwaitExpression',
            'TSAsExpression',
            'TSTypeAssertion',
            'TypeCastExpression',
            'ParenthesizedExpression',
        ].includes(/** @type {{ type?: string }} */ (current).type ?? '')
    ) {
        current =
            /** @type {{ argument?: unknown; expression?: unknown }} */ (current).argument ??
            /** @type {{ expression?: unknown }} */ (current).expression;
    }
    return current;
}

/**
 * @param {unknown} node
 * @returns {boolean}
 */
function isFetchCall(node) {
    const current = unwrapExpression(node);
    if (!current || current.type !== 'CallExpression') return false;
    const callee = unwrapExpression(current.callee);
    if (callee?.type === 'Identifier') return callee.name === 'fetch' || /fetchImpl$/u.test(callee.name);
    if (callee?.type !== 'MemberExpression' && callee?.type !== 'OptionalMemberExpression') return false;
    const property = callee.property;
    return (
        (!callee.computed &&
            property?.type === 'Identifier' &&
            (property.name === 'fetch' || property.name === 'fetchImpl')) ||
        (callee.computed &&
            property?.type === 'StringLiteral' &&
            (property.value === 'fetch' || property.value === 'fetchImpl'))
    );
}

/**
 * @param {unknown} node
 * @returns {unknown[] | null}
 */
function promiseAllInputs(node) {
    const current = unwrapExpression(node);
    if (current?.type !== 'CallExpression') return null;
    const callee = current.callee;
    if (
        callee?.type !== 'MemberExpression' ||
        callee.computed ||
        callee.object?.type !== 'Identifier' ||
        callee.object.name !== 'Promise' ||
        callee.property?.type !== 'Identifier' ||
        callee.property.name !== 'all'
    ) {
        return null;
    }
    const first = current.arguments?.[0];
    return first?.type === 'ArrayExpression' ? (first.elements ?? []) : null;
}

/**
 * @param {unknown} id
 * @param {unknown} init
 * @param {Set<string>} bindings
 */
function collectFetchBindings(id, init, bindings) {
    if (!id || typeof id !== 'object') return;
    const pattern = /** @type {import('@babel/types').LVal} */ (id);
    if (pattern.type === 'Identifier') {
        if (isFetchCall(init)) bindings.add(pattern.name);
        const source = unwrapExpression(init);
        if (source?.type === 'Identifier' && bindings.has(source.name)) bindings.add(pattern.name);
        return;
    }
    if (pattern.type !== 'ArrayPattern') return;
    const inputs = promiseAllInputs(init);
    if (!inputs) return;
    pattern.elements.forEach((element, index) => {
        if (element?.type === 'Identifier' && isFetchCall(inputs[index])) bindings.add(element.name);
    });
}

/**
 * @param {unknown} object
 * @param {Set<string>} fetchBindings
 * @returns {boolean}
 */
function isInboundResponseExpression(object, fetchBindings) {
    const current = unwrapExpression(object);
    if (isFetchCall(current)) return true;
    if (current?.type !== 'Identifier') return false;
    return fetchBindings.has(current.name) || /response$/iu.test(current.name);
}

/**
 * @param {unknown} callee
 * @returns {{ method: string; object: unknown } | null}
 */
function responseConsumer(callee) {
    const current = unwrapExpression(callee);
    if (current?.type !== 'MemberExpression' && current?.type !== 'OptionalMemberExpression') return null;
    const property = current.property;
    const method =
        !current.computed && property?.type === 'Identifier'
            ? property.name
            : current.computed && property?.type === 'StringLiteral'
              ? property.value
              : '';
    return RESPONSE_METHODS.has(method) ? { method, object: current.object } : null;
}

/**
 * @param {{ root?: string; target?: string; allowedFiles?: readonly string[] }} [options]
 * @returns {Finding[]}
 */
export function checkHttpResponseConsumption(options = {}) {
    const root = path.resolve(options.root ?? ROOT);
    const target = path.resolve(options.target ?? TARGET);
    const allowedFiles = new Set(options.allowedFiles ?? [CANONICAL_READER]);
    /** @type {Finding[]} */
    const findings = [];

    for (const file of walk(target)) {
        const relativeFile = path.relative(root, file);
        if (allowedFiles.has(relativeFile)) continue;
        const source = fs.readFileSync(file, 'utf8');
        if (!RESPONSE_CONSUMER_HINT.test(source)) continue;
        const ast = parse(source, resolveBabelParserOptions(file, 'js', { profile: 'structure' }));
        const fetchBindings = new Set();
        /** @type {any[]} */
        const calls = [];
        traverse(ast, {
            VariableDeclarator(/** @type {{ node: import('@babel/types').VariableDeclarator }} */ astPath) {
                collectFetchBindings(astPath.node.id, astPath.node.init, fetchBindings);
            },
            AssignmentExpression(/** @type {{ node: import('@babel/types').AssignmentExpression }} */ astPath) {
                collectFetchBindings(astPath.node.left, astPath.node.right, fetchBindings);
            },
            CallExpression(/** @type {{ node: import('@babel/types').CallExpression }} */ astPath) {
                calls.push(astPath.node);
            },
        });
        const lines = source.split('\n');
        for (const call of calls) {
            const consumer = responseConsumer(call.callee);
            if (!consumer || !isInboundResponseExpression(consumer.object, fetchBindings)) continue;
            const line = call.loc?.start.line ?? 1;
            findings.push({
                file: relativeFile,
                line,
                method: consumer.method,
                text: lines[line - 1]?.trim() ?? `${consumer.method}()`,
            });
        }
    }
    return findings;
}

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isDirectRun) {
    const findings = checkHttpResponseConsumption();
    if (findings.length === 0) {
        console.log('[check-copilot-http-response-consumption] OK - inbound Response bodies use the bounded facade.');
        process.exit(0);
    }
    console.error('[check-copilot-http-response-consumption] Direct inbound Response consumers found:');
    for (const finding of findings) {
        console.error(`- ${finding.file}:${finding.line} [${finding.method}] ${finding.text}`);
    }
    console.error(`Rule: consume Response bodies through ${CANONICAL_READER}.`);
    process.exit(2);
}
