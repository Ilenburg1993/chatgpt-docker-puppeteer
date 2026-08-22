// @ts-check
/** @module copilot/infra/persistence/jsonl */

export { createBoundJsonlFileWriter, createBoundJsonlTailReader } from './bound/index.js';
export {
    classifyJsonlTrailingCandidate,
    collectJsonlTailLines,
    createJsonlTrailingRepairResult,
    discardLeadingPartialJsonlChunks,
    lastJsonlNewlineOffset,
    nonEmptyJsonlLines,
    parseJsonlTailChunks,
    parseJsonlTextRecords,
    resolveJsonlRepairPolicy,
    trimJsonlTextEntries,
} from './kernel/index.js';
export { repairJsonlTrailingPartial } from './repair.js';
export { readJsonlTail } from './tail.js';
export { createJsonlFileWriter } from './writer/index.js';
