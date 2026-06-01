// @ts-check
/**
 * ChatGPT / Claude connector profile and tunnel runbook helpers.
 *
 * This module is intentionally side-effect free. It builds canonical form values, URL validation results, OAuth
 * readiness summaries and Cloudflare/HTTP/2+ runbooks used by read-only MCP connection tools.
 *
 * @module copilot/mcp/connection/profile
 */

import { readMcpAuthConfig } from '../control-plane/auth.js';

const DEFAULT_LOCAL_HTTP_ORIGIN_URL = 'http://127.0.0.1:3333';
const DEFAULT_LOCAL_HTTP2_ORIGIN_URL = 'https://127.0.0.1:3333';
const DEFAULT_LOCAL_MCP_URL = `${DEFAULT_LOCAL_HTTP_ORIGIN_URL}/mcp`;
const DEFAULT_PUBLIC_MCP_URL = 'https://mcp.aurelin.org/mcp';
const DEFAULT_CLOUDFLARE_ORIGIN_URL = DEFAULT_LOCAL_HTTP_ORIGIN_URL;
const DEFAULT_CLOUDFLARE_HTTP2_ORIGIN_URL = DEFAULT_LOCAL_HTTP2_ORIGIN_URL;
const DEFAULT_TUNNEL_ID_PLACEHOLDER = 'tunnel_<preencher>';
const MAX_URL_LENGTH = 2048;
const MAX_HOSTNAME_LENGTH = 253;
const MAX_PATH_LENGTH = 256;
const MCP_PATH = '/mcp';

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
export function formatChatGptConnectorAuthentication(authConfig = readMcpAuthConfig()) {
    if (authConfig.mode === 'oauth') return 'OAuth';
    if (authConfig.mode === 'mixed-auth') return 'Mixed Authentication';
    if (authConfig.mode === 'secure-mcp-tunnel') return 'Secure MCP Tunnel';
    return 'No authentication';
}

/**
 * @param {ConnectorProfileOptions} [options]
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
export function buildClaudeConnectorProfile(options = {}) {
    const publicMcpUrl = readPublicMcpUrl(options.publicMcpUrl);
    const connectorUrl = normalizeMcpUrl(publicMcpUrl);
    const authConfig = readMcpAuthConfig();
    const http2Plus = buildHttp2PlusProfile({
        publicMcpUrl: connectorUrl,
        ...(options.localMcpUrl === undefined ? {} : { localMcpUrl: options.localMcpUrl }),
    });
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
 * @returns {ConnectorProfile}
 */
export function buildChatGptConnectorProfile(options = {}) {
    const publicMcpUrl = readPublicMcpUrl(options.publicMcpUrl);
    const localMcpUrl = readLocalMcpUrl(options.localMcpUrl);
    const authMode = normalizeAuthMode(
        options.authMode ?? /** @type {ChatGptAuthMode} */ (process.env['COPILOT_MCP_CHATGPT_AUTH_MODE'] ?? 'oauth'),
    );
    const tunnelId = normalizeTunnelId(options.tunnelId ?? process.env['OPENAI_MCP_TUNNEL_ID']);
    const connectorUrl = normalizeMcpUrl(publicMcpUrl);
    const localUrl = normalizeMcpUrl(localMcpUrl);
    const authConfig = { ...readMcpAuthConfig(), mode: authMode };
    const authentication = formatChatGptConnectorAuthentication(authConfig);
    const http2Plus = buildHttp2PlusProfile({ publicMcpUrl: connectorUrl, localMcpUrl: localUrl });
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
 * @returns {{
 *     prerequisites: string[];
 *     httpTunnelCommands: string[];
 *     stdioTunnelCommands: string[];
 *     chatgptUrl: string;
 *     notes: string[];
 * }}
 */
export function buildSecureTunnelRunbook(options = {}) {
    const profile = buildChatGptConnectorProfile(options);
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
            `tunnel-client init --sample sample_mcp_stdio_local --profile repo-devcontainer-stdio --tunnel-id ${profile.tunnelId} --mcp-command "node src/copilot/mcp/index.js --transport stdio"`,
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
export function buildCloudflareTunnelRunbook(options = {}) {
    const profile = buildChatGptConnectorProfile(options);
    const http2Plus = buildHttp2PlusProfile({ publicMcpUrl: profile.connectorUrl, localMcpUrl: profile.localMcpUrl });
    const originUrl = normalizeOriginUrl(
        options.originUrl ?? process.env['COPILOT_MCP_CLOUDFLARE_ORIGIN_URL'],
        http2Plus.originUrl,
    );
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
 * Normalize a candidate MCP URL into an absolute URL ending in /mcp. This helper is intentionally forgiving because it
 * is used for form helpers; use validatePublicConnectorUrl for strict public connector checks.
 *
 * @param {string} url
 * @returns {string}
 */
export function normalizeMcpUrl(url) {
    const trimmed = String(url || '').trim();
    if (!trimmed || trimmed.length > MAX_URL_LENGTH || hasAsciiControlChars(trimmed)) return DEFAULT_PUBLIC_MCP_URL;
    try {
        const parsed = new URL(trimmed);
        if (parsed.username || parsed.password) return DEFAULT_PUBLIC_MCP_URL;
        parsed.hash = '';
        parsed.search = '';
        parsed.pathname = normalizeMcpPath(parsed.pathname);
        return parsed
            .toString()
            .replace(/\/+$/u, '')
            .replace(/\/mcp$/u, MCP_PATH);
    } catch {
        const withoutTrailingSlash = trimmed.replace(/\/+$/u, '');
        return `${withoutTrailingSlash}${withoutTrailingSlash.endsWith(MCP_PATH) ? '' : MCP_PATH}`;
    }
}

/**
 * @param {string} url
 * @returns {{ ok: true; normalizedUrl: string; resource: string }
 *     | { ok: false; reason: string; normalizedUrl: string }}
 */
export function validatePublicConnectorUrl(url) {
    const normalized = normalizeMcpUrl(url);
    if (normalized.length > MAX_URL_LENGTH)
        return { ok: false, reason: 'Connector URL is too long.', normalizedUrl: normalized };
    let parsed;
    try {
        parsed = new URL(normalized);
    } catch {
        return { ok: false, reason: 'Connector URL must be an absolute URL.', normalizedUrl: normalized };
    }
    if (parsed.protocol !== 'https:') {
        return { ok: false, reason: 'ChatGPT connector URL must be HTTPS.', normalizedUrl: normalized };
    }
    if (parsed.username || parsed.password) {
        return { ok: false, reason: 'Connector URL must not contain credentials.', normalizedUrl: normalized };
    }
    if (parsed.search || parsed.hash) {
        return {
            ok: false,
            reason: 'Connector URL must not contain query string or fragment.',
            normalizedUrl: normalized,
        };
    }
    if (!isValidHostname(parsed.hostname)) {
        return { ok: false, reason: 'Connector URL hostname is invalid.', normalizedUrl: normalized };
    }
    if (isLocalHostname(parsed.hostname)) {
        return {
            ok: false,
            reason: 'Public ChatGPT connector URL must not use localhost or loopback.',
            normalizedUrl: normalized,
        };
    }
    if (parsed.pathname !== MCP_PATH) {
        return { ok: false, reason: 'ChatGPT connector URL must end exactly with /mcp.', normalizedUrl: normalized };
    }
    return { ok: true, normalizedUrl: normalized, resource: buildResourceFromMcpUrl(normalized) };
}

/**
 * @param {{ publicMcpUrl?: string; localMcpUrl?: string }} [options]
 * @returns {Http2PlusProfile}
 */
export function buildHttp2PlusProfile(options = {}) {
    const originTransport = resolveOriginTransport();
    const cloudflareTunnelTransport = resolveCloudflareTunnelTransport();
    const cloudflareHttp2OriginRequested = readBooleanEnv(process.env['COPILOT_MCP_CLOUDFLARE_HTTP2_ORIGIN'], false);
    const publicMcpUrl = normalizeMcpUrl(options.publicMcpUrl ?? readPublicMcpUrl());
    const defaultOriginUrl =
        originTransport === 'http2' || cloudflareHttp2OriginRequested
            ? DEFAULT_CLOUDFLARE_HTTP2_ORIGIN_URL
            : DEFAULT_CLOUDFLARE_ORIGIN_URL;
    const originUrl = normalizeOriginUrl(process.env['COPILOT_MCP_CLOUDFLARE_ORIGIN_URL'], defaultOriginUrl);
    const localMcpUrl = normalizeMcpUrl(
        options.localMcpUrl ?? process.env['COPILOT_MCP_LOCAL_URL'] ?? `${originUrl}${MCP_PATH}`,
    );
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
 * @param {ReturnType<typeof readMcpAuthConfig>} config
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
 * @param {ReturnType<typeof readMcpAuthConfig>} config
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
 * @param {ReturnType<typeof readMcpAuthConfig>} config
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
            COPILOT_MCP_CLOUDFLARE_ORIGIN_URL: DEFAULT_CLOUDFLARE_HTTP2_ORIGIN_URL,
            COPILOT_MCP_OAUTH_ISSUER: resource,
            COPILOT_MCP_OAUTH_EXPECTED_ISSUER: resource,
            COPILOT_MCP_OAUTH_AUDIENCE: resource,
            COPILOT_MCP_OAUTH_ACCEPTED_AUDIENCES: `${resource},${resource}/mcp`,
            COPILOT_MCP_OAUTH_JWKS_URI: `${resource}/oauth/jwks.json`,
            COPILOT_MCP_OAUTH_REQUIRE_RESOURCE_CLAIM: 'true',
            COPILOT_MCP_DEV_OAUTH_ENABLED: 'true',
            COPILOT_MCP_DEV_OAUTH_ACCESS_TOKEN_TTL_SECONDS: '3600',
            COPILOT_MCP_DEV_OAUTH_REFRESH_TOKEN_TTL_SECONDS: '2592000',
            COPILOT_MCP_PUBLIC_OAUTH_DIAGNOSTICS: 'false',
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
            COPILOT_MCP_CLOUDFLARE_ORIGIN_URL: DEFAULT_CLOUDFLARE_ORIGIN_URL,
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
        'Leia src/copilot/mcp/registry.js linhas 1 a 120 com repo_read_file e informe o sha256.',
        'Faça repo_symbol_search name=registerCanonicalMcpTools path=src/copilot/mcp.',
        'Chame project_doctor.',
        'Consulte mcp_validation_plan suite=mcp-full antes de iniciar validadores.',
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
        'Chame mcp_validation_plan suite="mcp-full" antes de qualquer validação longa.',
    ];
}

/**
 * @param {string | undefined} value
 * @returns {string}
 */
function readPublicMcpUrl(
    value = process.env['COPILOT_MCP_PUBLIC_URL'] ?? process.env['COPILOT_MCP_CLOUDFLARE_PUBLIC_URL'],
) {
    return normalizeMcpUrl(value ?? DEFAULT_PUBLIC_MCP_URL);
}

/**
 * @param {string | undefined} value
 * @returns {string}
 */
function readLocalMcpUrl(value = process.env['COPILOT_MCP_LOCAL_URL']) {
    const originTransport = resolveOriginTransport();
    const fallback =
        originTransport === 'http2' ? `${DEFAULT_LOCAL_HTTP2_ORIGIN_URL}${MCP_PATH}` : DEFAULT_LOCAL_MCP_URL;
    return normalizeMcpUrl(value ?? fallback);
}

/**
 * @returns {'http' | 'http2'}
 */
function resolveOriginTransport() {
    const explicit = String(process.env['COPILOT_MCP_ORIGIN_TRANSPORT'] ?? '')
        .trim()
        .toLowerCase();
    if (explicit === 'http' || explicit === 'http2') return explicit;
    if (readBooleanEnv(process.env['COPILOT_MCP_CLOUDFLARE_HTTP2_ORIGIN'], false)) return 'http2';
    const originUrl = String(process.env['COPILOT_MCP_CLOUDFLARE_ORIGIN_URL'] ?? '')
        .trim()
        .toLowerCase();
    return originUrl.startsWith('https://') ? 'http2' : 'http';
}

/**
 * @returns {'auto' | 'http2' | 'quic'}
 */
function resolveCloudflareTunnelTransport() {
    const raw = String(
        process.env['COPILOT_MCP_CLOUDFLARE_PROTOCOL'] ?? process.env['TUNNEL_TRANSPORT_PROTOCOL'] ?? 'http2',
    )
        .trim()
        .toLowerCase();
    if (raw === 'auto' || raw === 'http2' || raw === 'quic') return raw;
    return 'http2';
}

/**
 * @param {string | undefined} value
 * @returns {ChatGptAuthMode}
 */
function normalizeAuthMode(value) {
    const raw = String(value ?? 'oauth')
        .trim()
        .toLowerCase();
    if (raw === 'oauth' || raw === 'team-oauth') return 'oauth';
    if (raw === 'mixed' || raw === 'mixed-auth' || raw === 'dev-mixed-auth') return 'mixed-auth';
    if (raw === 'secure-mcp-tunnel') return 'secure-mcp-tunnel';
    if (raw === 'none' || raw === 'noauth' || raw === 'none-dev' || raw === 'dev-noauth') return 'none-dev';
    return 'oauth';
}

/**
 * @param {string | undefined} value
 * @returns {string}
 */
function normalizeTunnelId(value) {
    const trimmed = String(value ?? '').trim();
    if (!trimmed || hasAsciiControlChars(trimmed) || trimmed.length > 160) return DEFAULT_TUNNEL_ID_PLACEHOLDER;
    return trimmed;
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
 * @param {string} pathname
 * @returns {string}
 */
function normalizeMcpPath(pathname) {
    const normalized = String(pathname || '/').replace(/\/+$/u, '');
    if (!normalized || normalized === '/') return MCP_PATH;
    if (normalized === MCP_PATH || normalized.endsWith(MCP_PATH)) return normalized;
    const next = `${normalized}${MCP_PATH}`;
    return next.length <= MAX_PATH_LENGTH ? next : MCP_PATH;
}

/**
 * @param {string} mcpUrl
 * @returns {string}
 */
function buildResourceFromMcpUrl(mcpUrl) {
    try {
        const parsed = new URL(normalizeMcpUrl(mcpUrl));
        parsed.pathname = parsed.pathname.replace(/\/mcp$/u, '').replace(/\/+$/u, '');
        parsed.search = '';
        parsed.hash = '';
        return parsed.toString().replace(/\/+$/u, '');
    } catch {
        return DEFAULT_PUBLIC_MCP_URL.replace(/\/mcp$/u, '');
    }
}

/**
 * @param {string | undefined} value
 * @param {boolean} fallback
 * @returns {boolean}
 */
function readBooleanEnv(value, fallback) {
    const raw = String(value ?? '')
        .trim()
        .toLowerCase();
    if (!raw) return fallback;
    if (raw === 'true' || raw === '1' || raw === 'yes' || raw === 'on') return true;
    if (raw === 'false' || raw === '0' || raw === 'no' || raw === 'off') return false;
    return fallback;
}

/**
 * @param {string} hostname
 * @returns {boolean}
 */
function isValidHostname(hostname) {
    const normalized = hostname.toLowerCase().replace(/\.+$/u, '');
    if (!normalized || normalized.length > MAX_HOSTNAME_LENGTH || normalized.includes('_')) return false;
    if (normalized === 'localhost' || normalized === '::1' || normalized === '[::1]') return true;
    if (/^\d{1,3}(?:\.\d{1,3}){3}$/u.test(normalized)) return true;
    return normalized.split('.').every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(label));
}

/**
 * @param {string} hostname
 * @returns {boolean}
 */
function isLocalHostname(hostname) {
    const normalized = hostname.toLowerCase().replace(/\.+$/u, '');
    return (
        normalized === 'localhost' ||
        normalized === '127.0.0.1' ||
        normalized === '::1' ||
        normalized === '[::1]' ||
        normalized.endsWith('.localhost')
    );
}

/**
 * @param {string} value
 * @returns {boolean}
 */
function hasAsciiControlChars(value) {
    for (let index = 0; index < value.length; index += 1) {
        const code = value.charCodeAt(index);
        if (code <= 31 || code === 127) return true;
    }
    return false;
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
