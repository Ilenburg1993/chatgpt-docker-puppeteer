// @ts-check
/**
 * src/copilot/terminal/file-context.js
 *
 * Utilitários para leitura e embedding de contexto de arquivo no terminal LLM-B.
 *
 * Permite ao usuário referenciar arquivos no texto da mensagem (via `@caminho`) ou adicioná-los a uma fila explícita
 * (`/attach`). O conteúdo é injetado como bloco markdown estruturado no corpo da mensagem antes de seguir para
 * `sendTurn()`.
 *
 * @module copilot/terminal/file-context
 */

import { readFile, stat } from 'node:fs/promises';
import { extname, resolve as pathResolve } from 'node:path';

// ─── Constantes ───────────────────────────────────────────────────────────────

/** Limite total de bytes embutidos por envio (64 KB). */
export const MAX_EMBED_BYTES = 65_536;

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

// ─── Tipos ────────────────────────────────────────────────────────────────────

/**
 * Contexto de um arquivo lido para embedding.
 *
 * @typedef {{ path: string; content: string; size: number; lang: string }} FileContext
 */

// ─── Funções públicas ─────────────────────────────────────────────────────────

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
 * Emite erro se o arquivo não existir, não for legível ou exceder `MAX_EMBED_BYTES`.
 *
 * @param {string} filePath - Caminho (absoluto ou relativo ao cwd)
 * @returns {Promise<FileContext>}
 * @throws {Error} Se o arquivo não existir ou exceder o limite de tamanho
 */
export async function readFileContext(filePath) {
    const absPath = pathResolve(filePath);
    const info = await stat(absPath);
    if (info.size > MAX_EMBED_BYTES) {
        throw new Error(`Arquivo muito grande para embed: ${filePath} (${(info.size / 1024).toFixed(1)} KB > 64 KB)`);
    }
    const content = await readFile(absPath, 'utf-8');
    return {
        path: filePath,
        content,
        size: info.size,
        lang: detectLang(filePath),
    };
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
 * Respeita `MAX_EMBED_BYTES` total: se o total acumulado exceder o limite, para de adicionar novos arquivos e retorna o
 * que couber.
 *
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
 *
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
        if (p) paths.push(p);
        return '';
    });
    return { paths, strippedMessage: strippedMessage.trim() };
}
