// @ts-check
/**
 * ChatGPT / Claude connector profile and tunnel runbook helpers.
 *
 * This module is intentionally side-effect free. It builds canonical form values, URL validation results, OAuth
 * readiness summaries and Cloudflare/HTTP/2+ runbooks used by read-only MCP connection tools.
 *
 * @module copilot/mcp/connection/profile
 */

import {
    MCP_CONNECTION_PROFILE_DEFAULTS,
    readMcpConnectionConfig,
    resolveMcpConnectionProfileOptions,
} from './config.js';
import { buildResourceFromMcpUrl, hasAsciiControlChars, normalizeMcpUrl } from './url.js';

const DEFAULT_LOCAL_HTTP_ORIGIN_URL = MCP_CONNECTION_PROFILE_DEFAULTS.localHttpOriginUrl;
const DEFAULT_LOCAL_HTTP2_ORIGIN_URL = MCP_CONNECTION_PROFILE_DEFAULTS.localHttp2OriginUrl;
const MAX_URL_LENGTH = 2048;

export const CHATGPT_CONNECTOR_NAME = 'Repo DevContainer MCP';

export const CHATGPT_CONNECTOR_DESCRIPTION =
    'Conecta o ChatGPT ao repositório aberto no VS Code Dev Container. ' +
    'Permite ler arquivos, buscar no código, inspecionar Git, executar validadores controlados ' +
    'e operar o workspace por tools MCP auditáveis.';

export const CLAUDE_CONNECTOR_NAME = 'Repo DevContainer MCP';

export const CLAUDE_CONNECTOR_DESCRIPTION =
    'Conecta Claude ao MCP remoto deste workspace via Cloudflare, com OAuth, leitura, busca, Git, validadores e escrita controlada.';

/**
 * @typedef {'none-dev' | 'mixed-auth' | 'oauth' | 'secure-mcp-tunnel'} ChatGptAuthMode
 *
 * @typedef {object} ConnectorProfileOptions
 * @property {string} [publicMcpUrl]
 * @property {string} [localMcpUrl]
 * @property {ChatGptAuthMode} [authMode]
 * @property {string} [tunnelId]
 *
 * @typedef {object} Http2PlusProfile
 * @property {'HTTP/2+'} defaultPolicy
 * @property {'http' | 'http2'} originTransport
 * @property {'auto' | 'http2' | 'quic'} cloudflareTunnelTransport
 * @property {boolean} cloudflareHttp2OriginRequested
 * @property {string} originUrl
 * @property {string} localMcpUrl
 * @property {string} publicMcpUrl
 * @property {string[]} requiredEnvironment
 * @property {string[]} readinessChecks
 * @property {string[]} notes
 *
 * @typedef {object} ConnectorAuthReadiness
 * @property {string} mode
 * @property {string} protectedResourceMetadataUrl
 * @property {string[]} protectedResourceMetadataUrls
 * @property {boolean} authorizationServersConfigured
 * @property {string[]} authorizationServers
 * @property {string[]} scopesSupported
 * @property {string[]} initialScopes
 * @property {string} enforcement
 * @property {boolean} expectedIssuerConfigured
 * @property {string | null} expectedIssuer
 * @property {string | null} expectedAudience
 * @property {string[]} acceptedAudiences
 * @property {boolean} jwksUriConfigured
 * @property {boolean} staticBearerConfigured
 * @property {boolean} oauthRequired
 * @property {string[]} warnings
 *
 * @typedef {object} ConnectorProfile
 * @property {string} name
 * @property {string} description
 * @property {string} connectorUrl
 * @property {ChatGptAuthMode} authMode
 * @property {ConnectorAuthReadiness} authReadiness
 * @property {Http2PlusProfile} http2Plus
 * @property {string} localMcpUrl
 * @property {string} tunnelId
 * @property {{ name: string; description: string; mcpServerUrl: string; authentication: string }} chatgptFormFields
 * @property {string[]} chatgptFormSteps
 * @property {string[]} smokePrompts
 * @property {string[]} requiredLocalChecks
 * @property {string[]} remoteExposureOptions
 * @property {Record<string, Record<string, string>>} environmentTemplates
 */

/**
 * @param {{ mode: string }} [authConfig]
 * @returns {string}
 */
export function formatChatGptConnectorAuthentication(authConfig = readMcpConnectionConfig().auth) {
    if (authConfig.mode === 'oauth') return 'OAuth';
    if (authConfig.mode === 'mixed-auth') return 'Mixed Authentication';
    if (authConfig.mode === 'secure-mcp-tunnel') return 'Secure MCP Tunnel';
    return 'No authentication';
}

/**
 * @param {ConnectorProfileOptions} [options]
 * @param {import('./config.js').McpConnectionConfig} [config]
 * @returns {{
 *     name: string;
 *     description: string;
 *     connectorUrl: string;
 *     claudeFormFields: {
 *         name: string;
 *         remoteMcpServerUrl: string;
 *         oauthClientId: string;
 *         oauthClientSecret: string;
 *     };
 *     oauth: {
 *         mode: string;
 *         protectedResourceMetadataUrls: string[];
 *         authorizationServer: string;
 *         authorizationServers: string[];
 *         scopesSupported: string[];
 *         advancedClientFields: string;
 *     };
 *     http2Plus: Http2PlusProfile;
 *     setupSteps: string[];
 *     smokePrompts: string[];
 *     notes: string[];
 * }}
 */
export function buildClaudeConnectorProfile(options = {}, config = readMcpConnectionConfig()) {
    const resolved = resolveMcpConnectionProfileOptions(options, config);
    const connectorUrl = resolved.publicMcpUrl;
    const authConfig = config.auth;
    const http2Plus = buildHttp2PlusProfile(
        {
            publicMcpUrl: connectorUrl,
            ...(options.localMcpUrl === undefined ? {} : { localMcpUrl: options.localMcpUrl }),
        },
        config,
    );
    return {
        name: CLAUDE_CONNECTOR_NAME,
        description: CLAUDE_CONNECTOR_DESCRIPTION,
        connectorUrl,
        claudeFormFields: {
            name: CLAUDE_CONNECTOR_NAME,
            remoteMcpServerUrl: connectorUrl,
            oauthClientId: '',
            oauthClientSecret: '',
        },
        oauth: {
            mode: authConfig.mode,
            protectedResourceMetadataUrls: buildProtectedResourceMetadataUrls(authConfig),
            authorizationServer: authConfig.authorizationServers[0] ?? authConfig.resource,
            authorizationServers: [...authConfig.authorizationServers],
            scopesSupported: [...authConfig.scopesSupported],
            advancedClientFields:
                'Leave OAuth Client ID and OAuth Client Secret blank. The built-in dev issuer supports public Dynamic Client Registration and Client ID Metadata Documents. For future production issuers, prefer CIMD with private_key_jwt when available.',
        },
        http2Plus,
        setupSteps: [
            'Abrir Claude > Customize > Connectors.',
            'Clicar em + e escolher Add custom connector.',
            `Nome: ${CLAUDE_CONNECTOR_NAME}`,
            `Remote MCP server URL: ${connectorUrl}`,
            'Configurações avançadas: deixar OAuth Client ID e OAuth Client Secret em branco quando usar DCR/CIMD público.',
            'Adicionar, conectar e concluir o fluxo OAuth quando Claude solicitar.',
            'Habilitar o conector na conversa pelo menu + > Connectors.',
        ],
        smokePrompts: buildClaudeSmokePrompts(),
        notes: [
            'Claude custom connectors conectam a partir da infraestrutura Anthropic, então o endpoint precisa continuar público e HTTPS.',
            'O servidor deve publicar Protected Resource Metadata e OAuth Authorization Server Metadata de forma consistente com o recurso canônico.',
            'O caminho público do MCP permanece /mcp; a rota Cloudflare para o origin não deve acrescentar /mcp no serviço de origem.',
            'HTTP/2+ é a postura operacional padrão deste projeto. Mantenha cloudflared, origin local e regra remota sincronizados antes de reconectar o cliente.',
            'A LLM-B local continua independente do MCP; ambas as superfícies devem compartilhar a engine de IO e navegação, não dependência runtime.',
        ],
    };
}

/**
 * @param {ConnectorProfileOptions} [options]
 * @param {import('./config.js').McpConnectionConfig} [config]
 * @returns {ConnectorProfile}
 */
export function buildChatGptConnectorProfile(options = {}, config = readMcpConnectionConfig()) {
    const resolved = resolveMcpConnectionProfileOptions(options, config);
    const connectorUrl = resolved.publicMcpUrl;
    const localUrl = resolved.localMcpUrl;
    const authMode = resolved.authMode;
    const tunnelId = resolved.tunnelId;
    const authConfig = { ...config.auth, mode: authMode };
    const authentication = formatChatGptConnectorAuthentication(authConfig);
    const http2Plus = buildHttp2PlusProfile({ publicMcpUrl: connectorUrl, localMcpUrl: localUrl }, config);
    return {
        name: CHATGPT_CONNECTOR_NAME,
        description: CHATGPT_CONNECTOR_DESCRIPTION,
        connectorUrl,
        authMode,
        authReadiness: buildConnectorAuthReadiness(authConfig),
        http2Plus,
        localMcpUrl: localUrl,
        tunnelId,
        chatgptFormFields: {
            name: CHATGPT_CONNECTOR_NAME,
            description: CHATGPT_CONNECTOR_DESCRIPTION,
            mcpServerUrl: connectorUrl,
            authentication,
        },
        chatgptFormSteps: [
            'Abrir ChatGPT > Settings > Apps & Connectors > Advanced settings e habilitar developer mode.',
            'Abrir Settings > Connectors > Create.',
            `Nome: ${CHATGPT_CONNECTOR_NAME}`,
            `Descrição: ${CHATGPT_CONNECTOR_DESCRIPTION}`,
            `URL do servidor MCP: ${connectorUrl}`,
            `Autenticação: ${authentication}.`,
            'Criar o conector, concluir OAuth quando solicitado e confirmar que a lista de tools aparece.',
            'Executar mcp_connection_readiness e mcp_auth_profile antes de iniciar operações de escrita.',
        ],
        smokePrompts: buildChatGptSmokePrompts(),
        requiredLocalChecks: [
            `MCP local responde em ${localUrl}.`,
            'GET /health retorna ok=true e reporta protocolo/HTTP/2+ sem ler corpo JSON-RPC.',
            'tools/list retorna as tools esperadas.',
            'repo_status funciona localmente antes de testar no ChatGPT.',
            'O tunnel ativo alcança o origin local e preserva o path público /mcp.',
            'OAuth smoke passa com authorization code + PKCE, refresh rotation, userinfo e revocation.',
        ],
        remoteExposureOptions: [
            'Cloudflare Tunnel permanente: modo operacional principal, com hostname mcp.aurelin.org.',
            'Cloudflare Quick Tunnel temporário: fallback explícito via COPILOT_MCP_CLOUDFLARE_MODE=temporary-quick.',
            'OpenAI Secure MCP Tunnel: alternativa privada baseada em tunnel-client quando for preferível não expor o Dev Container diretamente.',
        ],
        environmentTemplates: buildProfileEnvironmentTemplates(connectorUrl, localUrl, authConfig),
    };
}

/**
 * @param {ConnectorProfileOptions} [options]
 * @param {import('./config.js').McpConnectionConfig} [config]
 * @returns {{
 *     prerequisites: string[];
 *     httpTunnelCommands: string[];
 *     stdioTunnelCommands: string[];
 *     chatgptUrl: string;
 *     notes: string[];
 * }}
 */
export function buildSecureTunnelRunbook(options = {}, config = readMcpConnectionConfig()) {
    const profile = buildChatGptConnectorProfile(options, config);
    return {
        prerequisites: [
            'Developer mode habilitado no ChatGPT.',
            'MCP server local validado.',
            'tunnel_id criado em Platform tunnel settings.',
            'Runtime API key com permissões Tunnels Read + Use.',
            'tunnel-client instalado a partir da página oficial ou release oficial.',
            'OAuth em modo resource-server validado antes de expor tools de escrita.',
        ],
        httpTunnelCommands: [
            'export CONTROL_PLANE_API_KEY="sk-..."',
            `tunnel-client init --profile repo-devcontainer-http --tunnel-id ${profile.tunnelId} --mcp-server-url ${profile.localMcpUrl}`,
            'tunnel-client doctor --profile repo-devcontainer-http --explain',
            'tunnel-client run --profile repo-devcontainer-http',
        ],
        stdioTunnelCommands: [
            'export CONTROL_PLANE_API_KEY="sk-..."',
            `tunnel-client init --sample sample_mcp_stdio_local --profile repo-devcontainer-stdio --tunnel-id ${profile.tunnelId} --mcp-command "node src/copilot/mcp/cli.js --transport stdio"`,
            'tunnel-client doctor --profile repo-devcontainer-stdio --explain',
            'tunnel-client run --profile repo-devcontainer-stdio',
        ],
        chatgptUrl: profile.connectorUrl,
        notes: [
            'Preferir Secure MCP Tunnel quando a prioridade for não expor o Dev Container diretamente à internet.',
            'Usar HTTP local quando quiser inspecionar /health, /.well-known/* e /mcp manualmente.',
            'Usar stdio quando quiser evitar qualquer listener local persistente.',
            'Manter tunnel-client rodando durante criação e uso do conector.',
            'Mesmo em Secure MCP Tunnel, mantenha OAuth/resource-server checks ativos para tools sensíveis.',
        ],
    };
}

/**
 * @param {ConnectorProfileOptions & { originUrl?: string }} [options]
 * @param {import('./config.js').McpConnectionConfig} [config]
 * @returns {{
 *     prerequisites: string[];
 *     originUrl: string;
 *     http2Plus: Http2PlusProfile;
 *     quickTunnelCommands: string[];
 *     managedTunnelCommands: string[];
 *     http2OriginCommands: string[];
 *     chatgptUrl: string;
 *     notes: string[];
 * }}
 */
export function buildCloudflareTunnelRunbook(options = {}, config = readMcpConnectionConfig()) {
    const profile = buildChatGptConnectorProfile(options, config);
    const http2Plus = buildHttp2PlusProfile(
        { publicMcpUrl: profile.connectorUrl, localMcpUrl: profile.localMcpUrl },
        config,
    );
    const originUrl = normalizeOriginUrl(options.originUrl ?? config.profile.cloudflareOriginUrl, http2Plus.originUrl);
    return {
        prerequisites: [
            'cloudflared instalado no mesmo ambiente que alcança o MCP HTTP local.',
            `MCP HTTP saudável no origin ${originUrl}.`,
            'Tunnel remoto Cloudflare criado como workspace-mcp-dev.',
            'Hostname público permanente configurado como mcp.aurelin.org.',
            'Rota pública publicada para o origin local sem /mcp no serviço de origem.',
            'ChatGPT developer mode habilitado para criar conector customizado.',
            'HTTP/2+ decidido como postura padrão; antes de ligar origin HTTPS/H2, audite e sincronize a regra remota Cloudflare.',
        ],
        originUrl,
        http2Plus,
        quickTunnelCommands: [
            'npm run copilot:mcp:http',
            'npm run copilot:mcp:cloudflare:doctor',
            'npm run copilot:mcp:cloudflare:quick',
            'npm run copilot:mcp:cloudflare:status',
            'npm run copilot:mcp:cloudflare:remote-audit',
            'npm run copilot:mcp:cloudflare:smoke',
            'npm run copilot:mcp:cloudflare:status',
        ],
        managedTunnelCommands: [
            'npm run copilot:mcp:cloudflare:doctor',
            'export CLOUDFLARE_TUNNEL_TOKEN_FILE="src/copilot/.ai/cloudflare/workspace-mcp-dev.token"',
            'export COPILOT_MCP_CLOUDFLARE_PROTOCOL="http2"',
            'export TUNNEL_TRANSPORT_PROTOCOL="http2"',
            'npm run copilot:mcp:cloudflare:up',
            'npm run copilot:mcp:cloudflare:status',
            'npm run copilot:mcp:cloudflare:remote-audit',
            'npm run copilot:mcp:cloudflare:smoke',
        ],
        http2OriginCommands: [
            'npm run copilot:mcp:cloudflare:h2-origin-apply:dry-run',
            'npm run copilot:mcp:cloudflare:h2-origin-apply',
            'npm run copilot:mcp:cloudflare:h2-remote-audit',
            'export COPILOT_MCP_ORIGIN_TRANSPORT="http2"',
            'export COPILOT_MCP_CLOUDFLARE_HTTP2_ORIGIN="true"',
            'npm run copilot:mcp:h2:restart',
            'npm run copilot:mcp:cloudflare:smoke',
        ],
        chatgptUrl: profile.connectorUrl,
        notes: [
            'O modo principal deste projeto usa domínio permanente Cloudflare.',
            `URL do conector no ChatGPT: ${profile.connectorUrl}.`,
            `A rota Cloudflare deve apontar para o origin raiz ${originUrl}; nunca configure o serviço de origem como /mcp.`,
            'Audite drift remoto com npm run copilot:mcp:cloudflare:remote-audit depois de qualquer alteração no dashboard.',
            'Depois do smoke, o endpoint permanente deve responder /health e /mcp tools/list.',
            'Quick Tunnel continua disponível como fallback, mas não é o caminho padrão.',
            'Não proteja /mcp com login interativo que o backend do ChatGPT não consiga atravessar.',
            'OAuth é o modo padrão do MCP permanente. Use No authentication apenas com COPILOT_MCP_AUTH_MODE=none-dev em desenvolvimento controlado.',
            'Quando HTTP/2 origin estiver ativo, o origin local deve usar HTTPS/H2 e a regra remota Cloudflare deve apontar para o mesmo esquema.',
        ],
    };
}

/**
 * @param {{ publicMcpUrl?: string; localMcpUrl?: string }} [options]
 * @param {import('./config.js').McpConnectionConfig} [config]
 * @returns {Http2PlusProfile}
 */
export function buildHttp2PlusProfile(options = {}, config = readMcpConnectionConfig()) {
    const originTransport = config.profile.originTransport;
    const cloudflareTunnelTransport = config.profile.cloudflareTunnelTransport;
    const cloudflareHttp2OriginRequested = config.profile.cloudflareHttp2OriginRequested;
    const publicMcpUrl = normalizeMcpUrl(options.publicMcpUrl ?? config.profile.publicMcpUrl);
    const defaultOriginUrl =
        originTransport === 'http2' || cloudflareHttp2OriginRequested
            ? DEFAULT_LOCAL_HTTP2_ORIGIN_URL
            : DEFAULT_LOCAL_HTTP_ORIGIN_URL;
    const originUrl = normalizeOriginUrl(config.profile.cloudflareOriginUrl, defaultOriginUrl);
    const localMcpUrl = normalizeMcpUrl(options.localMcpUrl ?? config.profile.localMcpUrl);
    return {
        defaultPolicy: 'HTTP/2+',
        originTransport,
        cloudflareTunnelTransport,
        cloudflareHttp2OriginRequested,
        originUrl,
        localMcpUrl,
        publicMcpUrl,
        requiredEnvironment: [
            'COPILOT_MCP_AUTH_MODE=oauth',
            'COPILOT_MCP_AUTH_ENFORCEMENT=all',
            `COPILOT_MCP_PUBLIC_URL=${publicMcpUrl}`,
            `COPILOT_MCP_CLOUDFLARE_PUBLIC_URL=${publicMcpUrl}`,
            'COPILOT_MCP_CLOUDFLARE_MODE=named-permanent',
            'COPILOT_MCP_CLOUDFLARE_PROTOCOL=http2',
            'TUNNEL_TRANSPORT_PROTOCOL=http2',
            'COPILOT_MCP_ORIGIN_TRANSPORT=http2',
            'COPILOT_MCP_CLOUDFLARE_HTTP2_ORIGIN=true',
        ],
        readinessChecks: [
            'mcp_connection_readiness retorna ready=true.',
            'mcp_auth_profile mostra Protected Resource Metadata, issuer, JWKS e audiences configurados.',
            'mcp_oauth_issuer_diagnostics encontra metadata OAuth com PKCE S256, resource parameter e CIMD/DCR quando aplicável.',
            'mcp_cloudflare_remote_audit confirma que o serviço remoto corresponde ao esquema do origin local.',
            'mcp_cloudflare_metrics_snapshot não mostra instabilidade no tunnel.',
            'make copilot-mcp-smoke e make copilot-mcp-oauth-smoke passam antes de reconectar o cliente.',
        ],
        notes: [
            'HTTP/2+ significa preferir HTTP/2 no transporte Cloudflare e, quando habilitado com segurança, HTTP/2 até o origin.',
            'Não misture origin HTTPS/H2 local com regra remota Cloudflare ainda apontando para http://127.0.0.1:3333.',
            'Se o certificado de origin ou serverName ainda não estiver pronto, mantenha o origin HTTP e trate HTTP/2 origin como etapa de rollout controlada.',
        ],
    };
}

/**
 * @param {import('#copilot/mcp/public/auth').McpAuthConfig} config
 * @returns {ConnectorAuthReadiness}
 */
function buildConnectorAuthReadiness(config) {
    const warnings = [];
    if ((config.mode === 'oauth' || config.mode === 'mixed-auth') && config.authorizationServers.length === 0) {
        warnings.push('authorization_servers is empty.');
    }
    if ((config.mode === 'oauth' || config.mode === 'mixed-auth') && !config.expectedIssuer) {
        warnings.push('expected OAuth issuer is not configured.');
    }
    if ((config.mode === 'oauth' || config.mode === 'mixed-auth') && !config.jwksUri) {
        warnings.push('JWKS URI is not configured.');
    }
    if (config.staticBearerConfigured) {
        warnings.push(
            'static bearer fallback is configured; keep it disabled for the public permanent endpoint unless explicitly testing.',
        );
    }
    return {
        mode: config.mode,
        protectedResourceMetadataUrl: config.protectedResourceMetadataUrl,
        protectedResourceMetadataUrls: buildProtectedResourceMetadataUrls(config),
        authorizationServersConfigured: config.authorizationServers.length > 0,
        authorizationServers: [...config.authorizationServers],
        scopesSupported: [...config.scopesSupported],
        initialScopes: [...config.initialScopes],
        enforcement: config.enforcement,
        expectedIssuerConfigured: Boolean(config.expectedIssuer),
        expectedIssuer: config.expectedIssuer || null,
        expectedAudience: config.expectedAudience || null,
        acceptedAudiences: [...config.acceptedAudiences],
        jwksUriConfigured: Boolean(config.jwksUri),
        staticBearerConfigured: config.staticBearerConfigured,
        oauthRequired: config.mode === 'oauth' && config.enforcement !== 'off',
        warnings,
    };
}

/**
 * @param {import('#copilot/mcp/public/auth').McpAuthConfig} config
 * @returns {string[]}
 */
function buildProtectedResourceMetadataUrls(config) {
    return uniqueStrings([
        `${config.resource}/.well-known/oauth-protected-resource/mcp`,
        config.protectedResourceMetadataUrl,
    ]);
}

/**
 * @param {string} connectorUrl
 * @param {string} localMcpUrl
 * @param {import('#copilot/mcp/public/auth').McpAuthConfig} config
 * @returns {Record<string, Record<string, string>>}
 */
function buildProfileEnvironmentTemplates(connectorUrl, localMcpUrl, config) {
    const resource = buildResourceFromMcpUrl(connectorUrl);
    const originUrl = localMcpUrl.replace(/\/mcp$/u, '');
    return {
        permanentCloudflareOAuthHttp2Plus: {
            COPILOT_MCP_AUTH_MODE: 'oauth',
            COPILOT_MCP_AUTH_ENFORCEMENT: 'all',
            COPILOT_MCP_PUBLIC_URL: connectorUrl,
            COPILOT_MCP_CLOUDFLARE_PUBLIC_URL: connectorUrl,
            COPILOT_MCP_CLOUDFLARE_MODE: 'named-permanent',
            COPILOT_MCP_CLOUDFLARE_PROTOCOL: 'http2',
            TUNNEL_TRANSPORT_PROTOCOL: 'http2',
            COPILOT_MCP_ORIGIN_TRANSPORT: 'http2',
            COPILOT_MCP_CLOUDFLARE_HTTP2_ORIGIN: 'true',
            COPILOT_MCP_CLOUDFLARE_ORIGIN_URL: DEFAULT_LOCAL_HTTP2_ORIGIN_URL,
            COPILOT_MCP_OAUTH_ISSUER: resource,
            COPILOT_MCP_OAUTH_EXPECTED_ISSUER: resource,
            COPILOT_MCP_OAUTH_AUDIENCE: resource,
            COPILOT_MCP_OAUTH_ACCEPTED_AUDIENCES: `${resource},${resource}/mcp`,
            COPILOT_MCP_OAUTH_JWKS_URI: `${resource}/oauth/jwks.json`,
            COPILOT_MCP_OAUTH_REQUIRE_RESOURCE_CLAIM: 'true',
            COPILOT_MCP_DEV_OAUTH_ENABLED: 'true',
            COPILOT_MCP_DEV_OAUTH_ACCESS_TOKEN_TTL_SECONDS: '3600',
            COPILOT_MCP_DEV_OAUTH_REFRESH_TOKEN_TTL_SECONDS: '2592000',
            COPILOT_MCP_PUBLIC_OAUTH_DIAGNOSTICS: 'true',
            COPILOT_MCP_STATIC_BEARER_TOKEN_ENABLED: 'false',
        },
        permanentCloudflareOAuthHttpOriginFallback: {
            COPILOT_MCP_AUTH_MODE: 'oauth',
            COPILOT_MCP_AUTH_ENFORCEMENT: 'all',
            COPILOT_MCP_PUBLIC_URL: connectorUrl,
            COPILOT_MCP_CLOUDFLARE_PUBLIC_URL: connectorUrl,
            COPILOT_MCP_CLOUDFLARE_MODE: 'named-permanent',
            COPILOT_MCP_CLOUDFLARE_PROTOCOL: 'http2',
            TUNNEL_TRANSPORT_PROTOCOL: 'http2',
            COPILOT_MCP_ORIGIN_TRANSPORT: 'http',
            COPILOT_MCP_CLOUDFLARE_HTTP2_ORIGIN: 'false',
            COPILOT_MCP_CLOUDFLARE_ORIGIN_URL: DEFAULT_LOCAL_HTTP_ORIGIN_URL,
            COPILOT_MCP_OAUTH_ISSUER: resource,
            COPILOT_MCP_OAUTH_EXPECTED_ISSUER: resource,
            COPILOT_MCP_OAUTH_AUDIENCE: resource,
            COPILOT_MCP_OAUTH_JWKS_URI: `${resource}/oauth/jwks.json`,
            COPILOT_MCP_DEV_OAUTH_ENABLED: 'true',
        },
        permanentTunnelNoAuthFallback: {
            COPILOT_MCP_AUTH_MODE: 'none-dev',
            COPILOT_MCP_AUTH_ENFORCEMENT: 'off',
            COPILOT_MCP_PUBLIC_URL: connectorUrl,
            COPILOT_MCP_CLOUDFLARE_PUBLIC_URL: connectorUrl,
            COPILOT_MCP_CLOUDFLARE_MODE: 'named-permanent',
            COPILOT_MCP_CLOUDFLARE_PROTOCOL: 'http2',
            TUNNEL_TRANSPORT_PROTOCOL: 'http2',
        },
        temporaryQuickTunnelNoAuth: {
            COPILOT_MCP_AUTH_MODE: 'none-dev',
            COPILOT_MCP_AUTH_ENFORCEMENT: 'off',
            COPILOT_MCP_PUBLIC_URL: 'https://<trycloudflare-host>/mcp',
            COPILOT_MCP_CLOUDFLARE_MODE: 'temporary-quick',
            COPILOT_MCP_CLOUDFLARE_PROTOCOL: 'http2',
            TUNNEL_TRANSPORT_PROTOCOL: 'http2',
        },
        externalOauthJwks: {
            COPILOT_MCP_AUTH_MODE: 'oauth',
            COPILOT_MCP_AUTH_ENFORCEMENT: 'all',
            COPILOT_MCP_PUBLIC_URL: connectorUrl,
            COPILOT_MCP_CLOUDFLARE_ORIGIN_URL: originUrl,
            COPILOT_MCP_OAUTH_ISSUER: 'https://<issuer>',
            COPILOT_MCP_OAUTH_EXPECTED_ISSUER: 'https://<issuer>',
            COPILOT_MCP_OAUTH_AUDIENCE: config.expectedAudience || resource,
            COPILOT_MCP_OAUTH_ACCEPTED_AUDIENCES: `${resource},${resource}/mcp`,
            COPILOT_MCP_OAUTH_JWKS_URI: 'https://<issuer>/.well-known/jwks.json',
            COPILOT_MCP_OAUTH_REQUIRE_RESOURCE_CLAIM: 'true',
        },
    };
}

/**
 * @returns {string[]}
 */
function buildChatGptSmokePrompts() {
    return [
        'Use o conector Repo DevContainer MCP e chame repo_status.',
        'Chame mcp_connection_readiness e confirme ready=true ou liste blockers.',
        'Chame mcp_auth_profile e confirme protectedResourceMetadataUrl, acceptedAudiences e challengePreview.',
        'Chame mcp_oauth_issuer_diagnostics e confirme PKCE S256, resource parameter, CIMD/DCR e JWKS.',
        'Chame mcp_session_profile e siga a ordem recommendedFirstCalls.',
        'Chame mcp_capabilities_summary e resuma as categorias de tools.',
        'Chame mcp_tools_status e identifique tools read-only, bounded-write e destructive.',
        'Antes de qualquer escrita, chame repo_patch_plan, repo_create_file_plan, repo_quarantine_file_plan ou repo_move_file_plan.',
        'Chame chatgpt_connector_current_url_status para recuperar a URL pública atual sem passar URL como argumento.',
        'Chame mcp_tunnel_status e confirme recommendedAction, lastSmokeOk e lastSmokeAgeMinutes.',
        'Chame mcp_cloudflare_remote_audit e confirme que a rota remota está sincronizada com o origin.',
        'Chame mcp_cloudflare_metrics_snapshot e procure sinais de instabilidade do tunnel.',
        'Liste a árvore de src/copilot/mcp com repo_tree.',
        'Leia src/copilot/mcp/registry/runtime.js linhas 1 a 120 com repo_read_file e informe o sha256.',
        'Faça repo_symbol_search name=registerCanonicalMcpTools path=src/copilot/mcp.',
        'Chame project_doctor.',
        'Consulte mcp_validation_plan sem suite: o default deve ser inspect-first/no-validator; forneça testFile explícito somente quando um teste focado agregar evidência.',
        'Inicie delegate_to_repo_autonomy_runner mission=diagnose-mcp dryRun=true.',
        'Chame mcp_runtime_health e mcp_tunnel_status.',
    ];
}

/**
 * @returns {string[]}
 */
function buildClaudeSmokePrompts() {
    return [
        'Use o conector Repo DevContainer MCP e chame repo_status.',
        'Chame mcp_session_profile e resuma recommendedFirstCalls.',
        'Chame mcp_connection_readiness e confirme que blockers está vazio.',
        'Chame mcp_cloudflare_remote_audit e confirme que o origin remoto corresponde ao transport selecionado.',
        'Chame mcp_oauth_friction_audit e confirme refresh token persistence.',
        'Chame repo_tree path="src/copilot/mcp" maxDepth=2.',
        'Chame mcp_validation_plan sem suite antes de validar; prefira um testFile explícito e escale para suite ampla apenas com justificativa transversal.',
    ];
}

/**
 * @param {string | undefined} value
 * @param {string} fallback
 * @returns {string}
 */
function normalizeOriginUrl(value, fallback) {
    const raw = String(value ?? fallback)
        .trim()
        .replace(/\/+$/u, '');
    if (!raw || raw.length > MAX_URL_LENGTH || hasAsciiControlChars(raw)) return fallback;
    try {
        const parsed = new URL(raw);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return fallback;
        if (parsed.username || parsed.password || parsed.search || parsed.hash) return fallback;
        parsed.pathname = parsed.pathname.replace(/\/mcp$/u, '').replace(/\/+$/u, '');
        return parsed.toString().replace(/\/+$/u, '');
    } catch {
        return fallback;
    }
}

/**
 * @param {string[]} values
 * @returns {string[]}
 */
function uniqueStrings(values) {
    const output = [];
    const seen = new Set();
    for (const value of values) {
        const normalized = String(value ?? '').trim();
        if (!normalized || seen.has(normalized)) continue;
        seen.add(normalized);
        output.push(normalized);
    }
    return output;
}
