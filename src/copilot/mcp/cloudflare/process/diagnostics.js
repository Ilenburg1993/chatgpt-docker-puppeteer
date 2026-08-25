// @ts-check
/** Process-owned cloudflared log diagnostics. */

import {
    isCloudflaredActionableOriginErrorLine,
    isCloudflaredBenignClientOrStreamCancellationLine,
} from '../error-taxonomy.js';
import { createCloudflareManagedProcessController } from './cli-process.js';

/**
 * @param {import('../config.js').CloudflareTunnelConfig} config
 * @returns {Promise<Record<string, unknown>>}
 */
export async function readCloudflaredOriginDiagnostics(config) {
    const processes = createCloudflareManagedProcessController(config);
    let text;
    try {
        text = await processes.readCloudflaredLogTail(64_000);
    } catch {
        return {
            logFile: processes.logs.cloudflared,
            originUsesLocalhost: false,
            originUsesLoopbackIp: false,
            recentOriginErrors: [],
            recentBenignOriginCancellations: [],
            recentTunnelTransportErrors: [],
            recentMetricsBindErrors: [],
            recommendation: 'cloudflared log not found yet; run make copilot-mcp-restart and smoke after startup.',
        };
    }
    const logLines = text.split(/\r?\n/u);
    const recentOriginErrorCandidates = logLines.filter(isCloudflaredOriginErrorLine);
    const recentOriginErrors = recentOriginErrorCandidates.filter(isCloudflaredActionableOriginErrorLine).slice(-8);
    const recentBenignOriginCancellations = recentOriginErrorCandidates
        .filter(isCloudflaredBenignClientOrStreamCancellationLine)
        .slice(-8);
    const recentTunnelTransportErrors = logLines.filter(isCloudflaredTunnelTransportErrorLine).slice(-8);
    const recentMetricsBindErrors = logLines.filter(isCloudflaredMetricsBindErrorLine).slice(-4);
    const originUsesLocalhost = /http:\/\/localhost:3333|\[::1\]:3333/iu.test(text);
    const originUsesLoopbackIp = /http:\/\/127\.0\.0\.1:3333/iu.test(text);
    return {
        logFile: processes.logs.cloudflared,
        originUsesLocalhost,
        originUsesLoopbackIp,
        recentOriginErrors,
        recentBenignOriginCancellations,
        recentTunnelTransportErrors,
        recentMetricsBindErrors,
        recommendation: originUsesLocalhost
            ? 'Prefer Cloudflare public hostname service http://127.0.0.1:3333 instead of http://localhost:3333 to avoid IPv6 ::1 origin misses.'
            : null,
    };
}

/** @param {string} line */
export function isCloudflaredOriginErrorLine(line) {
    return (
        /\bERR\b|\bWRN\b|error=/iu.test(line) &&
        /origin service|originService=|first record does not look like a TLS handshake|connection refused|502|1033/iu.test(
            line,
        )
    );
}

/** @param {string} line */
export function isCloudflaredTunnelTransportErrorLine(line) {
    return (
        /\bERR\b|\bWRN\b|error=/iu.test(line) &&
        /failed to accept QUIC stream|failed to run the datagram handler|no recent network activity|accept stream listener|Serve tunnel error|Connection terminated|Failed to dial a quic connection/iu.test(
            line,
        )
    );
}

/** @param {string} line */
export function isCloudflaredMetricsBindErrorLine(line) {
    return /Error opening metrics server listener|failed to bind to address|bind: address already in use/iu.test(line);
}
