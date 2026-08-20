// @ts-check
/**
 * src/copilot/config/system-prompt/builders.js
 *
 * Builders canônicos do system prompt modular. Mantém a API pública estável, mas desloca a lógica para fora do barrel
 * `index.js` e troca o default para `append`, preservando as guardrails do SDK.
 *
 * @module copilot/config/system-prompt/builders
 */

import {
    appendSystemMessage,
    customizeSystemMessage,
    replaceSystemMessage,
    SYSTEM_PROMPT_SECTIONS as SDK_SECTIONS,
    sectionOverride,
} from '../sdk-config-port.js';
import { getMode } from './mode.js';
import { buildSystemPromptProfile, renderSystemPromptProfileBlock } from './profile.js';
import {
    applySectionAction,
    augmentCustomInstructionsContent,
    buildHookContextGuidelinesBlock,
    buildOperationalContextBlock,
    joinPromptBlocks,
    renderSystemPromptSectionsMarkdown,
} from './rendering.js';
import { SECTIONS } from './sections-registry.js';
import { readResolvedSystemPromptUserConfigSync, readUserAppendContentSync } from './user-config.js';

/**
 * @param {string | undefined} extraContext
 * @param {string} userAppendContent
 * @returns {{ extraContext?: string; userAppendContent?: string }}
 */
function buildModeOptions(extraContext, userAppendContent) {
    return {
        ...(extraContext ? { extraContext } : {}),
        ...(userAppendContent ? { userAppendContent } : {}),
    };
}

/**
 * @param {string} profileBlock
 * @param {string} userAppendContent
 * @returns {Record<string, { ACTION: import('../sdk-config-port.js').SectionOverrideAction; CONTENT: string }>}
 */
function buildSnapshotSections(profileBlock, userAppendContent) {
    return Object.fromEntries(
        Object.entries(SECTIONS).map(([key, section]) => [
            key,
            key === 'custom_instructions'
                ? {
                      ...section,
                      CONTENT: augmentCustomInstructionsContent(section.CONTENT, { profileBlock, userAppendContent }),
                  }
                : section,
        ]),
    );
}

/**
 * @typedef {import('./user-config.js').SystemPromptMode} SystemPromptMode
 *
 * @typedef {import('../sdk-config-port.js').SystemMessageConfig} SystemMessageConfig
 */

/**
 * Metadados das seções do system prompt reexportados do SDK.
 *
 * @type {Record<string, { description: string }>}
 */
export const SYSTEM_PROMPT_SECTIONS = /** @type {Record<string, { description: string }>} */ (SDK_SECTIONS);

/**
 * @param {{ extraContext?: string; mode?: SystemPromptMode }} [opts]
 * @returns {SystemMessageConfig}
 */
export function buildSystemMessage(opts = {}) {
    const userConfig = readResolvedSystemPromptUserConfigSync();
    return buildSystemMessageFromResolvedConfig(userConfig, readUserAppendContentSync(userConfig), opts);
}

/**
 * Pure builder over an already-hydrated user-config snapshot. This is the canonical bridge used by async lifecycle
 * paths when live transforms are disabled, so they never fall back to synchronous filesystem access.
 *
 * @param {import('./user-config.js').ResolvedSystemPromptUserConfig} userConfig
 * @param {string} userAppendContent
 * @param {{ extraContext?: string; mode?: SystemPromptMode }} [opts]
 * @returns {SystemMessageConfig}
 */
export function buildSystemMessageFromResolvedConfig(userConfig, userAppendContent, opts = {}) {
    const mode = opts.mode ?? getMode();
    const profileBlock = renderSystemPromptProfileBlock(buildSystemPromptProfile(userConfig));
    const modeOptions = { ...buildModeOptions(opts.extraContext, userAppendContent), profileBlock };
    if (mode === 'replace') return buildReplaceMode(modeOptions);
    if (mode === 'customize') return buildCustomizeMode(modeOptions);
    return buildAppendMode(modeOptions);
}

/**
 * @param {{ extraContext?: string; userAppendContent?: string; profileBlock: string }} opts
 * @returns {SystemMessageConfig}
 */
function buildAppendMode({ extraContext, userAppendContent, profileBlock }) {
    const sections = buildSnapshotSections(profileBlock, userAppendContent ?? '');
    return appendSystemMessage(
        joinPromptBlocks([renderSystemPromptSectionsMarkdown(sections), buildOperationalContextBlock(extraContext)]),
    );
}

/**
 * @param {{ extraContext?: string; userAppendContent?: string; profileBlock: string }} opts
 * @returns {SystemMessageConfig}
 */
function buildReplaceMode({ extraContext, userAppendContent, profileBlock }) {
    const sections = buildSnapshotSections(profileBlock, userAppendContent ?? '');
    return replaceSystemMessage(
        joinPromptBlocks([renderSystemPromptSectionsMarkdown(sections), buildOperationalContextBlock(extraContext)]),
    );
}

/**
 * @param {{ extraContext?: string; userAppendContent?: string; profileBlock: string }} opts
 * @returns {SystemMessageConfig}
 */
function buildCustomizeMode({ extraContext, userAppendContent, profileBlock }) {
    /** @type {Record<string, { action: import('../sdk-config-port.js').SectionOverrideAction; content: string }>} */
    const sections = {};
    const snapshotSections = buildSnapshotSections(profileBlock, userAppendContent ?? '');

    for (const [key, section] of Object.entries(snapshotSections)) {
        sections[key] = { action: section.ACTION, content: section.CONTENT };
    }

    return customizeSystemMessage(
        sections,
        joinPromptBlocks([buildOperationalContextBlock(extraContext)]) || undefined,
    );
}

/**
 * @param {string} hookContext
 * @returns {SystemMessageConfig}
 */
export function buildHookContextMessage(hookContext) {
    if (!hookContext) {
        return appendSystemMessage('');
    }

    return customizeSystemMessage({
        guidelines: sectionOverride('append', buildHookContextGuidelinesBlock(hookContext)),
    });
}

/**
 * @param {string} content
 * @returns {SystemMessageConfig}
 */
export function buildGuidelinesAppendMessage(content) {
    return customizeSystemMessage({ guidelines: sectionOverride('append', content) });
}

/**
 * @param {string} content
 * @returns {SystemMessageConfig}
 */
export function buildAppendSystemMessage(content) {
    return appendSystemMessage(content);
}

/**
 * @param {string} content
 * @returns {SystemMessageConfig}
 */
export function buildReplaceSystemMessage(content) {
    return replaceSystemMessage(content);
}

/**
 * @param {{ extraContext?: string; mode?: SystemPromptMode }} [opts]
 * @returns {SystemMessageConfig}
 */
export function buildAlwaysAliveSystemMessage(opts = {}) {
    return buildSystemMessage(opts);
}

/**
 * @param {string} hookContext
 * @returns {SystemMessageConfig}
 */
export function buildHookContextAppendMessage(hookContext) {
    return buildHookContextMessage(hookContext);
}

/**
 * Helper compartilhado pelo live builder para aplicar a semântica declarada por seção.
 *
 * @param {string} currentContent
 * @param {import('../sdk-config-port.js').SectionOverrideAction} action
 * @param {string} content
 * @returns {string}
 */
export function applyDeclaredSystemPromptSection(currentContent, action, content) {
    return applySectionAction(currentContent, action, content);
}
