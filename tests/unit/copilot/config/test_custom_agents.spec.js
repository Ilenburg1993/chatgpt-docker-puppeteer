// @ts-check
/**
 * @file Faixa 47 — config/custom-agents.js (325L)
 *
 * Cobre BUILTIN_AGENTS (auditor/docs/reviewer), getCustomAgent, listCustomAgents,
 * registerCustomAgent, removeCustomAgent, buildCustomAgentsConfig, listAvailableSdkAgents.
 */

import { describe, expect, it, vi, afterEach } from 'vitest';

vi.mock('#copilot/config/env', () => new Proxy(
    { COPILOT_CUSTOM_AGENTS: 'task,explore,diagnostic', COPILOT_DISABLED_AGENTS: '' },
    { get: (t, p) => p in t ? t[p] : typeof p === 'string' ? '' : undefined, has: () => true },
));

const mod = await import('#copilot/config/custom-agents');

// ═══════════════════════════════════════════════════════════════════════════════
// 1. BUILTIN_AGENTS — getCustomAgent / listCustomAgents
// ═══════════════════════════════════════════════════════════════════════════════

describe('F47 — BUILTIN_AGENTS: getCustomAgent', () => {
    it('retorna auditor por nome', () => {
        const a = mod.getCustomAgent('auditor');
        expect(a).toBeDefined();
        expect(a?.name).toBe('auditor');
        expect(Array.isArray(a?.tools)).toBe(true);
    });

    it('aceita at-sign no prefixo', () => {
        const a = mod.getCustomAgent('@docs');
        expect(a?.name).toBe('docs');
    });

    it('retorna undefined para agente desconhecido', () => {
        expect(mod.getCustomAgent('unknown')).toBeUndefined();
    });
});

describe('F47 — BUILTIN_AGENTS: listCustomAgents', () => {
    it('retorna pelo menos os 3 builtins', () => {
        const list = mod.listCustomAgents();
        expect(list.length).toBeGreaterThanOrEqual(3);
        const names = list.map((a) => a.name);
        expect(names).toContain('auditor');
        expect(names).toContain('docs');
        expect(names).toContain('reviewer');
    });

    it('cada agente tem name, description, tools, prompt', () => {
        for (const a of mod.listCustomAgents()) {
            expect(typeof a.name).toBe('string');
            expect(typeof a.description).toBe('string');
            expect(Array.isArray(a.tools)).toBe(true);
            expect(typeof a.prompt).toBe('string');
        }
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. registerCustomAgent / removeCustomAgent
// ═══════════════════════════════════════════════════════════════════════════════

describe('F47 — registerCustomAgent', () => {
    afterEach(() => {
        mod.removeCustomAgent('test-agent');
    });

    it('registra e recupera agente customizado', () => {
        const cfg = { name: 'test-agent', description: 'Test', tools: ['grep'], prompt: 'Do the test.' };
        mod.registerCustomAgent(cfg);
        expect(mod.getCustomAgent('test-agent')).toEqual(cfg);
    });

    it('sobrescreve agente existente', () => {
        const cfg1 = { name: 'test-agent', description: 'V1', tools: ['grep'], prompt: 'v1' };
        const cfg2 = { name: 'test-agent', description: 'V2', tools: ['glob'], prompt: 'v2' };
        mod.registerCustomAgent(cfg1);
        mod.registerCustomAgent(cfg2);
        expect(mod.getCustomAgent('test-agent')?.description).toBe('V2');
    });

    it('lança ConfigError se name vazio', () => {
        expect(() => mod.registerCustomAgent({ name: '', description: 'D', tools: [], prompt: 'P' }))
            .toThrow(/name/);
    });

    it('lança ConfigError se tools não é array de strings', () => {
        expect(() => mod.registerCustomAgent({ name: 'x', description: 'D', tools: /** @type {any} */ ([123]), prompt: 'P' }))
            .toThrow(/tools/);
    });

    it('lança ConfigError se description ausente', () => {
        expect(() => mod.registerCustomAgent({ name: 'x', description: /** @type {any} */ (null), tools: [], prompt: 'P' }))
            .toThrow(/description/);
    });
});

describe('F47 — removeCustomAgent', () => {
    it('remove agente existente e retorna true', () => {
        mod.registerCustomAgent({ name: 'temp', description: 'T', tools: [], prompt: 'P' });
        expect(mod.removeCustomAgent('temp')).toBe(true);
        expect(mod.getCustomAgent('temp')).toBeUndefined();
    });

    it('retorna false para agente inexistente', () => {
        expect(mod.removeCustomAgent('nonexistent')).toBe(false);
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. SDK Integration — buildCustomAgentsConfig / listAvailableSdkAgents
// ═══════════════════════════════════════════════════════════════════════════════

describe('F47 — buildCustomAgentsConfig', () => {
    it('retorna array de agents filtrados por enabled', () => {
        const agents = mod.buildCustomAgentsConfig(['task', 'explore']);
        expect(agents).toBeDefined();
        expect(agents?.length).toBe(2);
        const names = agents?.map((a) => a.name);
        expect(names).toContain('task');
        expect(names).toContain('explore');
    });

    it('retorna undefined para enabled vazio', () => {
        expect(mod.buildCustomAgentsConfig([])).toBeUndefined();
    });

    it('retorna undefined se todos os names são desconhecidos', () => {
        expect(mod.buildCustomAgentsConfig(['nope', 'nada'])).toBeUndefined();
    });

    it('default usa COPILOT_CUSTOM_AGENTS (task,explore,diagnostic)', () => {
        const agents = mod.buildCustomAgentsConfig();
        expect(agents).toBeDefined();
        expect(agents?.length).toBe(3);
    });
});

describe('F47 — listAvailableSdkAgents', () => {
    it('retorna nomes de todos os SDK agents', () => {
        const names = mod.listAvailableSdkAgents();
        expect(names.length).toBeGreaterThanOrEqual(6);
        expect(names).toContain('task');
        expect(names).toContain('explore');
        expect(names).toContain('diagnostic');
        expect(names).toContain('planner');
        expect(names).toContain('git-ops');
        expect(names).toContain('shell-ops');
    });
});
