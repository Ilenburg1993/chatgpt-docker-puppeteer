// @ts-check
/**
 * src/copilot/config/system-prompt/projection.js
 *
 * Projeção pública canônica de system prompt para bordas (presentation/terminal/server). Este módulo define o shape
 * estável da visão consolidada: status + compatibilidade SDK + binding/freshness + instruction sources.
 *
 * Ownership canônico:
 *
 * - `config/system-prompt`: política/status/base de compatibilidade
 * - `sdk/rpc`: aquisição das instruction sources da sessão
 * - `presentation`: projeção runtime-aware consumida por terminal/server
 *
 * @module copilot/config/system-prompt/projection
 */

/**
 * @typedef {import('./status.js').SystemPromptStatus} SystemPromptStatus
 */

/**
 * @typedef {{
 *     policyOwner: 'config/system-prompt';
 *     rpcOwner: 'sdk/rpc';
 *     projectionOwner: 'presentation/runtime-sdk-session';
 * }} SystemPromptProjectionOwnership
 */

/**
 * @typedef {{
 *     status: SystemPromptStatus;
 *     sdkCompatibility: SystemPromptStatus['sdkCompatibility'] | null;
 *     binding: Record<string, unknown> | null;
 *     freshness: Record<string, unknown> | null;
 *     session: { id: string | null; available: boolean };
 *     instructionSources: { value: unknown | null; error: string | null; available: boolean };
 *     revision: { digest: string | null };
 *     ownership: SystemPromptProjectionOwnership;
 * }} SystemPromptPublicProjection
 */

/** @type {SystemPromptProjectionOwnership} */
const DEFAULT_OWNERSHIP = Object.freeze({
    policyOwner: 'config/system-prompt',
    rpcOwner: 'sdk/rpc',
    projectionOwner: 'presentation/runtime-sdk-session',
});

/**
 * @param {{
 *     systemPrompt: SystemPromptStatus;
 *     binding: Record<string, unknown> | null;
 *     freshness: Record<string, unknown> | null;
 *     sessionId: string | null;
 *     sessionAvailable: boolean;
 *     instructionSources: unknown | null;
 *     instructionSourcesError: string | null;
 * }} input
 * @returns {SystemPromptPublicProjection}
 */
export function buildSystemPromptPublicProjection(input) {
    const status = input.systemPrompt;
    const revision =
        status?.revision && typeof status.revision === 'object'
            ? /** @type {Record<string, unknown>} */ (status.revision)
            : null;
    return {
        status,
        sdkCompatibility:
            status?.sdkCompatibility && typeof status.sdkCompatibility === 'object' ? status.sdkCompatibility : null,
        binding: input.binding,
        freshness: input.freshness,
        session: {
            id: input.sessionId,
            available: input.sessionAvailable,
        },
        instructionSources: {
            value: input.instructionSources,
            error: input.instructionSourcesError,
            available: input.sessionAvailable,
        },
        revision: {
            digest: typeof revision?.['digest'] === 'string' ? revision['digest'] : null,
        },
        ownership: DEFAULT_OWNERSHIP,
    };
}
