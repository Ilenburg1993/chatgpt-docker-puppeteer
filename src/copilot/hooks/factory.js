// @ts-check
/**
 * src/copilot/hooks/factory.js
 *
 * Factory principal para SessionHooks do Copilot SDK. Fornece factories configuráveis para os 6 slots do SDK:
 * onPreToolUse, onPostToolUse, onUserPromptSubmitted, onSessionStart, onSessionEnd, onErrorOccurred
 *
 * Migrado de src/copilot/lib/hooks.js — esse arquivo é mantido como re-export de compatibilidade.
 *
 * @module copilot/hooks/factory
 * @see EventBus
 * @see module:copilot/hooks/types
 * @see module:copilot/hooks/composer
 */

import { toError } from '../core/error-handlers.js';
import { createErrorHandler } from './error-handler.js';
import { log } from './logger.js';
import { isDynamicOnly } from './tool-filter.js';

/**
 * @typedef {import('./types.js').SessionHooks} SessionHooks
 *
 * @typedef {import('./types.js').HooksConfig} HooksConfig
 *
 * @typedef {import('./types.js').PreToolUseHandler} PreToolUseHandler
 *
 * @typedef {import('./types.js').PostToolUseHandler} PostToolUseHandler
 *
 * @typedef {import('./types.js').PreMcpToolCallHandler} PreMcpToolCallHandler
 *
 * @typedef {import('./types.js').PostToolUseFailureHandler} PostToolUseFailureHandler
 *
 * @typedef {import('./types.js').UserPromptSubmittedHandler} UserPromptSubmittedHandler
 *
 * @typedef {import('./types.js').SessionStartHandler} SessionStartHandler
 *
 * @typedef {import('./types.js').SessionEndHandler} SessionEndHandler
 *
 * @typedef {import('./types.js').ErrorOccurredHandler} ErrorOccurredHandler
 *
 * @typedef {import('./types.js').PreToolUseHookInput} PreToolUseHookInput
 *
 * @typedef {import('./types.js').PostToolUseHookInput} PostToolUseHookInput
 *
 * @typedef {import('./types.js').PreMcpToolCallHookInput} PreMcpToolCallHookInput
 *
 * @typedef {import('./types.js').PostToolUseFailureHookInput} PostToolUseFailureHookInput
 *
 * @typedef {import('./types.js').UserPromptSubmittedHookInput} UserPromptSubmittedHookInput
 *
 * @typedef {import('./types.js').SessionStartHookInput} SessionStartHookInput
 *
 * @typedef {import('./types.js').SessionEndHookInput} SessionEndHookInput
 *
 * @typedef {import('./types.js').ErrorOccurredHookInput} ErrorOccurredHookInput
 *
 * @typedef {import('./types.js').InvocationContext} InvocationContext
 */

// ─── Helpers internos ────────────────────────────────────────────────────────

/**
 * @param {string} toolName
 * @param {string[]} allowTools
 * @param {string[]} denyTools
 * @param {RegExp[]} denyPatterns
 * @returns {'allow' | 'deny'}
 */
function resolveToolDecision(toolName, allowTools, denyTools, denyPatterns) {
    // 1. denyTools tem precedência absoluta
    if (denyTools.includes(toolName)) return 'deny';

    // 2. denyPatterns como segunda precedência
    for (const pattern of denyPatterns) {
        pattern.lastIndex = 0; // Reset para safety com regex /g (stateful)
        if (pattern.test(toolName)) return 'deny';
    }

    // 3. allowTools como whitelist — se definido, só ferramentas explícitas passam
    if (allowTools.length > 0 && !allowTools.includes(toolName)) return 'deny';

    return 'allow';
}

/**
 * @param {{ traceparent?: string; tracestate?: string }} input
 * @returns {string}
 */
function hookTraceSuffix(input) {
    const traceparent = typeof input.traceparent === 'string' ? input.traceparent.slice(0, 80) : '';
    const tracestate = typeof input.tracestate === 'string' ? input.tracestate.slice(0, 80) : '';
    return [traceparent ? `traceparent='${traceparent}'` : null, tracestate ? `tracestate='${tracestate}'` : null]
        .filter(Boolean)
        .join(' ');
}

// ─── Handler builders ────────────────────────────────────────────────────────

/**
 * Constrói o handler `onPreToolUse` padrão com lógica de allow/deny/ask.
 *
 * @param {object} opts
 * @param {string[]} opts.allowTools
 * @param {string[]} opts.denyTools
 * @param {RegExp[]} opts.denyPatterns
 * @param {boolean} opts.auditLog
 * @param {boolean} opts.debugTools
 * @param {((toolName: string) => Promise<boolean>) | null} opts.askHandler
 * @param {((toolName: string, args: object) => object | null | undefined) | null} opts.argsModifier
 * @returns {PreToolUseHandler}
 */
function buildPreToolUseHandler({
    allowTools,
    denyTools,
    denyPatterns,
    auditLog,
    debugTools,
    askHandler,
    argsModifier,
}) {
    const preToolFn = async (/** @type {PreToolUseHookInput} */ input, /** @type {InvocationContext} */ invocation) => {
        const toolName = input.toolName ?? 'unknown';

        // Verificar askHandler ANTES de resolveToolDecision para dar chance de aprovação interativa.
        // Se a tool não está em denyTools mas também não está em allowTools, delegamos ao askHandler.
        // Usamos permissionDecision:'ask' (SDK-native) ao invés de callback manual.
        if (askHandler) {
            const explicitlyDenied =
                denyTools.includes(toolName) ||
                denyPatterns.some((p) => {
                    p.lastIndex = 0;
                    return p.test(toolName);
                });
            const inAllowList = allowTools.length === 0 || allowTools.includes(toolName);
            if (!explicitlyDenied && !inAllowList) {
                // Tool não é deny-explícito nem allow-explícito → pede aprovação via callback
                let approved = false;
                try {
                    approved = await askHandler(toolName);
                } catch (e) {
                    log(
                        'WARN',
                        `[hooks/factory] onPermissionAsk lançou erro para '${toolName}': ${toError(e).message} — negando`,
                    );
                }
                if (!approved) {
                    return {
                        permissionDecision: /** @type {'deny'} */ ('deny'),
                        additionalContext: `Ferramenta '${toolName}' não aprovada pelo usuário.`,
                    };
                }
                // askHandler aprovou → early return com allow (bypass resolveToolDecision)
                if (auditLog || debugTools) {
                    log(
                        'DEBUG',
                        `[hooks/factory] onPreToolUse: tool='${toolName}' decision='allow' (askHandler) sessionId='${invocation?.sessionId}' ${hookTraceSuffix(input)}`.trim(),
                    );
                }
                return { permissionDecision: /** @type {'allow'} */ ('allow') };
            }
        }

        const decision = resolveToolDecision(toolName, allowTools, denyTools, denyPatterns);

        if (auditLog || debugTools) {
            log(
                'DEBUG',
                `[hooks/factory] onPreToolUse: tool='${toolName}' decision='${decision}' sessionId='${invocation?.sessionId}' ${hookTraceSuffix(input)}`.trim(),
            );
        }

        if (decision === 'deny') {
            return {
                permissionDecision: /** @type {'deny'} */ ('deny'),
                additionalContext: `Ferramenta '${toolName}' não é permitida pela política de hooks.`,
            };
        }

        // GAP-HOOK-001: aplicar modificação de args quando argsModifier estiver configurado
        if (argsModifier) {
            const modified = argsModifier(toolName, /** @type {object} */ (input.toolArgs) ?? {});
            if (modified != null) {
                return { permissionDecision: /** @type {'allow'} */ ('allow'), modifiedArgs: modified };
            }
        }

        return { permissionDecision: /** @type {'allow'} */ ('allow') };
    };
    return /** @type {PreToolUseHandler} */ (preToolFn);
}

/**
 * E1.2 — Handler simplificado para cenários onde o filtering estático foi extraído para
 * `availableTools`/`excludedTools` do SDK. Mantém apenas lógica dinâmica: askHandler, argsModifier e audit logging.
 *
 * @param {object} opts
 * @param {boolean} opts.auditLog
 * @param {boolean} opts.debugTools
 * @param {((toolName: string) => Promise<boolean>) | null} opts.askHandler
 * @param {((toolName: string, args: object) => object | null | undefined) | null} opts.argsModifier
 * @returns {PreToolUseHandler}
 */
function buildDynamicOnlyPreToolUseHandler({ auditLog, debugTools, askHandler, argsModifier }) {
    const dynamicFn = async (/** @type {PreToolUseHookInput} */ input, /** @type {InvocationContext} */ invocation) => {
        const toolName = input.toolName ?? 'unknown';

        if (auditLog || debugTools) {
            log(
                'DEBUG',
                `[hooks/factory] onPreToolUse (dynamic): tool='${toolName}' sessionId='${invocation?.sessionId}' ${hookTraceSuffix(input)}`.trim(),
            );
        }

        // askHandler: aprovação interativa
        if (askHandler) {
            let approved = false;
            try {
                approved = await askHandler(toolName);
            } catch (e) {
                log(
                    'WARN',
                    `[hooks/factory] onPermissionAsk lançou erro para '${toolName}': ${toError(e).message} — negando`,
                );
            }
            if (!approved) {
                return {
                    permissionDecision: /** @type {'deny'} */ ('deny'),
                    additionalContext: `Ferramenta '${toolName}' não aprovada pelo usuário.`,
                };
            }
        }

        // argsModifier: transformação de argumentos
        if (argsModifier) {
            const modified = argsModifier(toolName, /** @type {object} */ (input.toolArgs) ?? {});
            if (modified != null) {
                return { permissionDecision: /** @type {'allow'} */ ('allow'), modifiedArgs: modified };
            }
        }

        return { permissionDecision: /** @type {'allow'} */ ('allow') };
    };
    return /** @type {PreToolUseHandler} */ (dynamicFn);
}

/**
 * Constrói o handler `onErrorOccurred` padrão com logging de WARN e estratégia de retry automático.
 *
 * @returns {ErrorOccurredHandler}
 */
function buildErrorOccurredHandler() {
    return createErrorHandler({
        maxRetries: 3,
        strategy: (input) => {
            if (input.recoverable && input.errorContext === 'tool_execution') {
                return 'skip';
            }
            return input.recoverable ? 'retry' : 'abort';
        },
        onError: (input, invocation) => {
            const { error, errorContext, recoverable } = input;
            if (recoverable && errorContext === 'tool_execution') {
                log(
                    'WARN',
                    `[hooks/factory] onErrorOccurred tool recuperável: ${error} — skip sessionId='${invocation?.sessionId}'`,
                );
                return;
            }
            if (recoverable) {
                log(
                    'WARN',
                    `[hooks/factory] onErrorOccurred recuperável (${errorContext}): ${error} — retry automático sessionId='${invocation?.sessionId}'`,
                );
                return;
            }
            log(
                'WARN',
                `[hooks/factory] onErrorOccurred não-recuperável (${errorContext}): ${error} — abort sessionId='${invocation?.sessionId}'`,
            );
        },
    });
}

// ─── Factory principal ───────────────────────────────────────────────────────

/**
 * Cria um objeto `SessionHooks` configurável para uso com `createSession()` ou `resumeSession()`.
 *
 * O resultado é compatível com {@link import('../core/interfaces.js').IHooksPipeline IHooksPipeline} (Faixa 3.2 —
 * AC-5-05).
 *
 * Os handlers customizados passados via `cfg` substituem os defaults. Se não forem passados, são construídos baseados
 * nas listas `allowTools`/`denyTools`/`denyPatterns` e `auditLog`.
 *
 * @example
 *     const hooks = createHooks({ auditLog: true, denyTools: ['rm_rf', 'shell_exec'] });
 *     await client.createSession({ hooks, model: 'gpt-4.1' });
 *
 * @param {HooksConfig} [cfg={}] - Configuração dos hooks. Default is `{}`
 * @returns {SessionHooks}
 * @see module:copilot/core/interfaces
 */
export function createHooks(cfg = {}) {
    const auditLog = cfg.auditLog ?? false;
    const debugTools = cfg.debugTools ?? false;
    const allowTools = cfg.allowTools ?? [];
    const denyTools = cfg.denyTools ?? [];
    const denyPatterns = cfg.denyPatterns ?? [];
    const askHandler = cfg.onPermissionAsk ?? null;
    const argsModifier = cfg.argsModifier ?? null;

    /** @type {SessionHooks} */
    const hooks = {};

    // ── onPreToolUse ────────────────────────────────────────────────────────
    if (cfg.onPreToolUse) {
        hooks.onPreToolUse = cfg.onPreToolUse;
    } else if (isDynamicOnly(cfg)) {
        // E1.2: sem allowTools/denyTools/denyPatterns → handler simplificado
        hooks.onPreToolUse = buildDynamicOnlyPreToolUseHandler({
            auditLog,
            debugTools,
            askHandler,
            argsModifier,
        });
    } else {
        hooks.onPreToolUse = buildPreToolUseHandler({
            allowTools,
            denyTools,
            denyPatterns,
            auditLog,
            debugTools,
            askHandler,
            argsModifier,
        });
    }

    // ── onPreMcpToolCall ─────────────────────────────────────────────────────
    if (cfg.onPreMcpToolCall) {
        hooks.onPreMcpToolCall = cfg.onPreMcpToolCall;
    } else if (auditLog) {
        const preMcpFn = async (
            /** @type {PreMcpToolCallHookInput} */ input,
            /** @type {InvocationContext} */ invocation,
        ) => {
            log(
                'DEBUG',
                `[hooks/factory] onPreMcpToolCall: server='${input.serverName}' tool='${input.toolName}' sessionId='${invocation?.sessionId}' ${hookTraceSuffix(input)}`.trim(),
            );
        };
        hooks.onPreMcpToolCall = /** @type {PreMcpToolCallHandler} */ (preMcpFn);
    }

    // ── onPostToolUse ────────────────────────────────────────────────────────
    if (cfg.onPostToolUse) {
        hooks.onPostToolUse = cfg.onPostToolUse;
    } else if (auditLog) {
        const postToolFn = async (
            /** @type {PostToolUseHookInput} */ input,
            /** @type {InvocationContext} */ invocation,
        ) => {
            log(
                'DEBUG',
                `[hooks/factory] onPostToolUse: tool='${input.toolName}' sessionId='${invocation?.sessionId}' ${hookTraceSuffix(input)}`.trim(),
            );
        };
        hooks.onPostToolUse = /** @type {PostToolUseHandler} */ (postToolFn);
    }

    // ── onPostToolUseFailure ─────────────────────────────────────────────────
    if (cfg.onPostToolUseFailure) {
        hooks.onPostToolUseFailure = cfg.onPostToolUseFailure;
    } else if (auditLog) {
        const postToolFailureFn = async (
            /** @type {PostToolUseFailureHookInput} */ input,
            /** @type {InvocationContext} */ invocation,
        ) => {
            const errorPreview = String(input.error ?? '').slice(0, 120);
            log(
                'DEBUG',
                `[hooks/factory] onPostToolUseFailure: tool='${input.toolName}' error='${errorPreview}' sessionId='${invocation?.sessionId}' ${hookTraceSuffix(input)}`.trim(),
            );
        };
        hooks.onPostToolUseFailure = /** @type {PostToolUseFailureHandler} */ (postToolFailureFn);
    }

    // ── onUserPromptSubmitted ─────────────────────────────────────────────────
    if (cfg.onUserPromptSubmitted) {
        hooks.onUserPromptSubmitted = cfg.onUserPromptSubmitted;
    } else if (auditLog) {
        const promptFn = async (
            /** @type {UserPromptSubmittedHookInput} */ input,
            /** @type {InvocationContext} */ invocation,
        ) => {
            const preview = String(input.prompt ?? '').slice(0, 80);
            log(
                'DEBUG',
                `[hooks/factory] onUserPromptSubmitted: prompt='${preview}...' sessionId='${invocation?.sessionId}'`,
            );
        };
        hooks.onUserPromptSubmitted = /** @type {UserPromptSubmittedHandler} */ (promptFn);
    }

    // ── onSessionStart ────────────────────────────────────────────────────────
    if (cfg.onSessionStart) {
        hooks.onSessionStart = cfg.onSessionStart;
    } else if (auditLog) {
        const startFn = async (
            /** @type {SessionStartHookInput} */ input,
            /** @type {InvocationContext} */ invocation,
        ) => {
            log(
                'DEBUG',
                `[hooks/factory] onSessionStart: source='${input.source}' sessionId='${invocation?.sessionId}'`,
            );
        };
        hooks.onSessionStart = /** @type {SessionStartHandler} */ (startFn);
    }

    // ── onSessionEnd ─────────────────────────────────────────────────────────
    if (cfg.onSessionEnd) {
        hooks.onSessionEnd = cfg.onSessionEnd;
    } else if (auditLog) {
        const endFn = async (/** @type {SessionEndHookInput} */ input, /** @type {InvocationContext} */ invocation) => {
            log('DEBUG', `[hooks/factory] onSessionEnd: reason='${input.reason}' sessionId='${invocation?.sessionId}'`);
        };
        hooks.onSessionEnd = /** @type {SessionEndHandler} */ (endFn);
    }

    // ── onErrorOccurred ───────────────────────────────────────────────────────
    if (cfg.onErrorOccurred) {
        hooks.onErrorOccurred = cfg.onErrorOccurred;
    } else {
        hooks.onErrorOccurred = buildErrorOccurredHandler();
    }

    return hooks;
}

// ─── Presets prontos para uso ────────────────────────────────────────────────

/**
 * Cria hooks com auditLog desativado e sem restrições de ferramentas. Loga tools em DEBUG para auditoria de segurança
 * mínima em produção.
 *
 * @example
 *     const hooks = createMinimalHooks();
 *
 * @returns {SessionHooks}
 */
export function createMinimalHooks() {
    return createHooks({ debugTools: true });
}

/**
 * Cria hooks com auditLog completo de todos os eventos.
 *
 * @example
 *     const hooks = createAuditHooks();
 *
 * @returns {SessionHooks}
 */
export function createAuditHooks() {
    return createHooks({ auditLog: true });
}

/**
 * Cria hooks que negam todas as ferramentas (sessão read-only sem execução).
 *
 * @example
 *     const hooks = createDenyAllHooks();
 *
 * @returns {SessionHooks}
 */
export function createDenyAllHooks() {
    const denyHandler = async () => ({
        permissionDecision: /** @type {'deny'} */ ('deny'),
        additionalContext: 'Ferramentas desabilitadas nesta sessão.',
    });
    return createHooks({
        auditLog: true,
        onPreToolUse: /** @type {PreToolUseHandler} */ (denyHandler),
    });
}

/**
 * Cria hooks com whitelist de ferramentas seguras (apenas leitura).
 *
 * @example
 *     const hooks = createSafeHooks(['web_search']);
 *
 * @param {string[]} [extraAllowed] - Ferramentas adicionais a permitir além do conjunto padrão
 * @returns {SessionHooks}
 */
export function createSafeHooks(extraAllowed = []) {
    return createHooks({
        auditLog: true,
        allowTools: ['read_file', 'list_dir', 'grep_search', 'semantic_search', 'file_search', ...extraAllowed],
    });
}

/**
 * Constrói um hook onPreToolUse que combina múltiplos handlers em sequência. O primeiro handler que retornar um
 * resultado com `permissionDecision` encerra a cadeia.
 *
 * @example
 *     const hook = composePreToolUseHandlers(auditHandler, denyHandler);
 *
 * @param {...PreToolUseHandler} handlers
 * @returns {PreToolUseHandler}
 */
export function composePreToolUseHandlers(...handlers) {
    const composedFn = async (
        /** @type {PreToolUseHookInput} */ input,
        /** @type {InvocationContext} */ invocation,
    ) => {
        for (const handler of handlers) {
            const result = await handler(input, invocation);
            if (result?.permissionDecision) return result;
        }
        return undefined;
    };
    return /** @type {PreToolUseHandler} */ (composedFn);
}

/**
 * Constrói um hook onErrorOccurred que notifica via callback customizado.
 *
 * @example
 *     const hook = createErrorNotifierHook((err, ctx) => console.error(ctx, err));
 *
 * @param {(
 *     error: string | Error,
 *     context: string,
 *     recoverable: boolean,
 *     sessionId: string,
 * ) => void | Promise<void>} onError
 * @returns {ErrorOccurredHandler}
 */
export function createErrorNotifierHook(onError) {
    const fn = async (/** @type {ErrorOccurredHookInput} */ input, /** @type {InvocationContext} */ invocation) => {
        await onError(input.error, input.errorContext, input.recoverable, invocation?.sessionId ?? '');
    };
    return /** @type {ErrorOccurredHandler} */ (fn);
}
