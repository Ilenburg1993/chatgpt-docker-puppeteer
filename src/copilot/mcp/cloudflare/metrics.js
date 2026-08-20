// @ts-check
/**
 * Local cloudflared metrics helpers.
 *
 * @module copilot/mcp/cloudflare/metrics
 */

import { readBoundedResponseText } from '#copilot/infra/public/http-response';
import { readCloudflareTunnelConfig } from './config.js';
import {
    summarizeCloudflaredLatencyHistograms,
    summarizeCloudflaredOperationalCounters,
} from './metrics-histograms.js';

/**
 * @typedef {{ name: string; labels: Record<string, string>; value: number }} PrometheusSample
 */

/**
 * @param {{ url?: string; timeoutMs?: number; includeMetricNames?: boolean }} [options]
 * @returns {Promise<Record<string, unknown> & { ok: boolean }>}
 */
export async function readCloudflaredMetricsSnapshot(options = {}) {
    const config = readCloudflareTunnelConfig();
    if (!config.metricsAddr && !options.url) {
        return {
            ok: false,
            metricsAddr: null,
            error: 'Cloudflare metrics endpoint is disabled.',
            nextActions: ['Set COPILOT_MCP_CLOUDFLARE_METRICS_ADDR=127.0.0.1:60123 and restart cloudflared.'],
        };
    }
    const url = options.url ?? `http://${config.metricsAddr}/metrics`;
    try {
        const response = await fetch(url, {
            headers: { accept: 'text/plain' },
            signal: AbortSignal.timeout(options.timeoutMs ?? 5000),
        });
        const text = await readBoundedResponseText(response, {
            maxBytes: 8 * 1024 * 1024,
            label: 'cloudflared metrics',
        });
        const parsed = parsePrometheusMetrics(text);
        return {
            ok: response.ok,
            status: response.status,
            url,
            metricsAddr: config.metricsAddr ?? null,
            ...summarizeCloudflaredMetrics(parsed, { includeMetricNames: options.includeMetricNames === true }),
            error: response.ok ? null : `HTTP ${response.status}`,
        };
    } catch (error) {
        return {
            ok: false,
            url,
            metricsAddr: config.metricsAddr ?? null,
            error: error instanceof Error ? error.message : String(error),
            nextActions: ['Confirm cloudflared was restarted with --metrics and that no other process owns the port.'],
        };
    }
}

/**
 * @param {string} text
 * @returns {PrometheusSample[]}
 */
export function parsePrometheusMetrics(text) {
    const samples = [];
    for (const rawLine of text.split(/\r?\n/u)) {
        const line = rawLine.trim();
        if (!line || line.startsWith('#')) continue;
        const match = /^([a-zA-Z_:][a-zA-Z0-9_:]*)(?:\{([^}]*)\})?\s+([-+]?\d+(?:\.\d+)?(?:e[-+]?\d+)?)$/iu.exec(line);
        if (!match) continue;
        samples.push({
            name: match[1] ?? '',
            labels: parsePrometheusLabels(match[2] ?? ''),
            value: Number(match[3]),
        });
    }
    return samples.filter((sample) => sample.name && Number.isFinite(sample.value));
}

/**
 * @param {string} rawLabels
 * @returns {Record<string, string>}
 */
function parsePrometheusLabels(rawLabels) {
    if (!rawLabels) return {};
    /** @type {Record<string, string>} */
    const labels = {};
    const pattern = /([a-zA-Z_][a-zA-Z0-9_]*)="((?:\\"|[^"])*)"/gu;
    for (const match of rawLabels.matchAll(pattern)) {
        const key = match[1] ?? '';
        if (!key) continue;
        labels[key] = String(match[2] ?? '').replace(/\\"/gu, '"');
    }
    return labels;
}

/**
 * @param {PrometheusSample[]} samples
 * @param {{ includeMetricNames?: boolean }} [options]
 * @returns {Record<string, unknown>}
 */
export function summarizeCloudflaredMetrics(samples, options = {}) {
    const metricNames = [...new Set(samples.map((sample) => sample.name))].sort((left, right) =>
        left.localeCompare(right),
    );
    const buildInfo = samples.find((sample) => sample.name === 'build_info');
    const configVersion = latestValue(samples, 'cloudflared_orchestration_config_version');
    const localConfigPushes = latestValue(samples, 'cloudflared_config_local_config_pushes');
    const localConfigPushErrors = latestValue(samples, 'cloudflared_config_local_config_pushes_errors');
    const registerConnectionSamples = samples.filter(
        (sample) =>
            sample.name === 'cloudflared_rpc_client_latency_secs_count' &&
            sample.labels['method'] === 'register_connection',
    );
    return {
        sampleCount: samples.length,
        metricCount: metricNames.length,
        ...(options.includeMetricNames === true ? { metricNames } : {}),
        metricNamePreview: metricNames.slice(0, 12),
        build: buildInfo
            ? {
                  version: buildInfo.labels['version'] ?? null,
                  revision: buildInfo.labels['revision'] ?? null,
                  goVersion: buildInfo.labels['goversion'] ?? null,
              }
            : null,
        orchestration: {
            configVersion,
            localConfigPushes,
            localConfigPushErrors,
        },
        connections: {
            registerConnectionCount: registerConnectionSamples.reduce((total, sample) => total + sample.value, 0),
        },
        latency: summarizeCloudflaredLatencyHistograms(samples),
        operational: summarizeCloudflaredOperationalCounters(samples),
        quic: summarizeCloudflaredQuicMetrics(samples, metricNames),
    };
}

/**
 * @param {PrometheusSample[]} samples
 * @param {string[]} metricNames
 * @returns {{
 *     present: boolean;
 *     metricCount: number;
 *     totalConnections: number | null;
 *     closedConnections: number | null;
 *     latestRttMs: number | null;
 *     smoothedRttMs: number | null;
 *     rttUnit: string;
 *     mtu: number | null;
 *     maxUdpPayload: number | null;
 *     packetTooBigDropped: number | null;
 * }}
 */
function summarizeCloudflaredQuicMetrics(samples, metricNames) {
    const quicMetricNames = metricNames.filter((name) => name.startsWith('quic_client_'));
    const latestRtt = normalizeQuicRttMetric(latestValue(samples, 'quic_client_latest_rtt'));
    const smoothedRtt = normalizeQuicRttMetric(latestValue(samples, 'quic_client_smoothed_rtt'));
    return {
        present: quicMetricNames.length > 0,
        metricCount: quicMetricNames.length,
        totalConnections: latestValue(samples, 'quic_client_total_connections'),
        closedConnections: latestValue(samples, 'quic_client_closed_connections'),
        latestRttMs: latestRtt.ms,
        smoothedRttMs: smoothedRtt.ms,
        rttUnit: smoothedRtt.unit !== 'unknown' ? smoothedRtt.unit : latestRtt.unit,
        mtu: latestValue(samples, 'quic_client_mtu'),
        maxUdpPayload: latestValue(samples, 'quic_client_max_udp_payload'),
        packetTooBigDropped: latestValue(samples, 'quic_client_packet_too_big_dropped'),
    };
}

/**
 * Cloudflared QUIC RTT metrics have appeared as fractional seconds in fixtures and as integer milliseconds in live
 * Prometheus snapshots. Normalize both forms without weakening the operational gates.
 *
 * @param {number | null} value
 * @returns {{ ms: number | null; unit: 'seconds' | 'milliseconds' | 'unknown' }}
 */
function normalizeQuicRttMetric(value) {
    if (value === null) return { ms: null, unit: 'unknown' };
    if (!Number.isFinite(value) || value < 0) return { ms: null, unit: 'unknown' };
    if (value > 10) return { ms: Math.round(value), unit: 'milliseconds' };
    return { ms: Math.round(value * 1000), unit: 'seconds' };
}

/**
 * @param {PrometheusSample[]} samples
 * @param {string} name
 * @returns {number | null}
 */
function latestValue(samples, name) {
    const sample = [...samples].reverse().find((candidate) => candidate.name === name);
    return sample ? sample.value : null;
}
