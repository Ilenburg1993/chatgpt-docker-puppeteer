// @ts-check

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { before, describe, it } from 'node:test';

describe('agent › K4 background task tracker integration', () => {
    /** @type {string} */
    let contextSrc = '';
    /** @type {string} */
    let lifecycleSrc = '';
    /** @type {string} */
    let bootStepsSrc = '';
    /** @type {string} */
    let userInputSrc = '';
    /** @type {string} */
    let loopManagerSrc = '';
    /** @type {string} */
    let turnExecutorSrc = '';

    before(async () => {
        [contextSrc, lifecycleSrc, bootStepsSrc, userInputSrc, loopManagerSrc, turnExecutorSrc] = await Promise.all([
            readFile(new URL('../../../src/copilot/agent/agent-context.js', import.meta.url), 'utf-8'),
            readFile(new URL('../../../src/copilot/agent/lifecycle/agent-lifecycle.js', import.meta.url), 'utf-8'),
            readFile(new URL('../../../src/copilot/agent/session/boot-steps.js', import.meta.url), 'utf-8'),
            readFile(new URL('../../../src/copilot/agent/dialog/user-input-handler.js', import.meta.url), 'utf-8'),
            readFile(new URL('../../../src/copilot/agent/dialog/loop-manager.js', import.meta.url), 'utf-8'),
            readFile(new URL('../../../src/copilot/agent/dialog/turn-executor.js', import.meta.url), 'utf-8'),
        ]);
    });

    it('agent-context instancia BackgroundTasks', () => {
        assert.ok(contextSrc.includes('new BackgroundTasks('));
        assert.ok(contextSrc.includes('agent.background.completed'));
        assert.ok(contextSrc.includes('agent.background.idle'));
    });

    it('agent-lifecycle faz track de background tasks e drena no shutdown', () => {
        assert.ok(lifecycleSrc.includes('backgroundTasks.track('));
        assert.ok(lifecycleSrc.includes('backgroundTasks.drain(5000)'));
    });

    it('boot-steps usa backgroundTasks.track nas tarefas fire-and-forget', () => {
        assert.ok(bootStepsSrc.includes('backgroundTasks.track('));
        assert.ok(bootStepsSrc.includes('dialog.boot_recovery.run'));
        assert.ok(bootStepsSrc.includes('hooks.question_answered.relay'));
    });

    it('user-input-handler aceita trackBackgroundTask para persistência assíncrona', () => {
        assert.ok(userInputSrc.includes('trackBackgroundTask'));
        assert.ok(userInputSrc.includes('question.persist.pending'));
    });

    it('loop-manager roteia writes assíncronos via trackBackgroundTask', () => {
        assert.ok(loopManagerSrc.includes('#trackBackgroundTask('));
        assert.ok(loopManagerSrc.includes('dialog.prMetrics.resume_with_pr'));
    });

    it('turn-executor roteia persistência de pending turn via trackBackgroundTask', () => {
        assert.ok(turnExecutorSrc.includes('trackBackgroundTask'));
        assert.ok(turnExecutorSrc.includes('dialog.turn.pending'));
    });
});
