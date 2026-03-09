// @ts-check
import { log as internalLog } from '#core/logger';
import * as PATHS from '#infra/fs/paths';
import { notify } from '#server/engine/socket';
import fs, { promises as fsp } from 'node:fs';
import path from 'node:path';

/**
 * Localização física do alvo de streaming.
 */
const LOG_FILE = path.join(PATHS.LOGS, 'agente_current.log');

/**
 * Estado operacional do motor de streaming.
 */
/** @type {any} */
let logWatcher = null;
let logReadActive = false;
/** @type {any} */
let retryTimeout = null;

/**
 * Inicializa o motor de streaming de logs. Implementa vigilância de Inode para suportar a troca física de arquivos
 * (Rotação).
 *
 * @returns {void}
 */
function init() {
    // 1. Limpeza de estado anterior (Idempotência de Boot)
    _clearInternalResources();

    // 2. Verificação de Existência Física
    // Se o Maestro ainda não criou o log, entra em modo de espera progressiva.
    fsp.access(LOG_FILE)
        .then(() => {
            try {
                /**
                 * fs.watch: Monitoramento de baixo nível via Kernel do SO. Detecta mudanças de conteúdo (change) e de
                 * referência física (rename).
                 */
                logWatcher = fs.watch(LOG_FILE, (event) => {
                    if (event === 'rename') {
                        /**
                         * ROTAÇÃO DETECTADA: O handle atual tornou-se inválido (o arquivo foi movido para backup).
                         * Reiniciamos o motor para capturar o novo arquivo que será criado.
                         */
                        internalLog('DEBUG', '[LOG_TAIL] Inode alterado (Rotação). Re-anexando handle...');
                        retryTimeout = setTimeout(init, 1000);
                        return;
                    }

                    if (event === 'change' && !logReadActive) {
                        // Conteúdo adicionado. Dispara leitura incremental do final do arquivo.
                        void _streamLastChunk();
                    }
                });

                internalLog('INFO', '[LOG_TAIL] Streaming de telemetria textual ativo.');
            } catch (/** @type {any} */ err) {
                const _e = /** @type {any} */ (err);
                internalLog(
                    'ERROR',
                    `[LOG_TAIL] Falha catastrófica no watcher: ${err && _e.message ? _e.message : String(_e)}`,
                );
                retryTimeout = setTimeout(init, 10000);
            }
        })
        .catch(() => {
            internalLog('DEBUG', '[LOG_TAIL] Alvo ausente. Aguardando inicialização do Maestro...');
            retryTimeout = setTimeout(init, 5000);
        });
}

/**
 * Lê o fragmento final do arquivo (Tail) e transmite via barramento Socket.io. Implementa trava de concorrência para
 * proteger a estabilidade do processo.
 */
async function _streamLastChunk() {
    logReadActive = true;

    try {
        const stats = await fsp.stat(LOG_FILE);

        /**
         * Lógica de Janela Deslizante: Lemos apenas os últimos 2KB de dados. Isso garante performance instantânea mesmo
         * que o arquivo de log tenha centenas de megabytes.
         */
        const bufferSize = 2048;
        const start = Math.max(0, stats.size - bufferSize);

        const stream = fs.createReadStream(LOG_FILE, {
            start,
            encoding: 'utf-8',
            highWaterMark: bufferSize,
        });

        stream.on('data', (chunk) => {
            // Transmite o fragmento para o barramento soberano
            notify('log_stream', chunk.toString());
        });

        const release = () => {
            logReadActive = false;
        };

        stream.on('end', release);
        stream.on('close', release);
        stream.on('error', (err) => {
            internalLog('ERROR', `[LOG_TAIL] Erro no stream de leitura: ${err.message}`);
            release();
        });
    } catch (/** @type {any} */ e) {
        logReadActive = false;
    }
}

/**
 * Libera recursos e handles do Sistema Operacional.
 */
function _clearInternalResources() {
    if (logWatcher) {
        try {
            logWatcher.close();
        } catch (/** @type {any} */ e) {
            /* Ignore watcher close errors */
        }
        logWatcher = null;
    }
    if (retryTimeout) {
        clearTimeout(retryTimeout);
        retryTimeout = null;
    }
}

/**
 * Encerramento atômico do streamer. Chamado pelo orquestrador de ciclo de vida (lifecycle.js).
 *
 * @returns {void}
 */
function stop() {
    _clearInternalResources();
    logReadActive = false;
    internalLog('INFO', '[LOG_TAIL] Motor de streaming encerrado.');
}

export { init, stop };
