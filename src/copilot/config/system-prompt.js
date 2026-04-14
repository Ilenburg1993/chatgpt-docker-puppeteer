// @ts-check
/**
 * src/copilot/config/system-prompt.js
 *
 * **FACADE de backward compatibility** — Delega ao novo módulo modular `config/system-prompt/`.
 *
 * Mantém as constantes e builders originais para consumidores existentes. Novos consumidores devem importar diretamente
 * de `config/system-prompt/index.js`.
 *
 * @module copilot/config/system-prompt
 * @deprecated Use `config/system-prompt/index.js` para novas integrações.
 * @see module:copilot/config/system-prompt
 */

/**
 * @typedef {import('#copilot/sdk/types').SystemMessageConfig} SystemMessageConfig
 */
import { SYSTEM_PROMPT_SECTIONS as SDK_SECTIONS } from '#copilot/sdk';
import { buildHookContextMessage, buildSystemMessage } from './system-prompt/index.js';

// ─────────────────────────────────────────────────────────────────────────────
// Constantes de identidade e instruções do LLM-B (backward compat)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Metadados das seções do system prompt — re-exportados do SDK v0.2.0.
 *
 * @type {Record<string, { description: string }>}
 */
export const SYSTEM_PROMPT_SECTIONS = /** @type {Record<string, { description: string }>} */ (SDK_SECTIONS);

// Re-exports das constantes legadas a partir das seções modulares
export { CONTENT as CODE_CHANGE_RULES } from './system-prompt/sections/code-change-rules.js';
export { CONTENT as ENVIRONMENT_CONTEXT } from './system-prompt/sections/environment-context.js';
export { CONTENT as AGENT_GUIDELINES } from './system-prompt/sections/guidelines.js';
export { CONTENT as AGENT_IDENTITY } from './system-prompt/sections/identity.js';
export { CONTENT as LAST_INSTRUCTIONS } from './system-prompt/sections/last-instructions.js';
export { CONTENT as AGENT_TONE } from './system-prompt/sections/tone.js';
export { CONTENT as TOOL_EFFICIENCY } from './system-prompt/sections/tool-efficiency.js';

// ─────────────────────────────────────────────────────────────────────────────
// Builders de SystemMessageConfig (backward compat)
// ─────────────────────────────────────────────────────────────────────────────

// C12-03: verificar em runtime se SDK suporta mode:'customize' (v0.2.0+)
const _sdkSupportsCustomize = typeof SDK_SECTIONS === 'object' && SDK_SECTIONS !== null && 'guidelines' in SDK_SECTIONS;

/**
 * Constrói um `SystemMessageConfig` no modo `"customize"` com appendment na seção `guidelines`.
 *
 * @param {string} content - Conteúdo a ser adicionado na seção guidelines
 * @returns {SystemMessageConfig}
 */
export function buildGuidelinesAppendMessage(content) {
    if (!_sdkSupportsCustomize) {
        return /** @type {SystemMessageConfig} */ ({ mode: 'append', content });
    }
    return /** @type {SystemMessageConfig} */ ({
        mode: 'customize',
        sections: { guidelines: { action: 'append', content } },
    });
}

/**
 * Constrói um `SystemMessageConfig` no modo `"append"`.
 *
 * @param {string} content - Texto a ser adicionado após as seções gerenciadas pelo SDK
 * @returns {SystemMessageConfig}
 */
export function buildAppendSystemMessage(content) {
    return /** @type {SystemMessageConfig} */ ({ mode: 'append', content });
}

/**
 * Constrói um `SystemMessageConfig` no modo `"replace"`.
 *
 * @param {string} content - System message completo
 * @returns {SystemMessageConfig}
 */
export function buildReplaceSystemMessage(content) {
    return /** @type {SystemMessageConfig} */ ({ mode: 'replace', content });
}

/**
 * Constrói o system message completo do LLM-B no modo dual (replace/customize). **Delega ao novo módulo modular** com
 * 10 seções SDK-aligned.
 *
 * @param {object} [opts={}] Default is `{}`
 * @param {string} [opts.extraContext=''] - Contexto adicional (ex: hook system briefing). Default is `''`
 * @returns {SystemMessageConfig}
 */
export function buildAlwaysAliveSystemMessage(opts = {}) {
    const { extraContext } = /** @type {{ extraContext?: string }} */ (opts);
    /** @type {{ extraContext?: string }} */
    const fwd = {};
    if (extraContext) fwd.extraContext = extraContext;
    return buildSystemMessage(fwd);
}

/**
 * Constrói um system message de append com apenas o contexto do hook system. **Delega ao novo módulo modular**.
 *
 * @param {string} hookContext - Conteúdo do session-briefing.md + estado de compliance
 * @returns {SystemMessageConfig}
 */
export function buildHookContextAppendMessage(hookContext) {
    return buildHookContextMessage(hookContext);
}
