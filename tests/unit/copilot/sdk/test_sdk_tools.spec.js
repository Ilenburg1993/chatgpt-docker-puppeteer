// @ts-check
/**
 * tests/unit/copilot/sdk/test_sdk_tools.spec.js
 *
 * Testes para src/copilot/sdk/tools.js (Faixa 2 / F6). Cobre: createTool, createToolSync, defineTool re-export.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock logger
vi.mock('#copilot/observability/logger', () => ({ log: vi.fn(), LOG_DIR: '/tmp/test-logs', getRecentLogs: vi.fn(() => []), }));

// Mock defineTool do SDK — retorna o config recebido para inspeção
vi.mock('@github/copilot-sdk', () => ({
    defineTool: vi.fn((name, config) => ({ name, ...config })),
    approveAll: vi.fn(),
    SYSTEM_PROMPT_SECTIONS: {
        identity: { description: 'Identity' },
        tone: { description: 'Tone' },
        tool_efficiency: { description: 'Tool efficiency' },
        environment_context: { description: 'Environment' },
        code_change_rules: { description: 'Code changes' },
        guidelines: { description: 'Guidelines' },
        safety: { description: 'Safety' },
        tool_instructions: { description: 'Tool instructions' },
        custom_instructions: { description: 'Custom instructions' },
        last_instructions: { description: 'Last instructions' },
    },
}));

describe('sdk/tools.js', () => {
    /** @type {typeof import('../../../../src/copilot/sdk/tools.js')} */
    let tools;

    beforeEach(async () => {
        vi.clearAllMocks();
        tools = await import('../../../../src/copilot/sdk/tools.js');
    });

    describe('createTool()', () => {
        it('cria uma tool com nome e handler', () => {
            const handler = vi.fn();
            const tool = tools.createTool({
                name: 'test_tool',
                description: 'Tool de teste',
                handler,
            });
            expect(tool).toBeDefined();
            expect(tool.name).toBe('test_tool');
        });

        it('lança TypeError se name ausente', () => {
            expect(() =>
                tools.createTool({
                    name: '',
                    description: 'x',
                    handler: vi.fn(),
                }),
            ).toThrow(TypeError);
        });

        it('lança TypeError se handler ausente', () => {
            expect(() =>
                tools.createTool({
                    name: 'no_handler',
                    description: 'x',
                    handler: /** @type {any} */ (null),
                }),
            ).toThrow(TypeError);
        });

        it('skipPermission default é false', () => {
            const tool = tools.createTool({
                name: 'sp_test',
                description: 'Test',
                handler: vi.fn(),
            });
            expect(tool.skipPermission).toBe(false);
        });

        it('aceita skipPermission: true', () => {
            const tool = tools.createTool({
                name: 'skip_test',
                description: 'Test',
                handler: vi.fn(),
                skipPermission: true,
            });
            expect(tool.skipPermission).toBe(true);
        });

        it('aceita JSON Schema manual como parameters', () => {
            const schema = { type: 'object', properties: { path: { type: 'string' } } };
            const tool = tools.createTool({
                name: 'json_schema_test',
                description: 'Test',
                parameters: schema,
                handler: vi.fn(),
            });
            expect(tool.parameters).toEqual(schema);
        });

        it('aceita overridesBuiltInTool: true', () => {
            const tool = tools.createTool({
                name: 'override_test',
                description: 'Test',
                handler: vi.fn(),
                overridesBuiltInTool: true,
            });
            expect(tool.overridesBuiltInTool).toBe(true);
        });

        it('handler wrapper invoca handler original', async () => {
            const original = vi.fn().mockResolvedValue('resultado');
            const tool = tools.createTool({
                name: 'invoke_test',
                description: 'Test',
                handler: original,
            });
            const result = await tool.handler('args', /** @type {any} */ ({ sessionId: 'sess-1' }));
            expect(result).toBe('resultado');
        });
    });

    describe('createToolSync()', () => {
        it('cria uma tool sync com nome e handler', () => {
            const tool = tools.createToolSync({
                name: 'sync_tool',
                description: 'Sync tool',
                handler: vi.fn(),
            });
            expect(tool.name).toBe('sync_tool');
        });

        it('lança TypeError se name ausente', () => {
            expect(() =>
                tools.createToolSync({
                    name: '',
                    description: 'x',
                    handler: vi.fn(),
                }),
            ).toThrow(TypeError);
        });

        it('lança TypeError se handler ausente', () => {
            expect(() =>
                tools.createToolSync({
                    name: 'no_handler_sync',
                    description: 'x',
                    handler: /** @type {any} */ (null),
                }),
            ).toThrow(TypeError);
        });
    });

    describe('defineTool re-export', () => {
        it('é uma função', () => {
            expect(typeof tools.defineTool).toBe('function');
        });
    });
});
