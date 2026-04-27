/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck -- test file uses untyped mocks extensively
/**
 * Testes — Faixa 8: sdk/rpc.js (Advanced RPC Subsystems)
 *
 * Cobre: compactionCompact, shellExec, shellKill, uiElicitation, commandsHandlePending, permissionsHandlePending,
 * toolsHandlePendingCall
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setSdkMetricEmitter } from '../../../../src/copilot/sdk/telemetry/operation-metrics.js';

const { mockLog } = vi.hoisted(() => ({
    mockLog: vi.fn(),
}));

vi.mock('#copilot/observability/logger', () => ({
    log: mockLog,
    LOG_DIR: '/tmp/test-logs',
    getRecentLogs: vi.fn(() => []),
}));

vi.mock('@github/copilot-sdk', () => ({
    CopilotClient: vi.fn(),
    approveAll: vi.fn(),
    defineTool: vi.fn(),
    SYSTEM_PROMPT_SECTIONS: {
        guidelines: { name: 'guidelines' },
        identity: { name: 'identity' },
        context: { name: 'context' },
        safety: { name: 'safety' },
        responseFormat: { name: 'responseFormat' },
        tools: { name: 'tools' },
        abilities: { name: 'abilities' },
        instructions: { name: 'instructions' },
        conversationRules: { name: 'conversationRules' },
        errorHandling: { name: 'errorHandling' },
    },
}));

import {
    commandsHandlePending,
    compactionCompact,
    permissionsHandlePending,
    shellExec,
    shellKill,
    toolsHandlePendingCall,
    uiElicitation,
} from '#copilot/sdk/rpc';

// ─── Helper: fake session with advanced rpc ────────────────────────────────

function fakeSession(rpcOverrides = {}) {
    return {
        sessionId: 'sess-adv-001',
        rpc: {
            model: { getCurrent: vi.fn(), switchTo: vi.fn() },
            mode: { get: vi.fn(), set: vi.fn() },
            plan: { read: vi.fn(), update: vi.fn(), delete: vi.fn() },
            workspace: { listFiles: vi.fn(), readFile: vi.fn(), createFile: vi.fn() },
            log: vi.fn(),
            compaction: {
                compact: vi.fn().mockResolvedValue({ success: true, tokensRemoved: 500, messagesRemoved: 10 }),
            },
            shell: {
                exec: vi.fn().mockResolvedValue({ processId: 'proc-001' }),
                kill: vi.fn().mockResolvedValue({ killed: true }),
            },
            ui: {
                elicitation: vi.fn().mockResolvedValue({ action: 'accept', content: { name: 'test' } }),
            },
            commands: {
                handlePendingCommand: vi.fn().mockResolvedValue({ success: true }),
            },
            permissions: {
                handlePendingPermissionRequest: vi.fn().mockResolvedValue({ success: true }),
            },
            tools: {
                handlePendingToolCall: vi.fn().mockResolvedValue({ success: true }),
            },
            ...rpcOverrides,
        },
    };
}

// ═══════════════════════════════════════════════════════════════════════════════

describe('sdk/rpc — Advanced Subsystems', () => {
    /** @type {import('../../../../src/copilot/sdk/types.js').SdkOperationMetric[]} */
    let metrics;

    beforeEach(() => {
        vi.clearAllMocks();
        metrics = [];
        setSdkMetricEmitter((metric) => metrics.push(metric));
    });

    afterEach(() => {
        setSdkMetricEmitter(null);
    });

    // ─── COMPACTION ────────────────────────────────────────────────────────

    describe('compactionCompact', () => {
        it('retorna resultado da compactação', async () => {
            const s = fakeSession();
            const result = await compactionCompact(s);
            expect(result.success).toBe(true);
            expect(result.tokensRemoved).toBe(500);
            expect(result.messagesRemoved).toBe(10);
            expect(s.rpc.compaction.compact).toHaveBeenCalledOnce();
            expect(metrics.map((metric) => `${metric.operation}:${metric.status}`)).toEqual(
                expect.arrayContaining(['rpc.compaction.compact:started', 'rpc.compaction.compact:succeeded']),
            );
        });

        it('rejeita sessão inválida', async () => {
            await expect(compactionCompact(null)).rejects.toThrow(TypeError);
        });

        it('propaga erro do SDK', async () => {
            const s = fakeSession({
                compaction: { compact: vi.fn().mockRejectedValue(new Error('not enabled')) },
            });
            await expect(compactionCompact(s)).rejects.toThrow('not enabled');
        });
    });

    // ─── SHELL ─────────────────────────────────────────────────────────────

    describe('shellExec', () => {
        it('executa comando básico', async () => {
            const s = fakeSession();
            const result = await shellExec(s, 'ls -la');
            expect(s.rpc.shell.exec).toHaveBeenCalledWith({ command: 'ls -la' });
            expect(result.processId).toBe('proc-001');
            expect(metrics.map((metric) => `${metric.operation}:${metric.status}`)).toEqual(
                expect.arrayContaining(['rpc.shell.exec:started', 'rpc.shell.exec:succeeded']),
            );
        });

        it('passa opções cwd e timeout', async () => {
            const s = fakeSession();
            await shellExec(s, 'npm test', { cwd: '/tmp', timeout: 60000 });
            expect(s.rpc.shell.exec).toHaveBeenCalledWith({
                command: 'npm test',
                cwd: '/tmp',
                timeout: 60000,
            });
        });

        it('rejeita command vazio', async () => {
            const s = fakeSession();
            await expect(shellExec(s, '')).rejects.toThrow('string não-vazia');
        });

        it('rejeita sessão inválida', async () => {
            await expect(shellExec(null, 'ls')).rejects.toThrow(TypeError);
        });

        it('emite métrica failed quando shell.exec falha', async () => {
            const s = fakeSession({
                shell: {
                    exec: vi.fn().mockRejectedValue(Object.assign(new Error('socket closed'), { code: 'ECONNRESET' })),
                    kill: vi.fn().mockResolvedValue({ killed: true }),
                },
            });
            await expect(shellExec(s, 'ls -la')).rejects.toThrow('socket closed');
            expect(metrics.map((metric) => `${metric.operation}:${metric.status}`)).toEqual(
                expect.arrayContaining(['rpc.shell.exec:started', 'rpc.shell.exec:failed']),
            );
        });
    });

    describe('shellKill', () => {
        it('mata processo com SIGTERM por padrão', async () => {
            const s = fakeSession();
            const result = await shellKill(s, 'proc-001');
            expect(s.rpc.shell.kill).toHaveBeenCalledWith({ processId: 'proc-001' });
            expect(result.killed).toBe(true);
        });

        it('passa sinal customizado', async () => {
            const s = fakeSession();
            await shellKill(s, 'proc-001', 'SIGKILL');
            expect(s.rpc.shell.kill).toHaveBeenCalledWith({ processId: 'proc-001', signal: 'SIGKILL' });
        });

        it('rejeita processId vazio', async () => {
            const s = fakeSession();
            await expect(shellKill(s, '')).rejects.toThrow('string não-vazia');
        });

        it('rejeita sessão inválida', async () => {
            await expect(shellKill(null, 'x')).rejects.toThrow(TypeError);
        });
    });

    // ─── UI ────────────────────────────────────────────────────────────────

    describe('uiElicitation', () => {
        it('envia formulário e retorna resposta', async () => {
            const schema = { type: 'object', properties: { name: { type: 'string' } } };
            const s = fakeSession();
            const result = await uiElicitation(s, 'Confirme seu nome', schema);
            expect(result.action).toBe('accept');
            expect(result.content).toEqual({ name: 'test' });
            expect(s.rpc.ui.elicitation).toHaveBeenCalledWith({
                message: 'Confirme seu nome',
                requestedSchema: schema,
            });
            expect(metrics.map((metric) => `${metric.operation}:${metric.status}`)).toEqual(
                expect.arrayContaining(['rpc.ui.elicitation:started', 'rpc.ui.elicitation:succeeded']),
            );
        });

        it('rejeita message vazia', async () => {
            const s = fakeSession();
            await expect(uiElicitation(s, '', {})).rejects.toThrow('string não-vazia');
        });

        it('rejeita schema não-objeto', async () => {
            const s = fakeSession();
            await expect(uiElicitation(s, 'msg', null)).rejects.toThrow('objeto');
        });

        it('rejeita sessão inválida', async () => {
            await expect(uiElicitation(null, 'x', {})).rejects.toThrow(TypeError);
        });
    });

    // ─── COMMANDS ──────────────────────────────────────────────────────────

    describe('commandsHandlePending', () => {
        it('resolve comando pendente', async () => {
            const s = fakeSession();
            const result = await commandsHandlePending(s, 'req-001');
            expect(result.success).toBe(true);
            expect(s.rpc.commands.handlePendingCommand).toHaveBeenCalledWith({ requestId: 'req-001' });
        });

        it('passa erro opcional', async () => {
            const s = fakeSession();
            await commandsHandlePending(s, 'req-002', { error: 'not found' });
            expect(s.rpc.commands.handlePendingCommand).toHaveBeenCalledWith({
                requestId: 'req-002',
                error: 'not found',
            });
        });

        it('rejeita requestId vazio', async () => {
            const s = fakeSession();
            await expect(commandsHandlePending(s, '')).rejects.toThrow('string não-vazia');
        });

        it('rejeita sessão inválida', async () => {
            await expect(commandsHandlePending(null, 'x')).rejects.toThrow(TypeError);
        });
    });

    // ─── PERMISSIONS ───────────────────────────────────────────────────────

    describe('permissionsHandlePending', () => {
        it('resolve permissão aprovada', async () => {
            const s = fakeSession();
            const result = await permissionsHandlePending(s, 'req-003', { kind: 'approved' });
            expect(result.success).toBe(true);
            expect(s.rpc.permissions.handlePendingPermissionRequest).toHaveBeenCalledWith({
                requestId: 'req-003',
                result: { kind: 'approved' },
            });
        });

        it('resolve permissão negada', async () => {
            const s = fakeSession();
            await permissionsHandlePending(s, 'req-004', { kind: 'denied-interactively-by-user', feedback: 'nope' });
            expect(s.rpc.permissions.handlePendingPermissionRequest).toHaveBeenCalledWith({
                requestId: 'req-004',
                result: { kind: 'denied-interactively-by-user', feedback: 'nope' },
            });
        });

        it('rejeita result sem kind', async () => {
            const s = fakeSession();
            await expect(permissionsHandlePending(s, 'req-005', {})).rejects.toThrow('kind');
        });

        it('rejeita requestId vazio', async () => {
            const s = fakeSession();
            await expect(permissionsHandlePending(s, '', { kind: 'approved' })).rejects.toThrow('string não-vazia');
        });
    });

    // ─── TOOLS ─────────────────────────────────────────────────────────────

    describe('toolsHandlePendingCall', () => {
        it('resolve tool call com resultado string', async () => {
            const s = fakeSession();
            const result = await toolsHandlePendingCall(s, 'req-006', { result: 'output text' });
            expect(result.success).toBe(true);
            expect(s.rpc.tools.handlePendingToolCall).toHaveBeenCalledWith({
                requestId: 'req-006',
                result: 'output text',
            });
        });

        it('resolve tool call com resultado objeto', async () => {
            const s = fakeSession();
            const toolResult = { textResultForLlm: 'done', resultType: 'text' };
            await toolsHandlePendingCall(s, 'req-007', { result: toolResult });
            expect(s.rpc.tools.handlePendingToolCall).toHaveBeenCalledWith({
                requestId: 'req-007',
                result: toolResult,
            });
        });

        it('resolve tool call com erro', async () => {
            const s = fakeSession();
            await toolsHandlePendingCall(s, 'req-008', { error: 'tool crashed' });
            expect(s.rpc.tools.handlePendingToolCall).toHaveBeenCalledWith({
                requestId: 'req-008',
                error: 'tool crashed',
            });
        });

        it('rejeita requestId vazio', async () => {
            const s = fakeSession();
            await expect(toolsHandlePendingCall(s, '')).rejects.toThrow('string não-vazia');
        });
    });

    // ─── Barrel re-export ──────────────────────────────────────────────────

    describe('barrel re-export (Faixa 8)', () => {
        it('exporta todos os 7 símbolos avançados via barrel', async () => {
            const barrel = await import('#copilot/sdk');
            expect(barrel.compactionCompact).toBeTypeOf('function');
            expect(barrel.shellExec).toBeTypeOf('function');
            expect(barrel.shellKill).toBeTypeOf('function');
            expect(barrel.uiElicitation).toBeTypeOf('function');
            expect(barrel.commandsHandlePending).toBeTypeOf('function');
            expect(barrel.permissionsHandlePending).toBeTypeOf('function');
            expect(barrel.toolsHandlePendingCall).toBeTypeOf('function');
        });
    });
});
