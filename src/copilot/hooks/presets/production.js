// @ts-check
/**
 * src/copilot/hooks/presets/production.js
 *
 * Preset de produção: combinação robusta de todos os módulos hooks para uso em ambiente real.
 *
 * Características:
 *
 * - onPreToolUse: allowlist obrigatória com interceptor de args + audit via bus
 * - onPostToolUse: enriquecedor de resultado com additionalContext rico
 * - onUserPromptSubmitted: sanitização de PII + truncamento de prompt
 * - onSessionStart: additionalContext com cwd, modelo, hostname, nodeVersion
 * - onSessionEnd: métricas no audit trail
 * - onErrorOccurred: circuit-breaker com notificação configurável
 * - onPermissionRequest: modo restrito — toolAllowList com ask para o resto
 *
 * @module copilot/hooks/presets/production
 */

import { log } from '#copilot/observability/logger';
import { isToolDisabled } from '#copilot/tools/introspection-tools';
import os from 'node:os';
import { createCircuitBreakerHandler } from '../error-handler.js';
import { createPermissionHandler } from '../permission-handler.js';
import { createPromptTransformer } from '../prompt-transformer.js';

/**
 * @typedef {import('../types.js').SessionHooks} SessionHooks
 *
 * @typedef {import('../types.js').PreToolUseHookInput} PreToolUseHookInput
 *
 * @typedef {import('../types.js').PostToolUseHookInput} PostToolUseHookInput
 *
 * @typedef {import('../types.js').SessionStartHookInput} SessionStartHookInput
 *
 * @typedef {import('../types.js').SessionEndHookInput} SessionEndHookInput
 *
 * @typedef {import('../types.js').InvocationContext} InvocationContext
 *
 * @typedef {import('../types.js').HookBusEvent} HookBusEvent
 */

/**
 * @typedef {object} ProductionPresetOptions
 * @property {string[]} [toolAllowList] - Só estas tools são permitidas sem pedir confirmação. Vazio = allow all.
 * @property {string[]} [toolDenyList] - Tools sempre negadas (prevalece sobre allowList).
 * @property {RegExp[]} [piiPatterns] - Padrões PII a redatar antes de qualquer log de prompt.
 * @property {number} [maxPromptLength] - Tamanho máximo do prompt antes de truncar. Padrão: 50000 chars.
 * @property {(error: unknown, context: string) => void} [errorNotifier] - Notificação externa de erros.
 * @property {{ emit: (event: HookBusEvent) => void } | null} [bus] - HookBus para observabilidade.
 * @property {number} [circuitBreakerMaxRetries] - Máx retries antes de abrir o circuit. Padrão: 3.
 * @property {number} [circuitBreakerResetMs] - Tempo de reset do circuit em ms. Padrão: 60000.
 * @property {(entry: ProductionAuditEntry) => void} [auditSink] - Destino do audit log. Padrão: core/logger.
 */

/**
 * @typedef {object} ProductionAuditEntry
 * @property {number} ts
 * @property {string} hookName
 * @property {string} [sessionId]
 * @property {string} [toolName]
 * @property {string} [decision]
 * @property {unknown} [meta]
 */

/**
 * Preset de produção: combina segurança, auditoria e resiliência em uma configuração pronta para ambientes críticos.
 *
 * @example
 *     import { createProductionHooks } from '#copilot/hooks/presets/production';
 *
 *     const { hooks, onPermissionRequest } = createProductionHooks({
 *         toolAllowList: ['read_file', 'list_dir', 'web_search'],
 *         errorNotifier: (err, ctx) => Sentry.captureException(err, { extra: { ctx } }),
 *     });
 *
 * @param {ProductionPresetOptions} [opts]
 * @returns {{ hooks: SessionHooks; onPermissionRequest: import('../permission-handler.js').PermissionHandler }}
 */
export function createProductionHooks(opts = {}) {
    const {
        toolAllowList = [],
        toolDenyList = [],
        piiPatterns = [],
        maxPromptLength = 50_000,
        errorNotifier,
        bus = null,
        circuitBreakerMaxRetries = 3,
        circuitBreakerResetMs = 60_000,
        auditSink,
    } = opts;

    /**
     * @param {ProductionAuditEntry} entry
     */
    function audit(entry) {
        if (auditSink) {
            try {
                auditSink(entry);
            } catch (sinkError) {
                // UPG-PROD-001: falha no sink não deve ser silenciosa — registra via logger core
                log(
                    'WARN',
                    `[preset/production] auditSink falhou para ${entry.hookName}: ${/** @type {Error} */ (sinkError).message ?? sinkError}`,
                );
            }
        } else {
            log(
                'INFO',
                `[preset/production] ${entry.hookName}${entry.toolName ? ` tool='${entry.toolName}'` : ''}${entry.decision ? ` decision=${entry.decision}` : ''}${entry.sessionId ? ` session=${entry.sessionId}` : ''}`,
            );
        }
    }

    /**
     * @param {HookBusEvent} event
     */
    function emitBus(event) {
        if (bus) {
            try {
                bus.emit(event);
            } catch (_) {
                // ignora erros no bus
            }
        }
    }

    // ── onPreToolUse ──────────────────────────────────────────────────────────

    /**
     * @param {PreToolUseHookInput} input
     * @param {InvocationContext} invocation
     * @returns {{ permissionDecision: 'allow' | 'deny' | 'ask' }}
     */
    function onPreToolUse(input, invocation) {
        const { toolName } = input;

        audit({ ts: Date.now(), hookName: 'onPreToolUse', sessionId: invocation?.sessionId, toolName });
        emitBus({
            hookName: 'pre_tool_use',
            sessionId: invocation?.sessionId ?? '',
            timestamp: Date.now(),
            input,
        });

        // GAP-TOOLS-004: bloquear tools desabilitadas em runtime
        if (isToolDisabled(toolName)) {
            audit({
                ts: Date.now(),
                hookName: 'onPreToolUse',
                sessionId: invocation?.sessionId,
                toolName,
                decision: 'deny',
            });
            return { permissionDecision: 'deny' };
        }

        if (toolDenyList.includes(toolName)) {
            audit({
                ts: Date.now(),
                hookName: 'onPreToolUse',
                sessionId: invocation?.sessionId,
                toolName,
                decision: 'deny',
            });
            return { permissionDecision: 'deny' };
        }

        if (toolAllowList.length > 0 && !toolAllowList.includes(toolName)) {
            audit({
                ts: Date.now(),
                hookName: 'onPreToolUse',
                sessionId: invocation?.sessionId,
                toolName,
                decision: 'ask',
            });
            return { permissionDecision: 'ask' };
        }

        return { permissionDecision: 'allow' };
    }

    // ── onPostToolUse ─────────────────────────────────────────────────────────

    /**
     * @param {PostToolUseHookInput} input
     * @param {InvocationContext} invocation
     * @returns {{ additionalContext?: string }}
     */
    function onPostToolUse(input, invocation) {
        const { toolName, toolResult } = input;
        audit({ ts: Date.now(), hookName: 'onPostToolUse', sessionId: invocation?.sessionId, toolName });
        emitBus({
            hookName: 'post_tool_use',
            sessionId: invocation?.sessionId ?? '',
            timestamp: Date.now(),
            input,
        });

        if (toolResult && typeof toolResult === 'object') {
            const resultSize =
                'content' in toolResult
                    ? String(/** @type {any} */ (toolResult).content).length
                    : JSON.stringify(toolResult).length;
            if (resultSize > 50_000) {
                return {
                    additionalContext: `[production] Resultado de '${toolName}' truncado (${resultSize} chars). Solicite partes específicas se necessário.`,
                };
            }
        }

        return {};
    }

    // ── onUserPromptSubmitted ─────────────────────────────────────────────────

    // Monta transformFn que: (1) redacta PII, (2) trunca se muito longo
    const promptTransformerHook = createPromptTransformer({
        sensitivePattern: piiPatterns.length > 0 ? new RegExp(piiPatterns.map((r) => r.source).join('|'), 'g') : null,
        transformFn:
            maxPromptLength > 0
                ? (p) => (p.length > maxPromptLength ? p.slice(0, maxPromptLength) + '…[truncado]' : null)
                : null,
    });

    // ── onSessionStart ────────────────────────────────────────────────────────

    /**
     * @param {SessionStartHookInput} input
     * @param {InvocationContext} invocation
     * @returns {{ additionalContext: string }}
     */
    function onSessionStart(input, invocation) {
        const ctx = {
            cwd: input.cwd ?? process.cwd(),
            nodeVersion: process.version,
            hostname: os.hostname(),
            platform: process.platform,
            source: input.source,
            sessionId: invocation?.sessionId ?? 'unknown',
            ts: new Date().toISOString(),
        };

        audit({ ts: Date.now(), hookName: 'onSessionStart', sessionId: invocation?.sessionId, meta: ctx });
        emitBus({
            hookName: 'session_start',
            sessionId: invocation?.sessionId ?? '',
            timestamp: Date.now(),
            input,
        });

        return {
            additionalContext: `[production] Sessão iniciada. cwd=${ctx.cwd} | node=${ctx.nodeVersion} | hostname=${ctx.hostname} | source=${ctx.source} | sessionId=${ctx.sessionId}`,
        };
    }

    // ── onSessionEnd ──────────────────────────────────────────────────────────

    /**
     * @param {SessionEndHookInput} input
     * @param {InvocationContext} invocation
     */
    function onSessionEnd(input, invocation) {
        audit({
            ts: Date.now(),
            hookName: 'onSessionEnd',
            sessionId: invocation?.sessionId,
            meta: { reason: input.reason },
        });
        emitBus({
            hookName: 'session_end',
            sessionId: invocation?.sessionId ?? '',
            timestamp: Date.now(),
            input,
        });
        log(
            'INFO',
            `[preset/production] sessão encerrada: reason='${input.reason}' sessionId='${invocation?.sessionId}'`,
        );
    }

    // ── onErrorOccurred ───────────────────────────────────────────────────────

    const circuitBreaker = createCircuitBreakerHandler({
        maxRetries: circuitBreakerMaxRetries,
        resetAfterMs: circuitBreakerResetMs,
        onTrip: (ctx) => {
            log('WARN', `[preset/production] circuit breaker ativado para '${ctx}'`);
            if (errorNotifier) {
                try {
                    errorNotifier(new Error(`Circuit breaker aberto para ${ctx}`), ctx);
                } catch (_) {
                    // ignora
                }
            }
        },
    });

    // ── onPermissionRequest ───────────────────────────────────────────────────

    /** @type {import('../permission-handler.js').PermissionHandlerConfig} */
    const permConfig = { auditMode: true };
    if (toolAllowList.length > 0) permConfig.allowTools = toolAllowList;
    if (toolDenyList.length > 0) permConfig.denyTools = toolDenyList;
    const onPermissionRequest = createPermissionHandler(permConfig);

    /** @type {SessionHooks} */
    const hooks = {
        onPreToolUse,
        onPostToolUse,
        onUserPromptSubmitted: promptTransformerHook,
        onSessionStart,
        onSessionEnd,
        onErrorOccurred: circuitBreaker,
    };

    return { hooks, onPermissionRequest };
}
