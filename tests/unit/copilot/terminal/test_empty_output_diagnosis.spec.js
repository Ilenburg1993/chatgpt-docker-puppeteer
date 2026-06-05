// @ts-check

import { describe, expect, it } from 'vitest';

import {
    buildTerminalEmptyOutputDiagnosis,
    classifyTerminalEmptyOutput,
    hasTerminalPendingHumanInputOutcome,
} from '../../../../src/copilot/terminal/dialog/empty-output-diagnosis.js';

const EMPTY_MATERIALIZATION = Object.freeze({
    diagnostics: {
        assistantMessageCount: 0,
        deltaChars: 0,
        deltaSlices: 0,
    },
});

describe('terminal/dialog/empty-output-diagnosis', () => {
    it('não trata reply materializado como saída vazia', () => {
        expect(classifyTerminalEmptyOutput({ materializationSource: 'direct_reply' })).toEqual({
            kind: 'not_empty',
            semanticOutcome: 'empty',
            expectedPendingInput: false,
            emptyOutputFailure: false,
        });
    });

    it('classifica pergunta/formulário humano pendente como saída válida do turno', () => {
        expect(
            hasTerminalPendingHumanInputOutcome({
                runtimeStatus: 'waiting_for_input',
                pendingQuestionPresent: true,
                pendingQuestionKind: 'question',
            }),
        ).toBe(true);
        expect(
            classifyTerminalEmptyOutput({
                materializationSource: 'empty',
                runtimeStatus: 'waiting_for_input',
                pendingQuestionPresent: true,
                pendingQuestionKind: 'question',
            }),
        ).toEqual({
            kind: 'pending_human_input',
            semanticOutcome: 'empty',
            expectedPendingInput: true,
            emptyOutputFailure: false,
        });
    });

    it('não considera READY protocolar como pergunta humana pendente', () => {
        expect(
            hasTerminalPendingHumanInputOutcome({
                runtimeStatus: 'waiting_for_input',
                pendingQuestionPresent: true,
                pendingQuestionKind: 'ready',
            }),
        ).toBe(false);
    });

    it('separa tool-only e transição protocolar de falha real', () => {
        expect(
            classifyTerminalEmptyOutput({
                materializationSource: 'empty',
                semanticOutcome: 'tool_only',
            }),
        ).toEqual(expect.objectContaining({ kind: 'tool_only', emptyOutputFailure: false }));
        expect(
            classifyTerminalEmptyOutput({
                materializationSource: 'empty',
                semanticOutcome: 'protocol_transition',
            }),
        ).toEqual(expect.objectContaining({ kind: 'protocol_transition', emptyOutputFailure: false }));
        expect(
            classifyTerminalEmptyOutput({
                materializationSource: 'empty',
                semanticOutcome: 'empty',
            }),
        ).toEqual(expect.objectContaining({ kind: 'empty_failure', emptyOutputFailure: true }));
    });

    it('gera causa acionável para tools sem síntese pública', () => {
        const diagnosis = buildTerminalEmptyOutputDiagnosis({
            semanticOutcome: 'empty',
            semanticReplySource: 'direct_dispatch',
            semanticDiagnostics: {
                toolSignalCount: 2,
            },
            materialization: EMPTY_MATERIALIZATION,
            quiescence: { settledBy: 'timeout', waitedMs: 250 },
        });

        expect(diagnosis.cause).toBe('tools foram observadas, mas nenhuma síntese pública chegou ao terminal');
        expect(diagnosis.action).toContain('síntese pública');
        expect(diagnosis.evidence).toContain('tools 2');
        expect(diagnosis.evidence).toContain('quiescência timeout/250ms');
    });
});
