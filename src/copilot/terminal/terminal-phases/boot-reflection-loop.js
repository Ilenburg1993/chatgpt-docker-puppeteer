// @ts-check
/**
 * @module copilot/terminal/terminal-phases/boot-reflection-loop
 * @file Helpers do reflection loop do terminal.
 */

import { LLM_B_REFLECTION_INTERVAL_MIN } from '#copilot/config';
import { log } from '#copilot/observability';
import { toError } from '../../core/error-handlers.js';
import { cancel as cancelTimer, registerTimer } from '../../core/timer-registry.js';
import { sendTurn } from '../dialog/index.js';
import { readTerminalRuntimeState } from '../frontend/gateways/index.js';

/** @type {unknown | null} */
let _reflectionTimer = null;

/**
 * Ativa o reflection loop periódico se `LLM_B_REFLECTION_INTERVAL_MIN` > 0.
 *
 * @param {{
 *     reflectionIntervalMin?: number;
 *     logFn?: (level: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'FATAL', message: string) => void;
 *     readTerminalRuntimeStateFn?: (...args: unknown[]) => { dialogLoopActive: boolean; queueSize: number };
 *     sendTurnFn?: (message: string, actor?: string) => Promise<unknown>;
 *     setIntervalFn?: (callback: () => void, delay: number) => unknown;
 *     registerTimerFn?: typeof registerTimer;
 * }} [deps]
 * @returns {unknown | null}
 */
export function startReflectionLoop(deps = {}) {
    if (_reflectionTimer !== null) return _reflectionTimer;

    const reflectionIntervalMin = deps.reflectionIntervalMin ?? LLM_B_REFLECTION_INTERVAL_MIN;
    const logFn = deps.logFn ?? log;
    const readTerminalRuntimeStateFn = deps.readTerminalRuntimeStateFn ?? readTerminalRuntimeState;
    const sendTurnFn = deps.sendTurnFn ?? sendTurn;
    const setIntervalFn = deps.setIntervalFn ?? setInterval;
    const registerTimerFn = deps.registerTimerFn ?? registerTimer;

    if (reflectionIntervalMin <= 0) return null;

    const reflectionIntervalMs = reflectionIntervalMin * 60 * 1000;
    logFn('INFO', `[TerminalServer] Reflection loop ativado: a cada ${reflectionIntervalMin}min.`);

    const runReflection = () => {
        try {
            const runtimeState = readTerminalRuntimeStateFn();
            if (!runtimeState.dialogLoopActive) return;
            if (runtimeState.queueSize > 0) {
                logFn('INFO', '[TerminalServer] Reflection loop pulado — fila ocupada.');
                return;
            }
            logFn('INFO', '[TerminalServer] Executando reflection loop…');
            sendTurnFn(
                '[REFLEXÃO] Faça uma breve reflexão sobre as últimas mensagens desta conversa: o que foi discutido, o que está pendente, e se você tem alguma sugestão ou insight que ainda não mencionou. Seja conciso.',
                'llm-a',
            ).catch((e) => {
                const err = toError(e);
                logFn('WARN', `[TerminalServer] Reflection loop falhou: ${err.message}`);
            });
        } catch (e) {
            const err = toError(e);
            logFn('WARN', `[TerminalServer] Reflection loop falhou: ${err.message}`);
        }
    };

    const timer = setIntervalFn(runReflection, reflectionIntervalMs);
    const timerObj = timer && typeof timer === 'object' ? /** @type {{ unref?: () => void }} */ (timer) : null;
    if (typeof timerObj?.unref === 'function') timerObj.unref();
    _reflectionTimer = timer;
    registerTimerFn(
        'terminal.reflection',
        'interval',
        /** @type {ReturnType<typeof setInterval>} */ (/** @type {unknown} */ (timer)),
    );
    return timer;
}

/**
 * Cancela o reflection loop do terminal.
 *
 * @param {{
 *     clearIntervalFn?: (timer: unknown) => void;
 *     cancelTimerFn?: typeof cancelTimer;
 * }} [deps]
 * @returns {void}
 */
export function stopReflectionLoop(deps = {}) {
    if (_reflectionTimer === null) return;
    const clearIntervalFn =
        deps.clearIntervalFn ?? ((timer) => clearInterval(/** @type {ReturnType<typeof setInterval>} */ (timer)));
    const cancelTimerFn = deps.cancelTimerFn ?? cancelTimer;
    clearIntervalFn(_reflectionTimer);
    cancelTimerFn('terminal.reflection');
    _reflectionTimer = null;
}

/**
 * @returns {void}
 */
export function resetTerminalReflectionLoopForTests() {
    _reflectionTimer = null;
}
