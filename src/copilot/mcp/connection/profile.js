// @ts-check
/**
 * ChatGPT connector profile and tunnel runbook helpers.
 *
 * @module copilot/mcp/connection/profile
 */

const DEFAULT_LOCAL_MCP_URL = 'http://127.0.0.1:3333/mcp';
const DEFAULT_PUBLIC_MCP_URL = 'https://<endpoint-do-tunel>/mcp';

export const CHATGPT_CONNECTOR_NAME = 'Repo DevContainer MCP';

export const CHATGPT_CONNECTOR_DESCRIPTION =
    'Conecta o ChatGPT ao repositório aberto no VS Code Dev Container. ' +
    'Permite ler arquivos, buscar no código, inspecionar Git, executar validadores controlados ' +
    'e operar o workspace por tools MCP auditáveis.';

/**
 * @typedef {'none-dev' | 'oauth' | 'secure-mcp-tunnel'} ChatGptAuthMode
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
 * @property {string} localMcpUrl
 * @property {string} tunnelId
 * @property {string[]} chatgptFormSteps
 * @property {string[]} smokePrompts
 * @property {string[]} requiredLocalChecks
 * @property {string[]} remoteExposureOptions
 */

/**
 * @param {ConnectorProfileOptions} [options]
 * @returns {ConnectorProfile}
 */
export function buildChatGptConnectorProfile(options = {}) {
    const publicMcpUrl = options.publicMcpUrl ?? process.env['COPILOT_MCP_PUBLIC_URL'] ?? DEFAULT_PUBLIC_MCP_URL;
    const localMcpUrl = options.localMcpUrl ?? process.env['COPILOT_MCP_LOCAL_URL'] ?? DEFAULT_LOCAL_MCP_URL;
    const authMode =
        options.authMode ??
        /** @type {ChatGptAuthMode} */ (process.env['COPILOT_MCP_CHATGPT_AUTH_MODE'] ?? 'none-dev');
    const tunnelId = options.tunnelId ?? process.env['OPENAI_MCP_TUNNEL_ID'] ?? 'tunnel_<preencher>';
    return {
        name: CHATGPT_CONNECTOR_NAME,
        description: CHATGPT_CONNECTOR_DESCRIPTION,
        connectorUrl: normalizeMcpUrl(publicMcpUrl),
        authMode,
        localMcpUrl: normalizeMcpUrl(localMcpUrl),
        tunnelId,
        chatgptFormSteps: [
            'Abrir ChatGPT > Settings > Apps & Connectors > Advanced settings e habilitar developer mode.',
            'Abrir Settings > Connectors > Create.',
            `Nome: ${CHATGPT_CONNECTOR_NAME}`,
            `Descrição: ${CHATGPT_CONNECTOR_DESCRIPTION}`,
            `URL do servidor MCP: ${normalizeMcpUrl(publicMcpUrl)}`,
            'Escolher autenticação compatível com o túnel ou OAuth configurado.',
            'Criar o conector e confirmar que a lista de tools aparece.',
        ],
        smokePrompts: [
            'Use o conector Repo DevContainer MCP e chame repo_status.',
            'Chame mcp_capabilities_summary e resuma as categorias de tools.',
            'Liste a árvore de src/copilot/mcp com repo_tree.',
            'Liste a raiz real do workspace com repo_root_tree maxEntries=80.',
            'Busque registerCanonicalMcpTools em src/copilot/mcp com repo_search_text contextLines=2.',
            'Leia src/copilot/mcp/registry.js linhas 1 a 120 com repo_read_file e informe o sha256.',
            'Chame project_doctor.',
            'Inicie run_copilot_validator validator=typecheck e depois leia o output com job_get_output.',
            'Chame mcp_runtime_health e mcp_tunnel_status.',
        ],
        requiredLocalChecks: [
            `MCP local responde em ${normalizeMcpUrl(localMcpUrl)}.`,
            'tools/list retorna as tools esperadas.',
            'repo_status funciona localmente antes de testar no ChatGPT.',
            'O tunnel ativo alcança o origin local e preserva o path público /mcp.',
        ],
        remoteExposureOptions: [
            'Cloudflare Quick Tunnel temporário: modo operacional principal, com URL trycloudflare.com por sessão.',
            'Cloudflare Tunnel publicado: modo futuro opcional se algum dia houver hostname estável.',
            'OpenAI Secure MCP Tunnel: alternativa privada baseada em tunnel-client.',
        ],
    };
}

/**
 * @param {ConnectorProfileOptions} [options]
 * @returns {{ prerequisites: string[]; httpTunnelCommands: string[]; stdioTunnelCommands: string[]; chatgptUrl: string; notes: string[] }}
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
 *   prerequisites: string[];
 *   originUrl: string;
 *   quickTunnelCommands: string[];
 *   managedTunnelCommands: string[];
 *   chatgptUrl: string;
 *   notes: string[];
 * }}
 */
export function buildCloudflareTunnelRunbook(options = {}) {
    const profile = buildChatGptConnectorProfile(options);
    const originUrl =
        options.originUrl ?? process.env['COPILOT_MCP_CLOUDFLARE_ORIGIN_URL'] ?? profile.localMcpUrl.replace(/\/mcp$/, '');
    return {
        prerequisites: [
            'cloudflared instalado no mesmo ambiente que alcança o MCP HTTP local.',
            `MCP HTTP saudável no origin ${originUrl}.`,
            'Para o modo atual: Quick Tunnel temporário gerado por sessão, sem domínio fixo.',
            'Para modo futuro com hostname estável: tunnel remoto Cloudflare criado e rota publicada para o origin local.',
            'ChatGPT developer mode habilitado para criar conector customizado.',
        ],
        originUrl,
        quickTunnelCommands: [
            'npm run copilot:mcp:http',
            'npm run copilot:mcp:cloudflare:doctor',
            'npm run copilot:mcp:cloudflare:quick',
            'npm run copilot:mcp:cloudflare:status',
            'npm run copilot:mcp:cloudflare:smoke',
        ],
        managedTunnelCommands: [
            'npm run copilot:mcp:http',
            'npm run copilot:mcp:cloudflare:doctor',
            'export CLOUDFLARE_TUNNEL_TOKEN="<token-do-tunnel>"',
            'npm run copilot:mcp:cloudflare:run',
        ],
        chatgptUrl: profile.connectorUrl,
        notes: [
            'O modo principal deste projeto usa domínio temporário trycloudflare.com; a URL muda a cada sessão.',
            'O conector recebe a URL pública terminada em /mcp, capturada pelo arquivo de estado local.',
            'A rota Cloudflare sempre aponta para o origin HTTP raiz; nunca configure o origin como /mcp.',
            'Hostname publicado fica documentado como futuro opcional, não como requisito atual.',
            'Não proteja /mcp com login interativo que o backend do ChatGPT não consiga atravessar.',
            'Sem OAuth no MCP, escolha no ChatGPT o modo sem autenticação somente em desenvolvimento controlado.',
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
