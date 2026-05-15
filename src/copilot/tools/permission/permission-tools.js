// @ts-check
import { defaultAuditLog } from '#copilot/audit';
import { ConfigError, toError } from '#copilot/core';
import { z } from 'zod';
import { log } from '../infra/logger.js';
import { buildTool } from '../infra/tool-factory.js';
/**
 * src/copilot/tools/permission/permission-tools.js
 *
 * Tools para controle em runtime do modo de aprovação de tools do agente.
 *
 * Expõe ao modelo LLM-B a capacidade de inspecionar e alterar como o agente decide se aprova ou nega execução de cada
 * tool — sem reiniciar o processo.
 *
 * Modos disponíveis:
 *
 * - `approve_all` — aprova tudo automaticamente (comportamento padrão)
 * - `audit_only` — aprova tudo mas loga cada decisão em logs/tool-permissions-audit.jsonl
 * - `selective` — whitelist e/ou blacklist explícitas de tools
 *
 * DL-PERM: o dialog loop não é uma tool e não é controlado por este subsistema.
 *
 * @module copilot/tools/permission/permission-tools
 * @see EventBus
 * @see module:copilot/lib/permissions
 * @see module:copilot/agent/permission-controller
 */

// ─── Injeção de dependência do agent (ARCH-03: break circular dep) ────────────

/**
 * @typedef {{
 *     getPermissionMode(): string;
 *     setPermissionMode(mode: string, opts?: object): void;
 * }} PermissionAgent
 */

/** @type {PermissionAgent | null} */
let _agent = null;

/**
 * Injeta o AlwaysAliveAgent para evitar import circular. Chamado em `bootstrapTools()`.
 *
 * @param {PermissionAgent} agent
 * @param {{ force?: boolean }} [options]
 * @returns {void}
 */
export function setPermissionAgent(agent, options = {}) {
    if (_agent && _agent !== agent && !options.force) {
        log(
            'WARN',
            '[permission-tools] setPermissionAgent ignorado: agent já injetado. Use force=true para reinjeção.',
        );
        return;
    }
    _agent = agent;
}

/**
 * @returns {PermissionAgent}
 * @throws {ConfigError} Se o agent não foi injetado via `setPermissionAgent()`.
 */
function requireAgent() {
    if (!_agent) throw new ConfigError('[permission-tools] agent não injetado — chamar setPermissionAgent() antes.');
    return _agent;
}

// ─── permission_mode_get ──────────────────────────────────────────────────────

/**
 * Tool: permission_mode_get — retorna o modo de aprovação de tools atualmente ativo.
 */
const permissionModeGetTool = buildTool({
    name: 'permission_mode_get',
    description:
        'Retorna o modo de aprovação de tools do agente. ' +
        'Modos: "approve_all" (aprova tudo), "audit_only" (aprova tudo + loga), ' +
        '"selective" (whitelist/blacklist explícita). ' +
        'Use antes de alterar para saber o estado atual.',
    parameters: z.object({}),
    requiresApproval: false,
    handler: async () => {
        const auditId = `perm-get-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        defaultAuditLog.recordToolStart({
            toolCallId: auditId,
            toolName: 'permission.permission_mode_get',
            args: {},
        });
        try {
            const agent = requireAgent();
            const mode = agent.getPermissionMode();
            log('INFO', `[permission_mode_get] modo atual: ${mode}`);
            defaultAuditLog.recordToolComplete({
                toolCallId: auditId,
                success: true,
                resultContent: mode,
            });
            return { mode };
        } catch (err) {
            const message = toError(err).message;
            defaultAuditLog.recordToolComplete({
                toolCallId: auditId,
                success: false,
                resultContent: message,
            });
            return { success: false, error: message };
        }
    },
});

// ─── permission_mode_set ──────────────────────────────────────────────────────

/**
 * Tool: permission_mode_set — altera o modo de aprovação de tools em runtime.
 *
 * A mudança é aplicada imediatamente e passa a valer para próximas requisições de permissão também na sessão corrente
 * (sem necessidade de reconexão/reinício), pois o handler SDK permanece estável e a policy delegada é trocada em
 * runtime.
 *
 * DL-PERM: o dialog loop não passa por este handler — não é possível bloqueá-lo aqui.
 */
const permissionModeSetTool = buildTool({
    name: 'permission_mode_set',
    description:
        'Altera o modo de aprovação de tools do agente em runtime (sem reiniciar). ' +
        'Modos: "approve_all" (padrão — aprova tudo automaticamente), ' +
        '"audit_only" (aprova tudo mas registra cada decisão no audit log), ' +
        '"selective" (usa allowTools e/ou denyTools para controle granular). ' +
        'ATENÇÃO: o dialog loop (DL-PERM) não é uma tool — não é afetado por este modo.',
    parameters: z.object({
        mode: z
            .enum(['approve_all', 'audit_only', 'selective'])
            .describe('Modo de aprovação: "approve_all" | "audit_only" | "selective"'),
        allowTools: z
            .array(z.string())
            .optional()
            .describe(
                'Whitelist de tools permitidas (somente para modo "selective"). ' +
                    'Se definida, somente estas tools são aprovadas.',
            ),
        denyTools: z
            .array(z.string())
            .optional()
            .describe(
                'Blacklist de tools negadas (somente para modo "selective"). ' + 'Ignorada se allowTools for definida.',
            ),
        denyShell: z
            .boolean()
            .optional()
            .default(false)
            .describe(
                'Se true (modo "selective"), bloqueia as shell tools: ' +
                    'run_shell_command, run_npm_script, run_node_script.',
            ),
    }),
    requiresApproval: true,
    handler: async (
        /**
         * @type {{
         *     mode: 'approve_all' | 'audit_only' | 'selective';
         *     allowTools?: string[];
         *     denyTools?: string[];
         *     denyShell?: boolean;
         * }}
         */ { mode, allowTools, denyTools, denyShell },
    ) => {
        const auditId = `perm-set-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        defaultAuditLog.recordToolStart({
            toolCallId: auditId,
            toolName: 'permission.permission_mode_set',
            args: { mode, allowTools, denyTools, denyShell },
        });

        try {
            const agent = requireAgent();
            const before = agent.getPermissionMode();
            /** @type {{ allowTools?: string[]; denyTools?: string[]; denyShell?: boolean }} */
            const opts = {};
            if (allowTools?.length) opts.allowTools = allowTools;
            if (denyTools?.length) opts.denyTools = denyTools;
            if (denyShell) opts.denyShell = denyShell;
            agent.setPermissionMode(mode, opts);
            const after = agent.getPermissionMode();
            log('INFO', `[permission_mode_set] ${before} → ${after}`);
            defaultAuditLog.recordToolComplete({
                toolCallId: auditId,
                success: true,
                resultContent: `${before} -> ${after}`,
            });
            return {
                ok: true,
                before,
                after,
                note:
                    mode === 'approve_all'
                        ? 'Todas as tools serão aprovadas automaticamente.'
                        : mode === 'audit_only'
                          ? 'Todas as tools serão aprovadas, mas cada decisão será registrada no audit log.'
                          : 'Modo seletivo ativo. Use allowTools/denyTools para controle granular.',
            };
        } catch (err) {
            const message = toError(err).message;
            defaultAuditLog.recordToolComplete({
                toolCallId: auditId,
                success: false,
                resultContent: message,
            });
            return { ok: false, error: message };
        }
    },
});

// ─── Exports ──────────────────────────────────────────────────────────────────

/**
 * Lista de tools de controle de permissão.
 *
 * @type {import('#copilot/sdk/types').Tool<any>[]}
 */
export const permissionTools = [permissionModeGetTool, permissionModeSetTool];
