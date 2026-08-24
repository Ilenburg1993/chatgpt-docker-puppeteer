// @ts-check

import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'vitest';

import {
    maybeSendMcpToolsListChangedNotification,
    readMcpSchemaConvergenceState,
    recordMcpDescriptorObservation,
    recordMcpToolsListObserved,
} from '#copilot/mcp/public/protocol/catalog';
import {
    recordMcpToolsListChangedNotification,
    resetMcpSchemaConvergenceStateForTests,
} from '#copilot/testing/mcp/protocol/catalog';
import {
    createCopilotMcpServer,
    getCopilotMcpServerFactoryStatus,
    resetCopilotMcpServerFactoryRuntimeForTests,
} from '#copilot/testing/mcp/server';

beforeEach(() => {
    resetMcpSchemaConvergenceStateForTests();
    resetCopilotMcpServerFactoryRuntimeForTests();
});

describe('MCP schema convergence control plane', () => {
    it('tracks descriptor revisions only when the fingerprint changes', () => {
        const first = recordMcpDescriptorObservation({
            fingerprint: 'aaa',
            toolCount: 10,
            listChangedAdvertised: false,
            observedAtMs: 1_000,
        });
        assert.equal(first.status, 'server-descriptor-unlisted');
        assert.equal(first.descriptorRevision, 1);
        assert.equal(first.descriptorObservations, 1);
        assert.equal(first.currentDescriptorFingerprint, 'aaa');
        assert.equal(first.previousDescriptorFingerprint, null);
        assert.equal(first.descriptorSinceAt, new Date(1_000).toISOString());

        const repeated = recordMcpDescriptorObservation({
            fingerprint: 'aaa',
            toolCount: 10,
            listChangedAdvertised: false,
            observedAtMs: 2_000,
        });
        assert.equal(repeated.descriptorRevision, 1);
        assert.equal(repeated.descriptorObservations, 2);
        assert.equal(repeated.descriptorSinceAt, new Date(1_000).toISOString());

        const changed = recordMcpDescriptorObservation({
            fingerprint: 'bbb',
            toolCount: 11,
            listChangedAdvertised: true,
            observedAtMs: 3_000,
        });
        assert.equal(changed.status, 'server-changed-client-unverified');
        assert.equal(changed.descriptorRevision, 2);
        assert.equal(changed.currentDescriptorFingerprint, 'bbb');
        assert.equal(changed.previousDescriptorFingerprint, 'aaa');
        assert.equal(changed.currentToolCount, 11);
        assert.equal(changed.listChangedAdvertised, true);
    });

    it('distinguishes notification awaiting refresh from an observed tools/list convergence', () => {
        recordMcpDescriptorObservation({
            fingerprint: 'aaa',
            toolCount: 10,
            listChangedAdvertised: true,
            observedAtMs: 1_000,
        });
        recordMcpDescriptorObservation({
            fingerprint: 'bbb',
            toolCount: 11,
            listChangedAdvertised: true,
            observedAtMs: 2_000,
        });
        const notified = recordMcpToolsListChangedNotification({ sent: true, observedAtMs: 2_100 });
        assert.equal(notified.status, 'notification-sent-awaiting-refresh');
        assert.equal(notified.listChangedSentCount, 1);

        const relisted = recordMcpToolsListObserved({ protocolVersion: '2025-11-25', observedAtMs: 2_200 });
        assert.equal(relisted.status, 'converged-observed');
        assert.equal(relisted.toolsListObservedCount, 1);
        assert.equal(relisted.lastToolsListProtocolVersion, '2025-11-25');
    });

    it('nudges exactly once per unverified descriptor revision and converges after tools/list', async () => {
        recordMcpDescriptorObservation({
            fingerprint: 'aaa',
            toolCount: 10,
            listChangedAdvertised: true,
            observedAtMs: 1_000,
        });
        let sent = 0;
        const server = {
            async sendToolListChanged() {
                sent += 1;
            },
        };
        const first = await maybeSendMcpToolsListChangedNotification(server);
        const second = await maybeSendMcpToolsListChangedNotification(server);
        assert.deepEqual(first, { attempted: true, sent: true, reason: 'sent' });
        assert.deepEqual(second, { attempted: false, sent: false, reason: 'not-needed' });
        assert.equal(sent, 1);
        let state = readMcpSchemaConvergenceState();
        assert.equal(state.status, 'notification-sent-awaiting-refresh');
        assert.equal(state.listChangedAttemptCount, 1);
        assert.equal(state.lastNotificationAttemptRevision, 1);
        assert.equal(state.listChangedSentCount, 1);

        recordMcpToolsListObserved({ protocolVersion: '2025-11-25', observedAtMs: Date.now() + 10 });
        state = readMcpSchemaConvergenceState();
        assert.equal(state.status, 'converged-observed');
        assert.deepEqual(await maybeSendMcpToolsListChangedNotification(server), {
            attempted: false,
            sent: false,
            reason: 'not-needed',
        });
    });

    it('records send failures without retry fan-out in the same revision', async () => {
        recordMcpDescriptorObservation({
            fingerprint: 'aaa',
            toolCount: 10,
            listChangedAdvertised: true,
            observedAtMs: 1_000,
        });
        const failed = await maybeSendMcpToolsListChangedNotification({
            async sendToolListChanged() {
                throw new Error('transport unavailable');
            },
        });
        assert.equal(failed.attempted, true);
        assert.equal(failed.sent, false);
        assert.equal(failed.reason, 'send-failed');
        assert.equal(readMcpSchemaConvergenceState().listChangedErrorCount, 1);
        assert.equal((await maybeSendMcpToolsListChangedNotification({})).attempted, false);
    });

    it('records the canonical factory descriptor in the same convergence state', async () => {
        const server = createCopilotMcpServer();
        try {
            const factory = getCopilotMcpServerFactoryStatus();
            const runtime = /** @type {Record<string, unknown>} */ (factory['runtime']);
            const convergence = /** @type {Record<string, unknown>} */ (factory['schemaConvergence']);
            const direct = readMcpSchemaConvergenceState();
            assert.equal(convergence['currentDescriptorFingerprint'], runtime['lastDescriptorFingerprint']);
            assert.equal(convergence['currentDescriptorFingerprint'], direct.currentDescriptorFingerprint);
            assert.equal(convergence['currentToolCount'], runtime['lastToolCount']);
            assert.equal(convergence['descriptorRevision'], 1);
            assert.equal(convergence['listChangedAdvertised'], true);
        } finally {
            await server.close();
        }
    });
});
