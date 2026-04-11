// @ts-check
/**
 * src/copilot/tools/file/index.js
 *
 * Barrel re-export de todas as file-tools (leitura + escrita).
 *
 * @module copilot/tools/file
 */

export {
    diffFilesTool,
    fileReadTools,
    listDirectoryTool,
    readFileContentTool,
    searchInFilesTool,
} from './read-tools.js';

export {
    copyFileTool,
    createFileTool,
    deleteFileTool,
    fileWriteTools,
    moveFileTool,
    patchFileTool,
    writeFileContentTool,
} from './write-tools.js';

export {
    BLOCKED_PATTERNS_SECRETS,
    execFileAsync,
    isRgAvailable,
    MAX_CONTENT_BYTES,
    MAX_LIST_ENTRIES,
    MAX_SEARCH_OUTPUT,
    validatePath,
    WORKSPACE_ROOT,
} from './shared.js';

/**
 * Conjunto completo de tools de filesystem (leitura + escrita). Re-importado e unificado para manter compatibilidade
 * com consumidores existentes.
 */
import { fileReadTools } from './read-tools.js';
import { fileWriteTools } from './write-tools.js';

/**
 * @type {import('#copilot/sdk/types').Tool[]}
 */
export const fileTools = [...fileReadTools, ...fileWriteTools];
