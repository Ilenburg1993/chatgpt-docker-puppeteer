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
    getTerminalDetailLevel,
    getTerminalThemeName,
    isTerminalDetailLevel,
    isTerminalDisplayPresetName,
    isTerminalDisplayToggle,
    isTerminalThemeName,
    listTerminalDetailLevels,
    listTerminalDisplayPresets,
    listTerminalDisplayToggles,
    listTerminalThemeProfiles,
    readTerminalDisplayState,
    readTerminalPromptDisplayPolicy,
    setTerminalDetailLevel,
    setTerminalThemeName,
    TERMINAL_DISPLAY_TOGGLE_KEYS,
    writeTerminalDisplayState,
    writeTerminalDisplayToggle,
} from '../state/ui/index.js';

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
 * @returns {string}
 */
function themeUsageLabel() {
    return listTerminalThemeProfiles()
        .map((theme) => theme.name)
        .join('|');
}

/**
 * @returns {string}
 */
function detailUsageLabel() {
    return listTerminalDetailLevels().join('|');
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
        const themeName = getTerminalThemeName();
        const detailLevel = getTerminalDetailLevel();
        println('\n  \x1b[36mDisplay Toggles:\x1b[0m');
        println(`  \x1b[90mpreset atual: ${promptPolicy.density}\x1b[0m`);
        println(`  \x1b[90mtema atual: ${themeName}\x1b[0m`);
        println(`  \x1b[90mnível de detalhe: ${detailLevel}\x1b[0m`);
        println('  ─────────────────────────────────────');
        for (const toggleDef of listTerminalDisplayToggles()) {
            const status = state[toggleDef.key] ? '\x1b[32m● on\x1b[0m' : '\x1b[31m○ off\x1b[0m';
            println(`  ${toggleDef.label.padEnd(36)} ${status}    \x1b[90m${toggleDef.command}\x1b[0m`);
        }
        println('  ─────────────────────────────────────');
        println('  \x1b[90m/display all on  ·  /display all off\x1b[0m');
        println(`  \x1b[90m/display preset <${presetUsageLabel()}>\x1b[0m\n`);
        println(`  \x1b[90m/display theme <${themeUsageLabel()}>\x1b[0m\n`);
        println(`  \x1b[90m/display detail <${detailUsageLabel()}>\x1b[0m\n`);
        return;
    }

    if (toggle === 'detail') {
        if (!value) {
            println(`  Nível de detalhe atual: \x1b[36m${getTerminalDetailLevel()}\x1b[0m`);
            println(`  \x1b[90mUso: /display detail <${detailUsageLabel()}>\x1b[0m`);
            return;
        }
        if (!isTerminalDetailLevel(value)) {
            println(`  \x1b[33mUso: /display detail <${detailUsageLabel()}>\x1b[0m`);
            return;
        }
        setTerminalDetailLevel(value);
        println(
            `  ✅ Detalhe aplicado: \x1b[36m${value}\x1b[0m — ${value === 'compact' ? 'menos ruído, mais síntese' : 'máximo contexto operacional'}`,
        );
        return;
    }

    if (toggle === 'theme') {
        if (!value) {
            println(`  Tema atual: \x1b[36m${getTerminalThemeName()}\x1b[0m`);
            println(`  \x1b[90mUso: /display theme <${themeUsageLabel()}>\x1b[0m`);
            return;
        }
        if (!isTerminalThemeName(value)) {
            println(`  \x1b[33mUso: /display theme <${themeUsageLabel()}>\x1b[0m`);
            return;
        }
        setTerminalThemeName(value);
        const selected = listTerminalThemeProfiles().find((theme) => theme.name === value);
        println(`  ✅ Tema aplicado: \x1b[36m${value}\x1b[0m — ${selected?.description ?? 'paleta visual atualizada'}`);
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
                session: newVal,
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
