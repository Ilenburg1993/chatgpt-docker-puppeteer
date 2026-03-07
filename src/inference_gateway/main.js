#!/usr/bin/env node
// @ts-check

import { createInferenceGatewayServer } from './server.js';
import { inferenceGateway } from './gateway.js';
import { loadInferencePoliciesFromDb } from './persistence.js';

const enabled = String(process.env.INFERENCE_GATEWAY_ENABLED || 'false').toLowerCase() === 'true';
if (!enabled) {
    console.log('[inference-gateway] disabled (INFERENCE_GATEWAY_ENABLED=false)');
    process.exit(0);
}

const host = process.env.INFERENCE_GATEWAY_HOST || '127.0.0.1';
const port = Number(process.env.INFERENCE_GATEWAY_PORT || 3099);

function reloadPolicies() {
    try {
        const loaded = loadInferencePoliciesFromDb();
        inferenceGateway.setPolicies({
            profilePolicies: loaded.profilePolicies,
            clientPolicies: loaded.clientPolicies,
        });
        return {
            ok: true,
            ...loaded.meta,
            summary: inferenceGateway.getPolicySummary(),
        };
    } catch (/** @type {any} */ error) {
        return {
            ok: false,
            error: /** @type {any} */ (error)?.message || String(error),
        };
    }
}

reloadPolicies();

const server = createInferenceGatewayServer({
    gateway: inferenceGateway,
    reloadPolicies,
});
server.listen(port, host, () => {
    console.log(`[inference-gateway] listening on http://${host}:${port}`);
    if (process.send) {
        try {
            process.send('ready');
        } catch {
            // noop
        }
    }
});

let shuttingDown = false;
/** @param {string} signal */
function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[inference-gateway] shutdown via ${signal}`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
