// @ts-check
/**
 * tests/unit/copilot/terminal/test_commands_context.spec.js
 *
 * Testes unitários para src/copilot/terminal/commands/context.js Cobre: cmdContext, cmdCompact
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const frontendMocks = vi.hoisted(() => ({
    readTerminalContextProjection: vi.fn(() => ({
        isRealData: false,
        hasHistory: false,
        usedTokens: 0,
        maxTokens: 128000,
        utilization: 0,
        turnCount: 0,
        totalChars: 0,
        workspace: {
            cwd: '/workspaces/test',
            gitRoot: '/workspaces/test',
            currentBranch: 'main',
        },
        timelineSource: 'empty',
        timelineAuthority: 'none',
        reconciliationStatus: 'empty',
        hasPersistentHistory: false,
        persistedTurnCount: 0,
        bridgeTurnCount: 0,
        liveBridgeTailCount: 0,
        syncStatus: 'not_needed',
        syncReason: 'empty',
        syncBlockedReason: null,
        syncPendingCount: 0,
        syncSyncedCount: 0,
        syncFailedCount: 0,
        syncLastError: null,
    })),
    requestTerminalCompactionProjection: vi.fn(async () => ({
        ok: true,
        reply: 'Resumo compactado...',
        estimatedTokens: 6,
    })),
}));

vi.mock('../../../../src/copilot/terminal/frontend/index.js', () => ({
    readTerminalContextProjection: frontendMocks.readTerminalContextProjection,
    requestTerminalCompactionProjection: frontendMocks.requestTerminalCompactionProjection,
}));

import { cmdCompact, cmdContext } from '../../../../src/copilot/terminal/commands/context.js';

// ─── cmdContext ─────────────────────────────────────────────────────────────

describe('terminal/commands/cmdContext', () => {
    /** @type {string[]} */
    let lines;
    /** @type {(text: string) => void} */
    let println;

    beforeEach(() => {
        lines = [];
        println = (/** @type {string} */ text) => lines.push(text);
        frontendMocks.readTerminalContextProjection.mockReturnValue({
            isRealData: false,
            hasHistory: false,
            usedTokens: 0,
            maxTokens: 128000,
            utilization: 0,
            turnCount: 0,
            totalChars: 0,
            workspace: {
                cwd: '/workspaces/test',
                gitRoot: '/workspaces/test',
                currentBranch: 'main',
            },
            timelineSource: 'empty',
            timelineAuthority: 'none',
            reconciliationStatus: 'empty',
            hasPersistentHistory: false,
            persistedTurnCount: 0,
            bridgeTurnCount: 0,
            liveBridgeTailCount: 0,
            syncStatus: 'not_needed',
            syncReason: 'empty',
            syncBlockedReason: null,
            syncPendingCount: 0,
            syncSyncedCount: 0,
            syncFailedCount: 0,
            syncLastError: null,
        });
    });

    it('exibe mensagem quando histórico vazio e sem SDK', () => {
        cmdContext({ println });
        const output = lines.join('\n');
        expect(output).toContain('Nenhum histórico');
    });

    it('encaminha runtimeId explícito para a projection de contexto', () => {
        cmdContext({ println }, '--runtime alt');
        expect(frontendMocks.readTerminalContextProjection).toHaveBeenCalledWith('alt');
    });

    it('exibe estimativa heurística quando sem SDK', () => {
        frontendMocks.readTerminalContextProjection.mockReturnValue({
            isRealData: false,
            hasHistory: true,
            usedTokens: 3,
            maxTokens: 128000,
            utilization: 3 / 128000,
            turnCount: 1,
            totalChars: 11,
            workspace: {
                cwd: '/workspaces/test',
                gitRoot: '/workspaces/test',
                currentBranch: 'main',
            },
            timelineSource: 'bridge',
            timelineAuthority: 'transport',
            reconciliationStatus: 'bridge_only',
            hasPersistentHistory: false,
            persistedTurnCount: 0,
            bridgeTurnCount: 1,
            liveBridgeTailCount: 0,
            syncStatus: 'unavailable',
            syncReason: 'no-hub-session',
            syncBlockedReason: null,
            syncPendingCount: 0,
            syncSyncedCount: 0,
            syncFailedCount: 0,
            syncLastError: null,
        });
        cmdContext({ println });
        const output = lines.join('\n');
        expect(output).toContain('estimad');
        expect(output).toContain('Caracteres');
    });

    it('exibe dados do SDK real quando disponível', () => {
        frontendMocks.readTerminalContextProjection.mockReturnValue({
            isRealData: true,
            hasHistory: true,
            usedTokens: 5000,
            maxTokens: 128000,
            utilization: 0.039,
            turnCount: 1,
            totalChars: 4,
            workspace: {
                cwd: '/workspaces/test',
                gitRoot: '/workspaces/test',
                currentBranch: 'main',
            },
            timelineSource: 'hub',
            timelineAuthority: 'persistent',
            reconciliationStatus: 'aligned',
            hasPersistentHistory: true,
            persistedTurnCount: 1,
            bridgeTurnCount: 1,
            liveBridgeTailCount: 0,
            syncStatus: 'not_needed',
            syncReason: 'aligned',
            syncBlockedReason: null,
            syncPendingCount: 0,
            syncSyncedCount: 0,
            syncFailedCount: 0,
            syncLastError: null,
        });
        cmdContext({ println });
        const output = lines.join('\n');
        expect(output).toContain('real SDK');
        expect(output).toContain('5.000');
    });

    it('alerta quando a janela de contexto passa de 85%', () => {
        frontendMocks.readTerminalContextProjection.mockReturnValue({
            isRealData: true,
            hasHistory: true,
            usedTokens: 110000,
            maxTokens: 128000,
            utilization: 0.86,
            turnCount: 1,
            totalChars: 1,
            workspace: {
                cwd: '/workspaces/test',
                gitRoot: '/workspaces/test',
                currentBranch: 'main',
            },
            timelineSource: 'hub',
            timelineAuthority: 'persistent',
            reconciliationStatus: 'aligned',
            hasPersistentHistory: true,
            persistedTurnCount: 1,
            bridgeTurnCount: 1,
            liveBridgeTailCount: 0,
            syncStatus: 'not_needed',
            syncReason: 'aligned',
            syncBlockedReason: null,
            syncPendingCount: 0,
            syncSyncedCount: 0,
            syncFailedCount: 0,
            syncLastError: null,
        });
        cmdContext({ println });
        const output = lines.join('\n');
        expect(output).toContain('compact');
    });

    it('alerta moderado quando a janela de contexto passa de 65%', () => {
        frontendMocks.readTerminalContextProjection.mockReturnValue({
            isRealData: true,
            hasHistory: true,
            usedTokens: 85000,
            maxTokens: 128000,
            utilization: 0.66,
            turnCount: 1,
            totalChars: 1,
            workspace: {
                cwd: '/workspaces/test',
                gitRoot: '/workspaces/test',
                currentBranch: 'main',
            },
            timelineSource: 'hub',
            timelineAuthority: 'persistent',
            reconciliationStatus: 'aligned',
            hasPersistentHistory: true,
            persistedTurnCount: 1,
            bridgeTurnCount: 1,
            liveBridgeTailCount: 0,
            syncStatus: 'not_needed',
            syncReason: 'aligned',
            syncBlockedReason: null,
            syncPendingCount: 0,
            syncSyncedCount: 0,
            syncFailedCount: 0,
            syncLastError: null,
        });
        cmdContext({ println });
        const output = lines.join('\n');
        expect(output).toContain('monitore');
    });

    it('mostra workspace info', () => {
        frontendMocks.readTerminalContextProjection.mockReturnValue({
            isRealData: false,
            hasHistory: true,
            usedTokens: 2,
            maxTokens: 128000,
            utilization: 2 / 128000,
            turnCount: 1,
            totalChars: 5,
            workspace: {
                cwd: '/workspaces/test',
                gitRoot: '/workspaces/test',
                currentBranch: 'main',
            },
            timelineSource: 'mixed',
            timelineAuthority: 'reconciled',
            reconciliationStatus: 'bridge_tail',
            hasPersistentHistory: true,
            persistedTurnCount: 2,
            bridgeTurnCount: 3,
            liveBridgeTailCount: 1,
            syncStatus: 'scheduled',
            syncReason: 'bridge_tail',
            syncBlockedReason: null,
            syncPendingCount: 1,
            syncSyncedCount: 0,
            syncFailedCount: 0,
            syncLastError: null,
        });
        cmdContext({ println });
        const output = lines.join('\n');
        expect(output).toContain('Workspace');
        expect(output).toContain('/workspaces/test');
        expect(output).toContain('main');
        expect(output).toContain('Timeline canônica');
        expect(output).toContain('mista');
        expect(output).toContain('cauda viva');
        expect(output).toContain('Sincronização');
        expect(output).toContain('agendada');
        expect(output).not.toContain('cwd');
        expect(output).not.toContain('bridge_tail');
        expect(output).not.toContain('pendentes=');
    });

    it('explica divergência preservando live-tail sem sugerir perda visual', () => {
        frontendMocks.readTerminalContextProjection.mockReturnValue({
            isRealData: false,
            hasHistory: true,
            usedTokens: 10,
            maxTokens: 128000,
            utilization: 10 / 128000,
            turnCount: 4,
            totalChars: 40,
            workspace: {
                cwd: '/workspaces/test',
                gitRoot: '/workspaces/test',
                currentBranch: 'main',
            },
            timelineSource: 'mixed',
            timelineAuthority: 'reconciled',
            reconciliationStatus: 'diverged',
            hasPersistentHistory: true,
            persistedTurnCount: 2,
            bridgeTurnCount: 2,
            liveBridgeTailCount: 2,
            syncStatus: 'blocked',
            syncReason: 'diverged-no-overlap',
            syncBlockedReason: 'diverged-no-overlap',
            syncPendingCount: 2,
            syncSyncedCount: 0,
            syncFailedCount: 0,
            syncLastError: null,
        });
        cmdContext({ println });
        const output = lines.join('\n');
        expect(output).toContain('sincronização bloqueada');
        expect(output).toContain('sem sobreposição segura');
        expect(output).toContain('cauda viva visível foi preservada');
        expect(output).not.toContain('diverged-no-overlap');
        expect(output).not.toContain('live-tail');
    });
});

// ─── cmdCompact ─────────────────────────────────────────────────────────────

describe('terminal/commands/cmdCompact', () => {
    /** @type {string[]} */
    let lines;
    /** @type {(text: string) => void} */
    let println;

    beforeEach(() => {
        lines = [];
        println = (/** @type {string} */ text) => lines.push(text);
        frontendMocks.requestTerminalCompactionProjection.mockReset();
        frontendMocks.requestTerminalCompactionProjection.mockResolvedValue({
            ok: true,
            reply: 'Resumo compactado...',
            estimatedTokens: 6,
        });
    });

    it('solicita compactação e exibe sucesso', async () => {
        await cmdCompact({ println });
        const output = lines.join('\n');
        expect(output).toContain('compactado');
        expect(frontendMocks.requestTerminalCompactionProjection).toHaveBeenCalled();
    });

    it('encaminha runtimeId explícito para a compactação', async () => {
        await cmdCompact({ println }, '--runtime alt');
        expect(frontendMocks.requestTerminalCompactionProjection).toHaveBeenCalledWith('alt');
    });

    it('exibe erro quando sendTurn retorna null', async () => {
        frontendMocks.requestTerminalCompactionProjection.mockResolvedValueOnce(
            /** @type {any} */ ({
                ok: false,
                reply: null,
                estimatedTokens: null,
            }),
        );
        await cmdCompact({ println });
        const output = lines.join('\n');
        expect(output).toContain('sem resposta');
    });
});
