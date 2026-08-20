// @ts-check
/**
 * Worker isolado do servidor LSP nativo do TypeScript 7.
 *
 * O processo externo mantém o heap semântico fora do servidor principal e é descartado integralmente ao fim da curta
 * janela de ociosidade.
 */

import { TsserverDaemon } from './tsserver-daemon.mjs';

const timeoutMs = Number(process.env['LSP_TOOL_TIMEOUT_MS'] || 15_000);
const idleTtlMs = Number(process.env['LSP_WORKER_SERVICE_IDLE_TTL_MS'] || 120_000);
const daemon = new TsserverDaemon({ rootDir: process.cwd(), timeoutMs, idleTtlMs });
let stopping = false;

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function isRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function send(/** @type {Record<string, unknown>} */ message) {
    if (!process.connected) return;
    try {
        process.send?.(message);
    } catch {
        // Parent termination is authoritative; there is nothing useful to recover locally when IPC is already gone.
    }
}

async function shutdown(exitCode = 0) {
    if (stopping) return;
    stopping = true;
    try {
        await daemon.stop();
    } finally {
        if (process.connected) process.disconnect?.();
        process.exitCode = exitCode;
    }
}

process.on('message', async (message) => {
    const payload = isRecord(message) ? message : {};
    if (payload['type'] === 'stop') {
        await shutdown(0);
        return;
    }
    if (
        payload['type'] !== 'execute' ||
        typeof payload['id'] !== 'string' ||
        typeof payload['operation'] !== 'string'
    ) {
        return;
    }

    try {
        const result = await daemon.execute(
            payload['operation'],
            isRecord(payload['params']) ? payload['params'] : {},
            typeof payload['timeoutMs'] === 'number' ? { timeoutMs: payload['timeoutMs'] } : {},
        );
        send({ type: 'result', id: payload['id'], success: true, result });
    } catch (error) {
        send({
            type: 'result',
            id: payload['id'],
            success: false,
            error: {
                name: error instanceof Error ? error.name : 'Error',
                message: error instanceof Error ? error.message : String(error),
            },
        });
    }
});

process.once('disconnect', () => {
    void shutdown(0);
});
process.once('SIGTERM', () => {
    void shutdown(0);
});
process.once('SIGINT', () => {
    void shutdown(0);
});

await daemon.start();
send({ type: 'ready', pid: process.pid, timeoutMs, idleTtlMs });
