// @ts-check
/** @module copilot/infra/public/operations/contracts */
/** @typedef {import('../../../operations/contracts/io/index.js').IoOperation} IoOperation */
/** @typedef {import('../../../operations/contracts/io/index.js').IoTargetKind} IoTargetKind */
/** @typedef {import('../../../operations/contracts/io/index.js').IoRiskClass} IoRiskClass */
/** @typedef {import('../../../operations/contracts/io/index.js').IoCacheState} IoCacheState */
/** @typedef {import('../../../operations/contracts/io/index.js').IoErrorCode} IoErrorCode */
/** @typedef {import('../../../operations/contracts/io/index.js').IoMeta} IoMeta */
/** @typedef {import('../../../operations/contracts/io/index.js').IoFailure} IoFailure */
/** @template T @typedef {import('../../../operations/contracts/io/index.js').IoSuccess<T>} IoSuccess */
export { IO_POLICY_VERSION, buildIoMeta, createIoTraceId, ioFail, ioOk, toIoError, withIoMeta } from '../../../operations/contracts/index.js';
