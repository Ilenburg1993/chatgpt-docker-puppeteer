// @ts-check
/**
 * Facade pública de indexação/busca persistente.
 *
 * @module copilot/infra/public/indexing
 */

export {
    buildIoIndexForDirectory,
    findIoIndexSymbol,
    getIoIndexStats,
    invalidateIoIndexPath,
    searchIoIndex,
} from '../io-index-registry.js';
