// @ts-check
/**
 * src/copilot/hooks/presets/deny-all.js
 *
 * Preset deny-all: bloqueia todas as tools. Útil para modo read-only ou análise estática.
 *
 * @module copilot/hooks/presets/deny-all
 * @see EventBus
 */

import { createErrorHandler } from '../error-handler.js';
import { log } from '../logger.js';
import { createToolPermissionPolicy } from './permission-policy.js';

/**
 * @typedef {import('../types.js').SessionHooks} SessionHooks
 *
 * @typedef {import('../types.js').OnPermissionRequestCallback} OnPermissionRequestCallback
 */

/**
 * @typedef {object} DenyAllPresetOptions
 * @property {string[]} [exceptTools] Tools a permitir mesmo no modo deny-all (allowlist).
 */

/**
 * Preset deny-all: bloqueia a execução de todas as tools. Opcionalmente, permite uma lista de exceções (`exceptTools`).
 *
 * Ambos os pontos de interceptação (`onPreToolUse` e `onPermissionRequest`) são configurados de forma consistente: deny
 * por padrão, com exceções aplicadas nos dois.
 *
 * @example
 *     const { hooks, onPermissionRequest } = createDenyAllPreset({
 *         exceptTools: ['read_file', 'list_dir'],
 *     });
 *
 * @param {DenyAllPresetOptions} [opts]
 * @returns {{ hooks: SessionHooks; onPermissionRequest: import('@github/copilot-sdk').PermissionHandler }}
 */
export function createDenyAllPreset(opts = {}) {
    const { exceptTools = [] } = opts;
    const allowed = new Set(exceptTools.map((t) => t.toLowerCase()));

    const policy = createToolPermissionPolicy({
        allowTools: [...allowed],
        defaultDecision: 'deny',
        label: 'preset/deny-all',
        auditLog: true,
    });
    const onPermissionRequest = policy.onPermissionRequest;

    const onErrorOccurred = createErrorHandler({
        strategy: 'abort',
        onError: (input) => {
            log('ERROR', `[preset/deny-all] error [${input.errorContext}]: ${input.error}`);
        },
    });

    /** @type {SessionHooks} */
    const hooks = {
        async onPreToolUse(input, invocation) {
            const name = input.toolName.toLowerCase();
            const decision = policy.decide(name);
            if (decision === 'allow') {
                log('DEBUG', `[preset/deny-all] tool excetuada: ${input.toolName}`);
                return { permissionDecision: 'allow' };
            }
            log('WARN', `[preset/deny-all] tool NEGADA [${invocation?.sessionId}]: ${input.toolName}`);
            return { permissionDecision: 'deny' };
        },

        async onPostToolUse() {
            return {};
        },

        async onUserPromptSubmitted() {
            return {};
        },

        async onSessionStart() {
            log('INFO', '[preset/deny-all] session started em modo deny-all');
            return { additionalContext: 'MODO RESTRITO: execução de tools bloqueada' };
        },

        async onSessionEnd() {
            log('INFO', '[preset/deny-all] session ended');
        },

        onErrorOccurred,
    };

    return { hooks, onPermissionRequest };
}
