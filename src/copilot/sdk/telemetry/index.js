// @ts-check
/**
 * src/copilot/sdk/telemetry/index.js — Barrel canônico de `sdk/telemetry/`
 *
 * Política 2.1: export surface explícita (runtime-only), prevenindo conflito de typedefs (`CopilotClient`,
 * `AccountQuotaResult`, `QuotaSnapshot`) no declaration emit.
 *
 * @module copilot/sdk/telemetry
 */

export { fullHealthCheck, getAuthStatus, getQuota, isServerReachable, pingCheck } from './health.js';

export { emitSdkOperationMetric, setSdkMetricEmitter } from './operation-metrics.js';

export { createQuotaMonitor } from './quota-monitor.js';

export {
    createFileTelemetry,
    createOtlpTelemetry,
    createStaticTraceProvider,
    createTelemetryConfig,
    getTraceContext,
} from './tracing.js';
