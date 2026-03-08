// @ts-check
import ServerNERVAdapter from '#server/nerv_adapter/server_nerv_adapter';
import { ActionCode, ActorRole, MessageType } from '#shared/nerv/constants';
import assert from 'node:assert';
import { beforeEach, describe, it } from 'node:test';

class MockNerv {
    constructor() {
        this.receiveHandlers = /** @type {any[]} */ ([]);
    }

    onReceive(/** @type {any} */ handler) {
        this.receiveHandlers.push(handler);
        return () => {
            const idx = this.receiveHandlers.indexOf(handler);
            if (idx >= 0) this.receiveHandlers.splice(idx, 1);
        };
    }

    offReceive(/** @type {any} */ handler) {
        const idx = this.receiveHandlers.indexOf(handler);
        if (idx >= 0) this.receiveHandlers.splice(idx, 1);
    }

    emitCommand() {}
}

class MockSocketHub {
    constructor() {
        this.events = /** @type {any[]} */ ([]);
        this.handlers = new Map();
    }

    emit(/** @type {any} */ name, /** @type {any} */ payload) {
        this.events.push({ name, payload });
    }

    on(/** @type {any} */ name, /** @type {any} */ handler) {
        this.handlers.set(name, handler);
    }

    off(/** @type {any} */ name) {
        this.handlers.delete(name);
    }

    sendToClient(/** @type {any} */ clientId, /** @type {any} */ event, /** @type {any} */ payload) {
        this.events.push({ name: event, payload, clientId });
    }
}

describe('ServerNERVAdapter runtime behavior', () => {
    /** @type {any} */ let nerv;
    /** @type {any} */ let socketHub;
    /** @type {any} */ let adapter;

    beforeEach(() => {
        nerv = new MockNerv();
        socketHub = new MockSocketHub();
        adapter = new ServerNERVAdapter(nerv, socketHub, {});
    });

    it('should accept canonical NERV envelope and enrich dashboard payload', async () => {
        const envelope = {
            protocol: { version: '1.0', timestamp: Date.now() },
            identity: { actor: ActorRole.DRIVER, target: ActorRole.SERVER },
            causality: { msg_id: 'msg-1', correlation_id: 'corr-1' },
            type: { message_type: MessageType.EVENT, action_code: ActionCode.DRIVER_TASK_COMPLETED },
            payload: { taskId: 'task-1', result: { ok: true } },
        };

        nerv.receiveHandlers[0](envelope);

        assert.strictEqual(socketHub.events.length, 1);
        const emitted = socketHub.events[0];
        assert.strictEqual(emitted.name, 'driver:task_completed');
        assert.strictEqual(emitted.payload.actionCode, ActionCode.DRIVER_TASK_COMPLETED);
        assert.strictEqual(emitted.payload.messageType, MessageType.EVENT);
        assert.strictEqual(emitted.payload.correlationId, 'corr-1');
        assert.strictEqual(emitted.payload.actor, ActorRole.DRIVER);
        assert.ok(emitted.payload.msgId);
        assert.ok(emitted.payload.protocolVersion);
    });

    it('should reject commands that require taskId when missing', async () => {
        await adapter._handleDashboardCommand({
            command: 'driver:abort',
            clientId: 'client-1',
            payload: {},
        });

        const commandError = socketHub.events.find((/** @type {any} */ evt) => evt.name === 'command:error');
        assert.ok(commandError);
        assert.strictEqual(commandError.payload.error, 'TASK_ID_REQUIRED');
    });

    it('should include taskId in dashboard command ack and preserve provided correlationId', async () => {
        await adapter._handleDashboardCommand({
            command: 'task:cancel',
            clientId: 'client-2',
            correlationId: 'corr-client-123',
            payload: { task_id: 'task-xyz' },
        });

        const ack = socketHub.events.find((/** @type {any} */ evt) => evt.name === 'command:ack');
        assert.ok(ack);
        assert.strictEqual(ack.payload.taskId, 'task-xyz');
        assert.strictEqual(ack.payload.correlationId, 'corr-client-123');
    });

    it('should expose taskId in broadcast payload when envelope has task metadata', () => {
        const envelope = {
            protocol: { version: '1.0', timestamp: Date.now() },
            identity: { actor: ActorRole.DRIVER, target: ActorRole.SERVER },
            causality: { msg_id: 'msg-2', correlation_id: 'corr-2' },
            type: { message_type: MessageType.EVENT, action_code: ActionCode.DRIVER_TASK_FAILED },
            payload: { task_id: 'task-failed-1', error: 'boom' },
        };

        nerv.receiveHandlers[0](envelope);

        const emitted = socketHub.events.find((/** @type {any} */ evt) => evt.name === 'driver:task_failed');
        assert.ok(emitted);
        assert.strictEqual(emitted.payload.taskId, 'task-failed-1');
        assert.strictEqual(emitted.payload.correlationId, 'corr-2');
    });
});
