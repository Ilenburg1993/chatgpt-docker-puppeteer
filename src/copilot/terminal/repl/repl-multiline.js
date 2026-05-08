// @ts-check
/**
 * @module copilot/terminal/repl-multiline
 * @file Estado de entrada multiline do REPL.
 */

/**
 * @typedef {{
 *     complete: boolean;
 *     line: string | null;
 *     wasBuffered: boolean;
 * }} TerminalMultilineResult
 */

/**
 * @returns {{
 *     acceptLine: (line: string) => TerminalMultilineResult;
 *     reset: () => void;
 *     hasPending: () => boolean;
 * }}
 */
export function createTerminalMultilineInputState() {
    /** @type {string[]} */
    let buffer = [];

    return {
        acceptLine(line) {
            if (line.endsWith('\\')) {
                buffer.push(line.slice(0, -1));
                return { complete: false, line: null, wasBuffered: true };
            }
            if (buffer.length === 0) {
                return { complete: true, line, wasBuffered: false };
            }
            buffer.push(line);
            const joined = buffer.join('\n');
            buffer = [];
            return { complete: true, line: joined, wasBuffered: true };
        },
        reset() {
            buffer = [];
        },
        hasPending() {
            return buffer.length > 0;
        },
    };
}
