// @ts-check

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = process.cwd();
const COPILOT_ROOT = resolve(REPO_ROOT, 'src/copilot');
const TOOLS_ROOT = join(COPILOT_ROOT, 'tools');
const COPILOT_INFRA_ROOT = join(COPILOT_ROOT, 'infra');

/**
 * @param {string} dir
 * @returns {string[]}
 */
function listJsFiles(dir) {
    /** @type {string[]} */
    const files = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const abs = join(dir, entry.name);
        if (entry.isDirectory()) {
            files.push(...listJsFiles(abs));
        } else if (entry.name.endsWith('.js')) {
            files.push(abs);
        }
    }
    return files;
}

/**
 * @param {string} filePath
 * @returns {string[]}
 */
function collectImportSpecifiers(filePath) {
    const source = readFileSync(filePath, 'utf8');
    const specifiers = [];
    const importRe = /\b(?:import|export)\s+(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]/g;
    for (const match of source.matchAll(importRe)) {
        const specifier = match[1];
        if (specifier) specifiers.push(specifier);
    }
    return specifiers;
}

describe('IO/tools boundary contracts', () => {
    it('tools consomem src/copilot/infra somente pelas facades públicas aliasadas', () => {
        const violations = [];
        for (const filePath of listJsFiles(TOOLS_ROOT)) {
            for (const specifier of collectImportSpecifiers(filePath)) {
                const rel = relative(REPO_ROOT, filePath).replace(/\\/g, '/');
                if (specifier.startsWith('#copilot/infra/') && !specifier.startsWith('#copilot/infra/public/')) {
                    violations.push(`${rel}: ${specifier}`);
                    continue;
                }
                if (!specifier.startsWith('.')) continue;
                const resolved = resolve(dirname(filePath), specifier);
                if (resolved.startsWith(COPILOT_INFRA_ROOT)) {
                    violations.push(`${rel}: ${specifier}`);
                }
            }
        }

        expect(violations).toEqual([]);
    });

    it('facades públicas de IO existem como contratos nomeados', () => {
        for (const facade of ['cache.js', 'events.js', 'health.js', 'indexing.js', 'io.js', 'session.js', 'testing.js']) {
            expect(existsSync(join(COPILOT_INFRA_ROOT, 'public', facade)), facade).toBe(true);
        }
    });
});
