// @ts-check
/** Physical public membrane for MCP connector-profile contracts. */

export {
    buildChatGptConnectorProfile,
    buildClaudeConnectorProfile,
    buildCloudflareTunnelRunbook,
    buildHttp2PlusProfile,
    buildSecureTunnelRunbook,
    CHATGPT_CONNECTOR_DESCRIPTION,
    CHATGPT_CONNECTOR_NAME,
    CLAUDE_CONNECTOR_DESCRIPTION,
    CLAUDE_CONNECTOR_NAME,
    formatChatGptConnectorAuthentication,
} from '../profile.js';

export {
    MCP_CONNECTION_DIAGNOSTIC_LIMITS,
    diagnoseMcpOAuthIssuer,
    readMcpConnectionAuthProfile,
} from '../oauth-diagnostics.js';
export {
    checkChatGptConnectorUrl,
    readChatGptConnectorCurrentUrlStatus,
    readChatGptConnectorProfileReport,
    readClaudeConnectorProfileReport,
    readMcpConnectionReadiness,
} from '../readiness.js';
export { normalizeMcpUrl, validatePublicConnectorUrl } from '../url.js';
