// @ts-check
import { describe, expect, it } from 'vitest';

import { validateAgentContracts } from '../../../../src/copilot/agent/facades/sdk/agent-contract.js';

describe('agent contract validation', () => {
    it('expande agent-full wildcard contra registry disponível', () => {
        const result = validateAgentContracts(
            [{ name: 'agent-full', description: 'Maestro', tools: null, prompt: 'Prompt do maestro' }],
            new Set(['read_file_content', 'exec_command']),
        );
        expect(result.errors).toEqual([]);
        expect(result.contractLog['agent-full'].toolsResolved).toEqual(['exec_command', 'read_file_content']);
    });

    it('falha para tier obrigatório indisponível', () => {
        const result = validateAgentContracts(
            [
                {
                    name: 'task',
                    description: 'Task',
                    tools: ['exec_command'],
                    toolTiers: { must: ['exec_command', 'run_tests'] },
                    prompt: 'Task prompt',
                },
            ],
            new Set(['exec_command']),
        );
        expect(result.errors.join('\n')).toMatch(/run_tests/);
    });

    it('trata tier recomendado indisponível como warning', () => {
        const result = validateAgentContracts(
            [
                {
                    name: 'explore',
                    description: 'Explore',
                    tools: ['read_file_content', 'workspace_index_search'],
                    toolTiers: { must: ['read_file_content'], should: ['workspace_index_search'] },
                    prompt: 'Explore prompt',
                },
            ],
            new Set(['read_file_content']),
        );
        expect(result.errors).toEqual([]);
        expect(result.warnings.join('\n')).toMatch(/workspace_index_search/);
    });

    it('aceita agente sem description e registra warning quando inferível', () => {
        const result = validateAgentContracts(
            [{ name: 'researcher', prompt: 'Pesquise', tools: ['read_file_content'] }],
            new Set(['read_file_content']),
        );

        expect(result.errors).toEqual([]);
        expect(result.warnings.join('\n')).toMatch(/description/);
    });

    it('aceita tools=[] como válido e emite warning em vez de erro', () => {
        const result = validateAgentContracts([{ name: 'planner', prompt: 'Planeje', tools: [] }], new Set());

        expect(result.errors).toEqual([]);
        expect(result.warnings.join('\n')).toMatch(/tools=\[\]/);
    });

    it('avisa quando subagente declara skills sem skillDirectories na sessão', () => {
        const result = validateAgentContracts(
            [{ name: 'security', prompt: 'Audite', skills: ['security-scan'] }],
            new Set(),
            { skillDirectories: [], disabledSkills: [] },
        );

        expect(result.errors).toEqual([]);
        expect(result.warnings.join('\n')).toMatch(/skillDirectories/);
    });

    it('avisa quando skills do subagente estão desabilitadas na sessão', () => {
        const result = validateAgentContracts(
            [{ name: 'security', prompt: 'Audite', skills: ['security-scan', 'dependency-check'] }],
            new Set(),
            {
                skillDirectories: ['/workspace/.github/skills'],
                disabledSkills: ['security-scan'],
            },
        );

        expect(result.errors).toEqual([]);
        expect(result.warnings.join('\n')).toMatch(/security-scan/);
    });
});
