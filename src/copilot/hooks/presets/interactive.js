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

import { createErrorHandler } from '../error-handler.js';
import { log } from '../logger.js';
import { createToolPermissionPolicy } from './permission-policy.js';

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
 * @returns {{ hooks: SessionHooks; onPermissionRequest: import('@github/copilot-sdk').PermissionHandler }}
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

    const policy = createToolPermissionPolicy({
        allowTools: [...autoAllow],
        denyTools: [...autoDeny],
        defaultDecision: 'ask',
        askFallbackInPermissionRequest: 'deny',
        label: 'preset/interactive',
        auditLog: true,
    });
    const onPermissionRequest = policy.onPermissionRequest;

    const onErrorOccurred = createErrorHandler({
        maxRetries: 1,
        strategy: (input) => (input.recoverable ? 'retry' : 'skip'),
        onError: (input) => {
            log('WARN', `[preset/interactive] error [${input.errorContext}]: ${input.error}`);
        },
    });

    /** @type {SessionHooks} */
    const hooks = {
        async onPreToolUse(input, invocation) {
            const name = input.toolName.toLowerCase();

            const decision = policy.decide(name);

            if (decision === 'deny') {
                log('WARN', `[preset/interactive] tool NEGADA automaticamente: ${input.toolName}`);
                return { permissionDecision: 'deny' };
            }

            if (decision === 'allow') {
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

        onErrorOccurred,
    };

    return { hooks, onPermissionRequest };
}
