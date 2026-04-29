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
 *     timeoutMs: number;
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
                timeoutMs: 10_000,
            },
            {
                id: 'late-deps',
                owner: 'bootstrap',
                responsibility: 'injetar builders, audit bus e dependencias tardias do SDK',
                timeoutMs: 10_000,
            },
            {
                id: 'sdk-preflight',
                owner: 'bootstrap',
                responsibility: 'validar conectividade CLI, auth e modelo configurado antes do uso do runtime',
                timeoutMs: 15_000,
            },
            {
                id: 'runtime-wiring',
                owner: 'bootstrap',
                responsibility: 'compor façades, estado vivo e runtime do agente',
                timeoutMs: 15_000,
            },
            {
                id: 'terminal-init',
                owner: 'terminal',
                responsibility: 'criar contexto transacional do terminal e registrar início do boot local',
                timeoutMs: 5_000,
            },
            {
                id: 'terminal-aliases',
                owner: 'terminal',
                responsibility: 'carregar aliases customizados antes de abrir a UX',
                timeoutMs: 10_000,
            },
            {
                id: 'terminal-runtime-config',
                owner: 'terminal',
                responsibility: 'aplicar wiring do runtime recebido pela composition root',
                timeoutMs: 10_000,
            },
            {
                id: 'terminal-pinned-context',
                owner: 'terminal',
                responsibility: 'subir loader de arquivos pinados e bridge de hot reload',
                timeoutMs: 15_000,
            },
            {
                id: 'terminal-conversation-hub',
                owner: 'terminal',
                responsibility: 'inicializar ConversationHub e criar hub_session permanente best-effort',
                timeoutMs: 15_000,
            },
            {
                id: 'copilot-http-server',
                owner: 'server',
                responsibility: 'subir HTTP/Socket.IO local consumindo apenas dependencias recebidas',
                timeoutMs: 15_000,
            },
            {
                id: 'terminal-runtime-listeners',
                owner: 'terminal',
                responsibility: 'registrar listeners, timers, Socket.IO hub e evento terminal.started',
                timeoutMs: 10_000,
            },
            {
                id: 'repl',
                owner: 'terminal',
                responsibility: 'abrir loop interativo apos servidor e runtime estarem prontos',
                timeoutMs: 10_000,
            },
            {
                id: 'compat-runtime-host',
                owner: 'compat-runtime-host',
                responsibility: 'hospedar sinais, IPC e shutdown do entrypoint compatível sem virar segundo boot',
                timeoutMs: 5_000,
            },
        ],
    };
}
