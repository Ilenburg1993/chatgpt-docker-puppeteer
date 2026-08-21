// @ts-check

import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';

import { resolveBabelParserOptions } from '#copilot/infra/public/diagnostic/code-analysis';
import { parse } from '@babel/parser';
import { describe, it } from 'vitest';

const COPILOT_ROOT = new URL('../../../../src/copilot/', import.meta.url).pathname;
const AGENT_ROOT = join(COPILOT_ROOT, 'agent');

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
    return parse(
        readFileSync(filePath, 'utf8'),
        /** @type {any} */ (resolveBabelParserOptions(filePath, 'js', { profile: 'structure' })),
    );
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
function toPosixAgentRelative(abs) {
    return relative(AGENT_ROOT, abs).replace(/\\/g, '/');
}

describe('C3.2/Onda 2 — agent barrel governance', () => {
    it('todo index.js do agent é barrel puro', () => {
        const indexFiles = listJsFilesRecursive(AGENT_ROOT).filter((abs) => basename(abs) === 'index.js');
        /** @type {string[]} */
        const violations = [];

        for (const abs of indexFiles) {
            const rel = toPosixAgentRelative(abs);
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

        assert.deepEqual(violations, [], `index.js do agent deve conter apenas re-exports:\n${violations.join('\n')}`);
    });

    it('imports cross-folder internos do agent passam por barrels', () => {
        const files = listJsFilesRecursive(AGENT_ROOT);
        /** @type {string[]} */
        const violations = [];

        for (const abs of files) {
            const rel = toPosixAgentRelative(abs);
            if (basename(rel) === 'index.js') continue;
            if (rel.startsWith('facades/')) continue;

            const ast = parseModule(abs);
            const specifiers = collectModuleSpecifiers(ast);

            for (const specifier of specifiers) {
                if (!specifier.startsWith('.')) continue;

                const targetAbs = resolveRelativeModule(abs, specifier);
                if (!targetAbs || !targetAbs.startsWith(AGENT_ROOT)) continue;

                const targetRel = toPosixAgentRelative(targetAbs);
                const importerDir = dirname(rel).replace(/\\/g, '/');
                const targetDir = dirname(targetRel).replace(/\\/g, '/');
                if (importerDir === targetDir) continue;
                if (basename(targetRel) === 'index.js') continue;
                if (targetRel.startsWith('facades/') || targetRel.startsWith('ports/')) continue;

                violations.push(`${rel} -> ${specifier} (${targetRel})`);
            }
        }

        assert.deepEqual(
            violations,
            [],
            `Imports cross-folder do agent devem passar por barrels:\n${violations.join('\n')}`,
        );
    });
});
