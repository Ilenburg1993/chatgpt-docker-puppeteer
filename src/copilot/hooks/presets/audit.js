// @ts-check
/**
 * src/copilot/hooks/presets/audit.js
 *
 * Preset de auditoria: registra toda atividade em audit log sem bloquear execução.
 *
 * @module copilot/hooks/presets/audit
 */

import { log } from '#core/logger';
import { createPermissionHandler } from '../permission-handler.js';

/**
 * @typedef {import('../types.js').SessionHooks} SessionHooks
 *
 * @typedef {import('../types.js').OnPermissionRequestCallback} OnPermissionRequestCallback
 */

/**
 * @typedef {object} AuditEntry
 * @property {number} ts
 * @property {string} hookName
 * @property {string} [sessionId]
 * @property {unknown} [summary]
 */

/**
 * Preset de auditoria: registra toda atividade sem bloquear nada. Mantém um audit trail em memória (acessível via
 * `getAuditTrail()`).
 *
 * @example
 *     const { hooks, onPermissionRequest, getAuditTrail } = createAuditPreset();
 *
 * @returns {{
 *     hooks: SessionHooks;
 *     onPermissionRequest: import('../permission-handler.js').PermissionHandler;
 *     getAuditTrail: () => AuditEntry[];
 *     clearAuditTrail: () => void;
 * }}
 */
export function createAuditPreset() {
    /** @type {AuditEntry[]} */
    const trail = [];

    /**
     * @param {string} hookName
     * @param {string | undefined} sessionId
     * @param {unknown} [summary]
     */
    function record(hookName, sessionId, summary) {
        /** @type {AuditEntry} */
        const entry = { ts: Date.now(), hookName, summary };
        if (sessionId !== undefined) {
            entry.sessionId = sessionId;
        }
        trail.push(entry);
        if (trail.length > 5000) {
            trail.splice(0, 1000); // LRU trim
        }
        log('DEBUG', `[preset/audit] ${hookName}${sessionId ? ` [${sessionId}]` : ''}`);
    }

    const onPermissionRequest = createPermissionHandler({ allowAll: true, auditMode: true });

    /** @type {SessionHooks} */
    const hooks = {
        async onPreToolUse(input, invocation) {
            record('onPreToolUse', invocation.sessionId, { tool: input.toolName });
            return { permissionDecision: 'allow' };
        },
        async onPostToolUse(input, invocation) {
            record('onPostToolUse', invocation.sessionId, {
                tool: input.toolName,
                resultLen: String(input.toolResult ?? '').length,
            });
            return {};
        },
        async onUserPromptSubmitted(input, invocation) {
            record('onUserPromptSubmitted', invocation.sessionId, { promptLen: input.prompt.length });
            return {};
        },
        async onSessionStart(input, invocation) {
            record('onSessionStart', invocation.sessionId, { source: input.source });
            return {};
        },
        async onSessionEnd(input, invocation) {
            record('onSessionEnd', invocation.sessionId, { reason: input.reason });
        },
        async onErrorOccurred(input, invocation) {
            record('onErrorOccurred', invocation.sessionId, {
                ctx: input.errorContext,
                recoverable: input.recoverable,
            });
            return { errorHandling: /** @type {'skip'} */ ('skip') };
        },
    };

    return {
        hooks,
        onPermissionRequest,
        getAuditTrail: () => [...trail],
        clearAuditTrail: () => trail.splice(0, trail.length),
    };
}
