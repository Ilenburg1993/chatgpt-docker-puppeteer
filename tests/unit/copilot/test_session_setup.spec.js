// @ts-check
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock de dependências externas
vi.mock('#copilot/observability/logger', () => ({
    log: vi.fn(),
    LOG_DIR: '/tmp/test-logs',
    getRecentLogs: vi.fn(() => []),
}));
vi.mock('#copilot/sdk', () => ({
    attachBus: vi.fn((hooks) => hooks),
    REASONING_EFFORTS: {
        LOW: 'low',
        MEDIUM: 'medium',
        HIGH: 'high',
        XHIGH: 'xhigh',
    },
    SYSTEM_PROMPT_SECTIONS: {},
    approveAll: vi.fn(async () => ({ kind: 'approve-once' })),
    createTool: vi.fn(() => ({ name: 'mock-tool', execute: vi.fn() })),
    createToolSync: vi.fn(() => ({ name: 'mock-tool-sync', execute: vi.fn() })),
    defineTool: vi.fn(() => ({ name: 'mock-defined', execute: vi.fn() })),
    AgentToolPolicy: class {
        isToolAllowedForAgent() {
            return true;
        }
    },
}));
vi.mock('#copilot/sdk/rpc', () => ({
    createSessionRpcFacade: vi.fn((session) => ({ session })),
}));
vi.mock('../../../src/copilot/agent/facades/sdk-access.js', () => ({
    createAgentSdkToolsRegistry: vi.fn(() => new Map()),
    getAgentSdkToolsConfig: vi.fn(() => ({ allowlist: null, denylist: [] })),
    readAgentSdkModelRegistryEntry: vi.fn((modelId) => {
        if (modelId === 'gpt-4.1') {
            return { supportsReasoning: false };
        }
        return { supportsReasoning: true };
    }),
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
vi.mock('#copilot/tools', async (importOriginal) => ({
    ...(await importOriginal()),
    bootstrapTools: vi.fn((_registry, mcpTools) => ['tool1', 'tool2', ...mcpTools]),
    setSessionRpc: vi.fn(),
    readStore: vi.fn(async () => ({ tasks: {} })),
    isToolDisabled: vi.fn(() => false),
}));
vi.mock('../../../src/copilot/agent/dialog/wiring/user-input-handler.js', () => ({
    handleUserInputRequest: vi.fn(),
}));

import { isToolDisabled } from '#copilot/tools';
import { handleUserInputRequest } from '../../../src/copilot/agent/dialog/wiring/user-input-handler.js';
import { getAgentSdkToolsConfig } from '../../../src/copilot/agent/facades/sdk-access.js';
import {
    buildSessionHooks,
    buildSessionOptions,
    buildSessionTools,
    finalizeSessionInit,
} from '../../../src/copilot/agent/lifecycle/setup/session-setup.js';
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
            getModelSnapshot: vi.fn(() => ctx.model),
            permissions: { handler: vi.fn() },
            webhooks: { emit: vi.fn() },
            dialogLoop: {
                active: false,
                scheduleFallback: vi.fn(),
                handleProtocolInput: vi.fn(),
            },
            reasoningEffort: 'medium',
            getReasoningEffortSnapshot: vi.fn(() => ctx.reasoningEffort),
            pendingQuestion: null,
            session: null,
            isResumed: false,
            setSession: vi.fn((session) => {
                ctx.session = session;
            }),
            setIsResumed: vi.fn((isResumed) => {
                ctx.isResumed = isResumed;
            }),
            setReasoningEffort: vi.fn(),
            setStatus: vi.fn(),
            trackBackgroundTask: vi.fn(),
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

        it('usa capability MCP injetada no contexto quando disponível', async () => {
            const buildTools = vi.fn(async () => [/** @type {any} */ ({ name: 'mcp-injected' })]);
            const buildConfig = vi.fn(() => ({ injected: true }));
            const startAutoReconnect = vi.fn(() => () => {});
            ctx.getMcpBridgeSnapshot = vi.fn(() => ({ buildTools, buildConfig, startAutoReconnect }));

            const result = await buildSessionTools(ctx);

            expect(buildTools).toHaveBeenCalledTimes(1);
            expect(result.tools).toContainEqual(expect.objectContaining({ name: 'mcp-injected' }));
        });
    });

    describe('buildSessionHooks', () => {
        it('deve retornar busHooks', () => {
            const result = buildSessionHooks(ctx, host);
            expect(result.busHooks).toBeDefined();
        });

        it('aplica a denylist local do runtime via onPreToolUse', async () => {
            vi.mocked(getAgentSdkToolsConfig).mockReturnValue({ allowlist: null, denylist: ['custom-danger'] });

            const result = buildSessionHooks(ctx, host);
            const decision = await result.busHooks.onPreToolUse?.(
                /** @type {import('#copilot/sdk/types').PreToolUseHookInput} */
                { toolName: 'custom-danger', toolArgs: {}, timestamp: 0, cwd: '/' },
                { sessionId: 's1' },
            );

            expect(decision).toEqual(expect.objectContaining({ permissionDecision: 'deny' }));
        });

        it('nega tool desabilitada dinamicamente em runtime (toggle_tool)', async () => {
            vi.mocked(getAgentSdkToolsConfig).mockReturnValue({ allowlist: null, denylist: [] });
            vi.mocked(isToolDisabled).mockReturnValueOnce(true);

            const result = buildSessionHooks(ctx, host);
            const decision = await result.busHooks.onPreToolUse?.(
                /** @type {import('#copilot/sdk/types').PreToolUseHookInput} */
                { toolName: 'danger_tool', toolArgs: {}, timestamp: 0, cwd: '/' },
                { sessionId: 's1' },
            );

            expect(decision).toEqual(expect.objectContaining({ permissionDecision: 'deny' }));
        });
    });

    describe('buildSessionOptions', () => {
        it('deve incluir model e hooks e tools nas opções', () => {
            const tools = /** @type {any} */ (['t1', 't2']);
            const busHooks = /** @type {any} */ ({ mock: true });
            const options = buildSessionOptions(ctx, host, { tools, busHooks });

            expect(options.model).toBe('gpt-4');
            expect(options.tools).toBe(tools);
            expect(options.hooks).toBe(busHooks);
            expect(options.reasoningEffort).toBe('medium');
            expect(options.enableConfigDiscovery).toBe(false);
            expect(options.includeSubAgentStreamingEvents).toBe(false);
            expect(options.injectHookContext).toBe(true);
            expect(typeof options.onPermissionRequest).toBe('function');
            expect(typeof options.onUserInputRequest).toBe('function');
            expect(Array.isArray(options.commands)).toBe(true);
            expect(options.commands).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        name: 'terminal_status',
                        description: expect.any(String),
                        handler: expect.any(Function),
                    }),
                    expect.objectContaining({
                        name: 'terminal_session',
                        description: expect.any(String),
                        handler: expect.any(Function),
                    }),
                    expect.objectContaining({
                        name: 'terminal_session_waits',
                        description: expect.any(String),
                        handler: expect.any(Function),
                    }),
                ]),
            );
        });

        it('registra comandos SDK operacionais que emitem evento canonico sem reimplementar o REPL', () => {
            const tools = /** @type {any} */ (['t1']);
            const busHooks = /** @type {any} */ ({ mock: true });
            const options = buildSessionOptions(ctx, host, { tools, busHooks });
            const commands = /** @type {{ name: string; handler: Function }[]} */ (options.commands);
            const terminalSession = commands.find((command) => command.name === 'terminal_session');

            terminalSession?.handler({
                sessionId: 'sdk-session-1',
                commandName: 'terminal_session',
                command: 'terminal_session recent',
                args: ['recent'],
            });

            expect(host.emit).toHaveBeenCalledWith(
                'sdk.command.executed',
                expect.objectContaining({
                    commandName: 'terminal_session',
                    command: 'terminal_session recent',
                    sessionId: 'sdk-session-1',
                    args: ['recent'],
                    localCommand: '/session sdk',
                    safe: true,
                }),
            );
        });

        it('oculta built-ins legadas de FS na superfície de sessão quando as file-tools canônicas existem', () => {
            const tools = /** @type {any} */ ([
                { name: 'list_directory' },
                { name: 'read_file_content' },
                { name: 'search_in_files' },
                { name: 'create_file' },
                { name: 'write_file_content' },
                { name: 'patch_file' },
            ]);
            const busHooks = /** @type {any} */ ({ mock: true });

            const options = buildSessionOptions(ctx, host, { tools, busHooks });

            expect(options.excludedTools).toEqual(['glob', 'view']);
        });

        it('omite reasoningEffort quando o modelo não suporta a capability e normaliza o ctx', () => {
            ctx.model = 'gpt-4.1';
            ctx.reasoningEffort = 'medium';
            const tools = /** @type {any} */ (['t1']);
            const busHooks = /** @type {any} */ ({ mock: true });

            const options = buildSessionOptions(ctx, host, { tools, busHooks });

            expect(options.reasoningEffort).toBeUndefined();
            expect(ctx.setReasoningEffort).toHaveBeenCalledWith(undefined);
        });

        it('usa buildConfig da capability MCP injetada ao montar a sessão', () => {
            const tools = /** @type {any} */ (['t1']);
            const busHooks = /** @type {any} */ ({ mock: true });
            const buildTools = vi.fn(async () => []);
            const buildConfig = vi.fn(() => ({ demo: { command: 'node', args: ['server.js'] } }));
            const startAutoReconnect = vi.fn(() => () => {});
            ctx.getMcpBridgeSnapshot = vi.fn(() => ({ buildTools, buildConfig, startAutoReconnect }));

            const options = buildSessionOptions(ctx, host, { tools, busHooks });

            expect(buildConfig).toHaveBeenCalledTimes(1);
            expect(options.mcpServers).toEqual({ demo: { command: 'node', args: ['server.js'] } });
        });

        it('normaliza UserInputRequest do SDK preservando default allowFreeform=true', async () => {
            const tools = /** @type {any} */ (['t1']);
            const busHooks = /** @type {any} */ ({ mock: true });
            const options = buildSessionOptions(ctx, host, { tools, busHooks });
            const onUserInputRequest = /**
             * @type {(input: { question: string; choices?: string[]; allowFreeform?: boolean }) => Promise<unknown>}
             */ (options.onUserInputRequest);

            await onUserInputRequest({ question: 'Qual o próximo passo?', choices: ['A', 'B'] });

            expect(handleUserInputRequest).toHaveBeenCalledWith(
                {
                    question: 'Qual o próximo passo?',
                    choices: ['A', 'B'],
                    allowFreeform: true,
                },
                expect.objectContaining({
                    isDialogLoopActive: expect.any(Function),
                    handleProtocolInput: expect.any(Function),
                    setStatus: expect.any(Function),
                    setPendingQuestion: expect.any(Function),
                    trackBackgroundTask: expect.any(Function),
                    emit: expect.any(Function),
                }),
            );
        });

        it('normaliza allowFreeform=false legado para texto livre efetivo', async () => {
            const tools = /** @type {any} */ (['t1']);
            const busHooks = /** @type {any} */ ({ mock: true });
            const options = buildSessionOptions(ctx, host, { tools, busHooks });
            const onUserInputRequest = /**
             * @type {(input: { question: string; choices?: string[]; allowFreeform?: boolean }) => Promise<unknown>}
             */ (options.onUserInputRequest);

            await onUserInputRequest({ question: 'Escolha', allowFreeform: false });

            expect(handleUserInputRequest).toHaveBeenLastCalledWith(
                {
                    question: 'Escolha',
                    allowFreeform: true,
                },
                expect.any(Object),
            );
        });
    });

    describe('finalizeSessionInit', () => {
        it('deve atualizar ctx.session, ctx.isResumed e setSessionRpc', () => {
            const session = /** @type {any} */ ({ rpc: 'mock-rpc', sessionId: 's1' });
            finalizeSessionInit(ctx, session, true);

            expect(ctx.session).toBe(session);
            expect(ctx.isResumed).toBe(true);
            expect(ctx.setSession).toHaveBeenCalledWith(session);
            expect(ctx.setIsResumed).toHaveBeenCalledWith(true);
        });
    });
});
