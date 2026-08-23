// @ts-check
/**
 * @module copilot/agent/dialog/seams/turn-execution-context
 * @file Seam para gerenciamento de contexto de execução de turno: lifecycle de listeners, inatividade, reply fallback
 *
 *   Extrai helpers de contexto e listeners da orquestração principal de turn-executor para isolamento semântico.
 */

import { AgentSessionError } from '#copilot/agent/errors';
import {
    EMITTER_ASSISTANT_MESSAGE,
    EMITTER_ASSISTANT_STREAMING_DELTA,
    EMITTER_ASSISTANT_TURN_END,
    EMITTER_DIALOG_DELTA,
    EMITTER_ELICITATION_COMPLETED,
    EMITTER_ELICITATION_PENDING,
    EMITTER_PERMISSION_COMPLETED,
    EMITTER_PERMISSION_REQUESTED,
    EMITTER_TASK_DELTA,
    EMITTER_TASK_REASONING,
    EMITTER_TOOL_EXECUTION_PROGRESS,
    EMITTER_USER_INPUT_COMPLETED,
    EMITTER_USER_INPUT_REQUESTED,
} from '#copilot/events';
import { log } from '../../ports/logging/index.js';

// Limite de fallback: máximo de caracteres aceitos do delta agregado para reply fallback.
const MAX_DELTA_FALLBACK_CHARS = 50_000;

const HUMAN_WAIT_START_EVENTS = Object.freeze([
    { event: EMITTER_USER_INPUT_REQUESTED, bucket: 'user_input' },
    { event: EMITTER_ELICITATION_PENDING, bucket: 'elicitation' },
    { event: EMITTER_PERMISSION_REQUESTED, bucket: 'permission' },
]);

const HUMAN_WAIT_END_EVENTS = Object.freeze([
    { event: EMITTER_USER_INPUT_COMPLETED, bucket: 'user_input' },
    { event: EMITTER_ELICITATION_COMPLETED, bucket: 'elicitation' },
    { event: EMITTER_PERMISSION_COMPLETED, bucket: 'permission' },
]);

/**
 * Cria um listener que aceita `unknown` e faz cast para o tipo esperado.
 *
 * @template T
 * @param {(evt: T) => void} fn
 * @returns {(evt: unknown) => void}
 */
export function castListener(fn) {
    return (evt) => fn(/** @type {T} */ (evt));
}

/**
 * @param {AbortSignal | undefined} signal
 * @param {() => void} listener
 * @returns {void}
 */
export function detachAbortListener(signal, listener) {
    signal?.removeEventListener?.('abort', listener);
}

/**
 * @param {string | undefined} [traceId]
 * @returns {string}
 */
export function traceLabel(traceId) {
    return traceId ? `trace=${traceId}` : 'trace=none';
}

/**
 * Cria um timeout de inatividade: o relógio reinicia quando o SDK/Agent demonstra progresso observável.
 *
 * Isso preserva a política 0 PR. Um turno lento mas vivo não é abortado só por ser longo; só falha quando fica mudo por
 * mais do que a janela calculada pela policy.
 *
 * @param {any} emitter
 * @param {{
 *     timeout: number | null;
 *     onTimeout: () => void;
 *     traceId?: string;
 *     phase: string;
 *     progressSources?: any[] | undefined;
 * }} opts
 *   Quando `timeout` é `null`, nenhum timer é criado — o watchdog do dialog loop torna-se o único guardião de stall.
 * @returns {{ timeoutHandle: ReturnType<typeof setTimeout> | null; clear: () => void }}
 */
export function createInactivityTimeout(emitter, opts) {
    /** @type {ReturnType<typeof setTimeout> | null} */
    let handle = null;
    let disposed = false;
    /** @type {Set<string>} */
    const activeHumanWaits = new Set();
    /**
     * @type {{
     *     source: { off?: (event: string, listener: (...args: any[]) => void) => void };
     *     event: string;
     *     listener: (...args: any[]) => void;
     * }[]}
     */
    const listeners = [];

    const detachProgressListeners = () => {
        for (const { source, event, listener } of listeners) {
            source.off?.(event, listener);
        }
        listeners.length = 0;
    };

    const arm = () => {
        if (opts.timeout === null) return;
        if (disposed) return;
        if (activeHumanWaits.size > 0) return;
        if (handle) clearTimeout(handle);
        handle = setTimeout(() => {
            if (disposed) return;
            disposed = true;
            handle = null;
            detachProgressListeners();
            opts.onTimeout();
        }, opts.timeout);
    };

    const onProgress = () => {
        if (disposed) return;
        arm();
    };

    /**
     * @param {string} bucket
     * @param {unknown} evt
     * @returns {string}
     */
    const humanWaitKey = (bucket, evt) => {
        const record = evt && typeof evt === 'object' ? /** @type {Record<string, unknown>} */ (evt) : {};
        const requestId =
            typeof record['requestId'] === 'string'
                ? record['requestId']
                : typeof record['id'] === 'string'
                  ? record['id']
                  : null;
        return requestId ? `${bucket}:${requestId}` : bucket;
    };

    /**
     * @param {string} bucket
     * @param {unknown} evt
     * @returns {void}
     */
    const onHumanWaitStart = (bucket, evt) => {
        if (disposed) return;
        activeHumanWaits.add(humanWaitKey(bucket, evt));
        if (handle) clearTimeout(handle);
        handle = null;
    };

    /**
     * @param {string} bucket
     * @param {unknown} evt
     * @returns {void}
     */
    const onHumanWaitEnd = (bucket, evt) => {
        if (disposed) return;
        const key = humanWaitKey(bucket, evt);
        if (activeHumanWaits.has(key)) {
            activeHumanWaits.delete(key);
        } else {
            for (const activeKey of [...activeHumanWaits]) {
                if (activeKey === bucket || activeKey.startsWith(`${bucket}:`)) {
                    activeHumanWaits.delete(activeKey);
                }
            }
        }
        arm();
    };

    const sources = [emitter, ...(opts.progressSources ?? [])];

    for (const event of [
        EMITTER_ASSISTANT_MESSAGE,
        EMITTER_ASSISTANT_STREAMING_DELTA,
        EMITTER_ASSISTANT_TURN_END,
        EMITTER_DIALOG_DELTA,
        EMITTER_TASK_DELTA,
        EMITTER_TASK_REASONING,
        EMITTER_TOOL_EXECUTION_PROGRESS,
    ]) {
        for (const source of sources) {
            if (typeof source?.on !== 'function' || typeof source?.off !== 'function') {
                continue;
            }
            listeners.push({ source, event, listener: onProgress });
            source.on(event, onProgress);
        }
    }

    for (const { event, bucket } of HUMAN_WAIT_START_EVENTS) {
        for (const source of sources) {
            if (typeof source?.on !== 'function' || typeof source?.off !== 'function') {
                continue;
            }
            const listener = (/** @type {unknown} */ evt) => onHumanWaitStart(bucket, evt);
            listeners.push({ source, event, listener });
            source.on(event, listener);
        }
    }

    for (const { event, bucket } of HUMAN_WAIT_END_EVENTS) {
        for (const source of sources) {
            if (typeof source?.on !== 'function' || typeof source?.off !== 'function') {
                continue;
            }
            const listener = (/** @type {unknown} */ evt) => onHumanWaitEnd(bucket, evt);
            listeners.push({ source, event, listener });
            source.on(event, listener);
        }
    }

    arm();
    const initialHandle = handle;
    if (initialHandle === null && opts.timeout !== null) {
        throw new AgentSessionError(
            '[DialogLoopManager] Falha ao armar timeout de inatividade.',
            'DIALOG_TIMEOUT_SETUP',
        );
    }

    return {
        timeoutHandle: initialHandle,
        clear: () => {
            if (disposed) return;
            disposed = true;
            if (handle) clearTimeout(handle);
            handle = null;
            detachProgressListeners();
        },
    };
}

/**
 * Fallback semântico para o caso em que o modelo responde por `assistant.message` em vez de `ask_user("REPLY: ...")`.
 *
 * Isso preserva a política 0-PR: o turno continua sendo resolvido sobre o mesmo `ask_user`/turn em andamento, sem
 * reinicializar o loop ou abrir nova sessão. O fallback só fica elegível depois que o input foi de fato despachado ao
 * host.
 *
 * @param {any} host
 * @param {{
 *     normalizeAssistantMessageEvent: (evt: unknown) => { content: string; ts: number | null };
 *     normalizeAssistantReplyCandidate: (content: string) => string | null;
 *     readPendingProtocolSnapshot: (
 *         host: any,
 *     ) => { kind: 'reply' | 'ready' | 'stopped'; question: string; reply?: string } | null;
 * }} helpers
 * @returns {{
 *     markDispatched: () => void;
 *     tryResolve: (
 *         turnStart: number,
 *         resolve: (reply: string) => void,
 *         finalizeReply: (turnStart: number, reply: string) => void,
 *     ) => boolean;
 *     cleanup: () => void;
 * }}
 */
export function createAssistantReplyFallback(host, helpers) {
    if (typeof host.on !== 'function' || typeof host.off !== 'function') {
        return {
            markDispatched: () => {},
            tryResolve: () => false,
            cleanup: () => {},
        };
    }

    let dispatched = false;
    /** @type {string | null} */
    let candidate = null;
    /** @type {string} */
    let deltaCandidate = '';

    const onAssistantMessage = (/** @type {unknown} */ evt) => {
        if (!dispatched) return;
        const { content } = helpers.normalizeAssistantMessageEvent(evt);
        const normalized = helpers.normalizeAssistantReplyCandidate(content);
        if (normalized) {
            candidate = normalized;
        }
    };

    const onTaskDelta = (/** @type {unknown} */ rawEvt) => {
        if (!dispatched || !rawEvt || typeof rawEvt !== 'object') return;
        const chunk = Reflect.get(rawEvt, 'chunk');
        if (typeof chunk === 'string' && chunk.length > 0) {
            const remaining = MAX_DELTA_FALLBACK_CHARS - deltaCandidate.length;
            if (remaining > 0) {
                deltaCandidate += chunk.slice(0, remaining);
            }
        }
    };

    // Mantemos esse listener para amarrar a elegibilidade do fallback ao fechamento de um turno real do SDK.
    const onAssistantTurnEnd = () => {
        if (!dispatched) return;
    };

    host.on(EMITTER_ASSISTANT_MESSAGE, onAssistantMessage);
    host.on(EMITTER_ASSISTANT_TURN_END, onAssistantTurnEnd);
    host.on(EMITTER_DIALOG_DELTA, onTaskDelta);
    host.on(EMITTER_TASK_DELTA, onTaskDelta);

    return {
        markDispatched: () => {
            dispatched = true;
            candidate = null;
            deltaCandidate = '';
        },
        tryResolve: (turnStart, resolve, finalizeReply) => {
            const reply =
                candidate ??
                helpers.normalizeAssistantReplyCandidate(deltaCandidate) ??
                helpers.readPendingProtocolSnapshot(host)?.reply ??
                null;
            if (!reply) return false;
            candidate = null;
            deltaCandidate = '';
            log('WARN', '[DialogLoopManager] fallback semântico usado para resolver reply do dialog loop.');
            finalizeReply(turnStart, reply);
            resolve(reply);
            return true;
        },
        cleanup: () => {
            host.off?.(EMITTER_ASSISTANT_MESSAGE, onAssistantMessage);
            host.off?.(EMITTER_ASSISTANT_TURN_END, onAssistantTurnEnd);
            host.off?.(EMITTER_DIALOG_DELTA, onTaskDelta);
            host.off?.(EMITTER_TASK_DELTA, onTaskDelta);
        },
    };
}
