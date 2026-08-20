// @ts-check
import { log } from '#core/logger';
import * as io from '#infra/io';
import { notify, notifyAgent } from '#server/engine/socket';
import fs, { promises as fsp } from 'node:fs';

/**
 * Instância ativa do watcher do SO.
 */
/** @type {any} */
let fsWatcher = null;

/**
 * Blindagem contra reentrância síncrona acidental.
 */
let signaling = false;

/**
 * Timer para debounce de eventos do filesystem.
 */
/** @type {any} */
let debounceTimer = null;

/**
 * Inicializa o sensor de filesystem da fila. Monitora a pasta física definida na Fachada de IO.
 *
 * @returns {void}
 */
function init() {
    if (fsWatcher) {
        return;
    }

    const queuePath = io.QUEUE_DIR;

    // Garantia de Infraestrutura: O sensor exige a existência física do alvo
    void (async () => {
        try {
            await fsp.access(queuePath);
        } catch (/** @type {any} */ e) {

            log('WARN', `[FS_WATCHER] Alvo ausente: ${queuePath}. Tentando restauração...`);
            try {
                await fsp.mkdir(queuePath, { recursive: true });
            } catch (/** @type {any} */ err) {
                const _e = /** @type {any} */ (err);
                log('ERROR', `[FS_WATCHER] Falha crítica ao preparar alvo: ${_e.message}`);
                return;
            }
        }

        log('INFO', '[FS_WATCHER] Sensor de filesystem da fila em prontidão.');

        try {
            /**
             * fs.watch: Utiliza notificações nativas do kernel do SO (inotify/fsevents).
             */
            fsWatcher = fs.watch(queuePath, (_event, filename) => {
                // Filtra cirurgicamente apenas arquivos de intenção (.json)
                if (filename && filename.endsWith('.json')) {
                    // P1.2: Debounce de 100ms para prevenir múltiplos eventos da mesma mudança
                    clearTimeout(debounceTimer);
                    debounceTimer = setTimeout(() => {
                        _signalChange();
                    }, 100);
                }
            });
        } catch (/** @type {any} */ e) {
            const _e = /** @type {any} */ (e);
            log('ERROR', `[FS_WATCHER] Falha ao acoplar sensor ao SO: ${_e.message}`);
        }
    })();
}

/**
 * Propaga o sinal de mudança para a malha de comunicação. NÃO executa lógica. Apenas sinaliza indícios.
 */
function _signalChange() {
    if (signaling) {
        return;
    }
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
 * Encerramento limpo do sensor. Chamado pelo orquestrador de ciclo de vida (lifecycle.js).
 *
 * @returns {void}
 */
function stop() {
    // B006: cancela debounce pendente para evitar _signalChange() após shutdown
    if (debounceTimer) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
    }
    if (fsWatcher) {
        fsWatcher.close();
        fsWatcher = null;
        log('INFO', '[FS_WATCHER] Sensor de filesystem desativado.');
    }
}

export { init, stop };
