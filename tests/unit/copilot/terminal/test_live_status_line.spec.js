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
    activityHistory: /** @type {Record<string, unknown>[]} */ ([]),
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
    readTerminalActivityHistory: vi.fn(() => mocks.activityHistory),
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
        mocks.activityHistory = [];
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

    it('mantém alvo de ferramenta em uma única linha física na largura efetiva do terminal', async () => {
        mocks.activity = {
            ...mocks.activity,
            phase: 'tool',
            label: 'Ferramenta em uso',
            detail: 'executando comando longo',
            toolName: 'exec_command',
            toolTarget:
                'node -e "setTimeout(() => console.log(\'LONG-TOOL-HEARTBEAT-DONE\'), 4000)"',
        };
        const { formatTerminalLiveStatusLine } =
            await import('../../../../src/copilot/terminal/repl/live-status-line.js');

        const line = formatTerminalLiveStatusLine({ columns: 72 });
        const visible = line.replace(/\x1b\[[0-?]*[ -/]*[@-~]/gu, '');

        expect(visible).toContain('LLM-B');
        expect(visible).toContain('Executar comando');
        expect(visible).toContain('node');
        expect(visible).not.toContain('\n');
        expect(visible).not.toContain('\r');
        expect(Array.from(visible).length).toBeLessThanOrEqual(71);
    });

    it('prioriza ação e alvo sobre o rótulo de fase em PTY muito estreito', async () => {
        mocks.activity = {
            ...mocks.activity,
            phase: 'tool',
            label: 'Ferramenta em uso',
            detail: 'executando comando longo',
            toolName: 'exec_command',
            toolTarget: 'node -e "console.log(123)"',
        };
        const { formatTerminalLiveStatusLine } =
            await import('../../../../src/copilot/terminal/repl/live-status-line.js');

        const line = formatTerminalLiveStatusLine({ columns: 48 });
        const visible = line.replace(/\x1b\[[0-?]*[ -/]*[@-~]/gu, '');

        expect(visible).toContain('LLM-B');
        expect(visible).toContain('Executar comando');
        expect(visible).toContain('node');
        expect(visible).not.toContain('ferramenta');
        expect(Array.from(visible).length).toBeLessThanOrEqual(48);
    });

    it('impõe barreira de uma linha também para detalhes inesperadamente longos', async () => {
        mocks.activity = {
            ...mocks.activity,
            phase: 'thinking',
            label: 'Analisando contexto profundamente',
            detail: `detalhe inesperado ${'muito longo '.repeat(30)}`,
            toolName: null,
        };
        const { formatTerminalLiveStatusLine } =
            await import('../../../../src/copilot/terminal/repl/live-status-line.js');

        const line = formatTerminalLiveStatusLine({ columns: 60 });
        const visible = line.replace(/\x1b\[[0-?]*[ -/]*[@-~]/gu, '');

        expect(visible).not.toContain('\n');
        expect(visible).not.toContain('\r');
        expect(Array.from(visible).length).toBeLessThanOrEqual(59);
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

    it('trata request_user_input cru como pergunta humana antes da pendência estruturada aparecer', async () => {
        mocks.structuredInputs = [];
        mocks.activity = {
            ...mocks.activity,
            phase: 'tool',
            label: 'LLM-B tool/Executando tool',
            detail: 'request_user_input ainda executando · 44s · chatcmpl-tool-80d5a00b25801fef',
            toolName: 'request_user_input',
        };
        const { formatTerminalLiveStatusLine, shouldRenderTerminalLiveStatusLine } =
            await import('../../../../src/copilot/terminal/repl/live-status-line.js');

        const line = formatTerminalLiveStatusLine();

        expect(shouldRenderTerminalLiveStatusLine()).toBe(false);
        expect(line).toContain('aguardando você');
        expect(line).toContain('[PERG]');
        expect(line).not.toContain('request_user_input');
        expect(line).not.toContain('chatcmpl-tool');
        expect(line).not.toContain('Executando tool');
    });

    it('classifica detalhes crus de request_user_input como pergunta humana, não como tool comum', async () => {
        mocks.activity = {
            ...mocks.activity,
            phase: 'thinking',
            label: 'LLM-B trabalhando',
            detail: 'request_user_input ainda executando · report_intent_local · chatcmpl-tool-80d5a00b25801fef',
            toolName: null,
        };
        const { formatTerminalLiveStatusLine, shouldRenderTerminalLiveStatusLine } =
            await import('../../../../src/copilot/terminal/repl/live-status-line.js');

        const line = formatTerminalLiveStatusLine();

        expect(shouldRenderTerminalLiveStatusLine()).toBe(false);
        expect(line).toContain('aguardando você');
        expect(line).toContain('[PERG]');
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
        expect(line.length).toBeLessThan(84);
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
            detail: '0 mensagens pendentes',
            toolName: null,
        };

        const line = formatTerminalLiveStatusLine();

        expect(line).toContain('preparando');
        expect(line).toContain('Conversa atualizada');
        expect(line).not.toContain('turno ·');
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

        expect(line).toContain('planejando · Intenção da LLM-B');
        expect(line).toContain('12s');
        expect(line).not.toContain('turno ·');
        expect(line).not.toContain('terminal live canonical');
        expect(line).not.toContain('conversa ativa');
        expect(line.length).toBeLessThan(72);
    });

    it('compacta processamento genérico de turno como pensamento humano', async () => {
        const { formatTerminalLiveStatusLine } =
            await import('../../../../src/copilot/terminal/repl/live-status-line.js');
        mocks.activity = {
            ...mocks.activity,
            phase: 'turn',
            label: 'Processando mensagem',
            detail: null,
            toolName: null,
        };

        const line = formatTerminalLiveStatusLine({ now: Date.parse('2026-05-07T22:00:12.000-03:00') });

        expect(line).toContain('LLM-B pensando');
        expect(line).toContain('12s');
        expect(line).not.toContain('turno');
        expect(line).not.toContain('Processando mensagem');
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
        mocks.runtime = { ...mocks.runtime, status: 'idle' };

        const line = formatTerminalLiveStatusLine({ now: Date.parse('2026-05-07T22:00:02.000-03:00') });

        expect(line).toContain('finalizando');
        expect(line).toContain('2s');
        expect(line).not.toContain('Turno do assistente');
        expect(line).not.toContain('concluí');
        expect(line).not.toContain('conversa ativa');
        expect(line.length).toBeLessThan(42);
    });

    it('trata conclusão intermediária sem resposta pública como continuação', async () => {
        const { formatTerminalLiveStatusLine } =
            await import('../../../../src/copilot/terminal/repl/live-status-line.js');
        const now = Date.parse('2026-05-07T22:00:02.000-03:00');
        mocks.activity = {
            ...mocks.activity,
            phase: 'turn',
            label: 'Turno do assistente concluído',
            detail: 'turno 0',
            toolName: null,
            startedAt: now - 500,
            updatedAt: now - 500,
        };
        mocks.activityHistory = [
            {
                phase: 'turn',
                label: 'Turno do assistente concluído',
                detail: 'turno 0',
                updatedAt: now - 500,
                ts: now - 500,
            },
            {
                phase: 'tool',
                label: 'Leitura concluída',
                detail: 'package.json',
                updatedAt: now - 700,
                ts: now - 700,
            },
        ];
        mocks.runtime = { ...mocks.runtime, status: 'processing', dialogLoopActive: true };

        const line = formatTerminalLiveStatusLine({ now });

        expect(line).toContain('continuando');
        expect(line).not.toContain('finalizando');
    });

    it('preserva finalização quando uma resposta pública acabou de materializar', async () => {
        const { formatTerminalLiveStatusLine } =
            await import('../../../../src/copilot/terminal/repl/live-status-line.js');
        const now = Date.parse('2026-05-07T22:00:02.000-03:00');
        mocks.activity = {
            ...mocks.activity,
            phase: 'turn',
            label: 'Turno do assistente concluído',
            detail: 'turno 2',
            toolName: null,
            startedAt: now - 500,
            updatedAt: now - 500,
        };
        mocks.activityHistory = [
            {
                phase: 'turn',
                label: 'Turno do assistente concluído',
                detail: 'turno 2',
                updatedAt: now - 500,
                ts: now - 500,
            },
            {
                phase: 'turn',
                label: 'Mensagem da LLM-B recebida',
                detail: 'Resposta da LLM-B · ok',
                updatedAt: now - 700,
                ts: now - 700,
            },
        ];
        mocks.runtime = { ...mocks.runtime, status: 'processing', dialogLoopActive: true };

        const line = formatTerminalLiveStatusLine({ now });

        expect(line).toContain('finalizando');
        expect(line).not.toContain('continuando');
    });

    it('não mantém linha viva para continuação sem resposta pública já encerrada', async () => {
        const { shouldRenderTerminalLiveStatusLine } =
            await import('../../../../src/copilot/terminal/repl/live-status-line.js');
        mocks.activity = {
            ...mocks.activity,
            phase: 'turn',
            label: 'Continuação sem resposta pública',
            detail: 'continuação após resposta humana sem texto público · resposta SIM',
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
        expect(line).toContain('rota BYOK');
        expect(line).not.toContain('provider BYOK');
        expect(line).toContain('3s');
        expect(line).not.toContain('Erro do SDK sem mensagem estruturada');
        expect(line).not.toContain('/byok model');
        expect(line).not.toContain('modelo kilo-auto/free');
        expect(line).not.toContain('raciocínio xhigh');
        expect(line).not.toContain('conversa ativa');
        expect(line.length).toBeLessThan(42);
    });

    it('mantém falha da rota BYOK compacta na linha viva', async () => {
        const { formatTerminalLiveStatusLine } =
            await import('../../../../src/copilot/terminal/repl/live-status-line.js');
        mocks.activity = {
            ...mocks.activity,
            phase: 'error',
            label: 'Falha da rota BYOK no turno',
            detail:
                'rota BYOK ficou sem resposta dentro da janela esperada · sem Premium Request · perfil kilo · provedor kilo-code · modelo kilo-auto/free',
            source: 'dialog',
            severity: 'error',
            toolName: null,
            startedAt: Date.parse('2026-05-07T22:00:00.000-03:00'),
        };
        mocks.runtime = {
            ...mocks.runtime,
            status: 'processing',
            dialogLoopActive: true,
        };

        const line = formatTerminalLiveStatusLine({ now: Date.parse('2026-05-07T22:00:05.000-03:00') });

        expect(line).toContain('erro');
        expect(line).toContain('rota BYOK');
        expect(line).toContain('5s');
        expect(line).not.toContain('kilo-auto/free');
        expect(line).not.toContain('Premium Request');
        expect(line.length).toBeLessThan(42);
    });

    it('mostra troca de modelo como estado vivo curto e operacional', async () => {
        const { formatTerminalLiveStatusLine } =
            await import('../../../../src/copilot/terminal/repl/live-status-line.js');
        mocks.activity = {
            ...mocks.activity,
            phase: 'model',
            label: 'Troca de modelo solicitada',
            detail:
                'solicitado: old-model → openai/gpt-oss-120b · solicitação manual /byok model · confiança catalog · origem terminal.byok_model · 2026-05-08T01:00:00.000Z · aguardando confirmação do SDK ou próximo uso observado',
            source: 'terminal.byok_model',
            severity: 'info',
            toolName: null,
            toolTarget: null,
            startedAt: Date.parse('2026-05-07T22:00:00.000-03:00'),
        };
        mocks.runtime = { ...mocks.runtime, status: 'idle', dialogLoopActive: true };

        const line = formatTerminalLiveStatusLine({ now: Date.parse('2026-05-07T22:00:04.000-03:00') });

        expect(line).toContain('modelo solicitado');
        expect(line).toContain('old-model → openai/gpt-oss-120b');
        expect(line).toContain('conf catalog');
        expect(line).toContain('4s');
        expect(line).not.toContain('session.model_changed');
        expect(line).not.toContain('confirmação do SDK');
        expect(line).not.toContain('2026-05-08T01:00:00.000Z');
        expect(line).not.toContain('raciocínio xhigh');
        expect(line.length).toBeLessThan(84);
    });

    it('não mantém linha viva de confirmação de modelo quando a sessão já voltou ao prompt', async () => {
        const { shouldRenderTerminalLiveStatusLine, formatTerminalLiveStatusLine } =
            await import('../../../../src/copilot/terminal/repl/live-status-line.js');
        mocks.activity = {
            ...mocks.activity,
            phase: 'model',
            label: 'Modelo SDK confirmado',
            detail:
                'confirmado: kilo-auto/free → terminal-ux-boundary-fixture · raciocínio high · confirma pedido terminal.byok_model',
            source: 'sdk',
            severity: 'info',
            toolName: null,
            toolTarget: null,
            startedAt: Date.parse('2026-05-07T22:00:00.000-03:00'),
        };
        mocks.runtime = { ...mocks.runtime, status: 'idle', dialogLoopActive: true, queueSize: 0 };

        expect(formatTerminalLiveStatusLine({ now: Date.parse('2026-05-07T22:00:04.000-03:00') })).toContain(
            'modelo confirmado',
        );
        expect(shouldRenderTerminalLiveStatusLine()).toBe(false);
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
            label: 'Resposta registrada',
            detail: 'resposta registrada; aguardando resposta final da LLM-B · resposta SIM',
            toolName: null,
        };
        mocks.runtime = { ...mocks.runtime, status: 'processing', pendingQuestion: null, pendingQuestionKind: null };

        const line = formatTerminalLiveStatusLine({ now: Date.parse('2026-05-07T22:00:12.000-03:00') });

        expect(line).toContain('continuando');
        expect(line).toContain('12s');
        expect(line).not.toContain('resposta recebida');
        expect(line).not.toContain('aguardando LLM-B');
        expect(line).not.toContain('Continuação sem resposta pública');
        expect(line).not.toContain('Resposta registrada');
        expect(line).not.toContain('resposta registrada');
        expect(line).not.toContain('modelo auto');
        expect(line).not.toContain('conversa ativa');
        expect(line.length).toBeLessThan(32);
    });

    it('preserva continuação pós-resposta durante finalização imediata do turno', async () => {
        const { formatTerminalLiveStatusLine } =
            await import('../../../../src/copilot/terminal/repl/live-status-line.js');
        const now = Date.parse('2026-05-07T22:00:12.000-03:00');
        mocks.activity = {
            ...mocks.activity,
            phase: 'turn',
            label: 'Turno do assistente concluído',
            detail: 'turno 2',
            toolName: null,
            startedAt: now - 1_000,
            updatedAt: now - 1_000,
        };
        mocks.activityHistory = [
            {
                phase: 'question',
                label: 'Pergunta respondida',
                detail: 'resposta do operador SIM encaminhada',
                updatedAt: now - 1_500,
                ts: now - 1_500,
            },
        ];
        mocks.runtime = { ...mocks.runtime, status: 'processing', pendingQuestion: null, pendingQuestionKind: null };

        const line = formatTerminalLiveStatusLine({ now });

        expect(line).toContain('continuando');
        expect(line).not.toContain('finalizando');
    });

    it('classifica atividades question não-humanas como decisão ou intervenção', async () => {
        const { formatTerminalLiveStatusLine } =
            await import('../../../../src/copilot/terminal/repl/live-status-line.js');
        mocks.activity = {
            ...mocks.activity,
            phase: 'question',
            label: 'Permissão SDK solicitada',
            detail: 'editar arquivo src/app.js',
            toolName: null,
        };
        mocks.runtime = { ...mocks.runtime, status: 'processing', pendingQuestion: null, pendingQuestionKind: null };

        const permissionLine = formatTerminalLiveStatusLine({
            now: Date.parse('2026-05-07T22:00:12.000-03:00'),
        });

        expect(permissionLine).toContain('decisão');
        expect(permissionLine).not.toContain('pergunta');
        expect(permissionLine).not.toContain('Permissão SDK solicitada');

        mocks.activity = {
            ...mocks.activity,
            phase: 'question',
            label: 'Nova mensagem na caixa de entrada',
            detail: 'intervenção aguardando próxima ask_user',
            toolName: null,
        };

        const mailboxLine = formatTerminalLiveStatusLine({
            now: Date.parse('2026-05-07T22:00:12.000-03:00'),
        });

        expect(mailboxLine).toContain('intervenção');
        expect(mailboxLine).not.toContain('pergunta');
        expect(mailboxLine).not.toContain('Nova mensagem');
    });
});
