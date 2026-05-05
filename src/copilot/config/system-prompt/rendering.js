// @ts-check
/**
 * src/copilot/config/system-prompt/rendering.js
 *
 * Helpers puros de renderização/merge para o system prompt modular.
 *
 * @module copilot/config/system-prompt/rendering
 */

/**
 * @typedef {import('../sdk-config-port.js').SectionOverrideAction} SectionOverrideAction
 */

/**
 * @param {Record<string, { CONTENT: string }>} sections
 * @returns {string}
 */
export function renderSystemPromptSectionsMarkdown(sections) {
    return Object.entries(sections)
        .map(([key, section]) => `# ${key}\n\n${section.CONTENT}`)
        .join('\n\n---\n\n');
}

/**
 * @param {string | undefined} extraContext
 * @returns {string}
 */
export function buildOperationalContextBlock(extraContext) {
    return extraContext ? `# operational_context\n\n${extraContext}` : '';
}

/**
 * @param {string} content
 * @returns {string}
 */
export function buildUserCustomizationsDocumentBlock(content) {
    return content ? `# user_customizations\n\n${content}` : '';
}

/**
 * @param {string} hookContext
 * @returns {string}
 */
export function buildHookContextGuidelinesBlock(hookContext) {
    if (!hookContext) return '';
    return [
        '---',
        '## Contexto Operacional do Hook System',
        '',
        hookContext,
        '',
        '**Lembre-se**: se a runtime expuser uma ferramenta formal de pergunta ao usuário, encerre o turno pela superfície canônica dela antes de dar o trabalho por concluído.',
    ].join('\n');
}

/**
 * @param {string} content
 * @returns {string}
 */
export function buildUserCustomizationsSectionBlock(content) {
    if (!content) return '';
    return ['---', '## Customizações Locais do Usuário', '', content].join('\n');
}

/**
 * @param {string} baseContent
 * @param {{ profileBlock?: string; userAppendContent?: string }} [opts]
 * @returns {string}
 */
export function augmentCustomInstructionsContent(baseContent, opts = {}) {
    let next = baseContent;
    if (opts.profileBlock) {
        next = applySectionAction(next, 'append', opts.profileBlock);
    }
    if (opts.userAppendContent) {
        next = applySectionAction(next, 'append', buildUserCustomizationsSectionBlock(opts.userAppendContent));
    }
    return next;
}

/**
 * @param {(string | undefined | null | false)[]} parts
 * @returns {string}
 */
export function joinPromptBlocks(parts) {
    return parts.filter((part) => typeof part === 'string' && part.trim()).join('\n\n---\n\n');
}

/**
 * Aplica a ação de uma seção sobre o conteúdo atual fornecido pelo SDK.
 *
 * @param {string} currentContent
 * @param {SectionOverrideAction} action
 * @param {string} content
 * @returns {string}
 */
export function applySectionAction(currentContent, action, content) {
    if (typeof action === 'function') {
        return currentContent;
    }
    if (action === 'remove') {
        return '';
    }
    if (action === 'prepend') {
        return content ? `${content}${currentContent ? `\n\n${currentContent}` : ''}` : currentContent;
    }
    if (action === 'append') {
        return content ? `${currentContent}${currentContent ? `\n\n${content}` : content}` : currentContent;
    }
    return content;
}
