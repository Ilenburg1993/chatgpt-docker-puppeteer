// @ts-check
/** JSDoc-only contracts for bounded local search subprocesses. */
/**
 * @typedef {object} SearchSubprocessOptions
 * @property {string | undefined} [cwd]
 * @property {number} [timeout]
 * @property {number} [maxBuffer]
 * @property {AbortSignal} [signal]
 * @property {Readonly<Record<string,string>>} [env]
 *
 * @typedef {SearchSubprocessOptions & {
 *     onStdoutLine?: (line: string) => boolean | void;
 *     collectStdout?: boolean;
 * }} SearchStreamingSubprocessOptions
 */
export {};
