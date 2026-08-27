// @ts-check
/** Repository-write domain contracts. */

/** @typedef {import('#copilot/mcp/public/workspace').McpWorkspaceCapability} RepoWriteWorkspaceCapability */
/** @typedef {RepoWriteWorkspaceCapability['io']} RepoWriteIo */

/**
 * @typedef {object} QuarantineMetadata
 * @property {string} quarantineId
 * @property {string} originalPath
 * @property {string} quarantinePath
 * @property {string} metadataPath
 * @property {string} createdAt
 * @property {'quarantining' | 'quarantined' | 'restoring' | 'restored'} status
 * @property {string | null} restoredAt
 * @property {string | null} restoredPath
 * @property {number} sourceBytes
 * @property {string | null} sourceHash
 * @property {{ kind: 'quarantine' | 'restore'; destinationPath: string | null; backupPath: string | null; destinationExisted: boolean } | null} transaction
 */

/** @typedef {(io: RepoWriteIo, metadata: QuarantineMetadata, metadataPath: string, signal?: AbortSignal) => Promise<void>} RepoWriteQuarantineMetadataWriter */
/** @typedef {(io: RepoWriteIo, metadata: QuarantineMetadata, metadataPath: string, writeDefault: RepoWriteQuarantineMetadataWriter) => Promise<void>} RepoWriteQuarantineMetadataInterceptor */

/** @typedef {Readonly<{
 * workspace: RepoWriteWorkspaceCapability;
 * io: RepoWriteIo;
 * workspaceRoot: string;
 * quarantineDir: string;
 * quarantineMetadataWriter: RepoWriteQuarantineMetadataWriter;
 * audit: NonNullable<import('#copilot/mcp/public/protocol/tools').McpToolCapabilityProjection['audit']>;
 * repositoryPatchConfig: import('#copilot/mcp/public/workspace/repository/patch/config').McpRepositoryPatchConfig;
 * signal?: AbortSignal;
 * }>} RepoWriteRuntime */

export {};
