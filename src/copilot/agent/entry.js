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
 * Inicializa o agente com loop de retry (até 5 tentativas) em vez de recursão.
 *
 * @returns {Promise<void>}
 */
async function startWithRetry() {
    const MAX_ATTEMPTS = 5;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        try {
            log('INFO', `[copilot/agent] Iniciando Always-Alive Agent (tentativa ${attempt})...`);
            await alwaysAliveAgent.start();
            log('INFO', '[copilot/agent] Agente ativo e aguardando mensagens via HTTP bridge.');
            return;
        } catch (/** @type {any} */ e) {
            log('ERROR', `[copilot/agent] Falha ao iniciar (tentativa ${attempt}): ${e.message}`);
            if (attempt < MAX_ATTEMPTS) {
                log('INFO', `[copilot/agent] Tentando novamente em ${RESTART_DELAY_MS}ms...`);
                await new Promise((r) => setTimeout(r, RESTART_DELAY_MS));
            } else {
                log('ERROR', '[copilot/agent] Máximo de tentativas atingido. Encerrando processo.');
                process.exitCode = 1;
                process.exit(1);
            }
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

// BUG-AA-09 (fix): session.fatal indica que a sessão está irrecuperável. Sem este handler,
// o processo continua vivo sem sessão ativa (zumbi). PM2 reinicia imediatamente após o exit.
alwaysAliveAgent.on('session.fatal', (/** @type {any} */ evt) => {
    const reason = evt?.reason ?? evt?.message ?? 'desconhecido';
    log('ERROR', `[copilot/agent] session.fatal recebido — encerrando processo: ${reason}`);
    process.exitCode = 1;
    process.exit(1);
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
    // LEAK-01 (fix): parar pingClient após uso para evitar conexão TCP persistente
    pingClient.stop().catch(() => {});
} catch (/** @type {any} */ e) {
    log('WARN', `[copilot/agent] CLI não respondeu ao ping no boot: ${e.message}`);
    // Continuar de qualquer forma — startWithRetry() tratará a falha
}

// RF-051: salvar Promise para garantir que erros de rejeição não fiquem silenciosos
const _startPromise = startWithRetry();
_startPromise.catch((/** @type {any} */ e) => {
    log('ERROR', `[copilot/agent] startWithRetry() rejeitou: ${e.message}`);
    process.exitCode = 1;
});
