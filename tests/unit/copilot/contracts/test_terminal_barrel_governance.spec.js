// @ts-check

import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';

import { resolveBabelParserOptions } from '#copilot/infra/public/diagnostic/code-analysis';
import { parse } from '@babel/parser';
import { describe, it } from 'vitest';

const COPILOT_ROOT = new URL('../../../../src/copilot/', import.meta.url).pathname;
const TERMINAL_ROOT = join(COPILOT_ROOT, 'terminal');
const ALLOWED_TERMINAL_PUBLIC_IMPORTS = new Set([
    '#copilot/terminal',
    '#copilot/terminal/commands',
    '#copilot/terminal/dialog',
    '#copilot/terminal/frontend',
    '#copilot/terminal/handlers',
    '#copilot/terminal/state/repl-runtime',
    '#copilot/terminal/stores',
]);
const PACKAGE_JSON_PATH = join(new URL('../../../../', import.meta.url).pathname, 'package.json');

/**
 * @param {string} dir
 * @returns {string[]}
 */
function listJsFilesRecursive(dir) {
    /** @type {string[]} */
    const files = [];
    for (const entry of readdirSync(dir)) {
        const abs = join(dir, entry);
        const stat = statSync(abs);
        if (stat.isDirectory()) {
            files.push(...listJsFilesRecursive(abs));
        } else if (stat.isFile() && entry.endsWith('.js')) {
            files.push(abs);
        }
    }
    return files;
}

/**
 * @param {string} abs
 * @returns {string}
 */
function toPosixRelative(abs) {
    return relative(TERMINAL_ROOT, abs).replace(/\\/g, '/');
}

/**
 * @param {string} filePath
 * @returns {import('@babel/parser').ParseResult<import('@babel/types').File>}
 */
function parseModule(filePath) {
    return parse(
        readFileSync(filePath, 'utf8'),
        /** @type {any} */ (resolveBabelParserOptions(filePath, 'js', { profile: 'structure' })),
    );
}

/**
 * @param {string} importerFile
 * @param {string} specifier
 * @returns {string | null}
 */
function resolveRelativeModule(importerFile, specifier) {
    const base = resolve(dirname(importerFile), specifier);
    const candidates = [base, `${base}.js`, join(base, 'index.js')];
    for (const candidate of candidates) {
        if (existsSync(candidate) && statSync(candidate).isFile()) {
            return candidate;
        }
    }
    return null;
}

/**
 * @param {ReturnType<typeof parseModule>} ast
 * @returns {string[]}
 */
function collectModuleSpecifiers(ast) {
    /** @type {string[]} */
    const specifiers = [];
    for (const node of ast.program.body) {
        if (node.type === 'ImportDeclaration' && typeof node.source.value === 'string') {
            specifiers.push(node.source.value);
            continue;
        }
        if (node.type === 'ExportAllDeclaration' && typeof node.source?.value === 'string') {
            specifiers.push(node.source.value);
            continue;
        }
        if (node.type === 'ExportNamedDeclaration' && typeof node.source?.value === 'string') {
            specifiers.push(node.source.value);
        }
    }
    return specifiers;
}

/**
 * @param {string} relPath
 * @returns {string}
 */
function topLevelSegment(relPath) {
    return relPath.includes('/') ? (relPath.split('/')[0] ?? '') : '';
}

describe('W114.5 — terminal barrel governance', () => {
    it('package.json expõe apenas superfícies públicas explícitas do terminal', () => {
        const pkg = JSON.parse(readFileSync(PACKAGE_JSON_PATH, 'utf8'));
        const imports = pkg['imports'] ?? {};
        const terminalKeys = Object.keys(imports)
            .filter((key) => key === '#copilot/terminal' || key.startsWith('#copilot/terminal/'))
            .sort();

        assert.deepEqual(terminalKeys, [...ALLOWED_TERMINAL_PUBLIC_IMPORTS].sort());
        assert.equal('#copilot/terminal/*' in imports, false);
    });

    it('todo index.js do terminal é barrel puro', () => {
        const indexFiles = listJsFilesRecursive(TERMINAL_ROOT).filter((abs) => basename(abs) === 'index.js');
        /** @type {string[]} */
        const violations = [];

        for (const abs of indexFiles) {
            const rel = toPosixRelative(abs);
            const ast = parseModule(abs);
            for (const node of ast.program.body) {
                const allowedExport = node.type === 'ExportAllDeclaration';
                const allowedNamedReexport =
                    node.type === 'ExportNamedDeclaration' && node.declaration == null && node.source != null;
                if (!allowedExport && !allowedNamedReexport) {
                    violations.push(`${rel}: ${node.type}`);
                }
            }
        }

        assert.deepEqual(
            violations,
            [],
            `index.js do terminal deve conter apenas re-exports:\n${violations.join('\n')}`,
        );
    });

    it('imports cross-folder internos do terminal passam por barrels', () => {
        const files = listJsFilesRecursive(TERMINAL_ROOT);
        /** @type {string[]} */
        const violations = [];

        for (const abs of files) {
            const rel = toPosixRelative(abs);
            const ast = parseModule(abs);
            const specifiers = collectModuleSpecifiers(ast);

            for (const specifier of specifiers) {
                if (!specifier.startsWith('.')) continue;
                const targetAbs = resolveRelativeModule(abs, specifier);
                if (!targetAbs) continue;
                if (!targetAbs.startsWith(TERMINAL_ROOT)) continue;

                const targetRel = toPosixRelative(targetAbs);
                const importerDir = dirname(rel).replace(/\\/g, '/');
                const targetDir = dirname(targetRel).replace(/\\/g, '/');
                if (importerDir === targetDir) continue;
                if (basename(targetRel) === 'index.js') continue;

                if (basename(rel) === 'index.js') {
                    if (rel === 'index.js' && !targetRel.includes('/')) continue;
                    const importerTop = topLevelSegment(rel);
                    const targetTop = topLevelSegment(targetRel);
                    if (importerTop && importerTop === targetTop) continue;
                }

                violations.push(`${rel} -> ${specifier} (${targetRel})`);
            }
        }

        assert.deepEqual(
            violations,
            [],
            `Imports cross-folder do terminal devem passar por barrels:\n${violations.join('\n')}`,
        );
    });

    it('nenhum módulo de src/copilot fora de terminal depende do terminal', () => {
        const files = listJsFilesRecursive(COPILOT_ROOT).filter((abs) => !abs.startsWith(TERMINAL_ROOT));
        /** @type {string[]} */
        const violations = [];

        for (const abs of files) {
            const rel = relative(COPILOT_ROOT, abs).replace(/\\/g, '/');
            const ast = parseModule(abs);
            const specifiers = collectModuleSpecifiers(ast);

            for (const specifier of specifiers) {
                if (specifier === '#copilot/terminal' || specifier.startsWith('#copilot/terminal/')) {
                    violations.push(`${rel} -> ${specifier}`);
                    continue;
                }
                if (!specifier.startsWith('.')) continue;
                if (!specifier.startsWith('.')) continue;

                const targetAbs = resolveRelativeModule(abs, specifier);
                if (!targetAbs || !targetAbs.startsWith(TERMINAL_ROOT)) continue;
                if (toPosixRelative(targetAbs) === 'index.js') continue;
                violations.push(`${rel} -> ${specifier} (${toPosixRelative(targetAbs)})`);
            }
        }

        assert.deepEqual(
            violations,
            [],
            `Módulos de src/copilot fora de terminal não devem depender do terminal:\n${violations.join('\n')}`,
        );
    });
});
