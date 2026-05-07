// @ts-check
/**
 * src/copilot/config/system-prompt/sdk-introspection.js
 *
 * Superfície canônica para introspecionar as capacidades nativas do SDK ligadas a instruções/system prompt.
 *
 * @module copilot/config/system-prompt/sdk-introspection
 */

import * as sdk from '#copilot/sdk';

/**
 * @typedef {import('#copilot/sdk/types').CopilotSession} CopilotSession
 */

/**
 * @param {string} name
 * @returns {unknown}
 */
function getOptionalSdkExport(name) {
    try {
        return Reflect.get(sdk, name);
    } catch {
        return undefined;
    }
}

/**
 * @returns {{
 *     supportsCustomizeMode: boolean;
 *     supportsInstructionSourcesRpc: boolean;
 *     sections: { name: string; description?: string | undefined }[];
 * }}
 */
export function getSystemPromptSdkCompatibility() {
    const getSectionNamesExport = getOptionalSdkExport('getSectionNames');
    const getSectionDescriptionExport = getOptionalSdkExport('getSectionDescription');
    const supportsCustomizeModeExport = getOptionalSdkExport('supportsCustomizeMode');
    const getSectionNames =
        typeof getSectionNamesExport === 'function'
            ? /** @type {() => string[]} */ (getSectionNamesExport)
            : () => /** @type {string[]} */ ([]);
    const getSectionDescription =
        typeof getSectionDescriptionExport === 'function'
            ? /** @type {(name: string) => string | undefined} */ (getSectionDescriptionExport)
            : () => undefined;
    const supportsCustomizeMode =
        typeof supportsCustomizeModeExport === 'function'
            ? /** @type {() => boolean} */ (supportsCustomizeModeExport)
            : () => false;

    return {
        supportsCustomizeMode: supportsCustomizeMode(),
        supportsInstructionSourcesRpc: true,
        sections: getSectionNames().map((name) => ({ name, description: getSectionDescription(name) })),
    };
}

/**
 * @param {CopilotSession} session
 * @returns {Promise<unknown>}
 */
export async function readSessionInstructionSources(session) {
    const instructionSourcesGet = getOptionalSdkExport('instructionSourcesGet');
    if (typeof instructionSourcesGet !== 'function') {
        return null;
    }
    return instructionSourcesGet(session);
}
