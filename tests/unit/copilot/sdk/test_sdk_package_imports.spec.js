// @ts-check

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = new URL('../../../../', import.meta.url).pathname.replace(/\/$/, '');

/**
 * @returns {Record<string, string>}
 */
function readPackageImports() {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
    return /** @type {Record<string, string>} */ (pkg.imports ?? {});
}

/**
 * @param {string} target
 * @returns {string}
 */
function resolveImportTargetProbe(target) {
    const normalized = target.replace(/^\.\//, '');
    if (!normalized.includes('*')) return join(ROOT, normalized);

    const beforeStar = normalized.slice(0, normalized.indexOf('*'));
    return join(ROOT, dirname(beforeStar));
}

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
 * @param {string} source
 * @returns {string[]}
 */
function collectRuntimeImportSpecifiers(source) {
    const specifiers = [];
    const importRe = /\b(?:import|export)\s+(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]/g;
    for (const match of source.matchAll(importRe)) {
        const specifier = match[1];
        if (specifier) specifiers.push(specifier);
    }
    return specifiers;
}

describe('sdk/package imports — aliases internos apontam para destinos existentes', () => {
    it('não mantém aliases quebrados em package.json#imports', () => {
        const imports = readPackageImports();
        const broken = [];

        for (const [alias, target] of Object.entries(imports)) {
            if (!alias.startsWith('#copilot/')) continue;
            const probe = resolveImportTargetProbe(target);
            if (!existsSync(probe)) broken.push(`${alias} -> ${target}`);
        }

        expect(broken, `Aliases quebrados:\n${broken.join('\n')}`).toHaveLength(0);
    });

    it('não usa extensão .js em imports runtime que passam por alias wildcard #copilot', () => {
        const imports = readPackageImports();
        const wildcardAliases = Object.keys(imports)
            .filter((alias) => alias.startsWith('#copilot/') && alias.endsWith('/*'))
            .map((alias) => alias.slice(0, -1));
        const violations = [];

        for (const filePath of listJsFiles(join(ROOT, 'src/copilot'))) {
            const rel = relative(ROOT, filePath).replace(/\\/g, '/');
            const source = readFileSync(filePath, 'utf8');
            for (const specifier of collectRuntimeImportSpecifiers(source)) {
                if (!specifier.endsWith('.js')) continue;
                if (wildcardAliases.some((prefix) => specifier.startsWith(prefix))) {
                    violations.push(`${rel}: ${specifier}`);
                }
            }
        }

        expect(violations, `Imports quebram Node package#imports wildcard:\n${violations.join('\n')}`).toEqual([]);
    });
});
