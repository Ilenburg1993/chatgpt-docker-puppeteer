// @ts-check

import { describe, expect, it } from 'vitest';

import {
    readAgentRuntimeToolEntries,
    readAgentRuntimeTools,
} from '../../../src/copilot/agent/facades/agent-runtime-tools.js';

describe('agent-runtime-tools facade', () => {
    it('prefere a projeção semântica do agent em vez de expor o registry cru', () => {
        const agent = {
            getToolRegistryEntriesSnapshot: () => [
                {
                    name: 'read_file',
                    description: 'Read a file',
                    category: 'file',
                    tags: ['read'],
                    readOnly: true,
                    skipPermission: true,
                },
            ],
            toolsRegistry: {
                entries: new Map([['should_not_leak', { tool: { name: 'should_not_leak' } }]]),
            },
        };

        expect(readAgentRuntimeToolEntries(agent)).toEqual([
            {
                name: 'read_file',
                description: 'Read a file',
                category: 'file',
                tags: ['read'],
                readOnly: true,
                skipPermission: true,
            },
        ]);
    });

    it('usa fallback estático apenas quando o registry runtime não existe', () => {
        const snapshot = readAgentRuntimeTools(
            { toolsRegistry: null },
            { allTools: [{ name: 'static_tool', description: 'Static', skipPermission: true }] },
        );

        expect(snapshot).toEqual({
            ok: true,
            source: 'static',
            count: 1,
            tools: [
                {
                    name: 'static_tool',
                    description: 'Static',
                    category: 'uncategorized',
                    tags: [],
                    readOnly: false,
                    skipPermission: true,
                },
            ],
        });
    });

    it('denuncia indisponibilidade quando a rota exige registry vivo', () => {
        const snapshot = readAgentRuntimeTools({ toolsRegistry: null }, { requireRegistry: true });

        expect(snapshot.ok).toBe(false);
        expect(snapshot.source).toBe('unavailable');
        expect(snapshot.error).toMatch(/ToolsRegistry/);
    });
});
