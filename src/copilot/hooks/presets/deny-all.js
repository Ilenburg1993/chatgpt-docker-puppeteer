// @ts-check
/**
 * src/copilot/hooks/presets/deny-all.js
 *
 * Preset deny-all: bloqueia todas as tools. Útil para modo read-only ou análise estática.
 *
 * @module copilot/hooks/presets/deny-all
 */

import { log } from '#copilot/observability';
import { createPermissionHandler } from '../permission-handler.js';

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
 * @returns {{ hooks: SessionHooks; onPermissionRequest: import('../permission-handler.js').PermissionHandler }}
 */
export function createDenyAllPreset(opts = {}) {
    const { exceptTools = [] } = opts;
    const allowed = new Set(exceptTools.map((t) => t.toLowerCase()));

    // onPermissionRequest: usa allowTools para forçar deny para tudo que não está na lista.
    // Quando exceptTools é vazio, allowTools recebe lista vazia — o que pelo contrato de
    // createPermissionHandler (step 3: allowTools.length > 0) só ativa a whitelist se não-vazia.
    // Por isso usamos onRequest para garantir deny incondicional quando nenhuma exceção existe,
    // e whitelist estrita quando há exceções.
    const onPermissionRequest =
        exceptTools.length > 0
            ? createPermissionHandler({ allowTools: exceptTools })
            : createPermissionHandler({
                  onRequest: (_) => {
                      log('WARN', '[preset/deny-all] onPermissionRequest: tool NEGADA (deny-all)');
                      return false; // false → makeDenied()
                  },
              });

    /** @type {SessionHooks} */
    const hooks = {
        async onPreToolUse(input, invocation) {
            const name = input.toolName.toLowerCase();
            if (allowed.has(name)) {
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

        async onErrorOccurred(input) {
            log('ERROR', `[preset/deny-all] error [${input.errorContext}]: ${input.error}`);
            return { errorHandling: /** @type {'abort'} */ ('abort') };
        },
    };

    return { hooks, onPermissionRequest };
}
