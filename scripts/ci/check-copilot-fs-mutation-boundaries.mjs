#!/usr/bin/env node
// @ts-check
/**
 * Structural guard for direct filesystem mutations inside src/copilot.
 *
 * Application/runtime code must mutate filesystem state through the canonical IO engine or trusted/workspace facades.
 * Direct node:fs mutation is reserved for low-level implementations, file-lock housekeeping, and exact capabilities
 * that cannot be expressed above the OS descriptor boundary.
 */

import * as t from '@babel/types';
import { globSync } from 'glob';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { fsOperationForCall, parseCopilotFsSource, unwrapExpression, walkAst } from './lib/copilot-fs-ast.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SOURCE_ROOT = 'src/copilot';
const SOURCE_GLOB = `${SOURCE_ROOT}/**/*.{js,mjs,cjs,jsx,ts,mts,cts,tsx}`;
const DIRECT_MUTATIONS = new Set([
    'writeFile',
    'writeFileSync',
    'appendFile',
    'appendFileSync',
    'rename',
    'renameSync',
    'link',
    'linkSync',
    'unlink',
    'unlinkSync',
    'rm',
    'rmSync',
    'mkdir',
    'mkdirSync',
    'truncate',
    'truncateSync',
    'chmod',
    'chmodSync',
    'copyFile',
    'copyFileSync',
]);
const OPEN_FUNCTIONS = new Set(['open', 'openSync']);
const FILE_HANDLE_MUTATIONS = new Set(['write', 'writeFile', 'appendFile', 'truncate', 'chmod']);

const EXACT_ALLOWLIST = new Map([
    ['src/copilot/infra/persistence/jsonl/writer/persistence.js', new Set(['rename'])],
    ['src/copilot/infra/persistence/jsonl/repair.js', new Set(['open:mutating', 'fileHandle.truncate'])],
    [
        'src/copilot/infra/concurrency/locks/file/resource-lock.js',
        new Set(['open:mutating', 'mkdir', 'fileHandle.writeFile']),
    ],
    ['src/copilot/infra/concurrency/locks/file/legacy.js', new Set(['unlink', 'unlinkSync'])],
    ['src/copilot/infra/concurrency/locks/file/metadata.js', new Set(['unlink'])],
]);

/** @param {t.CallExpression} call */
function openUsesMutatingFlags(call) {
    const flags = call.arguments[1];
    if (t.isStringLiteral(flags)) return /[wa+]/u.test(flags.value);
    // Numeric/computed flags can contain O_CREAT/O_TRUNC/O_APPEND/O_RDWR. Fail closed.
    return flags !== undefined;
}

/** @param {string} filePath @param {string} operation */
function isAllowedMutation(filePath, operation) {
    if (filePath.startsWith('src/copilot/infra/filesystem/')) return true;
    return EXACT_ALLOWLIST.get(filePath)?.has(operation) === true;
}

/** @typedef {{ file: string; operation: string; line: number; column: number; allowed: boolean }} FsMutationSite */

/**
 * Analyze one source file for direct node:fs mutations.
 *
 * @param {string} source
 * @param {string} filePath workspace-relative path
 * @returns {{ sites: FsMutationSite[]; parseErrors: string[] }}
 */
export function analyzeCopilotFsMutationSource(source, filePath) {
    const { ast, normalizedFile, directBindings, namespaceBindings, parseErrors } = parseCopilotFsSource(
        source,
        filePath,
    );

    /** @type {Set<string>} */
    const fileHandles = new Set();
    /** @param {t.Node} target @param {t.Expression | null | undefined} expression */
    const captureHandle = (target, expression) => {
        if (!t.isIdentifier(target)) return;
        const unwrapped = unwrapExpression(expression);
        if (!t.isCallExpression(unwrapped)) return;
        const operation = fsOperationForCall(unwrapped, directBindings, namespaceBindings);
        if (operation === 'open' || operation === 'openSync') fileHandles.add(target.name);
    };
    walkAst(ast.program, (node) => {
        if (t.isVariableDeclarator(node)) {
            captureHandle(node.id, t.isExpression(node.init) ? node.init : null);
        } else if (t.isAssignmentExpression(node) && node.operator === '=') {
            captureHandle(node.left, t.isExpression(node.right) ? node.right : null);
        }
    });

    /** @type {FsMutationSite[]} */
    const sites = [];
    /** @param {t.Node} node @param {string} operation */
    const record = (node, operation) => {
        const line = node.loc?.start.line ?? 0;
        const column = node.loc?.start.column ?? 0;
        sites.push({
            file: normalizedFile,
            operation,
            line,
            column,
            allowed: isAllowedMutation(normalizedFile, operation),
        });
    };

    walkAst(ast.program, (node) => {
        if (!t.isCallExpression(node)) return;
        const operation = fsOperationForCall(node, directBindings, namespaceBindings);
        if (operation) {
            if (DIRECT_MUTATIONS.has(operation)) record(node, operation);
            else if (OPEN_FUNCTIONS.has(operation) && openUsesMutatingFlags(node))
                record(node, `${operation}:mutating`);
        }
        const callee = node.callee;
        if (
            t.isMemberExpression(callee) &&
            !callee.computed &&
            t.isIdentifier(callee.object) &&
            t.isIdentifier(callee.property) &&
            fileHandles.has(callee.object.name) &&
            FILE_HANDLE_MUTATIONS.has(callee.property.name)
        ) {
            record(node, `fileHandle.${callee.property.name}`);
        }
    });

    return { sites, parseErrors };
}

/** @returns {Promise<number>} */
export async function checkCopilotFsMutationBoundaries() {
    const files = globSync(SOURCE_GLOB, {
        cwd: ROOT,
        nodir: true,
        absolute: false,
        ignore: ['**/.ai/**', '**/node_modules/**', '**/dist/**', '**/build/**'],
    }).sort((left, right) => left.localeCompare(right));
    /** @type {FsMutationSite[]} */
    const sites = [];
    /** @type {{ file: string; error: string }[]} */
    const parseErrors = [];
    const { readFile } = await import('node:fs/promises');
    for (const file of files) {
        const source = await readFile(path.join(ROOT, file), 'utf8');
        const result = analyzeCopilotFsMutationSource(source, file);
        sites.push(...result.sites);
        for (const error of result.parseErrors) parseErrors.push({ file, error });
    }
    const violations = sites.filter((site) => !site.allowed);
    if (parseErrors.length > 0 || violations.length > 0) {
        console.error('Copilot filesystem mutation boundary: FAIL');
        for (const item of parseErrors) console.error(`- parse ${item.file}: ${item.error}`);
        for (const site of violations)
            console.error(`- ${site.file}:${site.line}:${site.column} direct ${site.operation}`);
        return 1;
    }
    console.log('Copilot filesystem mutation boundary: OK');
    console.log(`- scanned source files: ${files.length}`);
    console.log(`- direct mutation sites: ${sites.length}`);
    console.log('- application boundary violations: 0');
    console.log('- low-level implementation roots: src/copilot/infra/filesystem/**');
    console.log(`- exact exceptions: ${EXACT_ALLOWLIST.size}`);
    return 0;
}

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
    process.exitCode = await checkCopilotFsMutationBoundaries();
}
