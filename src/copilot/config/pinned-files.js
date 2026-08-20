// @ts-check
/**
 * src/copilot/config/pinned-files-loader.js
 *
 * Carrega e monitora arquivos de contexto "pinned" (fixados) para injeção automática em novas sessões. Usa fs.watch com
 * debounce para detectar mudanças em tempo real.
 *
 * @module copilot/config/pinned-files-loader
 * @see EventBus
 */

import {
    listDirectoryNamesFreshTrusted,
    readTextFreshTrusted,
    statPathTrusted,
    watchPathTrusted,
} from '#copilot/infra/public/trusted-io';
import { EventEmitter } from 'node:events';
import { join } from 'node:path';
import { logSwallowed, toError } from '../core/error-handlers.js';
import { log } from '../observability/logger.js';

const DEBOUNCE_MS = 500;
const SUPPORTED_EXTENSIONS = ['.md', '.txt', '.js', '.ts', '.json', '.yaml', '.yml'];

/**
 * @typedef {Object} PinnedFile
 * @property {string} path - Caminho absoluto do arquivo
 * @property {string} content - Conteúdo atual do arquivo
 * @property {number} loadedAt - Timestamp Unix do carregamento
 */

/**
 * @typedef {Object} PinnedFileChangedEvent
 * @property {string} file - Caminho absoluto do arquivo alterado
 * @property {string} content - Novo conteúdo
 * @property {'added' | 'changed' | 'removed'} type - Tipo de mudança
 */

/**
 * Carrega e monitora arquivos fixados para injeção de contexto em sessões. Emite evento `changed` quando qualquer
 * arquivo monitorado é modificado.
 *
 * @example
 *     const loader = new PinnedFilesLoader(['./context', './docs/pinned']);
 *     await loader.start();
 *     loader.on('changed', ({ file, content, type }) => console.log(file, type));
 *     const files = loader.getFiles();
 *
 * @fires PinnedFilesLoader#changed
 */
export class PinnedFilesLoader extends EventEmitter {
    /** @type {string[]} */
    #dirs;

    /** @type {Map<string, PinnedFile>} */
    #files = new Map();

    /** @type {Map<string, import('node:fs').FSWatcher>} */
    #watchers = new Map();

    /** @type {Map<string, ReturnType<typeof setTimeout>>} */
    #debounceTimers = new Map();

    /** @type {boolean} */
    #started = false;

    /**
     * @param {string[]} dirs - Diretórios a monitorar. Caminhos inexistentes são ignorados silenciosamente.
     */
    constructor(dirs) {
        super();
        this.#dirs = dirs.filter(Boolean);
    }

    /**
     * Inicializa o loader: carrega todos os arquivos existentes e inicia watchers.
     *
     * @returns {Promise<void>}
     */
    async start() {
        if (this.#started) return;
        this.#started = true;

        await Promise.all(this.#dirs.map((dir) => this.#loadDir(dir)));
        // F10.5: #startWatchers já silencia erros individuais via watcher.on('error'); o try/catch
        // aqui garante que falhas globais (ex: fs.watch não disponível) não bloqueiam o boot.
        try {
            await this.#startWatchers();
        } catch (err) {
            const msg = toError(err).message;
            log('WARN', `[PinnedFilesLoader] Watchers não iniciados (continuando sem hot-reload): ${msg}`);
        }
        log(
            'INFO',
            `[PinnedFilesLoader] Pronto — ${this.#files.size} arquivo(s) carregado(s) de ${this.#dirs.length} dir(s)`,
        );
    }

    /**
     * Para todos os watchers e libera recursos.
     *
     * @returns {void}
     */
    stop() {
        for (const watcher of this.#watchers.values()) watcher.close();
        for (const timer of this.#debounceTimers.values()) clearTimeout(timer);
        this.#watchers.clear();
        this.#debounceTimers.clear();
        this.#started = false;
    }

    /**
     * Retorna snapshot imutável dos arquivos carregados.
     *
     * @returns {PinnedFile[]}
     */
    getFiles() {
        return Array.from(this.#files.values());
    }

    /**
     * Retorna o conteúdo concatenado de todos os arquivos pinned, formatado para injeção.
     *
     * @returns {string}
     */
    buildContext() {
        const files = this.getFiles();
        if (files.length === 0) return '';
        return files
            .map(({ path, content }) => `<!-- pinned:${path} -->\n${content}\n<!-- /pinned:${path} -->`)
            .join('\n\n');
    }

    // ── Internos ──────────────────────────────────────────────────────────────

    /**
     * @param {string} dir
     * @returns {Promise<void>}
     */
    async #loadDir(dir) {
        let entries;
        try {
            entries = (await listDirectoryNamesFreshTrusted(dir, { caller: 'config.pinned-files' })).entries;
        } catch (e) {
            logSwallowed(e, 'config.pinnedFiles.readdir');
            return;
        }

        for (const entry of entries) {
            if (!SUPPORTED_EXTENSIONS.some((ext) => entry.endsWith(ext))) continue;
            const filePath = join(dir, entry);
            try {
                const info = (await statPathTrusted(filePath, { caller: 'config.pinned-files' })).stats;
                if (!info.isFile()) continue;
                await this.#loadFile(filePath);
            } catch (e) {
                logSwallowed(e, 'config.pinnedFiles.stat');
            }
        }
    }

    /**
     * RF-045: versão async para uso na inicialização (chamada via await em #loadDir).
     *
     * @param {string} filePath
     * @returns {Promise<void>}
     */
    async #loadFile(filePath) {
        try {
            const content = (await readTextFreshTrusted(filePath, { caller: 'config.pinned-files' })).content;
            this.#files.set(filePath, { path: filePath, content, loadedAt: Date.now() });
        } catch (e) {
            logSwallowed(e, 'config.pinnedFiles.loadFile');
        }
    }

    /**
     * @returns {Promise<void>}
     */
    async #startWatchers() {
        for (const dir of this.#dirs) {
            try {
                await statPathTrusted(dir, { caller: 'config.pinned-files' });
            } catch {
                continue;
            }

            // Node 19.1+ suporta fs.watch recursive também em Linux. No Node 24 do projeto, tentamos a primitive nativa
            // primeiro e só mantemos o fan-out manual como fallback para filesystems/plataformas que rejeitem a opção.
            if (this.#tryStartRecursiveWatcher(dir)) continue;
            await this.#startFallbackWatchers(dir);
        }
    }

    /**
     * @param {string} dir
     * @returns {boolean}
     */
    #tryStartRecursiveWatcher(dir) {
        try {
            const watcher = watchPathTrusted(
                dir,
                { caller: 'config.pinned-files', persistent: false, recursive: true },
                (_eventType, filename) => {
                    if (!filename) return;
                    const relativeName = String(filename);
                    if (!SUPPORTED_EXTENSIONS.some((ext) => relativeName.endsWith(ext))) return;
                    this.#scheduleReload(join(dir, relativeName));
                },
            );
            this.#registerWatcher(dir, watcher, 'recursive');
            return true;
        } catch (err) {
            log(
                'DEBUG',
                `[PinnedFilesLoader] Watch recursivo indisponível em ${dir}; usando fallback bounded: ${toError(err).message}`,
            );
            return false;
        }
    }

    /**
     * @param {string} dir
     * @returns {Promise<void>}
     */
    async #startFallbackWatchers(dir) {
        try {
            const rootWatcher = watchPathTrusted(
                dir,
                { caller: 'config.pinned-files', persistent: false },
                (_eventType, filename) => {
                    if (!filename) return;
                    const name = String(filename);
                    if (!SUPPORTED_EXTENSIONS.some((ext) => name.endsWith(ext))) return;
                    this.#scheduleReload(join(dir, name));
                },
            );
            this.#registerWatcher(dir, rootWatcher, 'fallback-root');

            const entries = (await listDirectoryNamesFreshTrusted(dir, { caller: 'config.pinned-files' })).entries;
            for (const entry of entries) {
                const subPath = join(dir, entry);
                let info;
                try {
                    info = (await statPathTrusted(subPath, { caller: 'config.pinned-files' })).stats;
                } catch (err) {
                    logSwallowed(err, 'config.pinnedFiles.watchSubdirStat');
                    continue;
                }
                if (!info.isDirectory()) continue;
                try {
                    const subWatcher = watchPathTrusted(
                        subPath,
                        { caller: 'config.pinned-files', persistent: false },
                        (_eventType, filename) => {
                            if (!filename) return;
                            const name = String(filename);
                            if (!SUPPORTED_EXTENSIONS.some((ext) => name.endsWith(ext))) return;
                            this.#scheduleReload(join(subPath, name));
                        },
                    );
                    this.#registerWatcher(subPath, subWatcher, 'fallback-subdir');
                } catch (err) {
                    logSwallowed(err, 'config.pinnedFiles.watchSubdir');
                }
            }
        } catch (err) {
            log('WARN', `[PinnedFilesLoader] Não foi possível monitorar ${dir}: ${toError(err).message}`);
        }
    }

    /**
     * @param {string} key
     * @param {import('node:fs').FSWatcher} watcher
     * @param {'recursive' | 'fallback-root' | 'fallback-subdir'} mode
     * @returns {void}
     */
    #registerWatcher(key, watcher, mode) {
        watcher.on('error', (/** @type {Error} */ err) => {
            log('WARN', `[PinnedFilesLoader] Watcher ${mode} erro em ${key}: ${err.message}`);
            if (this.#watchers.get(key) === watcher) this.#watchers.delete(key);
        });
        this.#watchers.set(key, watcher);
    }

    /**
     * Recarrega um arquivo com debounce para evitar múltiplos eventos rápidos.
     *
     * RF-045: usa `readFile` async dentro do setTimeout para não bloquear o event loop.
     *
     * @param {string} filePath
     * @returns {void}
     */
    #scheduleReload(filePath) {
        const existing = this.#debounceTimers.get(filePath);
        if (existing) clearTimeout(existing);

        const timer = setTimeout(async () => {
            this.#debounceTimers.delete(filePath);

            let fileExists = true;
            try {
                await statPathTrusted(filePath, { caller: 'config.pinned-files' });
            } catch {
                fileExists = false;
            }
            if (!fileExists) {
                if (this.#files.has(filePath)) {
                    this.#files.delete(filePath);
                    log('INFO', `[PinnedFilesLoader] Arquivo removido: ${filePath}`);
                    /** @type {PinnedFileChangedEvent} */
                    const event = { file: filePath, content: '', type: 'removed' };
                    this.emit('changed', event);
                }
                return;
            }

            try {
                const content = (await readTextFreshTrusted(filePath, { caller: 'config.pinned-files' })).content;
                const existed = this.#files.has(filePath);
                this.#files.set(filePath, { path: filePath, content, loadedAt: Date.now() });
                const type = existed ? 'changed' : 'added';
                log('INFO', `[PinnedFilesLoader] Arquivo ${type}: ${filePath}`);
                /** @type {PinnedFileChangedEvent} */
                const event = { file: filePath, content, type };
                this.emit('changed', event);
            } catch (e) {
                logSwallowed(e, 'config.pinnedFiles.reloadFile');
            }
        }, DEBOUNCE_MS);

        this.#debounceTimers.set(filePath, timer);
    }
}
