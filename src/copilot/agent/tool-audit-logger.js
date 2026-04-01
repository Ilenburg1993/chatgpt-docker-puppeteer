// @ts-check
/**
 * src/copilot/agent/tool-audit-logger.js
 *
 * Logging de auditoria de ferramentas SDK e construção do PermissionHandler com auditoria automática.
 *
 * Responsabilidades:
 *
 * - `logToolAudit`: registra decisões de permissão (approve/deny) no JSONL `logs/tool-audit.jsonl`
 * - `isHighRiskTool`: classifica ferramentas como alto risco (bash, edit, create, git_apply_patch)
 * - `buildAuditingPermissionHandler`: envolve um PermissionHandler base com logging de auditoria
 *
 * Distinto de `channel/audit.js`, que registra tool calls SDK (start/complete com durationMs). Ambos escrevem em
 * `logs/tool-audit.jsonl` como registros complementares.
 *
 * @module copilot/agent/tool-audit-logger
 */

import { log } from '#core/logger';
import { approveAll } from '@github/copilot-sdk';
import { appendFile, mkdir, rename, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const TOOL_AUDIT_LOG = join(resolve(import.meta.dirname, '../../..'), 'logs', 'tool-audit.jsonl');
const ROTATE_LOG = TOOL_AUDIT_LOG + '.1';
const MAX_LOG_BYTES = 10 * 1024 * 1024; // 10 MB

// ─── Classificação de risco ───────────────────────────────────────────────────

/**
 * Nomes de ferramentas consideradas de alto risco. Decisões sobre estas ferramentas são sempre logadas explicitamente,
 * independentemente do resultado.
 *
 * @type {ReadonlySet<string>}
 */
const HIGH_RISK_TOOLS = new Set(['bash', 'edit', 'create', 'git_apply_patch']);

/**
 * Retorna `true` se a ferramenta é classificada como alto risco.
 *
 * @param {string} toolName
 * @returns {boolean}
 */
export function isHighRiskTool(toolName) {
    return HIGH_RISK_TOOLS.has(toolName);
}

// ─── JSONL de auditoria ───────────────────────────────────────────────────────

/**
 * Registra uma decisão de permissão de ferramenta no JSONL de auditoria.
 *
 * Opera de forma assíncrona fire-and-forget para não bloquear o event loop. Rotaciona o log quando o arquivo ultrapassa
 * `MAX_LOG_BYTES` (10 MB), preservando a versão anterior em `.1`.
 *
 * @param {{ tool: string; decision: 'approved' | 'denied'; highRisk: boolean }} entry
 * @returns {void}
 */
export function logToolAudit(entry) {
    const line = JSON.stringify({ ...entry, ts: new Date().toISOString() }) + '\n';

    void (async () => {
        try {
            await mkdir(join(TOOL_AUDIT_LOG, '..'), { recursive: true });
            try {
                const { size } = await stat(TOOL_AUDIT_LOG);
                if (size >= MAX_LOG_BYTES) await rename(TOOL_AUDIT_LOG, ROTATE_LOG);
            } catch {
                // arquivo não existe ainda — ok
            }
            await appendFile(TOOL_AUDIT_LOG, line, 'utf8');
        } catch {
            // falha no log de auditoria não deve interromper a sessão
        }
    })();
}

// ─── PermissionHandler com auditoria ─────────────────────────────────────────

/**
 * Cria um `PermissionHandler` que envolve `baseHandler` com logging de auditoria automático.
 *
 * Aprovações de ferramentas de alto risco geram um log `WARN` adicional. Se `baseHandler` lançar exceção inesperada, o
 * handler faz fallback seguro para `approveAll` do SDK.
 *
 * @param {import('@github/copilot-sdk').PermissionHandler | undefined} baseHandler - Handler base a envolver
 * @returns {import('@github/copilot-sdk').PermissionHandler}
 */
export function buildAuditingPermissionHandler(baseHandler) {
    return /** @type {import('@github/copilot-sdk').PermissionHandler} */ (
        async (request, invocation) => {
            const toolName = /** @type {any} */ (request)?.toolName ?? /** @type {any} */ (request)?.tool ?? 'unknown';
            const highRisk = isHighRiskTool(toolName);

            if (highRisk) {
                log('WARN', `[ToolAudit] Ferramenta de alto risco solicitada: '${toolName}'`);
            }

            /** @type {any} */
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

            if (highRisk && decision === 'approved') {
                log('INFO', `[ToolAudit] Ferramenta alto risco APROVADA: '${toolName}'`);
            }

            return result;
        }
    );
}
