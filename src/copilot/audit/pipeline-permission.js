// @ts-check
/**
 * src/copilot/audit/pipeline-permission.js
 *
 * Permission Audit Logger — logging de decisões de permissão de ferramentas + classificação de alto risco.
 * Ex-`agent/infra/tool-audit-logger.js`, consolidado no pipeline de auditoria.
 *
 * @module copilot/audit/pipeline-permission
 */

import { logSwallowed } from '#copilot/core';
import { approveAll } from '#copilot/sdk';
import { appendFile, mkdir, rename, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
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
const PERMISSIONS_ROTATE_LOG = TOOL_PERMISSIONS_LOG + '.1';
const MAX_LOG_BYTES = TOOL_AUDIT_MAX_LOG_BYTES;

let _permLogBytes = -1;

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
    const lineBytes = Buffer.byteLength(line, 'utf8');

    void (async () => {
        try {
            await mkdir(join(TOOL_PERMISSIONS_LOG, '..'), { recursive: true });
            if (_permLogBytes < 0) {
                try {
                    const { size } = await stat(TOOL_PERMISSIONS_LOG);
                    _permLogBytes = size;
                } catch {
                    _permLogBytes = 0;
                }
            }
            if (_permLogBytes + lineBytes >= MAX_LOG_BYTES) {
                await rename(TOOL_PERMISSIONS_LOG, PERMISSIONS_ROTATE_LOG);
                _permLogBytes = 0;
            }
            await appendFile(TOOL_PERMISSIONS_LOG, line, 'utf8');
            _permLogBytes += lineBytes;
        } catch (/** @type {any} */ e) {
            logSwallowed(e, 'audit.pipeline.logPermission');
        }
    })();
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
                } catch (/** @type {any} */ err) {
                    log('WARN', `[ToolAudit] baseHandler lançou exceção (fallback approveAll): ${err?.message}`);
                    result = await approveAll(request, invocation);
                }
            } else {
                result = await approveAll(request, invocation);
            }

            const decision = result?.kind === 'approved' ? 'approved' : 'denied';
            logToolAudit({ tool: toolName, decision, highRisk });

            const sessionId =
                typeof (/** @type {any} */ (invocation)?.sessionId) === 'string'
                    ? /** @type {any} */ (invocation).sessionId
                    : '';
            _bus?.emitHook('permission_request', sessionId, { toolName, highRisk }, { decision });

            if (highRisk && decision === 'approved') {
                log('INFO', `[ToolAudit] Ferramenta alto risco APROVADA: '${toolName}'`);
            }

            return result;
        }
    );
}
