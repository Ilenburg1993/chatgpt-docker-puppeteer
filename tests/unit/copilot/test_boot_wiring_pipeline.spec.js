// @ts-check
/**
 * Testes estruturais para o pipeline nomeado de boot-wiring (K5 incremental).
 */

import * as assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'vitest';

const BOOT_WIRING_PATH = '/workspaces/chatgpt-docker-puppeteer/src/copilot/agent/session/boot/boot-wiring.js';
const BOOT_STEPS_PATH = '/workspaces/chatgpt-docker-puppeteer/src/copilot/agent/session/boot/boot-steps.js';
const BOOT_SESSION_PREP_PATH =
    '/workspaces/chatgpt-docker-puppeteer/src/copilot/agent/session/boot/boot-session-prep.js';
const BOOT_DIALOG_RECOVERY_PATH =
    '/workspaces/chatgpt-docker-puppeteer/src/copilot/agent/session/boot/boot-dialog-recovery.js';
const BOOT_RUNTIME_BIND_PATH =
    '/workspaces/chatgpt-docker-puppeteer/src/copilot/agent/session/boot/boot-runtime-bind.js';
const SRC = readFileSync(BOOT_WIRING_PATH, 'utf8');
const STEPS_SRC = readFileSync(BOOT_STEPS_PATH, 'utf8');
const BOOT_SESSION_PREP_SRC = readFileSync(BOOT_SESSION_PREP_PATH, 'utf8');
const BOOT_DIALOG_RECOVERY_SRC = readFileSync(BOOT_DIALOG_RECOVERY_PATH, 'utf8');
const BOOT_RUNTIME_BIND_SRC = readFileSync(BOOT_RUNTIME_BIND_PATH, 'utf8');

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
        assert.match(SRC, /import \{ withAgentErrorPolicy \} from '\.\.\/\.\.\/error\/index\.js'/);
        assert.match(SRC, /async function runBootStepWithPolicy\(/);
        assert.match(SRC, /required: true/);
        assert.match(SRC, /required: false/);
        assert.match(SRC, /status === 'failed'/);
        assert.match(SRC, /status === 'degraded'/);
        assert.ok(SRC.includes('skipped'), 'runner deve lidar com steps skipped');
    });

    it('delega a implementação das steps para módulo dedicado', () => {
        assert.match(SRC, /from '\.\/steps\/index\.js'/);
        assert.match(STEPS_SRC, /from '\.\/boot-session-prep\.js'/);
        assert.match(STEPS_SRC, /from '\.\/boot-dialog-recovery\.js'/);
        assert.match(STEPS_SRC, /from '\.\/boot-runtime-bind\.js'/);
        assert.match(BOOT_SESSION_PREP_SRC, /export function createBootWiringState\(/);
        assert.match(BOOT_SESSION_PREP_SRC, /export function stepWireSessionEvents\(/);
        assert.match(BOOT_RUNTIME_BIND_SRC, /export function stepStartKeepalive\(/);
        assert.match(BOOT_DIALOG_RECOVERY_SRC, /export async function runDialogBootRecovery\(/);
        assert.match(BOOT_RUNTIME_BIND_SRC, /export function stepWireQuestionAnsweredRelay\(/);
    });

    it('passa o contexto para steps que usam o tracker de background', () => {
        assert.match(SRC, /stepWireQuestionAnsweredRelay\(agentEmitter, ctx, state\)/);
        assert.match(
            `${BOOT_SESSION_PREP_SRC}\n${BOOT_DIALOG_RECOVERY_SRC}\n${BOOT_RUNTIME_BIND_SRC}`,
            /trackBackgroundTask\(/,
        );
    });
});
