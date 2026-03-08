// @ts-check
import fs, { promises as fsp } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const DEFAULT_TIMEOUT_MS = Number(process.env.LSP_TOOL_TIMEOUT_MS || 15000);
const DEFAULT_MAX_RESULTS = Number(process.env.LSP_MAX_RESULTS || 200);
const MAX_PATCH_BYTES = 200 * 1024;

function normalizePath(/** @type {any} */ p) {
    return path.resolve(String(p || '')).replace(/\\/g, '/');
}

function isInsideWorkspace(/** @type {any} */ rootDir, /** @type {any} */ filePath) {
    const root = normalizePath(rootDir);
    const full = normalizePath(filePath);
    return full === root || full.startsWith(`${root}/`);
}

function ensureWorkspacePath(/** @type {any} */ rootDir, /** @type {any} */ filePath) {
    const fullPath = path.resolve(rootDir, String(filePath || ''));
    if (!isInsideWorkspace(rootDir, fullPath)) {
        throw new Error(`LSP_PATH_OUTSIDE_WORKSPACE: ${filePath}`);
    }
    return fullPath;
}

function lineCharToOffset(/** @type {any} */ sourceFile, /** @type {any} */ line, /** @type {any} */ character) {
    const safeLine = Math.max(0, Number(line || 1) - 1);
    const safeCharacter = Math.max(0, Number(character || 1) - 1);
    return ts.getPositionOfLineAndCharacter(sourceFile, safeLine, safeCharacter);
}

function offsetToLineChar(/** @type {any} */ sourceFile, /** @type {any} */ offset) {
    const lc = ts.getLineAndCharacterOfPosition(sourceFile, Math.max(0, offset || 0));
    return {
        line: lc.line + 1,
        character: lc.character + 1,
    };
}

function formatDiagnosticMessage(/** @type {any} */ diag) {
    if (typeof diag.messageText === 'string') return diag.messageText;
    return ts.flattenDiagnosticMessageText(diag.messageText, '\n');
}

function applyTextChanges(/** @type {any} */ originalText, /** @type {any} */ textChanges) {
    const sorted = [...textChanges].sort((a, b) => b.start - a.start);
    let next = originalText;
    for (const change of sorted) {
        next = next.slice(0, change.start) + change.newText + next.slice(change.start + change.length);
    }
    return next;
}

// ─── LanguageService singleton cache ─────────────────────────────────────────
// Cada rootDir mantém UMA única instância de LanguageService. As operações de
// leitura (definition, references, hover, diagnostics…) reutilizam o mesmo
// serviço em vez de criar + descartar um novo a cada chamada — eliminando o
// overhead de reanalisar centenas de arquivos do projeto a cada request LSP.
//
// Ciclo de vida:
//  • cache miss / nova extraFile não rastreada → cria e armazena
//  • operações de leitura → dispose() é no-op (o cache é o dono)
//  • updateFile → invalida o cache para que o próximo request veja o novo conteúdo
//  • stop()     → dispose explícito do LanguageService armazenado
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @typedef {{ languageService: ts.LanguageService, scriptVersions: Map<string, string>, fileNames: string[] }} LsCacheEntry
 */

/** @type {Map<string, LsCacheEntry>} */
const _lsCache = new Map();

/**
 * DocumentRegistry compartilhado em nível de módulo.
 * ts.DocumentRegistry mantém ASTs de source files parseados entre instâncias de
 * LanguageService. Ao compartilhá-lo, ASTs sobrevivem a invalidações do _lsCache
 * (provocadas por updateFile), tornando a primeira request pós-invalidação mais
 * rápida porque os arquivos não modificados não precisam ser re-parseados.
 * @type {ts.DocumentRegistry}
 */
const _documentRegistry = ts.createDocumentRegistry();

/**
 * Dispose e remove o LanguageService em cache para um dado rootDir.
 * @param {string} rootDir - Caminho normalizado do root do projeto.
 */
function _disposeCachedService(rootDir) {
    const entry = _lsCache.get(rootDir);
    if (entry) {
        try { entry.languageService.dispose(); } catch { /* ignorar erros de dispose */ }
        _lsCache.delete(rootDir);
    }
}

function createLanguageService(/** @type {any} */ rootDir, /** @type {any} */ extraFile) {
    const normalizedRoot = normalizePath(rootDir);
    const fullExtra = extraFile ? normalizePath(extraFile) : null;

    // Verificar cache existente
    const cached = _lsCache.get(normalizedRoot);
    if (cached) {
        if (fullExtra && !cached.fileNames.includes(fullExtra)) {
            // Arquivo não rastreado pelo serviço atual → invalida para recriar com o novo arquivo
            _disposeCachedService(normalizedRoot);
        } else {
            // Cache hit — reutiliza LanguageService existente (dispose é no-op)
            return {
                languageService: cached.languageService,
                dispose: () => {},
            };
        }
    }

    // Cache miss (ou invalidado): constrói novo LanguageService
    //
    // Estratégia de tsconfig: preferir tsconfig.node.json sobre tsconfig.json.
    // O tsconfig.json raiz tem files:[] (solution file com project references), o que
    // resulta em 0 arquivos incluídos. tsconfig.node.json tem include:["src/**/*"] e
    // provê cobertura real para operações de workspace (workspace_symbols) e file-level.
    const configPath =
        ts.findConfigFile(rootDir, ts.sys.fileExists, 'tsconfig.node.json') ||
        ts.findConfigFile(rootDir, ts.sys.fileExists, 'tsconfig.json') ||
        ts.findConfigFile(rootDir, ts.sys.fileExists, 'jsconfig.json');

    let compilerOptions = {
        allowJs: true,
        checkJs: true,
        module: ts.ModuleKind.NodeNext,
        moduleResolution: ts.ModuleResolutionKind.NodeNext,
        target: ts.ScriptTarget.ES2022,
    };
    /** @type {any[]} */ let fileNames = [];

    if (configPath) {
        const readConfig = ts.readConfigFile(configPath, ts.sys.readFile);
        if (readConfig.error) {
            throw new Error(`LSP_CONFIG_ERROR: ${formatDiagnosticMessage(readConfig.error)}`);
        }
        const parsed = ts.parseJsonConfigFileContent(readConfig.config, ts.sys, path.dirname(configPath));
        compilerOptions = { ...compilerOptions, ...parsed.options };
        fileNames = parsed.fileNames;
    }

    if (fullExtra && !fileNames.includes(fullExtra)) {
        fileNames.push(fullExtra);
    }

    const scriptVersions = new Map(fileNames.map((/** @type {any} */ f) => [normalizePath(f), '1']));
    const normalizedFileNames = [...new Set(fileNames.map(normalizePath))];

    const host = {
        getScriptFileNames: () => normalizedFileNames,
        getScriptVersion: (/** @type {any} */ fileName) => scriptVersions.get(normalizePath(fileName)) || '1',
        getScriptSnapshot: (/** @type {any} */ fileName) => {
            const full = normalizePath(fileName);
            if (!fs.existsSync(full)) return undefined;
            const content = fs.readFileSync(full, 'utf8');
            return ts.ScriptSnapshot.fromString(content);
        },
        getCurrentDirectory: () => rootDir,
        getCompilationSettings: () => compilerOptions,
        getDefaultLibFileName: (/** @type {any} */ options) => ts.getDefaultLibFilePath(options),
        fileExists: ts.sys.fileExists,
        readFile: ts.sys.readFile,
        readDirectory: ts.sys.readDirectory,
        directoryExists: ts.sys.directoryExists,
        getDirectories: ts.sys.getDirectories,
    };

    const languageService = ts.createLanguageService(host, _documentRegistry);

    // Armazenar no cache — o cache é o dono do LanguageService
    _lsCache.set(normalizedRoot, { languageService, scriptVersions, fileNames: normalizedFileNames });

    return {
        languageService,
        dispose: () => {}, // no-op: ownership stays with _lsCache
    };
}

/** Classe exportada: TsserverDaemon. */
class TsserverDaemon {
    constructor(options = {}) {
        this.rootDir = normalizePath(/** @type {any} */ (options).rootDir || process.cwd());
        this.timeoutMs = Number(/** @type {any} */ (options).timeoutMs || DEFAULT_TIMEOUT_MS);
        this.started = false;
        this.requestSeq = 0;
        /** @type {Promise<unknown>} */
        this.queue = Promise.resolve(undefined);
        /** @type {Map<string, AbortController>} */
        this.activeRequests = new Map();
    }

    async start() {
        this.started = true;
        return {
            started: true,
            rootDir: this.rootDir,
            timeoutMs: this.timeoutMs,
        };
    }

    async stop() {
        for (const [id, controller] of this.activeRequests.entries()) {
            controller.abort();
            this.activeRequests.delete(id);
        }
        // Libera o LanguageService em cache para este rootDir
        _disposeCachedService(normalizePath(this.rootDir));
        this.started = false;
        return { stopped: true };
    }

    async execute(/** @type {any} */ operation, /** @type {any} */ params = {}, /** @type {any} */ options = {}) {
        if (!this.started) {
            await this.start();
        }

        const run = async () => {
            const requestId = `lsp-${++this.requestSeq}`;
            const timeoutMs = Number(/** @type {any} */ (options).timeoutMs || this.timeoutMs);
            const internal = new AbortController();
            const combined = /** @type {any} */ (options).signal
                ? AbortSignal.any([/** @type {any} */ (options).signal, internal.signal])
                : internal.signal;
            const timeoutId = setTimeout(() => internal.abort(), timeoutMs);
            this.activeRequests.set(requestId, internal);
            try {
                if (combined.aborted) {
                    throw new Error(`LSP_CANCELLED: ${requestId}`);
                }
                return await this._dispatch(operation, params, combined);
            } finally {
                clearTimeout(timeoutId);
                this.activeRequests.delete(requestId);
            }
        };

        const queued = this.queue.then(run, run);
        this.queue = queued.catch(() => {});
        return queued;
    }

    async _dispatch(/** @type {any} */ operation, /** @type {any} */ params, /** @type {any} */ signal) {
        switch (operation) {
            case 'definition':
                return this._definition(params, signal);
            case 'references':
                return this._references(params, signal);
            case 'hover':
                return this._hover(params, signal);
            case 'document_symbols':
                return this._documentSymbols(params, signal);
            case 'workspace_symbols':
                return this._workspaceSymbols(params, signal);
            case 'diagnostics':
                return this._diagnostics(params, signal);
            case 'code_actions':
                return this._codeActions(params, signal);
            case 'completion':
                return this._completion(params, signal);
            case 'updateFile':
                return this._updateFile(params, signal);
            case 'apply_code_action':
                return this._applyCodeAction(params, signal);
            default:
                throw new Error(`LSP_UNKNOWN_OPERATION: ${operation}`);
        }
    }

    _assertNotAborted(/** @type {any} */ signal) {
        if (signal?.aborted) {
            throw new Error('LSP_CANCELLED');
        }
    }

    async _definition(/** @type {any} */ params, /** @type {any} */ signal) {
        this._assertNotAborted(signal);
        const filePath = ensureWorkspacePath(this.rootDir, params.filePath);
        const { languageService, dispose } = createLanguageService(this.rootDir, filePath);
        try {
            const source = languageService.getProgram()?.getSourceFile(filePath);
            if (!source) return [];
            const offset = lineCharToOffset(source, params.line, params.character);
            const defs = languageService.getDefinitionAtPosition(filePath, offset) || [];
            return defs
                .map((/** @type {any} */ d) => {
                    const sourceFile = languageService.getProgram()?.getSourceFile(d.fileName);
                    if (!sourceFile) return null;
                    const start = offsetToLineChar(sourceFile, d.textSpan.start);
                    const end = offsetToLineChar(sourceFile, d.textSpan.start + d.textSpan.length);
                    return {
                        filePath: d.fileName,
                        line: start.line,
                        character: start.character,
                        endLine: end.line,
                        endCharacter: end.character,
                        kind: d.kind,
                        name: d.name,
                    };
                })
                .filter(Boolean);
        } finally {
            dispose();
        }
    }

    async _references(/** @type {any} */ params, /** @type {any} */ signal) {
        this._assertNotAborted(signal);
        const filePath = ensureWorkspacePath(this.rootDir, params.filePath);
        const { languageService, dispose } = createLanguageService(this.rootDir, filePath);
        try {
            const source = languageService.getProgram()?.getSourceFile(filePath);
            if (!source) return [];
            const offset = lineCharToOffset(source, params.line, params.character);
            const refs = languageService.getReferencesAtPosition(filePath, offset) || [];
            return refs
                .slice(0, DEFAULT_MAX_RESULTS)
                .map((/** @type {any} */ ref) => {
                    const sourceFile = languageService.getProgram()?.getSourceFile(ref.fileName);
                    if (!sourceFile) return null;
                    const start = offsetToLineChar(sourceFile, ref.textSpan.start);
                    const end = offsetToLineChar(sourceFile, ref.textSpan.start + ref.textSpan.length);
                    const refEntry = /** @type {ts.ReferenceEntry & { isDefinition?: boolean }} */ (ref);
                    return {
                        filePath: ref.fileName,
                        line: start.line,
                        character: start.character,
                        endLine: end.line,
                        endCharacter: end.character,
                        isDefinition: Boolean(refEntry.isDefinition),
                        isWriteAccess: Boolean(refEntry.isWriteAccess),
                    };
                })
                .filter(Boolean);
        } finally {
            dispose();
        }
    }

    async _hover(/** @type {any} */ params, /** @type {any} */ signal) {
        this._assertNotAborted(signal);
        const filePath = ensureWorkspacePath(this.rootDir, params.filePath);
        const { languageService, dispose } = createLanguageService(this.rootDir, filePath);
        try {
            const source = languageService.getProgram()?.getSourceFile(filePath);
            if (!source) return null;
            const offset = lineCharToOffset(source, params.line, params.character);
            const info = languageService.getQuickInfoAtPosition(filePath, offset);
            if (!info) return null;
            return {
                kind: info.kind,
                kindModifiers: info.kindModifiers,
                display: ts.displayPartsToString(info.displayParts || []),
                documentation: ts.displayPartsToString(info.documentation || []),
            };
        } finally {
            dispose();
        }
    }

    async _documentSymbols(/** @type {any} */ params, /** @type {any} */ signal) {
        this._assertNotAborted(signal);
        const filePath = ensureWorkspacePath(this.rootDir, params.filePath);
        const { languageService, dispose } = createLanguageService(this.rootDir, filePath);
        try {
            const tree = languageService.getNavigationTree(filePath);
            if (!tree) return [];
            const out = /** @type {any[]} */ ([]);
            const walk = (/** @type {any} */ node, /** @type {any} */ parent = null) => {
                for (const span of node.spans || []) {
                    out.push({
                        name: node.text,
                        kind: node.kind,
                        parent,
                        start: span.start,
                        length: span.length,
                    });
                }
                for (const child of node.childItems || []) {
                    walk(child, node.text);
                }
            };
            walk(tree, null);
            return out.slice(0, DEFAULT_MAX_RESULTS);
        } finally {
            dispose();
        }
    }

    async _workspaceSymbols(/** @type {any} */ params, /** @type {any} */ signal) {
        this._assertNotAborted(signal);
        const query = String(params.query || '');
        const { languageService, dispose } = createLanguageService(this.rootDir, undefined);
        try {
            const maxResultCount = Number(params.maxResults || DEFAULT_MAX_RESULTS);
            const items = languageService.getNavigateToItems(query, undefined, undefined) || [];
            return items.slice(0, maxResultCount).map((/** @type {any} */ item) => ({
                name: item.name,
                kind: item.kind,
                filePath: item.fileName,
                containerName: item.containerName,
                matchKind: item.matchKind,
            }));
        } finally {
            dispose();
        }
    }

    async _diagnostics(/** @type {any} */ params, /** @type {any} */ signal) {
        this._assertNotAborted(signal);
        const filePath = ensureWorkspacePath(this.rootDir, params.filePath);
        const { languageService, dispose } = createLanguageService(this.rootDir, filePath);
        try {
            const source = languageService.getProgram()?.getSourceFile(filePath);
            if (!source) return [];
            const diagnostics = [
                ...languageService.getSyntacticDiagnostics(filePath),
                ...languageService.getSemanticDiagnostics(filePath),
                ...languageService.getSuggestionDiagnostics(filePath),
            ];
            return diagnostics.slice(0, DEFAULT_MAX_RESULTS).map((/** @type {any} */ diag) => {
                const start = offsetToLineChar(source, diag.start || 0);
                const end = offsetToLineChar(source, (diag.start || 0) + (diag.length || 0));
                return {
                    code: diag.code,
                    category: ts.DiagnosticCategory[diag.category],
                    message: formatDiagnosticMessage(diag),
                    line: start.line,
                    character: start.character,
                    endLine: end.line,
                    endCharacter: end.character,
                };
            });
        } finally {
            dispose();
        }
    }

    async _completion(/** @type {any} */ params, /** @type {any} */ signal) {
        this._assertNotAborted(signal);
        const filePath = ensureWorkspacePath(this.rootDir, params.filePath);
        const { languageService, dispose } = createLanguageService(this.rootDir, filePath);
        try {
            const source = languageService.getProgram()?.getSourceFile(filePath);
            if (!source) return [];
            const offset = lineCharToOffset(source, params.line, params.character);
            const list = languageService.getCompletionsAtPosition(filePath, offset, {});
            if (!list) return [];
            return list.entries.slice(0, DEFAULT_MAX_RESULTS).map((/** @type {any} */ entry) => ({
                name: entry.name,
                kind: entry.kind,
                kindModifiers: entry.kindModifiers,
                sortText: entry.sortText,
            }));
        } finally {
            dispose();
        }
    }

    async _updateFile(/** @type {any} */ params, /** @type {any} */ signal) {
        this._assertNotAborted(signal);
        const filePath = ensureWorkspacePath(this.rootDir, params.filePath);
        await fsp.writeFile(filePath, String(params.content || ''), 'utf8');
        // Invalida o cache: o próximo request verá o conteúdo atualizado do arquivo.
        _disposeCachedService(normalizePath(this.rootDir));
        return { updated: true };
    }

    async _codeActions(/** @type {any} */ params, /** @type {any} */ signal) {
        this._assertNotAborted(signal);
        const filePath = ensureWorkspacePath(this.rootDir, params.filePath);
        const { languageService, dispose } = createLanguageService(this.rootDir, filePath);
        try {
            const source = languageService.getProgram()?.getSourceFile(filePath);
            if (!source) return [];

            const start = lineCharToOffset(source, params.line, params.character);
            const end = lineCharToOffset(
                source,
                params.endLine || params.line,
                params.endCharacter || params.character
            );
            const diagnostics = [
                ...languageService.getSyntacticDiagnostics(filePath),
                ...languageService.getSemanticDiagnostics(filePath),
            ];
            const rangeCodes = diagnostics
                .filter((/** @type {any} */ diag) => {
                    const dStart = diag.start || 0;
                    const dEnd = dStart + (diag.length || 0);
                    return dStart <= end && dEnd >= start;
                })
                .map((/** @type {any} */ diag) => diag.code);

            if (rangeCodes.length === 0) return [];

            const fixes =
                languageService.getCodeFixesAtPosition(filePath, start, end, [...new Set(rangeCodes)], {}, {}) || [];

            const maxResults = Number(params.maxResults || process.env.LSP_MAX_RESULTS || DEFAULT_MAX_RESULTS);
            return fixes.slice(0, maxResults).map((fix, index) => ({
                id: `fix-${index + 1}`,
                title: fix.description,
                kind: 'quickfix',
                source: 'typescript',
                fixName: fix.fixName,
                edits: (fix.changes || []).flatMap((/** @type {any} */ change) =>
                    (change.textChanges || []).map((/** @type {any} */ textChange) => ({
                        filePath: change.fileName,
                        start: textChange.span.start,
                        length: textChange.span.length,
                        newText: textChange.newText,
                    }))
                ),
            }));
        } finally {
            dispose();
        }
    }

    async _applyCodeAction(/** @type {any} */ params, /** @type {any} */ signal) {
        this._assertNotAborted(signal);
        const mode = String(params.mode || 'preview');
        const action = params.action || {};
        const edits = Array.isArray(action.edits) ? action.edits : [];
        if (edits.length === 0) {
            throw new Error('LSP_CODE_ACTION_EMPTY_EDITS');
        }

        const totalBytes = edits.reduce(
            (/** @type {any} */ acc, /** @type {any} */ edit) =>
                acc + Buffer.byteLength(String(edit.newText || ''), 'utf8'),
            0
        );
        if (totalBytes > MAX_PATCH_BYTES) {
            throw new Error(`LSP_PATCH_TOO_LARGE: ${totalBytes} > ${MAX_PATCH_BYTES}`);
        }

        const grouped = new Map();
        for (const edit of edits) {
            const fullPath = ensureWorkspacePath(this.rootDir, edit.filePath);
            const list = grouped.get(fullPath) || [];
            list.push({
                start: Number(edit.start || 0),
                length: Number(edit.length || 0),
                newText: String(edit.newText || ''),
            });
            grouped.set(fullPath, list);
        }

        const previews = [];
        for (const [filePath, fileEdits] of grouped.entries()) {
            const before = await fsp.readFile(filePath, 'utf8');
            const after = applyTextChanges(before, fileEdits);
            previews.push({
                filePath,
                editCount: fileEdits.length,
                beforeBytes: Buffer.byteLength(before, 'utf8'),
                afterBytes: Buffer.byteLength(after, 'utf8'),
            });
        }

        if (mode === 'preview') {
            return {
                mode,
                title: action.title || 'Code action preview',
                files: previews,
                totalEdits: edits.length,
                totalBytes,
            };
        }

        if (mode !== 'apply') {
            throw new Error(`LSP_INVALID_APPLY_MODE: ${mode}`);
        }

        if (String(process.env.LSP_MUTATIONS_ENABLED || 'false') !== 'true') {
            throw new Error('LSP_MUTATIONS_DISABLED');
        }
        if (!params.confirmationToken || String(params.confirmationToken).trim() === '') {
            throw new Error('LSP_CONFIRMATION_TOKEN_REQUIRED');
        }

        for (const [filePath, fileEdits] of grouped.entries()) {
            const before = await fsp.readFile(filePath, 'utf8');
            const after = applyTextChanges(before, fileEdits);
            await fsp.writeFile(filePath, after, 'utf8');
        }

        return {
            mode,
            title: action.title || 'Code action applied',
            files: previews,
            totalEdits: edits.length,
            totalBytes,
        };
    }
}

/** @type {any} */ let singleton = null;

/**
 * @typedef {object} TsserverDaemonStartOptions
 * @property {string} [rootDir]
 * @property {number} [timeoutMs]
 */

/**
 * Returns the singleton wrapper around the local tsserver-backed language service.
 * @returns {import('./tsserver-contract.d.ts').TsserverDaemonFacade}
 */
export function getTsserverDaemon() {
    if (!singleton) {
        singleton = new TsserverDaemon({
            rootDir: process.cwd(),
            timeoutMs: Number(process.env.LSP_TOOL_TIMEOUT_MS || DEFAULT_TIMEOUT_MS),
        });
    }
    return singleton;
}

/**
 * Starts the singleton daemon and applies the optional timeout override.
 * @param {TsserverDaemonStartOptions} [options={}]
 * @returns {Promise<import('./tsserver-contract.d.ts').TsserverStartResult>}
 */
export async function startTsserverDaemon(/** @type {any} */ options = {}) {
    const daemon = getTsserverDaemon();
    if (/** @type {any} */ (options).timeoutMs) {
        daemon.timeoutMs = Number(/** @type {any} */ (options).timeoutMs);
    }
    return daemon.start();
}

/**
 * Stops the singleton daemon and aborts the queued in-flight request, when present.
 * @returns {Promise<import('./tsserver-contract.d.ts').TsserverStopResult>}
 */
export async function stopTsserverDaemon() {
    if (!singleton) return { stopped: true };
    return singleton.stop();
}

export { TsserverDaemon };
