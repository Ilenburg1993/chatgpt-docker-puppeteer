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
    terminalThemeDivider,
    terminalThemeHeadline,
    terminalThemeRow,
    terminalThemeStatus,
    terminalThemeText,
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
 * @param {boolean} value
 * @returns {string}
 */
function renderToggleStatus(value) {
    return value ? `${terminalThemeStatus(true)} on` : `${terminalThemeText('error', 'off')}`;
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
        println('');
        println(
            terminalThemeHeadline('assistant', 'Exibição do terminal', [
                `preset ${promptPolicy.density}`,
                `tema ${themeName}`,
                `detalhe ${detailLevel}`,
            ]),
        );
        println(terminalThemeDivider(52));
        for (const toggleDef of listTerminalDisplayToggles()) {
            println(
                `  ${terminalThemeText('muted', toggleDef.label.padEnd(34))} ${renderToggleStatus(state[toggleDef.key])}  ${terminalThemeText('command', toggleDef.command)}`,
            );
        }
        println(terminalThemeDivider(52));
        println(terminalThemeRow('Ações', '/display all on  ·  /display all off', { role: 'command' }));
        println(terminalThemeRow('Preset', `/display preset <${presetUsageLabel()}>`, { role: 'command' }));
        println(terminalThemeRow('Tema', `/display theme <${themeUsageLabel()}>`, { role: 'command' }));
        println(terminalThemeRow('Mais detalhes', `/display detail <${detailUsageLabel()}>`, { role: 'command' }));
        println('');
        return;
    }

    if (toggle === 'detail') {
        if (!value) {
            println(terminalThemeRow('Mais detalhes', getTerminalDetailLevel(), { role: 'assistant' }));
            println(terminalThemeRow('Uso', `/display detail <${detailUsageLabel()}>`, { role: 'command' }));
            return;
        }
        if (!isTerminalDetailLevel(value)) {
            println(terminalThemeRow('Uso', `/display detail <${detailUsageLabel()}>`, { role: 'warn' }));
            return;
        }
        setTerminalDetailLevel(value);
        println(
            terminalThemeRow(
                'Mais detalhes',
                `${value} · ${value === 'compact' ? 'menos ruído, mais síntese' : 'máximo contexto operacional'}`,
                { role: 'success' },
            ),
        );
        return;
    }

    if (toggle === 'theme') {
        if (!value) {
            println(terminalThemeRow('Tema', getTerminalThemeName(), { role: 'assistant' }));
            println(terminalThemeRow('Uso', `/display theme <${themeUsageLabel()}>`, { role: 'command' }));
            return;
        }
        if (!isTerminalThemeName(value)) {
            println(terminalThemeRow('Uso', `/display theme <${themeUsageLabel()}>`, { role: 'warn' }));
            return;
        }
        setTerminalThemeName(value);
        const selected = listTerminalThemeProfiles().find((theme) => theme.name === value);
        println(
            terminalThemeRow('Tema', `${value} · ${selected?.description ?? 'paleta visual atualizada'}`, {
                role: 'success',
            }),
        );
        return;
    }

    if (toggle === 'preset') {
        const presetName = value;
        if (!isTerminalDisplayPresetName(presetName)) {
            println(terminalThemeRow('Uso', `/display preset <${presetUsageLabel()}>`, { role: 'warn' }));
            return;
        }
        const preset = applyTerminalDisplayPreset(presetName);
        println(terminalThemeRow('Preset', `${preset.name} · ${preset.description}`, { role: 'success' }));
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
            println(terminalThemeRow('Todos', renderToggleStatus(newVal)));
            return;
        }
        println(terminalThemeRow('Uso', '/display all on  |  /display all off', { role: 'warn' }));
        return;
    }

    // Toggle específico
    if (!isTerminalDisplayToggle(toggle)) {
        const valid = TERMINAL_DISPLAY_TOGGLE_KEYS.join(', ');
        println(terminalThemeRow('Erro', `toggle desconhecido "${toggle}". Válidos: ${valid}, all`, { role: 'error' }));
        return;
    }
    const entry = listTerminalDisplayToggles().find((candidate) => candidate.key === toggle);

    if (value === 'on' || value === 'off') {
        const newVal = value === 'on';
        writeTerminalDisplayToggle(toggle, newVal);
        println(terminalThemeRow(entry?.label ?? toggle, renderToggleStatus(newVal)));
    } else if (!value) {
        const state = readTerminalDisplayState();
        println(terminalThemeRow(entry?.label ?? toggle, renderToggleStatus(state[toggle])));
    } else {
        println(terminalThemeRow('Uso', `/display ${toggle} on  |  /display ${toggle} off`, { role: 'warn' }));
    }
}
