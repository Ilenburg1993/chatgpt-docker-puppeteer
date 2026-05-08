// @ts-check
import { describe, expect, it } from 'vitest';

import { createRegistry } from '#copilot/sdk/tools-registry';
import { bootstrapTools } from '#copilot/tools/bootstrap';

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
            const parameters = /** @type {Record<string, unknown>} */ (tool?.parameters ?? {});
            expect(parameters).toMatchObject({
                type: 'object',
                properties: expect.any(Object),
            });
            expect(Object.keys(/** @type {Record<string, unknown>} */ (parameters['properties'] ?? {}))).not.toHaveLength(
                0,
            );
        }
    });
});
