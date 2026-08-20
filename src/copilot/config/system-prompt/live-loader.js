// @ts-check
/**
 * src/copilot/config/system-prompt/live-loader.js
 *
 * Loader dinâmico das seções do system prompt. Reimporta módulos com cache-busting por mtime para que alterações nos
 * arquivos `sections/*.js` sejam refletidas automaticamente em sessões vivas que usam transforms do SDK.
 *
 * @module copilot/config/system-prompt/live-loader
 */

import { statPathTrusted } from '#copilot/infra/public/trusted-io';
import { fileURLToPath } from 'node:url';
import { SECTIONS, SYSTEM_PROMPT_SECTION_FILES, SYSTEM_PROMPT_SECTION_ORDER } from './sections-registry.js';

/**
 * @typedef {{ ACTION: import('../sdk-config-port.js').SectionOverrideAction; CONTENT: string }} LiveSection
 */

/** @type {Map<string, { stamp: string; section: LiveSection }>} */
const _cache = new Map();

/**
 * @param {string} sectionId
 * @returns {URL}
 */
function getSectionUrl(sectionId) {
    const fileName = SYSTEM_PROMPT_SECTION_FILES[sectionId];
    return new URL(`./sections/${fileName}`, import.meta.url);
}

/**
 * @param {string} sectionId
 * @returns {Promise<LiveSection>}
 */
export async function loadLiveSystemPromptSection(sectionId) {
    const baseUrl = getSectionUrl(sectionId);
    const filePath = fileURLToPath(baseUrl);

    try {
        const info = (await statPathTrusted(filePath, { caller: 'config.system-prompt.live-loader' })).stats;
        const stamp = `${info.mtimeMs}:${info.size}`;
        const cached = _cache.get(sectionId);
        if (cached?.stamp === stamp) {
            return cached.section;
        }

        const mod = await import(`${baseUrl.href}?v=${encodeURIComponent(stamp)}`);
        const section = {
            ACTION: /** @type {import('../sdk-config-port.js').SectionOverrideAction} */ (mod.ACTION),
            CONTENT: /** @type {string} */ (mod.CONTENT),
        };
        _cache.set(sectionId, { stamp, section });
        return section;
    } catch {
        return /** @type {LiveSection} */ (SECTIONS[sectionId]);
    }
}

/**
 * @returns {Promise<Record<string, LiveSection>>}
 */
export async function loadLiveSystemPromptSections() {
    const entries = await Promise.all(
        SYSTEM_PROMPT_SECTION_ORDER.map(async (sectionId) => [sectionId, await loadLiveSystemPromptSection(sectionId)]),
    );
    return Object.fromEntries(entries);
}
