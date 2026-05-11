// @ts-check
/**
 * src/copilot/hooks/presets/audit.js
 *
 * Preset de auditoria para hooks — registra toda atividade de hook no `defaultAuditLog` centralizado (ring buffer
 * compartilhado) sem bloquear execução.
 *
 * ARCH-OBS-003 fix: movido de `observability/hooks-audit-preset.js` para `hooks/presets/` — elimina dependência
 * circular `observability → hooks/permission-handler → observability`.
 *
 * @module copilot/hooks/presets/audit
 * @see EventBus
 */

import { defaultAuditLog } from '#copilot/audit';
import { createErrorHandler } from '../error-handler.js';
import { log } from '../logger.js';
import { createPermissionHandler } from '#copilot/sdk';

/**
 * @typedef {import('../types.js').SessionHooks} SessionHooks
 *
 * @typedef {import('../types.js').OnPermissionRequestCallback} OnPermissionRequestCallback
 *
 * @typedef {import('@github/copilot-sdk').PermissionHandler} PermissionHandler
 */

/**
 * Preset de auditoria: registra toda atividade de hook no `defaultAuditLog` sem bloquear a execução.
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
 * @param {{ allowAll?: boolean; permissionHandler?: import('@github/copilot-sdk').PermissionHandler }} [options]
 * @returns {{
 *     hooks: SessionHooks;
 *     onPermissionRequest: import('@github/copilot-sdk').PermissionHandler;
 *     getAuditTrail: () => import('#copilot/audit/pipeline').AuditEntry[];
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
        /** @type {import('#copilot/audit/pipeline').AuditEntry} */
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

    const onErrorOccurred = createErrorHandler({
        strategy: 'skip',
        onError: (input, invocation) => {
            record('onErrorOccurred', invocation?.sessionId, {
                ctx: input.errorContext,
                recoverable: input.recoverable,
            });
        },
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
        onErrorOccurred,
    };

    return {
        hooks,
        onPermissionRequest,
        getAuditTrail: () => defaultAuditLog.getEntries(),
        clearAuditTrail: () => defaultAuditLog.clear(),
    };
}
