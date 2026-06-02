// @ts-check
import { describe, expect, it } from 'vitest';

import { setCustomToolsBuilder } from '#copilot/sdk';
import { createRegistry } from '#copilot/sdk/tools';
import { applySessionToolPermissionPolicy, bootstrapTools, buildTool } from '#copilot/tools';

setCustomToolsBuilder(/** @type {Parameters<typeof setCustomToolsBuilder>[0]} */ (buildTool));

describe('tools bootstrap file capabilities', () => {
    it('carrega read/write/index/scope tools de filesystem no SDK runtime', () => {
        const tools = bootstrapTools(createRegistry(), []);
        const names = new Set(tools.map((tool) => tool.name));
        expect(names.has('read_file_content')).toBe(true);
        expect(names.has('workspace_index_build')).toBe(true);
        expect(names.has('workspace_index_search')).toBe(true);
        expect(names.has('workspace_scope_context')).toBe(true);
        expect(names.has('workspace_scope_close')).toBe(true);
    });

    it('expõe schemas invocáveis para file-tools Zod v4', () => {
        const tools = bootstrapTools(createRegistry(), []);
        for (const name of ['read_file_content', 'create_file', 'write_file_content', 'patch_file']) {
            const tool = tools.find((candidate) => candidate.name === name);
            expect(tool, `${name} deve estar registrado`).toBeTruthy();
            expect(typeof tool?.handler).toBe('function');
            const parameters = /** @type {Record<string, unknown>} */ (tool?.parameters ?? {});
            expect(parameters && typeof parameters === 'object').toBe(true);
            if (parameters['type'] === 'object') {
                expect(
                    Object.keys(/** @type {Record<string, unknown>} */ (parameters['properties'] ?? {})),
                ).not.toHaveLength(0);
            }
        }
    });

    it('aplica skipPermission às tools de sessão em approve_all/audit_only e preserva selective', () => {
        const tools = [
            { name: 'unsafe_write', handler: async () => 'ok', skipPermission: false },
            { name: 'already_open', handler: async () => 'ok', skipPermission: true },
        ];

        expect(applySessionToolPermissionPolicy(tools, 'approve_all').map((tool) => tool.skipPermission)).toEqual([
            true,
            true,
        ]);
        expect(applySessionToolPermissionPolicy(tools, 'audit_only').map((tool) => tool.skipPermission)).toEqual([
            true,
            true,
        ]);
        expect(applySessionToolPermissionPolicy(tools, 'selective')).toBe(tools);
    });
});
