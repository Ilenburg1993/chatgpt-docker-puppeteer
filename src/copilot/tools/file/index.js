// @ts-check
/**
 * src/copilot/tools/file/index.js
 *
 * Barrel re-export de todas as file-tools (leitura + escrita).
 * Search tools (search_in_files, workspace_symbol_search, find_symbol_usages) são re-exportadas
 * de `../search/index.js` para manter separação semântica dos domínios.
 *
 * @module copilot/tools/file
 * @see EventBus
 */

export {
    diffFilesTool,
    fileReadTools,
    listDirectoryTool,
    readFileContentTool,
} from './read-tools.js';

export {
    findSymbolUsagesTool,
    searchInFilesTool,
    searchTools,
    symbolSearchTools,
    workspaceSymbolSearchTool,
} from '../search/index.js';

export {
    indexTools,
    workspaceIndexBuildTool,
    workspaceIndexFindSymbolTool,
    workspaceIndexInvalidateTool,
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
    rollbackFileChangesTool,
    rollbackSidecarsStatusTool,
    writeFileContentTool,
} from './write-tools.js';

export {
    BLOCKED_PATTERNS_SECRETS,
    MAX_CONTENT_BYTES,
    MAX_DIFF_OUTPUT,
    MAX_LIST_ENTRIES,
    MAX_SEARCH_OUTPUT,
    WORKSPACE_ROOT,
    bufferIsAscii,
    bufferIsUtf8,
    concatChunks,
    execFileAsync,
    isRgAvailable,
    truncateBuffer,
    validatePath,
} from './shared.js';

export { fileTools } from './file-tools.js';
