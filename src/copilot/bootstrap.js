// @ts-check
/**
 * src/copilot/bootstrap.js — Entry point canônico do módulo copilot.
 *
 * Inicializa o DI container, registra módulos por camada e delega para o modo selecionado:
 * - `terminal` → `terminal/index.js` (Terminal Permanente LLM-B)
 * - `server`   → retorna bridge para Express (rotas /api/copilot/*)
 *
 * @module copilot/bootstrap
 */

import { bootstrapObservability } from './observability/bootstrap.js';
import { log } from './observability/logger.js';

/**
 * @typedef {'terminal' | 'server'} CopilotBootMode
 */

/**
 * @typedef {object} BootOptions
 * @property {CopilotBootMode} mode Modo de operação.
 */

/**
 * Inicializa o módulo copilot:
 * 1. `bootstrapObservability()` — DI tokens L0 (loggers, event bus, error tracking)
 * 2. Delega para o modo selecionado
 *
 * @param {BootOptions} options
 * @returns {Promise<void>}
 */
export async function bootCopilot({ mode }) {
    log('INFO', `[bootstrap] Iniciando copilot em modo "${mode}"…`);

    // L0: observability + core DI registrations
    bootstrapObservability();

    if (mode === 'terminal') {
        const { startTerminalServer } = await import('./terminal/index.js');
        await startTerminalServer();
    } else if (mode === 'server') {
        log('INFO', '[bootstrap] Modo server — bridge disponível via DI container.');
        // Server mode: o caller (src/server/main.js) resolve os handlers do container
        // após bootCopilot retornar. Nenhuma ação adicional aqui.
    } else {
        throw new Error(`[bootstrap] Modo desconhecido: "${mode}". Use 'terminal' ou 'server'.`);
    }
}
