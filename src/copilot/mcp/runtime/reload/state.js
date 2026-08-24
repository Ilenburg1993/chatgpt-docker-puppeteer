// @ts-check
/**
 * Shared persisted state reader and reconciliation helpers for controlled MCP reloads.
 *
 * @module copilot/mcp/runtime/reload/state
 */

export const MCP_RELOAD_STATE_FILE = 'src/copilot/.ai/mcp/mcp-reload-state.json';

/**
 * @param {import('#copilot/mcp/public/workspace').McpWorkspaceCapability} workspace
 * @returns {Promise<Record<string, unknown> | null>}
 */
export async function readMcpReloadState(workspace) {
    if (!workspace) throw new TypeError('MCP reload-state reader requires a workspace capability.');
    const workspaceIo = workspace.io;
    try {
        const file = await workspaceIo.readText(MCP_RELOAD_STATE_FILE);
        const parsed = JSON.parse(file.content);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
            ? /** @type {Record<string, unknown>} */ (parsed)
            : null;
    } catch (error) {
        const code = /** @type {{ code?: unknown }} */ (error)?.code;
        if (code === 'ENOENT') return null;
        return {
            status: 'unavailable',
            error: error instanceof Error ? error.message : String(error),
        };
    }
}

/**
 * Correlate the latest reload state with the connector smoke that is meant to prove the new process/tunnel generation.
 * A successful reload is only reconciled when smoke evidence was captured after completion.
 *
 * @param {Record<string, unknown> | null} state
 * @param {unknown} connectorSmokeCheckedAt
 */
export function summarizeMcpReloadState(state, connectorSmokeCheckedAt) {
    if (!state) {
        return {
            present: false,
            status: null,
            requestId: null,
            profile: null,
            exitCode: null,
            inFlight: false,
            failed: false,
            completedSuccessfully: null,
            completedAt: null,
            connectorSmokeCheckedAt: connectorSmokeCheckedAt ?? null,
            smokeAfterReload: null,
            reconciledWithConnectorSmoke: true,
        };
    }

    const status = typeof state['status'] === 'string' ? state['status'] : 'unknown';
    const completedAt = finiteNumberOrNull(state['completedAt']);
    const smokeCheckedAtMs = Date.parse(String(connectorSmokeCheckedAt ?? ''));
    const inFlight =
        status === 'launching' ||
        status === 'accepted' ||
        status === 'scheduled' ||
        status === 'running' ||
        status === 'started';
    const exitCode = finiteNumberOrNull(state['exitCode']);
    const completedSuccessfully = status === 'completed' && exitCode === 0;
    const failed =
        status === 'failed' ||
        status === 'unavailable' ||
        (status === 'completed' && exitCode !== null && exitCode !== 0);
    const smokeAfterReload =
        completedAt === null || !Number.isFinite(smokeCheckedAtMs) ? null : smokeCheckedAtMs >= completedAt;

    return {
        present: true,
        status,
        requestId: typeof state['requestId'] === 'string' ? state['requestId'] : null,
        profile: typeof state['profile'] === 'string' ? state['profile'] : null,
        exitCode,
        inFlight,
        failed,
        completedSuccessfully,
        completedAt,
        connectorSmokeCheckedAt: connectorSmokeCheckedAt ?? null,
        smokeAfterReload,
        reconciledWithConnectorSmoke: !inFlight && !failed && (!completedSuccessfully || smokeAfterReload === true),
        error: typeof state['error'] === 'string' ? state['error'] : null,
    };
}

/** @param {unknown} value */
function finiteNumberOrNull(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
}
