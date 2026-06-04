// @ts-check

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    rl: {
        closed: false,
        line: '',
        setPrompt: vi.fn(),
        prompt: vi.fn(),
        pause: vi.fn(),
        resume: vi.fn(),
        getPrompt: vi.fn(() => 'você› '),
    },
    busy: false,
    runtime: {
        model: 'kilo-auto/free',
        reasoningEffort: 'high',
        status: 'processing',
        sessionId: 's1',
        dialogLoopActive: true,
        dialogPaused: false,
        queueSize: 0,
        pendingQuestion: null,
        pendingQuestionKind: null,
        pendingQuestionShadow: null,
        pendingQuestionShadowKind: null,
        pendingQuestionShadowState: null,
        pendingQuestionShadowExpired: false,
        pendingQuestionShadowAgeMs: null,
        pendingQuestionShadowExpiresAt: null,
        pendingQuestionShadowRemainingMs: null,
        lastPrInfo: null,
    },
    activitySnapshot: {
        phase: 'tool',
        label: 'Executando tool',
        detail: 'lendo arquivo',
        source: 'sdk',
        severity: 'info',
        progress: null,
        toolName: 'read_file_content',
        startedAt: 1,
        updatedAt: 2,
        ageMs: 1000,
    },
}));

vi.mock('../../../../src/copilot/presentation/state/index.js', () => ({
    getBusy: vi.fn(() => mocks.busy),
    getRl: vi.fn(() => mocks.rl),
    getSdkSessionMode: vi.fn(() => 'interactive'),
    getShowThinking: vi.fn(() => false),
    getShowStreaming: vi.fn(() => true),
    getShowUsage: vi.fn(() => true),
    getShowToolActivity: vi.fn(() => true),
    getShowIntentActivity: vi.fn(() => true),
    getShowSessionActivity: vi.fn(() => false),
    setShowThinking: vi.fn(),
    setShowStreaming: vi.fn(),
    setShowUsage: vi.fn(),
    setShowToolActivity: vi.fn(),
    setShowIntentActivity: vi.fn(),
    setShowSessionActivity: vi.fn(),
}));

vi.mock('../../../../src/copilot/terminal/frontend/gateways/agent-runtime.js', () => ({
    readTerminalDialogStreamMeta: vi.fn(() => ({ model: 'kilo-auto/free', reasoningEffort: 'high' })),
    readTerminalRuntimeState: vi.fn(() => mocks.runtime),
}));

vi.mock('../../../../src/copilot/terminal/state/activity-state.js', () => ({
    readTerminalActivitySnapshot: vi.fn(() => mocks.activitySnapshot),
}));

vi.mock('../../../../src/copilot/terminal/state/ui-preferences.js', () => ({
    getTerminalDetailLevel: vi.fn(() => 'normal'),
    readTerminalPromptDisplayPolicy: vi.fn(() => ({
        showQueueTag: true,
        showNonCriticalShadowTag: false,
        showWaitingActivity: true,
    })),
}));

const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

const {
    beginTerminalRenderLock,
    clearInlineStatus,
    endTerminalRenderLock,
    parkTerminalPromptForContinuation,
    printlnBlock,
    readTerminalExclusiveTtyReadiness,
    redrawTerminalPrompt,
    resetStatusRowState,
    scheduleTerminalPromptRedraw,
    withTerminalExclusiveTty,
    writeInlineStatus,
} = await import('../../../../src/copilot/terminal/dialog/output.js');

describe('terminal/dialog/output inline status', () => {
    /** @type {PropertyDescriptor | undefined} */
    let originalIsTTY;
    /** @type {PropertyDescriptor | undefined} */
    let originalStdinIsTTY;
    /** @type {PropertyDescriptor | undefined} */
    let originalColumns;
    /** @type {string | undefined} */
    let originalMode;

    beforeEach(() => {
        vi.clearAllMocks();
        writeSpy.mockClear();
        originalIsTTY = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY');
        originalStdinIsTTY = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');
        originalColumns = Object.getOwnPropertyDescriptor(process.stdout, 'columns');
        originalMode = process.env['COPILOT_TERMINAL_INLINE_STATUS'];
        Object.defineProperty(process.stdout, 'isTTY', { configurable: true, value: true });
        Object.defineProperty(process.stdin, 'isTTY', { configurable: true, value: true });
        Object.defineProperty(process.stdout, 'columns', { configurable: true, value: 120 });
        delete process.env['COPILOT_TERMINAL_INLINE_STATUS'];
        mocks.busy = false;
        mocks.rl.closed = false;
        mocks.rl.line = '';
        mocks.activitySnapshot = {
            phase: 'tool',
            label: 'Executando tool',
            detail: 'lendo arquivo',
            source: 'sdk',
            severity: 'info',
            progress: null,
            toolName: 'read_file_content',
            startedAt: 1,
            updatedAt: 2,
            ageMs: 1000,
        };
    });

    afterEach(() => {
        clearInlineStatus();
        resetStatusRowState();
        if (originalIsTTY) Object.defineProperty(process.stdout, 'isTTY', originalIsTTY);
        if (originalStdinIsTTY) Object.defineProperty(process.stdin, 'isTTY', originalStdinIsTTY);
        if (originalColumns) Object.defineProperty(process.stdout, 'columns', originalColumns);
        if (originalMode === undefined) delete process.env['COPILOT_TERMINAL_INLINE_STATUS'];
        else process.env['COPILOT_TERMINAL_INLINE_STATUS'] = originalMode;
    });

    it('renderiza a linha viva por default em modo reserved quando stdout é TTY', () => {
        writeInlineStatus('LLM-B tool/Executando tool · lendo arquivo');

        const output = writeSpy.mock.calls.map(([chunk]) => String(chunk)).join('');
        expect(output).toContain('LLM-B ferramenta');
        expect(output).toContain('Ferramenta em uso');
        expect(output).not.toContain('tool/Executando tool');
        expect(output).toContain('\x1b[s');
        expect(mocks.rl.setPrompt).toHaveBeenCalled();
        expect(mocks.rl.prompt).toHaveBeenCalled();
    });

    it('permite desligar a linha viva por env', () => {
        process.env['COPILOT_TERMINAL_INLINE_STATUS'] = 'off';

        writeInlineStatus('LLM-B tool/Executando tool');

        expect(writeSpy).not.toHaveBeenCalled();
        expect(mocks.rl.prompt).not.toHaveBeenCalled();
    });

    it('não limpa input humano parcialmente digitado por redraw agendado', async () => {
        mocks.rl.line = '/usage now';

        scheduleTerminalPromptRedraw(mocks.rl, 'você› ');
        await new Promise((resolve) => setImmediate(resolve));

        expect(mocks.rl.setPrompt).not.toHaveBeenCalled();
        expect(mocks.rl.prompt).not.toHaveBeenCalled();
    });

    it('não repinta linha viva enquanto o operador já digitou resposta parcial', () => {
        mocks.rl.line = 'SIM';

        writeInlineStatus('LLM-B aguardando você · [PERG] · SIM');

        expect(writeSpy).not.toHaveBeenCalled();
        expect(mocks.rl.setPrompt).not.toHaveBeenCalled();
        expect(mocks.rl.prompt).not.toHaveBeenCalled();
    });

    it('suprime repaint idêntico em sequência curta sem limpar a linha', () => {
        redrawTerminalPrompt(mocks.rl, 'você› ');
        redrawTerminalPrompt(mocks.rl, 'você› ');

        expect(mocks.rl.setPrompt).toHaveBeenCalledTimes(1);
        expect(mocks.rl.prompt).toHaveBeenCalledTimes(1);
    });

    it('estaciona prompt normal durante continuação pós-resposta humana', () => {
        parkTerminalPromptForContinuation(1_000);

        writeInlineStatus('LLM-B finalizando · 1s');

        expect(mocks.rl.setPrompt).toHaveBeenCalledWith(expect.stringContaining('LLM-B pensando'));
        expect(mocks.rl.setPrompt).not.toHaveBeenCalledWith('você› ');
    });

    it('não repinta prompt em printlnBlock enquanto render lock está ativo', () => {
        beginTerminalRenderLock();
        try {
            printlnBlock(['linha permanente durante streaming']);
        } finally {
            endTerminalRenderLock();
        }

        const output = writeSpy.mock.calls.map(([chunk]) => String(chunk)).join('');
        expect(output).toContain('linha permanente durante streaming');
        expect(mocks.rl.setPrompt).not.toHaveBeenCalled();
        expect(mocks.rl.prompt).not.toHaveBeenCalled();
    });

    it('não redesenha prompt automaticamente para printlnBlock durante boot', async () => {
        mocks.activitySnapshot = {
            phase: 'boot',
            label: 'Iniciando agente',
            detail: 'Inicializando ambiente da conversa',
            source: 'dialog',
            severity: 'info',
            progress: null,
            toolName: null,
            startedAt: 1,
            updatedAt: 2,
            ageMs: 1000,
        };

        printlnBlock(['  Preparando agente...']);
        await new Promise((resolve) => setImmediate(resolve));

        const output = writeSpy.mock.calls.map(([chunk]) => String(chunk)).join('');
        expect(output).toContain('Preparando agente');
        expect(mocks.rl.setPrompt).not.toHaveBeenCalled();
        expect(mocks.rl.prompt).not.toHaveBeenCalled();
    });

    it('bloqueia handoff TTY exclusivo quando há input humano parcialmente digitado', () => {
        mocks.rl.line = '/status';

        const readiness = readTerminalExclusiveTtyReadiness(mocks.rl);

        expect(readiness.ready).toBe(false);
        expect(readiness.reasons).toContain('input humano parcialmente digitado');
    });

    it('bloqueia handoff TTY exclusivo durante turno em execução', () => {
        mocks.busy = true;

        const readiness = readTerminalExclusiveTtyReadiness(mocks.rl);

        expect(readiness.ready).toBe(false);
        expect(readiness.reasons).toContain('turno em execução');
    });

    it('permite ignorar render lock externo ao consultar prontidão dentro de comando', () => {
        beginTerminalRenderLock();
        try {
            const blocked = readTerminalExclusiveTtyReadiness(mocks.rl);
            const allowed = readTerminalExclusiveTtyReadiness(mocks.rl, { ignoreRenderLock: true });

            expect(blocked.reasons).toContain('renderização terminal em andamento');
            expect(allowed.reasons).not.toContain('renderização terminal em andamento');
            expect(allowed.ready).toBe(true);
        } finally {
            endTerminalRenderLock();
        }
    });

    it('pausa readline, executa operação exclusiva e restaura prompt vivo', async () => {
        const result = await withTerminalExclusiveTty(mocks.rl, async () => 'selecionado');

        expect(result.ok).toBe(true);
        expect(result.value).toBe('selecionado');
        expect(mocks.rl.pause).toHaveBeenCalledTimes(1);
        expect(mocks.rl.resume).toHaveBeenCalledTimes(1);
        expect(mocks.rl.setPrompt).toHaveBeenCalledWith('você› ');
        expect(mocks.rl.prompt).toHaveBeenCalled();
    });
});
