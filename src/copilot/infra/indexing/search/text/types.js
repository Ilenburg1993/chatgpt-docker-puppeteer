// @ts-check
/** JSDoc-only contracts for completeness-oriented text search orchestration. */
/**
 * @typedef {object} TextSearchOptions
 * @property {string} pattern
 * @property {string} [workspaceRoot]
 * @property {boolean} [isRegex]
 * @property {boolean} [caseSensitive]
 * @property {string} [includePattern]
 * @property {string} [excludePattern]
 * @property {number} [contextLines]
 * @property {boolean} [withLineNumbers]
 * @property {number} [maxResults]
 * @property {string | number | null} [cursor]
 * @property {string} [traceId]
 *
 * @typedef {object} TextSearchResult
 * @property {string} targetPath
 * @property {string} pattern
 * @property {string} output
 * @property {number} matchCount
 * @property {number} [returnedMatchCount]
 * @property {number} [returnedLineCount]
 * @property {string} engine
 * @property {boolean} sanitized
 * @property {number} redactions
 * @property {boolean} [truncated]
 * @property {string | null} [nextCursor]
 * @property {number} [cursorOffset]
 * @property {number} [totalMatches]
 * @property {number} [totalMatchCount]
 * @property {number} [totalLineCount]
 * @property {true} countsPostSanitization
 * @property {boolean} [indexFallback]
 * @property {string | null} [indexFallbackReason]
 * @property {import('#copilot/core/io-contracts').IoMeta} io
 *
 * @typedef {(engine: string, bytesRead: number, extra?: Record<string, unknown>) => import('#copilot/core/io-contracts').IoMeta} BuildSearchIo
 */
export {};
