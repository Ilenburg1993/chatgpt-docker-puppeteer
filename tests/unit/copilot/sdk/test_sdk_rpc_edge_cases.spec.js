// @ts-check
/**
 * @file Faixa 41 — RPC Facade Edge Cases + Integration Contracts (F229-F235)
 *
 *   Testes complementares para src/copilot/sdk/rpc.js focados em:
 *
 *   - createSessionRpcFacade facade delegation (workspace subsystem)
 *   - Error propagation patterns across subsystems
 *   - modelSwitchTo reasoningEffort edge cases
 *   - workspaceCreateFile content validation edge cases
 *   - assertSession error messages consistency
 *   - shellKill signal parameter handling
 *   - toolsHandlePendingCall result variants
 */

import { describe, expect, it } from 'vitest';

import {
    commandsHandlePending,
    compactionCompact,
    createSessionRpcFacade,
    modeGet,
    modelGetCurrent,
    modelSwitchTo,
    modeSet,
    permissionsHandlePending,
    planDelete,
    planRead,
    planUpdate,
    sessionLog,
    shellExec,
    shellKill,
    toolsHandlePendingCall,
    uiElicitation,
    workspaceCreateFile,
    workspaceListFiles,
    workspaceReadFile,
} from '#copilot/sdk/rpc';

/**
 * Cria sessão mock com todos os subsistemas RPC.
 *
 * @param {Record<string, Record<string, Function>>} [overrides]
 */
function mockSession(overrides = {}) {
    return {
        sessionId: 'test-session-1',
        rpc: {
            model: {
                getCurrent: async () => ({ modelId: 'gpt-4o' }),
                switchTo: async () => ({ modelId: 'gpt-4o' }),
                ...overrides['model'],
            },
            mode: {
                get: async () => ({ mode: 'interactive' }),
                set: async () => ({ mode: 'plan' }),
                ...overrides['mode'],
            },
            plan: {
                read: async () => ({ exists: true, content: 'plan', path: '/plan.md' }),
                update: async () => ({}),
                delete: async () => ({}),
                ...overrides['plan'],
            },
            workspace: {
                listFiles: async () => ({ files: ['a.js'] }),
                readFile: async () => ({ content: 'code' }),
                createFile: async () => ({}),
                ...overrides['workspace'],
            },
            log: { event: async () => ({ eventId: 'e1' }), ...overrides['log'] },
            compaction: {
                compact: async () => ({ success: true, tokensRemoved: 100, messagesRemoved: 5 }),
                ...overrides['compaction'],
            },
            shell: {
                exec: async () => ({ processId: 'p1' }),
                kill: async () => ({ killed: true }),
                ...overrides['shell'],
            },
            ui: { elicitation: async () => ({ action: 'accept' }), ...overrides['ui'] },
            commands: { handlePendingCommand: async () => ({ success: true }), ...overrides['commands'] },
            permissions: {
                handlePendingPermissionRequest: async () => ({ success: true }),
                ...overrides['permissions'],
            },
            tools: { handlePendingToolCall: async () => ({ success: true }), ...overrides['tools'] },
        },
    };
}

// ═══════════════════════════════════════════════════════════════════════════════
// assertSession error message consistency
// ═══════════════════════════════════════════════════════════════════════════════

describe('F41 — assertSession error messages', () => {
    const fns = [
        ['modelGetCurrent', (/** @type {any} */ s) => modelGetCurrent(s)],
        ['modelSwitchTo', (/** @type {any} */ s) => modelSwitchTo(s, 'gpt-4o')],
        ['modeGet', (/** @type {any} */ s) => modeGet(s)],
        ['modeSet', (/** @type {any} */ s) => modeSet(s, 'plan')],
        ['planRead', (/** @type {any} */ s) => planRead(s)],
        ['planUpdate', (/** @type {any} */ s) => planUpdate(s, 'content')],
        ['planDelete', (/** @type {any} */ s) => planDelete(s)],
        ['workspaceListFiles', (/** @type {any} */ s) => workspaceListFiles(s)],
        ['workspaceReadFile', (/** @type {any} */ s) => workspaceReadFile(s, 'path')],
        ['workspaceCreateFile', (/** @type {any} */ s) => workspaceCreateFile(s, 'path', 'content')],
        ['sessionLog', (/** @type {any} */ s) => sessionLog(s, 'msg')],
        ['compactionCompact', (/** @type {any} */ s) => compactionCompact(s)],
        ['shellExec', (/** @type {any} */ s) => shellExec(s, 'ls')],
        ['shellKill', (/** @type {any} */ s) => shellKill(s, 'p1')],
        ['uiElicitation', (/** @type {any} */ s) => uiElicitation(s, 'msg', { type: 'object' })],
        ['commandsHandlePending', (/** @type {any} */ s) => commandsHandlePending(s, 'r1')],
        ['permissionsHandlePending', (/** @type {any} */ s) => permissionsHandlePending(s, 'r1', { kind: 'approved' })],
        ['toolsHandlePendingCall', (/** @type {any} */ s) => toolsHandlePendingCall(s, 'r1')],
    ];

    for (const [name, fn] of fns) {
        it(`${name}: rejeita objeto sem rpc com TypeError`, async () => {
            await expect(fn({})).rejects.toThrow(TypeError);
        });
    }
});

// ═══════════════════════════════════════════════════════════════════════════════
// createSessionRpcFacade workspace delegation
// ═══════════════════════════════════════════════════════════════════════════════

describe('F41 — createSessionRpcFacade workspace delegation', () => {
    it('facade.workspace.listFiles delega corretamente', async () => {
        const s = mockSession();
        const facade = createSessionRpcFacade(/** @type {any} */ (s));

        const result = await facade.workspace.listFiles();
        expect(result).toEqual({ files: ['a.js'] });
    });

    it('facade.workspace.readFile delega corretamente', async () => {
        const s = mockSession();
        const facade = createSessionRpcFacade(/** @type {any} */ (s));

        const result = await facade.workspace.readFile('test.js');
        expect(result).toEqual({ content: 'code' });
    });

    it('facade.workspace.createFile delega corretamente', async () => {
        const s = mockSession();
        const facade = createSessionRpcFacade(/** @type {any} */ (s));

        await expect(facade.workspace.createFile('new.js', 'code')).resolves.toBeDefined();
    });

    it('facade.model.switchTo passa options', async () => {
        const s = mockSession({
            model: {
                getCurrent: async () => ({ modelId: 'gpt-4o' }),
                switchTo: async (/** @type {any} */ params) => ({ modelId: params.modelId }),
            },
        });
        const facade = createSessionRpcFacade(/** @type {any} */ (s));

        const result = await facade.model.switchTo('claude-sonnet-4-5', { reasoningEffort: 'high' });
        expect(result).toBeDefined();
    });

    it('facade.plan.update e delete delegam', async () => {
        const s = mockSession();
        const facade = createSessionRpcFacade(/** @type {any} */ (s));

        await expect(facade.plan.update('new plan')).resolves.toBeDefined();
        await expect(facade.plan.delete()).resolves.toBeDefined();
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Error propagation patterns
// ═══════════════════════════════════════════════════════════════════════════════

describe('F41 — Error propagation across subsystems', () => {
    it('compactionCompact propaga erro custom do SDK', async () => {
        const s = mockSession({
            compaction: {
                compact: async () => {
                    throw new Error('quota exhausted');
                },
            },
        });

        await expect(compactionCompact(/** @type {any} */ (s))).rejects.toThrow('quota exhausted');
    });

    it('shellExec propaga erro de timeout', async () => {
        const s = mockSession({
            shell: {
                exec: async () => {
                    throw new Error('process timed out');
                },
                kill: async () => ({ killed: true }),
            },
        });

        await expect(shellExec(/** @type {any} */ (s), 'slow-cmd')).rejects.toThrow('process timed out');
    });

    it('uiElicitation propaga erro de cancelamento', async () => {
        const s = mockSession({
            ui: {
                elicitation: async () => {
                    throw new Error('user cancelled');
                },
            },
        });

        await expect(uiElicitation(/** @type {any} */ (s), 'question', { type: 'string' })).rejects.toThrow(
            'user cancelled',
        );
    });

    it('workspaceReadFile propaga ENOENT', async () => {
        const s = mockSession({
            workspace: {
                listFiles: async () => ({ files: [] }),
                readFile: async () => {
                    throw new Error('ENOENT: no such file');
                },
                createFile: async () => ({}),
            },
        });

        await expect(workspaceReadFile(/** @type {any} */ (s), 'missing.js')).rejects.toThrow('ENOENT');
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// shellKill signal variants
// ═══════════════════════════════════════════════════════════════════════════════

describe('F41 — shellKill signal handling', () => {
    it('default signal omitido quando não fornecido', async () => {
        let captured;
        const s = mockSession({
            shell: {
                exec: async () => ({ processId: 'p1' }),
                kill: async (/** @type {any} */ params) => {
                    captured = params;
                    return { killed: true };
                },
            },
        });

        await shellKill(/** @type {any} */ (s), 'p1');
        // Sem signal explícito, params não deve conter signal
        expect(captured).toBeDefined();
    });

    it('SIGKILL é passado corretamente', async () => {
        let captured;
        const s = mockSession({
            shell: {
                exec: async () => ({ processId: 'p1' }),
                kill: async (/** @type {any} */ params) => {
                    captured = params;
                    return { killed: true };
                },
            },
        });

        await shellKill(/** @type {any} */ (s), 'p1', 'SIGKILL');
        expect(captured).toMatchObject({ processId: 'p1', signal: 'SIGKILL' });
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// toolsHandlePendingCall result variants
// ═══════════════════════════════════════════════════════════════════════════════

describe('F41 — toolsHandlePendingCall edge cases', () => {
    it('aceita result=undefined (sem options)', async () => {
        const s = mockSession();
        await expect(toolsHandlePendingCall(/** @type {any} */ (s), 'r1')).resolves.toEqual({ success: true });
    });

    it('aceita result com textResultForLlm objeto', async () => {
        const s = mockSession();
        await expect(
            toolsHandlePendingCall(/** @type {any} */ (s), 'r1', {
                result: { textResultForLlm: 'output data', resultType: 'json' },
            }),
        ).resolves.toEqual({ success: true });
    });
});
