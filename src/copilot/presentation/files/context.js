// @ts-check
/**
 * @module copilot/presentation/runtime-file-context
 * @file Implementação compartilhada de contexto de arquivos/attachments consumida por bordas e pelo terminal.
 *
 *   Esta camada retira de `terminal/` a propriedade semântica sobre leitura, embedding e cache de arquivos.
 */

import { extname, resolve as pathResolve } from 'node:path';
import { logSwallowed, toError } from '../../core/error-handlers.js';
import { evaluateIoPathPolicyAsync } from '../../core/io-policy.js';
import { decodeBase64ToOwnedBuffer } from '../../infra/public/buffer.js';
import { readText, scanDirectory } from '../../infra/public/io.js';

/** Limite informativo histórico. Não bloqueia embedding em operações da LLM-B. */
export const MAX_EMBED_BYTES = Number.POSITIVE_INFINITY;

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
 *
 * @typedef {{ path: string; content: string; size: number; lang: string }} FileContext
 */

/**
 * Entrada no cache de file-context.
 *
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
 *
 * @returns {{ hits: number; misses: number; size: number }}
 */
export function getFileCacheStats() {
    return { hits: _fileCacheHits, misses: _fileCacheMisses, size: _fileCache.size };
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

    const now = Date.now();
    const cached = _fileCache.get(absPath);
    if (cached && cached.expiresAt > now) {
        _fileCacheHits++;
        return cached.ctx;
    }
    if (cached) _fileCache.delete(absPath);
    if (_fileCache.size > 200) {
        for (const [key, entry] of _fileCache) {
            if (entry.expiresAt <= now) _fileCache.delete(key);
        }
    }
    _fileCacheMisses++;

    const file = await readText(absPath);
    const ctx = {
        path: filePath,
        content: file.content,
        size: file.bytesRead,
        lang: detectLang(filePath),
    };
    _fileCache.set(absPath, { ctx, expiresAt: now + FILE_CACHE_TTL_MS });
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
    const strippedMessage = message.replace(pattern, (_match, quoted, plain) => {
        const p = quoted ?? plain;
        if (p) {
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
 * Lê todos os arquivos legíveis do diretório. Ignora arquivos binários e sub-diretórios. Lança erro se o diretório não
 * existir.
 *
 * @param {string} dirPath - Caminho do diretório (absoluto ou relativo ao cwd)
 * @returns {Promise<FileContext[]>} Lista de contextos dos arquivos lidos
 * @throws {Error} Se o diretório não existir ou não for legível
 */
export async function readDirectoryContext(dirPath) {
    const policy = await evaluateIoPathPolicyAsync(dirPath, { workspaceRoot: process.cwd(), mode: 'read' });
    if (!policy.ok) {
        throw new Error(policy.reason);
    }
    const absPath = pathResolve(policy.realPath);
    const scan = await scanDirectory(absPath, { showHidden: true, recursive: false });
    const files = scan.entries.filter((entry) => entry.type === 'file');

    /** @type {FileContext[]} */
    const ctxs = [];

    for (const entry of files) {
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
            const ctxs = await readDirectoryContext(att.path);
            if (ctxs.length === 0) return `*(Diretório \`${att.path}\` está vazio ou sem arquivos legíveis)*`;
            return `Contexto de diretório: \`${att.path}\`\n\n` + ctxs.map(buildBlock).join('\n\n');
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
