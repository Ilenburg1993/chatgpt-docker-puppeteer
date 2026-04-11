// @ts-check
/**
 * src/copilot/lib/event-helpers.js
 *
 * Helpers utilitários para espera de eventos em EventEmitters. Elimina padrões repetitivos de `new Promise` +
 * `setTimeout` + listener cleanup em `always-alive.js`, `dialog.js` e outros componentes com EventEmitter.
 *
 * @module copilot/lib/event-helpers
 * @see EventBus
 * @see module:copilot/always-alive
 * @see module:copilot/agent/dialog-loop-manager
 */

/**
 * Aguarda um evento específico de um EventEmitter com timeout e cleanup automático.
 *
 * Equivale ao padrão common:
 *
 * ```js
 * await Promise.race([
 *     new Promise(resolve => emitter.once(event, resolve)),
 *     new Promise((_, reject) => setTimeout(() => reject(...), timeoutMs)),
 * ]);
 * ```
 *
 * mas com garantia de cleanup de listeners em todos os paths (resolve, reject, abort).
 *
 * @example
 *     const result = await waitForEvent(agent, 'ready', { timeoutMs: 5000 });
 *
 * @template T
 * @param {import('node:events').EventEmitter} emitter - EventEmitter fonte do evento
 * @param {string} event - Nome do evento a aguardar
 * @param {{ timeoutMs?: number; timeoutError?: string; signal?: AbortSignal }} [opts]
 * @returns {Promise<T>} Primeiro argumento emitido pelo evento
 */
export function waitForEvent(emitter, event, opts = {}) {
    const { timeoutMs = 30_000, timeoutError, signal } = opts;

    return new Promise((resolve, reject) => {
        if (signal?.aborted) {
            reject(new DOMException('Aborted', 'AbortError'));
            return;
        }

        /** @type {ReturnType<typeof setTimeout> | null} */
        let timer = null;

        /** @param {T} data */
        const onEvent = (data) => {
            cleanup();
            resolve(data);
        };

        const onTimeout = () => {
            cleanup();
            reject(new Error(timeoutError ?? `waitForEvent('${event}') timeout após ${timeoutMs}ms`));
        };

        const onAbort = () => {
            cleanup();
            reject(new DOMException('Aborted', 'AbortError'));
        };

        const cleanup = () => {
            emitter.off(event, onEvent);
            if (timer !== null) clearTimeout(timer);
            signal?.removeEventListener('abort', onAbort);
        };

        emitter.once(event, onEvent);
        timer = setTimeout(onTimeout, timeoutMs);
        signal?.addEventListener('abort', onAbort, { once: true });
    });
}

/**
 * Aguarda o primeiro de múltiplos eventos, com timeout. Retorna `{ event, data }` indicando qual evento disparou.
 *
 * Útil para padrões como:
 *
 * ```js
 * await Promise.race([
 *     new Promise((r) => emitter.once('ready', r)),
 *     new Promise((r) => emitter.once('error', r)),
 *     new Promise((r) => setTimeout(r, 15_000)),
 * ]);
 * ```
 *
 * @example
 *     const { event, data } = await raceEvents(agent, ['ready', 'error'], { timeoutMs: 10_000 });
 *
 * @param {import('node:events').EventEmitter} emitter
 * @param {string[]} events - Nomes dos eventos a monitorar
 * @param {{ timeoutMs?: number; timeoutError?: string; signal?: AbortSignal }} [opts]
 * @returns {Promise<{ event: string; data: unknown }>}
 */
export function raceEvents(emitter, events, opts = {}) {
    const { timeoutMs = 30_000, timeoutError, signal } = opts;

    return new Promise((resolve, reject) => {
        if (signal?.aborted) {
            reject(new DOMException('Aborted', 'AbortError'));
            return;
        }

        /** @type {ReturnType<typeof setTimeout> | null} */
        let timer = null;
        /** @type {{ event: string; handler: (...args: unknown[]) => void }[]} */
        const listeners = [];

        const cleanup = () => {
            for (const { event, handler } of listeners) {
                emitter.off(event, handler);
            }
            if (timer !== null) clearTimeout(timer);
            signal?.removeEventListener('abort', onAbort);
        };

        const onAbort = () => {
            cleanup();
            reject(new DOMException('Aborted', 'AbortError'));
        };

        for (const evt of events) {
            const handler = (/** @type {unknown} */ data) => {
                cleanup();
                resolve({ event: evt, data });
            };
            listeners.push({ event: evt, handler });
            emitter.once(evt, handler);
        }

        timer = setTimeout(() => {
            cleanup();
            reject(new Error(timeoutError ?? `raceEvents([${events.join(', ')}]) timeout após ${timeoutMs}ms`));
        }, timeoutMs);

        signal?.addEventListener('abort', onAbort, { once: true });
    });
}
