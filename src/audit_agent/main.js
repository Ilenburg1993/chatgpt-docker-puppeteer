#!/usr/bin/env node
// @ts-check

import { AUDIT_JOB_STATUS } from './contracts.js';
import { AuditAgentRuntime } from './runtime.js';
import { createAuditAgentServer } from './server.js';

const enabled = String(process.env.AUDIT_AGENT_ENABLED || 'false').toLowerCase() === 'true';
if (!enabled) {
    console.log('[audit-agent] disabled (AUDIT_AGENT_ENABLED=false)');
    process.exit(0);
}

const cfg = {
    mode: String(process.env.AUDIT_AGENT_MODE || 'semi_auto'),
    maxConcurrentJobs: Number(process.env.AUDIT_AGENT_MAX_CONCURRENT_JOBS || 1),
    maxParallelLlmCalls: Number(process.env.AUDIT_AGENT_MAX_PARALLEL_LLM_CALLS || 1),
    triggerDebounceMs: Number(process.env.AUDIT_AGENT_TRIGGER_DEBOUNCE_MS || 5000),
    jobCooldownMs: Number(process.env.AUDIT_AGENT_JOB_COOLDOWN_MS || 30000),
    host: String(process.env.AUDIT_AGENT_HOST || '127.0.0.1'),
    port: Number(process.env.AUDIT_AGENT_PORT || 3098),
    persistDb: String(process.env.AUDIT_AGENT_PERSIST_DB || 'true').toLowerCase() !== 'false',
};

let store = null;
if (cfg.persistDb) {
    try {
        const { createAuditAgentDbStore } = await import('./db_store.js');
        store = createAuditAgentDbStore();
    } catch (error) {
        console.warn(`[audit-agent] db store unavailable (fallback in-memory): ${error?.message || String(error)}`);
    }
}
let contextBuilder = null;
try {
    const { createAuditAgentContextBuilder } = await import('./context_builder.js');
    contextBuilder = createAuditAgentContextBuilder();
} catch (error) {
    console.warn(`[audit-agent] context builder unavailable (read-only probes disabled): ${error?.message || String(error)}`);
}
let triageClient = null;
try {
    const { createAuditAgentTriageLlmClient } = await import('./triage_llm.js');
    triageClient = createAuditAgentTriageLlmClient();
} catch (error) {
    console.warn(`[audit-agent] triage llm client unavailable (LLM triage disabled): ${error?.message || String(error)}`);
}
let patchAuthorClient = null;
try {
    const { createAuditAgentPatchAuthorLlmClient } = await import('./patch_author_llm.js');
    patchAuthorClient = createAuditAgentPatchAuthorLlmClient();
} catch (error) {
    console.warn(`[audit-agent] patch author llm client unavailable (LLM patch author disabled): ${error?.message || String(error)}`);
}

const runtime = new AuditAgentRuntime({
    maxConcurrentJobs: cfg.maxConcurrentJobs,
    store,
    contextBuilder,
    triageClient,
    patchAuthorClient,
    logger(level, message, data) {
        const suffix = data ? ` ${JSON.stringify(data)}` : '';
        console.log(`[${level}] ${message}${suffix}`);
    },
});
const server = createAuditAgentServer({ runtime });

console.log('[audit-agent] starting (skeleton)', { cfg, initialStatus: AUDIT_JOB_STATUS.PENDING });

if (String(process.env.AUDIT_AGENT_HYDRATE_ON_START || 'true').toLowerCase() === 'true') {
    const hydration = runtime.hydrateFromStore({ limit: Number(process.env.AUDIT_AGENT_HYDRATE_LIMIT || 200) });
    console.log('[audit-agent] hydration', hydration);
}

const heartbeat = setInterval(() => {
    void runtime.tick();
}, Math.max(1000, cfg.triggerDebounceMs));
heartbeat.unref?.();

await new Promise((resolve, reject) => {
    server.listen(cfg.port, cfg.host, err => (err ? reject(err) : resolve(undefined)));
});
console.log(`[audit-agent] http listening on http://${cfg.host}:${cfg.port}`);
if (process.send) {
    try {
        process.send('ready');
    } catch {
        // noop
    }
}

let shuttingDown = false;
function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[audit-agent] shutdown via ${signal}`);
    clearInterval(heartbeat);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
