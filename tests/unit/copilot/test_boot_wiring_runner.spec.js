// @ts-check

import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import { createBootWiringState } from '../../../src/copilot/agent/session/boot-steps.js';
import { runBootPipeline } from '../../../src/copilot/agent/session/boot-wiring.js';

describe('boot-wiring runner', () => {
    it('continua após falha retryable em step opcional, marcando degraded', async () => {
        const state = createBootWiringState();
        let nextStepRan = false;

        await runBootPipeline(
            [
                {
                    name: 'optionalStep',
                    phase: 'quota',
                    required: false,
                    run: () => {
                        throw new Error('quota unavailable');
                    },
                },
                {
                    name: 'nextStep',
                    phase: 'other',
                    required: false,
                    run: () => {
                        nextStepRan = true;
                    },
                },
            ],
            state,
        );

        assert.equal(nextStepRan, true);
        assert.equal(state.stepReports[0]?.status, 'degraded');
        assert.equal(state.stepReports[1]?.status, 'ok');
    });

    it('marca step opcional abortado como skipped', async () => {
        const state = createBootWiringState();

        await runBootPipeline(
            [
                {
                    name: 'optionalAbort',
                    phase: 'hooks',
                    required: false,
                    run: () => {
                        throw new DOMException('aborted', 'AbortError');
                    },
                },
            ],
            state,
        );

        assert.equal(state.stepReports[0]?.status, 'skipped');
    });

    it('derruba o boot quando um step required falha', async () => {
        const state = createBootWiringState();

        await assert.rejects(
            () =>
                runBootPipeline(
                    [
                        {
                            name: 'requiredStep',
                            phase: 'session',
                            required: true,
                            run: () => {
                                throw new Error('session wiring failed');
                            },
                        },
                    ],
                    state,
                ),
            /session wiring failed/,
        );

        assert.equal(state.stepReports[0]?.status, 'failed');
    });
});
