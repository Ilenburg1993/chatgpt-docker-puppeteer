// @ts-check

import { describe, expect, it } from 'vitest';

import { createRegistry, registerTool } from '#copilot/sdk/tools';
import {
    verifyToolOperationResultFieldsForCategory,
    verifyToolRegistryContracts,
} from '../../../../src/copilot/tools/introspection/tool-contract-verifier.js';

/**
 * @param {string} name
 * @param {{ skipPermission?: boolean; parameters?: Record<string, unknown> }} [options]
 * @returns {import('@github/copilot-sdk').Tool}
 */
function makeTool(name, options = {}) {
    return /** @type {any} */ ({
        name,
        description: `Tool ${name}`,
        parameters: options.parameters ?? { type: 'object', properties: {} },
        handler: () => ({}),
        ...(options.skipPermission === true ? { skipPermission: true } : {}),
    });
}

describe('tool-contract-verifier', () => {
    it('não classifica substrings como verbos mutáveis', () => {
        const registry = createRegistry();
        registerTool(registry, makeTool('exp_skills_list', { skipPermission: true }), {
            category: 'experimental',
            tags: ['skills', 'read'],
        });
        registerTool(registry, makeTool('permission_mode_get', { skipPermission: true }), {
            category: 'permission',
            tags: ['approval', 'read'],
        });

        const report = verifyToolRegistryContracts(registry);

        expect(report.ok).toBe(true);
        expect(report.riskySkipPermissionCount).toBe(0);
        expect(report.metadataCoverage.instructionsPct).toBe(100);
    });

    it('continua alertando skipPermission em verbos mutáveis reais', () => {
        const registry = createRegistry();
        registerTool(registry, makeTool('run_tests', { skipPermission: true }), {
            category: 'code',
            tags: ['test'],
        });
        registerTool(registry, makeTool('permission_mode_set', { skipPermission: true }), {
            category: 'permission',
            tags: ['approval', 'write'],
        });

        const report = verifyToolRegistryContracts(registry);

        expect(report.ok).toBe(true);
        expect(report.riskySkipPermissionCount).toBe(2);
        expect(report.issues.filter((issue) => issue.code === 'RISKY_SKIP_PERMISSION').map((issue) => issue.toolName))
            .toEqual(['run_tests', 'permission_mode_set']);
    });

    it('classifica skipPermission efetivo por approve_all como decisão operacional, não warning', () => {
        const registry = createRegistry();
        registerTool(registry, makeTool('patch_file'), {
            category: 'file',
            tags: ['filesystem', 'write'],
        });

        const report = verifyToolRegistryContracts(registry, { permissionMode: 'approve_all' });

        expect(report.ok).toBe(true);
        expect(report.riskySkipPermissionCount).toBe(0);
        expect(report.autonomySkipPermissionCount).toBe(1);
        expect(report.decisionCount).toBe(1);
        expect(report.permissionMode).toBe('approve_all');
        expect(report.metadataByName.patch_file).toMatchObject({
            operation: 'patch',
            risk: 'high',
            sideEffect: 'filesystem',
            effectiveSkipPermission: true,
            autonomyReason: 'permissionMode=approve_all',
        });
        expect(report.issues.map((issue) => issue.code)).toContain('AUTONOMY_SKIP_PERMISSION');
    });

    it('emite erro quando tool read-only expõe parâmetro com semântica mutável', () => {
        const registry = createRegistry();
        registerTool(
            registry,
            makeTool('lint_check', {
                skipPermission: true,
                parameters: {
                    type: 'object',
                    properties: {
                        path: { type: 'string' },
                        fix: { type: 'boolean' },
                    },
                },
            }),
            {
                category: 'code',
                tags: ['lint', 'read'],
                readOnly: true,
            },
        );

        const report = verifyToolRegistryContracts(registry);

        expect(report.ok).toBe(false);
        expect(report.mutableReadOnlyParameterCount).toBe(1);
        expect(report.issues).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    severity: 'error',
                    code: 'READONLY_MUTATING_PARAMETERS',
                    toolName: 'lint_check',
                }),
            ]),
        );
    });

    it('valida campos mínimos de envelope operacional por categoria', () => {
        expect(
            verifyToolOperationResultFieldsForCategory('search', {
                success: true,
                ok: true,
                status: 'success',
                retryable: false,
                terminalSummary: 'ok',
                matchCount: 3,
            }),
        ).toEqual([]);

        expect(
            verifyToolOperationResultFieldsForCategory('code', {
                success: false,
                ok: false,
                status: 'failure',
                retryable: false,
                terminalSummary: 'falhou',
                error: 'boom',
                category: 'process',
                blockedReason: 'process_failure',
                exitCode: 1,
                durationMs: 10,
            }),
        ).toEqual([]);

        expect(
            verifyToolOperationResultFieldsForCategory('search', {
                success: false,
                ok: false,
                status: 'failure',
            }).map((issue) => issue.code),
        ).toContain('MISSING_OPERATION_RESULT_FIELD');
    });
});
