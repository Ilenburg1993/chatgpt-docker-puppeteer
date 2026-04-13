// @ts-check
/**
 * src/copilot/hooks/presets/interactive.js
 *
 * Preset interativo: todas as tools passam por confirmação do usuário via 'ask'. Adequado para modo supervisionado onde
 * um humano aprova cada ação.
 *
 * @module copilot/hooks/presets/interactive
 * @see EventBus
 */

import { log } from '../logger.js';
import { createPermissionHandler } from '../permission-handler.js';

/**
 * @typedef {import('../types.js').SessionHooks} SessionHooks
 *
 * @typedef {import('../types.js').OnPermissionRequestCallback} OnPermissionRequestCallback
 */

/**
 * @typedef {object} InteractivePresetOptions
 * @property {string[]} [autoAllowTools] Tools que são permitidas automaticamente sem pedir ao usuário.
 * @property {string[]} [autoDenyTools] Tools que são bloqueadas automaticamente sem pedir ao usuário.
 */

/**
 * Preset interativo: pede confirmação do usuário ('ask') para todas as tools, exceto as que estão em auto-allow ou
 * auto-deny.
 *
 * @example
 *     const { hooks, onPermissionRequest } = createInteractivePreset({
 *         autoAllowTools: ['read_file', 'list_dir'],
 *         autoDenyTools: ['rm_rf'],
 *     });
 *
 * @param {InteractivePresetOptions} [opts]
 * @returns {{ hooks: SessionHooks; onPermissionRequest: import('../permission-handler.js').PermissionHandler }}
 */
export function createInteractivePreset(opts = {}) {
    const { autoAllowTools = [], autoDenyTools = [] } = opts;

    const autoAllow = new Set([
        'read_file',
        'list_dir',
        'grep_search',
        'file_search',
        'semantic_search',
        'search_files',
        ...autoAllowTools.map((t) => t.toLowerCase()),
    ]);
    const autoDeny = new Set(autoDenyTools.map((t) => t.toLowerCase()));

    // onPermissionRequest espelha a lógica do onPreToolUse:
    // auto-deny → nega, auto-allow → aprova, demais → nega (conservative default para permissionRequest
    // uma vez que o fluxo interativo de 'ask' não está disponível nesse contexto).
    const onPermissionRequest = createPermissionHandler({
        onRequest: (req) => {
            const name =
                /** @type {{ toolName?: string; tool?: string }} */ (req)?.toolName?.toLowerCase() ??
                /** @type {{ toolName?: string; tool?: string }} */ (req)?.tool?.toLowerCase() ??
                'unknown';
            if (autoDeny.has(name)) return false;
            if (autoAllow.has(name)) return true;
            // 'ask' não é possível em onPermissionRequest → deny conservative
            log('WARN', `[preset/interactive] onPermissionRequest: tool '${name}' NEGADA (ask não disponível aqui)`);
            return false;
        },
    });

    /** @type {SessionHooks} */
    const hooks = {
        async onPreToolUse(input, invocation) {
            const name = input.toolName.toLowerCase();

            if (autoDeny.has(name)) {
                log('WARN', `[preset/interactive] tool NEGADA automaticamente: ${input.toolName}`);
                return { permissionDecision: 'deny' };
            }

            if (autoAllow.has(name)) {
                log('DEBUG', `[preset/interactive] tool PERMITIDA automaticamente: ${input.toolName}`);
                return { permissionDecision: 'allow' };
            }

            log(
                'INFO',
                `[preset/interactive] tool requer aprovação do usuário [${invocation?.sessionId}]: ${input.toolName}`,
            );
            return { permissionDecision: 'ask' };
        },

        async onPostToolUse(input) {
            log('DEBUG', `[preset/interactive] onPostToolUse: ${input.toolName}`);
            return {};
        },

        async onUserPromptSubmitted() {
            return {};
        },

        async onSessionStart(input) {
            log(
                'INFO',
                `[preset/interactive] session started em modo interativo — source: ${input.source ?? 'unknown'}`,
            );
            return { additionalContext: 'MODO INTERATIVO: operações destrutivas requerem aprovação do usuário' };
        },

        async onSessionEnd() {
            log('INFO', '[preset/interactive] session ended');
        },

        async onErrorOccurred(input) {
            log('WARN', `[preset/interactive] error [${input.errorContext}]: ${input.error}`);
            if (input.recoverable) {
                return { errorHandling: /** @type {'retry'} */ ('retry'), retryCount: 1 };
            }
            return { errorHandling: /** @type {'skip'} */ ('skip') };
        },
    };

    return { hooks, onPermissionRequest };
}
