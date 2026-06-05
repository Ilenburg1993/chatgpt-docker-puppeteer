// @ts-check

import { describe, expect, it } from 'vitest';

import {
    isTerminalImplicitOperationalTrace,
    renderTerminalTraceFlowSummary,
    renderTerminalTraceSummaryTitle,
} from '../../../../src/copilot/terminal/events/index.js';

describe('terminal/events/turn-trace-presentation', () => {
    it('classifica trace implícito de I/O como atividade operacional', () => {
        const trace = { traceId: 'implicit:123', turnId: null, source: 'implicit' };

        expect(isTerminalImplicitOperationalTrace(trace)).toBe(true);
        expect(renderTerminalTraceSummaryTitle('Turno observado', 'Atividade operacional observada', trace)).toBe(
            'Atividade operacional observada',
        );
        expect(renderTerminalTraceFlowSummary('turno em andamento com eventos live', trace)).toBe(
            'atividade em andamento com eventos live',
        );
    });

    it('preserva títulos de turnos conversacionais reais', () => {
        const trace = { traceId: 'turn:42', turnId: '42', source: 'assistant' };

        expect(isTerminalImplicitOperationalTrace(trace)).toBe(false);
        expect(renderTerminalTraceSummaryTitle('Turno observado', 'Atividade operacional observada', trace)).toBe(
            'Turno observado',
        );
        expect(renderTerminalTraceFlowSummary('turno em andamento com eventos live', trace)).toBe(
            'turno em andamento com eventos live',
        );
    });
});

