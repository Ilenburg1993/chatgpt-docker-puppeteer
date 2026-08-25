// @ts-check
/** Node HTTP listener timing-policy application. */

/**
 * @param {import('node:http').Server} httpServer
 * @param {ReturnType<typeof import('./config.js').readMcpHttpServerTimingPolicy>} policy
 */
export function applyHttp1ServerTimingPolicy(httpServer, policy) {
    httpServer.keepAliveTimeout = policy.keepAliveTimeoutMs;
    httpServer.headersTimeout = policy.headersTimeoutMs;
    httpServer.requestTimeout = policy.requestTimeoutMs;
    httpServer.maxRequestsPerSocket = 0;
    return policy;
}

/**
 * @param {import('node:http2').Http2SecureServer} http2Server
 * @param {ReturnType<typeof import('./config.js').readMcpHttpServerTimingPolicy>} policy
 */
export function applyHttp2ServerTimingPolicy(http2Server, policy) {
    const server =
        /** @type {import('node:http2').Http2SecureServer & { requestTimeout?: number; timeout?: number }} */ (
            http2Server
        );
    server.requestTimeout = policy.requestTimeoutMs;
    server.timeout = policy.keepAliveTimeoutMs;
    server.setTimeout(policy.keepAliveTimeoutMs);
    return policy;
}
