// @ts-check
/**
 * Formatação de tempo para superfícies humanas do terminal.
 *
 * Eventos persistentes e timelines devem mostrar ISO 8601 completo com offset local explícito. A linha viva pode usar
 * idade relativa; superfícies diagnósticas compactas podem optar por horário curto quando isso for deliberado.
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
