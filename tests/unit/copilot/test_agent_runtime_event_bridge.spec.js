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
        assert.equal(calls[0].emitter, agent);
        assert.equal(calls[0].map.ready, 'agent:ready');
        assert.equal(calls[1].emitter, dialogLoop);
        assert.equal(calls[1].map.reply, 'agent:dialog:reply');
        assert.equal(calls[2].emitter, handoff);
        assert.equal(calls[2].map['handoff.accepted'], 'agent:handoff:accepted');
    });
});
