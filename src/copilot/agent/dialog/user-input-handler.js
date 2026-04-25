// @ts-check
/**
 * src/copilot/agent/dialog/user-input-handler.js
 *
 * Handlers de input do usuário extraídos do AlwaysAliveAgent.
 *
 * Recebem callbacks via `ctx` para evitar dependência de campos privados.
 *
 * @module copilot/agent/dialog/user-input-handler
 * @see EventBus
 */

import { EMITTER_QUESTION_PENDING } from '#copilot/events';
import { DialogProtocol } from '../../dialog/protocol.js';
import { persistStateWithPolicy } from '../lifecycle/state-io.js';
import { log } from '../ports/observability-port.js';

const REPLY_PROTOCOL_CONTINUE =
    'CONTINUE_DIALOG_LOOP: resposta entregue ao usuario; chame ask_user("READY: aguardando próxima mensagem") agora.';

/**
 * @typedef {import('../types.js').PendingQuestion} PendingQuestion
 *
 * @typedef {import('../types.js').PendingQuestionKind} PendingQuestionKind
 */

/**
 * Callbacks injetados pelo AlwaysAliveAgent para operações que dependem de estado privado.
 *
 * @typedef {Object} UserInputContext
 * @property {() => boolean} isDialogLoopActive - true se dialog loop está ativo
 * @property {(question: string) => boolean} [shouldHandleProtocolInput] - permite tratar READY/REPLY/STOPPED como
 *   protocolo mesmo durante recovery, quando o loop ainda esta anexado mas o flag `active` ficou defasado
 * @property {(input: { question: string }) => void} handleProtocolInput - DLM.handleProtocolInput
 * @property {(status: import('../types.js').AgentStatus) => void} setStatus - #setStatus
 * @property {(pq: PendingQuestion | null) => void} setPendingQuestion - #pendingQuestion setter
 * @property {(task: Promise<unknown>, meta?: { label?: string; description?: string }) => Promise<void>} [trackBackgroundTask]
 *   - Tracker opcional para writes fire-and-forget
 *
 * @property {(event: string, payload?: unknown) => boolean} emit — EventEmitter.emit
 */

/**
 * @param {UserInputContext} ctx
 * @param {Promise<unknown>} task
 * @param {{ label?: string; description?: string }} meta
 * @returns {void}
 */
function trackBackgroundTask(ctx, task, meta) {
    if (typeof ctx.trackBackgroundTask === 'function') {
        void ctx.trackBackgroundTask(task, meta);
        return;
    }
    void task.catch((error) =>
        log(
            'WARN',
            `[AlwaysAlive] Background task ${meta.label ?? 'unknown'} falhou: ${error instanceof Error ? error.message : String(error)}`,
        ),
    );
}

/**
 * Persiste snapshot parcial do user-input usando a policy canônica do `agent`.
 *
 * @param {UserInputContext} ctx
 * @param {Record<string, unknown>} data
 * @param {{ label?: string; description?: string }} meta
 * @returns {void}
 */
function trackPersistedUserInputState(ctx, data, meta) {
    const policyOpts = meta.label !== undefined ? { label: meta.label } : {};
    const task = persistStateWithPolicy(data, policyOpts).then((result) => {
        if (!result.ok) {
            throw result.error;
        }
        return undefined;
    });
    trackBackgroundTask(ctx, task, meta);
}

/**
 * @param {PendingQuestionKind} kind
 * @returns {boolean}
 */
function shouldPersistPendingQuestion(kind) {
    return kind === 'question' || kind === 'ready';
}

/**
 * @param {{
 *     kind: PendingQuestionKind;
 *     askedAt: number;
 *     allowFreeform: boolean;
 *     choices?: string[];
 * }} input
 * @returns {import('../types.js').PendingQuestionMeta}
 */
function buildPendingQuestionMeta({ kind, askedAt, allowFreeform, choices }) {
    return {
        kind,
        askedAt,
        allowFreeform,
        protocolControlled: kind !== 'question',
        ...(choices !== undefined ? { choices } : {}),
    };
}

/**
 * Handler principal chamado pelo SDK quando o modelo usa `ask_user`.
 *
 * Delega para o handler especializado conforme o modo ativo:
 *
 * - Dialog loop ativo → intercepta protocolo READY/REPLY/STOPPED via DLM
 * - Caso contrário → suspende até `answerPendingQuestion()` via API HTTP
 *
 * @param {{ question: string; choices?: string[]; allowFreeform: boolean }} input
 * @param {UserInputContext} ctx
 * @returns {Promise<{ answer: string; wasFreeform: boolean }>}
 */
export async function handleUserInputRequest({ question, choices, allowFreeform }, ctx) {
    log('INFO', `[AlwaysAlive] Modelo tem pergunta: "${question.slice(0, 120)}"`);

    const shouldHandleProtocol =
        typeof ctx.shouldHandleProtocolInput === 'function'
            ? ctx.shouldHandleProtocolInput(question)
            : ctx.isDialogLoopActive();

    if (shouldHandleProtocol) {
        return handleDialogLoopInput({ question, allowFreeform }, ctx);
    }
    return handleInteractiveQuestion({ question, ...(choices !== undefined && { choices }), allowFreeform }, ctx);
}

/**
 * Handler de protocolo no modo dialog loop.
 *
 * Propaga a classificação READY/REPLY/STOPPED ao DialogLoopManager e suspende a execução aguardando
 * `answerPendingQuestion()`.
 *
 * F44.3 (BUG-SD-004) fix: para mensagens de protocolo (READY/REPLY), pula a persistência de `pendingQuestion` para
 * evitar I/O desnecessário em cada turno do dialog loop.
 *
 * @param {{ question: string; allowFreeform: boolean }} input
 * @param {UserInputContext} ctx
 * @returns {Promise<{ answer: string; wasFreeform: boolean }>}
 */
function handleDialogLoopInput({ question, allowFreeform }, ctx) {
    const kind = DialogProtocol.classify(question);
    ctx.handleProtocolInput({ question });

    if (kind === 'reply') {
        return Promise.resolve({ answer: REPLY_PROTOCOL_CONTINUE, wasFreeform: false });
    }

    if (kind === 'stopped') {
        return Promise.resolve({ answer: '', wasFreeform: false });
    }

    return handleInteractiveQuestion({ question, allowFreeform, kind }, ctx);
}

/**
 * Handler para pergunta interativa normal (fora do dialog loop).
 *
 * Suspende a execução até que `answerPendingQuestion()` seja chamado via API HTTP. Define `status='waiting_for_input'`
 * e persiste a pergunta no estado para recovery.
 *
 * @param {{ question: string; choices?: string[]; allowFreeform: boolean; kind?: PendingQuestionKind }} input
 * @param {UserInputContext} ctx
 * @returns {Promise<{ answer: string; wasFreeform: boolean }>}
 */
function handleInteractiveQuestion({ question, choices, allowFreeform, kind = 'question' }, ctx) {
    ctx.setStatus('waiting_for_input');
    const askedAt = Date.now();
    const questionKind = kind;

    return new Promise((resolve) => {
        /** @type {PendingQuestion} */
        const pq = {
            question,
            allowFreeform,
            askedAt,
            kind: questionKind,
            protocolControlled: questionKind !== 'question',
            ...(choices !== undefined && { choices }),
            resolve: (/** @type {string} */ answer) => {
                ctx.setStatus('processing');
                resolve({ answer, wasFreeform: true });
            },
        };
        ctx.setPendingQuestion(pq);
        // Persistimos perguntas normais e estados READY do dialog loop com metadados semânticos.
        // REPLY/STOPPED seguem em memória apenas para não gerar I/O redundante a cada turno.
        if (shouldPersistPendingQuestion(questionKind)) {
            trackPersistedUserInputState(
                ctx,
                {
                    pendingQuestion: question,
                    pendingQuestionMeta: buildPendingQuestionMeta({
                        kind: questionKind,
                        askedAt,
                        allowFreeform,
                        ...(choices !== undefined ? { choices } : {}),
                    }),
                    lastAskUserAt: askedAt,
                },
                {
                    label: 'question.persist.pending',
                    description: 'Persist pendingQuestion + pendingQuestionMeta + lastAskUserAt',
                },
            );
        }
        ctx.emit(EMITTER_QUESTION_PENDING, { question, choices, allowFreeform });
    });
}
