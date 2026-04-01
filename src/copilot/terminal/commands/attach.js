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
 */

import { access, stat } from 'node:fs/promises';
import { MAX_EMBED_BYTES } from '../file-context.js';
import { addAttachment, clearAttachments, getAttachmentQueue } from '../state.js';

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
            println('\x1b[90m  Fila de arquivos vazia. Use /attach <caminho> para adicionar.\x1b[0m');
        } else {
            println(`\x1b[36m  📎 Fila de attachments (${queue.length} arquivo(s)):\x1b[0m`);
            for (let i = 0; i < queue.length; i++) {
                println(`    \x1b[33m${i + 1}.\x1b[0m ${queue[i]}`);
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
        println(`\x1b[90m  Fila: ${queue.length} arquivo(s) — serão embutidos no próximo turno.\x1b[0m`);
    } catch {
        println(`\x1b[31m  ✗ Arquivo não encontrado ou sem permissão: ${filePath}\x1b[0m`);
    }
}
