// @ts-check
/** Pure/micro JSONL algorithms with no filesystem, lock or lifecycle authority. @module copilot/infra/persistence/jsonl/kernel */
export {
    classifyJsonlTrailingCandidate,
    createJsonlTrailingRepairResult,
    lastJsonlNewlineOffset,
    resolveJsonlRepairPolicy,
} from './repair.js';
export {
    collectJsonlTailLines,
    discardLeadingPartialJsonlChunks,
    nonEmptyJsonlLines,
    parseJsonlTailChunks,
    parseJsonlTextRecords,
} from './tail.js';
export { trimJsonlTextEntries } from './trim.js';
