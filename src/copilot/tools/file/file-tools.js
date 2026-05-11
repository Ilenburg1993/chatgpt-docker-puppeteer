// @ts-check
/**
 * src/copilot/tools/file/file-tools.js
 *
 * Agregador concreto do subdomínio `file`. Mantido fora de `index.js` para preservar a regra arquitetural de
 * barrel-only.
 *
 * @module copilot/tools/file/file-tools
 */

import { indexTools } from './index-tools.js';
import { fileReadTools } from './read-tools.js';
import { scopeTools } from './scope-tools.js';
import { fileWriteTools } from './write-tools.js';

/**
 * Normaliza grupos de tools para evitar falhas com mocks parciais em testes unitários.
 *
 * @param {unknown} value
 * @returns {import('#copilot/sdk/types').Tool[]}
 */
function asToolArray(value) {
    return Array.isArray(value) ? value : [];
}

/**
 * Conjunto completo de tools de filesystem (leitura + escrita + index + escopo).
 *
 * @type {import('#copilot/sdk/types').Tool[]}
 */
export const fileTools = [
    ...asToolArray(fileReadTools),
    ...asToolArray(indexTools),
    ...asToolArray(scopeTools),
    ...asToolArray(fileWriteTools),
];
