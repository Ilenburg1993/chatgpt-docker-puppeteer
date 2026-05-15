// @ts-check
/**
 * src/copilot/terminal/dev-watch.js
 *
 * Monitor passivo de mudanças em `src/copilot/**` para uso em sessões de longa duração.
 *
 * **Modo padrão: `notify`** — detecta e acumula mudanças, loga, mas NÃO reinicia o processo.
 * O reinício automático destruiria a sessão de chat ativa. O utilizador controla o momento
 * certo via ferramenta `reload_agent_process`.
 *
 * **Modo `auto`** — reinicia automaticamente. Só é seguro com supervisor externo (PM2, node --watch)
 * em contextos onde a sessão de chat é descartável (pipelines, testes isolados). Activado por
 * `COPILOT_DEV_WATCH=auto`.
 *
 * Activação:
 *   - `COPILOT_DEV_WATCH=true` ou `COPILOT_DEV_WATCH=notify` → modo notify
 *   - `COPILOT_DEV_WATCH=auto`  → modo auto-restart (⚠️  quebra chat activo)
 *
 * @module copilot/terminal/dev-watch
 */

import { watch as fsWatch } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SHUTDOWN_PRIORITY } from '../core/shutdown-priorities.js';
import { isShuttingDown, registerShutdownHandler, runShutdown } from '../core/shutdown.js';
import { log } from '../observability/logger.js';

/**
 * Directório raiz do módulo copilot (`src/copilot/`), calculado em tempo de carregamento.
 *
 * @type {string}
 */
const _COPILOT_SRC_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * @typedef {'notify' | 'auto'} DevWatchMode
 *
 * @typedef {{
 *     mode?: DevWatchMode;
 *     watchPath?: string;
 *     debounceMs?: number;
 * }} DevWatchOptions
 *
 * @typedef {{
 *     active: boolean;
 *     mode: DevWatchMode;
 *     watchPath: string;
 *     changedFiles: string[];
 *     changeCount: number;
 *     lastChangeAt: number | null;
 * }} DevWatchStatus
 */

/** @type {DevWatchStatus} */
const _status = {
    active: false,
    mode: 'notify',
    watchPath: _COPILOT_SRC_DIR,
    changedFiles: [],
    changeCount: 0,
    lastChangeAt: null,
};

/**
 * Retorna um snapshot do estado actual do watcher. Útil para introspection e `get_agent_info`.
 *
 * @returns {Readonly<DevWatchStatus>}
 */
export function getDevWatchStatus() {
    return Object.freeze({ ..._status, changedFiles: [..._status.changedFiles] });
}

/**
 * Inicia o monitor de ficheiros para `src/copilot/`.
 *
 * No-op quando `COPILOT_DEV_WATCH` não está definido e `opts.mode` não é fornecido.
 * Regista handler de cleanup no shutdown para fechar o watcher sem file descriptors pendentes.
 *
 * @param {DevWatchOptions} [opts]
 * @returns {void}
 */
export function startDevWatch(opts = {}) {
    const mode = opts.mode ?? _resolveMode();
    if (!mode) return;

    const watchPath = opts.watchPath ?? _COPILOT_SRC_DIR;
    const debounceMs = typeof opts.debounceMs === 'number' && opts.debounceMs >= 0 ? opts.debounceMs : 500;

    _status.active = true;
    _status.mode = mode;
    _status.watchPath = watchPath;

    log('INFO', `[dev-watch] Monitor activo em "${watchPath}" (mode=${mode}, debounce=${debounceMs}ms)`);

    if (mode === 'notify') {
        _startNotifyWatcher(watchPath, debounceMs);
    } else {
        _startAutoWatcher(watchPath, debounceMs);
    }
}

// ─── Internals ─────────────────────────────────────────────────────────────────────────────────

/**
 * Modo `notify`: detecta e acumula mudanças sem reiniciar.
 *
 * @param {string} watchPath
 * @param {number} debounceMs
 */
function _startNotifyWatcher(watchPath, debounceMs) {
    /** @type {Set<string>} */
    const pendingFiles = new Set();
    /** @type {ReturnType<typeof setTimeout> | null} */
    let debounceTimer = null;

    const watcher = fsWatch(watchPath, { recursive: true }, (_eventType, filename) => {
        if (isShuttingDown()) return;
        const rel = filename ? relative(watchPath, resolve(watchPath, String(filename))) : 'unknown';
        pendingFiles.add(rel);

        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
            const files = [...pendingFiles];
            pendingFiles.clear();
            _recordChanges(files, watchPath);
        }, debounceMs);
    });

    watcher.on('error', (/** @type {Error} */ err) => {
        log('WARN', `[dev-watch] Watcher erro: ${err instanceof Error ? err.message : String(err)}`);
    });

    _registerCleanup(() => {
        if (debounceTimer) clearTimeout(debounceTimer);
        watcher.close();
    });
}

/**
 * Modo `auto`: reinicia o processo após detecção (⚠️  quebra sessão de chat activa).
 *
 * @param {string} watchPath
 * @param {number} debounceMs
 */
function _startAutoWatcher(watchPath, debounceMs) {
    let triggered = false;
    /** @type {ReturnType<typeof setTimeout> | null} */
    let debounceTimer = null;

    log('WARN', '[dev-watch] Modo AUTO activo — mudanças em src/copilot/** reiniciarão o processo.');

    const watcher = fsWatch(watchPath, { recursive: true }, (eventType, filename) => {
        if (triggered || isShuttingDown()) return;
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
            if (triggered || isShuttingDown()) return;
            triggered = true;
            const rel = filename ? relative(watchPath, resolve(watchPath, String(filename))) : 'unknown';
            log('INFO', `[dev-watch] Mudança detectada (${eventType}: ${rel}) — graceful restart.`);
            runShutdown('dev_watch_reload')
                .catch(() => {})
                .finally(() => process.exit(0));
        }, debounceMs);
    });

    watcher.on('error', (/** @type {Error} */ err) => {
        log('WARN', `[dev-watch] Watcher erro: ${err instanceof Error ? err.message : String(err)}`);
    });

    _registerCleanup(() => {
        if (debounceTimer) clearTimeout(debounceTimer);
        watcher.close();
    });
}

/**
 * Regista mudanças no estado interno e loga resumo.
 *
 * @param {string[]} files
 * @param {string} watchPath
 */
function _recordChanges(files, watchPath) {
    _status.changeCount += files.length;
    _status.lastChangeAt = Date.now();

    for (const f of files) {
        if (!_status.changedFiles.includes(f)) {
            _status.changedFiles.push(f);
        }
    }

    log(
        'INFO',
        `[dev-watch] ${files.length} mudança(s) detectada(s) em "${watchPath}": ${files.slice(0, 5).join(', ')}` +
            (files.length > 5 ? ` (+${files.length - 5} mais)` : '') +
            `. Total desde boot: ${_status.changeCount}. Use reload_agent_process para aplicar.`,
    );
}

/**
 * Regista handler de cleanup do watcher no sistema de shutdown.
 *
 * @param {() => void} fn
 */
function _registerCleanup(fn) {
    registerShutdownHandler(
        'dev-watch-cleanup',
        async () => {
            fn();
            log('DEBUG', '[dev-watch] Watcher fechado.');
        },
        SHUTDOWN_PRIORITY.DEFAULT,
    );
}

/**
 * Resolve o modo a partir da variável de ambiente `COPILOT_DEV_WATCH`.
 *
 * @returns {DevWatchMode | null}
 */
function _resolveMode() {
    const val = process.env['COPILOT_DEV_WATCH'];
    if (!val) return null;
    if (val === 'auto') return 'auto';
    if (val === 'true' || val === 'notify') return 'notify';
    return null;
}
