// @ts-check

import assert from 'node:assert/strict';
import EventEmitter from 'node:events';
import { describe, it } from 'vitest';

import {
    readAgentRuntimeEventBridgeSources,
    wireAgentRuntimeEventBusBridge,
} from '../../../src/copilot/agent/facades/agent-runtime-event-bridge.js';

describe('agent-runtime-event-bridge facade', () => {
    it('resolve agent, dialog loop e handoff como fontes oficiais de sinais do runtime', () => {
        const agent = new EventEmitter();
        const dialogLoop = new EventEmitter();
        const handoff = new EventEmitter();
        Object.assign(agent, {
            ctx: {
                getDialogLoopManagerSnapshot: () => dialogLoop,
                getHandoffManagerSnapshot: () => handoff,
            },
        });

        const sources = readAgentRuntimeEventBridgeSources(/** @type {any} */ (agent));

        assert.equal(sources.agent, agent);
        assert.equal(sources.dialogLoop, dialogLoop);
        assert.equal(sources.handoff, handoff);
    });

    it('conecta as três fontes ao EventBus com mapas canônicos', () => {
        const agent = new EventEmitter();
        const dialogLoop = new EventEmitter();
        const handoff = new EventEmitter();
        Object.assign(agent, {
            ctx: {
                getDialogLoopManagerSnapshot: () => dialogLoop,
                getHandoffManagerSnapshot: () => handoff,
            },
        });
        const bus = /** @type {any} */ ({ emit() {} });
        /** @type {{ emitter: EventEmitter; map: Record<string, string> }[]} */
        const calls = [];
        const unsubs = wireAgentRuntimeEventBusBridge(/** @type {any} */ (agent), bus, {
            bridge: (emitter, _bus, map) => {
                calls.push({ emitter, map });
                return () => {};
            },
        });

        assert.equal(unsubs.length, 3);
        const agentCall = calls[0];
        const dialogCall = calls[1];
        const handoffCall = calls[2];
        assert.ok(agentCall);
        assert.ok(dialogCall);
        assert.ok(handoffCall);
        assert.equal(agentCall.emitter, agent);
        assert.equal(agentCall.map.ready, 'agent:ready');
        assert.equal(dialogCall.emitter, dialogLoop);
        assert.equal(dialogCall.map.reply, 'agent:dialog:reply');
        assert.equal(handoffCall.emitter, handoff);
        assert.equal(handoffCall.map['handoff.accepted'], 'agent:handoff:accepted');
    });
});
