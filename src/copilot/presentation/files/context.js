// @ts-check
/**
 * @module copilot/presentation/runtime-file-context
 * @file Implementação compartilhada de contexto de arquivos/attachments consumida por bordas e pelo terminal.
 *
 *   Esta camada retira de `terminal/` a propriedade semântica sobre leitura, embedding e cache de arquivos.
 */

import { normalizeIoCacheKey } from '#copilot/infra/public/cache';
import { registerIoInvalidationHook } from '#copilot/infra/public/filesystem/invalidation';
import { createWorkspaceIo } from '#copilot/infra/public/filesystem/workspace';
import { createWorkspaceIndexing } from '#copilot/infra/public/indexing/workspace';
import { decodeBase64ToOwnedBuffer } from '#copilot/infra/public/platform';
import { extname, resolve as pathResolve, sep } from 'node:path';
import { logSwallowed, toError } from '../../core/error-handlers.js';
import { evaluateIoPathPolicyAsync } from '../../core/io-policy.js';

/** Limite informativo histórico. Não bloqueia embedding em operações da LLM-B. */
export const MAX_EMBED_BYTES = Number.POSITIVE_INFINITY;

/** TTL do cache de file-context em ms (30 segundos). */
const FILE_CACHE_TTL_MS = 30_000;
const FILE_CACHE_MAX_ENTRIES = Math.max(1, Number(process.env['FILE_CONTEXT_CACHE_MAX_ENTRIES'] ?? 200));
const DIRECTORY_CONTEXT_MAX_FILES = Math.max(1, Number(process.env['FILE_CONTEXT_DIRECTORY_MAX_FILES'] ?? 50));
const presentationWorkspaceRoot = process.cwd();
const { readText } = createWorkspaceIo({ workspaceRoot: presentationWorkspaceRoot });
const { scanDirectory } = createWorkspaceIndexing({ workspaceRoot: presentationWorkspaceRoot });

/** Mapa de extensão → linguagem para blocos de código markdown. @type {Record<string, string>} */
const EXT_LANG = {
    '.js': 'js',
    '.mjs': 'js',
    '.cjs': 'js',
    '.ts': 'ts',
    '.mts': 'ts',
    '.cts': 'ts',
    '.json': 'json',
    '.jsonl': 'json',
    '.md': 'md',
    '.markdown': 'md',
    '.sh': 'bash',
    '.bash': 'bash',
    '.zsh': 'bash',
    '.yml': 'yaml',
    '.yaml': 'yaml',
    '.toml': 'toml',
    '.py': 'python',
    '.rb': 'ruby',
    '.go': 'go',
    '.rs': 'rust',
    '.java': 'java',
    '.c': 'c',
    '.cpp': 'cpp',
    '.h': 'c',
    '.cs': 'csharp',
    '.html': 'html',
    '.css': 'css',
    '.sql': 'sql',
    '.xml': 'xml',
    '.vue': 'vue',
    '.svelte': 'svelte',
    '.txt': 'text',
    '.log': 'text',
    '.env': 'bash',
};

/**
 * Contexto de um arquivo lido para embedding.
 *
 * @typedef {{ path: string; content: string; size: number; lang: string }} FileContext
 */

/**
 * Entrada no cache de file-context.
 *
 * @typedef {{ ctx: FileContext; expiresAt: number }} FileCacheEntry
 *
 * @typedef {{
 *     contexts: FileContext[];
 *     truncated: boolean;
 *     scannedEntries: number;
 *     returnedFiles: number;
 *     totalCandidateFiles: number;
 *     maxFiles: number;
 * }} DirectoryContextResult
 */

/** @type {Map<string, FileCacheEntry>} */
const _fileCache = new Map();

/** Contador de cache hits (para `cacheStats` no /health). */
let _fileCacheHits = 0;

/** Contador de cache misses (para `cacheStats` no /health). */
let _fileCacheMisses = 0;
let _fileCacheInvalidations = 0;

/**
 * @param {string} filePath
 * @returns {string}
 */
function fileContextCacheKey(filePath) {
    return normalizeIoCacheKey(filePath);
}

/**
 * @param {number} now
 * @returns {void}
 */
function pruneExpiredFileCacheEntries(now = Date.now()) {
    for (const [key, entry] of _fileCache) {
        if (entry.expiresAt <= now) _fileCache.delete(key);
    }
}

/**
 * @returns {void}
 */
function enforceFileCacheEntryLimit() {
    while (_fileCache.size > FILE_CACHE_MAX_ENTRIES) {
        const oldestKey = _fileCache.keys().next().value;
        if (typeof oldestKey !== 'string') return;
        _fileCache.delete(oldestKey);
    }
}

/**
 * @param {string} filePath
 * @param {{ recursive?: boolean }} [options]
 * @returns {number}
 */
function invalidateFileContextCachePath(filePath, options = {}) {
    const normalized = fileContextCacheKey(filePath);
    let removed = 0;
    if (options.recursive === true) {
        const subtreePrefix = `${normalized}${sep}`;
        for (const key of [..._fileCache.keys()]) {
            if (key === normalized || key.startsWith(subtreePrefix)) {
                _fileCache.delete(key);
                removed += 1;
            }
        }
    } else if (_fileCache.delete(normalized)) {
        removed = 1;
    }
    _fileCacheInvalidations += removed;
    return removed;
}

registerIoInvalidationHook((filePath, event) => {
    try {
        invalidateFileContextCachePath(filePath, { recursive: event?.recursive === true });
    } catch {
        /* cache de contexto nunca deve derrubar a mutação canônica de IO */
    }
});

/**
 * Retorna estatísticas de uso do cache de file-context.
 *
 * @returns {{ hits: number; misses: number; invalidations: number; size: number; maxEntries: number; ttlMs: number }}
 */
export function getFileCacheStats() {
    pruneExpiredFileCacheEntries();
    return {
        hits: _fileCacheHits,
        misses: _fileCacheMisses,
        invalidations: _fileCacheInvalidations,
        size: _fileCache.size,
        maxEntries: FILE_CACHE_MAX_ENTRIES,
        ttlMs: FILE_CACHE_TTL_MS,
    };
}
/**
 * Invalida todas as entradas do cache de file-context.
 *
 * @returns {void}
 */
export function clearFileCache() {
    _fileCache.clear();
}
/**
 * Detecta a linguagem de marcação para um caminho de arquivo baseado na extensão.
 *
 * @param {string} filePath - Caminho do arquivo
 * @returns {string} Rótulo de linguagem para bloco de código markdown
 */
export function detectLang(filePath) {
    const ext = extname(filePath).toLowerCase();
    return EXT_LANG[ext] ?? 'text';
}
/**
 * Lê um arquivo e retorna seu contexto estruturado para embedding.
 *
 * AB.1: Usa cache em memória com TTL de 30s para evitar re-leituras desnecessárias. Emite erro se o arquivo não existir
 * ou não for legível. Tamanho é metadata informativa, não bloqueio.
 *
 * @param {string} filePath - Caminho (absoluto ou relativo ao cwd)
 * @returns {Promise<FileContext>}
 * @throws {Error} Se o arquivo não existir
 */
export async function readFileContext(filePath) {
    const policy = await evaluateIoPathPolicyAsync(filePath, { workspaceRoot: process.cwd(), mode: 'read' });
    if (!policy.ok) {
        throw new Error(policy.reason);
    }
    const absPath = pathResolve(policy.realPath);
    const cacheKey = fileContextCacheKey(absPath);

    const now = Date.now();
    const cached = _fileCache.get(cacheKey);
    if (cached && cached.expiresAt > now) {
        _fileCache.delete(cacheKey);
        _fileCache.set(cacheKey, cached);
        _fileCacheHits++;
        return cached.ctx;
    }
    if (cached) _fileCache.delete(cacheKey);
    pruneExpiredFileCacheEntries(now);
    enforceFileCacheEntryLimit();
    _fileCacheMisses++;

    const file = await readText(absPath);
    const ctx = {
        path: filePath,
        content: file.content,
        size: file.bytesRead,
        lang: detectLang(filePath),
    };
    _fileCache.set(cacheKey, { ctx, expiresAt: now + FILE_CACHE_TTL_MS });
    enforceFileCacheEntryLimit();
    return ctx;
}
/**
 * Monta o bloco markdown para um único contexto de arquivo.
 *
 * @param {FileContext} ctx - Contexto do arquivo
 * @returns {string}
 */
function buildBlock(ctx) {
    return `Contexto de arquivo: \`${ctx.path}\`\n\`\`\`${ctx.lang}\n${ctx.content}\n\`\`\``;
}
/**
 * Embute um único arquivo no início da mensagem.
 *
 * @param {FileContext} ctx - Contexto do arquivo
 * @param {string} message - Mensagem original do usuário
 * @returns {string} Mensagem enriquecida com o bloco de arquivo
 */
export function embedContextBlock(ctx, message) {
    return `${buildBlock(ctx)}\n\n${message}`;
}
/**
 * Embute múltiplos arquivos no início da mensagem, empilhados em ordem.
 *
 * Mantém todos os arquivos informados. `MAX_EMBED_BYTES` permanece apenas como dado informativo histórico.
 *
 * @param {FileContext[]} ctxs - Lista de contextos na ordem desejada
 * @param {string} message - Mensagem original do usuário
 * @returns {string} Mensagem enriquecida com blocos de arquivo
 */
export function embedMultiple(ctxs, message) {
    const blocks = [];
    for (const ctx of ctxs) {
        blocks.push(buildBlock(ctx));
    }
    if (blocks.length === 0) return message;
    return `${blocks.join('\n\n')}\n\n${message}`;
}
/**
 * Extrai referências `@caminho` de uma mensagem e retorna os caminhos encontrados.
 *
 * Suporta:
 *
 * - `@src/copilot/agent/always-alive.js`
 * - `@./config.json`
 * - `@config.json`
 * - `@"path com espaço/arquivo.js"`
 *
 * @param {string} message - Mensagem original
 * @returns {{ paths: string[]; strippedMessage: string }} Caminhos extraídos e mensagem sem as referências
 */
export function extractAtReferences(message) {
    /** @type {string[]} */
    const paths = [];
    const pattern = /@"([^"]+)"|@([\w./\-_]+)/g;
    const strippedMessage = message.replace(pattern, (match, quoted, plain, offset, fullText) => {
        const p = quoted ?? plain;
        if (p) {
            const previousChar = offset > 0 ? fullText[offset - 1] : '';
            const nextChar = fullText[offset + match.length] ?? '';
            const isEmailFragment = /[\w.-]/u.test(previousChar) || previousChar === '@' || nextChar === '@';
            const isPathLike =
                quoted !== undefined || p.startsWith('.') || p.startsWith('/') || p.includes('/') || p.includes('.');
            if (isEmailFragment || !isPathLike) return match;
            paths.push(p);
        }
        return '';
    });
    return { paths, strippedMessage: strippedMessage.trim() };
}
/**
 * Lê os arquivos de um diretório (shallow, não recursivo) e retorna contextos com metadados de truncamento.
 *
 * Lê até `maxFiles` arquivos legíveis do diretório. Ignora arquivos binários e sub-diretórios. Lança erro se o
 * diretório não existir.
 *
 * @param {string} dirPath - Caminho do diretório (absoluto ou relativo ao cwd)
 * @param {{ maxFiles?: number }} [options]
 * @returns {Promise<DirectoryContextResult>}
 * @throws {Error} Se o diretório não existir ou não for legível
 */
export async function readDirectoryContextDetailed(dirPath, options = {}) {
    const policy = await evaluateIoPathPolicyAsync(dirPath, { workspaceRoot: process.cwd(), mode: 'read' });
    if (!policy.ok) {
        throw new Error(policy.reason);
    }
    const absPath = pathResolve(policy.realPath);
    const maxFiles =
        Number.isFinite(options.maxFiles) && Number(options.maxFiles) > 0
            ? Math.floor(Number(options.maxFiles))
            : DIRECTORY_CONTEXT_MAX_FILES;
    const scan = await scanDirectory(absPath, {
        showHidden: true,
        recursive: false,
        maxEntries: maxFiles + 1,
        fingerprint: false,
    });
    const files = scan.entries.filter((entry) => entry.type === 'file');
    const limitedFiles = files.slice(0, maxFiles);
    const scanTruncated = scan.io.advisoryLimits?.['hardLimitReached'] === true;

    /** @type {FileContext[]} */
    const ctxs = [];

    for (const entry of limitedFiles) {
        if ((entry.size ?? 0) === 0) continue;
        try {
            const file = await readText(entry.absolutePath);
            const content = file.content;
            if (content.includes('\0')) continue;
            const ctx = {
                path: entry.absolutePath,
                content,
                size: entry.size ?? file.bytesRead,
                lang: detectLang(entry.absolutePath),
            };
            ctxs.push(ctx);
        } catch (e) {
            logSwallowed(e, 'runtimeFileContext.readFile');
        }
    }

    return {
        contexts: ctxs,
        truncated: scanTruncated || files.length > limitedFiles.length,
        scannedEntries: scan.scannedEntries,
        returnedFiles: ctxs.length,
        totalCandidateFiles: files.length,
        maxFiles,
    };
}
/**
 * Lê os arquivos de um diretório (shallow, não recursivo) e retorna seus contextos.
 *
 * @param {string} dirPath - Caminho do diretório (absoluto ou relativo ao cwd)
 * @returns {Promise<FileContext[]>} Lista de contextos dos arquivos lidos
 * @throws {Error} Se o diretório não existir ou não for legível
 */
export async function readDirectoryContext(dirPath) {
    return (await readDirectoryContextDetailed(dirPath)).contexts;
}
/**
 * @typedef {Object} RawAttachment
 * @property {string} [type] - Tipo do attachment: 'file' | 'directory' | 'selection' | 'content' | 'blob'
 * @property {string} [path] - Caminho do arquivo/diretório (tipos 'file' e 'directory')
 * @property {string} [filePath] - Caminho do arquivo de seleção (tipo 'selection')
 * @property {string} [displayName] - Nome de exibição opcional
 * @property {string} [content] - Conteúdo inline (tipo 'content')
 * @property {string} [text] - Texto da seleção (tipo 'selection')
 * @property {object} [selection] - Coordenadas da seleção (tipo 'selection')
 * @property {string} [data] - Conteúdo base64 (tipo 'blob', SDK v0.2.0+)
 * @property {string} [mimeType] - MIME type do blob (tipo 'blob', padrão: 'application/octet-stream')
 */

/**
 * Converte um attachment de qualquer tipo em texto markdown para embed no dialog loop.
 *
 * **Arquitetura zero-PR**: todos os tipos de attachment são convertidos em texto embeddado e enviados via dialog loop
 * (`ask_user`), sem criar novos PRs via `session.send()`. A decisão sobre o caminho de execução é feita aqui.
 *
 * @param {RawAttachment} att - Attachment a converter
 * @returns {Promise<string | null>} Texto markdown, ou null se o attachment for inválido/vazio
 */
export async function attachmentToEmbed(att) {
    if (!att || typeof att !== 'object') return null;

    const label = att.displayName ?? att.path ?? att.filePath ?? 'attachment';

    if (att.type === 'file' && typeof att.path === 'string') {
        try {
            const ctx = await readFileContext(att.path);
            return buildBlock(ctx);
        } catch (e) {
            return `*(Arquivo \`${att.path}\` não pôde ser lido: ${toError(e).message})*`;
        }
    }

    if (att.type === 'directory' && typeof att.path === 'string') {
        try {
            const directory = await readDirectoryContextDetailed(att.path);
            const ctxs = directory.contexts;
            if (ctxs.length === 0) return `*(Diretório \`${att.path}\` está vazio ou sem arquivos legíveis)*`;
            const truncationNote = directory.truncated
                ? `\n\n*(Diretório truncado: ${directory.returnedFiles}/${directory.totalCandidateFiles} arquivos legíveis embutidos; limite ${directory.maxFiles}, entradas escaneadas ${directory.scannedEntries}.)*`
                : '';
            return `Contexto de diretório: \`${att.path}\`\n\n` + ctxs.map(buildBlock).join('\n\n') + truncationNote;
        } catch (e) {
            return `*(Diretório \`${att.path}\` não pôde ser lido: ${toError(e).message})*`;
        }
    }

    if (att.type === 'selection' && typeof att.text === 'string' && att.text.length > 0) {
        const lang = typeof att.filePath === 'string' ? detectLang(att.filePath) : 'text';
        return `Seleção de \`${label}\`\n\`\`\`${lang}\n${att.text}\n\`\`\``;
    }

    if (att.type === 'blob' && typeof att.data === 'string') {
        const mimeType = typeof att.mimeType === 'string' ? att.mimeType : 'application/octet-stream';
        const isText =
            mimeType.startsWith('text/') ||
            mimeType === 'application/json' ||
            mimeType === 'application/xml' ||
            mimeType === 'application/javascript' ||
            mimeType === 'application/typescript';
        let decodedContent;
        if (!isText) {
            decodedContent = `(dados binários, mimeType: ${mimeType})`;
        } else {
            try {
                const text = decodeBase64ToOwnedBuffer(att.data, 'attachment blob').toString('utf8');
                decodedContent = text.includes('\0') ? `(dados binários, mimeType: ${mimeType})` : text;
            } catch {
                decodedContent = `(dados binários, mimeType: ${mimeType})`;
            }
        }
        return `Blob \`${label}\` (${mimeType})\n\`\`\`\n${decodedContent}\n\`\`\``;
    }

    if (typeof att.content === 'string' && att.content.length > 0) {
        return `\`\`\`\n${att.content}\n\`\`\`\n*(${label})*`;
    }

    return null;
}
