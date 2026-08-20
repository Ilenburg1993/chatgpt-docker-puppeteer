// @ts-check
/**
 * Planejamento seguro de pickers interativos (`fzf`/`gum`).
 *
 * O terminal LLM-B tem linha viva e `readline` próprios. Antes de rodar qualquer TUI externa, o runtime precisa
 * entregar controle exclusivo do TTY. Enquanto essa pausa coordenada não existe, este módulo só produz
 * decisão/diagnóstico e fallback textual.
 *
 * @module copilot/terminal/capabilities/picker-plan
 */

import { readTerminalExternalToolCapabilities } from './external-tools.js';

/**
 * @typedef {'external' | 'textual'} TerminalPickerPlanMode
 */
/**
 * @typedef {{
 *     mode: TerminalPickerPlanMode;
 *     toolId: 'fzf' | 'gum' | null;
 *     command: string | null;
 *     label: string;
 *     reasons: string[];
 *     fallbackCommand: string;
 * }} TerminalPickerPlan
 */

/**
 * @param {{
 *     allowInteractive?: boolean;
 *     pendingQuestion?: boolean;
 *     preferred?: 'auto' | 'fzf' | 'gum';
 *     tools?: ReturnType<typeof readTerminalExternalToolCapabilities>;
 *     blockReasons?: string[];
 * }} [options]
 * @returns {TerminalPickerPlan}
 */
export function buildTerminalPickerPlan(options = {}) {
    const preferred = options.preferred ?? 'auto';
    const tools = options.tools ?? readTerminalExternalToolCapabilities();
    const fzf = tools.find((tool) => tool.id === 'fzf' && tool.available) ?? null;
    const gum = tools.find((tool) => tool.id === 'gum' && tool.available) ?? null;
    const chosen = preferred === 'gum' ? gum : preferred === 'fzf' ? fzf : (fzf ?? gum);
    /** @type {string[]} */
    const reasons = [];
    if (options.pendingQuestion) reasons.push('pergunta humana pendente');
    for (const reason of options.blockReasons ?? []) {
        if (reason && !reasons.includes(reason)) reasons.push(reason);
    }
    if (!options.allowInteractive) reasons.push('sessão ainda não liberou controle exclusivo do TTY');
    if (!chosen?.command) reasons.push(preferred === 'auto' ? 'fzf/gum indisponíveis' : `${preferred} indisponível`);

    if (reasons.length > 0 || !chosen?.command) {
        return {
            mode: 'textual',
            toolId: null,
            command: null,
            label: 'picker textual seguro',
            reasons,
            fallbackCommand: '/menu <n>',
        };
    }

    return {
        mode: 'external',
        toolId: /** @type {'fzf' | 'gum'} */ (chosen.id),
        command: chosen.command,
        label: chosen.label,
        reasons: [],
        fallbackCommand: '/menu <n>',
    };
}
