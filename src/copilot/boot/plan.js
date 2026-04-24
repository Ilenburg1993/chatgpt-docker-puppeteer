// @ts-check
/**
 * src/copilot/boot/plan.js
 *
 * Plano de boot auditavel derivado da configuracao canonica.
 *
 * @module copilot/boot/plan
 */

import { readCopilotBootConfig } from './config.js';

/**
 * @typedef {{
 *     id: string;
 *     owner: 'bootstrap' | 'terminal' | 'server' | 'compat-runtime-host';
 *     responsibility: string;
 * }} CopilotBootPlanPhase
 */

/**
 * @param {ReturnType<import('./config.js').readCopilotBootConfig>} [config]
 * @returns {{
 *     mode: string;
 *     workspaceRoot: string;
 *     serverUrl: string;
 *     phases: CopilotBootPlanPhase[];
 * }}
 */
export function createCopilotBootPlan(config = readCopilotBootConfig()) {
    return {
        mode: config.mode,
        workspaceRoot: config.workspace.root,
        serverUrl: config.server.url,
        phases: [
            {
                id: 'observability',
                owner: 'bootstrap',
                responsibility: 'registrar logs, metricas, tracing e shutdown handlers basicos',
            },
            {
                id: 'late-deps',
                owner: 'bootstrap',
                responsibility: 'injetar builders, audit bus e dependencias tardias do SDK',
            },
            {
                id: 'sdk-preflight',
                owner: 'bootstrap',
                responsibility: 'validar conectividade CLI, auth e modelo configurado antes do uso do runtime',
            },
            {
                id: 'runtime-wiring',
                owner: 'bootstrap',
                responsibility: 'compor façades, estado vivo e runtime do agente',
            },
            {
                id: 'terminal-host',
                owner: 'terminal',
                responsibility: 'subir UX REPL/SSE, aliases, arquivos pinados e timers do terminal',
            },
            {
                id: 'copilot-http-server',
                owner: 'server',
                responsibility: 'subir HTTP/Socket.IO local consumindo apenas dependencias recebidas',
            },
            {
                id: 'repl',
                owner: 'terminal',
                responsibility: 'abrir loop interativo apos servidor e runtime estarem prontos',
            },
            {
                id: 'compat-runtime-host',
                owner: 'compat-runtime-host',
                responsibility: 'hospedar sinais, IPC e shutdown do entrypoint compatível sem virar segundo boot',
            },
        ],
    };
}
