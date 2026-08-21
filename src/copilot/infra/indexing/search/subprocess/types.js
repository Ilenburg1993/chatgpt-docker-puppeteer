// @ts-check
/** JSDoc-only contracts for bounded local search subprocesses. */
/**
 * @typedef {object} SearchSubprocessOptions
 * @property {string | undefined} [cwd]
 * @property {number} [timeout]
 * @property {number} [maxBuffer]
 * @property {AbortSignal} [signal]
 *
 * @typedef {SearchSubprocessOptions & {
 *     onStdoutLine?: (line: string) => boolean | void;
 *     collectStdout?: boolean;
 * }} SearchStreamingSubprocessOptions
 */
export {};
