// @ts-check
/**
 * tests/unit/copilot/test_terminal_io_activity_dedup.spec.js
 *
 * Contrato: src/copilot/terminal/events/io-activity-events.js
 *
 * Foco: comportamento de dedup da janela de 60ms (F1.2) que absorve o triple-firing das camadas de cache de I/O.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    recordTerminalActivity: vi.fn(),
    broadcastSse: vi.fn(),
    println: vi.fn(),
    getShowToolActivity: vi.fn(() => false),
    recordTerminalTurnFileActivity: vi.fn(),
    writeInlineStatus: vi.fn(),
    clearInlineStatus: vi.fn(),
    terminalThemeBadge: vi.fn((_, label) => `[${label}]`),
    terminalThemeText: vi.fn((_, text) => text),
    getTerminalDetailLevel: vi.fn(() => 'detailed'),
}));

vi.mock('../../../src/copilot/terminal/state/activity-state.js', () => ({
    recordTerminalActivity: mocks.recordTerminalActivity,
}));

vi.mock('../../../src/copilot/terminal/dialog/index.js', () => ({
    broadcastSse: mocks.broadcastSse,
    println: mocks.println,
    writeInlineStatus: mocks.writeInlineStatus,
    clearInlineStatus: mocks.clearInlineStatus,
}));

vi.mock('../../../src/copilot/presentation/runtime-ui-state-store.js', () => ({
    getShowToolActivity: mocks.getShowToolActivity,
}));

vi.mock('../../../src/copilot/terminal/state/turn-trace-state.js', () => ({
    recordTerminalTurnFileActivity: mocks.recordTerminalTurnFileActivity,
}));

vi.mock('../../../src/copilot/terminal/state/ui-theme.js', () => ({
    terminalThemeBadge: mocks.terminalThemeBadge,
    terminalThemeText: mocks.terminalThemeText,
}));

vi.mock('../../../src/copilot/terminal/state/ui-preferences.js', () => ({
    getTerminalDetailLevel: mocks.getTerminalDetailLevel,
}));

/**
 * Cria uma mensagem de IO normalizada para teste.
 *
 * @param {string} operation
 * @param {string} target
 * @returns {object}
 */
function makeIoMessage(operation, target) {
    return {
        success: true,
        io: {
            operation,
            target,
            engine: 'workspace-fs',
            targetKind: 'file',
            bytesRead: 1024,
            bytesWritten: null,
            durationMs: 5,
        },
    };
}

describe('io-activity-events.js — dedup window F1.2', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('primeira operação passa (não é duplicata)', async () => {
        const { __test__ } = await import('../../../src/copilot/terminal/events/io-activity-events.js');
        // Limpar o dedup window antes do teste
        __test__.ioDedupWindow.clear();

        __test__.handleIoOperation(makeIoMessage('read', '/workspace/src/app.js'));

        expect(mocks.broadcastSse).toHaveBeenCalledWith(
            'tool.lifecycle',
            expect.objectContaining({ type: 'io_op', operation: 'read' }),
        );
    });

    it('segunda operação idêntica dentro de 60ms é suprimida', async () => {
        const { __test__ } = await import('../../../src/copilot/terminal/events/io-activity-events.js');
        __test__.ioDedupWindow.clear();

        const msg = makeIoMessage('read', '/workspace/src/main.js');
        __test__.handleIoOperation(msg);
        __test__.handleIoOperation(msg); // duplicata imediata

        const ioEvents = mocks.broadcastSse.mock.calls.filter(
            (args) => args[0] === 'tool.lifecycle' && args[1]?.type === 'io_op',
        );
        expect(ioEvents).toHaveLength(1);
    });

    it('terceira operação idêntica (triple-firing) também é suprimida', async () => {
        const { __test__ } = await import('../../../src/copilot/terminal/events/io-activity-events.js');
        __test__.ioDedupWindow.clear();

        const msg = makeIoMessage('read', '/workspace/src/index.js');
        __test__.handleIoOperation(msg);
        __test__.handleIoOperation(msg);
        __test__.handleIoOperation(msg);

        const ioEvents = mocks.broadcastSse.mock.calls.filter(
            (args) => args[0] === 'tool.lifecycle' && args[1]?.type === 'io_op',
        );
        expect(ioEvents).toHaveLength(1);
    });

    it('operações com mesma operação mas targets diferentes não se suprimem', async () => {
        const { __test__ } = await import('../../../src/copilot/terminal/events/io-activity-events.js');
        __test__.ioDedupWindow.clear();

        __test__.handleIoOperation(makeIoMessage('read', '/workspace/src/a.js'));
        __test__.handleIoOperation(makeIoMessage('read', '/workspace/src/b.js'));

        const ioEvents = mocks.broadcastSse.mock.calls.filter(
            (args) => args[0] === 'tool.lifecycle' && args[1]?.type === 'io_op',
        );
        expect(ioEvents).toHaveLength(2);
    });

    it('operações com mesmo target mas diferentes operações não se suprimem', async () => {
        const { __test__ } = await import('../../../src/copilot/terminal/events/io-activity-events.js');
        __test__.ioDedupWindow.clear();

        __test__.handleIoOperation(makeIoMessage('read', '/workspace/src/shared.js'));
        __test__.handleIoOperation(makeIoMessage('write', '/workspace/src/shared.js'));

        const ioEvents = mocks.broadcastSse.mock.calls.filter(
            (args) => args[0] === 'tool.lifecycle' && args[1]?.type === 'io_op',
        );
        expect(ioEvents).toHaveLength(2);
    });

    describe('isDuplicateIoOperation — lógica direta', () => {
        it('retorna false na primeira chamada', async () => {
            const { __test__ } = await import('../../../src/copilot/terminal/events/io-activity-events.js');
            __test__.ioDedupWindow.clear();

            const result = __test__.isDuplicateIoOperation('read', '/workspace/new.js');
            expect(result).toBe(false);
        });

        it('retorna true na chamada imediatamente seguinte com mesma chave', async () => {
            const { __test__ } = await import('../../../src/copilot/terminal/events/io-activity-events.js');
            __test__.ioDedupWindow.clear();

            __test__.isDuplicateIoOperation('read', '/workspace/same.js');
            const result = __test__.isDuplicateIoOperation('read', '/workspace/same.js');
            expect(result).toBe(true);
        });

        it('retorna false para chave diferente', async () => {
            const { __test__ } = await import('../../../src/copilot/terminal/events/io-activity-events.js');
            __test__.ioDedupWindow.clear();

            __test__.isDuplicateIoOperation('read', '/workspace/x.js');
            const result = __test__.isDuplicateIoOperation('read', '/workspace/y.js');
            expect(result).toBe(false);
        });
    });
});
