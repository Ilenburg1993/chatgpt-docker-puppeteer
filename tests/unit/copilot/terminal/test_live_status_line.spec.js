// @ts-check
/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck -- legacy fixture inference is intentionally outside the MCP strict hardening pass

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    activity: {
        phase: 'tool',
        label: 'Executando tool',
        detail: 'lendo arquivo · src/copilot/terminal/repl/repl-lifecycle.js',
        source: 'sdk',
        severity: 'info',
        progress: /** @type {number | null} */ (null),
        toolName: 'read_file_content',
        startedAt: Date.parse('2026-05-07T22:00:00.000-03:00'),
        updatedAt: Date.parse('2026-05-07T22:00:00.000-03:00'),
        ageMs: 0,
    },
    runtime: {
        model: 'auto',
        reasoningEffort: 'xhigh',
        status: 'processing',
        dialogLoopActive: true,
        queueSize: 0,
    },
    stream: {
        model: 'claude-sonnet-4.6',
        reasoningEffort: 'xhigh',
    },
    structuredInputs: /** @type {Record<string, unknown>[]} */ ([]),
    busy: false,
    clearInlineStatus: vi.fn(),
    writeInlineStatus: vi.fn(),
}));

vi.mock('#copilot/config', async (importOriginal) => {
    const actual = /** @type {Record<string, unknown>} */ (await importOriginal());
    return {
        ...actual,
        TERMINAL_LIVE_STATUS_ENABLED: true,
        TERMINAL_LIVE_STATUS_INTERVAL_MS: 1000,
    };
});
vi.mock('../../../../src/copilot/terminal/state/activity-state.js', () => ({
    readTerminalActivitySnapshot: vi.fn(() => mocks.activity),
}));
vi.mock('../../../../src/copilot/terminal/dialog/index.js', () => ({
    clearInlineStatus: mocks.clearInlineStatus,
    writeInlineStatus: mocks.writeInlineStatus,
}));
vi.mock('../../../../src/copilot/terminal/frontend/gateways/agent-runtime.js', () => ({
    readTerminalDialogStreamMeta: vi.fn(() => mocks.stream),
    readTerminalRuntimeState: vi.fn(() => mocks.runtime),
}));
vi.mock('../../../../src/copilot/terminal/frontend/gateways/sdk-session.js', async (importOriginal) => {
    const actual = /** @type {Record<string, unknown>} */ (await importOriginal());
    return {
        ...actual,
        listTerminalPendingStructuredUserInputs: vi.fn(() => mocks.structuredInputs),
    };
});
vi.mock('../../../../src/copilot/presentation/state/index.js', () => ({
    getBusy: vi.fn(() => mocks.busy),
}));
vi.mock('../../../../src/copilot/terminal/state/ui-theme.js', () => ({
    terminalThemeText: vi.fn((_role, text) => text),
}));

describe('terminal/live-status-line', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-05-07T22:00:12.000-03:00'));
        mocks.busy = false;
        mocks.activity = {
            phase: 'tool',
            label: 'Executando tool',
            detail: 'lendo arquivo · src/copilot/terminal/repl/repl-lifecycle.js',
            source: 'sdk',
            severity: 'info',
            progress: /** @type {number | null} */ (null),
            toolName: 'read_file_content',
            startedAt: Date.parse('2026-05-07T22:00:00.000-03:00'),
            updatedAt: Date.parse('2026-05-07T22:00:00.000-03:00'),
            ageMs: 12_000,
        };
        mocks.runtime = {
            model: 'auto',
            reasoningEffort: 'xhigh',
            status: 'processing',
            dialogLoopActive: true,
            queueSize: 0,
        };
        mocks.stream = {
            model: 'claude-sonnet-4.6',
            reasoningEffort: 'xhigh',
        };
        mocks.structuredInputs = [];
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('mantém a linha viva de ferramenta curta e sem metadados redundantes', async () => {
        const { formatTerminalLiveStatusLine } =
            await import('../../../../src/copilot/terminal/repl/live-status-line.js');

        const line = formatTerminalLiveStatusLine({ now: Date.parse('2026-05-07T22:00:12.000-03:00') });

        expect(line).toContain('LLM-B');
        expect(line).toContain('ferramenta');
        expect(line).toContain('Ler arquivo');
        expect(line).not.toContain('Executando tool');
        expect(line).not.toContain('Executando ferramenta');
        expect(line).not.toContain('tool/');
        expect(line).not.toContain('read_file_content');
        expect(line).not.toContain('lendo arquivo');
        expect(line).toContain('12s');
        expect(line).not.toContain('modelo claude-sonnet-4.6');
        expect(line).not.toContain('raciocínio xhigh');
        expect(line).not.toContain('conversa ativa');
        expect(line.length).toBeLessThan(48);
    });

    it('mostra alvo operacional seguro da ferramenta na linha viva', async () => {
        mocks.activity = {
            ...mocks.activity,
            phase: 'tool',
            label: 'Ferramenta em uso',
            detail: 'executando comando · git status --short',
            toolName: 'exec_command',
            toolTarget: 'git status --short',
        };
        const { formatTerminalLiveStatusLine } =
            await import('../../../../src/copilot/terminal/repl/live-status-line.js');

        const line = formatTerminalLiveStatusLine();

        expect(line).toContain('Executar comando');
        expect(line).toContain('git status --short');
        expect(line).not.toContain('exec_command');
        expect(line).not.toContain('executando comando');
        expect(line.length).toBeLessThan(82);
    });

    it('mantém request_user_input formatável, mas fora do pulso periódico para não disputar o input', async () => {
        mocks.structuredInputs = [
            {
                requestId: 'request-user-input-test',
                question: 'Escolha como continuar o teste visual',
                choices: ['seguir', 'pausar'],
                allowFreeform: false,
                createdAt: Date.now(),
                sessionId: 'sdk-1',
                toolCallId: null,
                data: {},
            },
        ];
        const { formatTerminalLiveStatusLine, shouldRenderTerminalLiveStatusLine } =
            await import('../../../../src/copilot/terminal/repl/live-status-line.js');

        const line = formatTerminalLiveStatusLine();

        expect(shouldRenderTerminalLiveStatusLine()).toBe(false);
        expect(line).toContain('aguardando você');
        expect(line).toContain('formulário');
        expect(line).toContain('seguir|pausar');
        expect(line).not.toContain('Escolha como continuar');
        expect(line).not.toContain('request_user_input');
        expect(line).not.toContain('opções=');
        expect(line).not.toContain('noloop');
        expect(line).not.toContain('loop');
        expect(line).not.toContain('read_file_content');
        expect(line.length).toBeLessThan(58);
    });

    it('humaniza detalhes crus de tool antes de montar a linha viva', async () => {
        mocks.activity = {
            ...mocks.activity,
            phase: 'thinking',
            label: 'LLM-B trabalhando',
            detail: 'request_user_input ainda executando · report_intent_local · chatcmpl-tool-80d5a00b25801fef',
            toolName: null,
        };
        const { formatTerminalLiveStatusLine } =
            await import('../../../../src/copilot/terminal/repl/live-status-line.js');

        const line = formatTerminalLiveStatusLine();

        expect(line).toContain('Aguardando resposta');
        expect(line).not.toContain('request_user_input');
        expect(line).not.toContain('report_intent');
        expect(line).not.toContain('chatcmpl-tool');
    });

    it('renderiza continuamente enquanto há operação ativa', async () => {
        const { setupTerminalLiveStatusLine } =
            await import('../../../../src/copilot/terminal/repl/live-status-line.js');

        const cleanup = setupTerminalLiveStatusLine({ intervalMs: 1000 });
        expect(mocks.writeInlineStatus).toHaveBeenCalledTimes(1);

        await vi.advanceTimersByTimeAsync(2500);
        expect(mocks.writeInlineStatus).toHaveBeenCalledTimes(3);

        cleanup();
    });

    it('não redesenha frames idênticos antes do heartbeat', async () => {
        const { setupTerminalLiveStatusLine } =
            await import('../../../../src/copilot/terminal/repl/live-status-line.js');

        const cleanup = setupTerminalLiveStatusLine({ intervalMs: 250, heartbeatMs: 1000 });
        expect(mocks.writeInlineStatus).toHaveBeenCalledTimes(1);

        await vi.advanceTimersByTimeAsync(750);
        expect(mocks.writeInlineStatus).toHaveBeenCalledTimes(1);

        await vi.advanceTimersByTimeAsync(250);
        expect(mocks.writeInlineStatus).toHaveBeenCalledTimes(2);

        cleanup();
    });

    it('limpa a linha quando a atividade volta a idle', async () => {
        const { setupTerminalLiveStatusLine } =
            await import('../../../../src/copilot/terminal/repl/live-status-line.js');

        const cleanup = setupTerminalLiveStatusLine({ intervalMs: 1000 });
        mocks.activity = {
            ...mocks.activity,
            phase: 'idle',
            label: 'Pronto',
            detail: 'Aguardando próxima mensagem',
        };
        mocks.runtime = { ...mocks.runtime, status: 'idle' };
        await vi.advanceTimersByTimeAsync(1000);

        expect(mocks.clearInlineStatus).toHaveBeenCalled();
        cleanup();
    });

    it('não mantém linha viva para idle com status processing defasado', async () => {
        const { shouldRenderTerminalLiveStatusLine, formatTerminalLiveStatusLine } =
            await import('../../../../src/copilot/terminal/repl/live-status-line.js');
        mocks.activity = {
            ...mocks.activity,
            phase: 'idle',
            label: 'Pronto',
            detail: 'Aguardando próxima mensagem',
            toolName: null,
        };
        mocks.runtime = { ...mocks.runtime, status: 'processing', queueSize: 0 };

        expect(shouldRenderTerminalLiveStatusLine()).toBe(false);
        expect(formatTerminalLiveStatusLine()).toContain('conversa ativa');
        expect(formatTerminalLiveStatusLine()).not.toContain('processing:loop');
        expect(formatTerminalLiveStatusLine()).not.toContain('idle:loop');
    });

    it('não mantém heartbeat para atividade concluída quando runtime aguarda input', async () => {
        const { setupTerminalLiveStatusLine } =
            await import('../../../../src/copilot/terminal/repl/live-status-line.js');
        mocks.activity = {
            ...mocks.activity,
            phase: 'tool',
            label: 'Tool concluída',
            detail: 'lendo arquivo concluído (0.1s)',
            progress: 100,
        };
        mocks.runtime = { ...mocks.runtime, status: 'waiting_for_input' };

        const cleanup = setupTerminalLiveStatusLine({ intervalMs: 1000 });

        expect(mocks.writeInlineStatus).not.toHaveBeenCalled();
        cleanup();
    });

    it('compacta thinking longo sem delta em uma linha curta', async () => {
        const { formatTerminalLiveStatusLine } =
            await import('../../../../src/copilot/terminal/repl/live-status-line.js');
        mocks.activity = {
            ...mocks.activity,
            phase: 'thinking',
            label: 'LLM-B trabalhando',
            detail: 'auto · high · 20s sem delta visível',
            toolName: null,
            startedAt: Date.parse('2026-05-07T22:00:00.000-03:00'),
        };
        mocks.stream = { model: 'auto', reasoningEffort: 'high' };

        const line = formatTerminalLiveStatusLine({ now: Date.parse('2026-05-07T22:00:18.000-03:00') });

        expect(line).toContain('pensando');
        expect(line).toContain('20s sem delta');
        expect(line).not.toContain('modelo auto');
        expect(line).not.toContain('raciocínio high');
        expect(line).not.toContain('conversa ativa');
        expect(line).not.toContain('thinking');
        expect(line).not.toContain('LLM-B trabalhando');
        expect(line.length).toBeLessThan(70);
    });

    it('compacta espera sem resposta pública sem duplicar modelo/esforço', async () => {
        const { formatTerminalLiveStatusLine } =
            await import('../../../../src/copilot/terminal/repl/live-status-line.js');
        mocks.activity = {
            ...mocks.activity,
            phase: 'thinking',
            label: 'LLM-B trabalhando',
            detail: '10s sem resposta visível',
            toolName: null,
            startedAt: Date.parse('2026-05-07T22:00:00.000-03:00'),
        };
        mocks.stream = { model: 'kilo-auto/free', reasoningEffort: 'high' };

        const line = formatTerminalLiveStatusLine({ now: Date.parse('2026-05-07T22:00:14.000-03:00') });

        expect(line).toContain('pensando');
        expect(line).toContain('10s sem resposta pública');
        expect(line).not.toContain('Aguardando resposta');
        expect(line).not.toContain('modelo kilo-auto/free');
        expect(line).not.toContain('raciocínio high');
        expect(line).not.toContain('conversa ativa');
        expect(line.length).toBeLessThan(80);
    });

    it('compacta retry de modelo sem expor mensagem técnica longa', async () => {
        const { formatTerminalLiveStatusLine } =
            await import('../../../../src/copilot/terminal/repl/live-status-line.js');
        mocks.activity = {
            ...mocks.activity,
            phase: 'error',
            label: 'Retry de modelo em andamento',
            detail: 'Response was interrupted due to a server error. Retrying...',
            severity: 'warn',
            toolName: null,
            startedAt: Date.parse('2026-05-07T22:00:00.000-03:00'),
        };
        mocks.stream = { model: 'kilo-auto/free', reasoningEffort: 'high' };

        const line = formatTerminalLiveStatusLine({ now: Date.parse('2026-05-07T22:00:12.000-03:00') });

        expect(line).toContain('recuperando');
        expect(line).toContain('retry do modelo');
        expect(line).toContain('12s');
        expect(line).not.toContain('Response was interrupted');
        expect(line).not.toContain('server error');
        expect(line).not.toContain('modelo kilo-auto/free');
        expect(line).not.toContain('raciocínio high');
        expect(line).not.toContain('conversa ativa');
        expect(line.length).toBeLessThan(58);
    });

    it('traduz pending messages na linha viva de turno', async () => {
        const { formatTerminalLiveStatusLine } =
            await import('../../../../src/copilot/terminal/repl/live-status-line.js');
        mocks.activity = {
            ...mocks.activity,
            phase: 'turn',
            label: 'Pending messages alteradas',
            detail: '0 mensagem(ns) pendente(s)',
            toolName: null,
        };

        const line = formatTerminalLiveStatusLine();

        expect(line).toContain('Contexto atualizado');
        expect(line).not.toContain('Pending messages alteradas');
    });

    it('humaniza estado de boot sem stopped:noloop ou starting:noloop', async () => {
        const { formatTerminalLiveStatusLine } =
            await import('../../../../src/copilot/terminal/repl/live-status-line.js');
        mocks.activity = {
            ...mocks.activity,
            phase: 'boot',
            label: 'Preparando terminal',
            detail: '',
            toolName: null,
        };
        mocks.runtime = { ...mocks.runtime, status: 'starting', dialogLoopActive: false };

        const line = formatTerminalLiveStatusLine({ now: Date.parse('2026-05-07T22:00:12.000-03:00') });

        expect(line).toContain('iniciando');
        expect(line).not.toContain('starting:noloop');
        expect(line).not.toContain('stopped:noloop');
        expect(line).not.toContain('modelo claude-sonnet-4.6');
        expect(line).not.toContain('raciocínio xhigh');
        expect(line).not.toContain('conversa parada');
        expect(line.length).toBeLessThan(62);
    });

    it('compacta estado turn sem repetir detalhe longo', async () => {
        const { formatTerminalLiveStatusLine } =
            await import('../../../../src/copilot/terminal/repl/live-status-line.js');
        mocks.activity = {
            ...mocks.activity,
            phase: 'turn',
            label: 'Intenção da LLM-B',
            detail: 'terminal live canonical deltas tools ask_user usage',
            toolName: null,
        };
        mocks.stream = { model: 'auto', reasoningEffort: 'high' };

        const line = formatTerminalLiveStatusLine({ now: Date.parse('2026-05-07T22:00:12.000-03:00') });

        expect(line).toContain('turno · Intenção da LLM-B');
        expect(line).toContain('12s');
        expect(line).not.toContain('terminal live canonical');
        expect(line).not.toContain('conversa ativa');
        expect(line.length).toBeLessThan(72);
    });

    it('compacta finalização de turno sem rótulo truncado longo', async () => {
        const { formatTerminalLiveStatusLine } =
            await import('../../../../src/copilot/terminal/repl/live-status-line.js');
        mocks.activity = {
            ...mocks.activity,
            phase: 'turn',
            label: 'Turno do assistente concluído',
            detail: 'turno 2',
            toolName: null,
            startedAt: Date.parse('2026-05-07T22:00:00.000-03:00'),
        };

        const line = formatTerminalLiveStatusLine({ now: Date.parse('2026-05-07T22:00:02.000-03:00') });

        expect(line).toContain('finalizando');
        expect(line).toContain('2s');
        expect(line).not.toContain('Turno do assistente');
        expect(line).not.toContain('concluí');
        expect(line).not.toContain('conversa ativa');
        expect(line.length).toBeLessThan(42);
    });

    it('não mantém linha viva para continuação pós-pergunta vazia já encerrada', async () => {
        const { shouldRenderTerminalLiveStatusLine } =
            await import('../../../../src/copilot/terminal/repl/live-status-line.js');
        mocks.activity = {
            ...mocks.activity,
            phase: 'turn',
            label: 'Continuação pós-pergunta vazia',
            detail: 'continuação pós-pergunta terminou sem texto público · resposta SIM',
            source: 'dialog.turn_end',
            severity: 'warn',
            toolName: null,
            startedAt: Date.parse('2026-05-07T22:00:00.000-03:00'),
        };
        mocks.runtime = {
            ...mocks.runtime,
            status: 'idle',
            dialogLoopActive: true,
            queueSize: 0,
        };

        expect(shouldRenderTerminalLiveStatusLine()).toBe(false);
    });

    it('mantém erro BYOK compacto na linha viva', async () => {
        const { formatTerminalLiveStatusLine } =
            await import('../../../../src/copilot/terminal/repl/live-status-line.js');
        mocks.activity = {
            ...mocks.activity,
            phase: 'error',
            label: 'Erro de provider BYOK',
            detail: 'Erro do SDK sem mensagem estruturada. · erro de provider BYOK; fallback para Copilot auto bloqueado por contrato; retry automático bloqueado para não prender o terminal; troque provider/modelo via /byok use ou /byok model; sem Premium Request · provider openai · perfil kilo · modelo kilo-auto/free',
            source: 'agent',
            severity: 'warn',
            toolName: null,
            startedAt: Date.parse('2026-05-07T22:00:00.000-03:00'),
        };
        mocks.runtime = {
            ...mocks.runtime,
            status: 'processing',
            dialogLoopActive: true,
        };

        const line = formatTerminalLiveStatusLine({ now: Date.parse('2026-05-07T22:00:03.000-03:00') });

        expect(line).toContain('erro');
        expect(line).toContain('provedor BYOK');
        expect(line).not.toContain('provider BYOK');
        expect(line).toContain('3s');
        expect(line).not.toContain('Erro do SDK sem mensagem estruturada');
        expect(line).not.toContain('/byok model');
        expect(line).not.toContain('modelo kilo-auto/free');
        expect(line).not.toContain('raciocínio xhigh');
        expect(line).not.toContain('conversa ativa');
        expect(line.length).toBeLessThan(42);
    });

    it('mantém ask_user humano formatável, mas fora do pulso periódico para não disputar o input', async () => {
        const { shouldRenderTerminalLiveStatusLine, formatTerminalLiveStatusLine } =
            await import('../../../../src/copilot/terminal/repl/live-status-line.js');
        mocks.activity = {
            ...mocks.activity,
            phase: 'thinking',
            label: 'LLM-B trabalhando',
            detail: 'auto · xhigh · 20s sem delta visível',
            toolName: null,
        };
        mocks.runtime = {
            ...mocks.runtime,
            status: 'waiting_for_input',
            pendingQuestionKind: 'question',
            pendingQuestion: {
                kind: 'question',
                question: 'Qual cor devo usar no teste visual?',
                choices: ['azul', 'verde'],
                askedAt: Date.now(),
                allowFreeform: false,
                protocolControlled: false,
            },
        };

        expect(shouldRenderTerminalLiveStatusLine()).toBe(false);
        const line = formatTerminalLiveStatusLine();
        expect(line).toContain('aguardando você');
        expect(line).toContain('[PERG]');
        expect(line).toContain('azul|verde');
        expect(line).not.toContain('Qual cor devo usar');
        expect(line).not.toContain('responda no prompt');
        expect(line).not.toContain('conversa ativa');
        expect(line).not.toContain('opções=');
        expect(line).not.toContain('modelo auto');
        expect(line).not.toContain('LLM-B trabalhando');
        expect(line.length).toBeLessThan(55);
    });

    it('compacta estado pós-resposta humana sem quebrar a linha viva', async () => {
        const { formatTerminalLiveStatusLine } =
            await import('../../../../src/copilot/terminal/repl/live-status-line.js');
        mocks.activity = {
            ...mocks.activity,
            phase: 'question',
            label: 'Resposta do operador',
            detail: 'escolha estruturada',
            toolName: null,
        };
        mocks.runtime = { ...mocks.runtime, status: 'processing', pendingQuestion: null, pendingQuestionKind: null };

        const line = formatTerminalLiveStatusLine({ now: Date.parse('2026-05-07T22:00:12.000-03:00') });

        expect(line).toContain('continuando');
        expect(line).toContain('12s');
        expect(line).not.toContain('resposta recebida');
        expect(line).not.toContain('aguardando LLM-B');
        expect(line).not.toContain('Resposta do operador');
        expect(line).not.toContain('escolha estruturada');
        expect(line).not.toContain('modelo auto');
        expect(line).not.toContain('conversa ativa');
        expect(line.length).toBeLessThan(32);
    });
});
