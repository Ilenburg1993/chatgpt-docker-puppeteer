// @ts-check
/**
 * Executor opt-in para pickers externos (`fzf`/`gum`).
 *
 * Este módulo não decide quando uma TUI pode tomar o terminal. Ele só executa a ferramenta depois que o comando chamador
 * já passou por `withTerminalExclusiveTty()`. Entrada e argumentos são sempre tokenizados; não há shell livre.
 *
 * @module copilot/terminal/capabilities/picker-runner
 */

import { spawnSync } from 'node:child_process';

/**
 * @typedef {{
 *     id: string;
 *     label: string;
 *     description?: string;
 * }} TerminalPickerItem
 */

/**
 * @typedef {{
 *     status: 'selected' | 'cancelled' | 'failed';
 *     item: TerminalPickerItem | null;
 *     renderer: 'fzf' | 'gum';
 *     reason: string | null;
 * }} TerminalPickerRunResult
 */

/**
 * @typedef {{
 *     status: number | null;
 *     signal?: NodeJS.Signals | null;
 *     stdout?: string | Buffer | null;
 *     stderr?: string | Buffer | null;
 *     error?: Error;
 * }} TerminalPickerProcessResult
 */

const PICKER_MAX_BUFFER = 256 * 1024;

/**
 * @param {TerminalPickerItem} item
 * @param {number} index
 * @returns {string}
 */
function renderPickerLine(item, index) {
    const prefix = String(index + 1).padStart(2, '0');
    const description = item.description?.trim();
    return description ? `${prefix} ${item.label} · ${description}` : `${prefix} ${item.label}`;
}

/**
 * @param {TerminalPickerItem[]} items
 * @returns {Map<string, TerminalPickerItem>}
 */
function buildPickerLineMap(items) {
    return new Map(items.map((item, index) => [renderPickerLine(item, index), item]));
}

/**
 * @param {string} command
 * @param {string[]} args
 * @param {{ input?: string }} options
 * @returns {TerminalPickerProcessResult}
 */
function defaultPickerExecutor(command, args, options) {
    return spawnSync(command, args, {
        encoding: 'utf8',
        input: options.input,
        maxBuffer: PICKER_MAX_BUFFER,
        stdio: ['pipe', 'pipe', 'inherit'],
        windowsHide: true,
    });
}

/**
 * @param {TerminalPickerItem[]} items
 * @param {{
 *     command: string;
 *     renderer: 'fzf' | 'gum';
 *     prompt?: string;
 *     execute?: (command: string, args: string[], options: { input?: string }) => TerminalPickerProcessResult;
 * }} options
 * @returns {TerminalPickerRunResult}
 */
export function runTerminalExternalPicker(items, options) {
    const renderer = options.renderer;
    const command = options.command;
    const execute = options.execute ?? defaultPickerExecutor;
    if (items.length === 0) {
        return { status: 'cancelled', item: null, renderer, reason: 'nenhum item disponível' };
    }

    const lineMap = buildPickerLineMap(items);
    const lines = [...lineMap.keys()];
    const prompt = options.prompt ?? 'menu> ';
    const filter = String(process.env['COPILOT_TERMINAL_PICKER_FILTER'] ?? '').trim();
    const result =
        renderer === 'gum'
            ? execute(command, ['choose', '--header', prompt.trim(), ...lines], {})
            : execute(
                  command,
                  [
                      '--height=40%',
                      '--layout=reverse',
                      '--border',
                      '--prompt',
                      prompt,
                      ...(filter ? ['--filter', filter] : []),
                  ],
                  {
                      input: `${lines.join('\n')}\n`,
                  },
              );

    if (result.error) {
        return { status: 'failed', item: null, renderer, reason: result.error.message };
    }
    if (result.status !== 0) {
        const stderr = String(result.stderr ?? '').trim();
        return {
            status: result.status === 130 ? 'cancelled' : 'failed',
            item: null,
            renderer,
            reason: stderr || (result.status === 130 ? 'seleção cancelada' : `picker saiu com status ${result.status}`),
        };
    }

    const selectedLine = String(result.stdout ?? '').split(/\r?\n/u).find(Boolean)?.trim() ?? '';
    const item = lineMap.get(selectedLine) ?? null;
    if (!item) {
        return { status: 'failed', item: null, renderer, reason: 'seleção não corresponde a item conhecido' };
    }
    return { status: 'selected', item, renderer, reason: null };
}

export const __test__ = {
    renderPickerLine,
};
