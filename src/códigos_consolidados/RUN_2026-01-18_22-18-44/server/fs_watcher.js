FILE_ORIGINAL: D:\chatgpt-docker-puppeteer\src\server\watchers\fs_watcher.js
PASTA_BASE: server
DATA_DA_EXTRACAO: 2026-01-18 22:18:44
--------------------------------------------------------------------------------

/* ==========================================================================
   src/server/watchers/fs_watcher.js
   Audit Level: 600 — Filesystem Sensor (IPC 2.0 Singularity)
   Status: CONSOLIDATED (Protocol 11 - Zero-Bug Tolerance)

   RESPONSABILIDADE CANÔNICA:
     - Atuar como SENSOR FÍSICO do filesystem (Fila de Tarefas).
     - Detectar indícios de mudança (nível de Inode/Escrita).
     - Sinalizar barramentos de dados (UI / Maestro / Cache).
     
   PROIBIÇÕES EXPLÍCITAS (Protocolo de Desacoplamento):
     ❌ Não aplicar lógica de cache ou interpretação de JSON.
     ❌ Não aplicar debounce ou janelas temporais.
     ❌ Não inferir consistência de dados.

   Toda autoridade de consolidação temporal e semântica pertence 
   exclusivamente ao sistema de infraestrutura (cache.js).
========================================================================== */

const fs = require('fs');
const io = require('../../infra/io');
const { notify, notifyAgent } = require('../engine/socket');
const { log } = require('../../core/logger');

/**
 * Instância ativa do watcher do SO.
 */
let fsWatcher = null;

/**
 * Blindagem contra reentrância síncrona acidental.
 */
let signaling = false;

/**
 * Inicializa o sensor de filesystem da fila.
 * Monitora a pasta física definida na Fachada de IO.
 */
function init() {
    if (fsWatcher) return;

    const queuePath = io.QUEUE_DIR;

    // Garantia de Infraestrutura: O sensor exige a existência física do alvo
    if (!fs.existsSync(queuePath)) {
        log('WARN', `[FS_WATCHER] Alvo ausente: ${queuePath}. Tentando restauração...`);
        try {
            fs.mkdirSync(queuePath, { recursive: true });
        } catch (e) {
            log('ERROR', `[FS_WATCHER] Falha crítica ao preparar alvo: ${e.message}`);
            return;
        }
    }

    log('INFO', '[FS_WATCHER] Sensor de filesystem da fila em prontidão.');

    try {
        /**
         * fs.watch: Utiliza notificações nativas do kernel do SO (inotify/fsevents).
         */
        fsWatcher = fs.watch(queuePath, (event, filename) => {
            // Filtra cirurgicamente apenas arquivos de intenção (.json)
            if (filename && filename.endsWith('.json')) {
                _signalChange();
            }
        });
    } catch (e) {
        log('ERROR', `[FS_WATCHER] Falha ao acoplar sensor ao SO: ${e.message}`);
    }
}

/**
 * Propaga o sinal de mudança para a malha de comunicação.
 * NÃO executa lógica. Apenas sinaliza indícios.
 */
function _signalChange() {
    if (signaling) return;
    signaling = true;

    try {
        // 1. Invalida o cache na infraestrutura (Consistência Eventual)
        io.setCacheDirty();

        // 2. Notifica a Interface do Usuário (Dashboard)
        notify('update');

        // 3. Notifica o Motor de Execução via barramento IPC 2.0
        // Isso permite que o Maestro acorde imediatamente para novas tarefas
        notifyAgent('cache_dirty');

        log('DEBUG', '[FS_WATCHER] Indício de mudança propagado para a malha.');
    } finally {
        signaling = false;
    }
}

/**
 * Encerramento limpo do sensor.
 * Chamado pelo orquestrador de ciclo de vida (lifecycle.js).
 */
function stop() {
    if (fsWatcher) {
        fsWatcher.close();
        fsWatcher = null;
        log('INFO', '[FS_WATCHER] Sensor de filesystem desativado.');
    }
}

module.exports = {
    init,
    stop
};