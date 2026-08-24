// @ts-check
/** Exact public membrane for repository-index operations. */

export {
    DEFAULT_REPOSITORY_INDEX_PATH,
    buildRepositoryIndex,
    findRepositoryImports,
    findRepositoryIndexSymbol,
    invalidateRepositoryIndex,
    readRepositoryIndexStatus,
    searchRepositoryIndex,
} from '../runtime.js';
export { auditRepositoryOrphanImports } from '../orphan-imports.js';
