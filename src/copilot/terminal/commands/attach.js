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

import { statPathTrusted } from '#copilot/infra/public/trusted-io';
import { MAX_EMBED_BYTES } from '../../presentation/files/index.js';
import { addAttachment, clearAttachments, getAttachmentQueue } from '../../presentation/state/index.js';
import { formatTerminalToolPathForOperator } from '../events/presenters/tools/index.js';
import { terminalThemeHeadline, terminalThemeRow } from '../state/ui/index.js';

/**
 * @param {number} count
 * @param {string} singular
 * @param {string} plural
 * @returns {string}
 */
function countLabel(count, singular, plural) {
    return `${count} ${count === 1 ? singular : plural}`;
}

/**
 * @param {number} count
 * @returns {string}
 */
function attachmentQueueNextTurnLabel(count) {
    const action = count === 1 ? 'será embutido' : 'serão embutidos';
    return `${countLabel(count, 'item', 'itens')} na fila · ${action} no próximo turno`;
}

/**
 * @param {string | Record<string, unknown>} entry
 * @returns {string}
 */
function describeAttachmentEntry(entry) {
    if (typeof entry === 'string') return formatTerminalToolPathForOperator(entry);
    const type = typeof entry?.['type'] === 'string' ? entry['type'] : 'file';
    if ((type === 'file' || type === 'directory') && typeof entry?.['path'] === 'string') {
        return formatTerminalToolPathForOperator(entry['path']);
    }
    if (type === 'selection' && typeof entry?.['filePath'] === 'string') {
        return `${formatTerminalToolPathForOperator(entry['filePath'])} · seleção`;
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
            println(terminalThemeRow('Fila', 'vazia', { role: 'muted' }));
            println(terminalThemeRow('Uso', '/attach <caminho> · /attach blob <mime> <base64>', { role: 'command' }));
        } else {
            println(terminalThemeHeadline('fileRead', 'Fila de anexos', [countLabel(queue.length, 'item', 'itens')]));
            for (let i = 0; i < queue.length; i++) {
                const entry = queue[i];
                if (entry === undefined) continue;
                println(terminalThemeRow(`${i + 1}.`, describeAttachmentEntry(entry), { role: 'fileRead', width: 5 }));
            }
            println(terminalThemeRow('Próximo', 'serão embutidos no próximo turno · /attach clear limpa a fila'));
        }
        return;
    }

    // clear
    if (trimmed.toLowerCase() === 'clear') {
        clearAttachments();
        println(terminalThemeRow('Fila', 'limpa', { role: 'success' }));
        return;
    }

    const blobArgs = parseBlobAttachArgs(trimmed);
    if (blobArgs) {
        if ('error' in blobArgs) {
            println(terminalThemeRow('Erro', blobArgs.error, { role: 'error' }));
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
            terminalThemeRow('Adicionado', `${blobArgs.displayName ?? 'blob'} (${blobArgs.mimeType})`, {
                role: 'success',
            }),
        );
        println(terminalThemeRow('Fila', attachmentQueueNextTurnLabel(queue.length), { role: 'muted' }));
        return;
    }

    // Adicionar arquivo
    const filePath = trimmed;
    try {
        const info = (await statPathTrusted(filePath, { caller: 'terminal.commands.attach' })).stats;
        if (info.size > MAX_EMBED_BYTES) {
            println(
                terminalThemeRow(
                    'Aviso',
                    `arquivo muito grande: ${formatTerminalToolPathForOperator(filePath)} (${(info.size / 1024).toFixed(1)} KB > 64 KB)`,
                    {
                        role: 'warn',
                    },
                ),
            );
            println(terminalThemeRow('Limite', '64 KB por envio · arquivo não adicionado', { role: 'warn' }));
            return;
        }
        addAttachment(filePath);
        const queue = getAttachmentQueue();
        println(
            terminalThemeRow(
                'Adicionado',
                `${formatTerminalToolPathForOperator(filePath)} (${(info.size / 1024).toFixed(1)} KB)`,
                { role: 'success' },
            ),
        );
        println(terminalThemeRow('Fila', attachmentQueueNextTurnLabel(queue.length), { role: 'muted' }));
    } catch {
        println(
            terminalThemeRow(
                'Erro',
                `arquivo não encontrado ou sem permissão: ${formatTerminalToolPathForOperator(filePath)}`,
                { role: 'error' },
            ),
        );
    }
}
