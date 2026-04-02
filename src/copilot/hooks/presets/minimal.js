// @ts-check
/**
 * src/copilot/hooks/presets/minimal.js
 *
 * Preset minimal: hooks de observação com zero restrições. Logging e telemetria básicos sem bloquear nada.
 *
 * @module copilot/hooks/presets/minimal
 */

import { log } from '#copilot/observability/logger';
import { createPermissionHandler } from '../permission-handler.js';

/**
 * @typedef {import('../types.js').SessionHooks} SessionHooks
 *
 * @typedef {import('../types.js').OnPermissionRequestCallback} OnPermissionRequestCallback
 */

/**
 * Preset minimal: permite tudo, loga os eventos principais. Adequado para ambientes de desenvolvimento sem restrições.
 *
 * @example
 *     import { createMinimalPreset } from '#copilot/hooks/presets/minimal.js';
 *     const session = await client.createSession({
 *         onPermissionRequest: createMinimalPreset().onPermissionRequest,
 *         hooks: createMinimalPreset().hooks,
 *     });
 *
 * @returns {{ hooks: SessionHooks; onPermissionRequest: import('../permission-handler.js').PermissionHandler }}
 */
export function createMinimalPreset() {
    const onPermissionRequest = createPermissionHandler({ allowAll: true });

    /** @type {SessionHooks} */
    const hooks = {
        async onPreToolUse(input) {
            log('DEBUG', `[preset/minimal] onPreToolUse: ${input.toolName}`);
            return { permissionDecision: 'allow' };
        },
        async onPostToolUse(input) {
            log('DEBUG', `[preset/minimal] onPostToolUse: ${input.toolName}`);
            return {};
        },
        async onUserPromptSubmitted(input) {
            log('DEBUG', `[preset/minimal] prompt (${input.prompt.length} chars)`);
            return {};
        },
        async onSessionStart(input) {
            log('INFO', `[preset/minimal] session started — source: ${input.source ?? 'unknown'}`);
            return {};
        },
        async onSessionEnd() {
            log('INFO', '[preset/minimal] session ended');
        },
        async onErrorOccurred(input) {
            log('WARN', `[preset/minimal] error [${input.errorContext}]: ${input.error}`);
            return { errorHandling: /** @type {'skip'} */ ('skip') };
        },
    };

    return { hooks, onPermissionRequest };
}
