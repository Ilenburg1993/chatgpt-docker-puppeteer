// @ts-check
/**
 * src/copilot/config/system-prompt/sections-registry.js
 *
 * Registry canônico das seções modulares do system prompt. Mantém a ordem, os identificadores SDK e o mapeamento para
 * arquivos-fonte sem carregar lógica de montagem no barrel.
 *
 * @module copilot/config/system-prompt/sections-registry
 */

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
 * @typedef {import('../sdk-config-port.js').SectionOverrideAction} SectionOverrideAction
 *
 * @typedef {{ CONTENT: string; ACTION: SectionOverrideAction }} SystemPromptSectionModule
 */

/**
 * Ordem canônica das seções do SDK.
 *
 * @type {readonly string[]}
 */
export const SYSTEM_PROMPT_SECTION_ORDER = Object.freeze([
    'identity',
    'tone',
    'tool_efficiency',
    'environment_context',
    'code_change_rules',
    'guidelines',
    'safety',
    'tool_instructions',
    'custom_instructions',
    'last_instructions',
]);

/**
 * Mapeia ids do SDK para o arquivo físico da seção. Usado pelo loader dinâmico de auto-reload.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const SYSTEM_PROMPT_SECTION_FILES = Object.freeze({
    identity: 'identity.js',
    tone: 'tone.js',
    tool_efficiency: 'tool-efficiency.js',
    environment_context: 'environment-context.js',
    code_change_rules: 'code-change-rules.js',
    guidelines: 'guidelines.js',
    safety: 'safety.js',
    tool_instructions: 'tool-instructions.js',
    custom_instructions: 'custom-instructions.js',
    last_instructions: 'last-instructions.js',
});

/**
 * Seções modulares em ordem canônica.
 *
 * @type {Record<string, SystemPromptSectionModule>}
 */
export const SECTIONS = {
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
