// @ts-check
/**
 * Compat layer de elicitation para hooks.
 *
 * Na arquitetura 2.0/2.1, o núcleo canônico de elicitation fica em `sdk/session/elicitation.js`. Este módulo preserva a
 * API histórica de `#copilot/hooks` delegando 100% da lógica para o SDK.
 *
 * @module copilot/hooks/elicitation
 */

export { createQueuedElicitationHandler, normalizeElicitationResult } from '#copilot/sdk/session';

/**
 * @typedef {import('#copilot/sdk/types').QueuedElicitationEntry} QueuedElicitationEntry
 *
 * @typedef {import('#copilot/sdk/types').CompletedQueuedElicitationEntry} CompletedQueuedElicitationEntry
 *
 * @typedef {import('#copilot/sdk/types').QueuedElicitationHandlerOptions} QueuedElicitationHandlerOptions
 */
