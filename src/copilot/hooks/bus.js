// @ts-check
/**
 * src/copilot/hooks/bus.js
 *
 * HookBus: sistema de observadores para hooks sem acoplamento.
 *
 * Permite adicionar listeners que observam todos os eventos de hooks sem modificar os handlers originais. Usado para
 * métricas, SSE, alertas.
 *
 * @module copilot/hooks/bus
 * @see module:copilot/hooks/factory
 */

import { log } from '#core/logger';
import { EventEmitter } from 'node:events';

/**
 * @typedef {import('./types.js').HookBusEvent} HookBusEvent
 *
 * @typedef {import('./types.js').SessionHooks} SessionHooks
 *
 * @typedef {import('./types.js').PreToolUseHandler} PreToolUseHandler
 *
 * @typedef {import('./types.js').PostToolUseHandler} PostToolUseHandler
 *
 * @typedef {import('./types.js').UserPromptSubmittedHandler} UserPromptSubmittedHandler
 *
 * @typedef {import('./types.js').SessionStartHandler} SessionStartHandler
 *
 * @typedef {import('./types.js').SessionEndHandler} SessionEndHandler
 *
 * @typedef {import('./types.js').ErrorOccurredHandler} ErrorOccurredHandler
 *
 * @typedef {import('./types.js').InvocationContext} InvocationContext
 */

/**
 * Bus de eventos para o sistema de hooks.
 *
 * Emite eventos para cada hook invocado, permitindo observação sem acoplamento.
 *
 * Eventos emitidos:
 *
 * - `'pre_tool_use'` — antes de executar uma tool
 * - `'post_tool_use'` — após executar uma tool
 * - `'prompt_submitted'` — quando o usuário envia um prompt
 * - `'session_start'` — ao iniciar uma sessão
 * - `'session_end'` — ao encerrar uma sessão
 * - `'error_occurred'` — ao ocorrer um erro
 *
 * @extends {EventEmitter}
 */
export class HookBus extends EventEmitter {
    constructor() {
        super();
        this.setMaxListeners(50);
    }

    /**
     * Emite um evento de hook no bus.
     *
     * @param {string} hookName
     * @param {string} sessionId
     * @param {unknown} input
     * @param {unknown} [output]
     */
    emitHook(hookName, sessionId, input, output) {
        /** @type {HookBusEvent} */
        const event = {
            hookName,
            sessionId,
            timestamp: Date.now(),
            input,
            output,
        };
        try {
            this.emit(hookName, event);
            this.emit('*', event); // wildcard listener
        } catch (/** @type {any} */ e) {
            log('WARN', `[hooks/bus] listener erro em '${hookName}': ${e.message}`);
        }
    }
}

/**
 * Instância global do HookBus. Pode ser substituída por uma instância customizada via injeção.
 *
 * @type {HookBus}
 */
export const defaultBus = new HookBus();

/**
 * Injeta middleware de bus em um conjunto de SessionHooks existente. Os handlers originais são preservados e executados
 * normalmente; o bus simplesmente observa os inputs/outputs.
 *
 * @example
 *     const hooks = createHooks({ auditLog: true });
 *     const busHooks = attachBus(hooks, myBus);
 *     await client.createSession({ hooks: busHooks });
 *
 * @param {SessionHooks} hooks - Hooks existentes a observar
 * @param {HookBus} [bus] - Bus a usar (default: defaultBus)
 * @returns {SessionHooks}
 */
export function attachBus(hooks, bus = defaultBus) {
    /** @type {SessionHooks} */
    const wrapped = {};

    if (hooks.onPreToolUse) {
        const orig = hooks.onPreToolUse;
        wrapped.onPreToolUse = /** @type {PreToolUseHandler} */ (
            async (input, invocation) => {
                const result = await orig(input, invocation);
                bus.emitHook('pre_tool_use', invocation?.sessionId ?? '', input, result);
                return result;
            }
        );
    }

    if (hooks.onPostToolUse) {
        const orig = hooks.onPostToolUse;
        wrapped.onPostToolUse = /** @type {PostToolUseHandler} */ (
            async (input, invocation) => {
                const result = await orig(input, invocation);
                bus.emitHook('post_tool_use', invocation?.sessionId ?? '', input, result);
                return result;
            }
        );
    }

    if (hooks.onUserPromptSubmitted) {
        const orig = hooks.onUserPromptSubmitted;
        wrapped.onUserPromptSubmitted = /** @type {UserPromptSubmittedHandler} */ (
            async (input, invocation) => {
                const result = await orig(input, invocation);
                bus.emitHook(
                    'prompt_submitted',
                    invocation?.sessionId ?? '',
                    { prompt: input.prompt?.slice(0, 80) },
                    result,
                );
                return result;
            }
        );
    }

    if (hooks.onSessionStart) {
        const orig = hooks.onSessionStart;
        wrapped.onSessionStart = /** @type {SessionStartHandler} */ (
            async (input, invocation) => {
                const result = await orig(input, invocation);
                bus.emitHook('session_start', invocation?.sessionId ?? '', input, result);
                return result;
            }
        );
    }

    if (hooks.onSessionEnd) {
        const orig = hooks.onSessionEnd;
        wrapped.onSessionEnd = /** @type {SessionEndHandler} */ (
            async (input, invocation) => {
                await orig(input, invocation);
                bus.emitHook('session_end', invocation?.sessionId ?? '', input, null);
            }
        );
    }

    if (hooks.onErrorOccurred) {
        const orig = hooks.onErrorOccurred;
        wrapped.onErrorOccurred = /** @type {ErrorOccurredHandler} */ (
            async (input, invocation) => {
                const result = await orig(input, invocation);
                bus.emitHook(
                    'error_occurred',
                    invocation?.sessionId ?? '',
                    { errorContext: input.errorContext, recoverable: input.recoverable },
                    result,
                );
                return result;
            }
        );
    }

    return { ...hooks, ...wrapped };
}
