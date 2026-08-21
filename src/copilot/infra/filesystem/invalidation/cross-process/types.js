// @ts-check
/** JSDoc-only contracts for cross-process invalidation. */
/** @typedef {{ recursive?: boolean; source?: string }} CrossProcessInvalidationEvent */
/**
 * @typedef {{ sequence:number; processInstance:string; filePath:string; recursive:number; source:string; createdAtMs:number }} CrossProcessInvalidationRow
 */
/**
 * @typedef {{ enabled:boolean; pollMs:number; batchMax:number; maxRows:number; retentionMs:number; cleanupIntervalMs:number }} CrossProcessInvalidationConfig
 */
export {};
