// @ts-check
/**
 * src/copilot/observability/hooks-audit-preset.js
 *
 * Preset de auditoria para hooks — substituto de `hooks/presets/audit.js`. Registra toda atividade de hook no
 * `defaultAuditLog` centralizado (ring buffer compartilhado) em vez de um trail local separado.
 *
 * @module copilot/observability/hooks-audit-preset
 */

import { createPermissionHandler } from '../hooks/permission-handler.js';
import { defaultAuditLog } from './audit-log.js';
import { log } from './logger.js';

/**
 * @typedef {import('../hooks/types.js').SessionHooks} SessionHooks
 *
 * @typedef {import('../hooks/types.js').OnPermissionRequestCallback} OnPermissionRequestCallback
 *
 * @typedef {import('../hooks/permission-handler.js').PermissionHandler} PermissionHandler
 */

/**
 * Preset de auditoria: registra toda atividade de hook no `defaultAuditLog` sem bloquear a execução.
 *
 * Substituto de `createAuditPreset()` de `hooks/presets/audit.js`. API compatível.
 *
 * **SEGURANÇA (Fase BE):** O `onPermissionRequest` gerado por esta função usa `allowAll: false` por padrão para evitar
 * aprovação silenciosa de todas as ferramentas em produção. Para contextos de teste, passe `options.allowAll: true`
 * explicitamente.
 *
 * @example
 *     const { hooks, onPermissionRequest, getAuditTrail, clearAuditTrail } = createHooksAuditPreset();
 *
 * @example
 *     // Apenas em testes:
 *     const preset = createHooksAuditPreset({ allowAll: true });
 *
 * @param {{ allowAll?: boolean; permissionHandler?: import('../hooks/permission-handler.js').PermissionHandler }} [options]
 * @returns {{
 *     hooks: SessionHooks;
 *     onPermissionRequest: import('../hooks/permission-handler.js').PermissionHandler;
 *     getAuditTrail: () => import('./audit-log.js').AuditEntry[];
 *     clearAuditTrail: () => void;
 * }}
 */
export function createHooksAuditPreset(options = {}) {
    // Fase BE: emitir warning explícito se allowAll=true em ambiente de produção
    if (options.allowAll === true && process.env['NODE_ENV'] !== 'test') {
        log(
            'WARN',
            '[hooks-audit-preset] createHooksAuditPreset chamado com allowAll=true fora de ambiente de teste — risco de segurança!',
        );
    }
    /**
     * @param {string} hookName
     * @param {string | undefined} sessionId
     * @param {unknown} [summary]
     */
    function record(hookName, sessionId, summary) {
        /** @type {import('./audit-log.js').AuditEntry} */
        const entry = {
            type: 'hook.fired',
            ts: new Date().toISOString(),
            data: { hookName, summary },
        };
        if (sessionId !== undefined) entry.sessionId = sessionId;
        defaultAuditLog.record(entry);
        log('DEBUG', `[hooks-audit-preset] ${hookName}${sessionId ? ` [${sessionId}]` : ''}`);
    }

    // Fase BE: usar opção explícita em vez de hardcoded allowAll=true
    // O caller deve passar allowAll:true EXPLICITAMENTE em testes; padrão é false (seguro)
    const onPermissionRequest =
        options.permissionHandler ??
        createPermissionHandler({
            allowAll: options.allowAll === true,
            auditMode: true,
        });

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
        getAuditTrail: () => defaultAuditLog.getEntries(),
        clearAuditTrail: () => defaultAuditLog.clear(),
    };
}
