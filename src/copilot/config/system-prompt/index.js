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
 * @typedef {import('#copilot/sdk/types').SystemMessageConfig} SystemMessageConfig
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

// Re-exports para API pública
export { getMode, setMode };

// Re-exports de seções individuais para testes e introspecção
export { SECTIONS };
