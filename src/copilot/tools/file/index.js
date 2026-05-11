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
