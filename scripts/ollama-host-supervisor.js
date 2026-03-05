#!/usr/bin/env node
// @ts-check

import { createOllamaHostSupervisor } from '../src/inference_gateway/ollama_host_supervisor.js';

const enabled = String(process.env.OLLAMA_SUPERVISOR_ENABLED || 'false').toLowerCase() === 'true';

if (!enabled) {
    console.log('[ollama-host-supervisor] disabled (OLLAMA_SUPERVISOR_ENABLED=false)');
    process.exit(0);
}

const supervisor = createOllamaHostSupervisor({
    logger(level, message, data) {
        const suffix = data ? ` ${JSON.stringify(data)}` : '';
        console.log(`[${level}] ${message}${suffix}`);
    },
    onStateChange(state) {
        if (process.send) {
            try {
                process.send({ type: 'ollama_host_state', state });
            } catch {
                // noop
            }
        }
    },
});

let shuttingDown = false;
/**
 * @param {string} signal
 * @returns {Promise<void>}
 */
async function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[ollama-host-supervisor] shutdown requested via ${signal}`);
    try {
        await supervisor.stop();
    } finally {
        process.exit(0);
    }
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

await supervisor.start();
console.log('[ollama-host-supervisor] started');
