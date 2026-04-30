// @ts-check

import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'vitest';

const ROOT = new URL('../../../../src/copilot/', import.meta.url).pathname;

const ALLOWED_FACADE_ROLES = new Set(['query', 'mutation', 'lifecycle', 'infra', 'projection']);

const FACADE_OPERATION_MATRIX = {
    'agent-dialog-runtime.js': { role: 'lifecycle', allowedFacadeImports: [] },
    'agent-health-access.js': { role: 'query', allowedFacadeImports: [] },
    'agent-model-config.js': {
        role: 'mutation',
        allowedFacadeImports: ['agent-runtime-status.js', 'agent-sdk-access.js'],
    },
    'agent-runtime-capabilities.js': {
        role: 'projection',
        allowedFacadeImports: ['agent-runtime-controls.js', 'agent-runtime-status.js'],
    },
    'agent-runtime-controls.js': { role: 'mutation', allowedFacadeImports: ['agent-runtime-status.js'] },
    'agent-runtime-event-bridge.js': { role: 'infra', allowedFacadeImports: [] },
    'agent-runtime-ownership.js': { role: 'mutation', allowedFacadeImports: [] },
    'agent-runtime-state.js': { role: 'mutation', allowedFacadeImports: [] },
    'agent-runtime-status.js': { role: 'query', allowedFacadeImports: [] },
    'agent-runtime-todos.js': { role: 'query', allowedFacadeImports: [] },
    'agent-runtime-tools.js': { role: 'query', allowedFacadeImports: [] },
    'agent-runtime-webhooks.js': { role: 'mutation', allowedFacadeImports: [] },
    'agent-sdk-access.js': { role: 'infra', allowedFacadeImports: ['agent-sdk-runtime.js'] },
    'agent-sdk-runtime.js': { role: 'infra', allowedFacadeImports: [] },
    'agent-sdk-session.js': { role: 'mutation', allowedFacadeImports: [] },
    'agent-session-ops.js': {
        role: 'lifecycle',
        allowedFacadeImports: ['agent-sdk-access.js', 'agent-sdk-runtime.js'],
    },
    'agent-webhook-ops.js': { role: 'mutation', allowedFacadeImports: [] },
};

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
 * @returns {string[]}
 */
function listFacadeFiles() {
    return readdirSync(srcPath('agent', 'facades'))
        .filter((entry) => entry.endsWith('.js') && entry !== 'index.js')
        .sort();
}

/**
 * @param {string} facadeFile
 * @returns {string[]}
 */
function readFacadeRelativeImports(facadeFile) {
    const src = readFileSync(srcPath('agent', 'facades', facadeFile), 'utf8');
    const imports = new Set();
    const pattern = /from\s+['"]\.\/([^'"]+\.js)['"]/g;
    for (const match of src.matchAll(pattern)) {
        imports.add(match[1]);
    }
    return Array.from(imports).sort();
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
    it('toda facade tem ownership semântico declarado e papel válido', () => {
        const facadeFiles = listFacadeFiles();
        const matrixFiles = Object.keys(FACADE_OPERATION_MATRIX).sort();
        assert.deepEqual(matrixFiles, facadeFiles, 'A matriz de facades deve cobrir exatamente os arquivos públicos.');

        const invalidRoles = Object.entries(FACADE_OPERATION_MATRIX)
            .filter(([, entry]) => !ALLOWED_FACADE_ROLES.has(entry.role))
            .map(([file, entry]) => `${file}:${entry.role}`);
        assert.deepEqual(invalidRoles, [], `Roles inválidas na matriz de facades:\n${invalidRoles.join('\n')}`);
    });

    it('imports cruzados entre facades precisam estar declarados na matriz semântica', () => {
        /** @type {string[]} */
        const violations = [];

        for (const [facadeFile, entry] of Object.entries(FACADE_OPERATION_MATRIX)) {
            const actualImports = readFacadeRelativeImports(facadeFile);
            const allowedImports = new Set(entry.allowedFacadeImports);
            for (const target of actualImports) {
                if (!allowedImports.has(target)) {
                    violations.push(`${facadeFile} -> ${target}`);
                }
            }
        }

        assert.deepEqual(
            violations,
            [],
            `Imports cruzados entre facades devem ser explícitos e revisáveis:\n${violations.join('\n')}`,
        );
    });

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

    it('facades secundárias tools/webhooks/todos não têm consumidores internos fora do barrel de facades', () => {
        const secondaryFacades = [
            'facades/agent-runtime-tools.js',
            'facades/agent-runtime-webhooks.js',
            'facades/agent-runtime-todos.js',
        ];
        /** @type {string[]} */
        const violations = [];

        for (const facade of secondaryFacades) {
            const facadeViolations = findFacadeImportViolations(facade, []);
            violations.push(...facadeViolations.map((rel) => `${facade} -> ${rel}`));
        }

        assert.deepEqual(
            violations,
            [],
            `Facades secundárias devem sair pelo barrel #copilot/agent/facades, sem bypass granular:\n${violations.join('\n')}`,
        );
    });

    it('facades secundárias mantêm ownership query/admin sem abrir SDK ou estado persistido cru', () => {
        const forbiddenPatterns = [
            /from ['"][^'"]*(?:sdk\/|lifecycle\/state-io\.js)/,
            /persistStateWithPolicy\s*\(/,
            /readStateAsync\s*\(/,
            /writeStateAsync\s*\(/,
        ];
        const facades = [
            'agent/facades/agent-runtime-tools.js',
            'agent/facades/agent-runtime-webhooks.js',
            'agent/facades/agent-runtime-todos.js',
        ];
        const violations = facades.flatMap((rel) => {
            const src = readFileSync(srcPath(rel), 'utf8');
            return forbiddenPatterns.some((pattern) => pattern.test(src)) ? [rel] : [];
        });

        assert.deepEqual(
            violations,
            [],
            `Facades secundárias não devem abrir SDK/state cru:\n${violations.join('\n')}`,
        );
    });

    it('agent-runtime-capabilities reutiliza helpers de governance em vez de remontar snapshots de contexto', () => {
        const src = readFileSync(srcPath('agent/facades/agent-runtime-capabilities.js'), 'utf8');

        assert.match(src, /readRuntimePermissionMode/);
        assert.match(src, /readRuntimePermissionCapability/);
        assert.match(src, /readRuntimeContextFactoryCapabilities/);
        assert.match(src, /readRuntimeToolRegistryEntries/);
        assert.doesNotMatch(src, /agent\.getContextFactoryCapabilitiesSnapshot\?\.\(/);
        assert.doesNotMatch(src, /agent\.getPermissionCapabilitySnapshot\?\.\(\)/);
    });
});
