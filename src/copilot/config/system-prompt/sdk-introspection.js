// @ts-check
/**
 * src/copilot/config/system-prompt/sdk-introspection.js
 *
 * Superfície canônica para introspecionar as capacidades nativas do SDK ligadas a instruções/system prompt.
 *
 * @module copilot/config/system-prompt/sdk-introspection
 */

import {
    getSectionDescription,
    getSectionNames,
    instructionSourcesGet,
    supportsCustomizeMode,
} from '../sdk-config-port.js';

/**
 * @typedef {import('../sdk-config-port.js').CopilotSession} CopilotSession
 */

/**
 * @returns {{
 *     supportsCustomizeMode: boolean;
 *     supportsInstructionSourcesRpc: boolean;
 *     sections: { name: string; description?: string | undefined }[];
 * }}
 */
export function getSystemPromptSdkCompatibility() {
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
    return instructionSourcesGet(session);
}
