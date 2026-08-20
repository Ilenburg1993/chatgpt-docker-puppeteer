// @ts-check
/**
 * Parser puro de shape JSON/JSONL.
 *
 * @module copilot/infra/parse/json-outline
 */

import { iterateTextLines } from '../shared/text-lines.js';

/**
 * Extrai top-level keys de um JSON completo ou da primeira linha JSONL válida.
 *
 * @param {string} content
 * @returns {{
 *     symbols: { kind: 'variable'; name: string; exported: false; line: number; docComment: null }[];
 *     parseError: string | null;
 * }}
 */
export function extractJsonSchema(content) {
    try {
        const first = parseJsonOrJsonlSample(content);
        const obj = Array.isArray(first) ? (first[0] ?? {}) : first;
        const symbols = Object.keys(obj ?? {}).map((k, i) => ({
            kind: /** @type {'variable'} */ ('variable'),
            name: k,
            exported: /** @type {false} */ (false),
            line: i + 1,
            docComment: null,
        }));
        return { symbols, parseError: null };
    } catch (e) {
        return { symbols: [], parseError: String(e) };
    }
}

/**
 * @param {string} content
 * @returns {unknown}
 */
export function parseJsonOrJsonlSample(content) {
    try {
        return JSON.parse(content);
    } catch (error) {
        for (const { text } of iterateTextLines(content)) {
            const sample = text.trim();
            if (sample) return JSON.parse(sample);
        }
        throw error;
    }
}
