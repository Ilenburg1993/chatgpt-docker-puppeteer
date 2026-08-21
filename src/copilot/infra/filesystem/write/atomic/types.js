// @ts-check
/** JSDoc-only contracts for low-level atomic writes. */
/**
 * @typedef {{
 *     mode?: number;
 *     exclusive?: boolean;
 *     requireExists?: boolean;
 *     expectedHash?: string;
 *     durability?: import('#copilot/infra/internal/platform/node/filesystem').IoDurabilityMode;
 *     onPhase?: (phase: string, details: Record<string, unknown>) => void | Promise<void>;
 *     syncDirectory?: typeof import('#copilot/infra/internal/platform/node/filesystem').syncParentDirectoryBestEffort;
 *     capacityPreflight?: typeof import('#copilot/infra/internal/filesystem/transaction').preflightIoCapacity;
 * }} AtomicWriteOptions
 * @typedef {{
 *     durability: import('#copilot/infra/internal/platform/node/filesystem').IoDurabilityMode;
 *     tempPath: string | null;
 *     effectiveMode: number | null;
 *     modeSource: 'explicit' | 'preserved-existing' | 'default';
 *     fileFlushRequested: boolean;
 *     fileSync: Awaited<ReturnType<typeof import('#copilot/infra/internal/platform/node/filesystem').syncFileHandleBestEffort>> | null;
 *     directorySync: Awaited<ReturnType<typeof import('#copilot/infra/internal/platform/node/filesystem').syncParentDirectoryBestEffort>> | null;
 *     capacityPreflight: Awaited<ReturnType<typeof import('#copilot/infra/internal/filesystem/transaction').preflightIoCapacity>>;
 *     phaseTimings: {tempPathMs:number;capacityPreflightMs:number;tempWriteMs:number;modeApplyMs:number;fileSyncMs:number;prePublishCheckMs:number;publishMs:number;directorySyncMs:number;totalMs:number};
 * }} AtomicWriteResult
 */
export {};
