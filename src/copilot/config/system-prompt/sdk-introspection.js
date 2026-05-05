// @ts-check
/**
 * src/copilot/config/system-prompt/sdk-introspection.js
 *
 * Superfície canônica para introspecionar as capacidades nativas do SDK ligadas a instruções/system prompt.
 *
 * @module copilot/config/system-prompt/sdk-introspection
 */

import { getSectionDescription, getSectionNames, supportsCustomizeMode } from '#copilot/sdk';

/**
 * @typedef {import('#copilot/sdk/types').CopilotSession} CopilotSession
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
    if (!session?.rpc?.instructions?.getSources) {
        throw new TypeError('[config/system-prompt] instructions.getSources indisponível nesta sessão SDK');
    }
    return session.rpc.instructions.getSources();
}
