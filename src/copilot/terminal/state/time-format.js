// @ts-check
/**
 * Formatação de tempo para superfícies humanas do terminal.
 *
 * A UX v2 usa um contrato configurável: superfícies operacionais podem mostrar ISO 8601 local completo, tempo relativo,
 * ou ambos. A linha viva continua livre para usar duração compacta quando isso evita poluir o input.
 *
 * @module copilot/terminal/time-format
 */

/** @typedef {'relative' | 'iso' | 'dual' | 'elapsed'} TerminalTimeDisplayMode */
/** @typedef {'seconds' | 'milliseconds'} TerminalIsoPrecision */
/**
 * @typedef {{
 *     mode?: TerminalTimeDisplayMode | null;
 *     now?: number;
 *     isoPrecision?: TerminalIsoPrecision;
 *     dualSeparator?: string;
 *     relativeWrapper?: 'parentheses' | 'suffix' | 'none';
 * }} TerminalTimeFormatOptions
 */
/**
 * @typedef {{
 *     value: number | string | Date | null | undefined;
 *     timestamp: number | null;
 *     valid: boolean;
 *     mode: TerminalTimeDisplayMode;
 *     iso: string;
 *     relative: string;
 *     elapsed: string;
 *     label: string;
 * }} TerminalTimeParts
 */

/** @type {readonly TerminalTimeDisplayMode[]} */
export const TERMINAL_TIME_DISPLAY_MODES = Object.freeze(['relative', 'iso', 'dual', 'elapsed']);

/**
 * @param {number} value
 * @param {number} width
 * @returns {string}
 */
function pad(value, width = 2) {
    return String(Math.trunc(Math.abs(value))).padStart(width, '0');
}

/**
 * @param {Date} date
 * @param {TerminalIsoPrecision} [precision='milliseconds'] Default is `'milliseconds'`
 * @returns {string}
 */
function formatIsoLocalDateTime(date, precision = 'milliseconds') {
    const seconds = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
    const millis = precision === 'milliseconds' ? `.${pad(date.getMilliseconds(), 3)}` : '';
    return `${seconds}${millis}${formatTimezoneOffset(date)}`;
}

/**
 * @param {Date} date
 * @returns {string}
 */
function formatTimezoneOffset(date) {
    const offsetMinutes = -date.getTimezoneOffset();
    const sign = offsetMinutes >= 0 ? '+' : '-';
    const abs = Math.abs(offsetMinutes);
    return `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

/**
 * @param {number | string | Date | null | undefined} value
 * @param {number} [fallback]
 * @returns {number}
 */
function parseTerminalTimestamp(value, fallback = Date.now()) {
    if (value instanceof Date) return value.getTime();
    if (typeof value === 'number') return value;
    if (typeof value === 'string') {
        const trimmed = value.trim();
        if (/^-?\d+(?:\.\d+)?$/u.test(trimmed)) return Number(trimmed);
        return Date.parse(trimmed);
    }
    return Number(value ?? fallback);
}

/**
 * ISO 8601 local completo, com offset local explicito.
 *
 * @param {number | string | Date | null | undefined} value
 * @param {{ precision?: TerminalIsoPrecision }} [options]
 * @returns {string}
 */
export function formatTerminalIsoTimestamp(value, options = {}) {
    const date = new Date(parseTerminalTimestamp(value));
    if (Number.isNaN(date.getTime())) return 'tempo inválido';
    return formatIsoLocalDateTime(date, options.precision ?? 'milliseconds');
}

/**
 * ISO 8601 local até segundos, com offset local explicito.
 *
 * @param {number | string | Date | null | undefined} value
 * @returns {string}
 */
export function formatTerminalIsoTimestampSeconds(value) {
    return formatTerminalIsoTimestamp(value, { precision: 'seconds' });
}

/**
 * Idade relativa para timelines humanas: "há 4s", "há 2m", "há 3h", "há 1d".
 *
 * @param {number | string | Date | null | undefined} value
 * @param {number} [now]
 * @returns {string}
 */
export function formatTerminalRelativeAge(value, now = Date.now()) {
    const timestamp = parseTerminalTimestamp(value, now);
    const safeTimestamp = Number.isFinite(timestamp) ? timestamp : now;
    const ageMs = Math.max(0, now - safeTimestamp);
    const seconds = Math.floor(ageMs / 1000);
    if (seconds < 60) return `há ${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `há ${minutes}m`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `há ${hours}h`;
    const days = Math.floor(hours / 24);
    if (days < 365) return `há ${days}d`;
    const years = Math.floor(days / 365);
    return `há ${years}a`;
}

/**
 * Duração compacta para estados atuais: "10s", "2m", "1h", "3d".
 *
 * @param {number | string | null | undefined} value
 * @returns {string}
 */
export function formatTerminalElapsedDuration(value) {
    const durationMs = Number(value ?? 0);
    const safeDurationMs = Number.isFinite(durationMs) ? Math.max(0, durationMs) : 0;
    const seconds = Math.floor(safeDurationMs / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h`;
    const days = Math.floor(hours / 24);
    return `${days}d`;
}

/**
 * Resolve o modo padrão de tempo do terminal. O default deliberado é `dual`: ISO 8601 completo para auditabilidade
 * humana e idade relativa para leitura rápida. `elapsed` deve ser usado com parcimônia em superfícies de linha viva.
 *
 * @param {unknown} value
 * @returns {TerminalTimeDisplayMode}
 */
export function resolveTerminalTimeDisplayMode(value = process.env['COPILOT_TERMINAL_TIME_MODE']) {
    if (value === 'relative' || value === 'iso' || value === 'dual' || value === 'elapsed') return value;
    return 'dual';
}

/**
 * @param {string} iso
 * @param {string} relative
 * @param {TerminalTimeFormatOptions} options
 * @returns {string}
 */
function formatDualTerminalTimeLabel(iso, relative, options) {
    const separator = options.dualSeparator ?? ' ';
    const wrapper = options.relativeWrapper ?? 'parentheses';
    if (wrapper === 'suffix') return `${iso}${separator}${relative}`;
    if (wrapper === 'none') return `${iso}${separator}${relative}`;
    return `${iso}${separator}(${relative})`;
}

/**
 * Gera todas as partes temporais canônicas de uma vez. Use quando a superfície precisa montar layout próprio sem
 * reparsear o timestamp ou quando precisa exibir ISO e relativo em campos separados.
 *
 * @param {number | string | Date | null | undefined} value
 * @param {TerminalTimeFormatOptions} [options]
 * @returns {TerminalTimeParts}
 */
export function formatTerminalTimeParts(value, options = {}) {
    const mode = resolveTerminalTimeDisplayMode(options.mode ?? undefined);
    const now = options.now ?? Date.now();
    const timestamp = parseTerminalTimestamp(value, now);
    const valid = Number.isFinite(timestamp);
    const safeTimestamp = valid ? timestamp : now;
    const iso = valid
        ? formatTerminalIsoTimestamp(safeTimestamp, { precision: options.isoPrecision ?? 'milliseconds' })
        : 'tempo inválido';
    const relative = valid ? formatTerminalRelativeAge(safeTimestamp, now) : 'tempo relativo indisponível';
    const elapsed = valid ? formatTerminalElapsedDuration(Math.max(0, now - safeTimestamp)) : '0s';
    const label =
        mode === 'elapsed'
            ? elapsed
            : mode === 'iso'
              ? iso
              : mode === 'relative'
                ? relative
                : valid
                  ? formatDualTerminalTimeLabel(iso, relative, options)
                  : iso;
    return {
        value,
        timestamp: valid ? timestamp : null,
        valid,
        mode,
        iso,
        relative,
        elapsed,
        label,
    };
}

/**
 * Formata um instante em modo configurável para superfícies humanas do terminal.
 *
 * @param {number | string | Date | null | undefined} value
 * @param {TerminalTimeFormatOptions} [options]
 * @returns {string}
 */
export function formatTerminalTimeLabel(value, options = {}) {
    return formatTerminalTimeParts(value, options).label;
}

/**
 * Alias semântico para callers novos: o timestamp humano do terminal é configurável, com default dual.
 *
 * @param {number | string | Date | null | undefined} value
 * @param {TerminalTimeFormatOptions} [options]
 * @returns {string}
 */
export function formatTerminalTimestamp(value, options = {}) {
    return formatTerminalTimeLabel(value, options);
}
