// @ts-check
/**
 * src/copilot/agent/entry.js
 *
 * Entry point do processo PM2 "copilot-sdk-agent".
 *
 * Inicializa o AlwaysAliveAgent e mantém o processo ativo, aguardando mensagens via sinais ou via HTTP bridge (montado
 * no dashboard-web :3008).
 *
 * Este processo é opcional e controlado por COPILOT_SDK_ENABLED=true.
 *
 * @module copilot/agent
 */

import { log } from '#core/logger';
import { CopilotClient } from '@github/copilot-sdk';
import { alwaysAliveAgent } from './always-alive.js';

const RESTART_DELAY_MS = parseInt(process.env.COPILOT_RESTART_DELAY_MS ?? '5000', 10);

/**
 * Inicializa o agente com tentativas de retry.
 *
 * @param {number} [attempt]
 * @returns {Promise<void>}
 */
async function startWithRetry(attempt = 1) {
    try {
        log('INFO', `[copilot/agent] Iniciando Always-Alive Agent (tentativa ${attempt})...`);
        await alwaysAliveAgent.start();
        log('INFO', '[copilot/agent] Agente ativo e aguardando mensagens via HTTP bridge.');
    } catch (/** @type {any} */ e) {
        log('ERROR', `[copilot/agent] Falha ao iniciar (tentativa ${attempt}): ${e.message}`);
        if (attempt < 5) {
            log('INFO', `[copilot/agent] Tentando novamente em ${RESTART_DELAY_MS}ms...`);
            await new Promise((r) => setTimeout(r, RESTART_DELAY_MS));
            await startWithRetry(attempt + 1);
        } else {
            log('ERROR', '[copilot/agent] Máximo de tentativas atingido. Encerrando processo.');
            process.exit(1);
        }
    }
}

// ─── Tratamento de sinais ─────────────────────────────────────────────────────

async function shutdown(signal = 'SIGTERM') {
    log('INFO', `[copilot/agent] Sinal ${signal} recebido — encerrando graciosamente...`);
    try {
        await alwaysAliveAgent.stop();
        log('INFO', '[copilot/agent] Agente parado. Processo encerrado.');
    } catch (/** @type {any} */ e) {
        log('WARN', `[copilot/agent] Erro no shutdown: ${e.message}`);
    } finally {
        process.exit(0);
    }
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Logar status periódico (evita PM2 matar o processo por inatividade)
alwaysAliveAgent.on('status', (status) => {
    log('INFO', `[copilot/agent] Status: ${status}`);
});

alwaysAliveAgent.on('error', (err) => {
    log('ERROR', `[copilot/agent] Erro do agente: ${err.message}`);
});

// ─── Bootstrap ───────────────────────────────────────────────────────────────

// UPG-08: health check de conectividade proativo antes do primeiro start
try {
    const pingClient = new CopilotClient();
    await Promise.race([
        pingClient.ping('boot health check'),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Ping timeout (5s)')), 5000)),
    ]);
    log('INFO', '[copilot/agent] CLI conectado — ping OK.');
} catch (/** @type {any} */ e) {
    log('WARN', `[copilot/agent] CLI não respondeu ao ping no boot: ${e.message}`);
    // Continuar de qualquer forma — startWithRetry() tratará a falha
}

void startWithRetry();
