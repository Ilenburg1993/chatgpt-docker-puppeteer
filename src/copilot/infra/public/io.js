// @ts-check
/**
 * Facade pública de I/O local para consumidores fora de `src/copilot/infra`.
 *
 * Este módulo é a porta barrel-first para tools e adapters. Implementações internas ainda vivem em módulos legados
 * durante a migração 2.0/2.1.
 *
 * @module copilot/infra/public/io
 */

export {
    appendTextLocked,
    copyFileLocked,
    createOrReplaceFileAtomic,
    deleteFileLocked,
    diffText,
    mkdirPathLocked,
    moveFileLocked,
    patchTextLocked,
    readBytes,
    readLines,
    readText,
    readTextChunks,
    removePathLocked,
    searchText,
    searchWorkspaceSymbols,
    statPath,
    writeFileAtomic
} from '../io-engine.js';

export { warmReadThroughContext } from '../io-prefetch.js';
export { scanDirectory } from '../io-scanner.js';

// Observabilidade de IO em tempo de execução
export { readIoRuntimeHealthSnapshot } from '../io-health.js';
