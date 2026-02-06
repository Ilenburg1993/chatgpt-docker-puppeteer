import http from 'node:http';
import app from './app.js';
import { log } from '#core/logger';

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
 * @param {number} port Porta base
 * @param {number} attempt Tentativa interna
 * @returns {Promise<{server: import('http').Server, port: number}>}
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

        httpServer.listen(port, HOST, () => {

            log('INFO', `[ENGINE] HTTP bound ${HOST}:${port}`);

            // Mensagem humana — endereço real depende do forwarding
            console.log(`\n🚀 MISSION CONTROL PRIME ONLINE`);
            console.log(`🔗 http://localhost:${port}\n`);

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
 * Operação idempotente.
 *
 * @returns {Promise<void>}
 */
async function stop() {
    return new Promise(resolve => {

        if (httpServer && httpServer.listening) {
            httpServer.close(() => {
                log('INFO', '[ENGINE] HTTP encerrado.');
                httpServer = null;
                resolve();
            });
        } else {
            httpServer = null;
            resolve();
        }
    });
}

/* ---------------------------------------------------------------------------
   ACESSO CONTROLADO — RAW SERVER
--------------------------------------------------------------------------- */

/**
 * Retorna instância HTTP bruta para camadas de transporte.
 * Somente leitura — não alterar lifecycle externamente.
 */
function getRawServer() {
    return httpServer;
}

export { start, stop, getRawServer };
