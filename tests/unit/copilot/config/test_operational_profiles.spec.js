// @ts-check
import { describe, expect, it } from 'vitest';

import {
    OPERATIONAL_PROFILES,
    loadOperationalProfile,
    resolveOperationalAgentSelection,
} from '#copilot/testing/config/operational-profiles';

describe('operational profiles', () => {
    it('production habilita agent-full como primeiro agente', () => {
        const profile = loadOperationalProfile('production');
        expect(profile.customAgents[0]).toBe('agent-full');
        expect(profile.customAgents).toContain('explore');
        expect(profile.customAgents).toContain('git-ops');
    });

    it('terminal_light mantém maestro e trio mínimo', () => {
        const profile = loadOperationalProfile('terminal_light');
        expect(profile.customAgents).toEqual(['agent-full', 'task', 'planner', 'diagnostic']);
        expect(profile.disabledAgents).toContain('shell-ops');
    });

    it('CSV explícito tem precedência sobre agentes do profile', () => {
        const selection = resolveOperationalAgentSelection({
            profileName: 'production',
            customAgentsCsv: 'task,diagnostic',
            disabledAgentsCsv: 'diagnostic',
        });
        expect(selection.enabled).toEqual(['task', 'diagnostic']);
        expect(selection.disabled).toEqual(['diagnostic']);
    });

    it('rejeita profiles desconhecidos com lista de opções', () => {
        expect(() => loadOperationalProfile('missing')).toThrow(Object.keys(OPERATIONAL_PROFILES)[0]);
    });
});
