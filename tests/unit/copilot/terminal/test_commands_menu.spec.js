// @ts-check

import { beforeEach, describe, expect, it, vi } from 'vitest';

const runtimeGatewayMocks = vi.hoisted(() => ({
    readTerminalRuntimeControlState: vi.fn(() => ({
        status: 'idle',
        model: 'gpt-5-mini',
        reasoningEffort: 'high',
        sessionId: 'sess-1',
        dialogLoopActive: true,
        dialogPaused: false,
        queueSize: 0,
    })),
    readTerminalRuntimeState: vi.fn(() => ({
        runtimeId: 'default',
        status: 'idle',
        model: 'gpt-5-mini',
        reasoningEffort: 'high',
        sessionId: 'sess-1',
        dialogLoopActive: true,
        dialogPaused: false,
        queueSize: 0,
        pendingQuestion: /** @type {string | null} */ (null),
        pendingQuestionKind: /** @type {string | null} */ (null),
        pendingQuestionShadowState: null,
        contextWindow: null,
        lastPrInfo: null,
    })),
}));

const sdkInteractionMocks = vi.hoisted(() => ({
    readTerminalElicitationSummary: vi.fn(() => ({ pending: 0, latest: null })),
    readTerminalPermissionSummary: vi.fn(() => ({ pending: 0, latest: null })),
    readTerminalUserInputSummary: vi.fn(() => ({ pending: 0, latest: null })),
}));

vi.mock('../../../../src/copilot/terminal/frontend/gateways/agent-runtime.js', () => ({
    readTerminalRuntimeControlState: runtimeGatewayMocks.readTerminalRuntimeControlState,
    readTerminalRuntimeState: runtimeGatewayMocks.readTerminalRuntimeState,
}));

vi.mock('../../../../src/copilot/terminal/state/sdk-interactions.js', () => ({
    readTerminalElicitationSummary: sdkInteractionMocks.readTerminalElicitationSummary,
    readTerminalPermissionSummary: sdkInteractionMocks.readTerminalPermissionSummary,
    readTerminalUserInputSummary: sdkInteractionMocks.readTerminalUserInputSummary,
}));

import {
    buildTerminalSmartMenuEntries,
    cmdMenu,
    resolveTerminalSmartMenuSelection,
} from '../../../../src/copilot/terminal/commands/menu.js';

function mockCtx() {
    const lines = /** @type {string[]} */ ([]);
    return {
        println: vi.fn((line) => lines.push(line)),
        output: () => lines.join('\n'),
    };
}

describe('terminal/commands/menu', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        sdkInteractionMocks.readTerminalElicitationSummary.mockReturnValue({ pending: 0, latest: null });
        sdkInteractionMocks.readTerminalPermissionSummary.mockReturnValue({ pending: 0, latest: null });
        sdkInteractionMocks.readTerminalUserInputSummary.mockReturnValue({ pending: 0, latest: null });
    });

    it('lista command palette contextual quando chamado sem argumentos', async () => {
        const ctx = mockCtx();

        await cmdMenu({ println: ctx.println });

        expect(ctx.output()).toContain('Painel de ações');
        expect(ctx.output()).toContain('#01');
        expect(ctx.output()).toContain('/status');
        expect(ctx.output()).toContain('pergunta pendente');
        expect(ctx.output()).toContain('Executar');
        expect(ctx.output()).not.toContain('[01]');
        expect(ctx.output()).not.toContain('pending question');
        expect(ctx.output()).not.toContain('Command Palette');
    });

    it('inclui ações HOT para pending question/contexto alto/loop inativo', () => {
        runtimeGatewayMocks.readTerminalRuntimeControlState.mockReturnValue(
            /** @type {any} */ ({
                status: 'stopped',
                model: 'gpt-5-mini',
                reasoningEffort: 'high',
                sessionId: 'sess-1',
                dialogLoopActive: false,
                dialogPaused: false,
                queueSize: 0,
            }),
        );
        runtimeGatewayMocks.readTerminalRuntimeState.mockReturnValue(
            /** @type {any} */ ({
                runtimeId: 'default',
                status: 'waiting_for_input',
                model: 'gpt-5-mini',
                reasoningEffort: 'high',
                sessionId: 'sess-1',
                dialogLoopActive: false,
                dialogPaused: false,
                queueSize: 0,
                pendingQuestion: 'confirma?',
                pendingQuestionKind: 'confirm',
                pendingQuestionShadowState: 'expired',
                contextWindow: { utilization: 0.91 },
                lastPrInfo: null,
            }),
        );

        const entries = buildTerminalSmartMenuEntries();
        const ids = entries.map((entry) => entry.id);

        expect(ids).toContain('restart');
        expect(ids).toContain('answer');
        expect(ids).toContain('clear-shadow');
        expect(ids).toContain('compact');
        expect(entries.find((entry) => entry.id === 'answer')?.hot).toBe(true);
        expect(entries.find((entry) => entry.id === 'answer')?.description).toContain('Tipo: confirmação');
        expect(entries.find((entry) => entry.id === 'answer')?.description).not.toContain('Tipo: confirm ·');
    });

    it('inclui atalhos HOT para interrupções SDK pendentes', () => {
        sdkInteractionMocks.readTerminalElicitationSummary.mockReturnValue(
            /** @type {any} */ ({ pending: 2, latest: { mode: 'form' } }),
        );
        sdkInteractionMocks.readTerminalPermissionSummary.mockReturnValue(
            /** @type {any} */ ({ pending: 1, latest: { permissionType: 'file_write' } }),
        );
        sdkInteractionMocks.readTerminalUserInputSummary.mockReturnValue(
            /** @type {any} */ ({ pending: 1, latest: { kind: 'question' } }),
        );
        runtimeGatewayMocks.readTerminalRuntimeState.mockReturnValue(
            /** @type {any} */ ({
                runtimeId: 'default',
                status: 'idle',
                model: 'gpt-5-mini',
                reasoningEffort: 'high',
                sessionId: 'sess-1',
                dialogLoopActive: true,
                dialogPaused: false,
                queueSize: 0,
                pendingQuestion: null,
                pendingQuestionKind: null,
                pendingQuestionShadowState: null,
                contextWindow: null,
                lastPrInfo: null,
            }),
        );

        const entries = buildTerminalSmartMenuEntries();
        const ids = entries.map((entry) => entry.id);

        expect(ids).toContain('sdk-ask-user');
        expect(ids).toContain('sdk-waits');
        expect(ids).toContain('elicitation-latest');
        expect(ids).toContain('permission-latest');
        expect(entries.find((entry) => entry.id === 'sdk-waits')?.description).toContain('Pendências vivas agora');
        expect(entries.find((entry) => entry.id === 'sdk-waits')?.description).toContain('/session sdk waits');
    });

    it('resolve seleção por número e id', () => {
        const entries = [
            { id: 'status', label: 'Status', commandLine: '/status', description: 'a' },
            { id: 'metrics', label: 'Metrics', commandLine: '/metrics', description: 'b' },
        ];

        expect(resolveTerminalSmartMenuSelection(entries, '1')).toEqual(entries[0]);
        expect(resolveTerminalSmartMenuSelection(entries, 'metrics')).toEqual(entries[1]);
        expect(resolveTerminalSmartMenuSelection(entries, '99')).toBeNull();
    });

    it('executa comando selecionado via callback quando /menu <n>', async () => {
        const ctx = mockCtx();
        const executeCommandLine = vi.fn(async () => true);

        await cmdMenu({ println: ctx.println }, '1', [], { executeCommandLine });

        expect(executeCommandLine).toHaveBeenCalledWith('/status');
        expect(ctx.output()).toContain('Ação');
        expect(ctx.output()).toContain('Status completo · /status');
        expect(ctx.output()).not.toContain('⏵');
    });

    it('renderiza /menu picker como plano seguro sem iniciar TUI externa', async () => {
        const ctx = mockCtx();

        await cmdMenu({ println: ctx.println }, 'picker');

        expect(ctx.output()).toContain('Picker do menu');
        expect(ctx.output()).toContain('picker textual seguro');
        expect(ctx.output()).toContain('sessão ainda não liberou controle exclusivo do TTY');
        expect(ctx.output()).toContain('/menu <n> ou /menu <id>');
        expect(ctx.output()).not.toContain('fzf --');
    });

    it('inclui razões reais de prontidão TTY no plano do picker', async () => {
        const ctx = mockCtx();

        await cmdMenu({ println: ctx.println }, 'picker', [], {
            readExclusiveTtyReadiness: () => ({
                ready: false,
                reasons: ['turno em execução', 'input humano parcialmente digitado'],
            }),
        });

        expect(ctx.output()).toContain('turno em execução');
        expect(ctx.output()).toContain('input humano parcialmente digitado');
        expect(ctx.output()).toContain('picker textual seguro');
    });

    it('não abre picker interativo quando prontidão TTY bloqueia a ação explícita', async () => {
        const ctx = mockCtx();
        const withExclusiveTty = vi.fn();

        await cmdMenu({ println: ctx.println }, 'picker', ['--interactive'], {
            readExclusiveTtyReadiness: () => ({
                ready: false,
                reasons: ['turno em execução'],
            }),
            withExclusiveTty,
        });

        expect(withExclusiveTty).not.toHaveBeenCalled();
        expect(ctx.output()).toContain('turno em execução');
        expect(ctx.output()).toContain('Picker');
        expect(ctx.output()).toContain('interativo indisponível; use /menu <n> ou /menu <id>');
    });

    it('não abre picker interativo quando há pergunta humana pendente', async () => {
        const pendingRuntimeState = {
            runtimeId: 'default',
            status: 'waiting_for_input',
            model: 'gpt-5-mini',
            reasoningEffort: 'high',
            sessionId: 'sess-1',
            dialogLoopActive: true,
            dialogPaused: false,
            queueSize: 0,
            pendingQuestion: 'Continuar?',
            pendingQuestionKind: 'ask_user',
            pendingQuestionShadowState: null,
            contextWindow: null,
            lastPrInfo: null,
        };
        runtimeGatewayMocks.readTerminalRuntimeState
            .mockReturnValueOnce(pendingRuntimeState)
            .mockReturnValueOnce(pendingRuntimeState)
            .mockReturnValueOnce(pendingRuntimeState);
        const ctx = mockCtx();
        const withExclusiveTty = vi.fn();

        await cmdMenu({ println: ctx.println }, 'picker --interactive', [], {
            readExclusiveTtyReadiness: () => ({ ready: true, reasons: [] }),
            withExclusiveTty,
        });

        expect(withExclusiveTty).not.toHaveBeenCalled();
        expect(ctx.output()).toContain('pergunta humana pendente');
        expect(ctx.output()).toContain('interativo indisponível; use /menu <n> ou /menu <id>');
    });

    it('interpreta flags de picker quando o parser entrega arg agregado', async () => {
        const ctx = mockCtx();
        const withExclusiveTty = vi.fn();

        await cmdMenu({ println: ctx.println }, 'picker --interactive', [], {
            readExclusiveTtyReadiness: () => ({
                ready: false,
                reasons: ['turno em execução'],
            }),
            withExclusiveTty,
        });

        expect(withExclusiveTty).not.toHaveBeenCalled();
        expect(ctx.output()).toContain('interativo indisponível; use /menu <n> ou /menu <id>');
        expect(ctx.output()).not.toContain('Seleção inválida');
    });

    it('prefere rest tokenizado quando o dispatcher fornece arg agregado e rest', async () => {
        const ctx = mockCtx();
        const withExclusiveTty = vi.fn();

        await cmdMenu({ println: ctx.println }, 'picker --interactive', ['picker', '--interactive'], {
            readExclusiveTtyReadiness: () => ({
                ready: false,
                reasons: ['turno em execução'],
            }),
            withExclusiveTty,
        });

        expect(withExclusiveTty).not.toHaveBeenCalled();
        expect(ctx.output()).toContain('interativo indisponível; use /menu <n> ou /menu <id>');
        expect(ctx.output()).not.toContain('Seleção inválida');
    });
});
