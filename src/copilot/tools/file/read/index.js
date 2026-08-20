// @ts-check
/**
 * src/copilot/tools/file/read/index.js
 *
 * Barrel interno do subdomínio de leitura de arquivos.
 *
 * @module copilot/tools/file/read
 */

export { buildReadFileMetadata } from './metadata.js';
export { readFileContentTool } from './read-file-content.js';
export { readFilesBatchTool } from './read-files-batch.js';
export { nextLineCursor, normalizeNonNegativeInteger, normalizePositiveInteger, parseReadCursor } from './window.js';
