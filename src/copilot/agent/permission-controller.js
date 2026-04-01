// @ts-check
/**
 * src/copilot/agent/permission-controller.js
 *
 * Controlador de modo de permissão SDK em runtime. Encapsula a lógica de troca de `PermissionHandler` entre os modos
 * `approve_all`, `audit_only` e `selective` — sem reiniciar o agente.
 *
 * Extrai responsabilidade de `always-alive.js` para isolar o ciclo de vida da permissão.
 *
 * @module copilot/agent/permission-controller
 */

import { createAuditOnlyPermission, createPermissionHandler } from '#copilot/lib/permissions';
import { log } from '#core/logger';
import { approveAll } from '@github/copilot-sdk';

// ─── Typedefs ────────────────────────────────────────────────────────────────

/**
 * Modos de aprovação de ferramentas suportados.
 *
 * - `"approve_all"` — aprova tudo automaticamente (SDK `approveAll`, padrão)
 * - `"audit_only"` — aprova tudo mas loga cada decisão para auditoria
 * - `"selective"` — whitelist/blacklist + callback customizado
 *
 * @typedef {'approve_all' | 'audit_only' | 'selective'} PermissionMode
 */

/**
 * Opções para configurar o modo `selective`.
 *
 * @typedef {Object} SelectiveModeOpts
 * @property {string[]} [allowTools] - Lista de ferramentas explicitamente permitidas
 * @property {string[]} [denyTools] - Lista de ferramentas explicitamente negadas
 * @property {boolean} [denyShell] - Negar ferramentas de shell (`run_shell_command`, `run_npm_script`,
 *   `run_node_script`)
 */

// ─── PermissionController ─────────────────────────────────────────────────────

/**
 * Gerencia o modo de permissão de ferramentas SDK em runtime.
 *
 * Responsabilidades:
 *
 * - Manter o `PermissionHandler` ativo consistente com o modo configurado
 * - Expor `getMode()` e `setMode()` como interface de controle
 * - Emitir callback `onModeChanged` quando o modo é alterado
 *
 * O `PermissionHandler` é aplicado na **próxima** reconexão/criação de sessão SDK. Sessões já ativas não percebem a
 * mudança até o próximo `initOrResumeSession`.
 */
export class PermissionController {
    /** @type {import('@github/copilot-sdk').PermissionHandler} */
    #handler = approveAll;

    /** @type {PermissionMode} */
    // G2-DX-12: modo padrão configurável via AGENT_PERMISSION_MODE env var.
    #mode = /** @type {PermissionMode} */ (process.env['AGENT_PERMISSION_MODE'] ?? 'approve_all');

    /**
     * Callback invocado após cada troca de modo. Pode ser usado pelo AlwaysAliveAgent para emitir eventos
     * `'permission.mode_changed'` no EventEmitter sem criar dependência circular.
     *
     * @type {((mode: PermissionMode) => void) | undefined}
     */
    #onModeChanged;

    /**
     * @param {{ onModeChanged?: (mode: PermissionMode) => void }} [opts]
     */
    constructor(opts = {}) {
        this.#onModeChanged = opts.onModeChanged;
    }

    // ─── Getters ─────────────────────────────────────────────────────────────

    /**
     * Retorna o modo de permissão ativo.
     *
     * @returns {PermissionMode}
     */
    getMode() {
        return this.#mode;
    }

    /**
     * Retorna o `PermissionHandler` ativo para passar ao `initOrResumeSession`.
     *
     * @returns {import('@github/copilot-sdk').PermissionHandler}
     */
    get handler() {
        return this.#handler;
    }

    // ─── Setters ─────────────────────────────────────────────────────────────

    /**
     * Altera o modo de aprovação de tools em runtime — sem reiniciar o agente.
     *
     * A mudança é aplicada na próxima reconexão/reinício real de sessão. Para sessões já ativas, apenas novos
     * `initOrResumeSession` usarão o handler atualizado.
     *
     * O dialog loop não é uma tool e não passa por este handler.
     *
     * @param {PermissionMode} mode - Modo de aprovação desejado
     * @param {SelectiveModeOpts} [opts] - Opções para o modo `selective`
     * @returns {void}
     */
    setMode(mode, opts = {}) {
        const { allowTools, denyTools, denyShell } = opts;
        switch (mode) {
            case 'approve_all':
                this.#handler = approveAll;
                this.#mode = 'approve_all';
                break;
            case 'audit_only':
                this.#handler = createAuditOnlyPermission();
                this.#mode = 'audit_only';
                break;
            case 'selective': {
                // G2-DX-13: lista de ferramentas shell configurável via AGENT_DENY_SHELL_TOOLS env var.
                const defaultShellTools = ['run_shell_command', 'run_npm_script', 'run_node_script'];
                const shellTools = process.env['AGENT_DENY_SHELL_TOOLS']
                    ? process.env['AGENT_DENY_SHELL_TOOLS']
                          .split(',')
                          .map((t) => t.trim())
                          .filter(Boolean)
                    : defaultShellTools;
                /** @type {import('#copilot/lib/permissions').PermissionHandlerConfig} */
                const cfg = {
                    denyTools: [...(denyShell ? shellTools : []), ...(denyTools ?? [])],
                    auditMode: true,
                };
                if (allowTools?.length) cfg.allowTools = allowTools;
                this.#handler = createPermissionHandler(cfg);
                this.#mode = 'selective';
                break;
            }
            default:
                log('WARN', `[PermissionController] setMode: modo inv\u00e1lido '${/** @type {string} */ (mode)}'`);
                return;
        }
        log(
            'INFO',
            `[PermissionController] Modo de permissão alterado para '${mode}'. Nota: a mudança é aplicada imediatamente e afeta apenas requisições futuras nesta sessão.`,
        );
        this.#onModeChanged?.(mode);
    }
}
