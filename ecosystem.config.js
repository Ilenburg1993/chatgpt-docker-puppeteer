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

const NODE_ARGS_BASE = [
    '--expose-gc',                 // GC manual controlado (processos long-lived)
    '--unhandled-rejections=strict',// Promises não tratadas derrubam o processo
    '--enable-source-maps',         // Stack traces corretos em produção
    '--trace-warnings',             // Avisos nunca silenciosos
    '--max-old-space-size=6144',    // Limite de memória heap (6 GB)
    '--trace-gc-ignored-scavenger', // Diagnóstico de GC (memória longa duração)
];

module.exports = {
    apps: [

        /* =====================================================================
           1. AGENTE-GPT — Execution Kernel (Maestro)
           ===================================================================== */
        {
            name: 'agente-gpt',

            cwd: __dirname,
            script: './index.js',

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
                'src/infra/storage/robot_identity.json'
            ],

            // Limites e resiliência
            max_memory_restart: '3G',
            exp_backoff_restart_delay: 100,

            // Shutdown determinístico
            kill_timeout: 8000,
            listen_timeout: 8000,

            // Logs estruturados
            merge_logs: false,
            time: true,
            log_date_format: 'YYYY-MM-DD HH:mm:ss',
            error_file: './logs/agente-error.log',
            out_file: './logs/agente-out.log',

            // Ambiente
            env: {
                NODE_ENV: 'development',
                FORCE_COLOR: '1'
            },

            env_production: {
                NODE_ENV: 'production',
                FORCE_COLOR: '1'
            }
        },

        /* =====================================================================
           2. DASHBOARD-WEB — Mission Control (HTTP / Socket)
           ===================================================================== */
        {
            name: 'dashboard-web',

            cwd: __dirname,
            script: './src/server/main.js',

            // Runtime Node explícito (sem GC manual necessário)
            node_args: [
                '--unhandled-rejections=strict',
                '--enable-source-maps',
                '--trace-warnings'
            ],

            exec_mode: 'fork',
            instances: 1,

            watch: false,
            ignore_watch: [
                'node_modules',
                'logs',
                // deprecated: prefer NERV SERVER_READY. Use ENABLE_STATE_FILE=true
                'estado.json',
                'src/infra/storage/robot_identity.json'
            ],

            // Limites
            max_memory_restart: '3G',

            // Shutdown previsível
            kill_timeout: 8000,
            listen_timeout: 8000,

            // Logs
            merge_logs: false,
            time: true,
            log_date_format: 'YYYY-MM-DD HH:mm:ss',
            error_file: './logs/dashboard-error.log',
            out_file: './logs/dashboard-out.log',

            // Ambiente
            env: {
                PORT: 3008,
                NODE_ENV: 'development',
                DAEMON_MODE: 'true'
            },

            env_production: {
                PORT: 3008,
                NODE_ENV: 'production',
                DAEMON_MODE: 'true'
            }
        }
    ]
};
