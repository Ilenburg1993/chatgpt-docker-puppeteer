// @ts-check
/**
 * src/copilot/sdk/persistent-paths.js
 *
 * Helper canônico de caminhos persistentes consumido pela SDK Wrapper Layer. O runtime raiz continua sendo resolvido
 * pelo boot, mas a surface pública para L1 mora em `sdk/`.
 *
 * @module copilot/sdk/persistent-paths
 */

import { resolvePersistentConfigFile as resolvePersistentConfigFileFromBoot } from '#copilot/boot';

/**
 * @param {string} name
 * @returns {string}
 */
export function resolvePersistentConfigFile(name) {
    return resolvePersistentConfigFileFromBoot(name);
}
