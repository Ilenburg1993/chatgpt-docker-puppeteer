/* ==========================================================================
   src/server/watchers/log_watcher.js
   Audit Level: 600 — Log Integrity Watcher (Singularity Edition)
   Status: CONSOLIDATED (Protocol 11 - Zero-Bug Tolerance)
   Responsabilidade: Monitorar a saúde física e a existência do log operacional.
                     Garante a re-anexação do watcher em eventos de rotação.
   Sincronizado com: logger.js V40, log_tail.js V600, lifecycle.js V600.
========================================================================== */

const fs = require('fs');
const path = require('path');
const { LOG_DIR, log } = require('@core/logger');

/**
 * Caminho absoluto do alvo de vigilância.
 */
const LOG_FILE = path.join(LOG_DIR, 'agente_current.log');

/**
 * Estado interno do observador.
 */
let watcher = null;
let reconnectTimeout = null;

/**
 * Inicializa o monitoramento de integridade do log.
 * Focado em resiliência de sistema de arquivos e persistência de handle.
 */
function init() {
    // 1. Prevenção de Duplicidade: Limpa recursos antes de iniciar
    stop();

    // 2. Verificação de Existência Física (Pre-flight Check)
    if (!fs.existsSync(LOG_FILE)) {
        log('WARN', '[LOG_WATCHER] Arquivo de log ausente. Aguardando criação pelo Maestro...');
        _scheduleReconnect(5000); // Tenta novamente em 5s
        return;
    }

    try {
        log('INFO', '[LOG_WATCHER] Vigilância de integridade do log operacional ativa.');

        /**
         * fs.watch: Monitora mudanças no diretório/arquivo via Kernel do SO.
         * No Windows, o evento 'rename' é disparado quando o Logger rotaciona o arquivo.
         */
        watcher = fs.watch(LOG_FILE, event => {
            if (event === 'rename') {
                /**
                 * ROTAÇÃO DETECTADA:
                 * O handle atual tornou-se inválido. Precisamos descartar o
                 * watcher e aguardar o novo arquivo ser estabilizado no disco.
                 */
                log('DEBUG', '[LOG_WATCHER] Inode alterado (Rotação). Re-sincronizando...');
                _handleRotation();
            }
        });

        // Captura falhas no nível do driver de eventos do Sistema Operacional
        watcher.on('error', err => {
            log('ERROR', `[LOG_WATCHER] Falha no driver de observação: ${err.message}`);
            _handleRotation();
        });
    } catch (e) {
        log('ERROR', `[LOG_WATCHER] Erro ao acessar descritor de arquivo: ${e.message}`);
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
        init();
    }, ms);
}

/**
 * Encerramento gracioso do observador e limpeza de timers.
 * Chamado pelo orquestrador de ciclo de vida (lifecycle.js).
 */
function stop() {
    if (watcher) {
        try {
            watcher.close();
        } catch (_e) {
            // Falha ao fechar watcher já inválido é ignorada
        }
        watcher = null;
    }

    if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
        reconnectTimeout = null;
    }
}

module.exports = {
    init,
    stop
};
