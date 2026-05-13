// @ts-check

import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';

import { parse } from '@babel/parser';
import { describe, it } from 'vitest';

const COPILOT_ROOT = new URL('../../../../src/copilot/', import.meta.url).pathname;
const PRESENTATION_ROOT = join(COPILOT_ROOT, 'presentation');
const TERMINAL_ROOT = join(COPILOT_ROOT, 'terminal');
const SERVER_ROOT = join(COPILOT_ROOT, 'server');
const PACKAGE_JSON_PATH = join(new URL('../../../../', import.meta.url).pathname, 'package.json');

const ALLOWED_PRESENTATION_PUBLIC_IMPORTS = new Set([
    '#copilot/presentation',
    '#copilot/presentation/agent',
    '#copilot/presentation/contracts',
    '#copilot/presentation/conversation',
    '#copilot/presentation/files',
    '#copilot/presentation/routing',
    '#copilot/presentation/runtime',
    '#copilot/presentation/sdk',
    '#copilot/presentation/state',
    '#copilot/presentation/system',
]);

const BARRELED_PRESENTATION_SUBDOMAINS = new Set([
    'agent',
    'contracts',
    'conversation',
    'files',
    'routing',
    'runtime',
    'sdk',
    'state',
    'system',
]);

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
 * @param {string} filePath
 * @returns {import('@babel/parser').ParseResult<import('@babel/types').File>}
 */
function parseModule(filePath) {
    return parse(readFileSync(filePath, 'utf8'), {
        sourceType: 'module',
    });
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
 * @param {string} abs
 * @returns {string}
 */
function toPosixPresentationRelative(abs) {
    return relative(PRESENTATION_ROOT, abs).replace(/\\/g, '/');
}

describe('W115 — presentation barrel governance', () => {
    it('package.json expõe apenas superfícies públicas explícitas de presentation', () => {
        const pkg = JSON.parse(readFileSync(PACKAGE_JSON_PATH, 'utf8'));
        const imports = pkg['imports'] ?? {};
        const presentationKeys = Object.keys(imports)
            .filter((key) => key === '#copilot/presentation' || key.startsWith('#copilot/presentation/'))
            .sort();

        assert.deepEqual(presentationKeys, [...ALLOWED_PRESENTATION_PUBLIC_IMPORTS].sort());
        assert.equal('#copilot/presentation/*' in imports, false);
    });

    it('todo index.js de presentation é barrel puro', () => {
        const indexFiles = listJsFilesRecursive(PRESENTATION_ROOT).filter((abs) => basename(abs) === 'index.js');
        /** @type {string[]} */
        const violations = [];

        for (const abs of indexFiles) {
            const rel = toPosixPresentationRelative(abs);
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
            `index.js de presentation deve conter apenas re-exports:\n${violations.join('\n')}`,
        );
    });

    it('presentation não depende de terminal nem server', () => {
        const files = listJsFilesRecursive(PRESENTATION_ROOT);
        /** @type {string[]} */
        const violations = [];

        for (const abs of files) {
            const rel = toPosixPresentationRelative(abs);
            const ast = parseModule(abs);
            const specifiers = collectModuleSpecifiers(ast);

            for (const specifier of specifiers) {
                if (specifier === '#copilot/terminal' || specifier.startsWith('#copilot/terminal/')) {
                    violations.push(`${rel} -> ${specifier}`);
                    continue;
                }
                if (!specifier.startsWith('.')) continue;

                const targetAbs = resolveRelativeModule(abs, specifier);
                if (!targetAbs) continue;
                if (targetAbs.startsWith(TERMINAL_ROOT) || targetAbs.startsWith(SERVER_ROOT)) {
                    violations.push(`${rel} -> ${specifier}`);
                }
            }
        }

        assert.deepEqual(
            violations,
            [],
            `Presentation não deve depender de terminal/server:\n${violations.join('\n')}`,
        );
    });

    it('server e terminal consomem subdomínios barrelizados de presentation via barrels', () => {
        const files = [...listJsFilesRecursive(SERVER_ROOT), ...listJsFilesRecursive(TERMINAL_ROOT)];
        /** @type {string[]} */
        const violations = [];

        for (const abs of files) {
            const rel = relative(COPILOT_ROOT, abs).replace(/\\/g, '/');
            const ast = parseModule(abs);
            const specifiers = collectModuleSpecifiers(ast);

            for (const specifier of specifiers) {
                if (!specifier.startsWith('.')) continue;
                const targetAbs = resolveRelativeModule(abs, specifier);
                if (!targetAbs || !targetAbs.startsWith(PRESENTATION_ROOT)) continue;

                const targetRel = toPosixPresentationRelative(targetAbs);
                const [segment] = targetRel.split('/');
                if (!segment || !BARRELED_PRESENTATION_SUBDOMAINS.has(segment)) continue;
                if (basename(targetRel) === 'index.js') continue;

                violations.push(`${rel} -> ${specifier} (${targetRel})`);
            }
        }

        assert.deepEqual(
            violations,
            [],
            `Consumers externos devem entrar nos subdomínios barrelizados de presentation via index.js:\n${violations.join('\n')}`,
        );
    });
});
