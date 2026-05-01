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
    applyTerminalDisplayPreset,
    isTerminalDisplayPresetName,
    isTerminalDisplayToggle,
    listTerminalDisplayPresets,
    listTerminalDisplayToggles,
    readTerminalDisplayState,
    readTerminalPromptDisplayPolicy,
    TERMINAL_DISPLAY_TOGGLE_KEYS,
    writeTerminalDisplayState,
    writeTerminalDisplayToggle,
} from '../display-policy.js';

/**
 * @typedef {object} DisplayContext
 * @property {(text: string) => void} println
 */

/**
 * @returns {string}
 */
function presetUsageLabel() {
    return listTerminalDisplayPresets()
        .map((preset) => preset.name)
        .join('|');
}

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
        const state = readTerminalDisplayState();
        const promptPolicy = readTerminalPromptDisplayPolicy(state);
        println('\n  \x1b[36mDisplay Toggles:\x1b[0m');
        println(`  \x1b[90mpreset atual: ${promptPolicy.density}\x1b[0m`);
        println('  ─────────────────────────────────────');
        for (const toggleDef of listTerminalDisplayToggles()) {
            const status = state[toggleDef.key] ? '\x1b[32m● on\x1b[0m' : '\x1b[31m○ off\x1b[0m';
            println(`  ${toggleDef.label.padEnd(36)} ${status}    \x1b[90m${toggleDef.command}\x1b[0m`);
        }
        println('  ─────────────────────────────────────');
        println('  \x1b[90m/display all on  ·  /display all off\x1b[0m');
        println(`  \x1b[90m/display preset <${presetUsageLabel()}>\x1b[0m\n`);
        return;
    }

    if (toggle === 'preset') {
        const presetName = value;
        if (!isTerminalDisplayPresetName(presetName)) {
            println(`  \x1b[33mUso: /display preset <${presetUsageLabel()}>\x1b[0m`);
            return;
        }
        const preset = applyTerminalDisplayPreset(presetName);
        println(`  ✅ Preset aplicado: \x1b[36m${preset.name}\x1b[0m — ${preset.description}`);
        return;
    }

    // all on / all off
    if (toggle === 'all') {
        if (value === 'on' || value === 'off') {
            const newVal = value === 'on';
            writeTerminalDisplayState({
                thinking: newVal,
                streaming: newVal,
                usage: newVal,
                tools: newVal,
                intent: newVal,
            });
            println(`  ✅ Todos os toggles: \x1b[${newVal ? '32m● on' : '31m○ off'}\x1b[0m`);
            return;
        }
        println('  \x1b[33mUso: /display all on  |  /display all off\x1b[0m');
        return;
    }

    // Toggle específico
    if (!isTerminalDisplayToggle(toggle)) {
        const valid = TERMINAL_DISPLAY_TOGGLE_KEYS.join(', ');
        println(`  \x1b[31mToggle desconhecido: "${toggle}". Válidos: ${valid}, all\x1b[0m`);
        return;
    }
    const entry = listTerminalDisplayToggles().find((candidate) => candidate.key === toggle);

    if (value === 'on' || value === 'off') {
        const newVal = value === 'on';
        writeTerminalDisplayToggle(toggle, newVal);
        println(`  ✅ ${entry?.label ?? toggle}: \x1b[${newVal ? '32m● on' : '31m○ off'}\x1b[0m`);
    } else if (!value) {
        const state = readTerminalDisplayState();
        const status = state[toggle] ? '\x1b[32m● on\x1b[0m' : '\x1b[31m○ off\x1b[0m';
        println(`  ${entry?.label ?? toggle}: ${status}`);
    } else {
        println(`  \x1b[33mUso: /display ${toggle} on  |  /display ${toggle} off\x1b[0m`);
    }
}
