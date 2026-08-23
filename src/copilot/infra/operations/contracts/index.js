// @ts-check
/** @module copilot/infra/operations/contracts */

/** @typedef {import('./io/index.js').IoOperation} IoOperation */
/** @typedef {import('./io/index.js').IoTargetKind} IoTargetKind */
/** @typedef {import('./io/index.js').IoRiskClass} IoRiskClass */
/** @typedef {import('./io/index.js').IoCacheState} IoCacheState */
/** @typedef {import('./io/index.js').IoErrorCode} IoErrorCode */
/** @typedef {import('./io/index.js').IoMeta} IoMeta */
/** @typedef {import('./io/index.js').IoFailure} IoFailure */
/** @template T @typedef {import('./io/index.js').IoSuccess<T>} IoSuccess */
/** @typedef {import('./types.js').IoOperationStatus} IoOperationStatus */
/** @typedef {import('./types.js').IoOperationEnvelope} IoOperationEnvelope */
/** @typedef {import('./types.js').IoChangeAction} IoChangeAction */
/** @typedef {import('./types.js').IoRollbackHint} IoRollbackHint */
/** @typedef {import('./types.js').IoRollbackSidecar} IoRollbackSidecar */
/** @typedef {import('./types.js').IoChangeSetEntry} IoChangeSetEntry */
/** @typedef {import('./types.js').IoChangeSetStatus} IoChangeSetStatus */
/** @typedef {import('./types.js').IoChangeSet} IoChangeSet */

export {};

export { IO_POLICY_VERSION, buildIoMeta, createIoTraceId, ioFail, ioOk, toIoError, withIoMeta } from './io/index.js';
