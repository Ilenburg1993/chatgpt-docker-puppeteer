// @ts-check
/**
 * Classificacao pura de turnos sem transcript publico materializado.
 *
 * O engine do terminal decide efeitos colaterais (activity, SSE, health). Este modulo decide apenas a semantica:
 * pergunta humana pendente, outcome nao textual aceitavel ou falha real de saida publica.
 *
 * @module copilot/terminal/dialog/empty-output-diagnosis
 */

/**
 * @param {number | null | undefined} value
 * @returns {number}
 */
function safeCounter(value) {
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * @param {{
 *     runtimeStatus?: string | null;
 *     pendingQuestionPresent?: boolean;
 *     pendingQuestionKind?: string | null;
 *     semanticOutcome?: string | null;
 *     semanticDiagnostics?: {
 *         pendingHumanInput?: boolean;
 *         pendingProtocolKind?: string | null;
 *     } | null;
 * }} input
 * @returns {boolean}
 */
export function hasTerminalPendingHumanInputOutcome(input) {
    if (input.semanticOutcome === 'pending_human_input') return true;
    if (input.semanticDiagnostics?.pendingHumanInput === true) return true;
    return (
        input.runtimeStatus === 'waiting_for_input' &&
        input.pendingQuestionPresent === true &&
        input.pendingQuestionKind !== 'ready'
    );
}

/**
 * @param {{
 *     semanticOutcome?: string | null;
 *     semanticReplySource?: string | null;
 *     semanticDiagnostics?: {
 *         assistantMessageCount?: number;
 *         deltaChars?: number;
 *         pendingProtocolKind?: string | null;
 *         toolSignalCount?: number;
 *     } | null;
 *     materialization: {
 *         diagnostics: {
 *             assistantMessageCount?: number;
 *             deltaChars?: number;
 *             deltaSlices?: number;
 *         };
 *     };
 *     quiescence?: { settledBy: string; waitedMs: number } | null;
 * }} input
 * @returns {{
 *     cause: string;
 *     evidence: string;
 *     action: string;
 *     operatorSummary: string;
 * }}
 */
export function buildTerminalEmptyOutputDiagnosis(input) {
    const diagnostics = input.semanticDiagnostics;
    const assistantMessages = safeCounter(
        diagnostics?.assistantMessageCount ?? input.materialization.diagnostics.assistantMessageCount,
    );
    const toolSignals = safeCounter(diagnostics?.toolSignalCount);
    const deltaChars = safeCounter(diagnostics?.deltaChars ?? input.materialization.diagnostics.deltaChars);
    const deltaSlices = safeCounter(input.materialization.diagnostics.deltaSlices);
    const pendingProtocol = diagnostics?.pendingProtocolKind ?? null;
    const outcome = input.semanticOutcome ?? 'empty';
    const source = input.semanticReplySource ?? 'n/d';
    let cause = 'modelo encerrou o turno sem texto público nem protocolo de continuidade';
    let action = 'reenvie, peça síntese curta ou troque rota/modelo se repetir';

    if (pendingProtocol) {
        cause = `protocolo avançou para ${pendingProtocol}, mas sem resposta pública renderizável`;
        action = '/activity 40 · /events 60 para confirmar o estado protocolar';
    } else if (toolSignals > 0) {
        cause = 'tools foram observadas, mas nenhuma síntese pública chegou ao terminal';
        action = 'peça uma síntese pública antes de repetir ações com efeito colateral';
    } else if (assistantMessages > 0) {
        cause = 'o SDK sinalizou mensagem final, mas ela não virou transcript visível';
        action = '/events event=assistant.message · /export para comparar materialização';
    } else if (deltaChars > 0 || deltaSlices > 0) {
        cause = 'deltas foram observados, mas não formaram resposta pública final';
        action = '/activity detail · /events event=assistant.message_delta para comparar streaming';
    }

    const evidenceParts = [
        `resultado ${outcome}`,
        `origem ${source}`,
        `tools ${toolSignals}`,
        `deltas ${deltaSlices}/${deltaChars} caracteres`,
        `mensagens ${assistantMessages}`,
        input.quiescence ? `quiescência ${input.quiescence.settledBy}/${input.quiescence.waitedMs}ms` : null,
    ].filter(Boolean);
    const evidence = evidenceParts.join(' · ');
    return {
        cause,
        evidence,
        action,
        operatorSummary: `${cause} · ${evidence}`,
    };
}

/**
 * @param {{
 *     materializationSource?: string | null;
 *     runtimeStatus?: string | null;
 *     pendingQuestionPresent?: boolean;
 *     pendingQuestionKind?: string | null;
 *     semanticOutcome?: string | null;
 *     semanticDiagnostics?: {
 *         pendingHumanInput?: boolean;
 *         pendingProtocolKind?: string | null;
 *     } | null;
 * }} input
 * @returns {{
 *     kind: 'not_empty' | 'pending_human_input' | 'tool_only' | 'protocol_transition' | 'empty_failure';
 *     semanticOutcome: string;
 *     expectedPendingInput: boolean;
 *     emptyOutputFailure: boolean;
 * }}
 */
export function classifyTerminalEmptyOutput(input) {
    const semanticOutcome = input.semanticOutcome ?? 'empty';
    if (input.materializationSource !== 'empty') {
        return {
            kind: 'not_empty',
            semanticOutcome,
            expectedPendingInput: false,
            emptyOutputFailure: false,
        };
    }
    if (hasTerminalPendingHumanInputOutcome(input)) {
        return {
            kind: 'pending_human_input',
            semanticOutcome,
            expectedPendingInput: true,
            emptyOutputFailure: false,
        };
    }
    if (semanticOutcome === 'tool_only') {
        return {
            kind: 'tool_only',
            semanticOutcome,
            expectedPendingInput: false,
            emptyOutputFailure: false,
        };
    }
    if (semanticOutcome === 'protocol_transition') {
        return {
            kind: 'protocol_transition',
            semanticOutcome,
            expectedPendingInput: false,
            emptyOutputFailure: false,
        };
    }
    return {
        kind: 'empty_failure',
        semanticOutcome,
        expectedPendingInput: false,
        emptyOutputFailure: true,
    };
}
