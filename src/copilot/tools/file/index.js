// @ts-check
/**
 * src/copilot/tools/file/index.js
 *
 * Barrel re-export de todas as file-tools (leitura + escrita).
 *
 * @module copilot/tools/file
 * @see EventBus
 */

export {
    diffFilesTool,
    fileReadTools,
    listDirectoryTool,
    readFileContentTool,
    searchInFilesTool,
    symbolSearchTools,
    workspaceSymbolSearchTool,
} from './read-tools.js';

export {
    indexTools,
    workspaceIndexBuildTool,
    workspaceIndexFindSymbolTool,
    workspaceIndexSearchTool,
    workspaceIndexStatusTool,
} from './index-tools.js';

export {
    scopeTools,
    workspaceScopeContextTool,
    workspaceScopeDeclareTool,
    workspaceScopeFindSymbolTool,
    workspaceScopeRefreshTool,
} from './scope-tools.js';

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
    bufferIsAscii,
    bufferIsUtf8,
    concatChunks,
    execFileAsync,
    isRgAvailable,
    MAX_CONTENT_BYTES,
    MAX_DIFF_OUTPUT,
    MAX_LIST_ENTRIES,
    MAX_SEARCH_OUTPUT,
    truncateBuffer,
    validatePath,
    WORKSPACE_ROOT,
} from './shared.js';

/**
 * Conjunto completo de tools de filesystem (leitura + escrita). Re-importado e unificado para manter compatibilidade
 * com consumidores existentes.
 */
import { indexTools } from './index-tools.js';
import { fileReadTools } from './read-tools.js';
import { scopeTools } from './scope-tools.js';
import { fileWriteTools } from './write-tools.js';

/**
 * @type {import('#copilot/sdk/types').Tool[]}
 */
export const fileTools = [...fileReadTools, ...indexTools, ...scopeTools, ...fileWriteTools];
