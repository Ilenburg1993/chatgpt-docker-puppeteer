// @ts-check
/**
 * Pure barrel for canonical Infra I/O envelope contracts.
 * @module copilot/infra/operations/contracts/io
 */
/** @typedef {import('./service.js').IoOperation} IoOperation */
/** @typedef {import('./service.js').IoTargetKind} IoTargetKind */
/** @typedef {import('./service.js').IoRiskClass} IoRiskClass */
/** @typedef {import('./service.js').IoCacheState} IoCacheState */
/** @typedef {import('./service.js').IoErrorCode} IoErrorCode */
/** @typedef {import('./service.js').IoMeta} IoMeta */
/** @typedef {import('./service.js').IoFailure} IoFailure */
/** @template T @typedef {import('./service.js').IoSuccess<T>} IoSuccess */

export { IO_POLICY_VERSION, buildIoMeta, createIoTraceId, ioFail, ioOk, toIoError, withIoMeta } from './service.js';
