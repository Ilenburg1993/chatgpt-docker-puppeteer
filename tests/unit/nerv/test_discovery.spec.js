// @ts-check
import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import * as PATHS from '#infra/fs/paths';
import * as Discovery from '#nerv/discovery';
import { ActionCode } from '#shared/nerv/constants';

function makeMockNerv() {
    let listeners = [];
    return {
        onEvent(handler) {
            listeners.push(handler);
            return () => {
                listeners = listeners.filter(h => h !== handler);
            };
        },
        emitEvent(envelope) {
            listeners.slice().forEach(h => {
                try {
                    h(envelope);
                } catch (e) {
                    /* ignore */
                }
            });
        },
        emitCommand(envelope) {
            listeners.slice().forEach(h => {
                try {
                    h(envelope);
                } catch (e) {
                    /* ignore */
                }
            });
        },
        emitAck(envelope) {
            listeners.slice().forEach(h => {
                try {
                    h(envelope);
                } catch (e) {
                    /* ignore */
                }
            });
        },
    };
}

test('publishServerReady uses NERV emitEvent', async () => {
    const mock = makeMockNerv();
    let captured = null;
    // Replace emitEvent to capture envelope
    mock.emitEvent = env => {
        captured = env;
    };

    const payload = { port: 3008 };
    await Discovery.publishServerReady(mock, payload);

    assert.ok(captured, 'envelope should be emitted');
    assert.strictEqual(captured.type.action_code, ActionCode.SERVER_READY);
    assert.strictEqual(captured.payload.port, 3008);
});

test('waitForServerReady resolves when NERV emits SERVER_READY', async () => {
    const mock = makeMockNerv();
    const p = Discovery.waitForServerReady(mock, { timeoutMs: 1000 });

    setTimeout(() => {
        mock.emitEvent({ type: { action_code: ActionCode.SERVER_READY }, payload: { port: 3010 } });
    }, 10);

    const payload = await p;
    assert.strictEqual(payload.port, 3010);
});

test('listenForServerReady calls handler and unsubscribe works', async () => {
    const mock = makeMockNerv();
    let calls = 0;
    const unsub = Discovery.listenForServerReady(mock, payload => {
        calls++;
    });

    mock.emitEvent({ type: { action_code: ActionCode.SERVER_READY }, payload: { port: 3011 } });
    mock.emitEvent({ type: { action_code: ActionCode.SERVER_READY }, payload: { port: 3012 } });

    assert.strictEqual(calls, 2);
    unsub();
    mock.emitEvent({ type: { action_code: ActionCode.SERVER_READY }, payload: { port: 3013 } });
    assert.strictEqual(calls, 2);
});

test('publish/unpublish no-op when NERV absent (file fallback removed)', async () => {
    const prev = process.env.ENABLE_STATE_FILE;
    process.env.ENABLE_STATE_FILE = 'true';

    try {
        // publish with null nerv should NO-OP and return null
        const res = await Discovery.publishServerReady(null, { port: 3020, pid: 12345 });
        assert.strictEqual(res, null, 'publishServerReady should return null when NERV absent');

        // STATE file must not be created
        const exists = fs.existsSync(PATHS.STATE);
        assert.strictEqual(exists, false, 'STATE file must NOT be created (fallback removed)');

        // unpublish should be a no-op and return false
        const removed = Discovery.unpublishServerReady();
        assert.strictEqual(removed, false, 'unpublish should be a no-op when fallback removed');
    } finally {
        if (prev === undefined) delete process.env.ENABLE_STATE_FILE;
        else process.env.ENABLE_STATE_FILE = prev;
    }
});
