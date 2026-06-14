// @ts-check
/**
 * Nomes temporários irmãos para publicação atômica no mesmo filesystem.
 *
 * @module copilot/infra/io/fs/temp-path
 */

import { randomBytes } from 'node:crypto';
import path from 'node:path';

const TEMP_TOKEN_BYTES = 16;
const MAX_TEMP_ENTRY_BYTES = 240;
const TEMP_ROLE_PATTERN = /^[a-z][a-z0-9-]{0,31}$/;

/**
 * Mantém o prefixo UTF-8 dentro do orçamento sem cortar um code point.
 *
 * @param {string} value
 * @param {number} maxBytes
 * @returns {string}
 */
function truncateUtf8Prefix(value, maxBytes) {
    if (Buffer.byteLength(value, 'utf8') <= maxBytes) return value;
    let result = '';
    let bytes = 0;
    for (const character of value) {
        const characterBytes = Buffer.byteLength(character, 'utf8');
        if (bytes + characterBytes > maxBytes) break;
        result += character;
        bytes += characterBytes;
    }
    return result;
}

/**
 * Cria um nome oculto no diretório do destino. A criação exclusiva continua
 * sendo a autoridade final para detectar uma colisão.
 *
 * @param {string} targetPath
 * @param {string} role
 * @returns {string}
 */
export function createSiblingTempPath(targetPath, role) {
    if (typeof targetPath !== 'string' || targetPath.length === 0) {
        throw new TypeError('targetPath deve ser um caminho não vazio.');
    }
    if (!TEMP_ROLE_PATTERN.test(role)) {
        throw new TypeError('role de temporário inválido.');
    }

    const token = randomBytes(TEMP_TOKEN_BYTES).toString('hex');
    const suffix = `.${process.pid}.${token}.${role}.tmp`;
    const basenameBudget = MAX_TEMP_ENTRY_BYTES - Buffer.byteLength(suffix, 'utf8') - 1;
    const basename = truncateUtf8Prefix(path.basename(targetPath), basenameBudget);
    return path.join(path.dirname(targetPath), `.${basename}${suffix}`);
}
