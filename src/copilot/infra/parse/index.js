// @ts-check
/**
 * Barrel interno de parsers puros.
 *
 * @module copilot/infra/parse
 */

export { formatBabelParserError, resolveBabelParserOptions } from './babel-policy.js';
export { extractBabelFileSymbols } from './babel-symbols.js';
export { extractTopComments } from './comments.js';
export { extractJsonSchema, parseJsonOrJsonlSample } from './json-outline.js';
export { extractMarkdownOutline, extractMarkdownOutlineWithLines } from './markdown-outline.js';
export { buildOutline } from './outline-builder.js';
