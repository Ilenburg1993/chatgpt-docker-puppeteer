// @ts-check

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = process.cwd();
const COPILOT_ROOT = resolve(REPO_ROOT, 'src/copilot');
const TOOLS_ROOT = join(COPILOT_ROOT, 'tools');
const MCP_TOOLS_ROOT = join(COPILOT_ROOT, 'mcp', 'tools');
const EXTERNAL_PATH_SURFACE_FILES = [
    join(COPILOT_ROOT, 'presentation', 'files', 'context.js'),
    join(COPILOT_ROOT, 'sdk', 'session', 'session-fs.js'),
];
const COPILOT_INFRA_ROOT = join(COPILOT_ROOT, 'infra');
const COPILOT_LAYER_ROOTS = new Map([
    ['core', join(COPILOT_ROOT, 'core')],
    ['config', join(COPILOT_ROOT, 'config')],
    ['infra', COPILOT_INFRA_ROOT],
    ['presentation', join(COPILOT_ROOT, 'presentation')],
    ['sdk', join(COPILOT_ROOT, 'sdk')],
    ['terminal', join(COPILOT_ROOT, 'terminal')],
]);
const NODE_BUILTINS_RE =
    /(?:\b(?:import|export)\s+(?:[^'"]*?\s+from\s+)?|\bimport\s*\()\s*['"](assert|buffer|child_process|crypto|dgram|diagnostics_channel|dns|events|fs|http|http2|https|module|net|os|path|perf_hooks|process|readline|stream|string_decoder|timers|tls|url|util|worker_threads|zlib)(?:\/[^'"]*)?['"]/g;

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
    it('infra e tools usam prefixo node: para built-ins do Node 24+', () => {
        const violations = [];
        for (const filePath of [...listJsFiles(TOOLS_ROOT), ...listJsFiles(COPILOT_INFRA_ROOT)]) {
            const source = readFileSync(filePath, 'utf8');
            const rel = relative(REPO_ROOT, filePath).replace(/\\/g, '/');
            for (const match of source.matchAll(NODE_BUILTINS_RE)) {
                violations.push(`${rel}: ${match[0]}`);
            }
        }

        expect(violations).toEqual([]);
    });

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

    it('tools não atravessam camadas copilot por caminhos relativos', () => {
        const violations = [];
        for (const filePath of listJsFiles(TOOLS_ROOT)) {
            for (const specifier of collectImportSpecifiers(filePath)) {
                if (!specifier.startsWith('.')) continue;
                const resolved = resolve(dirname(filePath), specifier);
                if (resolved.startsWith(TOOLS_ROOT)) continue;
                for (const [layer, root] of COPILOT_LAYER_ROOTS) {
                    if (resolved.startsWith(root)) {
                        const rel = relative(REPO_ROOT, filePath).replace(/\\/g, '/');
                        violations.push(`${rel}: ${specifier} -> ${layer}`);
                    }
                }
            }
        }

        expect(violations).toEqual([]);
    });

    it('infra não atravessa camadas copilot por caminhos relativos', () => {
        const violations = [];
        for (const filePath of listJsFiles(COPILOT_INFRA_ROOT)) {
            for (const specifier of collectImportSpecifiers(filePath)) {
                if (!specifier.startsWith('.')) continue;
                const resolved = resolve(dirname(filePath), specifier);
                if (resolved.startsWith(COPILOT_INFRA_ROOT)) continue;
                for (const [layer, root] of COPILOT_LAYER_ROOTS) {
                    if (resolved.startsWith(root)) {
                        const rel = relative(REPO_ROOT, filePath).replace(/\\/g, '/');
                        violations.push(`${rel}: ${specifier} -> ${layer}`);
                    }
                }
            }
        }

        expect(violations).toEqual([]);
    });

    it('facades públicas de IO existem como contratos nomeados', () => {
        for (const facade of [
            'cache.js',
            'events.js',
            'health.js',
            'indexing.js',
            'io.js',
            'policy.js',
            'runtime.js',
            'session.js',
            'testing.js',
            'trusted-io.js',
            'workspace-io.js',
        ]) {
            expect(existsSync(join(COPILOT_INFRA_ROOT, 'public', facade)), facade).toBe(true);
        }
    });

    it('tools não usam a facade operacional irrestrita para acessar paths', () => {
        const violations = [];
        for (const filePath of [
            ...listJsFiles(TOOLS_ROOT),
            ...listJsFiles(MCP_TOOLS_ROOT),
            ...EXTERNAL_PATH_SURFACE_FILES,
        ]) {
            const source = readFileSync(filePath, 'utf8');
            if (!source.includes('#copilot/infra/public/io')) continue;
            violations.push(relative(REPO_ROOT, filePath).replace(/\\/g, '/'));
        }

        expect(violations).toEqual([]);
    });
});
