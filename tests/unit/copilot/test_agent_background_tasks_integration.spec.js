// @ts-check

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { beforeAll, describe, it } from 'vitest';

describe('agent › K4 background task tracker integration', () => {
    /** @type {string} */
    let contextSrc = '';
    /** @type {string} */
    let contextFactoriesSrc = '';
    /** @type {string} */
    let lifecycleSrc = '';
    /** @type {string} */
    let bootStepsSrc = '';
    /** @type {string} */
    let userInputSrc = '';
    /** @type {string} */
    let loopManagerSrc = '';
    /** @type {string} */
    let resumePolicySrc = '';
    /** @type {string} */
    let turnExecutorSrc = '';

    beforeAll(async () => {
        [
            contextSrc,
            contextFactoriesSrc,
            lifecycleSrc,
            bootStepsSrc,
            userInputSrc,
            loopManagerSrc,
            resumePolicySrc,
            turnExecutorSrc,
        ] = await Promise.all([
            readFile(new URL('../../../src/copilot/agent/agent-context.js', import.meta.url), 'utf-8'),
            readFile(new URL('../../../src/copilot/agent/context-factories.js', import.meta.url), 'utf-8'),
            readFile(new URL('../../../src/copilot/agent/lifecycle/agent-lifecycle.js', import.meta.url), 'utf-8'),
            readFile(new URL('../../../src/copilot/agent/session/boot-steps.js', import.meta.url), 'utf-8'),
            readFile(new URL('../../../src/copilot/agent/dialog/user-input-handler.js', import.meta.url), 'utf-8'),
            readFile(new URL('../../../src/copilot/agent/dialog/loop-manager.js', import.meta.url), 'utf-8'),
            readFile(new URL('../../../src/copilot/agent/dialog/resume-policy.js', import.meta.url), 'utf-8'),
            readFile(new URL('../../../src/copilot/agent/dialog/turn-executor.js', import.meta.url), 'utf-8'),
        ]);
    });

    it('agent-context instancia BackgroundTasks', () => {
        assert.ok(contextSrc.includes('createBackgroundTasks('));
        assert.ok(contextFactoriesSrc.includes('new BackgroundTasks('));
        assert.ok(contextFactoriesSrc.includes('EMITTER_AGENT_BACKGROUND_COMPLETED'));
        assert.ok(contextFactoriesSrc.includes('EMITTER_AGENT_BACKGROUND_IDLE'));
    });

    it('agent-lifecycle faz track de background tasks e drena no shutdown', () => {
        assert.ok(lifecycleSrc.includes('trackBackgroundTask('));
        assert.ok(lifecycleSrc.includes('drainBackgroundTasks(5000)'));
    });

    it('boot-steps usa trackBackgroundTask nas tarefas fire-and-forget', () => {
        assert.ok(bootStepsSrc.includes('trackBackgroundTask('));
        assert.ok(bootStepsSrc.includes('dialog.boot_recovery.run'));
        assert.ok(bootStepsSrc.includes('hooks.question_answered.relay'));
    });

    it('user-input-handler aceita trackBackgroundTask para persistência assíncrona', () => {
        assert.ok(userInputSrc.includes('trackBackgroundTask'));
        assert.ok(userInputSrc.includes('persistStateWithPolicy'));
        assert.ok(userInputSrc.includes('question.persist.pending'));
    });

    it('loop-manager roteia writes assíncronos via trackBackgroundTask', () => {
        assert.ok(loopManagerSrc.includes('#trackBackgroundTask('));
        assert.ok(loopManagerSrc.includes('#trackPersistedState('));
        assert.ok(loopManagerSrc.includes('strategy.persistenceLabel'));
        assert.ok(resumePolicySrc.includes('dialog.prMetrics.resume_with_pr'));
    });

    it('turn-executor roteia persistência de pending turn via trackBackgroundTask', () => {
        assert.ok(turnExecutorSrc.includes('trackBackgroundTask'));
        assert.ok(turnExecutorSrc.includes('persistStateWithPolicy'));
        assert.ok(turnExecutorSrc.includes('dialog.turn.pending'));
    });
});
