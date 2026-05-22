// @ts-check
/**
 * Minimal MCP audit logger. Stdout is intentionally never used because stdio
 * transport reserves stdout for JSON-RPC frames.
 *
 * @module copilot/mcp/control-plane/audit
 */

/**
 * @param {'DEBUG' | 'INFO' | 'WARN' | 'ERROR'} level
 * @param {string} message
 * @param {Record<string, unknown>} [fields]
 * @returns {void}
 */
export function logMcp(level, message, fields) {
    const payload = {
        ts: new Date().toISOString(),
        level,
        component: 'copilot-mcp',
        message,
        ...(fields ? { fields } : {}),
    };
    process.stderr.write(`${JSON.stringify(payload)}\n`);
}

