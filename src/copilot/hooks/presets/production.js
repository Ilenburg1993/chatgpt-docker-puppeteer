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
 * @see EventBus
 */

import { defaultAuditLog } from '#copilot/audit';
import { WORKSPACE_ROOT } from '#copilot/boot';
import { isToolDisabled as defaultIsToolDisabled } from '#copilot/tools';
import os from 'node:os';
import { createCircuitBreakerHandler } from '../error-handler.js';
import { createPromptTransformer } from '../prompt-transformer.js';
import { createToolPermissionPolicy } from './permission-policy.js';

const SENSITIVE_TOOL_NAMES = new Set([
    'run_shell_command',
    'run_node_script',
    'run_npm_script',
    'shell.exec',
    'shell.exec_command',
]);

const PERMANENT_DENY_ARG_PATTERNS = [
    /\brm\s+-rf\b/i,
    /:\(\)\s*\{\s*:\|:&\s*\};:/,
    /\bmkfs(?:\.[a-z0-9_+-]+)?\b/i,
    /\bdd\s+if=/i,
    /\bshutdown\b/i,
    /\breboot\b/i,
    /\bcurl\b[^\n|]{0,400}\|\s*(?:sh|bash)\b/i,
    /\bwget\b[^\n|]{0,400}\|\s*(?:sh|bash)\b/i,
];

/**
 * @param {unknown} toolArgs
 * @returns {string}
 */
function _stringifyToolArgs(toolArgs) {
    if (typeof toolArgs === 'string') return toolArgs;
    try {
        return JSON.stringify(toolArgs);
    } catch {
        return String(toolArgs ?? '');
    }
}

/**
 * Retorna o pattern destrutivo encontrado em toolArgs, quando aplicável.
 *
 * @param {string} toolName
 * @param {unknown} toolArgs
 * @returns {string | null}
 */
function _matchPermanentDenyPattern(toolName, toolArgs) {
    if (!SENSITIVE_TOOL_NAMES.has(toolName)) return null;
    const serializedArgs = _stringifyToolArgs(toolArgs);
    for (const pattern of PERMANENT_DENY_ARG_PATTERNS) {
        if (pattern.test(serializedArgs)) return pattern.source;
    }
    return null;
}

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
 * @property {(entry: ProductionAuditEntry) => void} [auditSink] - Destino do audit log. Padrão: `defaultAuditLog`
 *   estruturado.
 * @property {(toolName: string) => boolean} [isToolDisabled] - Predicate para verificar se tool foi desabilitada em
 *   runtime. Padrão: sempre false.
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
 *     import { createProductionHooks } from '#copilot/hooks';
 *
 *     const { hooks, onPermissionRequest } = createProductionHooks({
 *         toolAllowList: ['read_file', 'list_dir', 'web_search'],
 *         errorNotifier: (err, ctx) => Sentry.captureException(err, { extra: { ctx } }),
 *     });
 *
 * @param {ProductionPresetOptions} [opts]
 * @returns {{ hooks: SessionHooks; onPermissionRequest: import('@github/copilot-sdk').PermissionHandler }}
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
        isToolDisabled = defaultIsToolDisabled,
    } = opts;

    if (toolAllowList.length === 0) {
        console.warn('[preset/production] toolAllowList vazia — onPreToolUse ficará permissivo (allow-all).');
    }

    if (piiPatterns.length === 0) {
        console.warn('[preset/production] piiPatterns vazio — prompts não terão redação de PII por padrão.');
    }

    /**
     * @param {ProductionAuditEntry} entry
     */
    function audit(entry) {
        if (auditSink) {
            try {
                auditSink(entry);
            } catch (sinkError) {
                // UPG-PROD-001: falha no sink não deve ser silenciosa — registra via console
                console.warn(
                    `[preset/production] auditSink falhou para ${entry.hookName}: ${/** @type {Error} */ (sinkError).message ?? sinkError}`,
                );
            }
        } else {
            defaultAuditLog.record({
                type: 'hooks.production',
                ...(entry.sessionId ? { sessionId: entry.sessionId } : {}),
                data: entry,
            });
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
     * @returns {import('../types.js').PreToolUseHookOutput}
     */
    function onPreToolUse(input, invocation) {
        const { toolName, toolArgs } = input;
        const explicitlyAllowed = toolAllowList.includes(toolName);
        const isSensitiveTool = SENSITIVE_TOOL_NAMES.has(toolName);
        const matchedPermanentDenyPattern = _matchPermanentDenyPattern(toolName, toolArgs);
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
                meta: { reason: 'runtime_disabled' },
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
                meta: { reason: 'deny_list' },
            });
            return { permissionDecision: 'deny' };
        }

        if (matchedPermanentDenyPattern) {
            audit({
                ts: Date.now(),
                hookName: 'onPreToolUse',
                sessionId: invocation?.sessionId,
                toolName,
                decision: 'deny',
                meta: {
                    reason: 'permanent_dangerous_pattern',
                    pattern: matchedPermanentDenyPattern,
                },
            });
            return {
                permissionDecision: 'deny',
                additionalContext:
                    '[production] Execução bloqueada por regra permanente: comando com assinatura destrutiva detectada.',
            };
        }

        if (isSensitiveTool && !explicitlyAllowed) {
            audit({
                ts: Date.now(),
                hookName: 'onPreToolUse',
                sessionId: invocation?.sessionId,
                toolName,
                decision: 'ask',
                meta: { reason: 'sensitive_tool_default_guard' },
            });
            return { permissionDecision: 'ask' };
        }

        if (toolAllowList.length > 0 && !toolAllowList.includes(toolName)) {
            audit({
                ts: Date.now(),
                hookName: 'onPreToolUse',
                sessionId: invocation?.sessionId,
                toolName,
                decision: 'ask',
                meta: { reason: 'not_in_allow_list' },
            });
            return { permissionDecision: 'ask' };
        }

        audit({
            ts: Date.now(),
            hookName: 'onPreToolUse',
            sessionId: invocation?.sessionId,
            toolName,
            decision: 'allow',
            meta: { reason: explicitlyAllowed ? 'allow_list' : 'default_allow' },
        });

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
                    ? String(/** @type {{ content: unknown }} */ (toolResult).content).length
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
            cwd: input.cwd ?? WORKSPACE_ROOT,
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
        console.info(
            `[preset/production] sessão encerrada: reason='${input.reason}' sessionId='${invocation?.sessionId}'`,
        );
    }

    // ── onErrorOccurred ───────────────────────────────────────────────────────

    const circuitBreaker = createCircuitBreakerHandler({
        maxRetries: circuitBreakerMaxRetries,
        resetAfterMs: circuitBreakerResetMs,
        fatalPatterns: ['ERR_SOCKET_CLOSED', 'ERR_IPC_CHANNEL_CLOSED', 'ERR_IPC_DISCONNECTED', 'SESSION_FATAL'],
        transientPatterns: [
            'ECONNREFUSED',
            'ETIMEDOUT',
            'ECONNRESET',
            'EPIPE',
            'ENOTFOUND',
            'EAI_AGAIN',
            '429',
            '502',
            '503',
            '504',
        ],
        onError: (input) => {
            if (errorNotifier) {
                try {
                    errorNotifier(new Error(input.error), input.errorContext);
                } catch (_) {
                    // ignora
                }
            }
        },
        onTrip: (ctx) => {
            console.warn(`[preset/production] circuit breaker ativado para '${ctx}'`);
        },
    });

    // ── onPermissionRequest ───────────────────────────────────────────────────

    // production usa createToolPermissionPolicy para consistência com onPreToolUse
    // defaultDecision = 'ask' se toolAllowList presente (conservative), senão 'allow'
    const _permPolicy = createToolPermissionPolicy({
        allowTools: toolAllowList,
        denyTools: toolDenyList,
        defaultDecision: toolAllowList.length > 0 ? 'ask' : 'allow',
        askFallbackInPermissionRequest: 'deny',
        label: 'preset/production',
        auditLog: true,
    });
    const onPermissionRequest = _permPolicy.onPermissionRequest;

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
