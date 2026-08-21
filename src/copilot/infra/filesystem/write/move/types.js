// @ts-check
/** JSDoc-only contracts for low-level file move protocols. */
/**
 * @typedef {{
 *   overwrite?:boolean;
 *   expectedSourceHash?:string;
 *   expectedSourceBytes?:number;
 *   onPhase?:(phase:string,details:Record<string,unknown>)=>void|Promise<void>;
 *   syncFile?:typeof import('#copilot/infra/internal/platform/node/filesystem').syncFileBestEffort;
 *   syncDirectory?:typeof import('#copilot/infra/internal/platform/node/filesystem').syncParentDirectoryBestEffort;
 *   capacityPreflight?:typeof import('#copilot/infra/internal/filesystem/transaction').preflightIoCapacity;
 *   tempPathFactory?:typeof import('#copilot/infra/internal/filesystem/transaction').createSiblingTempPath;
 * }} MoveFileOptions
 * @typedef {{
 *   crossDevice:boolean;
 *   duplicatedAfterCrossDeviceMove:boolean;
 *   sourceUnlinkErrorCode:string|null;
 *   destinationHash:string|null;
 *   destinationBytes:number|null;
 *   fileSync:Awaited<ReturnType<typeof import('#copilot/infra/internal/platform/node/filesystem').syncFileBestEffort>>|null;
 *   destinationDirectorySync:Awaited<ReturnType<typeof import('#copilot/infra/internal/platform/node/filesystem').syncParentDirectoryBestEffort>>|null;
 *   sourceDirectorySync:Awaited<ReturnType<typeof import('#copilot/infra/internal/platform/node/filesystem').syncParentDirectoryBestEffort>>|null;
 *   capacityPreflight:Awaited<ReturnType<typeof import('#copilot/infra/internal/filesystem/transaction').preflightIoCapacity>>|null;
 * }} MoveFileResult
 */
export {};
