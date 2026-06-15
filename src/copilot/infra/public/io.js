// @ts-check
/**
 * Facade pública operacional de I/O local para consumidores fora de `src/copilot/infra`.
 *
 * Este módulo é a porta barrel-first para tools e adapters. Implementações internas ainda vivem em módulos legados
 * durante a migração 2.0/2.1. Esta facade não aplica containment: tools workspace-bound usam `workspace-io.js`, e
 * paths trusted/portable fora do workspace usam `trusted-io.js`.
 *
 * @module copilot/infra/public/io
 */

export {
    appendTextLocked,
    copyFileLocked,
    createOrReplaceFileAtomic,
    deleteFileLocked,
    mkdirPathLocked,
    moveFileLocked,
    patchTextLocked,
    readBytes,
    readLines,
    readText,
    readTextChunks,
    readTextChunksStream,
    removePathLocked,
    statPath,
    withIoResourceLock,
    writeFileAtomic,
} from '../io/fs/index.js';

export { diffText } from '../io/patch/index.js';
export { searchText, searchWorkspaceSymbols } from '../io/search/index.js';

export { warmReadThroughContext } from '../io-prefetch.js';
export { scanDirectory } from '../io-scanner.js';

// Observabilidade de IO em tempo de execução
export { readIoRuntimeHealthSnapshot } from '../io-health.js';
export { getIoAdvisoryBudgetStats } from '../io-advisory-budget.js';
