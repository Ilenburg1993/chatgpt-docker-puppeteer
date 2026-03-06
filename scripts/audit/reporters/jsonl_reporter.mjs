// @ts-check
import fs from 'node:fs';

/**
 * @typedef {object} AppendJsonlOptions
 * @property {string} filePath
 * @property {Record<string, any>} payload
 */
/**
 * @param {AppendJsonlOptions} options
  * @returns {void}
 */
export function appendJsonl(options) {
    fs.appendFileSync(options.filePath, `${JSON.stringify(options.payload)}\n`, 'utf8');
}
