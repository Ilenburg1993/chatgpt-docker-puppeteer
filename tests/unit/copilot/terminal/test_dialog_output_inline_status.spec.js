// @ts-check

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    beginTerminalTurnMaterialization,
    clearTerminalTurnMaterialization,
} from '../../../../src/copilot/terminal/state/turn-materialization-state.js';

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
    clearReservedInlineStatus,
    deferTerminalIdlePromptRedraw,
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
        clearTerminalTurnMaterialization();
    });

    afterEach(() => {
        clearTerminalTurnMaterialization();
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

    it('normaliza ids e tools internas antes de reservar a linha viva', () => {
        writeInlineStatus(
            'request_user_input ainda executando · report_intent_local · chatcmpl-tool-80d5a00b25801fef',
        );

        const output = writeSpy.mock.calls.map(([chunk]) => String(chunk)).join('');
        expect(output).toContain('Pergunta ao operador aguardando resposta');
        expect(output).toContain('Intenção capturada');
        expect(output).not.toContain('request_user_input');
        expect(output).not.toContain('report_intent');
        expect(output).not.toContain('chatcmpl-tool');
    });

    it('não limpa a linha do prompt quando não há linha viva reservada', () => {
        clearReservedInlineStatus();

        const output = writeSpy.mock.calls.map(([chunk]) => String(chunk)).join('');
        expect(output).toBe('');
    });

    it('limpa apenas a linha viva reservada no submit do readline', () => {
        writeInlineStatus('LLM-B pensando · carregando contexto');
        writeSpy.mockClear();

        clearReservedInlineStatus();

        const output = writeSpy.mock.calls.map(([chunk]) => String(chunk)).join('');
        expect(output).toContain('\x1b[s');
        expect(output).toContain('\x1b[K');
        expect(output).not.toBe('\x1b[2K\r');

        writeSpy.mockClear();
        clearReservedInlineStatus();
        expect(writeSpy).not.toHaveBeenCalled();
    });

    it('deduplica pulso visual idêntico em sequência curta', () => {
        writeInlineStatus('LLM-B pensando · 10s sem resposta pública');
        const writesAfterFirstPulse = writeSpy.mock.calls.length;

        writeInlineStatus('LLM-B pensando · 10s sem resposta pública');

        expect(writeSpy.mock.calls.length).toBe(writesAfterFirstPulse);
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

    it('permite repaint forçado de prompt idêntico após comando explícito rápido', async () => {
        const rl = {
            closed: false,
            line: '',
            setPrompt: vi.fn(),
            prompt: vi.fn(),
        };

        scheduleTerminalPromptRedraw(rl, 'você› ');
        await new Promise((resolve) => setImmediate(resolve));

        scheduleTerminalPromptRedraw(rl, 'você› ', { force: true });
        await new Promise((resolve) => setImmediate(resolve));

        expect(rl.setPrompt).toHaveBeenCalledTimes(2);
        expect(rl.prompt).toHaveBeenCalledTimes(2);
    });

    it('adia prompt idle pós-turno, mas não bloqueia repaint forçado de comando', async () => {
        const rl = {
            closed: false,
            line: '',
            setPrompt: vi.fn(),
            prompt: vi.fn(),
        };

        deferTerminalIdlePromptRedraw(30);
        scheduleTerminalPromptRedraw(rl, 'você› ');
        await new Promise((resolve) => setImmediate(resolve));

        expect(rl.setPrompt).not.toHaveBeenCalled();

        scheduleTerminalPromptRedraw(rl, 'você› ', { force: true });
        await new Promise((resolve) => setImmediate(resolve));

        expect(rl.setPrompt).toHaveBeenCalledTimes(1);
        expect(rl.prompt).toHaveBeenCalledTimes(1);
    });

    it('repaint forçado ignora linha stale de comando já aceito', async () => {
        const rl = {
            closed: false,
            line: '/usage now',
            setPrompt: vi.fn(),
            prompt: vi.fn(),
        };

        scheduleTerminalPromptRedraw(rl, 'você› ', { force: true });
        await new Promise((resolve) => setImmediate(resolve));

        expect(rl.setPrompt).toHaveBeenCalledWith('você› ');
        expect(rl.prompt).toHaveBeenCalledTimes(1);
    });

    it('estaciona prompt normal durante continuação sem repintar prompt extra', () => {
        parkTerminalPromptForContinuation(1_000);

        writeInlineStatus('LLM-B finalizando · 1s');

        const output = writeSpy.mock.calls.map(([chunk]) => String(chunk)).join('');
        expect(output).toContain('LLM-B finalizando');
        expect(mocks.rl.setPrompt).not.toHaveBeenCalled();
        expect(mocks.rl.prompt).not.toHaveBeenCalled();
    });

    it('suprime redraw normal durante handoff pós-resposta quando linha viva esta ativa', async () => {
        parkTerminalPromptForContinuation(1_000);

        scheduleTerminalPromptRedraw(mocks.rl, 'você› ');
        await new Promise((resolve) => setImmediate(resolve));

        expect(mocks.rl.setPrompt).not.toHaveBeenCalled();

        writeInlineStatus('LLM-B finalizando · 1s');

        expect(mocks.rl.setPrompt).not.toHaveBeenCalled();
        expect(mocks.rl.prompt).not.toHaveBeenCalled();
    });

    it('usa prompt de espera estacionado apenas quando linha viva esta desligada', () => {
        process.env['COPILOT_TERMINAL_INLINE_STATUS'] = 'off';
        parkTerminalPromptForContinuation(1_000);

        redrawTerminalPrompt(mocks.rl, 'você› ');

        expect(mocks.rl.setPrompt).toHaveBeenCalledWith(expect.stringContaining('LLM-B pensando'));
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

    it('não anuncia prompt pronto enquanto materialização de turno ainda está ativa', async () => {
        mocks.busy = false;
        beginTerminalTurnMaterialization({ turnId: 'turn-before-final-transcript', timestamp: 1_000 });

        printlnBlock(['Turno         2 ações · 1 arquivo']);
        scheduleTerminalPromptRedraw(mocks.rl, 'você› ');
        await new Promise((resolve) => setImmediate(resolve));

        const output = writeSpy.mock.calls.map(([chunk]) => String(chunk)).join('');
        expect(output).toContain('Turno         2 ações');
        expect(mocks.rl.setPrompt).not.toHaveBeenCalled();
        expect(mocks.rl.prompt).not.toHaveBeenCalled();
    });

    it('permite bloco durável sem redraw de prompt para handoff pós-resposta humana', () => {
        printlnBlock(['Resposta enviada para pergunta pendente.'], { redrawPrompt: false });

        const output = writeSpy.mock.calls.map(([chunk]) => String(chunk)).join('');
        expect(output).toContain('Resposta enviada para pergunta pendente.');
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
