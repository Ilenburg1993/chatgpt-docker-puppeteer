/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck -- test file uses untyped mocks extensively
/**
 * Testes — Faixa 7: sdk/rpc.js (Core RPC Subsystems)
 *
 * Cobre: model (getCurrent, switchTo), mode (get, set), plan (read, update, delete), workspace (listFiles, readFile,
 * createFile), sessionLog, createSessionRpcFacade
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockLog } = vi.hoisted(() => ({
    mockLog: vi.fn(),
}));

// ─── Mock: logger ──────────────────────────────────────────────────────────
vi.mock('#copilot/observability/logger', () => ({
    log: mockLog, LOG_DIR: '/tmp/test-logs', getRecentLogs: vi.fn(() => []), }));

// ─── Mock: SDK (necessário pelo barrel) ────────────────────────────────────
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
    createSessionRpcFacade,
    modeGet,
    modelGetCurrent,
    modelSwitchTo,
    modeSet,
    planDelete,
    planRead,
    planUpdate,
    sessionLog,
    workspaceCreateFile,
    workspaceListFiles,
    workspaceReadFile,
} from '#copilot/sdk/rpc';

// ─── Helper: fake session with rpc ─────────────────────────────────────────

function fakeSession(rpcOverrides = {}) {
    return {
        sessionId: 'sess-rpc-001',
        rpc: {
            model: {
                getCurrent: vi.fn().mockResolvedValue({ modelId: 'gpt-4.1' }),
                switchTo: vi.fn().mockResolvedValue({ modelId: 'gpt-4.1-mini' }),
            },
            mode: {
                get: vi.fn().mockResolvedValue({ mode: 'interactive' }),
                set: vi.fn().mockResolvedValue({ mode: 'plan' }),
            },
            plan: {
                read: vi.fn().mockResolvedValue({ exists: true, content: '# Plan', path: '/tmp/plan.md' }),
                update: vi.fn().mockResolvedValue({}),
                delete: vi.fn().mockResolvedValue({}),
            },
            workspace: {
                listFiles: vi.fn().mockResolvedValue({ files: ['a.txt', 'b.txt'] }),
                readFile: vi.fn().mockResolvedValue({ content: 'hello' }),
                createFile: vi.fn().mockResolvedValue({}),
            },
            log: vi.fn().mockResolvedValue({ eventId: 'evt-123' }),
            ...rpcOverrides,
        },
    };
}

// ═══════════════════════════════════════════════════════════════════════════════

describe('sdk/rpc — Core Subsystems', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    // ─── MODEL ─────────────────────────────────────────────────────────────

    describe('model.getCurrent', () => {
        it('retorna modelId ativo', async () => {
            const s = fakeSession();
            const result = await modelGetCurrent(s);
            expect(result.modelId).toBe('gpt-4.1');
            expect(s.rpc.model.getCurrent).toHaveBeenCalledOnce();
        });

        it('rejeita para sessão inválida', async () => {
            await expect(modelGetCurrent(null)).rejects.toThrow(TypeError);
        });

        it('rejeita para sessão sem rpc', async () => {
            await expect(modelGetCurrent({ sessionId: 'x' })).rejects.toThrow('sem RPC');
        });
    });

    describe('model.switchTo', () => {
        it('troca modelo com reasoningEffort', async () => {
            const s = fakeSession();
            await modelSwitchTo(s, 'claude-sonnet-4-5', { reasoningEffort: 'high' });
            expect(s.rpc.model.switchTo).toHaveBeenCalledWith({
                modelId: 'claude-sonnet-4-5',
                reasoningEffort: 'high',
            });
        });

        it('troca modelo sem options', async () => {
            const s = fakeSession();
            await modelSwitchTo(s, 'gpt-4.1-mini');
            expect(s.rpc.model.switchTo).toHaveBeenCalledWith({ modelId: 'gpt-4.1-mini' });
        });

        it('rejeita modelId vazio', async () => {
            const s = fakeSession();
            await expect(modelSwitchTo(s, '')).rejects.toThrow('string não-vazia');
        });

        it('rejeita modelId não-string', async () => {
            const s = fakeSession();
            await expect(modelSwitchTo(s, 42)).rejects.toThrow(TypeError);
        });

        it('propaga erro do SDK', async () => {
            const s = fakeSession({
                model: {
                    getCurrent: vi.fn(),
                    switchTo: vi.fn().mockRejectedValue(new Error('model not found')),
                },
            });
            await expect(modelSwitchTo(s, 'invalid')).rejects.toThrow('model not found');
        });
    });

    // ─── MODE ──────────────────────────────────────────────────────────────

    describe('mode.get', () => {
        it('retorna modo atual', async () => {
            const s = fakeSession();
            const result = await modeGet(s);
            expect(result.mode).toBe('interactive');
        });

        it('rejeita para sessão inválida', async () => {
            await expect(modeGet(null)).rejects.toThrow(TypeError);
        });
    });

    describe('mode.set', () => {
        it('altera para plan', async () => {
            const s = fakeSession();
            const result = await modeSet(s, 'plan');
            expect(s.rpc.mode.set).toHaveBeenCalledWith({ mode: 'plan' });
            expect(result.mode).toBe('plan');
        });

        it('altera para autopilot', async () => {
            const s = fakeSession();
            await modeSet(s, 'autopilot');
            expect(s.rpc.mode.set).toHaveBeenCalledWith({ mode: 'autopilot' });
        });

        it('rejeita modo inválido', async () => {
            const s = fakeSession();
            await expect(modeSet(s, 'invalid')).rejects.toThrow('deve ser um de');
        });

        it('rejeita para sessão inválida', async () => {
            await expect(modeSet(null, 'plan')).rejects.toThrow(TypeError);
        });
    });

    // ─── PLAN ──────────────────────────────────────────────────────────────

    describe('plan.read', () => {
        it('retorna plano existente', async () => {
            const s = fakeSession();
            const result = await planRead(s);
            expect(result.exists).toBe(true);
            expect(result.content).toBe('# Plan');
        });

        it('rejeita para sessão inválida', async () => {
            await expect(planRead(null)).rejects.toThrow(TypeError);
        });
    });

    describe('plan.update', () => {
        it('atualiza conteúdo do plano', async () => {
            const s = fakeSession();
            await planUpdate(s, '# Updated Plan');
            expect(s.rpc.plan.update).toHaveBeenCalledWith({ content: '# Updated Plan' });
        });

        it('rejeita content não-string', async () => {
            const s = fakeSession();
            await expect(planUpdate(s, 42)).rejects.toThrow('deve ser string');
        });

        it('rejeita para sessão inválida', async () => {
            await expect(planUpdate(null, 'x')).rejects.toThrow(TypeError);
        });
    });

    describe('plan.delete', () => {
        it('remove o plano', async () => {
            const s = fakeSession();
            await planDelete(s);
            expect(s.rpc.plan.delete).toHaveBeenCalledOnce();
        });

        it('rejeita para sessão inválida', async () => {
            await expect(planDelete(null)).rejects.toThrow(TypeError);
        });
    });

    // ─── WORKSPACE ─────────────────────────────────────────────────────────

    describe('workspace.listFiles', () => {
        it('retorna lista de arquivos', async () => {
            const s = fakeSession();
            const result = await workspaceListFiles(s);
            expect(result.files).toEqual(['a.txt', 'b.txt']);
        });

        it('rejeita para sessão inválida', async () => {
            await expect(workspaceListFiles(null)).rejects.toThrow(TypeError);
        });
    });

    describe('workspace.readFile', () => {
        it('lê arquivo do workspace', async () => {
            const s = fakeSession();
            const result = await workspaceReadFile(s, 'data.txt');
            expect(s.rpc.workspace.readFile).toHaveBeenCalledWith({ path: 'data.txt' });
            expect(result.content).toBe('hello');
        });

        it('rejeita path vazio', async () => {
            const s = fakeSession();
            await expect(workspaceReadFile(s, '')).rejects.toThrow('string não-vazia');
        });

        it('rejeita path não-string', async () => {
            const s = fakeSession();
            await expect(workspaceReadFile(s, 42)).rejects.toThrow(TypeError);
        });
    });

    describe('workspace.createFile', () => {
        it('cria arquivo no workspace', async () => {
            const s = fakeSession();
            await workspaceCreateFile(s, 'out.txt', 'content');
            expect(s.rpc.workspace.createFile).toHaveBeenCalledWith({ path: 'out.txt', content: 'content' });
        });

        it('rejeita path vazio', async () => {
            const s = fakeSession();
            await expect(workspaceCreateFile(s, '', 'x')).rejects.toThrow('string não-vazia');
        });

        it('rejeita content não-string', async () => {
            const s = fakeSession();
            await expect(workspaceCreateFile(s, 'f.txt', 42)).rejects.toThrow('deve ser string');
        });
    });

    // ─── LOG ───────────────────────────────────────────────────────────────

    describe('sessionLog', () => {
        it('emite log básico', async () => {
            const s = fakeSession();
            const result = await sessionLog(s, 'Hello');
            expect(s.rpc.log).toHaveBeenCalledWith({ message: 'Hello' });
            expect(result.eventId).toBe('evt-123');
        });

        it('emite log com options', async () => {
            const s = fakeSession();
            await sessionLog(s, 'Warning!', { level: 'warning', ephemeral: true, url: 'https://example.com' });
            expect(s.rpc.log).toHaveBeenCalledWith({
                message: 'Warning!',
                level: 'warning',
                ephemeral: true,
                url: 'https://example.com',
            });
        });

        it('rejeita message vazia', async () => {
            const s = fakeSession();
            await expect(sessionLog(s, '')).rejects.toThrow('string não-vazia');
        });

        it('rejeita sessão inválida', async () => {
            await expect(sessionLog(null, 'x')).rejects.toThrow(TypeError);
        });
    });

    // ─── createSessionRpcFacade ────────────────────────────────────────────

    describe('createSessionRpcFacade', () => {
        it('retorna objeto com todos os subsistemas', () => {
            const s = fakeSession();
            const facade = createSessionRpcFacade(s);
            expect(facade.model).toBeDefined();
            expect(facade.model.getCurrent).toBeTypeOf('function');
            expect(facade.model.switchTo).toBeTypeOf('function');
            expect(facade.mode.get).toBeTypeOf('function');
            expect(facade.mode.set).toBeTypeOf('function');
            expect(facade.plan.read).toBeTypeOf('function');
            expect(facade.plan.update).toBeTypeOf('function');
            expect(facade.plan.delete).toBeTypeOf('function');
            expect(facade.workspace.listFiles).toBeTypeOf('function');
            expect(facade.workspace.readFile).toBeTypeOf('function');
            expect(facade.workspace.createFile).toBeTypeOf('function');
            expect(facade.log).toBeTypeOf('function');
        });

        it('facade.model.getCurrent delega para modelGetCurrent', async () => {
            const s = fakeSession();
            const facade = createSessionRpcFacade(s);
            const result = await facade.model.getCurrent();
            expect(result.modelId).toBe('gpt-4.1');
        });

        it('facade.mode.set delega para modeSet', async () => {
            const s = fakeSession();
            const facade = createSessionRpcFacade(s);
            await facade.mode.set('autopilot');
            expect(s.rpc.mode.set).toHaveBeenCalledWith({ mode: 'autopilot' });
        });

        it('facade.plan.read delega para planRead', async () => {
            const s = fakeSession();
            const facade = createSessionRpcFacade(s);
            const result = await facade.plan.read();
            expect(result.exists).toBe(true);
        });

        it('facade.log delega para sessionLog', async () => {
            const s = fakeSession();
            const facade = createSessionRpcFacade(s);
            const result = await facade.log('test msg');
            expect(result.eventId).toBe('evt-123');
        });

        it('rejeita sessão inválida', () => {
            expect(() => createSessionRpcFacade(null)).toThrow(TypeError);
        });
    });

    // ─── Barrel re-export ──────────────────────────────────────────────────

    describe('barrel re-export', () => {
        it('exporta todos os 12 símbolos via barrel', async () => {
            const barrel = await import('#copilot/sdk');
            expect(barrel.createSessionRpcFacade).toBeTypeOf('function');
            expect(barrel.modelGetCurrent).toBeTypeOf('function');
            expect(barrel.modelSwitchTo).toBeTypeOf('function');
            expect(barrel.modeGet).toBeTypeOf('function');
            expect(barrel.modeSet).toBeTypeOf('function');
            expect(barrel.planRead).toBeTypeOf('function');
            expect(barrel.planUpdate).toBeTypeOf('function');
            expect(barrel.planDelete).toBeTypeOf('function');
            expect(barrel.workspaceListFiles).toBeTypeOf('function');
            expect(barrel.workspaceReadFile).toBeTypeOf('function');
            expect(barrel.workspaceCreateFile).toBeTypeOf('function');
            expect(barrel.sessionLog).toBeTypeOf('function');
        });
    });
});
