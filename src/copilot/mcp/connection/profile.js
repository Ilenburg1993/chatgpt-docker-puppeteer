// @ts-check
/**
 * ChatGPT connector profile and tunnel runbook helpers.
 *
 * @module copilot/mcp/connection/profile
 */

import { readMcpAuthConfig } from '../control-plane/auth.js';

const DEFAULT_LOCAL_MCP_URL = 'http://127.0.0.1:3333/mcp';
const DEFAULT_PUBLIC_MCP_URL = 'https://mcp.aurelin.org/mcp';
const DEFAULT_CLOUDFLARE_ORIGIN_URL = 'http://127.0.0.1:3333';

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
 * @typedef {object} ConnectorProfile
 * @property {string} name
 * @property {string} description
 * @property {string} connectorUrl
 * @property {ChatGptAuthMode} authMode
 * @property {{
 *     mode: string;
 *     protectedResourceMetadataUrl: string;
 *     authorizationServersConfigured: boolean;
 *     scopesSupported: string[];
 *     enforcement: string;
 *     expectedIssuerConfigured: boolean;
 *     jwksUriConfigured: boolean;
 * }} authReadiness
 * @property {string} localMcpUrl
 * @property {string} tunnelId
 * @property {{ name: string; description: string; mcpServerUrl: string; authentication: string }} chatgptFormFields
 * @property {string[]} chatgptFormSteps
 * @property {string[]} smokePrompts
 * @property {string[]} requiredLocalChecks
 * @property {string[]} remoteExposureOptions
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
 *         advancedClientFields: string;
 *     };
 *     setupSteps: string[];
 *     smokePrompts: string[];
 *     notes: string[];
 * }}
 */
export function buildClaudeConnectorProfile(options = {}) {
    const publicMcpUrl = options.publicMcpUrl ?? process.env['COPILOT_MCP_PUBLIC_URL'] ?? DEFAULT_PUBLIC_MCP_URL;
    const connectorUrl = normalizeMcpUrl(publicMcpUrl);
    const authConfig = readMcpAuthConfig();
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
            protectedResourceMetadataUrls: [
                `${authConfig.resource}/.well-known/oauth-protected-resource/mcp`,
                authConfig.protectedResourceMetadataUrl,
            ],
            authorizationServer: authConfig.resource,
            advancedClientFields:
                'Leave OAuth Client ID and OAuth Client Secret blank. The built-in dev issuer supports public Dynamic Client Registration and Client ID Metadata Documents.',
        },
        setupSteps: [
            'Abrir Claude > Customize > Connectors.',
            'Clicar em + e escolher Add custom connector.',
            `Nome: ${CLAUDE_CONNECTOR_NAME}`,
            `Remote MCP server URL: ${connectorUrl}`,
            'Configurações avançadas: deixar OAuth Client ID e OAuth Client Secret em branco.',
            'Adicionar, conectar e concluir o fluxo OAuth quando Claude solicitar.',
            'Habilitar o conector na conversa pelo menu + > Connectors.',
        ],
        smokePrompts: [
            'Use o conector Repo DevContainer MCP e chame repo_status.',
            'Chame mcp_session_profile e resuma recommendedFirstCalls.',
            'Chame mcp_cloudflare_remote_audit e confirme que o origin remoto é http://127.0.0.1:3333.',
            'Chame mcp_oauth_friction_audit e confirme refresh token persistence.',
            'Chame repo_tree path="src/copilot/mcp" maxDepth=2.',
            'Chame mcp_run_safe_validation_suite suite="mcp-full" e acompanhe mcp_validation_dashboard.',
        ],
        notes: [
            'Claude custom connectors conectam a partir da infraestrutura Anthropic, então o endpoint precisa continuar público em https://mcp.aurelin.org/mcp.',
            'O servidor publica metadata OAuth tanto no well-known raiz quanto no well-known path-specific /mcp para compatibilidade com clientes MCP que preferem a URI mais específica.',
            'Permissões e prompts adicionais do host Claude são controlados pela própria Claude; este MCP reduz atrito com annotations, OAuth persistente e tools granulares.',
            'A LLM-B local continua independente do MCP; ambas as superfícies devem compartilhar a engine de IO e navegação, não dependência runtime.',
        ],
    };
}

/**
 * @param {ConnectorProfileOptions} [options]
 * @returns {ConnectorProfile}
 */
export function buildChatGptConnectorProfile(options = {}) {
    const publicMcpUrl = options.publicMcpUrl ?? process.env['COPILOT_MCP_PUBLIC_URL'] ?? DEFAULT_PUBLIC_MCP_URL;
    const localMcpUrl = options.localMcpUrl ?? process.env['COPILOT_MCP_LOCAL_URL'] ?? DEFAULT_LOCAL_MCP_URL;
    const authMode =
        options.authMode ?? /** @type {ChatGptAuthMode} */ (process.env['COPILOT_MCP_CHATGPT_AUTH_MODE'] ?? 'oauth');
    const tunnelId = options.tunnelId ?? process.env['OPENAI_MCP_TUNNEL_ID'] ?? 'tunnel_<preencher>';
    const connectorUrl = normalizeMcpUrl(publicMcpUrl);
    const localUrl = normalizeMcpUrl(localMcpUrl);
    const authConfig = { ...readMcpAuthConfig(), mode: authMode };
    const authentication = formatChatGptConnectorAuthentication(authConfig);
    return {
        name: CHATGPT_CONNECTOR_NAME,
        description: CHATGPT_CONNECTOR_DESCRIPTION,
        connectorUrl,
        authMode,
        authReadiness: {
            mode: authConfig.mode,
            protectedResourceMetadataUrl: authConfig.protectedResourceMetadataUrl,
            authorizationServersConfigured: authConfig.authorizationServers.length > 0,
            scopesSupported: authConfig.scopesSupported,
            enforcement: authConfig.enforcement,
            expectedIssuerConfigured: Boolean(authConfig.expectedIssuer),
            jwksUriConfigured: Boolean(authConfig.jwksUri),
        },
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
            'Criar o conector e confirmar que a lista de tools aparece.',
        ],
        smokePrompts: [
            'Use o conector Repo DevContainer MCP e chame repo_status.',
            'Chame mcp_session_profile e siga a ordem recommendedFirstCalls.',
            'Chame mcp_golden_prompts antes de medir prompts de autorizacao no ChatGPT.',
            'Chame mcp_capabilities_summary e resuma as categorias de tools.',
            'Chame mcp_maintenance_plan e depois mcp_maintenance_apply_safe_fixes dryRun=true.',
            'Chame delegate_to_repo_autonomy_runner mission=diagnose-mcp dryRun=true.',
            'Chame mcp_tools_status e identifique tools read-only, bounded-write e destructive.',
            'Antes de qualquer escrita, chame repo_patch_plan, repo_create_file_plan, repo_quarantine_file_plan ou repo_move_file_plan.',
            'Chame chatgpt_connector_current_url_status para recuperar a URL pública atual sem passar URL como argumento.',
            'Chame mcp_tunnel_status e confirme recommendedAction, lastSmokeOk e lastSmokeAgeMinutes.',
            'Chame mcp_cloudflare_remote_audit e confirme que o Cloudflare remoto aponta mcp.aurelin.org para http://127.0.0.1:3333.',
            'Chame claude_connector_profile se também for conectar em claude.ai.',
            'Liste a árvore de src/copilot/mcp com repo_tree.',
            'Liste a raiz real do workspace com repo_root_tree maxEntries=80.',
            'Audite redaction da raiz com repo_root_redaction_status sem expor nomes hidden/protected.',
            'Busque registerCanonicalMcpTools em src/copilot/mcp com repo_search_text contextLines=2.',
            'Leia src/copilot/mcp/registry.js linhas 1 a 120 com repo_read_file e informe o sha256.',
            'Leia src/copilot/mcp/tools/repo-read.js com repo_read_file_chunks chunkLines=80.',
            'Faça repo_symbol_search name=registerCanonicalMcpTools path=src/copilot/mcp.',
            'Faça repo_file_outline path=src/copilot/mcp/tools/repo-read.js includeTopComments=true.',
            'Chame project_doctor.',
            'Consulte mcp_validation_dashboard antes de iniciar novos validadores.',
            'Inicie mcp_run_safe_validation_suite suite=mcp-full e depois consulte mcp_validation_dashboard e job_get_summary; use job_get_output tailBytes pequeno só se falhar.',
            'Inicie run_copilot_validator validator=typecheck e depois consulte job_get_summary; use job_get_output tailBytes pequeno só se falhar.',
            'Chame mcp_runtime_health e mcp_tunnel_status.',
        ],
        requiredLocalChecks: [
            `MCP local responde em ${normalizeMcpUrl(localMcpUrl)}.`,
            'tools/list retorna as tools esperadas.',
            'repo_status funciona localmente antes de testar no ChatGPT.',
            'O tunnel ativo alcança o origin local e preserva o path público /mcp.',
        ],
        remoteExposureOptions: [
            'Cloudflare Tunnel permanente: modo operacional principal, com hostname mcp.aurelin.org.',
            'Cloudflare Quick Tunnel temporário: fallback explícito via COPILOT_MCP_CLOUDFLARE_MODE=temporary-quick.',
            'OpenAI Secure MCP Tunnel: alternativa privada baseada em tunnel-client.',
        ],
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
            'Preferir Secure MCP Tunnel para não expor o Dev Container diretamente à internet.',
            'Usar HTTP local quando quiser inspecionar /health e /mcp manualmente.',
            'Usar stdio quando quiser evitar qualquer listener local persistente.',
            'Manter tunnel-client rodando durante criação e uso do conector.',
        ],
    };
}

/**
 * @param {ConnectorProfileOptions & { originUrl?: string }} [options]
 * @returns {{
 *     prerequisites: string[];
 *     originUrl: string;
 *     quickTunnelCommands: string[];
 *     managedTunnelCommands: string[];
 *     chatgptUrl: string;
 *     notes: string[];
 * }}
 */
export function buildCloudflareTunnelRunbook(options = {}) {
    const profile = buildChatGptConnectorProfile(options);
    const originUrl =
        options.originUrl ??
        process.env['COPILOT_MCP_CLOUDFLARE_ORIGIN_URL'] ??
        profile.localMcpUrl.replace(/\/mcp$/, '');
    return {
        prerequisites: [
            'cloudflared instalado no mesmo ambiente que alcança o MCP HTTP local.',
            `MCP HTTP saudável no origin ${originUrl}.`,
            'Tunnel remoto Cloudflare criado como workspace-mcp-dev.',
            'Hostname público permanente configurado como mcp.aurelin.org.',
            'Rota pública publicada para o origin local sem /mcp no serviço de origem.',
            'ChatGPT developer mode habilitado para criar conector customizado.',
        ],
        originUrl,
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
            'npm run copilot:mcp:cloudflare:up',
            'npm run copilot:mcp:cloudflare:status',
            'npm run copilot:mcp:cloudflare:remote-audit',
            'npm run copilot:mcp:cloudflare:smoke',
        ],
        chatgptUrl: profile.connectorUrl,
        notes: [
            'O modo principal deste projeto usa domínio permanente Cloudflare.',
            `URL do conector no ChatGPT: ${DEFAULT_PUBLIC_MCP_URL}.`,
            `A rota Cloudflare aponta para o origin HTTP raiz ${DEFAULT_CLOUDFLARE_ORIGIN_URL}; nunca configure o serviço de origem como /mcp.`,
            'Audite drift remoto com npm run copilot:mcp:cloudflare:remote-audit depois de qualquer alteração no dashboard.',
            'Depois do smoke, o endpoint permanente deve responder /health e /mcp tools/list.',
            'Quick Tunnel continua disponível como fallback, mas não é mais o caminho padrão.',
            'Não proteja /mcp com login interativo que o backend do ChatGPT não consiga atravessar.',
            'OAuth e o modo padrão do MCP permanente. Use No authentication apenas com COPILOT_MCP_AUTH_MODE=none-dev em desenvolvimento controlado.',
        ],
    };
}

/**
 * @param {string} url
 * @returns {string}
 */
export function normalizeMcpUrl(url) {
    const trimmed = String(url || '').trim();
    if (!trimmed) return DEFAULT_PUBLIC_MCP_URL;
    return trimmed.endsWith('/mcp') ? trimmed : `${trimmed.replace(/\/+$/, '')}/mcp`;
}

/**
 * @param {string} url
 * @returns {{ ok: true } | { ok: false; reason: string }}
 */
export function validatePublicConnectorUrl(url) {
    const normalized = normalizeMcpUrl(url);
    if (!normalized.startsWith('https://')) {
        return { ok: false, reason: 'ChatGPT connector URL must be HTTPS.' };
    }
    if (!normalized.endsWith('/mcp')) {
        return { ok: false, reason: 'ChatGPT connector URL must end with /mcp.' };
    }
    return { ok: true };
}
