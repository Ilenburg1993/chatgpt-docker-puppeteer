// @ts-check
/**
 * src/copilot/sdk/system-message.js
 *
 * Faixa 3 / F11-F15 — Builder centralizado de SystemMessageConfig do `@github/copilot-sdk`. Ponto único para criação de
 * configurações de system prompt.
 *
 * Consumers **não** devem importar `SYSTEM_MESSAGE_SECTIONS` diretamente do `@github/copilot-sdk`.
 *
 * Tres modos suportados pelo SDK:
 *
 * - **append** (default): SDK foundation + conteúdo adicional
 * - **replace**: substituição total (remove guardrails do SDK)
 * - **customize**: overrides granulares por seção (recomendado para v0.2.0+)
 *
 * @module copilot/sdk/system-message
 * @see EventBus
 * @see module:copilot/config/system-prompt
 */

import * as CopilotSdk from '@github/copilot-sdk';

/**
 * @typedef {typeof import('@github/copilot-sdk') & {
 *     SYSTEM_PROMPT_SECTIONS?: typeof import('@github/copilot-sdk').SYSTEM_MESSAGE_SECTIONS;
 * }} CopilotSdkNamespace
 */

const sdkNamespace = /** @type {CopilotSdkNamespace} */ (CopilotSdk);

// ─── Re-exports do SDK ────────────────────────────────────────────────────────

export const SYSTEM_MESSAGE_SECTIONS =
    sdkNamespace.SYSTEM_MESSAGE_SECTIONS ?? sdkNamespace.SYSTEM_PROMPT_SECTIONS ?? {};

// Alias legado local: o SDK 1.0 renomeou "prompt sections" para "message sections".
export const SYSTEM_PROMPT_SECTIONS = SYSTEM_MESSAGE_SECTIONS;

/**
 * @typedef {import('@github/copilot-sdk').SystemMessageConfig} SystemMessageConfig
 *
 * @typedef {import('@github/copilot-sdk').SystemMessageAppendConfig} SystemMessageAppendConfig
 *
 * @typedef {import('@github/copilot-sdk').SystemMessageReplaceConfig} SystemMessageReplaceConfig
 *
 * @typedef {import('@github/copilot-sdk').SystemMessageCustomizeConfig} SystemMessageCustomizeConfig
 *
 * @typedef {import('@github/copilot-sdk').SystemMessageSection} SystemMessageSection
 *
 * @typedef {import('@github/copilot-sdk').SectionOverride} SectionOverride
 *
 * @typedef {import('@github/copilot-sdk').SectionOverrideAction} SectionOverrideAction
 *
 * @typedef {import('@github/copilot-sdk').SectionTransformFn} SectionTransformFn
 */

// ─── Detecção de suporte customize ────────────────────────────────────────────

/**
 * True se o SDK suporta mode:'customize' (v0.2.0+).
 *
 * @type {boolean}
 */
const _supportsCustomize =
    typeof SYSTEM_MESSAGE_SECTIONS === 'object' &&
    SYSTEM_MESSAGE_SECTIONS !== null &&
    'guidelines' in SYSTEM_MESSAGE_SECTIONS;

/**
 * Retorna true se o SDK suporta mode:'customize'.
 *
 * @returns {boolean}
 */
export function supportsCustomizeMode() {
    return _supportsCustomize;
}

// ─── Builders para SystemMessageConfig ────────────────────────────────────────

/**
 * Constrói SystemMessageConfig no modo `"append"` (default, mais seguro). Adiciona conteúdo após as seções gerenciadas
 * pelo SDK.
 *
 * @param {string} [content=''] - Conteúdo adicional. Default is `''`
 * @returns {SystemMessageAppendConfig}
 */
export function appendSystemMessage(content = '') {
    return /** @type {SystemMessageAppendConfig} */ ({
        mode: 'append',
        content,
    });
}

/**
 * Constrói SystemMessageConfig no modo `"replace"`. ⚠️ Substitui inteiramente o system message — remove guardrails do
 * SDK.
 *
 * @param {string} content - System message completo
 * @returns {SystemMessageReplaceConfig}
 */
export function replaceSystemMessage(content) {
    if (typeof content !== 'string') {
        throw new TypeError('[sdk/system-message] replaceSystemMessage: content (string) é obrigatório');
    }
    return /** @type {SystemMessageReplaceConfig} */ ({
        mode: 'replace',
        content,
    });
}

/**
 * Constrói SystemMessageConfig no modo `"customize"`. Permite overrides granulares por seção, mantendo a estrutura do
 * SDK.
 *
 * Se o SDK não suportar customize (< v0.2.0), faz fallback para mode:'append' concatenando os conteúdos de override.
 *
 * @param {Partial<Record<SystemMessageSection, SectionOverride>>} [sections] - Overrides por seção
 * @param {string} [content] - Conteúdo adicional após todas as seções
 * @returns {SystemMessageConfig}
 */
export function customizeSystemMessage(sections, content) {
    if (_supportsCustomize) {
        return /** @type {SystemMessageCustomizeConfig} */ ({
            mode: 'customize',
            ...(sections ? { sections } : {}),
            ...(content !== undefined ? { content } : {}),
        });
    }

    // Fallback: concatenar conteúdos como append
    const parts = [];
    if (sections) {
        for (const [section, override] of Object.entries(sections)) {
            if (override?.content) {
                parts.push(`[${section}] ${override.content}`);
            }
        }
    }
    if (content) parts.push(content);
    return appendSystemMessage(parts.join('\n\n'));
}

/**
 * Cria um `SectionOverride` para uso em `customizeSystemMessage()`.
 *
 * @example
 *     ```js
 *     const config = customizeSystemMessage({
 *         guidelines: sectionOverride('append', 'Instruções adicionais'),
 *         safety: sectionOverride('remove'),
 *     });
 *     ```;
 *
 * @param {SectionOverrideAction} action - Ação: 'replace', 'remove', 'append', 'prepend' ou SectionTransformFn
 * @param {string} [content] - Conteúdo (opcional para 'remove')
 * @returns {SectionOverride}
 */
export function sectionOverride(action, content) {
    /** @type {SectionOverride} */
    const override = { action };
    if (content !== undefined) {
        override.content = content;
    }
    return override;
}

/**
 * Atalho explícito para `SectionTransformFn`, útil quando o override precisa calcular a seção a partir do conteúdo
 * atual fornecido pelo SDK.
 *
 * @param {SectionTransformFn} transform
 * @returns {SectionOverride}
 */
export function transformSection(transform) {
    if (typeof transform !== 'function') {
        throw new TypeError('[sdk/system-message] transformSection: transform deve ser função');
    }
    return sectionOverride(transform);
}

/**
 * Atalho: cria um customize config que adiciona conteúdo à seção `guidelines`.
 *
 * @param {string} content - Conteúdo a ser adicionado
 * @returns {SystemMessageConfig}
 */
export function appendToGuidelines(content) {
    return customizeSystemMessage({ guidelines: sectionOverride('append', content) });
}

/**
 * Atalho: cria um customize config que substitui a seção `identity`.
 *
 * @param {string} content - Nova identidade do agente
 * @returns {SystemMessageConfig}
 */
export function replaceIdentity(content) {
    return customizeSystemMessage({ identity: sectionOverride('replace', content) });
}

/**
 * Retorna a lista de nomes de seções suportadas pelo SDK.
 *
 * @returns {SystemMessageSection[]}
 */
export function getSectionNames() {
    if (!SYSTEM_MESSAGE_SECTIONS) return [];
    return /** @type {SystemMessageSection[]} */ (Object.keys(SYSTEM_MESSAGE_SECTIONS));
}

/**
 * Retorna a descrição de uma seção do system prompt.
 *
 * @param {SystemMessageSection} section - Nome da seção
 * @returns {string | undefined}
 */
export function getSectionDescription(section) {
    return SYSTEM_MESSAGE_SECTIONS?.[section]?.description;
}
