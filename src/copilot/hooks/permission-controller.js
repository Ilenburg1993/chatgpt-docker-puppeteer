// @ts-check
/**
 * src/copilot/hooks/permission-controller.js
 *
 * Controlador de modo de permissão SDK em runtime. Encapsula a lógica de troca de `PermissionHandler` entre os modos
 * `approve_all`, `audit_only` e `selective` — sem reiniciar o agente.
 *
 * Extrai responsabilidade de `always-alive.js` para isolar o ciclo de vida da permissão.
 *
 * @module copilot/hooks/permission-controller
 * @see EventBus
 * @see module:copilot/hooks/permission
 * @see module:copilot/tools/permission-tools
 */

import { AGENT_DENY_SHELL_TOOLS } from '#copilot/config';
import { createAuditOnlyPermission, createPermissionHandler } from '#copilot/hooks';
import { log } from '#copilot/observability';
import { approveAll } from '#copilot/sdk';
import { PERMISSION_MODE } from '../config/agent.js';

/** @type {RegExp} */
const TOOL_NAME_RE = /^[a-zA-Z0-9_]+$/;

/**
 * @param {string[] | undefined} names
 * @returns {string[]}
 */
function sanitizeToolNames(names) {
    if (!Array.isArray(names)) return [];
    const unique = new Set();
    for (const raw of names) {
        if (typeof raw !== 'string') continue;
        const normalized = raw.trim();
        if (!normalized || !TOOL_NAME_RE.test(normalized)) continue;
        unique.add(normalized);
    }
    return [...unique];
}

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
 * O `PermissionHandler` entregue ao SDK é uma função estável que delega para a policy atual. Sessões já ativas passam a
 * usar a nova policy nas próximas requisições de permissão, sem recriar a sessão.
 */
export class PermissionController {
    /** @type {import('#copilot/sdk/types').PermissionHandler} */
    #policyHandler = approveAll;

    /** @type {import('#copilot/sdk/types').PermissionHandler} */
    #handler = (request, invocation) => this.#policyHandler(request, invocation);

    /** @type {PermissionMode} */
    // G2-DX-12: modo padrão configurável via AGENT_PERMISSION_MODE env var.
    #mode = /** @type {PermissionMode} */ (PERMISSION_MODE);

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
        if (!this.#applyMode(this.#mode, {}, false)) {
            this.#applyMode('approve_all', {}, false);
        }
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
     * @returns {import('#copilot/sdk/types').PermissionHandler}
     */
    get handler() {
        return this.#handler;
    }

    // ─── Setters ─────────────────────────────────────────────────────────────

    /**
     * Altera o modo de aprovação de tools em runtime — sem reiniciar o agente.
     *
     * A mudança afeta as próximas requisições de permissão porque o SDK mantém a função `handler` estável, e o
     * controller troca a policy delegada por essa função.
     *
     * O dialog loop não é uma tool e não passa por este handler.
     *
     * @param {PermissionMode} mode - Modo de aprovação desejado
     * @param {SelectiveModeOpts} [opts] - Opções para o modo `selective`
     * @returns {void}
     */
    setMode(mode, opts = {}) {
        this.#applyMode(mode, opts, true);
    }

    /**
     * Aplica a policy mantendo `handler` como função estável, porque o SDK registra o handler na criação/resume da
     * sessão. A troca de modo altera a policy delegada e, assim, afeta próximas requisições de permissão da sessão
     * viva.
     *
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
                break;
            case 'audit_only':
                this.#policyHandler = createAuditOnlyPermission();
                this.#mode = 'audit_only';
                break;
            case 'selective': {
                // G2-DX-13: lista de ferramentas shell configurável via AGENT_DENY_SHELL_TOOLS env var.
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
                /** @type {import('#copilot/hooks/permission').PermissionHandlerConfig} */
                const cfg = {
                    denyKinds: effectiveDenyShell ? ['shell'] : [],
                    denyTools: [...(effectiveDenyShell ? shellTools : []), ...denyTools],
                    auditMode: true,
                };
                if (hasAllowRules) cfg.allowTools = allowTools;
                this.#policyHandler = createPermissionHandler(cfg);
                this.#mode = 'selective';
                break;
            }
            default:
                log('WARN', `[PermissionController] setMode: modo inv\u00e1lido '${/** @type {string} */ (mode)}'`);
                return false;
        }
        if (notify) {
            log(
                'INFO',
                `[PermissionController] Modo de permissão alterado para '${mode}'. Nota: a mudança é aplicada imediatamente e afeta apenas requisições futuras nesta sessão.`,
            );
            this.#onModeChanged?.(mode);
        }
        return true;
    }
}
