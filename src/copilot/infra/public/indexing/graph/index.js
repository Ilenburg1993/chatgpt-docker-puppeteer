// @ts-check
/** Public runtime surface for indexed module-graph analysis. */

export {
    buildIndexedModuleGraph,
    computeModuleChangeImpact,
    findModuleGraphCycles,
    findModuleGraphPath,
    graphRelativePath,
    summarizeModuleGraph,
    traverseModuleGraph,
} from '../../../indexing/graph/index.js';
