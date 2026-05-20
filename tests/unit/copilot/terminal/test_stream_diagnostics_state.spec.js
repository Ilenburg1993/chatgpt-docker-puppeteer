// @ts-check

import { beforeEach, describe, expect, it } from 'vitest';
import {
    clearTerminalStreamDiagnosticsForTests,
    readTerminalStreamDiagnosticsProjection,
    recordTerminalFinalReconciliationDiagnostic,
    recordTerminalStreamDeltaDiagnostic,
} from '../../../../src/copilot/terminal/state/stream-diagnostics-state.js';

describe('terminal stream diagnostics state', () => {
    beforeEach(() => {
        clearTerminalStreamDiagnosticsForTests();
    });

    it('contabiliza decisões de delta aceitas, normalizadas e suprimidas', () => {
        recordTerminalStreamDeltaDiagnostic({
            action: 'accepted',
            reason: 'raw',
            source: 'dialog.delta',
            causalKey: 'stream:s1:1',
            rawChars: 3,
            normalizedChars: 3,
        });
        recordTerminalStreamDeltaDiagnostic({
            action: 'normalized',
            reason: 'cumulative_snapshot',
            source: 'dialog.delta',
            rawChars: 8,
            normalizedChars: 5,
        });
        recordTerminalStreamDeltaDiagnostic({
            action: 'suppressed',
            reason: 'temporal_cross_channel',
            source: 'task.delta',
            rawChars: 8,
            normalizedChars: 0,
        });

        const projection = readTerminalStreamDiagnosticsProjection(5);

        expect(projection.counters.deltaAccepted).toBe(1);
        expect(projection.counters.deltaCausalAccepted).toBe(1);
        expect(projection.counters.deltaNormalized).toBe(1);
        expect(projection.counters.deltaCumulativeNormalized).toBe(1);
        expect(projection.counters.deltaSuppressed).toBe(1);
        expect(projection.counters.deltaTemporalFallbackSuppressed).toBe(1);
        expect(projection.totals.deltaDecisions).toBe(3);
        expect(projection.recent.map((entry) => entry.kind)).toEqual(['delta', 'delta', 'delta']);
    });

    it('contabiliza reconciliação final sem misturar com deltas públicos', () => {
        recordTerminalFinalReconciliationDiagnostic({
            mode: 'suffix',
            reason: 'stream_suffix',
            streamedChars: 10,
            streamingVisibleChars: 10,
            finalChars: 15,
            renderedChars: 5,
        });
        recordTerminalFinalReconciliationDiagnostic({
            mode: 'full',
            reason: 'stream_mismatch',
            streamedChars: 10,
            streamingVisibleChars: 10,
            finalChars: 12,
            renderedChars: 12,
            severity: 'warn',
        });

        const projection = readTerminalStreamDiagnosticsProjection(5);

        expect(projection.counters.finalSuffix).toBe(1);
        expect(projection.counters.finalMismatch).toBe(1);
        expect(projection.totals.finalDecisions).toBe(2);
        expect(projection.recent[0]).toMatchObject({ kind: 'final', reason: 'stream_mismatch', severity: 'warn' });
    });
});
