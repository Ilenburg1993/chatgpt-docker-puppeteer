// @ts-check
/**
 * src/copilot/audit/pipeline-permission.js
 *
 * Permission Audit Logger — logging de decisões de permissão de ferramentas + classificação de alto risco.
 * Ex-`agent/infra/tool-audit-logger.js`, consolidado no pipeline de auditoria.
 *
 * @module copilot/audit/pipeline-permission
 * @see EventBus
 */

import { SHUTDOWN_PRIORITY, logSwallowed, registerShutdownHandler, toError } from '#copilot/core';
import { PERMISSION_COMPLETED_KINDS, PERMISSION_RESULTS } from '#copilot/sdk/constants';
import { join, resolve } from 'node:path';
import { createJsonlFileWriter } from '../infra/io/jsonl-file-writer.js';
import { getLogDir, log } from './logger.js';

/** @param {string} key @param {number} def @returns {number} */
const envInt = (key, def) => {
    const v = parseInt(process.env[key] ?? '', 10);
    return Number.isFinite(v) ? v : def;
};
/** @param {string} key @returns {string} */
const envOpt = (key) => process.env[key] ?? '';

const COPILOT_AUDIT_LOG_PATH = envOpt('COPILOT_AUDIT_LOG_PATH');
const COPILOT_HIGH_RISK_TOOLS = envOpt('COPILOT_HIGH_RISK_TOOLS');
const COPILOT_TOOL_PERMISSIONS_LOG = envOpt('COPILOT_TOOL_PERMISSIONS_LOG');
const TOOL_AUDIT_MAX_LOG_BYTES = envInt('AGENT_TOOL_AUDIT_MAX_LOG_BYTES', 10 * 1024 * 1024);

// ─── Event bus (injetado em runtime via setAuditBus) ─────────────────────────

/** @type {{ emitHook: (name: string, sessionId: string, input: unknown, output?: unknown) => void } | null} */
let _bus = null;

/**
 * Injeta o event bus (hooks/bus). Chamado no bootstrap.
 *
 * @param {{ emitHook: (name: string, sessionId: string, input: unknown, output?: unknown) => void }} bus
 */
export function setAuditBus(bus) {
    if (bus && typeof bus.emitHook === 'function') _bus = bus;
}

// ─── Permission audit log ────────────────────────────────────────────────────

const TOOL_PERMISSIONS_LOG = COPILOT_TOOL_PERMISSIONS_LOG
    ? resolve(COPILOT_TOOL_PERMISSIONS_LOG)
    : COPILOT_AUDIT_LOG_PATH
      ? resolve(COPILOT_AUDIT_LOG_PATH)
      : join(resolve(getLogDir()), 'tool-permissions-audit.jsonl');
const MAX_LOG_BYTES = TOOL_AUDIT_MAX_LOG_BYTES;
const permissionAuditWriter = createJsonlFileWriter({
    filePath: TOOL_PERMISSIONS_LOG,
    maxBytes: MAX_LOG_BYTES,
    maxQueueLines: 10_000,
    softQueueLines: 8_000,
    flushToDisk: true,
    onError: (error) => logSwallowed(error, 'audit.pipeline.logPermission'),
});

/**
 * Nomes de ferramentas consideradas de alto risco.
 *
 * @type {ReadonlySet<string>}
 */
const HIGH_RISK_TOOLS = (() => {
    const base = [
        'bash',
        'edit',
        'create',
        'git_apply_patch',
        'run_shell_command',
        'run_npm_script',
        'run_node_script',
        'execute_code',
        'computer',
    ];
    const extra = COPILOT_HIGH_RISK_TOOLS
        ? COPILOT_HIGH_RISK_TOOLS.split(',')
              .map((t) => t.trim())
              .filter(Boolean)
        : [];
    return new Set([...base, ...extra]);
})();

/**
 * Retorna `true` se a ferramenta é classificada como alto risco.
 *
 * @param {string} toolName
 * @returns {boolean}
 */
export function isHighRiskTool(toolName) {
    return HIGH_RISK_TOOLS.has(toolName);
}

/**
 * Registra uma decisão de permissão de ferramenta no JSONL de auditoria.
 *
 * @param {{ tool: string; decision: 'approved' | 'denied'; highRisk: boolean }} entry
 * @returns {void}
 */
export function logToolAudit(entry) {
    const line = JSON.stringify({ type: 'tool.permission', ...entry, ts: new Date().toISOString() }) + '\n';
    permissionAuditWriter.enqueueLine(line);
}

registerShutdownHandler(
    'audit.permission.flush',
    async () => {
        try {
            await permissionAuditWriter.flush();
        } catch (error) {
            logSwallowed(error, 'audit.pipeline.flushPermission');
        }
    },
    SHUTDOWN_PRIORITY.AUDIT_FINALIZER,
);

/**
 * @param {unknown} kind
 * @returns {boolean}
 */
function isApprovedPermissionKind(kind) {
    return (
        kind === PERMISSION_RESULTS.APPROVE_ONCE ||
        kind === PERMISSION_RESULTS.APPROVE_FOR_SESSION ||
        kind === PERMISSION_RESULTS.APPROVE_FOR_LOCATION ||
        kind === PERMISSION_COMPLETED_KINDS.APPROVED ||
        kind === PERMISSION_COMPLETED_KINDS.APPROVED_FOR_SESSION ||
        kind === PERMISSION_COMPLETED_KINDS.APPROVED_FOR_LOCATION
    );
}

/**
 * Cria um `PermissionHandler` que envolve `baseHandler` com logging de auditoria automático.
 *
 * @param {import('#copilot/sdk/types').PermissionHandler | undefined} baseHandler
 * @returns {import('#copilot/sdk/types').PermissionHandler}
 */
export function buildAuditingPermissionHandler(baseHandler) {
    return /** @type {import('#copilot/sdk/types').PermissionHandler} */ (
        async (request, invocation) => {
            const toolName =
                /** @type {{ toolName?: string; tool?: string }} */ (request)?.toolName ??
                /** @type {{ toolName?: string; tool?: string }} */ (request)?.tool ??
                'unknown';
            const highRisk = isHighRiskTool(toolName);

            if (highRisk) {
                log('WARN', `[ToolAudit] Ferramenta de alto risco solicitada: '${toolName}'`);
            }

            /** @type {{ kind?: string } | undefined} */
            let result;
            if (baseHandler) {
                try {
                    result = await baseHandler(request, invocation);
                } catch (err) {
                    log('WARN', `[ToolAudit] baseHandler lançou exceção (fallback deny): ${toError(err).message}`);
                    result = { kind: PERMISSION_RESULTS.REJECT };
                }
            } else {
                log('WARN', '[ToolAudit] baseHandler ausente (fallback deny).');
                result = { kind: PERMISSION_RESULTS.REJECT };
            }

            const decision = isApprovedPermissionKind(result?.kind) ? 'approved' : 'denied';
            logToolAudit({ tool: toolName, decision, highRisk });

            const sessionId = typeof invocation?.sessionId === 'string' ? invocation.sessionId : '';
            _bus?.emitHook('permission_request', sessionId, { toolName, highRisk }, { decision });

            if (highRisk && decision === 'approved') {
                log('INFO', `[ToolAudit] Ferramenta alto risco APROVADA: '${toolName}'`);
            }

            return result;
        }
    );
}
