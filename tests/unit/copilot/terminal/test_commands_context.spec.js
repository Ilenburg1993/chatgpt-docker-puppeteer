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
    let lines;
    let println;

    beforeEach(() => {
        lines = [];
        println = (text) => lines.push(text);
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
        });
    });

    it('exibe mensagem quando histórico vazio e sem SDK', () => {
        cmdContext({ println });
        const output = lines.join('\n');
        expect(output).toContain('Nenhum histórico');
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
        });
        cmdContext({ println });
        const output = lines.join('\n');
        expect(output).toContain('estimad');
        expect(output).toContain('Chars');
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
        });
        cmdContext({ println });
        const output = lines.join('\n');
        expect(output).toContain('real SDK');
        expect(output).toContain('5.000');
    });

    it('alerta quando context window > 85%', () => {
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
        });
        cmdContext({ println });
        const output = lines.join('\n');
        expect(output).toContain('compact');
    });

    it('alerta moderado quando context window > 65%', () => {
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
        });
        cmdContext({ println });
        const output = lines.join('\n');
        expect(output).toContain('Workspace');
        expect(output).toContain('/workspaces/test');
        expect(output).toContain('main');
    });
});

// ─── cmdCompact ─────────────────────────────────────────────────────────────

describe('terminal/commands/cmdCompact', () => {
    let lines;
    let println;

    beforeEach(() => {
        lines = [];
        println = (text) => lines.push(text);
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

    it('exibe erro quando sendTurn retorna null', async () => {
        frontendMocks.requestTerminalCompactionProjection.mockResolvedValueOnce({
            ok: false,
            reply: null,
            estimatedTokens: null,
        });
        await cmdCompact({ println });
        const output = lines.join('\n');
        expect(output).toContain('sem resposta');
    });
});
