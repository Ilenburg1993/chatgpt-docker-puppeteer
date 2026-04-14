// @ts-check
/**
 * src/copilot/config/system-prompt/sdk-defaults/capture.js
 *
 * Utilitário para capturar os defaults do SDK para cada seção do system prompt. Usa SectionTransformFn para interceptar
 * e registrar o conteúdo padrão gerado pelo Copilot CLI.
 *
 * Uso: execute em uma sessão descartável para obter uma fotografia dos defaults. O conteúdo real varia por modelo,
 * versão do SDK e contexto.
 *
 * @module copilot/config/system-prompt/sdk-defaults/capture
 */

import { SYSTEM_PROMPT_SECTIONS } from '#copilot/sdk';

/**
 * @typedef {{ mode: 'customize'; sections: Record<string, { action: Function }>; _captured: Record<string, string> }} CaptureConfig
 */

/**
 * Cria um SystemMessageConfig que captura o conteúdo padrão de todas as seções via SectionTransformFn. Use em uma
 * sessão descartável para extrair os defaults.
 *
 * Após a sessão processar o system message, acesse `config._captured` para obter o conteúdo de cada seção.
 *
 * @returns {CaptureConfig}
 */
export function createCaptureConfig() {
    /** @type {Record<string, string>} */
    const captured = {};

    /** @type {Record<string, { action: (currentContent: string) => string }>} */
    const sections = {};

    for (const key of Object.keys(SYSTEM_PROMPT_SECTIONS)) {
        sections[key] = {
            action: (/** @type {string} */ currentContent) => {
                captured[key] = currentContent;
                return currentContent; // não altera o conteúdo
            },
        };
    }

    return {
        mode: /** @type {const} */ ('customize'),
        sections,
        _captured: captured,
    };
}
