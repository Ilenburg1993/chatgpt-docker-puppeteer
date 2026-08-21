// @ts-check
/** Sanitization, redaction and streaming-output collection shared by search operations. */

import { sanitizeIoTextOutput } from '#copilot/core';

const sensitiveLineRe = /-----BEGIN [A-Z ]+-----|ey[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/;

/**
 * @param {string} line
 * @returns {{ text: string; sanitized: boolean; redactions: number; filtered: boolean; policyVersion: string }}
 */
function sanitizeSearchLine(line) {
    if (sensitiveLineRe.test(line)) {
        const sanitized = sanitizeIoTextOutput({ text: '' });
        return { ...sanitized, filtered: true, sanitized: true, redactions: sanitized.redactions + 1 };
    }
    return { ...sanitizeIoTextOutput({ text: line }), filtered: false };
}

/**
 * @param {string} stdout
 * @returns {{
 *     text: string;
 *     sanitized: boolean;
 *     redactions: number;
 *     filteredLines: number;
 *     policyVersion: string;
 * }}
 */
export function sanitizeSearchOutput(stdout) {
    let filteredLines = 0;
    let sanitized = false;
    let redactions = 0;
    let policyVersion = 'unknown';
    /** @type {string[]} */
    const outputLines = [];
    let start = 0;
    for (let index = 0; index <= stdout.length; index += 1) {
        if (index < stdout.length && stdout.charCodeAt(index) !== 10) continue;
        const line = sanitizeSearchLine(stdout.slice(start, index));
        policyVersion = line.policyVersion;
        sanitized = sanitized || line.sanitized;
        redactions += line.redactions;
        if (line.filtered) {
            filteredLines += 1;
        } else {
            outputLines.push(line.text);
        }
        start = index + 1;
    }
    const finalSanitized = sanitizeIoTextOutput({ text: outputLines.join('\n') });
    return {
        ...finalSanitized,
        sanitized: filteredLines > 0 || sanitized || finalSanitized.sanitized,
        redactions: redactions + finalSanitized.redactions,
        filteredLines,
        policyVersion: finalSanitized.policyVersion || policyVersion,
    };
}

/**
 * @param {ReturnType<typeof import('../projection/index.js').normalizeSearchWindow>} searchWindow
 */
export function createStreamingSearchCollector(searchWindow) {
    /** @type {string[]} */
    const lines = [];
    const stopAfter = searchWindow.maxResults === null ? null : searchWindow.cursorOffset + searchWindow.maxResults + 1;
    let sanitized = false;
    let redactions = 0;
    let filteredLines = 0;
    let policyVersion = 'unknown';

    return {
        /**
         * @param {string} line
         * @returns {boolean}
         */
        accept(line) {
            const result = sanitizeSearchLine(line);
            policyVersion = result.policyVersion;
            if (result.filtered) {
                sanitized = true;
                redactions += result.redactions;
                filteredLines += 1;
                return true;
            }
            sanitized = sanitized || result.sanitized;
            redactions += result.redactions;
            lines.push(result.text);
            return stopAfter === null || lines.length < stopAfter;
        },
        snapshot() {
            return {
                text: lines.join('\n'),
                sanitized,
                redactions,
                filteredLines,
                policyVersion,
            };
        },
    };
}

/**
 * Conta apenas linhas de match real (`path:linenum:text`), excluindo contexto (`path-linenum-text`) e separadores.
 *
 * @param {string} text
 * @returns {number}
 */
export function countSearchMatchLines(text) {
    let matches = 0;
    let start = 0;
    for (let index = 0; index <= text.length; index += 1) {
        if (index < text.length && text.charCodeAt(index) !== 10) continue;
        if (/^(?:.+:)?\d+:/.test(text.slice(start, index))) matches += 1;
        start = index + 1;
    }
    return matches;
}

/**
 * @param {string} text
 * @returns {number}
 */
export function countSearchOutputLines(text) {
    if (!text) return 0;
    let lines = 1;
    for (let index = 0; index < text.length; index += 1) {
        if (text.charCodeAt(index) === 10) lines += 1;
    }
    return text.charCodeAt(text.length - 1) === 10 ? lines - 1 : lines;
}
