// @ts-check
/**
 * src/copilot/terminal/file-context.js
 * @module copilot/terminal/file-context
 * @see EventBus
 */

import { ToolError } from '#copilot/core';
import { readdir, readFile, stat } from 'node:fs/promises';
import { extname, join as pathJoin, resolve as pathResolve } from 'node:path';
import { logSwallowed } from '../core/error-handlers.js';

/** Limite total de bytes embutidos por envio (64 KB). */
export const MAX_EMBED_BYTES = 65_536;

/** TTL do cache de file-context em ms (30 segundos). */
const FILE_CACHE_TTL_MS = 30_000;

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
 * @typedef {{ path: string; content: string; size: number; lang: string }} FileContext
 */

/**
 * Entrada no cache de file-context.
 * @typedef {{ ctx: FileContext; expiresAt: number }} FileCacheEntry
 */

/** @type {Map<string, FileCacheEntry>} */
const _fileCache = new Map();

/** Contador de cache hits (para `cacheStats` no /health). */
let _fileCacheHits = 0;

/** Contador de cache misses (para `cacheStats` no /health). */
let _fileCacheMisses = 0;

/**
 * Retorna estatísticas de uso do cache de file-context.
 * @returns {{ hits: number; misses: number; size: number }}
 */
export function getFileCacheStats() {
    return { hits: _fileCacheHits, misses: _fileCacheMisses, size: _fileCache.size };
}
/**
 * Invalida todas as entradas do cache de file-context.
 * @returns {void}
 */
export function clearFileCache() {
    _fileCache.clear();
}
/**
 * Detecta a linguagem de marcação para um caminho de arquivo baseado na extensão.
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
 * AB.1: Usa cache em memória com TTL de 30s para evitar re-leituras desnecessárias. Emite erro se o arquivo não
 * existir, não for legível ou exceder `MAX_EMBED_BYTES`.
 * @param {string} filePath - Caminho (absoluto ou relativo ao cwd)
 * @returns {Promise<FileContext>}
 * @throws {Error} Se o arquivo não existir ou exceder o limite de tamanho
 */
export async function readFileContext(filePath) {
    const absPath = pathResolve(filePath);

    // AB.1: verificar cache antes de ler disco
    const now = Date.now();
    const cached = _fileCache.get(absPath);
    if (cached && cached.expiresAt > now) {
        _fileCacheHits++;
        return cached.ctx;
    }
    // Purgar entrada expirada (se houver) + purga lazy de entradas antigas quando cache é grande
    if (cached) _fileCache.delete(absPath);
    if (_fileCache.size > 200) {
        for (const [key, entry] of _fileCache) {
            if (entry.expiresAt <= now) _fileCache.delete(key);
        }
    }
    _fileCacheMisses++;

    const info = await stat(absPath);
    if (info.size > MAX_EMBED_BYTES) {
        throw new ToolError(
            `Arquivo muito grande para embed: ${filePath} (${(info.size / 1024).toFixed(1)} KB > 64 KB)`,
        );
    }
    const content = await readFile(absPath, 'utf-8');
    const ctx = {
        path: filePath,
        content,
        size: info.size,
        lang: detectLang(filePath),
    };
    _fileCache.set(absPath, { ctx, expiresAt: now + FILE_CACHE_TTL_MS });
    return ctx;
}
/**
 * Monta o bloco markdown para um único contexto de arquivo.
 * @param {FileContext} ctx - Contexto do arquivo
 * @returns {string}
 */
function buildBlock(ctx) {
    return `Contexto de arquivo: \`${ctx.path}\`\n\`\`\`${ctx.lang}\n${ctx.content}\n\`\`\``;
}
/**
 * Embute um único arquivo no início da mensagem.
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
 * Respeita `MAX_EMBED_BYTES` total: se o total acumulado exceder o limite, para de adicionar novos arquivos e retorna o
 * que couber.
 * @param {FileContext[]} ctxs - Lista de contextos na ordem desejada
 * @param {string} message - Mensagem original do usuário
 * @returns {string} Mensagem enriquecida com blocos de arquivo
 */
export function embedMultiple(ctxs, message) {
    let totalBytes = 0;
    const blocks = [];
    for (const ctx of ctxs) {
        if (totalBytes + ctx.size > MAX_EMBED_BYTES) {
            break;
        }
        blocks.push(buildBlock(ctx));
        totalBytes += ctx.size;
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
 * @param {string} message - Mensagem original
 * @returns {{ paths: string[]; strippedMessage: string }} Caminhos extraídos e mensagem sem as referências
 */
export function extractAtReferences(message) {
    /** @type {string[]} */
    const paths = [];
    // Captura @"..." ou @palavra (sem espaços, pode conter /.-_)
    const pattern = /@"([^"]+)"|@([\w./\-_]+)/g;
    const strippedMessage = message.replace(pattern, (_match, quoted, plain) => {
        const p = quoted ?? plain;
        if (p) {
            // T-11: rejeitar emails e domínios (@user@host, @domain.tld sem /)
            // Um caminho válido deve conter / ou começar com . ou ~ ou ser palavra simples sem ponto
            const isLikelyEmail = /^[^/]+\.[a-z]{2,}$/i.test(p);
            if (!isLikelyEmail) paths.push(p);
        }
        return '';
    });
    return { paths, strippedMessage: strippedMessage.trim() };
}
/**
 * Lê os arquivos de um diretório (shallow, não recursivo) e retorna seus contextos.
 *
 * Respeita `MAX_EMBED_BYTES` total: para de adicionar arquivos quando o limite é atingido. Ignora arquivos binários e
 * sub-diretórios. Lança erro se o diretório não existir.
 * @param {string} dirPath - Caminho do diretório (absoluto ou relativo ao cwd)
 * @returns {Promise<FileContext[]>} Lista de contextos dos arquivos lidos
 * @throws {Error} Se o diretório não existir ou não for legível
 */
export async function readDirectoryContext(dirPath) {
    const absPath = pathResolve(dirPath);
    const entries = await readdir(absPath, { withFileTypes: true });
    const files = entries.filter((e) => e.isFile()).map((e) => pathJoin(absPath, e.name));

    // T-12: paralelizar stat() para reduzir latência em diretórios grandes
    const statResults = await Promise.allSettled(
        files.map(async (filePath) => {
            const info = await stat(filePath);
            return { filePath, size: info.size };
        }),
    );

    let totalBytes = 0;
    /** @type {FileContext[]} */
    const ctxs = [];

    for (const result of statResults) {
        if (result.status !== 'fulfilled') continue;
        const { filePath, size } = result.value;
        if (size === 0 || totalBytes + size > MAX_EMBED_BYTES) continue;
        try {
            const content = await readFile(filePath, 'utf-8');
            // Verifica se é texto (rejeita binários por heurística: NUL byte)
            if (content.includes('\0')) continue;
            const ctx = { path: filePath, content, size, lang: detectLang(filePath) };
            ctxs.push(ctx);
            totalBytes += size;
        } catch (/** @type {any} */ e) {
            logSwallowed(e, 'terminal.fileContext.readFile');
        }
    }

    return ctxs;
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
 * (`ask_user`), sem criar novos PRs via `session.send()`. A decisão sobre o caminho de execução é feita aqui —
 * `sendTurn` nunca precisa saber sobre attachments nativos SDK.
 *
 * Mapeamento de tipos:
 *
 * - `file` → lê o arquivo e cria bloco markdown com o conteúdo
 * - `directory` → lista arquivos do diretório e cria blocos para cada um
 * - `selection` → usa `text` como conteúdo do bloco markdown
 * - `content` → usa `content` diretamente como bloco markdown
 * - `blob` → decodifica base64 e embute como bloco de texto (F6.8, SDK v0.2.0+)
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
        } catch (/** @type {any} */ e) {
            return `*(Arquivo \`${att.path}\` não pôde ser lido: ${e.message})*`;
        }
    }

    if (att.type === 'directory' && typeof att.path === 'string') {
        try {
            const ctxs = await readDirectoryContext(att.path);
            if (ctxs.length === 0) return `*(Diretório \`${att.path}\` está vazio ou sem arquivos legíveis)*`;
            return `Contexto de diretório: \`${att.path}\`\n\n` + ctxs.map(buildBlock).join('\n\n');
        } catch (/** @type {any} */ e) {
            return `*(Diretório \`${att.path}\` não pôde ser lido: ${e.message})*`;
        }
    }

    if (att.type === 'selection' && typeof att.text === 'string' && att.text.length > 0) {
        const lang = typeof att.filePath === 'string' ? detectLang(att.filePath) : 'text';
        return `Seleção de \`${label}\`\n\`\`\`${lang}\n${att.text}\n\`\`\``;
    }

    // F6.8 (UPG-04): suporte a type: 'blob' (base64) adicionado no SDK v0.2.0
    if (att.type === 'blob' && typeof att.data === 'string') {
        const mimeType = typeof att.mimeType === 'string' ? att.mimeType : 'application/octet-stream';
        // T-13: verificar mimeType antes de tentar decodificar como texto
        const isText =
            mimeType.startsWith('text/') ||
            mimeType === 'application/json' ||
            mimeType === 'application/xml' ||
            mimeType === 'application/javascript' ||
            mimeType === 'application/typescript';
        let decodedContent;
        if (!isText) {
            // Binário: não tenta decodificar como UTF-8
            decodedContent = `(dados binários, mimeType: ${mimeType})`;
        } else {
            try {
                const text = Buffer.from(att.data, 'base64').toString('utf8');
                // Heurística adicional: rejeitar se contém NUL bytes
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
