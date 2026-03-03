import fs from 'node:fs';

/**
 * @param {{ filePath: string, payload: Record<string, any> }} options
  * @returns {void}
 */
export function appendJsonl(options) {
    fs.appendFileSync(options.filePath, `${JSON.stringify(options.payload)}\n`, 'utf8');
}
