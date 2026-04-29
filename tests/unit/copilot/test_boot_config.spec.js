// @ts-check
/**
 * tests/unit/copilot/test_boot_config.spec.js
 *
 * Contrato: src/copilot/boot/
 */

import { describe, expect, it } from 'vitest';

describe('copilot/boot — contrato central de boot', () => {
    it('exporta contrato, config, workspace, skills e plano', async () => {
        const mod = await import('../../../src/copilot/boot/index.js');
        expect(typeof mod.readCopilotBootContract).toBe('function');
        expect(typeof mod.readCopilotBootConfig).toBe('function');
        expect(typeof mod.getWorkspaceContext).toBe('function');
        expect(typeof mod.readBootSkillConfig).toBe('function');
        expect(typeof mod.createCopilotBootPlan).toBe('function');
        expect(typeof mod.runCopilotBootPlan).toBe('function');
        expect(typeof mod.getLastBootLifecycleReport).toBe('function');
    });

    it('centraliza variaveis operacionais de boot', async () => {
        const mod = await import('../../../src/copilot/boot/index.js');
        expect(mod.BOOT_CONFIG_ENV_KEYS).toEqual(
            expect.arrayContaining([
                'COPILOT_WORKING_DIRECTORY',
                'COPILOT_SKILL_DIRECTORIES',
                'COPILOT_PINNED_CONTEXT_DIRS',
                'COPILOT_DISABLED_SKILLS',
                'LLM_B_TERMINAL_HOST',
                'LLM_B_TERMINAL_PORT',
                'COPILOT_CLI_URL',
            ]),
        );
    });

    it('gera config e plano a partir do workspace canonico', async () => {
        const mod = await import('../../../src/copilot/boot/index.js');
        const config = mod.readCopilotBootConfig();
        const plan = mod.createCopilotBootPlan(config);

        expect(config.workspace.root).toBe(mod.WORKSPACE_ROOT);
        expect(config.server.url).toContain(String(config.server.port));
        expect(config.skills.skillDirectories.length).toBeGreaterThan(0);
        expect(config.paths.pluginsDir).toContain('/src/copilot/plugins');
        expect(config.paths.toolsConfigFile).toContain('tools-config.json');
        expect(config.paths.customToolsFile).toContain('custom-tools.json');
        expect(plan.workspaceRoot).toBe(config.workspace.root);
        expect(plan.phases.map((phase) => phase.id)).toContain('terminal-pinned-context');
        expect(plan.phases.map((phase) => phase.id)).toContain('sdk-preflight');
        expect(plan.phases.map((phase) => phase.id)).toContain('copilot-http-server');
        expect(plan.phases.map((phase) => phase.id)).toContain('repl');
        expect(plan.phases.map((phase) => phase.id)).toContain('compat-runtime-host');
        expect(plan.phases.every((phase) => typeof phase.timeoutMs === 'number' && phase.timeoutMs > 0)).toBe(true);
    });
});
