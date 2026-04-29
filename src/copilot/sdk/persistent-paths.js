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
import { basename, isAbsolute } from 'node:path';

/**
 * @param {string} name
 */
function assertSafePersistentFileName(name) {
    if (typeof name !== 'string' || name.length === 0) {
        throw new TypeError('[sdk/persistent-paths] name deve ser string não-vazia');
    }
    if (isAbsolute(name) || name.includes('/') || name.includes('\\') || name === '.' || name === '..') {
        throw new TypeError(`[sdk/persistent-paths] name inválido fora do diretório persistente: ${name}`);
    }
    if (basename(name) !== name || name.includes('..')) {
        throw new TypeError(`[sdk/persistent-paths] name inválido fora do diretório persistente: ${name}`);
    }
}

/**
 * @param {string} name
 * @returns {string}
 */
export function resolvePersistentConfigFile(name) {
    assertSafePersistentFileName(name);
    return resolvePersistentConfigFileFromBoot(name);
}
