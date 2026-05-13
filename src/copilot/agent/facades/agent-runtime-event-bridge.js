// @ts-check
/**
 * @module copilot/agent/facades/agent-runtime-event-bridge
 * @file Façade semântica para wiring dos emitters internos do runtime vivo no EventBus.
 */

import { bridgeEmitter } from '#copilot/core';
import { AGENT_EVENT_BRIDGE_MAP, DIALOG_LOOP_EVENT_BRIDGE_MAP, HANDOFF_EVENT_BRIDGE_MAP } from '../event-bridge/index.js';

/**
 * @typedef {import('node:events').EventEmitter} EventEmitter
 *
 * @typedef {EventEmitter & {
 *     ctx: {
 *         getDialogLoopManagerSnapshot: () => EventEmitter;
 *         getHandoffManagerSnapshot: () => EventEmitter;
 *     };
 * }} AgentRuntimeEventBridgeHost
 *
 *
 * @typedef {{
 *     agent: EventEmitter;
 *     dialogLoop: EventEmitter;
 *     handoff: EventEmitter;
 * }} AgentRuntimeEventBridgeSources
 */

/**
 * Resolve os emitters internos que representam sinais do runtime vivo.
 *
 * @param {AgentRuntimeEventBridgeHost} agent
 * @returns {AgentRuntimeEventBridgeSources}
 */
export function readAgentRuntimeEventBridgeSources(agent) {
    return {
        agent,
        dialogLoop: agent.ctx.getDialogLoopManagerSnapshot(),
        handoff: agent.ctx.getHandoffManagerSnapshot(),
    };
}

/**
 * Conecta os emitters oficiais do runtime vivo ao EventBus central.
 *
 * @param {AgentRuntimeEventBridgeHost} agent
 * @param {import('../../core/event-bus.js').EventBus} bus
 * @param {{ bridge?: typeof bridgeEmitter }} [options]
 * @returns {ReturnType<typeof bridgeEmitter>[]}
 */
export function wireAgentRuntimeEventBusBridge(agent, bus, options = {}) {
    const bridge = options.bridge ?? bridgeEmitter;
    const sources = readAgentRuntimeEventBridgeSources(agent);
    return [
        bridge(sources.agent, bus, AGENT_EVENT_BRIDGE_MAP),
        bridge(sources.dialogLoop, bus, DIALOG_LOOP_EVENT_BRIDGE_MAP),
        bridge(sources.handoff, bus, HANDOFF_EVENT_BRIDGE_MAP),
    ];
}
