// @ts-check
/**
 * src/copilot/tools/file/read/index.js
 *
 * Barrel interno do subdomínio de leitura de arquivos.
 *
 * @module copilot/tools/file/read
 */

export { readFileContentTool } from './read-file-content.js';
export { buildReadFileMetadata } from './metadata.js';
export { nextLineCursor, normalizeNonNegativeInteger, normalizePositiveInteger, parseReadCursor } from './window.js';
