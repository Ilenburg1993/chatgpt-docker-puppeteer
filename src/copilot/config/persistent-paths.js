// @ts-check
/**
 * src/copilot/config/persistent-paths.js
 *
 * Adapter de resolução de caminhos persistentes do runtime.
 *
 * Objetivo arquitetural: evitar que camadas consumidoras de configuração (ex.: `sdk/`) importem diretamente de `boot/`,
 * centralizando a fronteira de bootstrap neste módulo de `config/`.
 *
 * @module copilot/config/persistent-paths
 */

import { resolvePersistentConfigFile as resolvePersistentConfigFileFromBoot } from '#copilot/boot';

/**
 * Resolve o caminho absoluto de um arquivo de configuração persistente no workspace.
 *
 * @param {string} name
 * @returns {string}
 */
export function resolvePersistentConfigFile(name) {
    return resolvePersistentConfigFileFromBoot(name);
}
