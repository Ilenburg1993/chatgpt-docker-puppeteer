// @ts-check
/**
 * tests/unit/copilot/test_boot_surface_validation.spec.js
 *
 * Contrato: validação das superfícies mínimas carregadas antes de HTTP/REPL.
 */

import { describe, expect, it } from 'vitest';
import {
    COPILOT_BOOT_REQUIRED_SURFACES,
    assertCopilotBootSurfaces,
    validateCopilotBootSurfaces,
} from '../../../src/copilot/boot/surface-validation.js';

describe('copilot/boot/surface-validation', () => {
    it('valida os barrels reais usados pelo boot', async () => {
        const [{ createCopilotBootPlan }, core, sdk, agent, terminal] = await Promise.all([
            import('../../../src/copilot/boot/plan.js'),
            import('#copilot/core'),
            import('#copilot/sdk'),
            import('#copilot/agent'),
            import('../../../src/copilot/terminal/index.js'),
        ]);
        const plan = createCopilotBootPlan();

        const report = assertCopilotBootSurfaces({
            core,
            sdk,
            agent,
            terminal,
            plan,
            phaseHandlers: buildHandlersForPlan(plan),
        });

        expect(report.ok).toBe(true);
    });

    it('aprova SDK, agent, terminal e handlers completos', () => {
        const plan = {
            phases: [
                { id: 'observability' },
                { id: 'runtime-wiring' },
                { id: 'boot-surface-validation' },
                { id: 'terminal-init' },
                { id: 'compat-runtime-host' },
            ],
        };
        const phaseHandlers = {
            observability: () => undefined,
            'runtime-wiring': () => undefined,
            'boot-surface-validation': () => undefined,
            'terminal-init': () => undefined,
        };

        const report = validateCopilotBootSurfaces({
            core: buildSurface(COPILOT_BOOT_REQUIRED_SURFACES.core),
            sdk: buildSurface(COPILOT_BOOT_REQUIRED_SURFACES.sdk),
            agent: buildSurface(COPILOT_BOOT_REQUIRED_SURFACES.agent),
            terminal: buildSurface(COPILOT_BOOT_REQUIRED_SURFACES.terminal),
            plan,
            phaseHandlers,
        });

        expect(report.ok).toBe(true);
        expect(report.missing).toEqual([]);
        expect(report.groups.map((group) => group.name)).toEqual(['core', 'sdk', 'agent', 'terminal', 'phaseHandlers']);
        expect(assertCopilotBootSurfaces({ ...reportInput(plan, phaseHandlers) }).ok).toBe(true);
    });

    it('reporta exports ausentes e handlers sem cobertura', () => {
        const plan = {
            phases: [{ id: 'observability' }, { id: 'runtime-wiring' }, { id: 'terminal-init' }],
        };
        const input = reportInput(plan, { observability: () => undefined });
        delete input.core.listActiveTimers;
        delete input.sdk.createCopilotClient;
        delete input.agent.startRuntime;
        delete input.terminal.runTerminalHttpServerPhase;

        const report = validateCopilotBootSurfaces(input);

        expect(report.ok).toBe(false);
        expect(report.missing).toEqual(
            expect.arrayContaining([
                'core.listActiveTimers',
                'sdk.createCopilotClient',
                'agent.startRuntime',
                'terminal.runTerminalHttpServerPhase',
                'phaseHandlers.runtime-wiring',
                'phaseHandlers.terminal-init',
            ]),
        );
        expect(() => assertCopilotBootSurfaces(input)).toThrow(
            /core\.listActiveTimers.*phaseHandlers\.runtime-wiring/s,
        );
    });
});

/**
 * @param {{ phases: { id: string }[] }} plan
 * @param {Record<string, unknown>} phaseHandlers
 * @returns {Parameters<typeof validateCopilotBootSurfaces>[0]}
 */
function reportInput(plan, phaseHandlers) {
    return {
        core: buildSurface(COPILOT_BOOT_REQUIRED_SURFACES.core),
        sdk: buildSurface(COPILOT_BOOT_REQUIRED_SURFACES.sdk),
        agent: buildSurface(COPILOT_BOOT_REQUIRED_SURFACES.agent),
        terminal: buildSurface(COPILOT_BOOT_REQUIRED_SURFACES.terminal),
        plan,
        phaseHandlers,
    };
}

/**
 * @param {readonly string[]} names
 * @returns {Record<string, unknown>}
 */
function buildSurface(names) {
    return Object.fromEntries(names.map((name) => [name, () => undefined]));
}

/**
 * @param {{ phases: { id: string }[] }} plan
 * @returns {Record<string, () => void>}
 */
function buildHandlersForPlan(plan) {
    return Object.fromEntries(
        plan.phases.filter((phase) => phase.id !== 'compat-runtime-host').map((phase) => [phase.id, () => undefined]),
    );
}
