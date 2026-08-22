// @ts-check
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, it } from 'vitest';

import { checkGlobalArchitecture } from '../../../../scripts/check-copilot-global-architecture.mjs';
import { listSourceFilesSync } from '../../../../scripts/lib/source-tree.mjs';

const ROOT = process.cwd();
const SRC_COPILOT = join(ROOT, 'src/copilot');

/** @param {string} dir */
function listJsFiles(dir) {
    return listSourceFilesSync(dir, { extensions: ['.js'] });
}

/**
 * @param {string} abs
 * @returns {string}
 */
function rel(abs) {
    return relative(SRC_COPILOT, abs).replaceAll('\\', '/');
}

/**
 * @param {string} src
 * @returns {string[]}
 */
function moduleSources(src) {
    /** @type {string[]} */
    const sources = [];
    const importRegex = /^\s*import\s+(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]\s*;?/gm;
    const exportRegex = /^\s*export\s+[\s\S]*?\s+from\s+['"]([^'"]+)['"]\s*;?/gm;
    for (const match of src.matchAll(importRegex)) {
        if (typeof match[1] === 'string') sources.push(match[1]);
    }
    for (const match of src.matchAll(exportRegex)) {
        if (typeof match[1] === 'string') sources.push(match[1]);
    }
    return sources;
}

/**
 * @param {string} rootRel
 * @param {(fileRel: string) => boolean} allowFile
 * @param {(source: string) => boolean} forbiddenSource
 * @returns {string[]}
 */
function findForbiddenSources(rootRel, allowFile, forbiddenSource) {
    return listJsFiles(join(SRC_COPILOT, rootRel)).flatMap((abs) => {
        const fileRel = rel(abs);
        if (allowFile(fileRel)) return [];
        return moduleSources(readFileSync(abs, 'utf8'))
            .filter(forbiddenSource)
            .map((source) => `${fileRel} -> ${source}`);
    });
}

describe('Copilot global architecture strict gate', () => {
    it('não possui violações hard ou soft no contrato global atual', () => {
        const findings = checkGlobalArchitecture();
        assert.deepEqual(
            findings.filter((finding) => finding.severity === 'hard' || finding.severity === 'soft'),
            [],
        );
    });

    it('mantém rotas SDK compostas somente por deps.js', () => {
        const findings = checkGlobalArchitecture().filter(
            (finding) => finding.rule === 'sdk-routes-must-compose-through-deps',
        );
        assert.deepEqual(findings, []);
    });

    it('mantém config acoplado ao SDK apenas pelo sdk-config-port.js', () => {
        const violations = findForbiddenSources(
            'config',
            (fileRel) => fileRel === 'config/sdk-config-port.js',
            (source) => /^(?:#copilot\/sdk(?:\/|$)|(?:\.\.\/)+sdk(?:\/|$))/.test(source),
        );

        assert.deepEqual(violations, []);
    });

    it('mantém terminal sem imports diretos de SDK/tools fora dos gateways', () => {
        const gatewayAllowList = new Set([
            'terminal/frontend/gateways/sdk-session.js',
            'terminal/frontend/gateways/tools.js',
        ]);
        const violations = findForbiddenSources(
            'terminal',
            (fileRel) => gatewayAllowList.has(fileRel),
            (source) => /^(?:#copilot\/(?:sdk|tools)(?:\/|$)|(?:\.\.\/)+(?:sdk|tools)(?:\/|$))/.test(source),
        );

        assert.deepEqual(violations, []);
    });

    it('mantém handlers server/routes/sdk compostos exclusivamente por deps.js', () => {
        const violations = findForbiddenSources(
            'server/routes/sdk',
            (fileRel) => fileRel === 'server/routes/sdk/deps.js',
            (source) =>
                /^(?:#copilot\/(?:sdk|tools|presentation)(?:\/|$)|(?:\.\.\/)+presentation(?:\/|$))/.test(source),
        );

        assert.deepEqual(violations, []);
    });
});
