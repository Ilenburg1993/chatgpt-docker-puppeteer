// @ts-check
/**
 * Local cloudflared metrics helpers.
 *
 * @module copilot/mcp/cloudflare/metrics
 */

import { readCloudflareTunnelConfig } from './config.js';
import {
    summarizeCloudflaredLatencyHistograms,
    summarizeCloudflaredOperationalCounters,
} from './metrics-histograms.js';

/**
 * @typedef {{ name: string; labels: Record<string, string>; value: number }} PrometheusSample
 */

/**
 * @param {{ url?: string; timeoutMs?: number }} [options]
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
        const text = await response.text();
        const parsed = parsePrometheusMetrics(text);
        return {
            ok: response.ok,
            status: response.status,
            url,
            metricsAddr: config.metricsAddr ?? null,
            ...summarizeCloudflaredMetrics(parsed),
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
 * @returns {Record<string, unknown>}
 */
export function summarizeCloudflaredMetrics(samples) {
    const metricNames = [...new Set(samples.map((sample) => sample.name))].sort((left, right) => left.localeCompare(right));
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
        metricNames,
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
    };
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
