/* ============================================================================
   ecosystem.config.js
   Audit Level: 700 — Sovereign Process Orchestration
   Status: CONSOLIDATED (Protocol 11 — Zero-Bug Tolerance)

   Responsabilidade:
   • Orquestração soberana de processos Node.js via PM2 API
   • Compatível com pm2, pm2-runtime, containers e CI/CD
   • Zero dependência de shell
   • Execução previsível, controlada e auditável

   Ambiente:
   • Windows (host) + Linux (container)
   • DevContainer / Docker
============================================================================ */

module.exports = {
    apps: [

        /* =====================================================================
           1. AGENTE-GPT — Execution Kernel (Maestro)
           ---------------------------------------------------------------------
           Núcleo principal de execução lógica e coordenação.
           Processo único, long-lived, com controle explícito de memória.
        ===================================================================== */
        {
            name: 'agente-gpt',

            // Diretório base explícito (requisito da PM2 API)
            cwd: __dirname,

            script: './index.js',

            // GC manual para sessões longas
            node_args: ['--expose-gc'],

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
                'estado.json',
                'src/infra/storage/robot_identity.json'
            ],

            // Limites e tolerância a falhas
            max_memory_restart: '1G',
            exp_backoff_restart_delay: 100,

            // Shutdown previsível (evita processos zumbis)
            kill_timeout: 8000,
            listen_timeout: 8000,

            // Logs
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
           2. DASHBOARD-WEB — Mission Control
           ---------------------------------------------------------------------
           Interface web e plano de observabilidade.
           Processo isolado, sem cluster, focado em previsibilidade.
        ===================================================================== */
        {
            name: 'dashboard-web',

            cwd: __dirname,

            script: './src/server/main.js',

            exec_mode: 'fork',
            instances: 1,

            watch: false,
            ignore_watch: [
                'node_modules',
                'logs',
                'estado.json',
                'src/infra/storage/robot_identity.json'
            ],

            // Limites
            max_memory_restart: '2G',

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
