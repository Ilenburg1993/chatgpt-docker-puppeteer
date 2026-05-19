// @ts-check

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
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('formata a linha viva com fase, tool, detalhe, tempo e modelo efetivo', async () => {
        const { formatTerminalLiveStatusLine } =
            await import('../../../../src/copilot/terminal/repl/live-status-line.js');

        const line = formatTerminalLiveStatusLine({ now: Date.parse('2026-05-07T22:00:12.000-03:00') });

        expect(line).toContain('LLM-B');
        expect(line).toContain('tool/Executando tool');
        expect(line).toContain('read_file_content');
        expect(line).toContain('lendo arquivo');
        expect(line).toContain('12s');
        expect(line).toContain('claude-sonnet-4.6/xhigh');
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
        const { shouldRenderTerminalLiveStatusLine, formatTerminalLiveStatusLine } = await import(
            '../../../../src/copilot/terminal/repl/live-status-line.js'
        );
        mocks.activity = {
            ...mocks.activity,
            phase: 'idle',
            label: 'Pronto',
            detail: 'Aguardando próxima mensagem',
            toolName: null,
        };
        mocks.runtime = { ...mocks.runtime, status: 'processing', queueSize: 0 };

        expect(shouldRenderTerminalLiveStatusLine()).toBe(false);
        expect(formatTerminalLiveStatusLine()).toContain('idle:loop');
        expect(formatTerminalLiveStatusLine()).not.toContain('processing:loop');
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
});
