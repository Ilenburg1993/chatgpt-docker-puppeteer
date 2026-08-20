// @ts-check
/**
 * Cliente isolado para o servidor LSP nativo do TypeScript 7 (tsgo).
 *
 * Esta implementação existe apenas como compatibilidade opt-in para as ferramentas MCP históricas. O editor usa
 * diretamente a extensão/native preview e nenhum processo local é iniciado enquanto LSP_ENABLED não for explicitamente
 * `true`.
 */

import { spawn } from 'node:child_process';
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const NATIVE_PACKAGE_ROOT = path.dirname(fileURLToPath(import.meta.resolve('@typescript/native/package.json')));
const NATIVE_TSC_ENTRYPOINT = path.join(NATIVE_PACKAGE_ROOT, 'lib', 'tsc.js');
const DEFAULT_TIMEOUT_MS = Number(process.env['LSP_TOOL_TIMEOUT_MS'] || 15_000);
const DEFAULT_MAX_RESULTS = Number(process.env['LSP_MAX_RESULTS'] || 200);
const DEFAULT_IDLE_TTL_MS = 30_000;
const MAX_IDLE_TTL_MS = 10 * 60_000;
const MAX_PATCH_BYTES = 200 * 1024;
const STOP_GRACE_MS = 1_000;
const SUPPORTED_OPERATIONS = new Set([
    'apply_code_action',
    'updateFile',
    'workspace_symbols',
    'definition',
    'references',
    'hover',
    'document_symbols',
    'diagnostics',
    'completion',
    'code_actions',
]);

/** @typedef {{ rootDir?: string; timeoutMs?: number; idleTtlMs?: number }} NativeDaemonOptions */
/** @typedef {{ line?: number; character?: number }} LspPosition */
/** @typedef {{ start?: LspPosition; end?: LspPosition }} LspRange */
/**
 * @typedef {{
 *     uri?: string;
 *     targetUri?: string;
 *     range?: LspRange;
 *     targetSelectionRange?: LspRange;
 *     targetRange?: LspRange;
 * }} LspLocation
 */
/** @typedef {{ filePath: string; start: number; length: number; newText: string }} OffsetEdit */
/** @typedef {{ edits?: OffsetEdit[] }} GovernedAction */
/**
 * @typedef {{
 *     filePath?: string;
 *     line?: number;
 *     character?: number;
 *     endLine?: number;
 *     endCharacter?: number;
 *     maxResults?: number;
 *     query?: string;
 *     content?: string;
 *     mode?: string;
 *     action?: GovernedAction;
 *     confirmationToken?: string;
 * }} OperationParams
 */
/** @typedef {{ label?: string; kind?: number; sortText?: string }} CompletionItem */
/**
 * @typedef {{
 *     name?: string;
 *     kind?: number;
 *     children?: LspSymbol[];
 *     selectionRange?: LspRange;
 *     range?: LspRange;
 *     location?: LspLocation;
 *     containerName?: string;
 * }} LspSymbol
 */
/** @typedef {{ range?: LspRange; code?: string | number; severity?: number; message?: string }} LspDiagnostic */
/** @typedef {{ title?: string; kind?: string; edit?: WorkspaceEdit; command?: { command?: string } }} LspCodeAction */
/**
 * @typedef {{
 *     changes?: Record<string, OffsetTextEdit[]>;
 *     documentChanges?: { textDocument?: { uri?: string }; edits?: OffsetTextEdit[] }[];
 * }} WorkspaceEdit
 */
/** @typedef {{ range?: LspRange; newText?: string }} OffsetTextEdit */
/**
 * @typedef {{
 *     method?: string;
 *     id?: number | string;
 *     params?: { items?: unknown[]; uri?: string; diagnostics?: unknown[] };
 *     result?: unknown;
 *     error?: { code?: number; message?: string; data?: unknown };
 * }} JsonRpcMessage
 */

function normalizePath(/** @type {unknown} */ value) {
    return path.resolve(String(value || '')).replace(/\\/gu, '/');
}

function boundedIdleTtlMs(/** @type {unknown} */ value) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return DEFAULT_IDLE_TTL_MS;
    return Math.max(0, Math.min(MAX_IDLE_TTL_MS, Math.trunc(parsed)));
}

function ensureWorkspacePath(/** @type {string} */ rootDir, /** @type {unknown} */ value) {
    const root = normalizePath(rootDir);
    const fullPath = normalizePath(path.resolve(rootDir, String(value || '')));
    if (fullPath !== root && !fullPath.startsWith(`${root}/`)) {
        throw new Error(`LSP_PATH_OUTSIDE_WORKSPACE: ${String(value || '')}`);
    }
    return fullPath;
}

function languageIdForFile(/** @type {string} */ filePath) {
    const extension = path.extname(filePath).toLowerCase();
    if (extension === '.ts' || extension === '.mts' || extension === '.cts') return 'typescript';
    if (extension === '.tsx') return 'typescriptreact';
    if (extension === '.jsx') return 'javascriptreact';
    if (extension === '.json' || extension === '.jsonc') return 'json';
    return 'javascript';
}

function clampPosition(/** @type {string} */ text, /** @type {unknown} */ line, /** @type {unknown} */ character) {
    const lines = text.split(/\r?\n/u);
    const lineIndex = Math.min(lines.length - 1, Math.max(0, Math.trunc(Number(line) || 1) - 1));
    const characterIndex = Math.min(lines[lineIndex]?.length || 0, Math.max(0, Math.trunc(Number(character) || 1) - 1));
    return { line: lineIndex, character: characterIndex };
}

function positionToOffset(/** @type {string} */ text, /** @type {LspPosition | undefined} */ position) {
    const targetLine = Math.max(0, Math.trunc(Number(position?.line) || 0));
    const targetCharacter = Math.max(0, Math.trunc(Number(position?.character) || 0));
    let offset = 0;
    let currentLine = 0;
    while (currentLine < targetLine && offset < text.length) {
        const newline = text.indexOf('\n', offset);
        if (newline < 0) return text.length;
        offset = newline + 1;
        currentLine += 1;
    }
    const lineEnd = text.indexOf('\n', offset);
    const contentEnd =
        lineEnd < 0 ? text.length : lineEnd > offset && text[lineEnd - 1] === '\r' ? lineEnd - 1 : lineEnd;
    return Math.min(contentEnd, offset + targetCharacter);
}

function locationFromLsp(/** @type {LspLocation} */ location) {
    const uri = location?.uri || location?.targetUri;
    const range = location?.range || location?.targetSelectionRange || location?.targetRange;
    if (!uri || !range?.start || !range?.end) return null;
    return {
        filePath: fileURLToPath(uri),
        line: Number(range.start.line) + 1,
        character: Number(range.start.character) + 1,
        endLine: Number(range.end.line) + 1,
        endCharacter: Number(range.end.character) + 1,
    };
}

/** @returns {string} */
function hoverText(/** @type {unknown} */ contents) {
    if (typeof contents === 'string') return contents;
    if (Array.isArray(contents)) return contents.map(hoverText).filter(Boolean).join('\n\n');
    if (contents && typeof contents === 'object') {
        const record = /** @type {{ value?: unknown; language?: unknown }} */ (contents);
        if (typeof record.value === 'string') return record.value;
    }
    return '';
}

function applyTextChanges(/** @type {string} */ originalText, /** @type {OffsetEdit[]} */ textChanges) {
    const sorted = [...textChanges].sort((left, right) => right.start - left.start);
    let next = originalText;
    for (const change of sorted) {
        next = next.slice(0, change.start) + change.newText + next.slice(change.start + change.length);
    }
    return next;
}

export class NativeTypeScriptLspDaemon {
    /** @param {NativeDaemonOptions} [options] */
    constructor(options = {}) {
        this.rootDir = normalizePath(options.rootDir || process.cwd());
        this.timeoutMs = Number(options.timeoutMs || DEFAULT_TIMEOUT_MS);
        this.idleTtlMs = boundedIdleTtlMs(options.idleTtlMs ?? process.env['LSP_SERVICE_IDLE_TTL_MS']);
        this.started = false;
        this.requestSeq = 0;
        this.buffer = Buffer.alloc(0);
        this.stderrTail = '';
        /** @type {Promise<unknown>} */
        this.queue = Promise.resolve(undefined);
        this.child = null;
        this.idleTimer = null;
        this.stopPromise = null;
        /**
         * @type {Map<
         *     number,
         *     {
         *         resolve: (value: unknown) => void;
         *         reject: (reason?: unknown) => void;
         *         timer: NodeJS.Timeout;
         *         cleanup: () => void;
         *     }
         * >}
         */
        this.pending = new Map();
        /** @type {Map<string, { version: number; text: string }>} */
        this.documents = new Map();
        /** @type {Map<string, unknown[]>} */
        this.publishedDiagnostics = new Map();
    }

    _clearIdleTimer() {
        if (!this.idleTimer) return;
        clearTimeout(this.idleTimer);
        this.idleTimer = null;
    }

    _scheduleIdleStop() {
        this._clearIdleTimer();
        if (!this.started || this.pending.size > 0) return;
        if (this.idleTtlMs <= 0) {
            void this.stop();
            return;
        }
        this.idleTimer = setTimeout(() => {
            this.idleTimer = null;
            const stopPromise = this.stop();
            this.stopPromise = stopPromise;
            void stopPromise.finally(() => {
                if (this.stopPromise === stopPromise) this.stopPromise = null;
            });
        }, this.idleTtlMs);
        this.idleTimer.unref?.();
    }

    _write(/** @type {Record<string, unknown>} */ message) {
        if (!this.child?.stdin?.writable) throw new Error('LSP_NATIVE_PROCESS_NOT_WRITABLE');
        const body = JSON.stringify(message);
        this.child.stdin.write(`Content-Length: ${Buffer.byteLength(body, 'utf8')}\r\n\r\n${body}`);
    }

    _notify(/** @type {string} */ method, /** @type {unknown} */ params) {
        this._write({ jsonrpc: '2.0', method, params });
    }

    _request(
        /** @type {string} */ method,
        /** @type {unknown} */ params,
        /** @type {AbortSignal | undefined} */ signal,
    ) {
        if (signal?.aborted) return Promise.reject(new Error('LSP_CANCELLED'));
        const id = ++this.requestSeq;
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pending.delete(id);
                try {
                    this._notify('$/cancelRequest', { id });
                } catch {
                    // O timeout já é a falha autoritativa.
                }
                reject(new Error(`LSP_TIMEOUT: ${method} excedeu ${this.timeoutMs}ms`));
            }, this.timeoutMs);
            timer.unref?.();
            const abortHandler = () => {
                clearTimeout(timer);
                this.pending.delete(id);
                try {
                    this._notify('$/cancelRequest', { id });
                } catch {
                    // O cancelamento já é a falha autoritativa.
                }
                reject(new Error('LSP_CANCELLED'));
            };
            if (signal) signal.addEventListener('abort', abortHandler, { once: true });
            this.pending.set(id, {
                resolve,
                reject,
                timer,
                cleanup: () => signal?.removeEventListener('abort', abortHandler),
            });
            this._write({ jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) });
        });
    }

    _respondToServer(/** @type {JsonRpcMessage} */ message) {
        let result = null;
        if (message.method === 'workspace/configuration') {
            result = Array.isArray(message.params?.items) ? message.params.items.map(() => ({})) : [];
        } else if (message.method === 'workspace/workspaceFolders') {
            result = [{ uri: pathToFileURL(this.rootDir).href, name: path.basename(this.rootDir) }];
        }
        this._write({ jsonrpc: '2.0', id: message.id, result });
    }

    _onMessage(/** @type {JsonRpcMessage} */ message) {
        if (message?.method && message.id !== undefined) {
            this._respondToServer(message);
            return;
        }
        if (message?.method === 'textDocument/publishDiagnostics') {
            this.publishedDiagnostics.set(String(message.params?.uri || ''), message.params?.diagnostics || []);
            return;
        }
        if (message?.id === undefined) return;
        const pending = this.pending.get(Number(message.id));
        if (!pending) return;
        this.pending.delete(Number(message.id));
        clearTimeout(pending.timer);
        pending.cleanup();
        if (message.error) {
            const error = new Error(`LSP_NATIVE_ERROR ${message.error.code}: ${message.error.message}`);
            Object.assign(error, { code: message.error.code, data: message.error.data });
            pending.reject(error);
        } else {
            pending.resolve(message.result);
        }
    }

    _consumeStdout(/** @type {Buffer | string} */ chunk) {
        this.buffer = Buffer.concat([this.buffer, Buffer.from(chunk)]);
        while (this.buffer.length > 0) {
            const headerEnd = this.buffer.indexOf('\r\n\r\n');
            if (headerEnd < 0) return;
            const header = this.buffer.subarray(0, headerEnd).toString('ascii');
            const match = /(?:^|\r\n)Content-Length:\s*(\d+)/iu.exec(header);
            if (!match) throw new Error(`LSP_NATIVE_INVALID_HEADER: ${header.slice(0, 200)}`);
            const length = Number(match[1]);
            const bodyStart = headerEnd + 4;
            if (this.buffer.length < bodyStart + length) return;
            const body = this.buffer.subarray(bodyStart, bodyStart + length).toString('utf8');
            this.buffer = this.buffer.subarray(bodyStart + length);
            this._onMessage(JSON.parse(body));
        }
    }

    async start() {
        this._clearIdleTimer();
        if (this.stopPromise) await this.stopPromise;
        if (this.started && this.child) {
            return { started: true, rootDir: this.rootDir, timeoutMs: this.timeoutMs, idleTtlMs: this.idleTtlMs };
        }

        this.buffer = Buffer.alloc(0);
        this.stderrTail = '';
        const child = spawn(process.execPath, [NATIVE_TSC_ENTRYPOINT, '--lsp', '--stdio'], {
            cwd: this.rootDir,
            env: process.env,
            stdio: ['pipe', 'pipe', 'pipe'],
        });
        this.child = child;
        child.stdout.on('data', (chunk) => this._consumeStdout(chunk));
        child.stderr.on('data', (chunk) => {
            this.stderrTail = `${this.stderrTail}${String(chunk)}`.slice(-64 * 1024);
        });
        child.once('exit', (code, signal) => {
            if (this.child !== child) return;
            this.child = null;
            this.started = false;
            this.documents.clear();
            const error = new Error(
                `LSP_NATIVE_EXITED: code=${String(code)} signal=${String(signal)} ${this.stderrTail}`.trim(),
            );
            for (const pending of this.pending.values()) {
                clearTimeout(pending.timer);
                pending.cleanup();
                pending.reject(error);
            }
            this.pending.clear();
        });

        await new Promise((resolve, reject) => {
            const onError = (/** @type {Error} */ error) => reject(error);
            child.once('error', onError);
            child.once('spawn', () => {
                child.off('error', onError);
                resolve(undefined);
            });
        });

        await this._request(
            'initialize',
            {
                processId: process.pid,
                rootUri: pathToFileURL(this.rootDir).href,
                workspaceFolders: [{ uri: pathToFileURL(this.rootDir).href, name: path.basename(this.rootDir) }],
                capabilities: {
                    workspace: { workspaceFolders: true, configuration: true, symbol: {} },
                    textDocument: {
                        definition: { linkSupport: true },
                        references: {},
                        hover: { contentFormat: ['markdown', 'plaintext'] },
                        documentSymbol: { hierarchicalDocumentSymbolSupport: true },
                        diagnostic: {},
                        codeAction: { resolveSupport: { properties: ['edit'] } },
                        completion: { completionItem: { snippetSupport: false } },
                        synchronization: { didSave: true, dynamicRegistration: true },
                    },
                },
            },
            undefined,
        );
        this._notify('initialized', {});
        this.started = true;
        return { started: true, rootDir: this.rootDir, timeoutMs: this.timeoutMs, idleTtlMs: this.idleTtlMs };
    }

    async stop() {
        this._clearIdleTimer();
        const child = this.child;
        if (!child) {
            this.started = false;
            this.documents.clear();
            return { stopped: true };
        }
        try {
            await this._request('shutdown', undefined, undefined);
            this._notify('exit', undefined);
        } catch {
            // O encerramento forçado abaixo continua sendo determinístico.
        }
        await new Promise((resolve) => {
            if (child.exitCode !== null || child.signalCode !== null) {
                resolve(undefined);
                return;
            }
            const timer = setTimeout(() => {
                child.kill('SIGTERM');
                resolve(undefined);
            }, STOP_GRACE_MS);
            timer.unref?.();
            child.once('exit', () => {
                clearTimeout(timer);
                resolve(undefined);
            });
        });
        if (this.child === child) this.child = null;
        this.started = false;
        this.documents.clear();
        return { stopped: true };
    }

    async _ensureOpen(/** @type {string} */ filePath) {
        const uri = pathToFileURL(filePath).href;
        const text = await fsp.readFile(filePath, 'utf8');
        const existing = this.documents.get(uri);
        if (!existing) {
            this.documents.set(uri, { version: 1, text });
            this._notify('textDocument/didOpen', {
                textDocument: { uri, languageId: languageIdForFile(filePath), version: 1, text },
            });
        } else if (existing.text !== text) {
            existing.version += 1;
            existing.text = text;
            this._notify('textDocument/didChange', {
                textDocument: { uri, version: existing.version },
                contentChanges: [{ text }],
            });
        }
        return {
            uri,
            text,
            position: (/** @type {unknown} */ line, /** @type {unknown} */ character) =>
                clampPosition(text, line, character),
        };
    }

    async execute(
        /** @type {string} */ operation,
        /** @type {OperationParams} */ params = {},
        /** @type {{ signal?: AbortSignal; timeoutMs?: number }} */ options = {},
    ) {
        const run = async () => {
            await this.start();
            const externalSignal = /** @type {AbortSignal | undefined} */ (options.signal);
            if (externalSignal?.aborted) throw new Error('LSP_CANCELLED');
            try {
                return await this._dispatch(operation, params, externalSignal);
            } finally {
                this._scheduleIdleStop();
            }
        };
        const queued = this.queue.then(run, run);
        this.queue = queued.catch(() => {});
        return queued;
    }

    async _dispatch(
        /** @type {string} */ operation,
        /** @type {OperationParams} */ params,
        /** @type {AbortSignal | undefined} */ signal,
    ) {
        if (!SUPPORTED_OPERATIONS.has(operation)) throw new Error(`LSP_UNKNOWN_OPERATION: ${operation}`);
        if (operation === 'apply_code_action') return this._applyCodeAction(params);
        if (operation === 'updateFile') return this._updateFile(params);
        if (operation === 'workspace_symbols') return this._workspaceSymbols(params, signal);

        const filePath = ensureWorkspacePath(this.rootDir, params.filePath);
        const document = await this._ensureOpen(filePath);
        const textDocument = { uri: document.uri };
        const position = document.position(params.line, params.character);

        if (operation === 'definition') {
            const result = await this._request('textDocument/definition', { textDocument, position }, signal);
            const locations = /** @type {LspLocation[]} */ (Array.isArray(result) ? result : result ? [result] : []);
            return locations.map(locationFromLsp).filter(Boolean);
        }
        if (operation === 'references') {
            const result = await this._request(
                'textDocument/references',
                { textDocument, position, context: { includeDeclaration: true } },
                signal,
            );
            return /** @type {LspLocation[]} */ (Array.isArray(result) ? result : [])
                .slice(0, DEFAULT_MAX_RESULTS)
                .map(locationFromLsp)
                .filter(Boolean);
        }
        if (operation === 'hover') {
            const result = await this._request('textDocument/hover', { textDocument, position }, signal);
            if (!result || typeof result !== 'object') return null;
            const hover = /** @type {{ contents?: unknown }} */ (result);
            return { kind: 'lsp', kindModifiers: '', display: hoverText(hover.contents), documentation: '' };
        }
        if (operation === 'document_symbols') {
            const result = await this._request('textDocument/documentSymbol', { textDocument }, signal);
            return this._flattenDocumentSymbols(
                /** @type {LspSymbol[]} */ (Array.isArray(result) ? result : []),
                filePath,
            ).slice(0, DEFAULT_MAX_RESULTS);
        }
        if (operation === 'diagnostics') {
            return this._diagnostics(document, signal);
        }
        if (operation === 'completion') {
            const result = await this._request('textDocument/completion', { textDocument, position }, signal);
            const completionList =
                result && typeof result === 'object' ? /** @type {{ items?: unknown[] }} */ (result) : null;
            const items = /** @type {CompletionItem[]} */ (
                Array.isArray(result) ? result : completionList?.items || []
            );
            // O servidor nativo ainda pode materializar itens de mesma prioridade
            // em ordem não determinística. Ordenar por sortText mantém símbolos
            // locais (11) antes dos globais (15) antes de aplicar o limite.
            return [...items]
                .sort(
                    (left, right) =>
                        String(left.sortText || '').localeCompare(String(right.sortText || '')) ||
                        String(left.label || '').localeCompare(String(right.label || '')),
                )
                .slice(0, Number(params.maxResults || DEFAULT_MAX_RESULTS))
                .map((item) => ({
                    name: String(item.label || ''),
                    kind: item.kind,
                    kindModifiers: '',
                    sortText: item.sortText || item.label,
                }));
        }
        if (operation === 'code_actions') {
            const end = document.position(params.endLine || params.line, params.endCharacter || params.character);
            const diagnostics = await this._diagnostics(document, signal, true);
            const result = await this._request(
                'textDocument/codeAction',
                { textDocument, range: { start: position, end }, context: { diagnostics } },
                signal,
            );
            const maxResults = Number(params.maxResults || DEFAULT_MAX_RESULTS);
            const actions = [];
            for (const [index, action] of /** @type {LspCodeAction[]} */ (
                Array.isArray(result) ? result : []
            ).entries()) {
                const edits = await this._workspaceEditToOffsetEdits(action.edit);
                if (edits.length === 0) continue;
                actions.push({
                    id: `fix-${index + 1}`,
                    title: action.title,
                    kind: action.kind || 'quickfix',
                    source: 'typescript-native',
                    fixName: action.command?.command || null,
                    edits,
                });
                if (actions.length >= maxResults) break;
            }
            return actions;
        }
        throw new Error(`LSP_UNKNOWN_OPERATION: ${operation}`);
    }

    /**
     * @returns {{
     *     name: string;
     *     kind: number | null;
     *     parent: string | null;
     *     filePath: string;
     *     range: LspRange | null;
     * }[]}
     */
    _flattenDocumentSymbols(
        /** @type {LspSymbol[]} */ symbols,
        /** @type {string} */ filePath,
        /** @type {string | null} */ parent = null,
    ) {
        const output = [];
        for (const symbol of symbols) {
            const name = String(symbol.name || '');
            const range = symbol.selectionRange || symbol.range || symbol.location?.range || null;
            output.push({ name, kind: symbol.kind ?? null, parent, filePath, range });
            if (Array.isArray(symbol.children)) {
                output.push(...this._flattenDocumentSymbols(symbol.children, filePath, name));
            }
        }
        return output;
    }

    async _workspaceSymbols(/** @type {OperationParams} */ params, /** @type {AbortSignal | undefined} */ signal) {
        const result = await this._request('workspace/symbol', { query: String(params.query || '') }, signal);
        return /** @type {LspSymbol[]} */ (Array.isArray(result) ? result : [])
            .slice(0, Number(params.maxResults || DEFAULT_MAX_RESULTS))
            .map((item) => ({
                name: item.name,
                kind: item.kind,
                filePath: item.location?.uri ? fileURLToPath(item.location.uri) : null,
                containerName: item.containerName || null,
                matchKind: null,
            }));
    }

    async _diagnostics(
        /** @type {{ uri: string; text: string }} */ document,
        /** @type {AbortSignal | undefined} */ signal,
        raw = false,
    ) {
        /** @type {LspDiagnostic[]} */
        let items;
        try {
            const report = await this._request(
                'textDocument/diagnostic',
                { textDocument: { uri: document.uri } },
                signal,
            );
            const diagnosticReport =
                report && typeof report === 'object' ? /** @type {{ items?: LspDiagnostic[] }} */ (report) : null;
            items = diagnosticReport?.items || [];
        } catch (error) {
            const published = this.publishedDiagnostics.get(document.uri);
            if (!published) throw error;
            items = /** @type {LspDiagnostic[]} */ (published);
        }
        if (raw) return items;
        const categories = /** @type {Record<number, string>} */ ({
            1: 'Error',
            2: 'Warning',
            3: 'Information',
            4: 'Hint',
        });
        return items.slice(0, DEFAULT_MAX_RESULTS).map((/** @type {LspDiagnostic} */ diagnostic) => ({
            code: diagnostic.code ?? null,
            category: categories[Number(diagnostic.severity || 3)] || 'Information',
            message: String(diagnostic.message || ''),
            line: Number(diagnostic.range?.start?.line || 0) + 1,
            character: Number(diagnostic.range?.start?.character || 0) + 1,
            endLine: Number(diagnostic.range?.end?.line || 0) + 1,
            endCharacter: Number(diagnostic.range?.end?.character || 0) + 1,
        }));
    }

    async _workspaceEditToOffsetEdits(/** @type {WorkspaceEdit | undefined} */ workspaceEdit) {
        if (!workspaceEdit) return [];
        const byUri = new Map();
        for (const [uri, edits] of Object.entries(workspaceEdit.changes || {})) byUri.set(uri, edits);
        for (const change of workspaceEdit.documentChanges || []) {
            if (change?.textDocument?.uri && Array.isArray(change.edits))
                byUri.set(change.textDocument.uri, change.edits);
        }
        const output = [];
        for (const [uri, edits] of byUri.entries()) {
            if (!String(uri).startsWith('file:')) continue;
            const filePath = ensureWorkspacePath(this.rootDir, fileURLToPath(String(uri)));
            const text = await fsp.readFile(filePath, 'utf8');
            for (const edit of /** @type {OffsetTextEdit[]} */ (edits)) {
                const start = positionToOffset(text, edit.range?.start);
                const end = positionToOffset(text, edit.range?.end);
                output.push({ filePath, start, length: Math.max(0, end - start), newText: String(edit.newText || '') });
            }
        }
        return output;
    }

    async _updateFile(/** @type {OperationParams} */ params) {
        const filePath = ensureWorkspacePath(this.rootDir, params.filePath);
        const content = String(params.content || '');
        await fsp.writeFile(filePath, content, 'utf8');
        await this._ensureOpen(filePath);
        return { updated: true };
    }

    async _applyCodeAction(/** @type {OperationParams} */ params) {
        const mode = String(params.mode || 'preview');
        const edits = Array.isArray(params.action?.edits) ? params.action.edits : [];
        if (edits.length === 0) throw new Error('LSP_CODE_ACTION_EMPTY_EDITS');
        const totalBytes = edits.reduce(
            (/** @type {number} */ total, /** @type {OffsetEdit} */ edit) =>
                total + Buffer.byteLength(String(edit.newText || ''), 'utf8'),
            0,
        );
        if (totalBytes > MAX_PATCH_BYTES) throw new Error(`LSP_PATCH_TOO_LARGE: ${totalBytes} > ${MAX_PATCH_BYTES}`);

        const grouped = new Map();
        for (const edit of edits) {
            const filePath = ensureWorkspacePath(this.rootDir, edit.filePath);
            const fileEdits = grouped.get(filePath) || [];
            fileEdits.push({
                start: Number(edit.start || 0),
                length: Number(edit.length || 0),
                newText: String(edit.newText || ''),
            });
            grouped.set(filePath, fileEdits);
        }

        const previews = [];
        for (const [filePath, fileEdits] of grouped.entries()) {
            const before = await fsp.readFile(filePath, 'utf8');
            previews.push({ filePath, before, after: applyTextChanges(before, fileEdits), edits: fileEdits });
        }
        if (mode === 'preview') {
            return { mode, files: previews, totalEdits: edits.length, totalBytes };
        }
        if (mode !== 'apply') throw new Error(`LSP_CODE_ACTION_INVALID_MODE: ${mode}`);
        if (String(process.env['LSP_MUTATIONS_ENABLED'] || 'false').toLowerCase() !== 'true') {
            throw new Error('LSP_MUTATIONS_DISABLED');
        }
        if (!String(params.confirmationToken || '').trim()) throw new Error('LSP_CONFIRMATION_TOKEN_REQUIRED');
        for (const preview of previews) {
            await fsp.writeFile(preview.filePath, preview.after, 'utf8');
            await this._ensureOpen(preview.filePath);
        }
        return { mode, files: previews, totalEdits: edits.length, totalBytes };
    }
}

/** @type {NativeTypeScriptLspDaemon | null} */
let singleton = null;

export function getNativeTypeScriptLspDaemon() {
    if (!singleton) singleton = new NativeTypeScriptLspDaemon();
    return singleton;
}

export async function startNativeTypeScriptLspDaemon(options = {}) {
    if (String(process.env['LSP_ENABLED'] || 'false').toLowerCase() !== 'true') {
        throw new Error('LSP_DISABLED_BY_POLICY');
    }
    const daemon = getNativeTypeScriptLspDaemon();
    const typedOptions = /** @type {NativeDaemonOptions} */ (options);
    if (typedOptions.timeoutMs !== undefined) daemon.timeoutMs = Number(typedOptions.timeoutMs);
    if (typedOptions.idleTtlMs !== undefined) daemon.idleTtlMs = boundedIdleTtlMs(typedOptions.idleTtlMs);
    return daemon.start();
}

export async function stopNativeTypeScriptLspDaemon() {
    if (!singleton) return { stopped: true };
    return singleton.stop();
}
