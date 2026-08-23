// @ts-check
/**
 * Núcleo canônico de user input / ask_user para a arquitetura 2.0/2.1.
 *
 * Responsabilidades:
 *
 * - prover factories de `onUserInputRequest` fora de `hooks/`;
 * - normalizar eventos `user_input.requested` / `user_input.completed` em contrato estável;
 * - manter a política de hooks fora do SDK, delegando para este núcleo quando precisar de user input.
 *
 * @module copilot/sdk/session/user-input
 */

import { createInterface } from 'node:readline';
import { ToolSessionContext } from './tool-session-context.js';
import { normalizeUserInputChoices, resolveEffectiveUserInputAllowFreeform } from './user-input-policy.js';

/**
 * @typedef {import('../types.js').UserInputHandler} UserInputHandler
 *
 * @typedef {import('../types.js').UserInputRequest} UserInputRequest
 *
 * @typedef {import('../types.js').UserInputResponse} UserInputResponse
 *
 * @typedef {object} StructuredInputRequestSnapshot
 * @property {string} requestId
 * @property {string} question
 * @property {string[]} choices
 * @property {boolean} allowFreeform
 * @property {number} createdAt
 * @property {string | null} sessionId
 * @property {string | null} toolCallId
 * @property {Record<string, unknown>} data
 */

/** @typedef {'question' | 'ready' | 'reply' | 'stopped'} UserInputQuestionKind */

/**
 * Resolver de input estruturado (`request_user_input`) — unificado ao núcleo canônico de user-input do SDK.
 *
 * @typedef {(answer: string) => void} StructuredUserInputResolver
 */

/**
 * `ToolSessionContext` default — substitui os singletons globais anteriores. Pode ser sobrescrito via
 * `configureDefaultUserInputContext()` no bootstrap para unificar o estado de input com o agente principal (LLM-B).
 *
 * @type {ToolSessionContext}
 */
let _defaultCtx = new ToolSessionContext({ sessionId: 'default' });

/**
 * Injeta um `ToolSessionContext` como context canônico default para este módulo. Deve ser chamado no bootstrap logo
 * após o agente ser criado, antes de qualquer chamada a `request_user_input`.
 *
 * @param {ToolSessionContext} ctx
 * @returns {void}
 */
export function configureDefaultUserInputContext(ctx) {
    if (ctx instanceof ToolSessionContext) {
        _defaultCtx = ctx;
    }
}

/**
 * @typedef {object} InteractiveInputOptions
 * @property {NodeJS.ReadableStream} [input]
 * @property {NodeJS.WritableStream} [output]
 * @property {string} [prompt]
 */

/**
 * @param {unknown} value
 * @returns {Record<string, unknown> | null}
 */
function objectOrNull(value) {
    return value && typeof value === 'object' ? /** @type {Record<string, unknown>} */ (value) : null;
}

/**
 * @param {unknown} value
 * @param {string} fallback
 * @returns {string}
 */
function stringOr(value, fallback) {
    return typeof value === 'string' && value.trim().length > 0 ? value : fallback;
}

/**
 * @param {unknown} value
 * @returns {string[]}
 */
function arrayOfStrings(value) {
    return normalizeUserInputChoices(value);
}

/**
 * @param {unknown} value
 * @returns {number}
 */
function tsOrNow(value) {
    return typeof value === 'number' && Number.isFinite(value) ? value : Date.now();
}

/**
 * Stable bridge payload for structured user input.
 * @param {{requestId:string;question:string;choices?:unknown;allowFreeform?:boolean}} input
 */
export function normalizeUserInputBridgeContract(input) {
    const requestId = String(input.requestId ?? '').trim();
    const question = String(input.question ?? '').trim();
    if (!requestId) throw new TypeError('user-input requestId é obrigatório.');
    if (!question) throw new TypeError('user-input question é obrigatória.');
    return {
        requestId,
        question,
        choices: normalizeUserInputChoices(input.choices),
        allowFreeform: resolveEffectiveUserInputAllowFreeform(input.allowFreeform),
    };
}

/**
 * Classifica a pergunta do `ask_user` no mesmo protocolo semântico usado pelo dialog loop.
 *
 * Mantém o contrato canônico em SDK-first para consumers de terminal/event-handlers sem parsing ad-hoc.
 *
 * @param {string} question
 * @returns {UserInputQuestionKind}
 */
export function classifyUserInputQuestionKind(question) {
    const trimmed = question.trim();
    if (/^READY(?::|$)/i.test(trimmed)) {
        return 'ready';
    }
    if (/^(REPLY:|DONE:)/i.test(trimmed)) {
        return 'reply';
    }
    if (/^(STOPPED|STOP_DIALOG)$/i.test(trimmed)) {
        return 'stopped';
    }
    return 'question';
}

/**
 * @param {unknown} eventOrData
 * @returns {{
 *     requestId: string | null;
 *     runtimeId: string | null;
 *     question: string;
 *     choices: string[];
 *     allowFreeform: boolean;
 *     toolCallId: string | null;
 *     data: Record<string, unknown>;
 *     ts: number;
 * }}
 */
export function normalizeUserInputRequestedEvent(eventOrData) {
    const root = objectOrNull(eventOrData) ?? {};
    const data = objectOrNull(root['data']) ?? {};
    const payload = Object.keys(data).length > 0 ? data : root;
    return {
        requestId: stringOr(payload['requestId'], '') || null,
        runtimeId:
            stringOr(root['runtimeId'], '') ||
            stringOr(root['sourceRuntime'], '') ||
            stringOr(payload['runtimeId'], '') ||
            stringOr(payload['sourceRuntime'], '') ||
            null,
        question: stringOr(payload['question'], ''),
        choices: arrayOfStrings(payload['choices']),
        allowFreeform: resolveEffectiveUserInputAllowFreeform(payload['allowFreeform']),
        toolCallId: stringOr(payload['toolCallId'], '') || null,
        data: payload,
        ts: tsOrNow(root['timestamp'] ?? root['ts'] ?? payload['ts']),
    };
}

/**
 * @param {unknown} eventOrData
 * @returns {{
 *     requestId: string | null;
 *     runtimeId: string | null;
 *     answer: string;
 *     wasFreeform: boolean | null;
 *     data: Record<string, unknown>;
 *     ts: number;
 * }}
 */
export function normalizeUserInputCompletedEvent(eventOrData) {
    const root = objectOrNull(eventOrData) ?? {};
    const data = objectOrNull(root['data']) ?? {};
    const payload = Object.keys(data).length > 0 ? data : root;
    return {
        requestId: stringOr(payload['requestId'], '') || null,
        runtimeId:
            stringOr(root['runtimeId'], '') ||
            stringOr(root['sourceRuntime'], '') ||
            stringOr(payload['runtimeId'], '') ||
            stringOr(payload['sourceRuntime'], '') ||
            null,
        answer: stringOr(payload['answer'], ''),
        wasFreeform: typeof payload['wasFreeform'] === 'boolean' ? payload['wasFreeform'] : null,
        data: payload,
        ts: tsOrNow(root['timestamp'] ?? root['ts'] ?? payload['ts']),
    };
}

/**
 * @param {InteractiveInputOptions} [opts]
 * @returns {UserInputHandler}
 */
export function createReadlineInputHandler(opts = {}) {
    const { input = process.stdin, output = process.stdout, prompt = '→ ' } = opts;

    return async function onUserInputRequest(request) {
        const rl = createInterface({ input, output, terminal: true });

        const question = request.question ?? '';
        const choices = normalizeUserInputChoices(request.choices ?? []);
        const allowFreeform = resolveEffectiveUserInputAllowFreeform(request.allowFreeform);

        let displayText = `\nPergunta ao operador: ${question || 'Aguardando resposta do operador'}`;
        if (choices.length > 0) {
            displayText += `\nOpções: ${choices.map((c, i) => `[${i + 1}] ${c}`).join(' | ')}`;
        }
        if (allowFreeform) {
            displayText += choices.length > 0 ? '\nTexto livre também aceito' : '\nDigite sua resposta';
        }
        displayText += `\n${prompt}`;

        return new Promise((resolve) => {
            rl.question(displayText, (answer) => {
                rl.close();
                const idx = parseInt(answer.trim(), 10);
                if (!Number.isNaN(idx) && idx >= 1 && idx <= choices.length) {
                    resolve({ answer: choices[idx - 1] ?? '', wasFreeform: false });
                } else {
                    resolve({ answer: answer.trim(), wasFreeform: true });
                }
            });
        });
    };
}

/**
 * @param {{ maxSize?: number }} [opts]
 * @returns {{
 *     handler: UserInputHandler;
 *     answerNext: (response: UserInputResponse) => boolean;
 *     listPending: () => UserInputRequest[];
 * }}
 */
export function createQueuedInputHandler({ maxSize = 100 } = {}) {
    /** @type {{ resolve: (r: UserInputResponse) => void; request: UserInputRequest }[]} */
    const queue = [];

    /**
     * @param {UserInputRequest} request
     * @returns {Promise<UserInputResponse>}
     */
    const handler = async (request) => {
        if (queue.length >= maxSize) {
            return { answer: '', wasFreeform: false };
        }
        return new Promise((/** @type {(value: UserInputResponse) => void} */ resolve) => {
            queue.push({ resolve, request });
        });
    };

    /**
     * @param {UserInputResponse} response
     * @returns {boolean}
     */
    function answerNext(response) {
        const pending = queue.shift();
        if (!pending) return false;
        pending.resolve(response);
        return true;
    }

    function listPending() {
        return queue.map((q) => q.request);
    }

    return { handler, answerNext, listPending };
}

/**
 * @param {Record<string, string>} answers
 * @param {string} [defaultAnswer]
 * @returns {UserInputHandler}
 */
export function createStaticInputHandler(answers, defaultAnswer = '') {
    return async function onUserInputRequest(request) {
        const q = (request.question ?? '').toLowerCase();
        for (const [pattern, answer] of Object.entries(answers)) {
            if (q.includes(pattern.toLowerCase())) {
                return { answer, wasFreeform: false };
            }
        }
        return { answer: defaultAnswer, wasFreeform: true };
    };
}

/**
 * Gera um ID canônico para requests de input estruturado.
 *
 * @returns {string}
 */
export function nextStructuredUserInputRequestId() {
    return _defaultCtx.nextStructuredInputId();
}

/**
 * Registra um resolver pendente para `request_user_input`.
 *
 * @param {string} requestId
 * @param {StructuredUserInputResolver} resolve
 * @param {Partial<Omit<StructuredInputRequestSnapshot, 'requestId' | 'sessionId'>>} [request]
 * @returns {void}
 */
export function registerPendingStructuredUserInputResolver(requestId, resolve, request = {}) {
    _defaultCtx.registerPendingInput(requestId, resolve, request);
}

/**
 * Remove um resolver pendente pelo ID.
 *
 * @param {string} requestId
 * @returns {boolean}
 */
export function deletePendingStructuredUserInputResolver(requestId) {
    return _defaultCtx.deletePendingInput(requestId);
}

/**
 * Resolve um pending input estruturado específico, ou o mais antigo se `requestId` for omitido.
 *
 * @param {string} answer
 * @param {string | undefined} [requestId]
 * @returns {boolean}
 */
export function resolvePendingStructuredUserInput(answer, requestId) {
    return _defaultCtx.resolveStructuredInput(answer, requestId);
}

/**
 * @returns {string[]}
 */
export function getPendingStructuredUserInputIds() {
    return _defaultCtx.getPendingInputIds();
}

/**
 * @returns {StructuredInputRequestSnapshot[]}
 */
export function getPendingStructuredUserInputRequests() {
    return _defaultCtx.getPendingInputRequests();
}

/**
 * @returns {number}
 */
export function getPendingStructuredUserInputCount() {
    return _defaultCtx.getPendingInputCount();
}

/**
 * @returns {boolean}
 */
export function hasPendingStructuredUserInputRequests() {
    return _defaultCtx.hasPendingInputs();
}

/**
 * Cancela (resolve) todos os requests pendentes com a mesma resposta padrão.
 *
 * @param {string} answer
 * @returns {number}
 */
export function cancelAllPendingStructuredUserInput(answer) {
    return _defaultCtx.cancelAllPendingInput(answer);
}
