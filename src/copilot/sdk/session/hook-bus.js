// @ts-check
/**
 * HookBus canônico em superfície SDK.
 *
 * @module copilot/sdk/session/hook-bus
 */

import {
    HOOK_ERROR_OCCURRED,
    HOOK_POST_TOOL_USE,
    HOOK_PRE_TOOL_USE,
    HOOK_PROMPT_SUBMITTED,
    HOOK_SESSION_END,
    HOOK_SESSION_START,
} from '#copilot/events';
import { EventEmitter } from 'node:events';
import { toError } from '#copilot/core/error-handlers';
import { log } from './hook-logger.js';

/**
 * @typedef {import('../types.js').SessionHooks} SessionHooks
 *
 * @typedef {import('#copilot/core/event-bus').EventBus} EventBus
 */

/** @type {Record<string, string>} */
const HOOK_NAME_TO_EVENTBUS = {
    pre_tool_use: HOOK_PRE_TOOL_USE,
    post_tool_use: HOOK_POST_TOOL_USE,
    prompt_submitted: HOOK_PROMPT_SUBMITTED,
    session_start: HOOK_SESSION_START,
    session_end: HOOK_SESSION_END,
    error_occurred: HOOK_ERROR_OCCURRED,
};

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
        const event = {
            hookName,
            sessionId,
            timestamp: Date.now(),
            input,
            output,
        };
        try {
            this.emit(hookName, event);
            this.emit('*', event);
            const busType = HOOK_NAME_TO_EVENTBUS[hookName];
            if (busType && this.#eventBus) {
                this.#eventBus.emit({ type: busType, hookName, sessionId, timestamp: event.timestamp, input, output });
            }
        } catch (e) {
            log('WARN', `[sdk/hook-bus] listener erro em '${hookName}': ${toError(e).message}`);
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

    if (hooks.onPostToolUse) {
        const orig = hooks.onPostToolUse;
        wrapped.onPostToolUse = async (input, invocation) => {
            const result = await orig(input, invocation);
            bus.emitHook('post_tool_use', invocation?.sessionId ?? '', input, result);
            return result;
        };
    }

    if (hooks.onUserPromptSubmitted) {
        const orig = hooks.onUserPromptSubmitted;
        wrapped.onUserPromptSubmitted = async (input, invocation) => {
            const result = await orig(input, invocation);
            bus.emitHook(
                'prompt_submitted',
                invocation?.sessionId ?? '',
                { prompt: input.prompt?.slice(0, 80) },
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
                { errorContext: input.errorContext, recoverable: input.recoverable },
                result,
            );
            return result;
        };
    }

    return { ...hooks, ...wrapped };
}
