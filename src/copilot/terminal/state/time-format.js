// @ts-check
/**
 * Formatação de tempo para superfícies humanas do terminal.
 *
 * Superfícies humanas padrão devem preferir idade relativa ou duração compacta. Superfícies técnicas, exportáveis ou
 * `detail/raw/json` preservam ISO 8601 completo com offset local explícito.
 *
 * @module copilot/terminal/time-format
 */

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
 * @returns {string}
 */
function formatTimezoneOffset(date) {
    const offsetMinutes = -date.getTimezoneOffset();
    const sign = offsetMinutes >= 0 ? '+' : '-';
    const abs = Math.abs(offsetMinutes);
    return `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

/**
 * ISO 8601 local completo, com milissegundos e offset local explicito.
 *
 * @param {number | string | Date | null | undefined} value
 * @returns {string}
 */
export function formatTerminalIsoTimestamp(value) {
    const date = value instanceof Date ? value : new Date(value ?? Date.now());
    if (Number.isNaN(date.getTime())) return 'tempo inválido';
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}${formatTimezoneOffset(date)}`;
}

/**
 * Idade relativa para timelines humanas: "há 4s", "há 2m", "há 3h", "há 1d".
 *
 * @param {number | string | Date | null | undefined} value
 * @param {number} [now]
 * @returns {string}
 */
export function formatTerminalRelativeAge(value, now = Date.now()) {
    const timestamp =
        value instanceof Date
            ? value.getTime()
            : typeof value === 'string'
              ? Date.parse(value)
              : Number(value ?? now);
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
