// @ts-check
/** Shared immutable type contracts for operation/change-set/rollback orchestration. */

/**
 * @typedef {'planned' | 'applied' | 'failed' | 'dry-run'} IoOperationStatus
 * @typedef {object} IoOperationEnvelope
 * @property {string} operationId
 * @property {string} capability
 * @property {import('#copilot/core/io-contracts').IoRiskClass} riskClass
 * @property {string[]} targets
 * @property {IoOperationStatus} status
 * @property {number} startedAtMs
 * @property {number | null} completedAtMs
 * @property {number | null} durationMs
 * @property {string | null} traceId
 * @property {Record<string, unknown>} evidence
 * @property {string | null} error
 *
 * @typedef {'write' | 'patch' | 'delete' | 'copy' | 'move'} IoChangeAction
 * @typedef {object} IoRollbackHint
 * @property {IoChangeAction} action
 * @property {string} target
 * @property {string | null} [source]
 * @property {string | null} [destination]
 * @property {string | null} [previousHash]
 * @property {string | null} [contentHash]
 * @property {number | null} [bytes]
 * @property {string | null} [snapshotBase64]
 * @property {import('#copilot/infra/internal/filesystem/transaction').IoRollbackSidecar | null} [snapshotSidecar]
 *
 * @typedef {object} IoChangeSetEntry
 * @property {string} entryId
 * @property {number} createdAtMs
 * @property {string} operationId
 * @property {IoChangeAction} action
 * @property {string[]} targets
 * @property {Record<string, unknown>} evidence
 * @property {IoRollbackHint | null} rollback
 *
 * @typedef {'open' | 'applied' | 'failed' | 'rolled-back' | 'aborted'} IoChangeSetStatus
 * @typedef {object} IoChangeSet
 * @property {string} changeSetId
 * @property {number} createdAtMs
 * @property {number | null} closedAtMs
 * @property {IoChangeSetStatus} status
 * @property {IoOperationEnvelope} operation
 * @property {IoChangeSetEntry[]} entries
 */

export {};
