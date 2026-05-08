// @ts-check
/**
 * src/copilot/terminal/state/ui-theme.js
 *
 * Sistema de tema visual do terminal (ANSI) com foco em UX elegante e sóbria.
 *
 * @module copilot/terminal/ui-theme
 */

/** @typedef {'elegant' | 'vivid' | 'mono'} TerminalThemeName */
/**
 * @typedef {'info'
 *     | 'accent'
 *     | 'muted'
 *     | 'success'
 *     | 'warn'
 *     | 'error'
 *     | 'thinking'
 *     | 'tool'
 *     | 'question'
 *     | 'fileRead'
 *     | 'fileWrite'
 *     | 'fileEdit'
 *     | 'fileDelete'
 *     | 'index'
 *     | 'command'
 *     | 'hot'} TerminalThemeRole
 */

const ANSI_RESET = '\x1b[0m';

/**
 * @typedef {{
 *     name: TerminalThemeName;
 *     label: string;
 *     description: string;
 *     palette: Record<TerminalThemeRole, string>;
 * }} TerminalThemeProfile
 */

/** @type {Record<TerminalThemeName, TerminalThemeProfile>} */
const TERMINAL_THEME_PROFILES = Object.freeze({
    elegant: {
        name: 'elegant',
        label: 'Elegant',
        description: 'Paleta sóbria e equilibrada para uso contínuo.',
        palette: {
            info: '\x1b[36m',
            accent: '\x1b[34m',
            muted: '\x1b[90m',
            success: '\x1b[32m',
            warn: '\x1b[33m',
            error: '\x1b[31m',
            thinking: '\x1b[35m',
            tool: '\x1b[36m',
            question: '\x1b[96m',
            fileRead: '\x1b[36m',
            fileWrite: '\x1b[32m',
            fileEdit: '\x1b[33m',
            fileDelete: '\x1b[31m',
            index: '\x1b[33m',
            command: '\x1b[2m',
            hot: '\x1b[31m',
        },
    },
    vivid: {
        name: 'vivid',
        label: 'Vivid',
        description: 'Maior contraste para sessões de troubleshooting.',
        palette: {
            info: '\x1b[96m',
            accent: '\x1b[94m',
            muted: '\x1b[37m',
            success: '\x1b[92m',
            warn: '\x1b[93m',
            error: '\x1b[91m',
            thinking: '\x1b[95m',
            tool: '\x1b[96m',
            question: '\x1b[97m',
            fileRead: '\x1b[96m',
            fileWrite: '\x1b[92m',
            fileEdit: '\x1b[93m',
            fileDelete: '\x1b[91m',
            index: '\x1b[93m',
            command: '\x1b[2m',
            hot: '\x1b[91m',
        },
    },
    mono: {
        name: 'mono',
        label: 'Mono',
        description: 'Sem cores (acessibilidade / logs limpos).',
        palette: {
            info: '',
            accent: '',
            muted: '',
            success: '',
            warn: '',
            error: '',
            thinking: '',
            tool: '',
            question: '',
            fileRead: '',
            fileWrite: '',
            fileEdit: '',
            fileDelete: '',
            index: '',
            command: '',
            hot: '',
        },
    },
});

/** @type {TerminalThemeName} */
let _activeThemeName =
    process.env['COPILOT_TERMINAL_THEME'] === 'vivid' || process.env['COPILOT_TERMINAL_THEME'] === 'mono'
        ? /** @type {TerminalThemeName} */ (process.env['COPILOT_TERMINAL_THEME'])
        : 'elegant';

/**
 * @param {unknown} value
 * @returns {value is TerminalThemeName}
 */
export function isTerminalThemeName(value) {
    return value === 'elegant' || value === 'vivid' || value === 'mono';
}

/**
 * @returns {TerminalThemeName}
 */
export function getTerminalThemeName() {
    return _activeThemeName;
}

/**
 * @param {TerminalThemeName} themeName
 * @returns {void}
 */
export function setTerminalThemeName(themeName) {
    _activeThemeName = themeName;
}

/**
 * @returns {TerminalThemeProfile[]}
 */
export function listTerminalThemeProfiles() {
    return Object.values(TERMINAL_THEME_PROFILES);
}

/**
 * @returns {boolean}
 */
function shouldDisableColor() {
    return _activeThemeName === 'mono' || Boolean(process.env['NO_COLOR']);
}

/**
 * @param {TerminalThemeRole} role
 * @param {string} text
 * @returns {string}
 */
export function terminalThemeText(role, text) {
    if (shouldDisableColor()) return text;
    const profile = TERMINAL_THEME_PROFILES[_activeThemeName];
    const prefix = profile.palette[role] ?? '';
    if (!prefix) return text;
    return `${prefix}${text}${ANSI_RESET}`;
}

/**
 * @param {TerminalThemeRole} role
 * @param {string} label
 * @returns {string}
 */
export function terminalThemeBadge(role, label) {
    return terminalThemeText(role, `[${label}]`);
}

/**
 * @param {string} label
 * @returns {string}
 */
export function terminalActionChip(label) {
    return terminalThemeText('muted', `[ ${label} ]`);
}
