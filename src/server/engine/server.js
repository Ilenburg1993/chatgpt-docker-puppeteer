// @ts-check - Type checking rigoroso habilitado (arquivo core)
import { log } from '#core/logger';
import http from 'node:http';
import app from './app.js';

/** @type {import('http').Server|null} */
let httpServer = null;

/* ---------------------------------------------------------------------------
   CONFIGURAÇÃO DE BIND
--------------------------------------------------------------------------- */

/**
 * Host de bind.
 * Default seguro para container: 0.0.0.0
 * Pode ser sobrescrito via ENV em cenários especiais.
 */
const HOST = process.env.HOST || '0.0.0.0';

/**
 * Limite máximo de escalonamento de porta.
 * Evita subir fora da faixa forwardada do devcontainer.
 */
const MAX_PORT_OFFSET = Number.parseInt(
    process.env.PORT_HUNT_LIMIT || '5',
    10
);

/* ---------------------------------------------------------------------------
   START — BOOT DO SERVIDOR HTTP
--------------------------------------------------------------------------- */

/**
 * Inicia servidor HTTP com bind explícito e port hunting controlado.
 *
 * Regras:
 *   — tenta porta base
 *   — se ocupada → porta+1
 *   — limitado por MAX_PORT_OFFSET
 *   — falha determinística se faixa esgotar
 *
 * @param {number} port - Porta base para bind
 * @param {number} [attempt=0] - Tentativa interna (port hunting)
 * @returns {Promise<{server: import('http').Server, port: number}>} - Servidor HTTP e porta efetiva
 * @throws {Error} - Se nenhuma porta estiver disponível na faixa
 * @sideEffects - Inicia servidor HTTP, registra listeners, log de inicialização
 */
function start(port, attempt = 0) {
    return new Promise((resolve, reject) => {

        if (attempt > MAX_PORT_OFFSET) {
            return reject(
                new Error(
                    `[ENGINE] Nenhuma porta livre em ${port}-${port + MAX_PORT_OFFSET}`
                )
            );
        }

        httpServer = http.createServer(app);

        // Configure HTTP server timeouts (prevent hanging connections)
        const requestTimeout = Number(process.env.SERVER_REQUEST_TIMEOUT || 120000);
        httpServer.setTimeout(requestTimeout);

        log.error(`[Server] Request timeout set to ${requestTimeout}ms`);

        httpServer.listen(port, HOST, () => {

            log('INFO', `[ENGINE] HTTP bound ${HOST}:${port}`);

            // Mensagem humana — endereço real depende do forwarding
            log.info(`\n🚀 MISSION CONTROL PRIME ONLINE`);
            log.info(`🔗 http://localhost:${port}\n`);

            resolve({ server: httpServer, port });
        });

        httpServer.on('error', err => {

            if (err.code === 'EADDRINUSE') {

                const nextPort = port + 1;

                log(
                    'WARN',
                    `[ENGINE] Porta ${port} ocupada → ${nextPort} (${attempt + 1}/${MAX_PORT_OFFSET})`
                );

                try {
                    httpServer.close();
                } catch (errClose) {
                    log(
                        'DEBUG',
                        `[ENGINE] httpServer.close() failed: ${errClose && errClose.message ? errClose.message : String(errClose)}`
                    );
                }
                httpServer = null;

                resolve(start(nextPort, attempt + 1));
                return;
            }

            log('FATAL', `[ENGINE] Bind falhou: ${err.message}`);
            reject(err);
        });
    });
}

/* ---------------------------------------------------------------------------
   STOP — SHUTDOWN LIMPO
--------------------------------------------------------------------------- */

/**
 * Encerra servidor HTTP e libera porta.
 * Operação idempotente com timeout para force-close.
 *
 * @param {number} [gracefulTimeout=30000] - Timeout em ms para esperar conexões fecharem
 * @returns {Promise<void>}
 * @throws {Error} - Se shutdown falhar após timeout
 * @sideEffects - Fecha servidor HTTP, notifica Socket.IO, limpa estado global
 */
async function stop(gracefulTimeout = 30000) {
    log('INFO', `[ENGINE] Iniciando shutdown gracioso (timeout: ${gracefulTimeout}ms)...`);

    // Notificar clientes Socket.IO sobre shutdown iminente
    try {
        const { notifyShutdown } = await import('./socket.js');
        if (typeof notifyShutdown === 'function') {
            notifyShutdown(gracefulTimeout);
        }
    } catch (err) {
        // Socket.IO pode não estar inicializado
        log('DEBUG', '[ENGINE] Socket.IO shutdown notification skipped (not initialized)');
    }

    return new Promise((resolve, reject) => {
        if (!httpServer || !httpServer.listening) {
            log('INFO', '[ENGINE] Servidor já encerrado.');
            httpServer = null;
            resolve();
            return;
        }

        // Timeout para force-close
        const forceTimeout = setTimeout(() => {
            log('WARN', `[ENGINE] Forçando shutdown após ${gracefulTimeout}ms...`);

            // Force close all active connections (Node.js 18.2+)
            if (typeof httpServer.closeAllConnections === 'function') {
                httpServer.closeAllConnections();
                log('INFO', '[ENGINE] Todas conexões forçadamente fechadas.');
            } else {
                log('WARN', '[ENGINE] closeAllConnections() não disponível (Node.js < 18.2)');
            }

            // Resolve anyway (force completion)
            httpServer = null;
            resolve();
        }, gracefulTimeout);

        // Graceful close
        httpServer.close((err) => {
            clearTimeout(forceTimeout);

            if (err) {
                log('ERROR', `[ENGINE] Erro durante shutdown: ${err.message}`);
                httpServer = null;
                reject(err);
            } else {
                log('INFO', '[ENGINE] HTTP encerrado graciosamente.');
                httpServer = null;
                resolve();
            }
        });
    });
}

/* ---------------------------------------------------------------------------
   ACESSO CONTROLADO — RAW SERVER
--------------------------------------------------------------------------- */

/**
 * Retorna instância HTTP bruta para camadas de transporte.
 * Somente leitura — não alterar lifecycle externamente.
 *
 * @returns {import('http').Server|null} - Instância HTTP ou null se não inicializado
 */
function getRawServer() {
    return httpServer;
}

export { getRawServer, start, stop };
