// @ts-check
/**
 * src/copilot/tools/file/read-tools.js
 *
 * Barrel — re-exporta as 4 file read tools de read-tools-io e read-tools-search.
 *
 * @module copilot/tools/file/read-tools
 * @see EventBus
 */

import { withSkipPermission } from '../infra/tool-factory.js';

import { listDirectoryTool, readFileContentTool } from './read-tools-io.js';
import { diffFilesTool, searchInFilesTool } from './read-tools-search.js';
import { workspaceSymbolSearchTool } from './symbol-search-tool.js';

export { listDirectoryTool, readFileContentTool } from './read-tools-io.js';
export { diffFilesTool, searchInFilesTool } from './read-tools-search.js';
export { symbolSearchTools, workspaceSymbolSearchTool } from './symbol-search-tool.js';

/**
 * @type {import('#copilot/sdk/types').Tool<any>[]}
 */
export const fileReadTools = [
    withSkipPermission(readFileContentTool),
    listDirectoryTool,
    searchInFilesTool,
    diffFilesTool,
    withSkipPermission(workspaceSymbolSearchTool), // M2-VERIFIED: Symbol search tool registrada com skipPermission
];
