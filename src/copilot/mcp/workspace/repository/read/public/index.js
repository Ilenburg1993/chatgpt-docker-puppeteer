// @ts-check
/** Exact public membrane for validated repository read/navigation operations. */

export { diffRepositoryFiles, readRepositoryFile, readRepositoryFileChunks, readRepositoryFileStats } from '../file-operations.js';
export {
    auditRepositoryRootRedaction,
    findRepositorySymbolUsages,
    readRepositoryFileOutline,
    readRepositoryTree,
    searchRepositorySymbols,
    searchRepositoryText,
} from '../navigation.js';
