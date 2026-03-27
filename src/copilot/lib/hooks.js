// @ts-check
/**
 * src/copilot/lib/hooks.js
 *
 * Lib para construção de SessionHooks do Copilot SDK. Fornece factories configuráveis para os 6 slots do SDK:
 * onPreToolUse, onPostToolUse, onUserPromptSubmitted, onSessionStart, onSessionEnd, onErrorOccurred
 *
 * Uso típico: import { createHooks } from '#copilot/lib/hooks'; const hooks = createHooks({ auditLog: true, allowTools:
 * ['read_file'] }); const session = await client.createSession({ hooks, ... });
 *
 * @module copilot/lib/hooks
 */

import { log } from '#core/logger';

/**
 * Tipos de hooks do Copilot SDK. Nota: os tipos abaixo são estruturalmente equivalentes aos do SDK mas definidos
 * localmente pois @github/copilot-sdk não re-exporta esses tipos a partir do seu entry point principal.
 *
 * @typedef {object} SessionHooks Configuração de hooks para uma sessão Copilot SDK.
 * @property {PreToolUseHandler} [onPreToolUse]
 * @property {PostToolUseHandler} [onPostToolUse]
 * @property {UserPromptSubmittedHandler} [onUserPromptSubmitted]
 * @property {SessionStartHandler} [onSessionStart]
 * @property {SessionEndHandler} [onSessionEnd]
 * @property {ErrorOccurredHandler} [onErrorOccurred]
 *
 * @typedef {Function} PreToolUseHandler (input: PreToolUseHookInput, invocation: {sessionId:string}) =>
 *   PreToolUseHookOutput|void|Promise<...>
 *
 * @typedef {Function} PostToolUseHandler (input: PostToolUseHookInput, invocation: {sessionId:string}) =>
 *   PostToolUseHookOutput|void|Promise<...>
 *
 * @typedef {Function} UserPromptSubmittedHandler (input, invocation) => void|Promise<void>
 *
 * @typedef {Function} SessionStartHandler (input, invocation) => object|void|Promise<...>
 *
 * @typedef {Function} SessionEndHandler (input, invocation) => void|Promise<void>
 *
 * @typedef {Function} ErrorOccurredHandler (input, invocation) => object|void|Promise<...>
 *
 * @typedef {{ toolName: string; toolArgs: object; timestamp: number; cwd: string }} PreToolUseHookInput
 *
 * @typedef {{ toolName: string; toolArgs: object; toolResult: unknown; timestamp: number; cwd: string }} PostToolUseHookInput
 *
 *
 * @typedef {{ prompt: string; timestamp: number; cwd: string }} UserPromptSubmittedHookInput
 *
 * @typedef {{ source: 'startup' | 'resume' | 'new'; initialPrompt?: string; timestamp: number; cwd: string }} SessionStartHookInput
 *
 *
 * @typedef {{ reason: string; finalMessage?: string; error?: Error; timestamp: number; cwd: string }} SessionEndHookInput
 *
 *
 * @typedef {{ error: Error; errorContext: string; recoverable: boolean; timestamp: number; cwd: string }} ErrorOccurredHookInput
 *
 *
 * @typedef {{ sessionId: string }} InvocationContext
 */

/**
 * @typedef {Object} HooksConfig
 * @property {boolean} [auditLog=false] Se true, cada hook loga os eventos no logger do sistema (nível DEBUG). Default
 *   is `false`
 * @property {string[]} [allowTools] Lista de nomes de ferramentas que devem ser permitidas. Se definida, ferramentas
 *   ausentes nesta lista recebem decisão "deny" em onPreToolUse.
 * @property {string[]} [denyTools] Lista de nomes de ferramentas sempre negadas. Tem precedência sobre allowTools.
 * @property {RegExp[]} [denyPatterns] Padrões regex contra toolName. Qualquer match resulta em "deny".
 * @property {PreToolUseHandler} [onPreToolUse] Handler customizado para pré-execução de ferramenta. Substitui o
 *   comportamento padrão.
 * @property {PostToolUseHandler} [onPostToolUse] Handler customizado para pós-execução de ferramenta.
 * @property {UserPromptSubmittedHandler} [onUserPromptSubmitted] Handler customizado para prompts do usuário.
 * @property {SessionStartHandler} [onSessionStart] Handler customizado para início de sessão.
 * @property {SessionEndHandler} [onSessionEnd] Handler customizado para encerramento de sessão.
 * @property {ErrorOccurredHandler} [onErrorOccurred] Handler customizado para erros.
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
    const allowTools = cfg.allowTools ?? [];
    const denyTools = cfg.denyTools ?? [];
    const denyPatterns = cfg.denyPatterns ?? [];

    /** @type {SessionHooks} */
    const hooks = {};

    // ── onPreToolUse ────────────────────────────────────────────────────────
    if (cfg.onPreToolUse) {
        hooks.onPreToolUse = cfg.onPreToolUse;
    } else {
        const preToolFn = async (
            /** @type {PreToolUseHookInput} */ input,
            /** @type {InvocationContext} */ invocation,
        ) => {
            const toolName = input.toolName ?? 'unknown';
            const decision = resolveToolDecision(toolName, allowTools, denyTools, denyPatterns);

            if (auditLog) {
                log(
                    'DEBUG',
                    `[lib/hooks] onPreToolUse: tool='${toolName}' decision='${decision}' sessionId='${invocation?.sessionId}'`,
                );
            }

            // SDK-01 (fix): incluir additionalContext quando a tool é negada, conforme spec do SDK
            if (decision === 'deny') {
                return {
                    permissionDecision: 'deny',
                    additionalContext: `Ferramenta '${toolName}' não é permitida pela política de hooks.`,
                };
            }
            return { permissionDecision: decision };
        };
        hooks.onPreToolUse = /** @type {PreToolUseHandler} */ (preToolFn);
    }

    // ── onPostToolUse ────────────────────────────────────────────────────────
    if (cfg.onPostToolUse) {
        hooks.onPostToolUse = cfg.onPostToolUse;
    } else if (auditLog) {
        const postToolFn = async (
            /** @type {PostToolUseHookInput} */ input,
            /** @type {InvocationContext} */ invocation,
        ) => {
            log('DEBUG', `[lib/hooks] onPostToolUse: tool='${input.toolName}' sessionId='${invocation?.sessionId}'`);
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
                `[lib/hooks] onUserPromptSubmitted: prompt='${preview}...' sessionId='${invocation?.sessionId}'`,
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
            log('DEBUG', `[lib/hooks] onSessionStart: source='${input.source}' sessionId='${invocation?.sessionId}'`);
        };
        hooks.onSessionStart = /** @type {SessionStartHandler} */ (startFn);
    }

    // ── onSessionEnd ─────────────────────────────────────────────────────────
    if (cfg.onSessionEnd) {
        hooks.onSessionEnd = cfg.onSessionEnd;
    } else if (auditLog) {
        const endFn = async (/** @type {SessionEndHookInput} */ input, /** @type {InvocationContext} */ invocation) => {
            log('DEBUG', `[lib/hooks] onSessionEnd: reason='${input.reason}' sessionId='${invocation?.sessionId}'`);
        };
        hooks.onSessionEnd = /** @type {SessionEndHandler} */ (endFn);
    }

    // ── onErrorOccurred ───────────────────────────────────────────────────────
    if (cfg.onErrorOccurred) {
        hooks.onErrorOccurred = cfg.onErrorOccurred;
    } else {
        const errorFn = async (
            /** @type {ErrorOccurredHookInput} */ input,
            /** @type {InvocationContext} */ invocation,
        ) => {
            log(
                'WARN',
                `[lib/hooks] onErrorOccurred: error='${input.error}' context='${input.errorContext}' recoverable=${input.recoverable} sessionId='${invocation?.sessionId}'`,
            );
        };
        hooks.onErrorOccurred = /** @type {ErrorOccurredHandler} */ (errorFn);
    }

    return hooks;
}

// ─── Presets prontos para uso ────────────────────────────────────────────────

/**
 * Cria hooks com auditLog desativado e sem restrições de ferramentas. Apenas loga erros. Ideal para sessões simples.
 *
 * @returns {SessionHooks}
 */
export function createMinimalHooks() {
    return createHooks({});
}

/**
 * Cria hooks com auditLog completo de todos os eventos.
 *
 * @returns {SessionHooks}
 */
export function createAuditHooks() {
    return createHooks({ auditLog: true });
}

/**
 * Cria hooks que negam todas as ferramentas (sessão read-only sem execução).
 *
 * @returns {SessionHooks}
 */
export function createDenyAllHooks() {
    /** @type {PreToolUseHandler} */
    const denyHandler = async () => ({
        permissionDecision: /** @type {'deny'} */ ('deny'),
        permissionDecisionReason: 'Ferramentas desabilitadas nesta sessão.',
    });
    return createHooks({
        auditLog: true,
        onPreToolUse: denyHandler,
    });
}

/**
 * Cria hooks com whitelist de ferramentas seguras (apenas leitura).
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
 * @param {(error: Error, context: string, recoverable: boolean, sessionId: string) => void | Promise<void>} onError
 * @returns {ErrorOccurredHandler}
 */
export function createErrorNotifierHook(onError) {
    const fn = async (/** @type {ErrorOccurredHookInput} */ input, /** @type {InvocationContext} */ invocation) => {
        await onError(input.error, input.errorContext, input.recoverable, invocation?.sessionId ?? '');
    };
    return /** @type {ErrorOccurredHandler} */ (fn);
}
