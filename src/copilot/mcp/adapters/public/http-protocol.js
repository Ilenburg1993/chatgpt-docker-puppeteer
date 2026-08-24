// @ts-check
/** Exact public membrane for MCP HTTP protocol telemetry. */

export {
    buildMcpHttpProtocolReport,
    createMcpHttpProtocolState,
    isHttp2PlusProtocolMode,
    isMcpHttp2PlusSample,
    recordMcpHttpProtocolRequest,
    setMcpHttpProtocolResponseHeaders,
} from '../http-protocol.js';
