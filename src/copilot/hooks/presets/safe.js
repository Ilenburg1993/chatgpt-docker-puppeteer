// @ts-check
/**
 * src/copilot/hooks/presets/safe.js
 *
 * Preset seguro: permite leitura mas pede confirmação ("ask") antes de writes/shell. Baseado na política de segurança
 * padrão do projeto: bloquear tools destrutivas opcionalmente.
 *
 * @module copilot/hooks/presets/safe
 * @see EventBus
 */

import { createErrorHandler } from '../error-handler.js';
import { log } from '../logger.js';
import { createPermissionHandler } from '../permission-handler.js';

/**
 * @typedef {import('../types.js').SessionHooks} SessionHooks
 *
 * @typedef {import('../types.js').OnPermissionRequestCallback} OnPermissionRequestCallback
 */

/**
 * @typedef {object} SafePresetOptions
 * @property {string[]} [extraDenyTools] Tools adicionais a bloquear explicitamente.
 * @property {string[]} [askOnTools] Tools que devem retornar 'ask' em vez de 'deny'.
 * @property {boolean} [auditLog] Se true, loga tudo no audit. Default: true.
 */

/**
 * Preset seguro: leitura liberada, operações destrutivas pedem confirmação via 'ask'. Equivalente funcional ao
 * `createSafeHooks` mas isolado como módulo de preset.
 *
 * @example
 *     const { hooks, onPermissionRequest } = createSafePreset({
 *         extraDenyTools: ['delete_all'],
 *     });
 *
 * @param {SafePresetOptions} [opts]
 * @returns {{ hooks: SessionHooks; onPermissionRequest: import('../permission-handler.js').PermissionHandler }}
 */
export function createSafePreset(opts = {}) {
    const { extraDenyTools = [], askOnTools = [], auditLog = true } = opts;

    const DEFAULT_ASK_TOOLS = new Set([
        'shell',
        'bash',
        'run_command',
        'execute',
        'write_file',
        'create_file',
        'delete_file',
        'rename_file',
        'git_push',
        'git_force_push',
        'send_message',
        'send_email',
        ...askOnTools.map((t) => t.toLowerCase()),
    ]);

    const DENY_TOOLS = new Set(['rm_rf', 'drop_table', 'wipe_data', ...extraDenyTools.map((t) => t.toLowerCase())]);

    // onPermissionRequest espelha a lógica do onPreToolUse:
    // DENY_TOOLS → nega, DEFAULT_ASK_TOOLS → nega (ask não disponível em permissionRequest), demais → aprova.
    const onPermissionRequest = createPermissionHandler({
        onRequest: (req) => {
            const name =
                /** @type {{ toolName?: string; tool?: string }} */ (req)?.toolName?.toLowerCase() ??
                /** @type {{ toolName?: string; tool?: string }} */ (req)?.tool?.toLowerCase() ??
                'unknown';
            if (DENY_TOOLS.has(name) || DEFAULT_ASK_TOOLS.has(name)) {
                if (auditLog) log('WARN', `[preset/safe] onPermissionRequest: tool '${name}' NEGADA`);
                return false;
            }
            if (auditLog) log('DEBUG', `[preset/safe] onPermissionRequest: tool '${name}' APROVADA`);
            return true;
        },
    });

    const onErrorOccurred = createErrorHandler({
        maxRetries: 2,
        strategy: (input) => (input.recoverable ? 'retry' : 'abort'),
        onError: (input) => {
            log('WARN', `[preset/safe] error [${input.errorContext}]: ${input.error}`);
        },
    });

    /** @type {SessionHooks} */
    const hooks = {
        async onPreToolUse(input, invocation) {
            const name = input.toolName.toLowerCase();

            if (DENY_TOOLS.has(name)) {
                log('WARN', `[preset/safe] tool '${input.toolName}' NEGADA por política`);
                return { permissionDecision: 'deny' };
            }

            if (DEFAULT_ASK_TOOLS.has(name)) {
                if (auditLog) {
                    log(
                        'INFO',
                        `[preset/safe] tool '${input.toolName}' requer confirmação (ask) [${invocation?.sessionId}]`,
                    );
                }
                return { permissionDecision: 'ask' };
            }

            if (auditLog) {
                log('DEBUG', `[preset/safe] tool '${input.toolName}' permitida`);
            }
            return { permissionDecision: 'allow' };
        },

        async onPostToolUse(input) {
            if (auditLog) {
                log('DEBUG', `[preset/safe] onPostToolUse: ${input.toolName}`);
            }
            return {};
        },

        async onUserPromptSubmitted() {
            return {};
        },

        async onSessionStart(input) {
            log('INFO', `[preset/safe] session started — source: ${input.source ?? 'unknown'}`);
            return {};
        },

        async onSessionEnd() {
            log('INFO', '[preset/safe] session ended');
        },

        onErrorOccurred,
    };

    return { hooks, onPermissionRequest };
}
