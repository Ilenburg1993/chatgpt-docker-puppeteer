// @ts-check
/**
 * Testes estruturais para o pipeline nomeado de boot-wiring (K5 incremental).
 */

import * as assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const BOOT_WIRING_PATH = '/workspaces/chatgpt-docker-puppeteer/src/copilot/agent/session/boot-wiring.js';
const BOOT_STEPS_PATH = '/workspaces/chatgpt-docker-puppeteer/src/copilot/agent/session/boot-steps.js';
const SRC = readFileSync(BOOT_WIRING_PATH, 'utf8');
const STEPS_SRC = readFileSync(BOOT_STEPS_PATH, 'utf8');

describe('boot-wiring › pipeline nomeado', () => {
    it('expõe createBootWiringSteps() e runBootPipeline()', () => {
        assert.match(SRC, /export function createBootWiringSteps\(/);
        assert.match(SRC, /export function runBootPipeline\(/);
    });

    it('mantém 12 etapas nomeadas no pipeline de boot', () => {
        const expectedNames = [
            'wireSessionEvents',
            'attachEventCollector',
            'registerClientLifecycleHandlers',
            'attachAgentObserver',
            'cleanupStaleSessions',
            'scheduleDialogRecovery',
            'startMetricsTimer',
            'startMcpReconnect',
            'startKeepalive',
            'startQuotaMonitor',
            'wireHandoff',
            'wireQuestionAnsweredRelay',
        ];

        for (const name of expectedNames) {
            assert.match(SRC, new RegExp(`name: '${name}'`));
        }
    });

    it('performBootWiring usa o pipeline e preserva o retorno canônico', () => {
        assert.match(SRC, /const state = createBootWiringState\(\)/);
        assert.match(SRC, /const steps = createBootWiringSteps\(/);
        assert.match(SRC, /runBootPipeline\(steps\)/);
        assert.match(SRC, /return \{ unsubs, agentObserver, metricsTimer, mcpReconnectCancel, quotaMonitor \}/);
    });

    it('delega a implementação das steps para módulo dedicado', () => {
        assert.match(SRC, /from '\.\/boot-steps\.js'/);
        assert.match(STEPS_SRC, /export function createBootWiringState\(/);
        assert.match(STEPS_SRC, /export function stepWireSessionEvents\(/);
        assert.match(STEPS_SRC, /export function stepStartKeepalive\(/);
        assert.match(STEPS_SRC, /export async function runDialogBootRecovery\(/);
        assert.match(STEPS_SRC, /export function stepWireQuestionAnsweredRelay\(/);
    });

    it('passa o contexto para steps que usam o tracker de background', () => {
        assert.match(SRC, /stepWireQuestionAnsweredRelay\(agentEmitter, ctx\)/);
        assert.match(STEPS_SRC, /backgroundTasks\.track\(/);
    });
});
