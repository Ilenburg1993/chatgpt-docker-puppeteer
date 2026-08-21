// @ts-check
/** Stateless IO telemetry publication helpers. Runtime metrics are owned by InfraRuntime.telemetry. @module copilot/infra/public/telemetry */
export {
    elapsedIoMs,
    nowIoMs,
    publishIoLifecycleEvent,
    publishIoOperation,
    publishIoOperationResult,
} from '../../telemetry/index.js';
