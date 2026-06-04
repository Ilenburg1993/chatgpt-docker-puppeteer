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
 *     | 'assistant'
 *     | 'user'
 *     | 'system'
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
        description: 'Paleta sóbria, com papéis visuais separados para LLM-B, operador, raciocínio, perguntas e tools.',
        palette: {
            info: '\x1b[38;5;81m',
            accent: '\x1b[38;5;75m',
            muted: '\x1b[90m',
            assistant: '\x1b[38;5;81m',
            user: '\x1b[38;5;114m',
            system: '\x1b[38;5;147m',
            success: '\x1b[38;5;114m',
            warn: '\x1b[38;5;214m',
            error: '\x1b[38;5;203m',
            thinking: '\x1b[38;5;177m',
            tool: '\x1b[38;5;75m',
            question: '\x1b[38;5;222m',
            fileRead: '\x1b[38;5;110m',
            fileWrite: '\x1b[38;5;114m',
            fileEdit: '\x1b[38;5;214m',
            fileDelete: '\x1b[38;5;203m',
            index: '\x1b[38;5;186m',
            command: '\x1b[38;5;186m',
            hot: '\x1b[38;5;203m',
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
            assistant: '\x1b[96m',
            user: '\x1b[92m',
            system: '\x1b[95m',
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
            command: '\x1b[97m',
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
            assistant: '',
            user: '',
            system: '',
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

/**
 * @param {number} [width=70] Default is `70`
 * @returns {string}
 */
export function terminalThemeDivider(width = 70) {
    return terminalThemeText('muted', `  ${'─'.repeat(Math.max(12, Math.floor(width)))}`);
}

/**
 * @param {Array<string | null | undefined | false>} parts
 * @param {string} [separator=' · '] Default is `' · '`
 * @returns {string}
 */
export function terminalThemeJoin(parts, separator = ' · ') {
    return parts.filter((part) => typeof part === 'string' && part.length > 0).join(terminalThemeText('muted', separator));
}

/**
 * @param {TerminalThemeRole} role
 * @param {string} title
 * @param {Array<string | null | undefined | false>} [details=[]] Default is `[]`
 * @returns {string}
 */
export function terminalThemeHeadline(role, title, details = []) {
    const suffix = terminalThemeJoin(details);
    return `  ${terminalThemeText(role, title)}${suffix ? `  ${terminalThemeText('muted', '·')}  ${suffix}` : ''}`;
}

/**
 * @param {string} label
 * @param {string} value
 * @param {{ width?: number; role?: TerminalThemeRole; truncateLabel?: boolean }} [options]
 * @returns {string}
 */
export function terminalThemeRow(label, value, options = {}) {
    const width = Math.max(4, Math.floor(options.width ?? 12));
    const role = options.role ?? 'muted';
    const renderedLabel =
        options.truncateLabel && label.length > width
            ? `${label.slice(0, Math.max(1, width - 1))}…`
            : label.padEnd(width);
    return `  ${terminalThemeText('muted', renderedLabel)}  ${terminalThemeText(role, value)}`;
}

/**
 * @param {string} label
 * @param {Array<string | null | undefined | false>} values
 * @param {{ width?: number; role?: TerminalThemeRole; empty?: string }} [options]
 * @returns {string}
 */
export function terminalThemeRows(label, values, options = {}) {
    const width = Math.max(4, Math.floor(options.width ?? 12));
    const role = options.role ?? 'muted';
    /** @type {string[]} */
    const cleanValues = values
        .filter((value) => typeof value === 'string' && value.length > 0)
        .map((value) => String(value));
    if (cleanValues.length === 0) {
        return terminalThemeRow(label, options.empty ?? '-', { width, role });
    }
    return cleanValues
        .map((value, index) => {
            const rowLabel = index === 0 ? label : '';
            return terminalThemeRow(rowLabel, value, { width, role });
        })
        .join('\n');
}

/**
 * @param {string} value
 * @param {number} width
 * @returns {string[]}
 */
function wrapTerminalRowValue(value, width) {
    const maxWidth = Math.max(12, Math.floor(width));
    /** @type {string[]} */
    const lines = [];
    let current = '';
    for (const rawWord of String(value).split(/\s+/u).filter(Boolean)) {
        /** @type {string[]} */
        const chunks = [];
        for (let index = 0; index < rawWord.length; index += maxWidth) {
            chunks.push(rawWord.slice(index, index + maxWidth));
        }
        for (const word of chunks) {
            const next = current ? `${current} ${word}` : word;
            if (next.length <= maxWidth) {
                current = next;
                continue;
            }
            if (current) lines.push(current);
            current = word;
        }
    }
    if (current) lines.push(current);
    return lines.length > 0 ? lines : [''];
}

/**
 * @param {string} label
 * @param {string} value
 * @param {{ width?: number; role?: TerminalThemeRole; columns?: number; truncateLabel?: boolean }} [options]
 * @returns {string}
 */
export function terminalThemeWrappedRow(label, value, options = {}) {
    const labelWidth = Math.max(4, Math.floor(options.width ?? 12));
    const columns = Math.max(labelWidth + 18, Math.floor(options.columns ?? 116));
    const valueWidth = Math.max(12, columns - labelWidth - 4);
    return wrapTerminalRowValue(value, valueWidth)
        .map((line, index) => {
            const rowOptions = {
                width: labelWidth,
                ...(options.role !== undefined ? { role: options.role } : {}),
                ...(options.truncateLabel !== undefined ? { truncateLabel: options.truncateLabel } : {}),
            };
            return terminalThemeRow(index === 0 ? label : '', line, rowOptions);
        })
        .join('\n');
}

/**
 * @param {boolean} success
 * @returns {string}
 */
export function terminalThemeStatus(success) {
    return terminalThemeText(success ? 'success' : 'error', success ? 'ok' : 'falhou');
}

/**
 * @param {number} durationMs
 * @returns {string}
 */
export function terminalThemeDuration(durationMs) {
    const seconds = Math.max(0, durationMs / 1000);
    const text = `${seconds.toFixed(1)}s`;
    if (seconds < 5) return terminalThemeText('success', text);
    if (seconds < 15) return terminalThemeText('warn', text);
    return terminalThemeText('error', text);
}
