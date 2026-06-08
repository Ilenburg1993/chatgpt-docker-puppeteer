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
} from '../frontend/projections/now.js';
import {
    formatTerminalTimeLabel,
    terminalThemeDivider,
    terminalThemeHeadline,
    terminalThemeRow,
} from '../state/index.js';

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
        println(terminalThemeRow('Uso', '/remember [tag:] conteúdo', { role: 'warn' }));
        return;
    }
    println(terminalThemeRow('Memória', `salva · ${result.tag} · ${result.id.slice(0, 8)}…`, { role: 'success' }));
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
        println(terminalThemeRow('Memórias', 'nenhuma encontrada', { role: 'muted' }));
        return;
    }
    println('');
    println(terminalThemeHeadline('assistant', 'Memórias', [label ? String(arg) : 'todas']));
    println(terminalThemeDivider(45));
    for (const m of memories) {
        const ts = formatTerminalTimeLabel(String(m['created_at'] ?? ''), { mode: 'dual' });
        println(terminalThemeRow(String(m['tag'] ?? 'memória'), `${ts} · ${m['content'] ?? ''}`));
    }
    println(terminalThemeDivider(45));
    println('');
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
        println(terminalThemeRow('Uso', '/forget <id>', { role: 'warn' }));
        return;
    }
    const deleted = forgetTerminalMemoryProjection(arg);
    println(
        deleted
            ? terminalThemeRow('Memória', `removida · ${arg.slice(0, 8)}…`, { role: 'success' })
            : terminalThemeRow('Memória', `não encontrada · ${arg}`, { role: 'warn' }),
    );
}
