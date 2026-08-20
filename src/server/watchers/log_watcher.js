// @ts-check
import { LOG_DIR, log } from '#core/logger';
import fs, { promises as fsp } from 'node:fs';
import path from 'node:path';

/**
 * Caminho absoluto do alvo de vigilância.
 */
const LOG_FILE = path.join(LOG_DIR, 'agente_current.log');

/**
 * Estado interno do observador.
 */
/** @type {any} */
let watcher = null;
/** @type {any} */
let reconnectTimeout = null;

/**
 * Inicializa o monitoramento de integridade do log. Focado em resiliência de sistema de arquivos e persistência de
 * handle.
 *
 * @returns {Promise<void>}
 */
async function init() {
    // 1. Prevenção de Duplicidade: Limpa recursos antes de iniciar
    stop();

    // 2. Verificação de Existência Física (Pre-flight Check)
    try {
        await fsp.access(LOG_FILE);
    } catch (/** @type {any} */ e) {
        log('WARN', '[LOG_WATCHER] Arquivo de log ausente. Aguardando criação pelo Maestro...');
        _scheduleReconnect(5000); // Tenta novamente em 5s
        return;
    }

    try {
        log('INFO', '[LOG_WATCHER] Vigilância de integridade do log operacional ativa.');

        /**
         * fs.watch: Monitora mudanças no diretório/arquivo via Kernel do SO. No Windows, o evento 'rename' é disparado
         * quando o Logger rotaciona o arquivo.
         */
        watcher = fs.watch(LOG_FILE, (event) => {
            if (event === 'rename') {
                /**
                 * ROTAÇÃO DETECTADA: O handle atual tornou-se inválido. Precisamos descartar o watcher e aguardar o
                 * novo arquivo ser estabilizado no disco.
                 */
                log('DEBUG', '[LOG_WATCHER] Inode alterado (Rotação). Re-sincronizando...');
                _handleRotation();
            }
        });

        // Captura falhas no nível do driver de eventos do Sistema Operacional
        watcher.on('error', (/** @type {any} */ err) => {
            log('ERROR', `[LOG_WATCHER] Falha no driver de observação: ${err.message}`);
            _handleRotation();
        });
    } catch (/** @type {any} */ e) {
        const _e = /** @type {any} */ (e);
        log('ERROR', `[LOG_WATCHER] Erro ao acessar descritor de arquivo: ${_e.message}`);
        _scheduleReconnect(10000); // Backoff de 10s para erros graves de I/O
    }
}

/**
 * Gerencia a perda de referência física do arquivo (Mecânica de Rotação).
 */
function _handleRotation() {
    stop();
    // Delay de 1s: Janela de segurança para o SO concluir a escrita do novo arquivo
    _scheduleReconnect(1000);
}

/**
 * Agenda uma tentativa de reinicialização do observador.
 *
 * @param {number} ms - Tempo de espera em milissegundos.
 */
function _scheduleReconnect(ms) {
    if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
    }
    reconnectTimeout = setTimeout(() => {
        void init();
    }, ms);
}

/**
 * Encerramento gracioso do observador e limpeza de timers. Chamado pelo orquestrador de ciclo de vida (lifecycle.js).
 *
 * @returns {void}
 */
function stop() {
    if (watcher) {
        try {
            watcher.close();
        } catch (/** @type {any} */ err) {
            const _e = /** @type {any} */ (err);
            // Falha ao fechar watcher já inválido — registra debug e segue
            log('DEBUG', `[LOG_WATCHER] watcher.close failed: ${err && _e.message ? _e.message : String(_e)}`);
        }
        watcher = null;
    }

    if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
        reconnectTimeout = null;
    }
}

export { init, stop };
