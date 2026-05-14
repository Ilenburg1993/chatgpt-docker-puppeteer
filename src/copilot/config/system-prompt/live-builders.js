// @ts-check
/**
 * src/copilot/config/system-prompt/live-builders.js
 *
 * Builders de sessão viva do system prompt. Quando possível, usam `mode:'customize'` com transforms assíncronos do SDK
 * para garantir recarga automática de instruções modulares e customizações do usuário sem reabrir fluxos paralelos.
 *
 * @module copilot/config/system-prompt/live-builders
 */

import { customizeSystemMessage, sectionOverride } from '#copilot/sdk/session';
import { applyDeclaredSystemPromptSection, buildSystemMessage } from './builders.js';
import { loadLiveSystemPromptSections } from './live-loader.js';
import { getMode } from './mode.js';
import { buildSystemPromptProfile, renderSystemPromptProfileBlock } from './profile.js';
import {
    augmentCustomInstructionsContent,
    buildHookContextGuidelinesBlock,
    buildUserCustomizationsSectionBlock,
} from './rendering.js';
import { getSystemPromptSdkCompatibility } from './sdk-introspection.js';
import { SECTIONS, SYSTEM_PROMPT_SECTION_ORDER } from './sections-registry.js';
import { readResolvedSystemPromptUserConfig, readUserAppendContent } from './user-config.js';

/**
 * @typedef {import('../sdk-config-port.js').SystemMessageConfig} SystemMessageConfig
 *
 * @typedef {import('./user-config.js').SystemPromptMode} SystemPromptMode
 */

/**
 * @param {(() => Promise<string> | string) | undefined} getExtraContext
 * @returns {Promise<string>}
 */
async function readExtraContext(getExtraContext) {
    if (!getExtraContext) return '';
    try {
        const result = await getExtraContext();
        return typeof result === 'string' ? result : '';
    } catch {
        return '';
    }
}

/**
 * @param {string} sectionId
 * @param {SystemPromptMode} mode
 * @param {(() => Promise<string> | string) | undefined} getExtraContext
 * @returns {(currentContent: string) => Promise<string>}
 */
function createDynamicSectionTransform(sectionId, mode, getExtraContext) {
    return async (currentContent) => {
        const sections = await loadLiveSystemPromptSections();
        const section = sections[sectionId] ?? SECTIONS[sectionId];
        if (!section) {
            return currentContent;
        }
        const sectionAction = mode === 'replace' ? 'replace' : section.ACTION;
        let next = applyDeclaredSystemPromptSection(currentContent, sectionAction, section.CONTENT);

        if (sectionId === 'guidelines') {
            const hookContext = await readExtraContext(getExtraContext);
            if (hookContext) {
                next = applyDeclaredSystemPromptSection(next, 'append', buildHookContextGuidelinesBlock(hookContext));
            }
        }

        if (sectionId === 'custom_instructions') {
            const userConfig = await readResolvedSystemPromptUserConfig();
            const userAppendContent = await readUserAppendContent(userConfig);
            const profileBlock = renderSystemPromptProfileBlock(buildSystemPromptProfile(userConfig));
            next = augmentCustomInstructionsContent(next, { profileBlock, userAppendContent });
            if (!userAppendContent) {
                next = applyDeclaredSystemPromptSection(next, 'append', buildUserCustomizationsSectionBlock(''));
            }
        }

        return next;
    };
}

/**
 * Constrói o system message usado por sessões vivas do agent.
 *
 * - `append`/`customize` + autoReload => `customize` dinâmico com transforms do SDK
 * - `replace` ou autoReload desabilitado => snapshot estático atual
 *
 * @param {{
 *     getExtraContext?: (() => Promise<string> | string) | undefined;
 *     mode?: SystemPromptMode | undefined;
 * }} [opts]
 * @returns {Promise<SystemMessageConfig>}
 */
export async function buildLiveSystemMessage(opts = {}) {
    const userConfig = await readResolvedSystemPromptUserConfig();
    const mode = opts.mode ?? getMode();
    const sdkCompatibility = getSystemPromptSdkCompatibility();

    if (
        !userConfig.autoReload ||
        userConfig.reloadStrategy !== 'sdk-transform' ||
        !sdkCompatibility.supportsCustomizeMode
    ) {
        return buildSystemMessage({
            ...(mode ? { mode } : {}),
            ...(opts.getExtraContext ? { extraContext: await readExtraContext(opts.getExtraContext) } : {}),
        });
    }

    /** @type {Record<string, { action: import('../sdk-config-port.js').SectionOverrideAction }>} */
    const sections = {};
    for (const sectionId of SYSTEM_PROMPT_SECTION_ORDER) {
        sections[sectionId] = {
            action: createDynamicSectionTransform(sectionId, mode, opts.getExtraContext),
        };
    }

    return customizeSystemMessage(
        Object.fromEntries(
            Object.entries(sections).map(([sectionId, override]) => [sectionId, sectionOverride(override.action)]),
        ),
    );
}
