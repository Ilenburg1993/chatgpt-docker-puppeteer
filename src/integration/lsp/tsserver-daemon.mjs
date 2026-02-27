import fs from 'node:fs';
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const DEFAULT_TIMEOUT_MS = Number(process.env.LSP_TOOL_TIMEOUT_MS || 15000);
const DEFAULT_MAX_RESULTS = Number(process.env.LSP_MAX_RESULTS || 200);
const MAX_PATCH_BYTES = 200 * 1024;

function normalizePath(p) {
    return path.resolve(String(p || '')).replace(/\\/g, '/');
}

function isInsideWorkspace(rootDir, filePath) {
    const root = normalizePath(rootDir);
    const full = normalizePath(filePath);
    return full === root || full.startsWith(`${root}/`);
}

function ensureWorkspacePath(rootDir, filePath) {
    const fullPath = path.resolve(rootDir, String(filePath || ''));
    if (!isInsideWorkspace(rootDir, fullPath)) {
        throw new Error(`LSP_PATH_OUTSIDE_WORKSPACE: ${filePath}`);
    }
    return fullPath;
}

function lineCharToOffset(sourceFile, line, character) {
    const safeLine = Math.max(0, Number(line || 1) - 1);
    const safeCharacter = Math.max(0, Number(character || 1) - 1);
    return ts.getPositionOfLineAndCharacter(sourceFile, safeLine, safeCharacter);
}

function offsetToLineChar(sourceFile, offset) {
    const lc = ts.getLineAndCharacterOfPosition(sourceFile, Math.max(0, offset || 0));
    return {
        line: lc.line + 1,
        character: lc.character + 1,
    };
}

function formatDiagnosticMessage(diag) {
    if (typeof diag.messageText === 'string') return diag.messageText;
    return ts.flattenDiagnosticMessageText(diag.messageText, '\n');
}

function applyTextChanges(originalText, textChanges) {
    const sorted = [...textChanges].sort((a, b) => b.start - a.start);
    let next = originalText;
    for (const change of sorted) {
        next = next.slice(0, change.start) + change.newText + next.slice(change.start + change.length);
    }
    return next;
}

function createLanguageService(rootDir, extraFile) {
    const configPath =
        ts.findConfigFile(rootDir, ts.sys.fileExists, 'tsconfig.json') ||
        ts.findConfigFile(rootDir, ts.sys.fileExists, 'jsconfig.json');

    let compilerOptions = {
        allowJs: true,
        checkJs: true,
        module: ts.ModuleKind.NodeNext,
        moduleResolution: ts.ModuleResolutionKind.NodeNext,
        target: ts.ScriptTarget.ES2022,
    };
    let fileNames = [];

    if (configPath) {
        const readConfig = ts.readConfigFile(configPath, ts.sys.readFile);
        if (readConfig.error) {
            throw new Error(`LSP_CONFIG_ERROR: ${formatDiagnosticMessage(readConfig.error)}`);
        }
        const parsed = ts.parseJsonConfigFileContent(readConfig.config, ts.sys, path.dirname(configPath));
        compilerOptions = { ...compilerOptions, ...parsed.options };
        fileNames = parsed.fileNames;
    }

    const fullExtra = extraFile ? normalizePath(extraFile) : null;
    if (fullExtra && !fileNames.includes(fullExtra)) {
        fileNames.push(fullExtra);
    }

    const scriptVersions = new Map(fileNames.map(f => [normalizePath(f), '1']));
    const normalizedFileNames = [...new Set(fileNames.map(normalizePath))];

    const host = {
        getScriptFileNames: () => normalizedFileNames,
        getScriptVersion: fileName => scriptVersions.get(normalizePath(fileName)) || '1',
        getScriptSnapshot: fileName => {
            const full = normalizePath(fileName);
            if (!fs.existsSync(full)) return undefined;
            const content = fs.readFileSync(full, 'utf8');
            return ts.ScriptSnapshot.fromString(content);
        },
        getCurrentDirectory: () => rootDir,
        getCompilationSettings: () => compilerOptions,
        getDefaultLibFileName: options => ts.getDefaultLibFilePath(options),
        fileExists: ts.sys.fileExists,
        readFile: ts.sys.readFile,
        readDirectory: ts.sys.readDirectory,
        directoryExists: ts.sys.directoryExists,
        getDirectories: ts.sys.getDirectories,
    };

    const languageService = ts.createLanguageService(host, ts.createDocumentRegistry());
    return {
        languageService,
        dispose: () => languageService.dispose(),
    };
}

/** Classe exportada: TsserverDaemon. */
class TsserverDaemon {
    constructor(options = {}) {
        this.rootDir = normalizePath(options.rootDir || process.cwd());
        this.timeoutMs = Number(options.timeoutMs || DEFAULT_TIMEOUT_MS);
        this.started = false;
        this.requestSeq = 0;
        /** @type {Promise<any>} */
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
        this.started = false;
        return { stopped: true };
    }

    async execute(operation, params = {}, options = {}) {
        if (!this.started) {
            await this.start();
        }

        const run = async () => {
            const requestId = `lsp-${++this.requestSeq}`;
            const timeoutMs = Number(options.timeoutMs || this.timeoutMs);
            const internal = new AbortController();
            const combined = options.signal ? AbortSignal.any([options.signal, internal.signal]) : internal.signal;
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

    async _dispatch(operation, params, signal) {
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

    _assertNotAborted(signal) {
        if (signal?.aborted) {
            throw new Error('LSP_CANCELLED');
        }
    }

    async _definition(params, signal) {
        this._assertNotAborted(signal);
        const filePath = ensureWorkspacePath(this.rootDir, params.filePath);
        const { languageService, dispose } = createLanguageService(this.rootDir, filePath);
        try {
            const source = languageService.getProgram()?.getSourceFile(filePath);
            if (!source) return [];
            const offset = lineCharToOffset(source, params.line, params.character);
            const defs = languageService.getDefinitionAtPosition(filePath, offset) || [];
            return defs
                .map(d => {
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

    async _references(params, signal) {
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
                .map(ref => {
                    const sourceFile = languageService.getProgram()?.getSourceFile(ref.fileName);
                    if (!sourceFile) return null;
                    const start = offsetToLineChar(sourceFile, ref.textSpan.start);
                    const end = offsetToLineChar(sourceFile, ref.textSpan.start + ref.textSpan.length);
                    const refAny = /** @type {any} */ (ref);
                    return {
                        filePath: ref.fileName,
                        line: start.line,
                        character: start.character,
                        endLine: end.line,
                        endCharacter: end.character,
                        isDefinition: Boolean(refAny.isDefinition),
                        isWriteAccess: Boolean(refAny.isWriteAccess),
                    };
                })
                .filter(Boolean);
        } finally {
            dispose();
        }
    }

    async _hover(params, signal) {
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

    async _documentSymbols(params, signal) {
        this._assertNotAborted(signal);
        const filePath = ensureWorkspacePath(this.rootDir, params.filePath);
        const { languageService, dispose } = createLanguageService(this.rootDir, filePath);
        try {
            const tree = languageService.getNavigationTree(filePath);
            if (!tree) return [];
            const out = [];
            const walk = (node, parent = null) => {
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

    async _workspaceSymbols(params, signal) {
        this._assertNotAborted(signal);
        const query = String(params.query || '');
        const { languageService, dispose } = createLanguageService(this.rootDir);
        try {
            const maxResultCount = Number(params.maxResults || DEFAULT_MAX_RESULTS);
            const items = languageService.getNavigateToItems(query, undefined, undefined) || [];
            return items.slice(0, maxResultCount).map(item => ({
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

    async _diagnostics(params, signal) {
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
            return diagnostics.slice(0, DEFAULT_MAX_RESULTS).map(diag => {
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

    async _completion(params, signal) {
        this._assertNotAborted(signal);
        const filePath = ensureWorkspacePath(this.rootDir, params.filePath);
        const { languageService, dispose } = createLanguageService(this.rootDir, filePath);
        try {
            const source = languageService.getProgram()?.getSourceFile(filePath);
            if (!source) return [];
            const offset = lineCharToOffset(source, params.line, params.character);
            const list = languageService.getCompletionsAtPosition(filePath, offset, {});
            if (!list) return [];
            return list.entries.slice(0, DEFAULT_MAX_RESULTS).map(entry => ({
                name: entry.name,
                kind: entry.kind,
                kindModifiers: entry.kindModifiers,
                sortText: entry.sortText,
            }));
        } finally {
            dispose();
        }
    }

    async _updateFile(params, signal) {
        this._assertNotAborted(signal);
        const filePath = ensureWorkspacePath(this.rootDir, params.filePath);
        await fsp.writeFile(filePath, String(params.content || ''), 'utf8');
        return { updated: true };
    }

    async _codeActions(params, signal) {
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
                .filter(diag => {
                    const dStart = diag.start || 0;
                    const dEnd = dStart + (diag.length || 0);
                    return dStart <= end && dEnd >= start;
                })
                .map(diag => diag.code);

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
                edits: (fix.changes || []).flatMap(change =>
                    (change.textChanges || []).map(textChange => ({
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

    async _applyCodeAction(params, signal) {
        this._assertNotAborted(signal);
        const mode = String(params.mode || 'preview');
        const action = params.action || {};
        const edits = Array.isArray(action.edits) ? action.edits : [];
        if (edits.length === 0) {
            throw new Error('LSP_CODE_ACTION_EMPTY_EDITS');
        }

        const totalBytes = edits.reduce((acc, edit) => acc + Buffer.byteLength(String(edit.newText || ''), 'utf8'), 0);
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

let singleton = null;

/** Função exportada: getTsserverDaemon. */
export function getTsserverDaemon() {
    if (!singleton) {
        singleton = new TsserverDaemon({
            rootDir: process.cwd(),
            timeoutMs: Number(process.env.LSP_TOOL_TIMEOUT_MS || DEFAULT_TIMEOUT_MS),
        });
    }
    return singleton;
}

/** Função exportada: startTsserverDaemon. */
export async function startTsserverDaemon(options = {}) {
    const daemon = getTsserverDaemon();
    if (options.timeoutMs) {
        daemon.timeoutMs = Number(options.timeoutMs);
    }
    return daemon.start();
}

/** Função exportada: stopTsserverDaemon. */
export async function stopTsserverDaemon() {
    if (!singleton) return { stopped: true };
    return singleton.stop();
}

export { TsserverDaemon };
