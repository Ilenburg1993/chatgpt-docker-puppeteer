// @ts-check
/**
 * src/copilot/terminal/commands/memory.js
 *
 * Comandos de memória semântica: /remember, /recall, /forget
 *
 * @module copilot/terminal/commands/memory
 */

import { conversationStore } from '#copilot/conversation-hub/store';

/**
 * @typedef {object} SessionContext
 * @property {string | null} [hubSessionId]
 * @property {(text: string) => void} println
 */

/**
 * Persiste uma memória semântica.
 *
 * @param {SessionContext} ctx
 * @param {string} arg - Argumento após /remember (ex: "arch: Node.js 24+")
 * @returns {void}
 */
export function cmdRemember({ hubSessionId, println }, arg) {
    const match = arg.match(/^([a-z0-9_-]+):\s*(.+)$/i);
    const tag = match ? (match[1] ?? 'geral') : 'geral';
    const content = match ? (match[2] ?? '').trim() : arg.trim();
    if (!content) {
        println('\x1b[90m  Uso: /remember [tag:] conteúdo\x1b[0m');
        return;
    }
    const id = conversationStore.storeMemory({
        tag,
        content,
        ...(hubSessionId ? { hubSessionId } : {}),
    });
    println(`\x1b[32m  ✓ Memória salva\x1b[0m \x1b[90m[${tag}] ${id.slice(0, 8)}…\x1b[0m`);
}

/**
 * Recupera memórias por tag ou busca full-text.
 *
 * @param {SessionContext} ctx
 * @param {string} arg - Argumento após /recall (ex: "arch" ou "?Node.js")
 * @returns {void}
 */
export function cmdRecall({ println }, arg) {
    const isSearch = arg.startsWith('?');
    const memories = conversationStore.recallMemories({
        ...(isSearch ? { search: arg.slice(1).trim() } : arg ? { tag: arg } : {}),
        limit: 10,
    });
    if (memories.length === 0) {
        println('\x1b[90m  Nenhuma memória encontrada.\x1b[0m');
        return;
    }
    println(`\n  \x1b[36mMemórias\x1b[0m ${arg ? `[${arg}]` : '(todas)'}`);
    println('  ─────────────────────────────────────────────');
    for (const m of memories) {
        const ts = new Date(m.created_at).toLocaleString('pt-BR');
        println(`  \x1b[90m[${ts}]\x1b[0m \x1b[33m${m.tag}\x1b[0m  ${m.content}`);
    }
    println('  ─────────────────────────────────────────────\n');
}

/**
 * Remove uma memória semântica pelo ID.
 *
 * @param {SessionContext} ctx
 * @param {string} arg - ID da memória
 * @returns {void}
 */
export function cmdForget({ println }, arg) {
    if (!arg) {
        println('\x1b[90m  Uso: /forget <id>\x1b[0m');
        return;
    }
    const deleted = conversationStore.deleteMemory(arg);
    println(
        deleted
            ? `\x1b[32m  ✓ Memória removida: ${arg.slice(0, 8)}…\x1b[0m`
            : `\x1b[33m  Memória não encontrada: ${arg}\x1b[0m`,
    );
}
