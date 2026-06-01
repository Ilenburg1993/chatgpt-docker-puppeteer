// @ts-check
/**
 * Prometheus histogram helpers for compact cloudflared latency summaries.
 *
 * @module copilot/mcp/cloudflare/metrics-histograms
 */

/**
 * @typedef {{ name: string; labels: Record<string, string>; value: number }} PrometheusSampleLike
 */

const HISTOGRAM_TARGETS = [
    {
        key: 'proxyConnectLatency',
        bucket: 'cloudflared_proxy_connect_latency_bucket',
        count: 'cloudflared_proxy_connect_latency_count',
        sum: 'cloudflared_proxy_connect_latency_sum',
        unit: 'seconds',
    },
    {
        key: 'rpcClientLatency',
        bucket: 'cloudflared_rpc_client_latency_secs_bucket',
        count: 'cloudflared_rpc_client_latency_secs_count',
        sum: 'cloudflared_rpc_client_latency_secs_sum',
        unit: 'seconds',
    },
];

/**
 * @param {PrometheusSampleLike[]} samples
 * @returns {Record<string, unknown>}
 */
export function summarizeCloudflaredLatencyHistograms(samples) {
    /** @type {Record<string, unknown>} */
    const summary = {};
    for (const target of HISTOGRAM_TARGETS) {
        const count = latestValue(samples, target.count);
        const sum = latestValue(samples, target.sum);
        const buckets = samples
            .filter((sample) => sample.name === target.bucket)
            .map((sample) => ({ le: parseBucketLe(sample.labels['le']), value: sample.value }))
            .filter((bucket) => bucket.le !== null)
            .sort((a, b) => /** @type {number} */ (a.le) - /** @type {number} */ (b.le));
        const infiniteBucket = samples.find(
            (sample) => sample.name === target.bucket && ['+Inf', 'Inf'].includes(String(sample.labels['le'] ?? '')),
        );
        const total = count ?? infiniteBucket?.value ?? null;
        const finiteBucketTotal = buckets.length > 0 ? buckets[buckets.length - 1]?.value ?? 0 : 0;
        const averageSeconds = count && sum !== null ? sum / count : null;
        summary[target.key] = {
            count,
            sumSeconds: sum,
            averageMs: averageSeconds === null ? null : Math.round(averageSeconds * 1000),
            p50Ms: histogramQuantileMs(0.5, buckets, total),
            p95Ms: histogramQuantileMs(0.95, buckets, total),
            p99Ms: histogramQuantileMs(0.99, buckets, total),
            bucketCount: buckets.length,
            hasInfiniteBucket: Boolean(infiniteBucket),
            finiteBucketCoverage: total && total > 0 ? Number((finiteBucketTotal / total).toFixed(6)) : null,
            unit: target.unit,
        };
    }
    return summary;
}

/**
 * @param {PrometheusSampleLike[]} samples
 * @returns {Record<string, unknown>}
 */
export function summarizeCloudflaredOperationalCounters(samples) {
    const totalRequests = latestValue(samples, 'cloudflared_tunnel_total_requests');
    const requestErrors = latestValue(samples, 'cloudflared_tunnel_request_errors');
    const activeTcpSessions = latestValue(samples, 'cloudflared_tcp_active_sessions');
    const totalTcpSessions = latestValue(samples, 'cloudflared_tcp_total_sessions');
    const activeUdpSessions = latestValue(samples, 'cloudflared_udp_active_sessions');
    const haConnections = latestValue(samples, 'cloudflared_tunnel_ha_connections');
    const registerSuccess = latestValue(samples, 'cloudflared_tunnel_tunnel_register_success');
    return {
        totalRequests,
        requestErrors,
        requestErrorRate: requestErrors === null ? null : rateOrNull(requestErrors, totalRequests),
        activeTcpSessions,
        totalTcpSessions,
        activeUdpSessions,
        haConnections,
        registerSuccess,
        responseCodes: summarizeResponseCodes(samples),
    };
}

/**
 * @param {PrometheusSampleLike[]} samples
 * @returns {Record<string, number>}
 */
function summarizeResponseCodes(samples) {
    /** @type {Record<string, number>} */
    const output = {};
    for (const sample of samples.filter((item) => item.name === 'cloudflared_tunnel_response_by_code')) {
        const code = sample.labels['code'] ?? sample.labels['status'] ?? 'unknown';
        output[code] = sample.value;
    }
    return output;
}

/**
 * @param {number} numerator
 * @param {number | null} denominator
 * @returns {number | null}
 */
function rateOrNull(numerator, denominator) {
    if (denominator === null || denominator <= 0) return null;
    return Number((numerator / denominator).toFixed(6));
}

/**
 * @param {number} quantile
 * @param {{ le: number | null; value: number }[]} buckets
 * @param {number | null} totalOverride
 * @returns {number | null}
 */
function histogramQuantileMs(quantile, buckets, totalOverride = null) {
    const finiteBuckets = buckets.filter((bucket) => bucket.le !== null && Number.isFinite(bucket.le));
    const total = totalOverride ?? (finiteBuckets.length > 0 ? finiteBuckets[finiteBuckets.length - 1]?.value ?? 0 : 0);
    if (total <= 0) return null;
    const threshold = total * quantile;
    let previousLe = 0;
    let previousCount = 0;
    for (const bucket of finiteBuckets) {
        const le = /** @type {number} */ (bucket.le);
        const count = bucket.value;
        if (count >= threshold) {
            const bucketCount = count - previousCount;
            if (bucketCount <= 0) return Math.round(le * 1000);
            const position = (threshold - previousCount) / bucketCount;
            const seconds = previousLe + (le - previousLe) * position;
            return Math.round(seconds * 1000);
        }
        previousLe = le;
        previousCount = count;
    }
    const lastFiniteLe = finiteBuckets[finiteBuckets.length - 1]?.le;
    return typeof lastFiniteLe === 'number' ? Math.round(lastFiniteLe * 1000) : null;
}

/**
 * @param {string | undefined} value
 * @returns {number | null}
 */
function parseBucketLe(value) {
    if (value === '+Inf' || value === 'Inf' || value === undefined) return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}

/**
 * @param {PrometheusSampleLike[]} samples
 * @param {string} name
 * @returns {number | null}
 */
function latestValue(samples, name) {
    for (let index = samples.length - 1; index >= 0; index -= 1) {
        if (samples[index]?.name === name) return samples[index]?.value ?? null;
    }
    return null;
}
