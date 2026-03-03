// @ts-check
import fs from 'node:fs';

/**
 * @param {{ filePath: string, payload: Record<string, unknown> }} options
  * @returns {void}
 */
export function appendJsonl(options) {
    fs.appendFileSync(options.filePath, `${JSON.stringify(options.payload)}\n`, 'utf8');
}
