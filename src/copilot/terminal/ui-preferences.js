// @ts-check
/**
 * src/copilot/terminal/ui-preferences.js
 *
 * Preferências de UX terminal em runtime (não persistidas em disco).
 *
 * @module copilot/terminal/ui-preferences
 */

/** @typedef {'compact' | 'detailed'} TerminalDetailLevel */

export const TERMINAL_DETAIL_LEVELS = /** @type {const} */ (['compact', 'detailed']);

/** @type {TerminalDetailLevel} */
let _terminalDetailLevel =
    process.env['COPILOT_TERMINAL_DETAIL'] === 'compact' || process.env['COPILOT_TERMINAL_DETAIL'] === 'detailed'
        ? /** @type {TerminalDetailLevel} */ (process.env['COPILOT_TERMINAL_DETAIL'])
        : 'detailed';

/**
 * @param {unknown} value
 * @returns {value is TerminalDetailLevel}
 */
export function isTerminalDetailLevel(value) {
    return value === 'compact' || value === 'detailed';
}

/**
 * @returns {TerminalDetailLevel}
 */
export function getTerminalDetailLevel() {
    return _terminalDetailLevel;
}

/**
 * @param {TerminalDetailLevel} level
 * @returns {void}
 */
export function setTerminalDetailLevel(level) {
    _terminalDetailLevel = level;
}

/**
 * @returns {readonly TerminalDetailLevel[]}
 */
export function listTerminalDetailLevels() {
    return TERMINAL_DETAIL_LEVELS;
}

/**
 * @returns {{ detailLevel: TerminalDetailLevel; compact: boolean }}
 */
export function readTerminalUiPreferences() {
    const detailLevel = getTerminalDetailLevel();
    return {
        detailLevel,
        compact: detailLevel === 'compact',
    };
}
