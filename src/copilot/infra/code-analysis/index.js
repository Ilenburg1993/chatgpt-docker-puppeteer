// @ts-check
/** @module copilot/infra/code-analysis */

export { BABEL_PARSER_POLICY_VERSION, formatBabelParserError, resolveBabelParserOptions } from './babel-policy.js';
export { extractBabelFileSymbols } from './babel-symbols.js';
export { extractTopComments } from './comments.js';
export { extractJsonSchema, parseJsonOrJsonlSample } from './json-outline.js';
export { extractMarkdownOutline, extractMarkdownOutlineWithLines } from './markdown-outline.js';
export { buildOutline } from './outline-builder.js';
