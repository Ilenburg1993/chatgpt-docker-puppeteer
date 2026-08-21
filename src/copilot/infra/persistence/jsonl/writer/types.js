// @ts-check
/** JSDoc-only contracts for the JSONL writer subcapability. */

/** @typedef {import('#copilot/infra/internal/platform/node/filesystem').IoDurabilityMode} IoDurabilityMode */
/**
 * @typedef {object} JsonlFileWriterOptions
 * @property {string | (() => string)} filePath
 * @property {number} [maxBytes]
 * @property {number} [batchLines]
 * @property {number} [maxQueueLines]
 * @property {number} [softQueueLines]
 * @property {number} [maxTrackedFiles]
 * @property {boolean} [autoFlush]
 * @property {boolean} [flushToDisk]
 * @property {IoDurabilityMode} [durability]
 * @property {number} [sizeRevalidateMs]
 * @property {(filePath: string) => string} [resolveRotatedPath]
 * @property {typeof import('#copilot/infra/internal/platform/node/filesystem').syncParentDirectoryBestEffort} [syncDirectory]
 * @property {(error: unknown) => void} [onError]
 * @property {() => void} [onSuccess]
 * @property {(phase: string, details: Record<string, unknown>) => void | Promise<void>} [onPhase]
 */
export {};
