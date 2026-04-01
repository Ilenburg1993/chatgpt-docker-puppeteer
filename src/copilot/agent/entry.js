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

const RESTART_DELAY_MS = parseInt(process.env['COPILOT_RESTART_DELAY_MS'] ?? '5000', 10);

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

// ─── IPC básico (G1-API-03) ───────────────────────────────────────────────────
// Permite que o processo pai (PM2 / scripts de controle) envie comandos via IPC.
// Comandos suportados: { cmd: 'ping' }, { cmd: 'status' }, { cmd: 'stop' }.
if (process.send) {
    process.on('message', (/** @type {any} */ msg) => {
        const cmd = msg?.cmd;
        if (cmd === 'ping') {
            process.send?.({ ok: true, pong: true });
        } else if (cmd === 'status') {
            process.send?.({ ok: true, status: alwaysAliveAgent.status });
        } else if (cmd === 'stop') {
            log('INFO', '[copilot/agent] IPC stop recebido — encerrando...');
            shutdown('IPC:stop').catch(() => {});
        } else {
            process.send?.({ ok: false, error: `Comando desconhecido: ${cmd}` });
        }
    });
}

// Logar status periódico (evita PM2 matar o processo por inatividade)
alwaysAliveAgent.on('status', (status) => {
    log('INFO', `[copilot/agent] Status: ${status}`);
});

alwaysAliveAgent.on('error', (err) => {
    log('ERROR', `[copilot/agent] Erro do agente: ${err.message}`);
});

// `session.fatal` indica que a sessão está irrecuperável. Encerrar o processo permite ao PM2 reiniciar imediatamente.
alwaysAliveAgent.on('session.fatal', (/** @type {any} */ evt) => {
    const reason = evt?.reason ?? evt?.message ?? 'desconhecido';
    log('ERROR', `[copilot/agent] session.fatal recebido — encerrando processo: ${reason}`);
    process.exitCode = 1;
    process.exit(1);
});

// ─── Bootstrap ───────────────────────────────────────────────────────────────

// Verifica conectividade do CLI antes do primeiro start para falhar rápido em caso de indisponibilidade.
try {
    const pingClient = new CopilotClient();
    await Promise.race([
        pingClient.ping(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Ping timeout (5s)')), 5000)),
    ]);
    log('INFO', '[copilot/agent] CLI conectado — ping OK.');
    // Para o cliente de ping após uso para evitar conexão TCP persistente desnecessaria.
    pingClient.stop().catch(() => {});
} catch (/** @type {any} */ e) {
    log('WARN', `[copilot/agent] CLI não respondeu ao ping no boot: ${e.message}`);
    // Continuar de qualquer forma — startWithRetry() tratará a falha
}

// Valida COPILOT_MODEL proativamente — falha rápida em modelo inválido antes do start.
if (process.env['COPILOT_MODEL']) {
    try {
        const { listModels } = await import('../lib/models.js');
        const models = await listModels();
        const valid = models.some((/** @type {{ id: string }} */ m) => m.id === process.env['COPILOT_MODEL']);
        if (!valid) {
            log(
                'WARN',
                `[copilot/agent] Modelo '${process.env['COPILOT_MODEL']}' não encontrado na lista de modelos disponíveis. Verifique COPILOT_MODEL.`,
            );
        } else {
            log('INFO', `[copilot/agent] Modelo '${process.env['COPILOT_MODEL']}' validado na lista de modelos.`);
        }
    } catch {
        /* não crítico — continuar sem validação */
    }
}

// Captura Promise para garantir que rejeições assíncronas não fiquem silenciosas.
const _startPromise = startWithRetry();
_startPromise.catch((/** @type {any} */ e) => {
    log('ERROR', `[copilot/agent] startWithRetry() rejeitou: ${e.message}`);
    process.exitCode = 1;
});
