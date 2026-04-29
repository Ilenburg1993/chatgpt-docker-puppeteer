// @ts-check
/**
 * Testes estruturais e de contrato para o mapa declarativo do bridge EventBus (K6 incremental).
 */

import * as assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'vitest';

import { checkOfficialSeams } from '../../../scripts/check-copilot-official-seams.mjs';
import {
    AGENT_EVENT_BRIDGE_MAP,
    DIALOG_LOOP_EVENT_BRIDGE_MAP,
    HANDOFF_EVENT_BRIDGE_MAP,
} from '../../../src/copilot/agent/event-bridge-map.js';

describe('event-bridge-map › contratos declarativos', () => {
    it('expõe mapas não vazios com cobertura representativa', () => {
        assert.ok(Object.keys(AGENT_EVENT_BRIDGE_MAP).length >= 70);
        assert.ok(Object.keys(DIALOG_LOOP_EVENT_BRIDGE_MAP).length >= 8);
        assert.equal(Object.keys(HANDOFF_EVENT_BRIDGE_MAP).length, 3);
    });

    it('mantém mapeamentos críticos do agente', () => {
        assert.equal(AGENT_EVENT_BRIDGE_MAP.ready, 'agent:ready');
        assert.equal(AGENT_EVENT_BRIDGE_MAP['task.started'], 'agent:task:started');
        assert.equal(AGENT_EVENT_BRIDGE_MAP['question.answered'], 'agent:question:answered');
        assert.equal(AGENT_EVENT_BRIDGE_MAP['session.idle'], 'agent:session:idle');
        assert.equal(AGENT_EVENT_BRIDGE_MAP['dialog.pre_stall_warning'], 'agent:dialog:pre_stall_warning');
    });

    it('mantém mapeamentos críticos de dialog loop e handoff', () => {
        assert.equal(DIALOG_LOOP_EVENT_BRIDGE_MAP.reply, 'agent:dialog:reply');
        assert.equal(DIALOG_LOOP_EVENT_BRIDGE_MAP['compaction.requested'], 'agent:dialog:compaction:requested');
        assert.equal(HANDOFF_EVENT_BRIDGE_MAP['handoff.accepted'], 'agent:handoff:accepted');
    });

    it('always-alive delega o wiring lazy para helper dedicado', () => {
        const alwaysAliveSrc = readFileSync(
            '/workspaces/chatgpt-docker-puppeteer/src/copilot/agent/always-alive.js',
            'utf8',
        );
        const wiringSrc = readFileSync(
            '/workspaces/chatgpt-docker-puppeteer/src/copilot/agent/event-bridge-wiring.js',
            'utf8',
        );
        const surfaceSrc = readFileSync(
            '/workspaces/chatgpt-docker-puppeteer/src/copilot/agent/agent-runtime-surface.js',
            'utf8',
        );

        assert.match(alwaysAliveSrc, /agent-runtime-surface\.js/);
        assert.match(surfaceSrc, /event-bridge-wiring\.js/);
        assert.match(alwaysAliveSrc, /ensureAgentEventBusBridge\(/);
        assert.match(wiringSrc, /wireAgentRuntimeEventBusBridge\(agent, bus\)/);
        assert.doesNotMatch(wiringSrc, /agent\.ctx\.getDialogLoopManagerSnapshot\(/);
        assert.doesNotMatch(wiringSrc, /agent\.ctx\.getHandoffManagerSnapshot\(/);
    });

    it('gate estrutural impede event-bridge-wiring de ler managers crus do runtime', () => {
        const findings = checkOfficialSeams().filter(
            (finding) => finding.rule === 'agent-event-bridge-wiring-must-not-read-runtime-managers-directly',
        );
        assert.deepEqual(findings, []);
    });
});
