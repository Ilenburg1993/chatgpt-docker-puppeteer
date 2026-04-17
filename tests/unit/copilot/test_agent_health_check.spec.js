// @ts-check

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { getAgentHealthSnapshot } from '../../../src/copilot/agent/health-check.js';

/**
 * @param {{
 *     status?: import('../../../src/copilot/agent/types.js').AgentStatus;
 *     sessionId?: string | null;
 *     queueSize?: number;
 *     oldestTaskWaitMs?: number;
 *     starvationAlert?: boolean;
 *     isResumed?: boolean;
 * }} [overrides]
 */
function createHost(overrides = {}) {
    return {
        getStatusSnapshot() {
            return {
                status: overrides.status ?? 'idle',
                sessionId: overrides.sessionId ?? 'session-1',
                model: 'gpt-5',
                reasoningEffort: 'high',
                queueSize: overrides.queueSize ?? 0,
                oldestTaskWaitMs: overrides.oldestTaskWaitMs ?? 0,
                starvationAlert: overrides.starvationAlert ?? false,
                pendingQuestion: null,
                isResumed: overrides.isResumed ?? false,
                resumeCount: 0,
                sendCount: 0,
                startedAt: Date.now() - 1000,
                contextWindow: null,
                lastCheckpointPath: null,
                permissionMode: 'approve_all',
            };
        },
    };
}

/**
 * @param {{
 *     hasClient?: boolean;
 *     hasSession?: boolean;
 *     dialogActive?: boolean;
 *     dialogAttached?: boolean;
 *     pendingQuestion?: boolean;
 *     keepaliveRunning?: boolean;
 *     backgroundPendingCount?: number;
 *     quotaMonitorRunning?: boolean;
 * }} [overrides]
 */
function createContext(overrides = {}) {
    return /** @type {import('../../../src/copilot/agent/agent-context.js').AgentContext} */ ({
        ioState: {
            client: overrides.hasClient === false ? null : /** @type {any} */ ({}),
        },
        sessionState: {
            session: overrides.hasSession === false ? null : /** @type {any} */ ({}),
        },
        dialogState: {
            pendingQuestion: overrides.pendingQuestion ? /** @type {any} */ ({ question: 'Q?' }) : null,
            dialogLoopAttached: overrides.dialogAttached ?? true,
        },
        dialogLoop: {
            active: overrides.dialogActive ?? false,
            paused: false,
        },
        keepalive: {
            running: overrides.keepaliveRunning ?? true,
        },
        backgroundTasks: {
            pendingCount: overrides.backgroundPendingCount ?? 0,
        },
        quotaMonitor: overrides.quotaMonitorRunning ? /** @type {any} */ ({ stop() {} }) : null,
    });
}

describe('agent/health-check', () => {
    it('retorna healthy quando runtime, sessão e fila estão consistentes', () => {
        const health = getAgentHealthSnapshot(createContext({ quotaMonitorRunning: true }), createHost());

        assert.equal(health.ok, true);
        assert.equal(health.healthy, true);
        assert.equal(health.status, 'healthy');
        assert.deepEqual(health.issues, []);
        assert.equal(health.checks.runtime.ok, true);
        assert.equal(health.agentStatus, 'idle');
        assert.equal(health.checks.client.ok, true);
        assert.equal(health.checks.session.ok, true);
        assert.equal(health.checks.queue.ok, true);
        assert.equal(health.checks.io.ok, true);
        assert.equal(health.checks.quota.ok, true);
        assert.equal(health.checks.background.ok, true);
    });

    it('retorna degraded quando há inconsistência de dialog, starvation e backlog alto', () => {
        const health = getAgentHealthSnapshot(
            createContext({ dialogActive: true, dialogAttached: false, backgroundPendingCount: 12 }),
            createHost({ starvationAlert: true, oldestTaskWaitMs: 65_000, queueSize: 2 }),
        );

        assert.equal(health.ok, true);
        assert.equal(health.status, 'degraded');
        assert.equal(health.checks.dialog.ok, false);
        assert.equal(health.checks.queue.ok, false);
        assert.equal(health.checks.background.ok, false);
        assert.equal(health.checks.quota.ok, false);
        assert.ok(health.issues.includes('dialog.detached_while_active'));
        assert.ok(health.issues.includes('queue.starvation'));
        assert.ok(health.issues.includes('background.backlog_high'));
        assert.ok(health.issues.includes('quota.monitor_missing'));
        assert.equal(health.starvationAlert, true);
    });

    it('retorna unhealthy quando runtime não está operacional ou sessão/client faltam', () => {
        const health = getAgentHealthSnapshot(
            createContext({ hasClient: false, hasSession: false, pendingQuestion: true }),
            createHost({ status: 'stopped', sessionId: null }),
        );

        assert.equal(health.ok, false);
        assert.equal(health.healthy, false);
        assert.equal(health.status, 'unhealthy');
        assert.ok(health.issues.includes('runtime.not_operational.stopped'));
        assert.ok(health.issues.includes('client.unavailable'));
        assert.ok(health.issues.includes('session.inactive'));
        assert.equal(health.checks.client.ok, false);
        assert.equal(health.checks.session.ok, false);
    });
});
