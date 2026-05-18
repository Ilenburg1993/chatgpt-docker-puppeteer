// @ts-check
/**
 * src/copilot/terminal/commands/attach.js
 *
 * Comando `/attach` para gerenciar a fila de arquivos a embutir no próximo turno.
 *
 * Sintaxe:
 *
 * - `/attach` → exibe fila atual
 * - `/attach <path>` → adiciona arquivo à fila
 * - `/attach clear` → limpa a fila
 *
 * @module copilot/terminal/commands/attach
 * @see EventBus
 */

import { access, stat } from 'node:fs/promises';
import { MAX_EMBED_BYTES } from '../../presentation/files/index.js';
import { addAttachment, clearAttachments, getAttachmentQueue } from '../../presentation/state/index.js';

/**
 * @param {string | Record<string, unknown>} entry
 * @returns {string}
 */
function describeAttachmentEntry(entry) {
    if (typeof entry === 'string') return entry;
    const type = typeof entry?.['type'] === 'string' ? entry['type'] : 'file';
    if ((type === 'file' || type === 'directory') && typeof entry?.['path'] === 'string') return entry['path'];
    if (type === 'selection' && typeof entry?.['filePath'] === 'string') {
        return `${entry['filePath']} [selection]`;
    }
    if (type === 'blob') {
        const displayName = typeof entry?.['displayName'] === 'string' ? entry['displayName'] : 'blob';
        const mimeType = typeof entry?.['mimeType'] === 'string' ? entry['mimeType'] : 'application/octet-stream';
        return `${displayName} [blob:${mimeType}]`;
    }
    if (typeof entry?.['displayName'] === 'string') return entry['displayName'];
    return JSON.stringify(entry);
}

/**
 * @param {string} raw
 * @returns {{ mimeType: string; data: string; displayName?: string } | { error: string } | null}
 */
function parseBlobAttachArgs(raw) {
    const parts = raw.trim().split(/\s+/).filter(Boolean);
    if (parts[0] !== 'blob') return null;
    if (parts.length < 3) {
        return { error: 'Uso: /attach blob <mimeType> <base64> [--name <displayName>]' };
    }
    const mimeType = parts[1] ?? '';
    const data = parts[2] ?? '';
    let displayName;
    for (let i = 3; i < parts.length; i++) {
        if (parts[i] === '--name') {
            const candidate = parts[i + 1] ?? '';
            if (candidate.trim()) {
                displayName = candidate.trim();
                i += 1;
            }
        }
    }
    return { mimeType, data, ...(displayName ? { displayName } : {}) };
}

/**
 * Handler do comando `/attach`.
 *
 * @param {{ println: (text: string) => void }} ctx
 * @param {string} arg - Argumento passado após `/attach`
 * @returns {Promise<void>}
 * @throws {Error} Se o acesso ao arquivo falhar ou stat retornar erro
 */
export async function cmdAttach({ println }, arg) {
    const trimmed = (arg ?? '').trim();

    // Sem argumento: exibe fila atual
    if (!trimmed) {
        const queue = getAttachmentQueue();
        if (queue.length === 0) {
            println(
                '\x1b[90m  Fila de attachments vazia. Use /attach <caminho> ou /attach blob <mime> <base64>.\x1b[0m',
            );
        } else {
            println(`\x1b[36m  📎 Fila de attachments (${queue.length} item(ns)):\x1b[0m`);
            for (let i = 0; i < queue.length; i++) {
                const entry = queue[i];
                if (entry === undefined) continue;
                println(`    \x1b[33m${i + 1}.\x1b[0m ${describeAttachmentEntry(entry)}`);
            }
            println('\x1b[90m  Serão embutidos no próximo turno. Use /attach clear para limpar.\x1b[0m');
        }
        return;
    }

    // clear
    if (trimmed.toLowerCase() === 'clear') {
        clearAttachments();
        println('\x1b[90m  Fila de attachments limpa.\x1b[0m');
        return;
    }

    const blobArgs = parseBlobAttachArgs(trimmed);
    if (blobArgs) {
        if ('error' in blobArgs) {
            println(`\x1b[31m  ✗ ${blobArgs.error}\x1b[0m`);
            return;
        }
        addAttachment({
            type: 'blob',
            data: blobArgs.data,
            mimeType: blobArgs.mimeType,
            ...(blobArgs.displayName ? { displayName: blobArgs.displayName } : {}),
        });
        const queue = getAttachmentQueue();
        println(
            `\x1b[32m  ✓ Blob adicionado à fila:\x1b[0m ${blobArgs.displayName ?? 'blob'} \x1b[90m(${blobArgs.mimeType})\x1b[0m`,
        );
        println(`\x1b[90m  Fila: ${queue.length} item(ns) — serão embutidos no próximo turno.\x1b[0m`);
        return;
    }

    // Adicionar arquivo
    const filePath = trimmed;
    try {
        await access(filePath);
        const info = await stat(filePath);
        if (info.size > MAX_EMBED_BYTES) {
            println(
                `\x1b[33m  ⚠️  Arquivo muito grande: ${filePath} (${(info.size / 1024).toFixed(1)} KB > 64 KB)\x1b[0m`,
            );
            println('\x1b[90m  Limite por envio é 64 KB total. Arquivo não adicionado.\x1b[0m');
            return;
        }
        addAttachment(filePath);
        const queue = getAttachmentQueue();
        println(
            `\x1b[32m  ✓ Adicionado à fila:\x1b[0m ${filePath} \x1b[90m(${(info.size / 1024).toFixed(1)} KB)\x1b[0m`,
        );
        println(`\x1b[90m  Fila: ${queue.length} item(ns) — serão embutidos no próximo turno.\x1b[0m`);
    } catch {
        println(`\x1b[31m  ✗ Arquivo não encontrado ou sem permissão: ${filePath}\x1b[0m`);
    }
}
