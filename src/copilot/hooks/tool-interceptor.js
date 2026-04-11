// @ts-check
/**
 * src/copilot/hooks/tool-interceptor.js
 *
 * Handlers para `onPreToolUse` (com modifiedArgs, Gap 2) e `onPostToolUse` (Gap 3).
 *
 * A implementação anterior de onPreToolUse apenas aplicava allow/deny sem modificar args. Este módulo implementa a
 * capacidade completa: sanitizar, validar e modificar args. `onPostToolUse` agora emite additionalContext além do
 * logging básico.
 *
 * @module copilot/hooks/tool-interceptor
 * @see EventBus
 * @see module:copilot/hooks/types
 */

import { log } from '#copilot/observability';

/**
 * @typedef {import('./types.js').PreToolUseHookInput} PreToolUseHookInput
 *
 * @typedef {import('./types.js').PreToolUseHookOutput} PreToolUseHookOutput
 *
 * @typedef {import('./types.js').PostToolUseHookInput} PostToolUseHookInput
 *
 * @typedef {import('./types.js').PostToolUseHookOutput} PostToolUseHookOutput
 *
 * @typedef {import('./types.js').PreToolUseHandler} PreToolUseHandler
 *
 * @typedef {import('./types.js').PostToolUseHandler} PostToolUseHandler
 *
 * @typedef {import('./types.js').InvocationContext} InvocationContext
 */

/**
 * @typedef {object} ArgSanitizerRules
 * @property {string[]} [sensitiveKeyPatterns] Nomes de args cujos valores devem ser redatados antes de qualquer log.
 *   Pattern matching por substring (case-insensitive).
 * @property {Record<string, Record<string, unknown>>} [defaults] Argumentos padrão injetados para tools específicas
 *   quando estão ausentes. Chave = toolName, valor = objeto de defaults.
 * @property {Record<string, Record<string, unknown>>} [overrides] Forçar sobrescrita de args específicos. Tem
 *   precedência sobre tudo. Chave = toolName, valor = objeto com os overrides.
 * @property {Record<string, string[]>} [stripArgs] Remove args específicos. Chave = toolName, valor = lista de args a
 *   remover.
 */

/**
 * Cria um hook `onPreToolUse` que pode modificar args antes da execução.
 *
 * Implementa o Gap 2 do roadmap: `modifiedArgs` retornado ao SDK.
 *
 * @example
 *     // Injeta e garante args para a tool 'shell'
 *     const hook = createArgSanitizerHook({
 *         defaults: { shell: { timeout: 30000 } },
 *         overrides: { shell: { allowSudo: false } },
 *     });
 *
 * @param {ArgSanitizerRules} [rules]
 * @returns {PreToolUseHandler}
 */
export function createArgSanitizerHook(rules = {}) {
    const { sensitiveKeyPatterns = [] } = rules;
    /** @type {Record<string, Record<string, unknown>>} */
    const defaults = rules.defaults ?? {};
    /** @type {Record<string, Record<string, unknown>>} */
    const overrides = rules.overrides ?? {};
    /** @type {Record<string, string[]>} */
    const stripArgs = rules.stripArgs ?? {};

    /**
     * @param {PreToolUseHookInput} input
     * @returns {Promise<PreToolUseHookOutput>}
     */
    return async function onPreToolUse(input) {
        const { toolName } = input;
        /** @type {Record<string, unknown>} */
        const args = { .../** @type {Record<string, unknown>} */ (input.toolArgs) };
        let modified = false;

        // Aplicar defaults se args não estiverem presentes
        if (defaults[toolName]) {
            for (const [k, v] of Object.entries(defaults[toolName])) {
                if (!(k in args)) {
                    args[k] = v;
                    modified = true;
                }
            }
        }

        // Strip de args indesejados
        if (stripArgs[toolName]) {
            for (const key of stripArgs[toolName]) {
                if (key in args) {
                    delete args[key];
                    modified = true;
                }
            }
        }

        // Overrides forçados
        if (overrides[toolName]) {
            for (const [k, v] of Object.entries(overrides[toolName])) {
                if (args[k] !== v) {
                    args[k] = v;
                    modified = true;
                }
            }
        }

        // Logging de debug com args redatados
        if (sensitiveKeyPatterns.length > 0) {
            const safeArgs = { ...args };
            for (const key of Object.keys(safeArgs)) {
                const lower = key.toLowerCase();
                if (sensitiveKeyPatterns.some((pat) => lower.includes(pat.toLowerCase()))) {
                    safeArgs[key] = '[REDACTED]';
                }
            }
            log('DEBUG', `[hooks/tool-interceptor] ${toolName} args: ${JSON.stringify(safeArgs)}`);
        }

        if (modified) {
            return { permissionDecision: 'allow', modifiedArgs: args };
        }
        return { permissionDecision: 'allow' };
    };
}

/**
 * Cria um hook `onPreToolUse` que apenas bloqueia tools numa lista.
 *
 * @param {string[]} blockedTools
 * @param {string} [reason]
 * @returns {PreToolUseHandler}
 */
export function createBlocklistHook(blockedTools, reason) {
    const set = new Set(blockedTools.map((t) => t.toLowerCase()));
    const msg = reason ?? 'tool bloqueada por política do sistema';

    return async function onPreToolUse(input) {
        if (set.has(input.toolName.toLowerCase())) {
            log('WARN', `[hooks/tool-interceptor] tool bloqueada: ${input.toolName} — ${msg}`);
            return { permissionDecision: 'deny' };
        }
        return { permissionDecision: 'allow' };
    };
}

/**
 * Cria um hook `onPreToolUse` que apenas permite tools numa lista de allowlist. Bloqueia qualquer outra tool não
 * listada.
 *
 * @param {string[]} allowedTools
 * @returns {PreToolUseHandler}
 */
export function createAllowlistHook(allowedTools) {
    const set = new Set(allowedTools.map((t) => t.toLowerCase()));

    return async function onPreToolUse(input) {
        const allowed = set.has(input.toolName.toLowerCase());
        if (!allowed) {
            log('WARN', `[hooks/tool-interceptor] tool não listada na allowlist: ${input.toolName}`);
        }
        return { permissionDecision: allowed ? 'allow' : 'deny' };
    };
}

/**
 * @typedef {object} PostToolContextEnricherOptions
 * @property {((input: PostToolUseHookInput) => string | null | undefined) | null} [contextFn] Função que recebe o
 *   resultado da tool e retorna texto adicional para o modelo.
 * @property {boolean} [logResults] Se true, loga o resultado da tool (truncado a 200 chars). Default: false.
 */

/**
 * Cria um hook `onPostToolUse` que enriche o contexto do modelo após execução.
 *
 * Implementa o Gap 3 do roadmap: `additionalContext` emitido ao SDK.
 *
 * @param {PostToolContextEnricherOptions} [opts]
 * @returns {PostToolUseHandler}
 */
export function createPostToolEnricher(opts = {}) {
    const { contextFn = null, logResults = false } = opts;

    /**
     * @param {PostToolUseHookInput} input
     * @returns {Promise<PostToolUseHookOutput>}
     */
    return async function onPostToolUse(input) {
        if (logResults) {
            const resultStr = String(input.toolResult ?? '');
            log(
                'DEBUG',
                `[hooks/tool-interceptor] ${input.toolName} resultado (${resultStr.length} chars): ${resultStr.slice(0, 200)}`,
            );
        }

        if (contextFn) {
            const ctx = contextFn(input);
            if (ctx) {
                return { additionalContext: ctx };
            }
        }
        return {};
    };
}

/**
 * Cria um par `{ onPreToolUse, onPostToolUse }` que mede a duração de cada execução de tool e injeta o resultado como
 * `additionalContext` no pós-hook.
 *
 * **Atenção**: Esta função retorna um **objeto** com dois handlers — não um único handler. Use spread ou destructuring
 * ao compor com outros hooks:
 *
 * @example
 *     const timing = createTimingEnricherHook();
 *     const { hooks } = createSomePreset();
 *     const composedHooks = { ...hooks, ...timing };
 *
 * @returns {{ onPreToolUse: PreToolUseHandler; onPostToolUse: PostToolUseHandler }}
 */
export function createTimingEnricherHook() {
    /** @type {Map<string, number>} */
    const timings = new Map();

    const onPreToolUse = /** @type {PreToolUseHandler} */ (
        async function onPreToolUse(input, invocation) {
            const key = `${invocation?.sessionId ?? ''}:${input.toolName}`;
            timings.set(key, Date.now());
            return {};
        }
    );

    const onPostToolUse = /** @type {PostToolUseHandler} */ (
        async function onPostToolUse(input, invocation) {
            const key = `${invocation?.sessionId ?? ''}:${input.toolName}`;
            const t0 = timings.get(key);
            timings.delete(key); // limpa independentemente para evitar leak
            if (t0 !== undefined) {
                const elapsed = Date.now() - t0;
                return { additionalContext: `tool '${input.toolName}' completada em ${elapsed}ms` };
            }
            return {};
        }
    );

    return { onPreToolUse, onPostToolUse };
}

/**
 * GAP-TOOLS-004: Cria um hook `onPreToolUse` que bloqueia tools desabilitadas em runtime via `isToolDisabled()` do
 * introspection-tools.
 *
 * @param {(name: string) => boolean} isDisabledFn - Função que recebe o nome da tool e verifica se está desabilitado
 * @returns {PreToolUseHandler}
 */
export function createRuntimeDisableHook(isDisabledFn) {
    return async function onPreToolUse(input) {
        if (isDisabledFn(input.toolName)) {
            log('WARN', `[hooks/tool-interceptor] tool desabilitada em runtime: ${input.toolName}`);
            return { permissionDecision: 'deny' };
        }
        return {};
    };
}
