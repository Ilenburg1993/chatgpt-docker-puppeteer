// @ts-check
/**
 * Facade pública de I/O workspace-facing para consumidores fora de `src/copilot/infra`.
 *
 * Este módulo é a porta barrel-first para tools e adapters. Implementações internas ainda vivem em módulos legados
 * durante a migração 2.0/2.1. Paths trusted/portable fora do workspace usam a facade separada `trusted-io.js`.
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
