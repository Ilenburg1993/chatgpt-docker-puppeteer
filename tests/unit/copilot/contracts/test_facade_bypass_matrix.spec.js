// @ts-check

import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'vitest';

const ROOT = new URL('../../../../src/copilot/', import.meta.url).pathname;

/**
 * @param {...string} parts
 * @returns {string}
 */
function srcPath(...parts) {
    return join(ROOT, ...parts);
}

/**
 * @param {string} dir
 * @returns {string[]}
 */
function listJsFilesRecursive(dir) {
    /** @type {string[]} */
    const out = [];
    for (const entry of readdirSync(dir)) {
        const abs = join(dir, entry);
        const st = statSync(abs);
        if (st.isDirectory()) {
            out.push(...listJsFilesRecursive(abs));
            continue;
        }
        if (st.isFile() && entry.endsWith('.js')) {
            out.push(abs);
        }
    }
    return out;
}

/**
 * @param {string} relPath
 * @param {readonly string[]} allowedRelPrefixes
 * @returns {string[]}
 */
function findFacadeImportViolations(relPath, allowedRelPrefixes) {
    const files = listJsFilesRecursive(srcPath('agent'));
    /** @type {string[]} */
    const violations = [];

    for (const abs of files) {
        const rel = abs.replace(ROOT, '').replace(/\\/g, '/');
        if (rel.startsWith('agent/facades/')) continue;

        const src = readFileSync(abs, 'utf8');
        const importsFacade = new RegExp(`from ['"][^'"]*${relPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]`).test(
            src,
        );

        if (!importsFacade) continue;
        if (allowedRelPrefixes.some((prefix) => rel.startsWith(prefix))) continue;
        violations.push(rel);
    }

    return violations;
}

describe('contracts/facade-bypass-matrix — consumers permitidos por facade crítica', () => {
    it('agent-runtime-state só é consumida por dialog/session/lifecycle/runtime-surface', () => {
        const violations = findFacadeImportViolations('facades/agent-runtime-state.js', [
            'agent/dialog/',
            'agent/session/',
            'agent/lifecycle/',
            'agent/agent-runtime-surface.js',
        ]);
        assert.deepEqual(violations, [], `Imports não autorizados de agent-runtime-state:\n${violations.join('\n')}`);
    });

    it('agent-runtime-controls só é consumida por runtime-surface (entrypoint compat)', () => {
        const violations = findFacadeImportViolations('facades/agent-runtime-controls.js', [
            'agent/agent-runtime-surface.js',
        ]);
        assert.deepEqual(
            violations,
            [],
            `Imports não autorizados de agent-runtime-controls:\n${violations.join('\n')}`,
        );
    });

    it('agent-health-access só é consumida por health-check', () => {
        const violations = findFacadeImportViolations('facades/agent-health-access.js', ['agent/health-check.js']);
        assert.deepEqual(violations, [], `Imports não autorizados de agent-health-access:\n${violations.join('\n')}`);
    });

    it('agent-sdk-access e agent-sdk-runtime só são consumidas por domínios runtime permitidos', () => {
        const sdkAccessViolations = findFacadeImportViolations('facades/agent-sdk-access.js', [
            'agent/lifecycle/',
            'agent/session/',
            'agent/context-factories.js',
            'agent/error-policy.js',
            'agent/agent-runtime-surface.js',
        ]);

        const sdkRuntimeViolations = findFacadeImportViolations('facades/agent-sdk-runtime.js', [
            'agent/dialog/',
            'agent/session/',
            'agent/messaging/',
            'agent/agent-runtime-surface.js',
        ]);

        assert.deepEqual(
            sdkAccessViolations,
            [],
            `Imports não autorizados de agent-sdk-access:\n${sdkAccessViolations.join('\n')}`,
        );
        assert.deepEqual(
            sdkRuntimeViolations,
            [],
            `Imports não autorizados de agent-sdk-runtime:\n${sdkRuntimeViolations.join('\n')}`,
        );
    });
});
