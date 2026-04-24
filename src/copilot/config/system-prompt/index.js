// @ts-check
/**
 * src/copilot/config/system-prompt/index.js
 *
 * Loader centralizado e assembler de system prompt modular. Monta o `SystemMessageConfig` completo a partir das 10
 * seções individuais.
 *
 * Dois modos de operação:
 *
 * - **replace** (default): substitui inteiramente o system prompt do SDK com nosso conteúdo
 * - **customize**: usa `mode: 'customize'` do SDK v0.2.0 com section-level overrides
 *
 * @module copilot/config/system-prompt
 * @see module:copilot/config/system-prompt/mode
 */

import { SYSTEM_PROMPT_SECTIONS as SDK_SECTIONS } from '../sdk-config-port.js';
import { getMode, setMode } from './mode.js';

import * as codeChangeRules from './sections/code-change-rules.js';
import * as customInstructions from './sections/custom-instructions.js';
import * as environmentContext from './sections/environment-context.js';
import * as guidelines from './sections/guidelines.js';
import * as identity from './sections/identity.js';
import * as lastInstructions from './sections/last-instructions.js';
import * as safety from './sections/safety.js';
import * as tone from './sections/tone.js';
import * as toolEfficiency from './sections/tool-efficiency.js';
import * as toolInstructions from './sections/tool-instructions.js';

/**
 * System message estrutural compatível com o SDK.
 *
 * `config/` monta declaração em repouso; o adapter de sessão no agent/sdk é quem encosta na sessão viva.
 *
 * @typedef {object} SystemMessageSection
 * @property {import('@github/copilot-sdk').SectionOverrideAction} action
 * @property {string} content
 *
 * @typedef {{ mode: 'append'; content: string }} SystemMessageAppendConfig
 *
 * @typedef {{ mode: 'replace'; content: string }} SystemMessageReplaceConfig
 *
 * @typedef {{ mode: 'customize'; content?: string; sections: Record<string, SystemMessageSection> }} SystemMessageCustomizeConfig
 *
 *
 * @typedef {SystemMessageAppendConfig | SystemMessageReplaceConfig | SystemMessageCustomizeConfig} SystemMessageConfig
 */

/**
 * Mapa ordenado de seções — a ordem define a sequência no prompt final. As chaves correspondem aos nomes das seções no
 * SDK (`SYSTEM_PROMPT_SECTIONS`).
 *
 * @type {Record<string, { CONTENT: string; ACTION: import('@github/copilot-sdk').SectionOverrideAction }>}
 */
const SECTIONS = {
    identity,
    tone,
    tool_efficiency: toolEfficiency,
    environment_context: environmentContext,
    code_change_rules: codeChangeRules,
    guidelines,
    safety,
    tool_instructions: toolInstructions,
    custom_instructions: customInstructions,
    last_instructions: lastInstructions,
};

/**
 * Metadados das seções do system prompt reexportados do SDK.
 *
 * @type {Record<string, { description: string }>}
 */
export const SYSTEM_PROMPT_SECTIONS = /** @type {Record<string, { description: string }>} */ (SDK_SECTIONS);

export { CONTENT as CODE_CHANGE_RULES } from './sections/code-change-rules.js';
export { CONTENT as ENVIRONMENT_CONTEXT } from './sections/environment-context.js';
export { CONTENT as AGENT_GUIDELINES } from './sections/guidelines.js';
export { CONTENT as AGENT_IDENTITY } from './sections/identity.js';
export { CONTENT as LAST_INSTRUCTIONS } from './sections/last-instructions.js';
export { CONTENT as AGENT_TONE } from './sections/tone.js';
export { CONTENT as TOOL_EFFICIENCY } from './sections/tool-efficiency.js';

/**
 * Monta o SystemMessageConfig completo no modo `replace`. Concatena todas as seções com headers Markdown e separadores.
 *
 * @param {{ extraContext?: string }} opts
 * @returns {SystemMessageConfig}
 */
function buildReplaceMode({ extraContext } = {}) {
    /** @type {string[]} */
    const parts = Object.entries(SECTIONS).map(([key, section]) => `# ${key}\n\n${section.CONTENT}`);

    if (extraContext) {
        parts.push(`# operational_context\n\n${extraContext}`);
    }

    return /** @type {SystemMessageConfig} */ ({
        mode: 'replace',
        content: parts.join('\n\n---\n\n'),
    });
}

/**
 * Monta o SystemMessageConfig completo no modo `customize`. Usa section-level overrides do SDK v0.2.0 para
 * granularidade máxima.
 *
 * @param {{ extraContext?: string }} opts
 * @returns {SystemMessageConfig}
 */
function buildCustomizeMode({ extraContext } = {}) {
    /** @type {Record<string, { action: import('@github/copilot-sdk').SectionOverrideAction; content: string }>} */
    const sections = {};

    for (const [key, section] of Object.entries(SECTIONS)) {
        sections[key] = { action: section.ACTION, content: section.CONTENT };
    }

    return /** @type {SystemMessageConfig} */ ({
        mode: 'customize',
        sections,
        ...(extraContext ? { content: extraContext } : {}),
    });
}

/**
 * Monta o SystemMessageConfig completo a partir de todas as seções modulares. Usa o modo definido em `mode.js`
 * (default: 'replace').
 *
 * @param {{ extraContext?: string }} [opts]
 * @returns {SystemMessageConfig}
 */
export function buildSystemMessage(opts = {}) {
    const mode = getMode();

    if (mode === 'replace') {
        return buildReplaceMode(opts);
    }
    return buildCustomizeMode(opts);
}

/**
 * Constrói um SystemMessageConfig de append com contexto operacional. Útil para injetar contexto do hook system sem
 * substituir o system prompt inteiro. Usa `mode: 'customize'` com `sections.guidelines.action: 'append'` quando
 * disponível.
 *
 * @param {string} hookContext - Conteúdo do session-briefing.md + estado de compliance
 * @returns {SystemMessageConfig}
 */
export function buildHookContextMessage(hookContext) {
    if (!hookContext) {
        return /** @type {SystemMessageConfig} */ ({ mode: 'append', content: '' });
    }

    return /** @type {SystemMessageConfig} */ ({
        mode: 'customize',
        sections: {
            guidelines: {
                action: 'append',
                content: [
                    '---',
                    '## Contexto Operacional do Hook System',
                    '',
                    hookContext,
                    '',
                    '**Lembre-se**: Encerre este turno com `vscode_askQuestions`. Não chame `task_complete` sem isso.',
                ].join('\n'),
            },
        },
    });
}

/**
 * Constrói um `SystemMessageConfig` no modo `"customize"` com appendment na seção `guidelines`.
 *
 * @param {string} content
 * @returns {SystemMessageConfig}
 */
export function buildGuidelinesAppendMessage(content) {
    return /** @type {SystemMessageConfig} */ ({
        mode: 'customize',
        sections: { guidelines: { action: 'append', content } },
    });
}

/**
 * Constrói um `SystemMessageConfig` no modo `"append"`.
 *
 * @param {string} content
 * @returns {SystemMessageConfig}
 */
export function buildAppendSystemMessage(content) {
    return /** @type {SystemMessageConfig} */ ({ mode: 'append', content });
}

/**
 * Constrói um `SystemMessageConfig` no modo `"replace"`.
 *
 * @param {string} content
 * @returns {SystemMessageConfig}
 */
export function buildReplaceSystemMessage(content) {
    return /** @type {SystemMessageConfig} */ ({ mode: 'replace', content });
}

/**
 * Constrói o system message completo do LLM-B.
 *
 * @param {{ extraContext?: string }} [opts]
 * @returns {SystemMessageConfig}
 */
export function buildAlwaysAliveSystemMessage(opts = {}) {
    return buildSystemMessage(opts);
}

/**
 * Constrói um system message com o contexto operacional do hook system.
 *
 * @param {string} hookContext
 * @returns {SystemMessageConfig}
 */
export function buildHookContextAppendMessage(hookContext) {
    return buildHookContextMessage(hookContext);
}

// Re-exports para API pública
export { getMode, setMode };

// Re-exports de seções individuais para testes e introspecção
export { SECTIONS };
