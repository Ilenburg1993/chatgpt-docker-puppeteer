// @ts-check
/**
 * Testes estruturais para o pipeline nomeado de boot-wiring (K5 incremental).
 */

import * as assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'vitest';

const BOOT_WIRING_PATH = '/workspaces/chatgpt-docker-puppeteer/src/copilot/agent/session/boot-wiring.js';
const BOOT_STEPS_PATH = '/workspaces/chatgpt-docker-puppeteer/src/copilot/agent/session/boot-steps.js';
const SRC = readFileSync(BOOT_WIRING_PATH, 'utf8');
const STEPS_SRC = readFileSync(BOOT_STEPS_PATH, 'utf8');

describe('boot-wiring › pipeline nomeado', () => {
    it('expõe createBootWiringSteps() e runBootPipeline()', () => {
        assert.match(SRC, /export function createBootWiringSteps\(/);
        assert.match(SRC, /export async function runBootPipeline\(/);
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
        assert.match(SRC, /await runBootPipeline\(steps, state\)/);
        assert.match(SRC, /const bootReport = \{/);
        assert.match(SRC, /const failedCount = stepReports\.filter\(\(step\) => step\.status === 'failed'\)\.length/);
        assert.match(
            SRC,
            /const degradedCount = stepReports\.filter\(\(step\) => step\.status === 'degraded'\)\.length/,
        );
        assert.ok(SRC.includes('return {'), 'performBootWiring deve retornar objeto canônico');
        assert.ok(SRC.includes('agentObserver'), 'retorno deve incluir agentObserver');
        assert.ok(SRC.includes('metricsTimer'), 'retorno deve incluir metricsTimer');
        assert.ok(SRC.includes('mcpReconnectCancel'), 'retorno deve incluir mcpReconnectCancel');
        assert.ok(SRC.includes('quotaMonitor'), 'retorno deve incluir quotaMonitor');
        assert.ok(SRC.includes('bootReport'), 'retorno deve incluir bootReport');
    });

    it('runner de boot usa policy por step e criticidade explícita', () => {
        assert.match(SRC, /import \{ withAgentErrorPolicy \} from '\.\.\/error-policy\.js'/);
        assert.match(SRC, /async function runBootStepWithPolicy\(/);
        assert.match(SRC, /required: true/);
        assert.match(SRC, /required: false/);
        assert.match(SRC, /status === 'failed'/);
        assert.match(SRC, /status === 'degraded'/);
        assert.ok(SRC.includes('skipped'), 'runner deve lidar com steps skipped');
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
        assert.match(SRC, /stepWireQuestionAnsweredRelay\(agentEmitter, ctx, state\)/);
        assert.match(STEPS_SRC, /trackBackgroundTask\(/);
    });
});
