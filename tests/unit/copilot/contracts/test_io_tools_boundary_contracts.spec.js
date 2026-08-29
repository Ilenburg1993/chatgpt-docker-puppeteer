// @ts-check

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = process.cwd();
const COPILOT_ROOT = resolve(REPO_ROOT, 'src/copilot');
const CORE_ROOT = join(COPILOT_ROOT, 'core');
const TOOLS_ROOT = join(COPILOT_ROOT, 'tools');
const COPILOT_INFRA_ROOT = join(COPILOT_ROOT, 'infra');
const PACKAGE_JSON = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8'));
const ALLOWED_INFRA_CHILD_PROCESS_FILES = new Set([
    'indexing/search/subprocess/stream.js',
    'process/execution/buffered.js',
]);
const ALLOWED_INFRA_CAPABILITY_IMPORTS = new Set(
    Object.keys(PACKAGE_JSON.imports ?? {}).filter((key) => key.startsWith('#copilot/infra/public/')),
);
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
 * @param {string} source
 * @returns {string}
 */
function stripJavaScriptComments(source) {
    return source.replace(/\/\*[\s\S]*?\*\//gu, '').replace(/(^|[^:])\/\/.*$/gmu, '$1');
}

/** @param {string} filePath @returns {string[]} */
function collectImportSpecifiers(filePath) {
    const source = readFileSync(filePath, 'utf8');
    /** @type {string[]} */
    const specifiers = [];
    const importRe = /\b(?:import|export)\s+(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]/g;
    for (const match of source.matchAll(importRe)) {
        const specifier = match[1];
        if (specifier) specifiers.push(specifier);
    }
    return specifiers;
}

describe('IO/tools boundary contracts', () => {
    it('former Core L0 permanece fisicamente extinto e sem aliases de pacote', () => {
        expect(existsSync(CORE_ROOT)).toBe(false);
        const aliases = Object.keys(PACKAGE_JSON.imports ?? {}).filter(
            (key) => key === '#copilot/core' || key.startsWith('#copilot/core/'),
        );
        expect(aliases).toEqual([]);
    });

    it('infra concentra child_process nos owners especializados com ambiente explícito', () => {
        const owners = [];
        const violations = [];
        for (const filePath of listJsFiles(COPILOT_INFRA_ROOT)) {
            const source = stripJavaScriptComments(readFileSync(filePath, 'utf8'));
            if (!/['"]node:child_process['"]/u.test(source)) continue;
            const rel = relative(COPILOT_INFRA_ROOT, filePath).replace(/\\/g, '/');
            owners.push(rel);
            if (!ALLOWED_INFRA_CHILD_PROCESS_FILES.has(rel)) violations.push(`${rel}: unexpected child_process owner`);
            if (/\bspawn\s*\(/u.test(source) && !/\benv\s*:/u.test(source)) {
                violations.push(`${rel}: spawn without explicit env`);
            }
        }
        expect(owners.sort()).toEqual([...ALLOWED_INFRA_CHILD_PROCESS_FILES].sort());
        expect(violations).toEqual([]);
    });

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

    it('tools consomem infra exclusivamente pela membrana public', () => {
        const violations = [];
        for (const filePath of listJsFiles(TOOLS_ROOT)) {
            for (const specifier of collectImportSpecifiers(filePath)) {
                const rel = relative(REPO_ROOT, filePath).replace(/\\/g, '/');
                if (specifier.startsWith('#copilot/infra/') && !ALLOWED_INFRA_CAPABILITY_IMPORTS.has(specifier)) {
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

    it('membrana public projeta capabilities explícitas sem mega-barrel raiz', () => {
        const publicRoot = join(COPILOT_INFRA_ROOT, 'public');
        expect(existsSync(publicRoot)).toBe(true);
        expect(existsSync(join(publicRoot, 'index.js'))).toBe(false);
        for (const entrypoint of [
            'cache/keys/index.js',
            'cache/tiering/index.js',
            'concurrency/bulk/index.js',
            'composition/filesystem/configured/index.js',
            'composition/workspace/authority/index.js',
            'composition/workspace/io/index.js',
            'composition/workspace/read-io/index.js',
            'composition/workspace/mutation-io/index.js',
            'indexing/file-context/index.js',
            'indexing/search/index.js',
            'operations/index.js',
            'platform/node/index.js',
            'policy/index.js',
        ]) {
            expect(existsSync(join(publicRoot, entrypoint))).toBe(true);
        }
        for (const aggregate of [
            'cache/index.js',
            'concurrency/locks/index.js',
            'filesystem/read/index.js',
            'indexing/index.js',
            'platform/index.js',
        ]) {
            expect(existsSync(join(publicRoot, aggregate))).toBe(false);
        }
    });
});
