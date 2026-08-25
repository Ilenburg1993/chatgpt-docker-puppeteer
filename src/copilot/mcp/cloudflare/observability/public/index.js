// @ts-check
/** Coherent public membrane for Cloudflare probes, smoke and latency/metrics observability. */

export { runCanonicalConnectorSmoke } from '../connector-smoke.js';
export { readCloudflareHttpLatencyAnalytics } from '../http-latency-analytics.js';
export { summarizeCloudflaredLatencyHistograms, summarizeCloudflaredOperationalCounters } from '../metrics-histograms.js';
export { parsePrometheusMetrics, readCloudflaredMetricsSnapshot, summarizeCloudflaredMetrics } from '../metrics.js';
export { probeHealth } from '../cli-probe.js';
export { runCloudflareSmoke } from '../cli-smoke.js';

export { compactSmokeReport, summarizeConnectorSmokeReport } from '../smoke-report.js';
