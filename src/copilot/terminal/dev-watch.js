// @ts-check
/**
 * src/copilot/terminal/dev-watch.js
 *
 * Watcher seletivo de ficheiros para modo dev/supervisionado.
 *
 * Ao detectar mudanças em `src/copilot/**`, aciona graceful shutdown via `runShutdown('dev_watch_reload')` e
 * `process.exit(0)`. O supervisor (PM2, VS Code, node --watch) reinicia o processo com módulos ESM recarregados.
 *
 * Activação: `COPILOT_DEV_WATCH=true`. Em produção sem essa variável, `startDevWatch()` é no-op.
 *
 * **Coexistência com `node --watch`**: `node --watch` envia SIGTERM → nosso handler de bootstrap captura →
 * `runShutdown('SIGTERM')` → `process.exit(0)`. O in-process watcher é no-op nesse cenário pois o processo sai antes
 * do debounce terminar. Sem conflito.
 *
 * @module copilot/terminal/dev-watch
 */

import { watch as fsWatch } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SHUTDOWN_PRIORITY } from '../core/shutdown-priorities.js';
import { registerShutdownHandler, runShutdown } from '../core/shutdown.js';
import { log } from '../observability/logger.js';

/**
 * Directório raiz do módulo copilot (`src/copilot/`), calculado em tempo de carregamento do módulo.
 *
 * @type {string}
 */
const _COPILOT_SRC_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * @typedef {{
 *     enabled?: boolean;
 *     watchPath?: string;
 *     debounceMs?: number;
 * }} DevWatchOptions
 */

/**
 * Inicia o watcher seletivo de ficheiros para detecção de mudanças em `src/copilot/`.
 *
 * Deve ser chamado após o boot ter completado (i.e., no `.then()` de `bootCopilot`). No-op quando
 * `COPILOT_DEV_WATCH != 'true'` e `enabled` não for fornecido explicitamente.
 *
 * Regista um handler de shutdown (`dev-watch-cleanup`) que fecha o watcher antes do processo terminar,
 * prevenindo file descriptors pendentes.
 *
 * @param {DevWatchOptions} [opts]
 * @returns {void}
 */
export function startDevWatch(opts = {}) {
    const enabled = opts.enabled ?? _isDevWatchEnabled();
    if (!enabled) return;

    const watchPath = opts.watchPath ?? _COPILOT_SRC_DIR;
    const debounceMs = typeof opts.debounceMs === 'number' && opts.debounceMs >= 0 ? opts.debounceMs : 500;

    log('INFO', `[dev-watch] Watcher activo em "${watchPath}" (debounce=${debounceMs}ms)`);

    /** @type {ReturnType<typeof setTimeout> | null} */
    let debounceTimer = null;
    /** @type {boolean} */
    let triggered = false;

    const watcher = fsWatch(watchPath, { recursive: true }, (eventType, filename) => {
        if (triggered) return;
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
            if (triggered) return;
            triggered = true;
            log(
                'INFO',
                `[dev-watch] Mudança detectada (${eventType}: ${String(filename ?? 'unknown')}) — iniciando graceful restart.`,
            );
            runShutdown('dev_watch_reload')
                .catch(() => {})
                .finally(() => process.exit(0));
        }, debounceMs);
    });

    watcher.on('error', (/** @type {Error} */ err) => {
        log('WARN', `[dev-watch] Watcher erro: ${err instanceof Error ? err.message : String(err)}`);
    });

    registerShutdownHandler(
        'dev-watch-cleanup',
        async () => {
            if (debounceTimer) clearTimeout(debounceTimer);
            watcher.close();
            log('DEBUG', '[dev-watch] Watcher fechado.');
        },
        SHUTDOWN_PRIORITY.DEFAULT,
    );
}

/**
 * Retorna `true` se `COPILOT_DEV_WATCH=true` está definido no ambiente.
 *
 * @returns {boolean}
 */
function _isDevWatchEnabled() {
    return process.env['COPILOT_DEV_WATCH'] === 'true';
}
