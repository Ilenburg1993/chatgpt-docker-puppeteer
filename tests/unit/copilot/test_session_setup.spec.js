// @ts-check
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock de dependências externas
vi.mock('#copilot/observability/logger', () => ({
    log: vi.fn(),
    LOG_DIR: '/tmp/test-logs',
    getRecentLogs: vi.fn(() => []),
}));
vi.mock('#copilot/sdk/index', () => ({
    createRegistry: vi.fn(() => new Map()),
    SYSTEM_PROMPT_SECTIONS: {},
    createTool: vi.fn(() => ({ name: 'mock-tool', execute: vi.fn() })),
    createToolSync: vi.fn(() => ({ name: 'mock-tool-sync', execute: vi.fn() })),
    defineTool: vi.fn(() => ({ name: 'mock-defined', execute: vi.fn() })),
}));
vi.mock('../../../src/copilot/bridges/mcp-tool-bridge.js', () => ({ buildMcpTools: vi.fn(async () => []) }));
vi.mock('../../../src/copilot/config/mcp-servers.js', () => ({ buildMcpConfig: vi.fn(() => ({})) }));
vi.mock('#copilot/hooks/bus', () => ({ attachBus: vi.fn((h) => h) }));
vi.mock('#copilot/hooks/factory', () => ({ createHooks: vi.fn((opts) => opts) }));
vi.mock('#copilot/hooks/session-hooks', () => ({
    createSessionHooks: vi.fn(() => ({
        onSessionStart: vi.fn(),
        onSessionEnd: vi.fn(),
        onErrorOccurred: vi.fn(),
    })),
}));
vi.mock('../../../src/copilot/agent/infra/tools-bootstrap.js', () => ({
    bootstrapTools: vi.fn((_registry, mcpTools) => ['tool1', 'tool2', ...mcpTools]),
    setSessionRpc: vi.fn(),
}));
vi.mock('../../../src/copilot/agent/dialog/user-input-handler.js', () => ({
    handleUserInputRequest: vi.fn(),
}));

import { setSessionRpc } from '../../../src/copilot/agent/infra/tools-bootstrap.js';
import {
    buildSessionHooks,
    buildSessionOptions,
    buildSessionTools,
    finalizeSessionInit,
} from '../../../src/copilot/agent/lifecycle/session-setup.js';
import { buildMcpTools } from '../../../src/copilot/bridges/mcp-tool-bridge.js';

describe('session-setup (F63)', () => {
    /** @type {any} */
    let ctx;
    /** @type {any} */
    let host;

    beforeEach(() => {
        vi.clearAllMocks();
        ctx = {
            messagesCache: { invalidate: vi.fn() },
            toolsRegistry: null,
            model: 'gpt-4',
            permissions: { handler: vi.fn() },
            webhooks: { emit: vi.fn() },
            dialogLoop: {
                active: false,
                scheduleFallback: vi.fn(),
                handleProtocolInput: vi.fn(),
            },
            reasoningEffort: 'medium',
            pendingQuestion: null,
            session: null,
            isResumed: false,
            setStatus: vi.fn(),
        };
        host = {
            emit: vi.fn(),
        };
    });

    describe('buildSessionTools', () => {
        it('deve invalidar messagesCache e retornar tools', async () => {
            const result = await buildSessionTools(ctx);
            expect(ctx.messagesCache.invalidate).toHaveBeenCalled();
            expect(result.tools).toBeDefined();
            expect(Array.isArray(result.tools)).toBe(true);
        });

        it('deve incluir MCP tools quando disponíveis', async () => {
            vi.mocked(buildMcpTools).mockResolvedValue([/** @type {any} */ ({ name: 'mcp-tool' })]);
            const result = await buildSessionTools(ctx);
            expect(result.tools).toContainEqual(expect.objectContaining({ name: 'mcp-tool' }));
        });
    });

    describe('buildSessionHooks', () => {
        it('deve retornar busHooks', () => {
            const result = buildSessionHooks(ctx, host);
            expect(result.busHooks).toBeDefined();
        });
    });

    describe('buildSessionOptions', () => {
        it('deve incluir model e hooks e tools nas opções', () => {
            const tools = ['t1', 't2'];
            const busHooks = /** @type {any} */ ({ mock: true });
            const options = buildSessionOptions(ctx, host, { tools, busHooks });

            expect(options.model).toBe('gpt-4');
            expect(options.tools).toBe(tools);
            expect(options.hooks).toBe(busHooks);
            expect(options.reasoningEffort).toBe('medium');
            expect(options.injectHookContext).toBe(true);
            expect(typeof options.onPermissionRequest).toBe('function');
            expect(typeof options.onUserInputRequest).toBe('function');
        });
    });

    describe('finalizeSessionInit', () => {
        it('deve atualizar ctx.session, ctx.isResumed e setSessionRpc', () => {
            const session = /** @type {any} */ ({ rpc: 'mock-rpc', sessionId: 's1' });
            finalizeSessionInit(ctx, session, true);

            expect(ctx.session).toBe(session);
            expect(ctx.isResumed).toBe(true);
            expect(setSessionRpc).toHaveBeenCalledWith('mock-rpc');
        });
    });
});
