// @ts-check
/**
 * HookBus canônico em superfície SDK.
 *
 * @module copilot/sdk/session/hook-bus
 */

import { toError } from '#copilot/core/error-handlers';
import {
    HOOK_ERROR_OCCURRED,
    HOOK_POST_TOOL_USE_FAILURE,
    HOOK_POST_TOOL_USE,
    HOOK_PRE_MCP_TOOL_CALL,
    HOOK_PRE_TOOL_USE,
    HOOK_PROMPT_SUBMITTED,
    HOOK_SESSION_END,
    HOOK_SESSION_START,
} from '#copilot/events/hook-events';
import { EventEmitter } from 'node:events';
import { log } from './hook-logger.js';

/**
 * @typedef {import('../types.js').SessionHooks} SessionHooks
 *
 * @typedef {import('#copilot/core/event-bus').EventBus} EventBus
 */

/** @type {Record<string, string>} */
const HOOK_NAME_TO_EVENTBUS = {
    pre_tool_use: HOOK_PRE_TOOL_USE,
    pre_mcp_tool_call: HOOK_PRE_MCP_TOOL_CALL,
    post_tool_use: HOOK_POST_TOOL_USE,
    post_tool_use_failure: HOOK_POST_TOOL_USE_FAILURE,
    prompt_submitted: HOOK_PROMPT_SUBMITTED,
    session_start: HOOK_SESSION_START,
    session_end: HOOK_SESSION_END,
    error_occurred: HOOK_ERROR_OCCURRED,
};

/**
 * @param {unknown} raw
 * @returns {string}
 */
function normalizeHookErrorMessage(raw) {
    if (typeof raw === 'string') return raw;
    if (raw && typeof raw === 'object') {
        const rec = /** @type {Record<string, unknown>} */ (raw);
        if (typeof rec['message'] === 'string' && rec['message']) return rec['message'];
        const nestedError = rec['error'];
        if (nestedError && typeof nestedError === 'object') {
            const errRec = /** @type {Record<string, unknown>} */ (nestedError);
            if (typeof errRec['message'] === 'string' && errRec['message']) return errRec['message'];
        }
        try {
            const serialized = JSON.stringify(raw);
            return serialized && serialized !== '{}' ? serialized : 'Erro do SDK sem mensagem estruturada.';
        } catch {
            return String(raw);
        }
    }
    return String(raw);
}

/**
 * @param {unknown} value
 * @returns {Date}
 */
function normalizeHookTimestamp(value) {
    if (value instanceof Date && Number.isFinite(value.getTime())) return value;
    if (typeof value === 'number' && Number.isFinite(value)) return new Date(value);
    if (typeof value === 'string') {
        const parsed = Date.parse(value);
        if (Number.isFinite(parsed)) return new Date(parsed);
    }
    return new Date();
}

/**
 * Normaliza inputs de hook para o contrato SDK 1.0 sem quebrar consumers legados.
 *
 * @param {unknown} input
 * @param {string} sessionId
 * @returns {unknown}
 */
export function normalizeHookInputForSdk10(input, sessionId) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return input;
    const record = /** @type {Record<string, unknown>} */ (input);
    const workingDirectory =
        typeof record['workingDirectory'] === 'string'
            ? record['workingDirectory']
            : typeof record['cwd'] === 'string'
              ? record['cwd']
              : undefined;
    return {
        ...record,
        ...(typeof record['sessionId'] === 'string' && record['sessionId'] ? {} : { sessionId }),
        timestamp: normalizeHookTimestamp(record['timestamp']),
        ...(workingDirectory !== undefined ? { workingDirectory } : {}),
    };
}

export class HookBus extends EventEmitter {
    /** @type {EventBus | null} */
    #eventBus = null;

    constructor() {
        super();
        this.setMaxListeners(50);
    }

    /**
     * @param {EventBus} bus
     * @returns {void}
     */
    setEventBus(bus) {
        this.#eventBus = bus;
    }

    /**
     * @param {string} hookName
     * @param {string} sessionId
     * @param {unknown} input
     * @param {unknown} [output]
     */
    emitHook(hookName, sessionId, input, output) {
        const normalizedInput = normalizeHookInputForSdk10(input, sessionId);
        const event = {
            hookName,
            sessionId,
            timestamp: Date.now(),
            input: normalizedInput,
            output,
        };
        // Separar try/catch por emissão para evitar que erros em um listener suprimam outros
        try {
            this.emit(hookName, event);
        } catch (e) {
            log('WARN', `[sdk/hook-bus] listener erro em '${hookName}': ${toError(e).message}`);
        }
        try {
            this.emit('*', event);
        } catch (e) {
            log('WARN', `[sdk/hook-bus] listener erro em wildcard '*': ${toError(e).message}`);
        }
        const busType = HOOK_NAME_TO_EVENTBUS[hookName];
        if (busType && this.#eventBus) {
            try {
                const inputRecord =
                    normalizedInput && typeof normalizedInput === 'object'
                        ? /** @type {Record<string, unknown>} */ (normalizedInput)
                        : {};
                this.#eventBus.emit({
                    type: busType,
                    hookName,
                    sessionId,
                    timestamp: event.timestamp,
                    input: normalizedInput,
                    output,
                    ...(hookName === 'error_occurred'
                        ? {
                              errorContext: inputRecord['errorContext'],
                              recoverable: inputRecord['recoverable'],
                              errorMessage: normalizeHookErrorMessage(inputRecord['error']),
                          }
                        : {}),
                });
            } catch (e) {
                log('WARN', `[sdk/hook-bus] EventBus erro em '${busType}': ${toError(e).message}`);
            }
        }
    }
}

/** @type {HookBus} */
export const defaultBus = new HookBus();

/**
 * @param {SessionHooks} hooks
 * @param {HookBus} [bus]
 * @returns {SessionHooks}
 */
export function attachBus(hooks, bus = defaultBus) {
    /** @type {SessionHooks} */
    const wrapped = {};

    if (hooks.onPreToolUse) {
        const orig = hooks.onPreToolUse;
        wrapped.onPreToolUse = async (input, invocation) => {
            const result = await orig(input, invocation);
            bus.emitHook('pre_tool_use', invocation?.sessionId ?? '', input, result);
            return result;
        };
    }

    if (hooks.onPreMcpToolCall) {
        const orig = hooks.onPreMcpToolCall;
        wrapped.onPreMcpToolCall = async (input, invocation) => {
            const result = await orig(input, invocation);
            bus.emitHook('pre_mcp_tool_call', invocation?.sessionId ?? '', input, result);
            return result;
        };
    }

    if (hooks.onPostToolUse) {
        const orig = hooks.onPostToolUse;
        wrapped.onPostToolUse = async (input, invocation) => {
            const result = await orig(input, invocation);
            bus.emitHook('post_tool_use', invocation?.sessionId ?? '', input, result);
            return result;
        };
    }

    if (hooks.onPostToolUseFailure) {
        const orig = hooks.onPostToolUseFailure;
        wrapped.onPostToolUseFailure = async (input, invocation) => {
            const result = await orig(input, invocation);
            bus.emitHook('post_tool_use_failure', invocation?.sessionId ?? '', input, result);
            return result;
        };
    }

    if (hooks.onUserPromptSubmitted) {
        const orig = hooks.onUserPromptSubmitted;
        wrapped.onUserPromptSubmitted = async (input, invocation) => {
            const result = await orig(input, invocation);
            const prompt = typeof input.prompt === 'string' ? input.prompt : '';
            bus.emitHook(
                'prompt_submitted',
                invocation?.sessionId ?? '',
                {
                    promptLength: prompt.length,
                    promptPreview: prompt.replace(/\s+/g, ' ').trim().slice(0, 220),
                },
                result,
            );
            return result;
        };
    }

    if (hooks.onSessionStart) {
        const orig = hooks.onSessionStart;
        wrapped.onSessionStart = async (input, invocation) => {
            const result = await orig(input, invocation);
            bus.emitHook('session_start', invocation?.sessionId ?? '', input, result);
            return result;
        };
    }

    if (hooks.onSessionEnd) {
        const orig = hooks.onSessionEnd;
        wrapped.onSessionEnd = async (input, invocation) => {
            await orig(input, invocation);
            bus.emitHook('session_end', invocation?.sessionId ?? '', input, null);
        };
    }

    if (hooks.onErrorOccurred) {
        const orig = hooks.onErrorOccurred;
        wrapped.onErrorOccurred = async (input, invocation) => {
            const result = await orig(input, invocation);
            bus.emitHook(
                'error_occurred',
                invocation?.sessionId ?? '',
                { error: input.error, errorContext: input.errorContext, recoverable: input.recoverable },
                result,
            );
            return result;
        };
    }

    return { ...hooks, ...wrapped };
}
