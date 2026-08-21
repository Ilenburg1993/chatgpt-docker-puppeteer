// @ts-check
/**
 * Shared parser contracts with no runtime ownership.
 *
 * Runtime parser/cache/context modules depend on these contracts in one direction. Keeping the contracts here avoids
 * type-only back-edges such as cache-state -> context -> cache-state.
 *
 * @module copilot/infra/indexing/parser/foundation/types
 */

/** @typedef {import('#copilot/types/io-analysis').SymbolEntry} SymbolEntry */
/** @typedef {import('#copilot/types/io-analysis').ImportEntry} ImportEntry */
/**
 * @typedef {object} FileSymbols
 * @property {string} filePath
 * @property {string} ext
 * @property {string} parserPolicyVersion
 * @property {SymbolEntry[]} symbols
 * @property {ImportEntry[]} imports
 * @property {string[]} exports
 * @property {string | null} parseError
 * @property {boolean} truncated
 * @property {number} lines
 * @property {number} bytes
 * @property {number} parsedBytes
 * @property {number} parseDurationMs
 *
 * @typedef {object} FileContext
 * @property {FileSymbols} symbols
 * @property {string[]} outline
 * @property {string[]} topComments
 *
 * @typedef {{ sizeBytes: number; mtimeMs: number; ctimeMs: number; dev: number; ino: number }} ParserFingerprint
 * @typedef {{ symbols: FileSymbols; fingerprint: ParserFingerprint }} SymbolCacheEntry
 */

export {};
