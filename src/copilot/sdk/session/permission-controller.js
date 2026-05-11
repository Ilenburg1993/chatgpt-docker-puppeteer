// @ts-check
/**
 * Controlador de modo de permissão SDK em runtime.
 *
 * Encapsula a troca de `PermissionHandler` entre os modos `approve_all`, `audit_only` e `selective`, sem reiniciar
 * sessão/agent.
 *
 * @module copilot/sdk/session/permission-controller
 */

import { AGENT_DENY_SHELL_TOOLS } from '#copilot/config';
import { log } from '../logger.js';
import {
    DEFAULT_PERMISSION_MODE,
    normalizePermissionMode,
    sanitizeToolNames,
    TOOL_NAME_RE,
} from './permission-runtime.js';
import { approveAll, createPermissionHandler } from './permissions.js';

/**
 * @typedef {'approve_all' | 'audit_only' | 'selective'} PermissionMode
 *
 * @typedef {{
 *     allowTools?: string[];
 *     denyTools?: string[];
 *     denyShell?: boolean;
 * }} SelectiveModeOpts
 */

/**
 * @returns {PermissionMode}
 */
function readInitialPermissionMode() {
    return /** @type {PermissionMode} */ (normalizePermissionMode(process.env['AGENT_PERMISSION_MODE']));
}

/**
 * @typedef {{
 *     mode: PermissionMode;
 *     allowTools: string[];
 *     denyTools: string[];
 *     denyShell: boolean;
 *     defaultDecision: 'allow' | 'deny';
 * }} PermissionPolicySnapshot
 */

export class PermissionController {
    /** @type {import('../types.js').PermissionHandler} */
    #policyHandler = approveAll;

    /** @type {import('../types.js').PermissionHandler} */
    #handler = (request, invocation) => this.#policyHandler(request, invocation);

    /** @type {PermissionMode} */
    #mode = readInitialPermissionMode();

    /** @type {PermissionPolicySnapshot} */
    #snapshot = {
        mode: DEFAULT_PERMISSION_MODE,
        allowTools: [],
        denyTools: [],
        denyShell: false,
        defaultDecision: 'allow',
    };

    /** @type {((mode: PermissionMode) => void) | undefined} */
    #onModeChanged;

    /**
     * @param {{ onModeChanged?: (mode: PermissionMode) => void }} [opts]
     */
    constructor(opts = {}) {
        this.#onModeChanged = opts.onModeChanged;
        if (!this.#applyMode(this.#mode, {}, false)) {
            this.#applyMode('approve_all', {}, false);
        }
    }

    /**
     * @returns {PermissionMode}
     */
    getMode() {
        return this.#mode;
    }

    /**
     * @returns {PermissionPolicySnapshot}
     */
    getPolicySnapshot() {
        return {
            mode: this.#snapshot.mode,
            allowTools: [...this.#snapshot.allowTools],
            denyTools: [...this.#snapshot.denyTools],
            denyShell: this.#snapshot.denyShell,
            defaultDecision: this.#snapshot.defaultDecision,
        };
    }

    /**
     * @returns {import('../types.js').PermissionHandler}
     */
    get handler() {
        return this.#handler;
    }

    /**
     * @param {PermissionMode} mode
     * @param {SelectiveModeOpts} [opts]
     * @returns {void}
     */
    setMode(mode, opts = {}) {
        this.#applyMode(mode, opts, true);
    }

    /**
     * @param {PermissionMode} mode
     * @param {SelectiveModeOpts} opts
     * @param {boolean} notify
     * @returns {boolean}
     */
    #applyMode(mode, opts, notify) {
        const allowTools = sanitizeToolNames(opts.allowTools);
        const denyTools = sanitizeToolNames(opts.denyTools);
        const denyShell = opts.denyShell;

        switch (mode) {
            case 'approve_all':
                this.#policyHandler = approveAll;
                this.#mode = 'approve_all';
                this.#snapshot = {
                    mode: 'approve_all',
                    allowTools: [],
                    denyTools: [],
                    denyShell: false,
                    defaultDecision: 'allow',
                };
                break;
            case 'audit_only':
                this.#policyHandler = createPermissionHandler({ auditMode: true });
                this.#mode = 'audit_only';
                this.#snapshot = {
                    mode: 'audit_only',
                    allowTools: [],
                    denyTools: [],
                    denyShell: false,
                    defaultDecision: 'allow',
                };
                break;
            case 'selective': {
                const defaultShellTools = ['run_shell_command', 'run_npm_script', 'run_node_script'];
                const shellTools = AGENT_DENY_SHELL_TOOLS
                    ? AGENT_DENY_SHELL_TOOLS.split(',')
                          .map((t) => t.trim())
                          .filter((t) => Boolean(t) && TOOL_NAME_RE.test(t))
                    : defaultShellTools;
                const hasAllowRules = allowTools.length > 0;
                const hasDenyRules = denyTools.length > 0;
                const effectiveDenyShell =
                    denyShell === true || (!hasAllowRules && !hasDenyRules && denyShell !== false);

                if (!hasAllowRules && !hasDenyRules && denyShell !== true) {
                    log(
                        'WARN',
                        '[PermissionController] selective sem regras explícitas — aplicando baseline seguro denyShell=true.',
                    );
                }

                /** @type {import('./permissions.js').PermissionHandlerConfig} */
                const cfg = {
                    denyKinds: effectiveDenyShell ? ['shell'] : [],
                    denyTools: [...(effectiveDenyShell ? shellTools : []), ...denyTools],
                    auditMode: true,
                };
                if (hasAllowRules) cfg.allowTools = allowTools;

                this.#policyHandler = createPermissionHandler(cfg);
                this.#mode = 'selective';
                this.#snapshot = {
                    mode: 'selective',
                    allowTools,
                    denyTools,
                    denyShell: effectiveDenyShell,
                    defaultDecision: 'allow',
                };
                break;
            }
            default:
                log('WARN', `[PermissionController] setMode: modo inválido '${/** @type {string} */ (mode)}'`);
                return false;
        }

        if (notify) {
            log(
                'INFO',
                `[PermissionController] Modo de permissão alterado para '${mode}'. Mudança afeta requisições futuras da sessão ativa.`,
            );
            this.#onModeChanged?.(mode);
        }

        return true;
    }
}
