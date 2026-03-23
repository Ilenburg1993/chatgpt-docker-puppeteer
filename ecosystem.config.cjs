/* ============================================================================
   ecosystem.config.js
   Audit Level: 800 — Sovereign Process Orchestration (Canonical Runtime)
   Status: CANONICAL / HARDENED / AUDIT-READY

   Responsabilidade:
   • Orquestração soberana de processos Node.js via PM2
   • Runtime explícito, previsível e observável
   • Fail-fast ativado no nível do processo
   • Compatível com pm2, pm2-runtime, Docker e CI/CD

   Princípios:
   • Um processo = uma responsabilidade
   • Zero comportamento implícito
   • Nenhum fallback silencioso
============================================================================ */

/* --------------------------------------------------------------------------
    DEPRECATION NOTICE: 'estado.json'

    The legacy local state file `estado.json` is deprecated. Service discovery
    and runtime coordination should use the canonical NERV event
    `ActionCode.SERVER_READY` (see `src/nerv/discovery.js`).

    During migration, legacy file behaviour can be temporarily re-enabled by
    setting the environment variable `ENABLE_STATE_FILE=true`. Prefer the NERV
    discovery for new code and automation.
-------------------------------------------------------------------------- */

// Auto-detecção de ambiente (raiz vs dist)
const isProduction = __dirname.endsWith('/dist') || __dirname.endsWith('\\dist');
const projectRoot = isProduction ? require('path').resolve(__dirname, '..') : __dirname;
const scriptPath = isProduction ? './start.js' : './index.js';
const enableAuditAgentPm2Processes =
    String(process.env.ENABLE_AUDIT_AGENT_PM2_PROCESSES || '').toLowerCase() === 'true';

console.log(`🔍 PM2 Environment: ${isProduction ? 'PRODUCTION (dist)' : 'DEVELOPMENT (root)'}`);
console.log(`📁 Project root: ${projectRoot}`);
console.log(`📄 Script: ${scriptPath}`);
console.log('═══════════════════════════════════════════════════════════════');

const NODE_ARGS_BASE = [
    '--strip-types', // TypeScript .ts files em src/core/constants/ (H.1 migration)
    '--expose-gc', // GC manual controlado (processos long-lived)
    '--unhandled-rejections=strict', // Promises não tratadas derrubam o processo
    '--enable-source-maps', // Stack traces corretos em produção
    '--trace-warnings', // Avisos nunca silenciosos
    '--max-old-space-size=6144', // Limite de memória heap (6 GB)
    // Removed: --trace-gc-ignored-scavenger (not supported in Node.js 20)
];

// ----------------------------------------------------------------------------
// Debug helper: if DEBUG_PORT is set in the environment, automatically expose the
// inspector on that port. This mirrors the behavior of
// scripts/ops/start-pm2-debug.sh and lets developers run
//
//     DEBUG_PORT=9229 npm run daemon:start
//
// without editing the ecosystem file manually. Values are additive so multiple
// ports can be supplied as a comma-separated list.
// ----------------------------------------------------------------------------
const debugPortEnv = process.env.DEBUG_PORT;
if (debugPortEnv) {
    const ports = debugPortEnv
        .split(',')
        .map((p) => p.trim())
        .filter(Boolean);
    for (const p of ports) {
        NODE_ARGS_BASE.push(`--inspect=0.0.0.0:${p}`);
    }
}

module.exports = {
    apps: [
        /* =====================================================================
           1. AGENTE-GPT — Execution Kernel (Maestro)
           ===================================================================== */
        {
            name: 'agente-gpt',

            cwd: projectRoot,
            script: scriptPath,

            // Runtime Node explícito e endurecido
            node_args: NODE_ARGS_BASE,

            exec_mode: 'fork',
            instances: 1,

            watch: false,
            ignore_watch: [
                'node_modules',
                'logs',
                'fila',
                'respostas',
                'tmp',
                '*.lock',
                // deprecated: prefer NERV SERVER_READY. Use ENABLE_STATE_FILE=true
                'estado.json',
                'src/infra/storage/robot_identity.json',
            ],

            // Limites e resiliência
            max_memory_restart: '3G',
            exp_backoff_restart_delay: 100,
            autorestart: true,

            // Shutdown determinístico
            kill_timeout: 8000,
            listen_timeout: 8000,

            // Logs estruturados com rotação automática
            merge_logs: false,
            time: true,
            log_date_format: 'YYYY-MM-DD HH:mm:ss',
            error_file: './logs/agente-error.log',
            out_file: './logs/agente-out.log',
            log_rotate_interval: '1d', // Rotacionar diariamente
            log_rotate_size: '100M', // Ou a cada 100MB
            log_rotate_max: 7, // Manter últimos 7 dias

            // Ambiente
            filter_env: ['NO_COLOR'],
            env: {
                NODE_ENV: 'development',
                FORCE_COLOR: '1',
                SERVER_MODE: 'split', // PM2 SOBERANO: Força modo split
                SERVER_AUTHORITY: 'standalone', // Processo autônomo
                // CHROME_PROXY_ENABLED omitido (padrão: true)
                // Maestro detecta proxy externo PM2 via checkPortInUse(9224)
            },

            env_production: {
                NODE_ENV: 'production',
                FORCE_COLOR: '1',
                SERVER_MODE: 'split', // PM2 SOBERANO: Força modo split
                SERVER_AUTHORITY: 'standalone',
                // CHROME_PROXY_ENABLED omitido (padrão: true)
                // Maestro detecta proxy externo PM2 via checkPortInUse(9224)
            },
        },

        /* =====================================================================
           2. DASHBOARD-WEB — Mission Control (HTTP / Socket)
           ===================================================================== */
        {
            name: 'dashboard-web',

            cwd: projectRoot,
            script: './src/server/main.js',
            wait_ready: true,

            // Runtime Node explícito (sem GC manual necessário)
            node_args: ['--unhandled-rejections=strict', '--enable-source-maps', '--trace-warnings'],

            exec_mode: 'fork',
            instances: 1,

            watch: false,
            ignore_watch: [
                'node_modules',
                'logs',
                // deprecated: prefer NERV SERVER_READY. Use ENABLE_STATE_FILE=true
                'estado.json',
                'src/infra/storage/robot_identity.json',
            ],

            // Limites e resiliência
            max_memory_restart: '3G',
            exp_backoff_restart_delay: 100,
            autorestart: true,

            // Shutdown previsível
            kill_timeout: 8000,
            listen_timeout: 8000,

            // Logs com rotação automática
            merge_logs: false,
            time: true,
            log_date_format: 'YYYY-MM-DD HH:mm:ss',
            error_file: './logs/dashboard-error.log',
            out_file: './logs/dashboard-out.log',
            log_rotate_interval: '1d', // Rotacionar diariamente
            log_rotate_size: '100M', // Ou a cada 100MB
            log_rotate_max: 7, // Manter últimos 7 dias

            // Load .env.local for sensitive configs (Ollama Cloud API keys, etc.)
            // Order: .env.local overrides .env (dotenv loaded in main.js)
            env_file: './.env.local',

            // Ambiente
            filter_env: ['NO_COLOR'],
            env: {
                PORT: 3008,
                NODE_ENV: 'development',
                DAEMON_MODE: 'true',
                SERVER_AUTHORITY: 'standalone', // PM2 SOBERANO: Processo autônomo
                ENABLE_STATE_FILE: 'false', // Usa NERV SERVER_READY (não estado.json)
                MCP_ENABLED: 'true', // Habilita MCP handler (v4.1)

                // Adaptive timeout defaults (can be overridden in .env.local)
                MCP_TOOL_ADAPTIVE_TIMEOUT: 'true', // Enable adaptive timeout (P99.9999)
                MCP_TOOL_RETRY_ENABLED: 'true', // Enable retry with exponential backoff
                OLLAMA_CIRCUIT_BREAKER_ENABLED: 'true', // Circuit breaker protection
            },

            env_production: {
                PORT: 3008,
                NODE_ENV: 'production',
                DAEMON_MODE: 'true',
                SERVER_AUTHORITY: 'standalone',
                ENABLE_STATE_FILE: 'false',
                MCP_ENABLED: 'true',
                MCP_TOOL_ADAPTIVE_TIMEOUT: 'true',
                MCP_TOOL_RETRY_ENABLED: 'true',
                OLLAMA_CIRCUIT_BREAKER_ENABLED: 'true',
            },
        },

        // Process 3: Chrome Proxy Service
        // Purpose: Transparent proxy between Puppeteer and Chrome DevTools Protocol
        // Architecture: Docker Desktop (Container → host.docker.internal:9225 → Windows Chrome)
        {
            name: 'chrome-proxy',

            cwd: projectRoot,
            script: './scripts/chrome-proxy-service.js',
            exec_mode: 'fork',
            instances: 1,
            autorestart: true,
            watch: false,
            max_memory_restart: '500M',
            exp_backoff_restart_delay: 100,

            // Node arguments (aligned with other processes)
            node_args: [
                '--expose-gc', // Manual GC control
                '--unhandled-rejections=strict', // Crash on unhandled promises
                '--enable-source-maps', // Correct stack traces
                '--trace-warnings', // Never silent warnings
                '--optimize-for-size', // Otimiza para uso de memória
            ],

            // Environment variables
            filter_env: ['NO_COLOR'],
            env: {
                NODE_ENV: 'development',
                CHROME_HOST: 'host.docker.internal', // Docker Desktop → Windows
                CHROME_PORT: '9225', // Chrome debugging port
                CHROME_PROXY_PORT: '9224', // Proxy listen port
                LOG_LEVEL: 'info',
                // v3.0 - Rate Limiting & Security
                CHROME_PROXY_MAX_WS_GLOBAL: '200', // Global WS connection limit
                CHROME_PROXY_MAX_WS_PER_IP: '20', // Per-IP WS connection limit
                CHROME_PROXY_MAX_JSON_BUFFER: '10485760', // 10MB buffer limit
                WS_IDLE_TIMEOUT_MS: '300000', // 5 min idle timeout
                CHROME_CB_THRESHOLD: '5', // Circuit breaker threshold
                CHROME_CB_TIMEOUT: '30000', // Circuit breaker timeout (30s)
            },

            env_production: {
                NODE_ENV: 'production',
                CHROME_HOST: 'host.docker.internal',
                CHROME_PORT: '9225',
                CHROME_PROXY_PORT: '9224',
                LOG_LEVEL: 'warn',
                // v3.0 - Rate Limiting & Security
                CHROME_PROXY_MAX_WS_GLOBAL: '200',
                CHROME_PROXY_MAX_WS_PER_IP: '20',
                CHROME_PROXY_MAX_JSON_BUFFER: '10485760',
                WS_IDLE_TIMEOUT_MS: '300000',
                CHROME_CB_THRESHOLD: '5',
                CHROME_CB_TIMEOUT: '30000',
                // Auto-detected paths for production
                SCRIPT_PATH: scriptPath,
            },

            // Logging (consistent with other processes)
            merge_logs: false, // Separate stdout/stderr
            time: true, // Add timestamps to each log line
            log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
            error_file: './logs/chrome-proxy-error.log',
            out_file: './logs/chrome-proxy-out.log',
            log_rotate_interval: '1d', // Rotate daily
            log_rotate_size: '100M', // Ou a cada 100MB
            log_rotate_max: 7, // Keep last 7 days

            // PM2 Runtime Timing
            kill_timeout: 8000, // Graceful shutdown timeout
            listen_timeout: 8000, // Startup timeout
            min_uptime: '10s', // Minimum uptime before considering stable
        },
        ...(enableAuditAgentPm2Processes
            ? [
                  {
                      name: 'inference-gateway',
                      cwd: projectRoot,
                      script: './src/inference_gateway/main.js',
                      wait_ready: true,
                      exec_mode: 'fork',
                      instances: 1,
                      watch: false,
                      autorestart: true,
                      kill_timeout: 8000,
                      listen_timeout: 8000,
                      max_memory_restart: '512M',
                      merge_logs: false,
                      time: true,
                      log_date_format: 'YYYY-MM-DD HH:mm:ss',
                      error_file: './logs/inference-gateway-error.log',
                      out_file: './logs/inference-gateway-out.log',
                      filter_env: ['NO_COLOR'],
                      env: {
                          NODE_ENV: 'development',
                          FORCE_COLOR: '1',
                          INFERENCE_GATEWAY_ENABLED: 'true',
                          INFERENCE_GATEWAY_HOST: '127.0.0.1',
                          INFERENCE_GATEWAY_PORT: '3099',
                      },
                      env_production: {
                          NODE_ENV: 'production',
                          FORCE_COLOR: '1',
                          INFERENCE_GATEWAY_ENABLED: 'true',
                          INFERENCE_GATEWAY_HOST: '127.0.0.1',
                          INFERENCE_GATEWAY_PORT: '3099',
                      },
                  },
                  {
                      name: 'ollama-host-supervisor',
                      cwd: projectRoot,
                      script: './scripts/ollama-host-supervisor.js',
                      exec_mode: 'fork',
                      instances: 1,
                      watch: false,
                      autorestart: true,
                      kill_timeout: 8000,
                      max_memory_restart: '256M',
                      merge_logs: false,
                      time: true,
                      log_date_format: 'YYYY-MM-DD HH:mm:ss',
                      error_file: './logs/ollama-supervisor-error.log',
                      out_file: './logs/ollama-supervisor-out.log',
                      filter_env: ['NO_COLOR'],
                      env: {
                          NODE_ENV: 'development',
                          FORCE_COLOR: '1',
                          OLLAMA_SUPERVISOR_ENABLED: 'true',
                          OLLAMA_HEALTH_POLL_MS: '5000',
                      },
                      env_production: {
                          NODE_ENV: 'production',
                          FORCE_COLOR: '1',
                          OLLAMA_SUPERVISOR_ENABLED: 'true',
                          OLLAMA_HEALTH_POLL_MS: '5000',
                      },
                  },
                  {
                      name: 'audit-agent',
                      cwd: projectRoot,
                      script: './src/audit_agent/main.js',
                      wait_ready: true,
                      exec_mode: 'fork',
                      instances: 1,
                      watch: false,
                      autorestart: true,
                      kill_timeout: 8000,
                      listen_timeout: 8000,
                      max_memory_restart: '512M',
                      merge_logs: false,
                      time: true,
                      log_date_format: 'YYYY-MM-DD HH:mm:ss',
                      error_file: './logs/audit-agent-error.log',
                      out_file: './logs/audit-agent-out.log',
                      filter_env: ['NO_COLOR'],
                      env: {
                          NODE_ENV: 'development',
                          FORCE_COLOR: '1',
                          AUDIT_AGENT_ENABLED: 'true',
                          AUDIT_AGENT_MODE: 'semi_auto',
                          AUDIT_AGENT_HOST: '127.0.0.1',
                          AUDIT_AGENT_PORT: '3098',
                          AUDIT_AGENT_MAX_CONCURRENT_JOBS: '1',
                          AUDIT_AGENT_MAX_PARALLEL_LLM_CALLS: '1',
                          AUDIT_AGENT_TRIGGER_DEBOUNCE_MS: '5000',
                          AUDIT_AGENT_JOB_COOLDOWN_MS: '30000',
                      },
                      env_production: {
                          NODE_ENV: 'production',
                          FORCE_COLOR: '1',
                          AUDIT_AGENT_ENABLED: 'true',
                          AUDIT_AGENT_MODE: 'semi_auto',
                          AUDIT_AGENT_HOST: '127.0.0.1',
                          AUDIT_AGENT_PORT: '3098',
                          AUDIT_AGENT_MAX_CONCURRENT_JOBS: '1',
                          AUDIT_AGENT_MAX_PARALLEL_LLM_CALLS: '1',
                          AUDIT_AGENT_TRIGGER_DEBOUNCE_MS: '5000',
                          AUDIT_AGENT_JOB_COOLDOWN_MS: '30000',
                      },
                  },
              ]
            : []),

        // ── Always-Alive Copilot SDK Agent ──────────────────────────────────
        // Habilitado quando COPILOT_SDK_ENABLED=true no environment.
        // Este processo NÃO inicia automaticamente com pm2 start — é opcional.
        ...(process.env.COPILOT_SDK_ENABLED === 'true'
            ? [
                  {
                      name: 'copilot-sdk-agent',
                      cwd: projectRoot,
                      script: './src/copilot/agent.js',
                      wait_ready: false,
                      exec_mode: 'fork',
                      instances: 1,
                      watch: false,
                      autorestart: true,
                      kill_timeout: 10000,
                      max_restarts: 10,
                      restart_delay: 3000,
                      max_memory_restart: '512M',
                      merge_logs: false,
                      time: true,
                      log_date_format: 'YYYY-MM-DD HH:mm:ss',
                      error_file: './logs/copilot-sdk-agent-error.log',
                      out_file: './logs/copilot-sdk-agent-out.log',
                      filter_env: ['NO_COLOR'],
                      env: {
                          NODE_ENV: 'development',
                          FORCE_COLOR: '1',
                          COPILOT_SDK_ENABLED: 'true',
                          COPILOT_MODEL: 'gpt-4.1',
                      },
                      env_production: {
                          NODE_ENV: 'production',
                          FORCE_COLOR: '1',
                          COPILOT_SDK_ENABLED: 'true',
                          COPILOT_MODEL: 'gpt-4.1',
                      },
                  },
              ]
            : []),
    ],
};
