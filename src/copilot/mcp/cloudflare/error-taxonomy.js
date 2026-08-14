// @ts-check
/**
 * Shared Cloudflare log taxonomy for MCP tunnel/origin diagnostics.
 *
 * @module copilot/mcp/cloudflare/error-taxonomy
 */

const HARD_ORIGIN_FAILURE_RE =
    /first record does not look like a tls handshake|connection refused|bad gateway|\b502\b|\b1033\b|unable to reach the origin service|tls:|x509:|certificate|no route to host|connection reset by peer/iu;
const BENIGN_CLIENT_OR_STREAM_CLOSE_RE =
    /context canceled|context cancelled|client disconnected|request canceled|request cancelled|stream closed|unexpected eof/iu;

/**
 * Client disconnects and normal stream cancellation can be logged by cloudflared at ERR level. They are operational
 * signals, but not evidence that the origin itself is unhealthy.
 *
 * @param {unknown} line
 */
export function isCloudflaredBenignClientOrStreamCancellationLine(line) {
    return BENIGN_CLIENT_OR_STREAM_CLOSE_RE.test(String(line ?? ''));
}

/**
 * Classify a cloudflared origin error candidate as actionable after excluding known benign client/stream closures.
 * Callers may pass already-filtered ERR/WRN origin lines or raw lines.
 *
 * @param {unknown} line
 */
export function isCloudflaredActionableOriginErrorLine(line) {
    const text = String(line ?? '');
    if (HARD_ORIGIN_FAILURE_RE.test(text)) return true;
    if (isCloudflaredBenignClientOrStreamCancellationLine(text)) return false;
    return /origin service|originService=/iu.test(text) && /\bERR\b|\bWRN\b|error=/iu.test(text);
}
