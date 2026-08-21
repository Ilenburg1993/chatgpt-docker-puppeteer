// @ts-check
/**
 * Pure shared contracts for source-code analysis projections.
 *
 * This module intentionally has no runtime imports. It is the SSOT for structural analysis records shared by
 * low-level code-analysis and higher-level indexing/parser orchestration.
 *
 * @module copilot/types/io-analysis
 */

/**
 * @typedef {object} SymbolEntry
 * @property {'function' | 'class' | 'variable' | 'type' | 'interface' | 'enum' | 'import' | 'export'} kind
 * @property {string} name
 * @property {boolean} exported
 * @property {number} line
 * @property {string | null} [docComment]
 */

/**
 * @typedef {object} ImportEntry
 * @property {string} source
 * @property {string[]} specifiers
 * @property {boolean} isDynamic
 * @property {number} line
 */

export {};
