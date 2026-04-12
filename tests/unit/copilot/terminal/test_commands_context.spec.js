// @ts-check
import { describe, it, beforeEach } from 'node:test';
/**
 * tests/unit/copilot/terminal/test_commands_context.spec.js
 *
 * Testes unitários para src/copilot/terminal/commands/context.js Cobre: cmdContext, cmdCompact
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock logger
vi.mock('#copilot/observability/logger', () => ({ log: vi.fn() }));

// Mock llmBridgeClient — fully inline for hoisting
vi.mock('#copilot/channel/client', () => {
    const _history = [];
    return {
        llmBridgeClient: {
            get history() {
                return _history;
            },
            clearHistory: vi.fn(),
            seedHistory: vi.fn(),
        },
    };
});

// Mock alwaysAliveAgent
vi.mock('#copilot/agent', () => ({
    alwaysAliveAgent: {
        getStatusSnapshot: vi.fn(() => ({ contextWindow: null })),
    },
}));

// Mock workspace-context
vi.mock('../../../../src/copilot/terminal/workspace-context.js', () => ({
    getWorkspaceContext: vi.fn(() => ({
        cwd: '/workspaces/test',
        gitRoot: '/workspaces/test',
        currentBranch: 'main',
    })),
}));

// Mock dialog (for cmdCompact)
vi.mock('../../../../src/copilot/terminal/dialog.js', () => ({
    sendTurn: vi.fn().mockResolvedValue('Resumo compactado...'),
}));

import { alwaysAliveAgent } from '#copilot/agent';
import { llmBridgeClient } from '#copilot/channel/client';
import { cmdCompact, cmdContext } from '../../../../src/copilot/terminal/commands/context.js';

// ─── cmdContext ─────────────────────────────────────────────────────────────

describe('terminal/commands/cmdContext', () => {
    let lines;
    let println;

    beforeEach(() => {
        lines = [];
        println = (text) => lines.push(text);
        llmBridgeClient.history.length = 0;
        vi.mocked(alwaysAliveAgent.getStatusSnapshot).mockReturnValue(/** @type {any} */ ({ contextWindow: null }));
    });

    it('exibe mensagem quando histórico vazio e sem SDK', () => {
        cmdContext({ println });
        const output = lines.join('\n');
        expect(output).toContain('Nenhum histórico');
    });

    it('exibe estimativa heurística quando sem SDK', () => {
        llmBridgeClient.history.push({ role: 'user', content: 'hello world' });
        cmdContext({ println });
        const output = lines.join('\n');
        expect(output).toContain('estimad');
        expect(output).toContain('Chars');
    });

    it('exibe dados do SDK real quando disponível', () => {
        vi.mocked(alwaysAliveAgent.getStatusSnapshot).mockReturnValue(
            /** @type {any} */ ({
                contextWindow: { tokens: 5000, tokenLimit: 128000, utilization: 0.039 },
            }),
        );
        llmBridgeClient.history.push({ role: 'user', content: 'test' });
        cmdContext({ println });
        const output = lines.join('\n');
        expect(output).toContain('real SDK');
        expect(output).toContain('5.000');
    });

    it('alerta quando context window > 85%', () => {
        vi.mocked(alwaysAliveAgent.getStatusSnapshot).mockReturnValue(
            /** @type {any} */ ({
                contextWindow: { tokens: 110000, tokenLimit: 128000, utilization: 0.86 },
            }),
        );
        llmBridgeClient.history.push({ role: 'user', content: 'x' });
        cmdContext({ println });
        const output = lines.join('\n');
        expect(output).toContain('compact');
    });

    it('alerta moderado quando context window > 65%', () => {
        vi.mocked(alwaysAliveAgent.getStatusSnapshot).mockReturnValue(
            /** @type {any} */ ({
                contextWindow: { tokens: 85000, tokenLimit: 128000, utilization: 0.66 },
            }),
        );
        llmBridgeClient.history.push({ role: 'user', content: 'x' });
        cmdContext({ println });
        const output = lines.join('\n');
        expect(output).toContain('monitore');
    });

    it('mostra workspace info', () => {
        llmBridgeClient.history.push({ role: 'user', content: 'hello' });
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
        vi.mocked(llmBridgeClient.clearHistory).mockClear();
        vi.mocked(llmBridgeClient.seedHistory).mockClear();
    });

    it('solicita compactação e exibe sucesso', async () => {
        await cmdCompact({ println });
        const output = lines.join('\n');
        expect(output).toContain('compactado');
        expect(llmBridgeClient.clearHistory).toHaveBeenCalled();
        expect(llmBridgeClient.seedHistory).toHaveBeenCalledWith('assistant', 'Resumo compactado...');
    });

    it('exibe erro quando sendTurn retorna null', async () => {
        const { sendTurn } = await import('../../../../src/copilot/terminal/dialog.js');
        vi.mocked(sendTurn).mockResolvedValueOnce(null);
        await cmdCompact({ println });
        const output = lines.join('\n');
        expect(output).toContain('sem resposta');
    });
});
