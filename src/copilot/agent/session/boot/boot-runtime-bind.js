// @ts-check
/**
 * @module copilot/agent/session/boot-runtime-bind
 * @file Seams de binding operacional do runtime (observer, métricas, MCP, keepalive e relays).
 */

import {
    EMITTER_AGENT_METRICS,
    EMITTER_MCP_RECONNECTED,
    EMITTER_QUESTION_ANSWERED,
    EMITTER_SESSION_KEEPALIVE,
} from '#copilot/events';
import { MCP_RECONNECT_MS, METRICS_INTERVAL_MS } from '#copilot/config/agent';
import { registerTimer } from '#copilot/core';
import { getAgentSdkModelStatsTracker, isAgentSdkExperimentalEnabled } from '../../facades/index.js';
import {
    createAgentEventObserver,
    defaultErrorTracker,
    defaultMetrics,
    log,
    readAgentMcpCapabilitySnapshot,
    resolveAgentUserInput,
} from '../../ports/index.js';
import { reapExpiredPendingQuestionShadow } from './index.js';

/**
 * @typedef {import('./boot-session-prep.js').BootWiringContext} BootWiringContext
 *
 * @typedef {import('./boot-session-prep.js').BootWiringPipelineState} BootWiringPipelineState
 */

/**
 * @param {import('node:events').EventEmitter} agentEmitter
 * @param {BootWiringPipelineState} state
 * @param {{ eventBus?: import('../../../core/event-bus.js').EventBus }} [options]
 * @returns {void}
 */
export function stepAttachAgentObserver(agentEmitter, state, options) {
    const agentObserver = createAgentEventObserver({
        metrics: defaultMetrics,
        errorTracker: defaultErrorTracker,
        modelStatsTracker: getAgentSdkModelStatsTracker(),
    });
    if (options?.eventBus) {
        agentObserver.attachToBus(options.eventBus);
    } else {
        agentObserver.attach(agentEmitter);
    }
    state.agentObserver = agentObserver;
}

/**
 * @param {BootWiringContext} ctx
 * @param {BootWiringPipelineState} state
 * @returns {void}
 */
export function stepStartMetricsTimer(ctx, state) {
    if (METRICS_INTERVAL_MS <= 0) {
        state.metricsTimer = null;
        return;
    }

    const metricsTimer = setInterval(() => {
        reapExpiredPendingQuestionShadow(ctx);
        ctx.emit(EMITTER_AGENT_METRICS, ctx.getStatusSnapshot());
    }, METRICS_INTERVAL_MS);
    metricsTimer.unref();
    registerTimer('agent.metricsEmit', 'interval', metricsTimer);
    state.metricsTimer = metricsTimer;
}

/**
 * @param {BootWiringContext} ctx
 * @param {BootWiringPipelineState} state
 * @returns {void}
 */
export function stepStartMcpReconnect(ctx, state) {
    const mcpBridge = readAgentMcpCapabilitySnapshot(ctx);
    state.mcpReconnectCancel = mcpBridge.startAutoReconnect(
        (/** @type {import('#copilot/sdk/types').Tool[]} */ tools) => {
            ctx.emit(EMITTER_MCP_RECONNECTED, { toolCount: tools.length, ts: Date.now() });
        },
        MCP_RECONNECT_MS,
    );
}

/**
 * @param {BootWiringContext} ctx
 * @returns {void}
 */
export function stepStartKeepalive(ctx) {
    ctx.startKeepalive({
        isIdle: () => ctx.getStatus() === 'idle',
        onKeepalive: (/** @type {{ ts: number; strategy: 'client.ping' | 'session.send' }} */ info) => {
            defaultMetrics.recordKeepalivePing();
            ctx.emit(EMITTER_SESSION_KEEPALIVE, { ts: info.ts, strategy: info.strategy });
        },
    });
}

/**
 * @param {import('node:events').EventEmitter} agentEmitter
 * @param {BootWiringContext} ctx
 * @param {BootWiringPipelineState} state
 * @returns {void}
 */
export function stepWireHandoff(agentEmitter, ctx, state) {
    if (isAgentSdkExperimentalEnabled('fleet')) {
        const onHandoff = (
            /**
             * @type {{
             *     fromAgent: string;
             *     toAgent: string;
             *     reason?: string;
             *     context?: Record<string, unknown>;
             * }}
             */ data,
        ) => {
            ctx.receiveHandoff(data);
            defaultMetrics.recordHandoff();
        };
        agentEmitter.on('session.handoff', onHandoff);
        state.unsubs.push(() => agentEmitter.off('session.handoff', onHandoff));
    } else {
        log('DEBUG', '[BootWiring] Handoff wiring desabilitado (experimental.fleet não habilitado).');
    }
}

/**
 * @param {import('node:events').EventEmitter} agentEmitter
 * @param {BootWiringContext} ctx
 * @param {BootWiringPipelineState} state
 * @returns {void}
 */
export function stepWireQuestionAnsweredRelay(agentEmitter, ctx, state) {
    const onQuestionAnswered = (
        /** @type {{ answer?: string; requestId?: string; resolvedViaTool?: boolean }} */ evt,
    ) => {
        if (typeof evt?.answer !== 'string') {
            return;
        }
        if (evt.resolvedViaTool === true) {
            return;
        }
        const answer = evt.answer;
        void ctx.trackBackgroundTask(Promise.resolve(resolveAgentUserInput(answer, evt.requestId)), {
            label: 'hooks.question_answered.relay',
            description: 'Relay question.answered answers into hook tools resolver',
        });
    };
    agentEmitter.on(EMITTER_QUESTION_ANSWERED, onQuestionAnswered);
    state.unsubs.push(() => agentEmitter.off(EMITTER_QUESTION_ANSWERED, onQuestionAnswered));
}
