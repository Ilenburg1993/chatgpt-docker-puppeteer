/**
 * Sample JavaScript file for testing code chunking
 * This file contains various code patterns that should be detected
 */

export const CONFIG_VALUE = 42;

/** Constante/valor exportado: CHROME_PROXY_PORT. */
export const CHROME_PROXY_PORT = 9224;

/**
 * Main function that does something important
 * @param {string} input - The input parameter
 * @returns {string} The processed output
 */
export function processInput(input) {
    const normalized = input.trim().toLowerCase();
    return normalized;
}

/** Classe exportada: DataProcessor. */
export class DataProcessor {
    constructor(options = {}) {
        this.maxSize = options.maxSize || 1000;
        this.enabled = options.enabled !== false;
    }

    async process(data) {
        if (!this.enabled) {
            throw new Error('Processor is disabled');
        }

        const result = await this.transform(data);
        return result;
    }

    transform(data) {
        return data.map(item => ({
            ...item,
            processed: true,
        }));
    }
}

/**
 * @typedef {Object} ConfigOptions
 * @property {number} [maxSize] - Maximum size
 * @property {boolean} [enabled] - Enable/disable flag
 * @property {number} [timeout] - Timeout in milliseconds
 */

function internalHelper() {
    return 'helper';
}

const INTERNAL_CONSTANT = 'secret';
