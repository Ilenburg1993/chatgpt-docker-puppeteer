// @ts-check
/** Pure indexed module-graph algorithms. @module copilot/infra/indexing/graph */

export {
    buildIndexedModuleGraph,
    computeModuleChangeImpact,
    findModuleGraphCycles,
    findModuleGraphPath,
    graphRelativePath,
    summarizeModuleGraph,
    traverseModuleGraph,
} from './service.js';
