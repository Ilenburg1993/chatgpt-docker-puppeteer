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
 * @see module:copilot/hooks/types
 * @see module:copilot/hooks/composer
 */

import { log } from '#copilot/observability/logger';

/**
 * @typedef {import('./types.js').SessionHooks} SessionHooks
 *
 * @typedef {import('./types.js').HooksConfig} HooksConfig
 *
 * @typedef {import('./types.js').PreToolUseHandler} PreToolUseHandler
 *
 * @typedef {import('./types.js').PostToolUseHandler} PostToolUseHandler
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
        if (pattern.test(toolName)) return 'deny';
    }

    // 3. allowTools como whitelist — se definido, só ferramentas explícitas passam
    if (allowTools.length > 0 && !allowTools.includes(toolName)) return 'deny';

    return 'allow';
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
 * @returns {PreToolUseHandler}
 */
function buildPreToolUseHandler({ allowTools, denyTools, denyPatterns, auditLog, debugTools, askHandler }) {
    const preToolFn = async (/** @type {PreToolUseHookInput} */ input, /** @type {InvocationContext} */ invocation) => {
        const toolName = input.toolName ?? 'unknown';
        const decision = resolveToolDecision(toolName, allowTools, denyTools, denyPatterns);

        if (auditLog || debugTools) {
            log(
                'DEBUG',
                `[hooks/factory] onPreToolUse: tool='${toolName}' decision='${decision}' sessionId='${invocation?.sessionId}'`,
            );
        }

        if (decision === 'deny') {
            return {
                permissionDecision: /** @type {'deny'} */ ('deny'),
                additionalContext: `Ferramenta '${toolName}' não é permitida pela política de hooks.`,
            };
        }

        if (askHandler && allowTools.length > 0 && !allowTools.includes(toolName)) {
            let approved = false;
            try {
                approved = await askHandler(toolName);
            } catch (/** @type {any} */ e) {
                log('WARN', `[hooks/factory] onPermissionAsk lançou erro para '${toolName}': ${e.message} — negando`);
            }
            if (!approved) {
                return {
                    permissionDecision: /** @type {'deny'} */ ('deny'),
                    additionalContext: `Ferramenta '${toolName}' negada pelo callback onPermissionAsk.`,
                };
            }
        }

        return { permissionDecision: /** @type {'allow'} */ ('allow') };
    };
    return /** @type {PreToolUseHandler} */ (preToolFn);
}

/**
 * Constrói o handler `onErrorOccurred` padrão com logging de WARN e estratégia de retry automático.
 *
 * @returns {ErrorOccurredHandler}
 */
function buildErrorOccurredHandler() {
    const fn = async (/** @type {ErrorOccurredHookInput} */ input, /** @type {InvocationContext} */ invocation) => {
        const { error, errorContext, recoverable } = input ?? {};
        if (recoverable && errorContext === 'model_call') {
            log(
                'WARN',
                `[hooks/factory] onErrorOccurred recuperável (${errorContext}): ${error} — retry automático sessionId='${invocation?.sessionId}'`,
            );
            return { errorHandling: /** @type {'retry'} */ ('retry'), retryCount: 3 };
        }
        if (recoverable && errorContext === 'tool_execution') {
            log(
                'WARN',
                `[hooks/factory] onErrorOccurred tool recuperável: ${error} — skip sessionId='${invocation?.sessionId}'`,
            );
            return { errorHandling: /** @type {'skip'} */ ('skip') };
        }
        log(
            'WARN',
            `[hooks/factory] onErrorOccurred não-recuperável (${errorContext}): ${error} — abort sessionId='${invocation?.sessionId}'`,
        );
        return { errorHandling: /** @type {'abort'} */ ('abort') };
    };
    return /** @type {ErrorOccurredHandler} */ (fn);
}

// ─── Factory principal ───────────────────────────────────────────────────────

/**
 * Cria um objeto `SessionHooks` configurável para uso com `createSession()` ou `resumeSession()`.
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
 */
export function createHooks(cfg = {}) {
    const auditLog = cfg.auditLog ?? false;
    const debugTools = cfg.debugTools ?? false;
    const allowTools = cfg.allowTools ?? [];
    const denyTools = cfg.denyTools ?? [];
    const denyPatterns = cfg.denyPatterns ?? [];
    const askHandler = cfg.onPermissionAsk ?? null;

    /** @type {SessionHooks} */
    const hooks = {};

    // ── onPreToolUse ────────────────────────────────────────────────────────
    if (cfg.onPreToolUse) {
        hooks.onPreToolUse = cfg.onPreToolUse;
    } else {
        hooks.onPreToolUse = buildPreToolUseHandler({
            allowTools,
            denyTools,
            denyPatterns,
            auditLog,
            debugTools,
            askHandler,
        });
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
                `[hooks/factory] onPostToolUse: tool='${input.toolName}' sessionId='${invocation?.sessionId}'`,
            );
        };
        hooks.onPostToolUse = /** @type {PostToolUseHandler} */ (postToolFn);
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
