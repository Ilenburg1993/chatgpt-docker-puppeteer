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

import { defaultBus } from '#copilot/hooks/bus';
import { log } from '#copilot/observability/logger';
import { approveAll } from '@github/copilot-sdk';
import { appendFile, mkdir, rename, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';

// G2-SEC-05: path do audit log configurável via COPILOT_AUDIT_LOG_PATH env var.
// Isolado em src/copilot/logs/ por padrão para não poluir o workspace pai.
const TOOL_AUDIT_LOG = process.env['COPILOT_AUDIT_LOG_PATH']
    ? resolve(process.env['COPILOT_AUDIT_LOG_PATH'])
    : join(resolve(import.meta.dirname, '../logs'), 'tool-audit.jsonl');
const ROTATE_LOG = TOOL_AUDIT_LOG + '.1';
// G2-DX-11: limite de tamanho do log configurável via env (default 10MB).
const MAX_LOG_BYTES = Number(process.env['AGENT_TOOL_AUDIT_MAX_LOG_BYTES']) || 10 * 1024 * 1024;

/**
 * G2-PERF-03: Acumula tamanho do log em memória para evitar `stat()` a cada escrita. Inicializado em -1 (desconhecido)
 * — o primeiro `logToolAudit()` faz stat() para sincronizar; chamadas subsequentes usam apenas o acumulador. Resetado
 * para 0 após rotação.
 *
 * @type {number}
 */
let _logBytes = -1;

// ─── Classificação de risco ───────────────────────────────────────────────────

/**
 * Nomes de ferramentas consideradas de alto risco. Decisões sobre estas ferramentas são sempre logadas explicitamente,
 * independentemente do resultado.
 *
 * G2-SEC-04: configurável via COPILOT_HIGH_RISK_TOOLS (lista separada por vírgulas) para cobrir ferramentas novas.
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
    const extra = process.env['COPILOT_HIGH_RISK_TOOLS']
        ? process.env['COPILOT_HIGH_RISK_TOOLS']
              .split(',')
              .map((t) => t.trim())
              .filter(Boolean)
        : [];
    return new Set([...base, ...extra]);
})();

/**
 * Retorna `true` se a ferramenta é classificada como alto risco.
 *
 * @example
 *     if (isHighRiskTool('shell_exec')) log('WARN', 'high risk tool');
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
 * @example
 *     logToolAudit({ tool: 'read_file', decision: 'approved', highRisk: false });
 *
 * @param {{ tool: string; decision: 'approved' | 'denied'; highRisk: boolean }} entry
 * @returns {void}
 */
export function logToolAudit(entry) {
    const line = JSON.stringify({ ...entry, ts: new Date().toISOString() }) + '\n';
    const lineBytes = Buffer.byteLength(line, 'utf8');

    void (async () => {
        try {
            await mkdir(join(TOOL_AUDIT_LOG, '..'), { recursive: true });
            // G2-PERF-03: sincronizar acumulador de bytes no primeiro acesso
            if (_logBytes < 0) {
                try {
                    const { size } = await stat(TOOL_AUDIT_LOG);
                    _logBytes = size;
                } catch {
                    _logBytes = 0;
                }
            }
            if (_logBytes + lineBytes >= MAX_LOG_BYTES) {
                await rename(TOOL_AUDIT_LOG, ROTATE_LOG);
                _logBytes = 0;
            }
            await appendFile(TOOL_AUDIT_LOG, line, 'utf8');
            _logBytes += lineBytes;
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
 * @example
 *     const handler = buildAuditingPermissionHandler(approveAll);
 *
 * @param {import('@github/copilot-sdk').PermissionHandler | undefined} baseHandler - Handler base a envolver
 * @returns {import('@github/copilot-sdk').PermissionHandler}
 */
export function buildAuditingPermissionHandler(baseHandler) {
    return /** @type {import('@github/copilot-sdk').PermissionHandler} */ (
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

            // O.2: emitir evento no HookBus para observadores SSE (Fase P).
            // O sessionId pode ser string vazia em contextos sem sessão ativa.
            const sessionId =
                typeof (/** @type {any} */ (invocation)?.sessionId) === 'string'
                    ? /** @type {any} */ (invocation).sessionId
                    : '';
            defaultBus.emitHook('permission_request', sessionId, { toolName, highRisk }, { decision });

            if (highRisk && decision === 'approved') {
                log('INFO', `[ToolAudit] Ferramenta alto risco APROVADA: '${toolName}'`);
            }

            return result;
        }
    );
}
