// @ts-check

import { beforeEach, describe, expect, it } from 'vitest';

import {
    getBootLifecycleMetrics,
    getLastBootLifecycleReport,
    resetBootLifecycleReportForTests,
    runCopilotBootPlan,
} from '../../../src/copilot/boot/lifecycle-runner.js';

const plan = {
    mode: 'terminal-runtime',
    workspaceRoot: '/workspace',
    serverUrl: 'http://127.0.0.1:3009',
    phases: [
        { id: 'one', owner: 'bootstrap', responsibility: 'first', timeoutMs: 100 },
        { id: 'two', owner: 'terminal', responsibility: 'second', timeoutMs: 100 },
        { id: 'delegated', owner: 'server', responsibility: 'delegated', timeoutMs: 100 },
    ],
};

describe('boot/lifecycle-runner', () => {
    beforeEach(() => {
        resetBootLifecycleReportForTests();
    });

    it('executa handlers por fase e registra skipped para fases delegadas', async () => {
        /** @type {string[]} */
        const order = [];
        /** @type {string[]} */
        const events = [];

        const report = await runCopilotBootPlan(plan, {
            emit: (event) => events.push(event.type),
            phaseHandlers: {
                one: () => {
                    order.push('one');
                },
                two: async () => {
                    order.push('two');
                },
            },
        });

        expect(order).toEqual(['one', 'two']);
        expect(report.status).toBe('ok');
        expect(report.okCount).toBe(2);
        expect(report.skippedCount).toBe(1);
        expect(report.phases.map((phase) => phase.status)).toEqual(['ok', 'ok', 'skipped']);
        expect(getLastBootLifecycleReport()?.status).toBe('ok');
        expect(events).toEqual([
            'runtime.boot.started',
            'runtime.boot.phase_started',
            'runtime.boot.phase_completed',
            'runtime.boot.phase_started',
            'runtime.boot.phase_completed',
            'runtime.boot.completed',
        ]);
    });

    it('executa rollbacks em ordem reversa e preserva erro original', async () => {
        /** @type {string[]} */
        const rollbacks = [];

        await expect(
            runCopilotBootPlan(plan, {
                phaseHandlers: {
                    one: {
                        run: () => {},
                        rollback: () => {
                            rollbacks.push('one');
                        },
                    },
                    two: {
                        run: () => {
                            throw new Error('boom');
                        },
                    },
                },
            }),
        ).rejects.toThrow('boom');

        expect(rollbacks).toEqual(['one']);
        const report = getLastBootLifecycleReport();
        expect(report?.status).toBe('failed');
        expect(report?.failedPhase).toBe('two');
        expect(report?.failedCount).toBe(1);
        expect(report?.rollbacks).toEqual([expect.objectContaining({ id: 'one', status: 'ok' })]);
    });

    it('permite rollback parcial registrado dentro da fase que falha', async () => {
        /** @type {string[]} */
        const rollbacks = [];

        await expect(
            runCopilotBootPlan(plan, {
                phaseHandlers: {
                    one: {
                        run: (ctx) => {
                            ctx.registerRollback('socket', () => {
                                rollbacks.push('socket');
                            });
                            ctx.registerRollback('listener', () => {
                                rollbacks.push('listener');
                            });
                            throw new Error('partial boom');
                        },
                    },
                },
            }),
        ).rejects.toThrow('partial boom');

        expect(rollbacks).toEqual(['listener', 'socket']);
        const report = getLastBootLifecycleReport();
        expect(report?.failedPhase).toBe('one');
        expect(report?.rollbacks).toEqual([
            expect.objectContaining({ id: 'one:listener', phaseId: 'one', status: 'ok' }),
            expect.objectContaining({ id: 'one:socket', phaseId: 'one', status: 'ok' }),
        ]);
    });

    it('agrega métricas por fase do boot lifecycle', async () => {
        await runCopilotBootPlan(plan, {
            phaseHandlers: {
                one: () => undefined,
                two: () => undefined,
            },
        });

        const metrics = getBootLifecycleMetrics();
        expect(metrics).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ id: 'one', attempts: 1, okCount: 1, lastStatus: 'ok' }),
                expect.objectContaining({ id: 'two', attempts: 1, okCount: 1, lastStatus: 'ok' }),
                expect.objectContaining({ id: 'delegated', attempts: 1, skippedCount: 1, lastStatus: 'skipped' }),
            ]),
        );
    });
});
