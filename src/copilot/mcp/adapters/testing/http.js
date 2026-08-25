// @ts-check
/** White-box testing membrane for MCP HTTP host-adapter handler and white-box policy/runtime primitives. */

export { readMcpHttpRequestPolicy } from '../http/config.js';
export { createMcpHttpRequestHandler } from '../http/handler.js';
export { createMcpAnonymousRateLimiter, sweepAnonymousRateLimitBuckets } from '../http/rate-limiter.js';
export {
    buildAnonymousRateLimitKey,
    firstForwardedProto,
    isTrustedProxyHeaderRequest,
} from '../http/request-identity.js';
export { classifyMcpCompatibilityContinuity, classifyMcpCompatibilityRpcClass } from '../http/telemetry.js';

export { readMcpHttpJsonBody } from '../http-body.js';
export { readMcpHttpSessionRuntimeState } from '../http/runtime-state.js';

export { createMcpHttpProtocolState } from '../http-protocol.js';
