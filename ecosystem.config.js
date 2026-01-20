/* ==========================================================================
   ecosystem.config.js
   Audit Level: 700 — Sovereign Process Orchestration (Singularity Edition)
   Status: CONSOLIDATED (Protocol 11 - Zero-Bug Tolerance)
   Responsabilidade: Configurar a gestão de processos PM2 para o Maestro e o
                     Mission Control Prime, garantindo resiliência e higiene.
   Sincronizado com: main.js V700, index.js V360, lifecycle.js V600.
========================================================================== */

module.exports = {
    apps: [
        {
            /**
       * 1. O MAESTRO (Execution Kernel)
       * Responsável pela orquestração de tarefas e controle do Driver.
       */
            name: 'agente-gpt',
            script: './index.js',

            // Habilita o Garbage Collector manual para sessões de longa duração
            node_args: '--expose-gc',

            // Desativa o watch para evitar reinícios por mutação de dados
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

            // Proteção contra vazamento de memória (Reinicia se exceder 1GB)
            max_memory_restart: '1G',

            // Delay incremental em caso de crash para evitar saturação do SO
            exp_backoff_restart_delay: 100,

            log_date_format: 'YYYY-MM-DD HH:mm:ss',
            error_file: './logs/agente-error.log',
            out_file: './logs/agente-out.log',

            env: {
                NODE_ENV: 'production',
                FORCE_COLOR: '1' // Preserva cores nos logs do PM2
            }
        },
        {
            /**
       * 2. MISSION CONTROL PRIME (Dashboard & Hub)
       * Responsável pela API, Socket.io e Supervisão.
       */
            name: 'dashboard-web',
            // [V700] Aponta para o novo ponto de entrada modular consolidado
            script: './src/server/main.js',

            watch: false,
            ignore_watch: [
                'node_modules',
                'logs',
                'estado.json',
                'src/infra/storage/robot_identity.json'
            ],

            log_date_format: 'YYYY-MM-DD HH:mm:ss',
            error_file: './logs/dashboard-error.log',
            out_file: './logs/dashboard-out.log',

            env: {
                PORT: 3008,
                NODE_ENV: 'production',
                // Sinaliza ao lifecycle.js que o processo deve se encerrar via process.exit
                DAEMON_MODE: 'true'
            }
        }
    ]
};