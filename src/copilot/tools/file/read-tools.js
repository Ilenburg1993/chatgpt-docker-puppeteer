// @ts-check
/**
 * src/copilot/tools/file/read-tools.js
 *
 * Barrel — re-exporta as 4 file read tools de read-tools-io e read-tools-search.
 *
 * @module copilot/tools/file/read-tools
 * @see EventBus
 */

import { withSkipPermission } from '../tool-factory.js';

export { listDirectoryTool, readFileContentTool } from './read-tools-io.js';
export { diffFilesTool, searchInFilesTool } from './read-tools-search.js';

import { listDirectoryTool, readFileContentTool } from './read-tools-io.js';
import { diffFilesTool, searchInFilesTool } from './read-tools-search.js';

/**
 * @type {import('#copilot/sdk/types').Tool<any>[]}
 */
export const fileReadTools = [
    withSkipPermission(readFileContentTool),
    listDirectoryTool,
    searchInFilesTool,
    diffFilesTool,
];
