// @ts-check
/**
 * src/copilot/terminal/commands/display.js
 *
 * Comando `/display [toggle] [on|off]` — gerencia todos os toggles de exibição do terminal.
 *
 * Consolida o controle de: thinking, streaming, usage, tools, intents num único comando.
 *
 * @module copilot/terminal/commands/display
 * @see EventBus
 */

import {
    getShowIntentActivity,
    getShowStreaming,
    getShowThinking,
    getShowToolActivity,
    getShowUsage,
    setShowIntentActivity,
    setShowStreaming,
    setShowThinking,
    setShowToolActivity,
    setShowUsage,
} from '../../presentation/runtime-ui-state-store.js';

/**
 * @typedef {object} DisplayContext
 * @property {(text: string) => void} println
 */

/** @type {Record<string, { get: () => boolean; set: (v: boolean) => void; label: string }>} */
const TOGGLES = {
    thinking: { get: getShowThinking, set: setShowThinking, label: '💭 Thinking (raciocínio)' },
    streaming: { get: getShowStreaming, set: setShowStreaming, label: '📡 Streaming (resposta incremental)' },
    usage: { get: getShowUsage, set: setShowUsage, label: '📊 Usage (tokens pós-turno)' },
    tools: { get: getShowToolActivity, set: setShowToolActivity, label: '🔧 Tool activity (início/fim/progresso)' },
    intent: {
        get: getShowIntentActivity,
        set: setShowIntentActivity,
        label: '🧭 Intent (o que a LLM-B está tentando fazer)',
    },
};

/**
 * Comando `/display [toggle] [on|off]`.
 *
 * - Sem args: mostra status de todos os toggles.
 * - Com toggle: mostra ou altera o toggle específico.
 * - `all on` / `all off`: altera todos de uma vez.
 *
 * @param {DisplayContext} ctx
 * @param {string} [arg]
 * @param {string[]} [rest]
 * @returns {void}
 */
export function cmdDisplay({ println }, arg, rest) {
    const toggle = arg?.trim().toLowerCase();
    const value = rest?.[0]?.trim().toLowerCase();

    // Sem args: exibir status de todos
    if (!toggle) {
        println('\n  \x1b[36mDisplay Toggles:\x1b[0m');
        println('  ─────────────────────────────────────');
        for (const [key, t] of Object.entries(TOGGLES)) {
            const status = t.get() ? '\x1b[32m● on\x1b[0m' : '\x1b[31m○ off\x1b[0m';
            println(`  ${t.label.padEnd(36)} ${status}    \x1b[90m/display ${key} [on|off]\x1b[0m`);
        }
        println('  ─────────────────────────────────────');
        println('  \x1b[90m/display all on  ·  /display all off\x1b[0m\n');
        return;
    }

    // all on / all off
    if (toggle === 'all') {
        if (value === 'on' || value === 'off') {
            const newVal = value === 'on';
            for (const t of Object.values(TOGGLES)) {
                t.set(newVal);
            }
            println(`  ✅ Todos os toggles: \x1b[${newVal ? '32m● on' : '31m○ off'}\x1b[0m`);
            return;
        }
        println('  \x1b[33mUso: /display all on  |  /display all off\x1b[0m');
        return;
    }

    // Toggle específico
    const entry = TOGGLES[toggle];
    if (!entry) {
        const valid = Object.keys(TOGGLES).join(', ');
        println(`  \x1b[31mToggle desconhecido: "${toggle}". Válidos: ${valid}, all\x1b[0m`);
        return;
    }

    if (value === 'on' || value === 'off') {
        const newVal = value === 'on';
        entry.set(newVal);
        println(`  ✅ ${entry.label}: \x1b[${newVal ? '32m● on' : '31m○ off'}\x1b[0m`);
    } else if (!value) {
        const status = entry.get() ? '\x1b[32m● on\x1b[0m' : '\x1b[31m○ off\x1b[0m';
        println(`  ${entry.label}: ${status}`);
    } else {
        println(`  \x1b[33mUso: /display ${toggle} on  |  /display ${toggle} off\x1b[0m`);
    }
}
