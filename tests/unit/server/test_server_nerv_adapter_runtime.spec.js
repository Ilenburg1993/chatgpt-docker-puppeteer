import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import ServerNERVAdapter from '#server/nerv_adapter/server_nerv_adapter';
import { ActionCode, ActorRole, MessageType } from '#shared/nerv/constants';

class MockNerv {
    constructor() {
        this.receiveHandlers = [];
    }

    onReceive(handler) {
        this.receiveHandlers.push(handler);
        return () => {
            const idx = this.receiveHandlers.indexOf(handler);
            if (idx >= 0) this.receiveHandlers.splice(idx, 1);
        };
    }

    offReceive(handler) {
        const idx = this.receiveHandlers.indexOf(handler);
        if (idx >= 0) this.receiveHandlers.splice(idx, 1);
    }

    emitCommand() {}
}

class MockSocketHub {
    constructor() {
        this.events = [];
        this.handlers = new Map();
    }

    emit(name, payload) {
        this.events.push({ name, payload });
    }

    on(name, handler) {
        this.handlers.set(name, handler);
    }

    off(name) {
        this.handlers.delete(name);
    }

    sendToClient() {}
}

describe('ServerNERVAdapter runtime behavior', () => {
    let nerv;
    let socketHub;
    let adapter;

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
            payload: { taskId: 'task-1', result: { ok: true } }
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
});
