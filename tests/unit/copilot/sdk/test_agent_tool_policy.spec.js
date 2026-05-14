// @ts-check
import { describe, expect, it } from 'vitest';

import { normalizeAgentToolList, resolveToolName } from '#copilot/config';
import { AgentToolPolicy } from '../../../../src/copilot/sdk/tools/agent-policy.js';

describe('AgentToolPolicy', () => {
    const policy = new AgentToolPolicy(
        [
            { name: 'agent-full', tools: null },
            { name: 'explore', tools: ['read_file_content', 'grep'] },
            { name: 'task', tools: ['exec_command'] },
        ],
        { denylist: ['git_push'], allowlist: null },
        ['read_file_content', 'search_in_files', 'exec_command', 'git_push'],
        {
            normalizeAgentToolList,
            resolveToolName,
        },
    );

    it('permite acesso total ao agent-full, inclusive diante de denylist global', () => {
        expect(policy.isToolAllowedForAgent('agent-full', 'read_file_content')).toBe(true);
        expect(policy.isToolAllowedForAgent('agent-full', 'git_push')).toBe(true);
    });

    it('aplica allowlist por agente com normalizers injetados pelo produto', () => {
        expect(policy.isToolAllowedForAgent('explore', 'view')).toBe(true);
        expect(policy.isToolAllowedForAgent('explore', 'search_in_files')).toBe(true);
        expect(policy.isToolAllowedForAgent('explore', 'exec_command')).toBe(false);
    });

    it('retorna tools efetivas do maestro sem aplicar denylist global', () => {
        expect(policy.getAllowedToolsForAgent('agent-full')).toEqual([
            'exec_command',
            'git_push',
            'read_file_content',
            'search_in_files',
        ]);
    });
});
