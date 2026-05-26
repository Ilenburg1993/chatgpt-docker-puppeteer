// @ts-check

import { describe, expect, it } from 'vitest';

import { createRegistry, registerTool } from '#copilot/sdk/tools';
import { verifyToolRegistryContracts } from '../../../../src/copilot/tools/introspection/tool-contract-verifier.js';

/**
 * @param {string} name
 * @param {{ skipPermission?: boolean }} [options]
 * @returns {import('@github/copilot-sdk').Tool}
 */
function makeTool(name, options = {}) {
    return /** @type {any} */ ({
        name,
        description: `Tool ${name}`,
        parameters: { type: 'object', properties: {} },
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
});
