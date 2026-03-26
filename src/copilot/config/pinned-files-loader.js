// @ts-check
/**
 * src/copilot/config/pinned-files-loader.js
 *
 * Carrega e monitora arquivos de contexto "pinned" (fixados) para injeção automática
 * em novas sessões. Usa fs.watch com debounce para detectar mudanças em tempo real.
 *
 * @module copilot/config/pinned-files-loader
 */

import { EventEmitter } from 'node:events';
import { existsSync, readFileSync, watch } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { log } from '#core/logger';

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
 * @property {'added'|'changed'|'removed'} type - Tipo de mudança
 */

/**
 * Carrega e monitora arquivos fixados para injeção de contexto em sessões.
 * Emite evento `changed` quando qualquer arquivo monitorado é modificado.
 *
 * @fires PinnedFilesLoader#changed
 *
 * @example
 * const loader = new PinnedFilesLoader(['./context', './docs/pinned']);
 * await loader.start();
 * loader.on('changed', ({ file, content, type }) => console.log(file, type));
 * const files = loader.getFiles();
 */
export class PinnedFilesLoader extends EventEmitter {
    /** @type {string[]} */
    #dirs;

    /** @type {Map<string, PinnedFile>} */
    #files = new Map();

    /** @type {Map<string, ReturnType<typeof watch>>} */
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
        this.#startWatchers();
        log('INFO', `[PinnedFilesLoader] Pronto — ${this.#files.size} arquivo(s) carregado(s) de ${this.#dirs.length} dir(s)`);
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
        if (!existsSync(dir)) return;

        let entries;
        try {
            entries = await readdir(dir);
        } catch {
            return;
        }

        for (const entry of entries) {
            if (!SUPPORTED_EXTENSIONS.some((ext) => entry.endsWith(ext))) continue;
            const filePath = join(dir, entry);
            try {
                const info = await stat(filePath);
                if (!info.isFile()) continue;
                this.#loadFile(filePath);
            } catch {
                // arquivo pode ter sido removido entre readdir e stat
            }
        }
    }

    /**
     * @param {string} filePath
     * @returns {void}
     */
    #loadFile(filePath) {
        try {
            const content = readFileSync(filePath, 'utf8');
            const existed = this.#files.has(filePath);
            this.#files.set(filePath, { path: filePath, content, loadedAt: Date.now() });
            void existed;
        } catch {
            // arquivo inacessível — ignorar silenciosamente
        }
    }

    /**
     * @returns {void}
     */
    #startWatchers() {
        for (const dir of this.#dirs) {
            if (!existsSync(dir)) continue;
            try {
                const watcher = watch(dir, { persistent: false }, (eventType, filename) => {
                    if (!filename) return;
                    if (!SUPPORTED_EXTENSIONS.some((ext) => filename.endsWith(ext))) return;
                    const filePath = join(dir, filename);
                    this.#scheduleReload(filePath);
                });
                this.#watchers.set(dir, watcher);
            } catch (err) {
                log('WARN', `[PinnedFilesLoader] Não foi possível monitorar ${dir}: ${/** @type {Error} */ (err).message}`);
            }
        }
    }

    /**
     * Recarrega um arquivo com debounce para evitar múltiplos eventos rápidos.
     *
     * @param {string} filePath
     * @returns {void}
     */
    #scheduleReload(filePath) {
        const existing = this.#debounceTimers.get(filePath);
        if (existing) clearTimeout(existing);

        const timer = setTimeout(() => {
            this.#debounceTimers.delete(filePath);

            if (!existsSync(filePath)) {
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
                const content = readFileSync(filePath, 'utf8');
                const existed = this.#files.has(filePath);
                this.#files.set(filePath, { path: filePath, content, loadedAt: Date.now() });
                const type = existed ? 'changed' : 'added';
                log('INFO', `[PinnedFilesLoader] Arquivo ${type}: ${filePath}`);
                /** @type {PinnedFileChangedEvent} */
                const event = { file: filePath, content, type };
                this.emit('changed', event);
            } catch {
                // arquivo protegido ou inacessível
            }
        }, DEBOUNCE_MS);

        this.#debounceTimers.set(filePath, timer);
    }
}
