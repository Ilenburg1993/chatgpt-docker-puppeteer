// @ts-check

import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'vitest';

import {
    maybeSendMcpToolsListChangedNotification,
    readMcpDescriptorObservationState,
    recordMcpDescriptorObservation,
    recordMcpToolsListObserved,
} from '#copilot/mcp/public/protocol/catalog';
import {
    recordMcpToolsListChangedNotification,
    resetMcpDescriptorObservationStateForTests,
} from '#copilot/testing/mcp/protocol/catalog';
import {
    createCopilotMcpServer,
    getCopilotMcpServerFactoryStatus,
    resetCopilotMcpServerFactoryRuntimeForTests,
} from '#copilot/testing/mcp/server';

beforeEach(() => {
    resetMcpDescriptorObservationStateForTests();
    resetCopilotMcpServerFactoryRuntimeForTests();
});

describe('MCP descriptor observation control plane', () => {
    it('tracks descriptor revisions only when the fingerprint changes', () => {
        const first = recordMcpDescriptorObservation({
            fingerprint: 'aaa',
            toolCount: 10,
            listChangedAdvertised: false,
            observedAtMs: 1_000,
        });
        assert.equal(first.status, 'not-listed-this-generation');
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
        assert.equal(changed.status, 'descriptor-changed-unlisted');
        assert.equal(changed.descriptorRevision, 2);
        assert.equal(changed.currentDescriptorFingerprint, 'bbb');
        assert.equal(changed.previousDescriptorFingerprint, 'aaa');
        assert.equal(changed.currentToolCount, 11);
        assert.equal(changed.listChangedAdvertised, true);
    });

    it('distinguishes a notification nudge from an origin-observed tools/list', () => {
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
        assert.equal(notified.status, 'notification-sent-unlisted');
        assert.equal(notified.listChangedSentCount, 1);

        const relisted = recordMcpToolsListObserved({ protocolVersion: '2025-11-25', observedAtMs: 2_200 });
        assert.equal(relisted.status, 'listed-this-generation');
        assert.equal(relisted.toolsListObservedCount, 1);
        assert.equal(relisted.lastToolsListProtocolVersion, '2025-11-25');
    });

    it('nudges exactly once per unlisted descriptor revision and records a later tools/list', async () => {
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
        let state = readMcpDescriptorObservationState();
        assert.equal(state.status, 'notification-sent-unlisted');
        assert.equal(state.listChangedAttemptCount, 1);
        assert.equal(state.lastNotificationAttemptRevision, 1);
        assert.equal(state.listChangedSentCount, 1);

        recordMcpToolsListObserved({ protocolVersion: '2025-11-25', observedAtMs: Date.now() + 10 });
        state = readMcpDescriptorObservationState();
        assert.equal(state.status, 'listed-this-generation');
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
        assert.equal(readMcpDescriptorObservationState().listChangedErrorCount, 1);
        assert.equal((await maybeSendMcpToolsListChangedNotification({})).attempted, false);
    });

    it('records the canonical factory descriptor in the same origin observation state', async () => {
        const server = createCopilotMcpServer();
        try {
            const factory = getCopilotMcpServerFactoryStatus();
            const runtime = /** @type {Record<string, unknown>} */ (factory['runtime']);
            const observation = /** @type {Record<string, unknown>} */ (factory['descriptorObservation']);
            const direct = readMcpDescriptorObservationState();
            assert.equal(observation['scope'], 'origin-mcp-descriptor-observation');
            assert.equal(observation['currentDescriptorFingerprint'], runtime['lastDescriptorFingerprint']);
            assert.equal(observation['currentDescriptorFingerprint'], direct.currentDescriptorFingerprint);
            assert.equal(observation['currentToolCount'], runtime['lastToolCount']);
            assert.equal(observation['descriptorRevision'], 1);
            assert.equal(observation['listChangedAdvertised'], true);
            const chatgptSnapshot = /** @type {Record<string, unknown>} */ (observation['chatgptActionSnapshot']);
            assert.equal(chatgptSnapshot['observableFromOrigin'], false);
            assert.equal(chatgptSnapshot['status'], 'external-admin-state');
            assert.match(String(chatgptSnapshot['inferenceBoundary']), /does not prove/u);
        } finally {
            await server.close();
        }
    });
});
