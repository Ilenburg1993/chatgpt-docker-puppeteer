// @ts-check
/**
 * src/copilot/terminal/commands/memory.js
 *
 * Comandos de memória semântica: /remember, /recall, /forget
 *
 * @module copilot/terminal/commands/memory
 * @see EventBus
 */

import {
    forgetTerminalMemoryProjection,
    recallTerminalMemoriesProjection,
    rememberTerminalMemoryProjection,
} from '../frontend/index.js';

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
    const result = rememberTerminalMemoryProjection({ hubSessionId: hubSessionId ?? null, input: arg });
    if (!result.ok || !result.id) {
        println('\x1b[90m  Uso: /remember [tag:] conteúdo\x1b[0m');
        return;
    }
    println(`\x1b[32m  ✓ Memória salva\x1b[0m \x1b[90m[${result.tag}] ${result.id.slice(0, 8)}…\x1b[0m`);
}

/**
 * Recupera memórias por tag ou busca full-text.
 *
 * @param {SessionContext} ctx
 * @param {string} arg - Argumento após /recall (ex: "arch" ou "?Node.js")
 * @returns {void}
 */
export function cmdRecall({ println }, arg) {
    const { label, memories } = recallTerminalMemoriesProjection(arg);
    if (memories.length === 0) {
        println('\x1b[90m  Nenhuma memória encontrada.\x1b[0m');
        return;
    }
    println(`\n  \x1b[36mMemórias\x1b[0m ${label ? `[${arg}]` : '(todas)'}`);
    println('  ─────────────────────────────────────────────');
    for (const m of memories) {
        const ts = new Date(String(m['created_at'] ?? '')).toLocaleString('pt-BR');
        println(`  \x1b[90m[${ts}]\x1b[0m \x1b[33m${m['tag'] ?? ''}\x1b[0m  ${m['content'] ?? ''}`);
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
    const deleted = forgetTerminalMemoryProjection(arg);
    println(
        deleted
            ? `\x1b[32m  ✓ Memória removida: ${arg.slice(0, 8)}…\x1b[0m`
            : `\x1b[33m  Memória não encontrada: ${arg}\x1b[0m`,
    );
}
